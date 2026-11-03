import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { OpenAIProvider } from "./openai-provider";
import { OllamaProvider } from "./ollama-provider";
import { BackendProviderError } from "./provider-error";
import { readJsonBody, RequestBodyError } from "./request-body";
import { AccessTokenService, FixedWindowRateLimiter } from "./security";

const port = numberEnv("AI_BACKEND_PORT", 8787);
const host = process.env.AI_BACKEND_HOST ?? "127.0.0.1";
const jwtSecret = requiredEnv("AI_JWT_SECRET");
const bootstrapToken = requiredEnv("AI_BOOTSTRAP_TOKEN");
const userId = process.env.AI_DEV_USER_ID ?? "local-user";
const backendProvider = process.env.AI_BACKEND_PROVIDER ?? "openai";
if (backendProvider !== "openai" && backendProvider !== "ollama") throw new Error("AI_BACKEND_PROVIDER must be openai or ollama.");
const model = backendProvider === "ollama" ? (process.env.OLLAMA_MODEL ?? "qwen3-coder:30b") : (process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
const provider = backendProvider === "ollama"
  ? new OllamaProvider(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434", model, numberEnv("OLLAMA_TIMEOUT_MS", 120_000))
  : new OpenAIProvider(requiredEnv("OPENAI_API_KEY"), model, numberEnv("OPENAI_TIMEOUT_MS", 30_000));
const rateWindowMs = 60_000;
const rateLimit = numberEnv("AI_RATE_LIMIT", 30);
const tokens = new AccessTokenService(jwtSecret);
const limiter = new FixedWindowRateLimiter(rateLimit, rateWindowMs);
const maxBodyBytes = numberEnv("AI_MAX_BODY_BYTES", 128 * 1024);

const server = createServer((request, response) => {
  const context = createRequestContext(request, response);
  logRequest(context, "request-arrival");
  void handle(request, response, context).catch(error => {
    const details = error instanceof BackendProviderError ? error : undefined;
    logRequest(context, "request-failed", {
      errorKind: details?.kind ?? "internal",
      providerStatus: details?.status,
      providerType: details?.providerType,
      providerCode: details?.providerCode,
      providerRequestId: details?.requestId,
      error: sanitizeLogMessage(details?.providerMessage ?? (error instanceof Error ? error.message : "Unknown error"))
    });
    const status = details
      ? details.kind === "rate_limit" ? 429 : details.kind === "invalid_request" ? 400 : details.kind === "not_found" ? 404 : 502
      : error instanceof RequestBodyError ? error.status : 500;
    const body = details
      ? { error: clientError(details) }
      : error instanceof RequestBodyError
        ? { error: error.message }
        : { error: "The AI service failed." };
    sendJson(response, status, body, context);
  });
  response.on("finish", () => logRequest(context, "response-complete", { status: response.statusCode }));
  response.on("close", () => {
    if (!response.writableFinished) logRequest(context, "client-disconnect");
  });
});
server.listen(port, host, () => console.info(`AI backend listening on ${host}:${port}`));

interface RequestContext {
  id: string;
  method: string;
  route: string;
  response: ServerResponse;
  bodyBytes?: number;
}

function createRequestContext(request: IncomingMessage, response: ServerResponse): RequestContext {
  return {
    id: randomUUID(),
    method: request.method ?? "UNKNOWN",
    route: request.url?.split("?")[0] ?? "/",
    response
  };
}

function logRequest(context: RequestContext, event: string, metadata: Record<string, unknown> = {}): void {
  try {
    console.info(JSON.stringify({
      component: "ai-backend",
      event,
      requestId: context.id,
      method: context.method,
      route: context.route,
      provider: backendProvider,
      ...metadata
    }));
  } catch {
    // Diagnostics must never interfere with request handling.
  }
}

async function handle(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  if (request.method === "POST" && request.url === "/v1/auth/token") {
    const provided = request.headers["x-bootstrap-token"];
    const authorized = typeof provided === "string" && safeEqual(provided, bootstrapToken);
    logRequest(context, "authentication", { success: authorized, routePurpose: "token" });
    if (!authorized) return sendJson(response, 401, { error: "Unauthorized." }, context);
    return sendJson(response, 200, { accessToken: tokens.issue(userId) }, context);
  }
  if (request.method === "GET" && request.url === "/v1/ai/status") {
    const subject = tokens.verify(request.headers.authorization);
    logRequest(context, "authentication", { success: Boolean(subject), routePurpose: "status" });
    if (!subject) return sendJson(response, 401, { error: "Unauthorized." }, context);
    if (provider instanceof OllamaProvider) {
      const health = await provider.check();
      return sendJson(response, 200, { provider: backendProvider, model, ...health }, context);
    }
    return sendJson(response, 200, { provider: backendProvider, model, available: true, modelInstalled: true }, context);
  }
  if (request.method !== "POST" || request.url !== "/v1/ai/respond") return sendJson(response, 404, { error: "Not found." }, context);
  const subject = tokens.verify(request.headers.authorization);
  logRequest(context, "authentication", { success: Boolean(subject), routePurpose: "respond" });
  if (!subject) return sendJson(response, 401, { error: "Unauthorized." }, context);
  if (!limiter.allow(subject)) return sendJson(response, 429, { error: "Too many requests." }, context);
  let body: unknown;
  body = await readJsonBody(request, maxBodyBytes, size => { context.bodyBytes = size; });
  if (!body || typeof body !== "object" || !Array.isArray((body as { messages?: unknown }).messages) || !Array.isArray((body as { tools?: unknown }).tools)) {
    return sendJson(response, 400, { error: "Invalid request." }, context);
  }
  const messages = (body as { messages: unknown[] }).messages;
  const tools = (body as { tools: unknown[] }).tools;
  if (messages.length > 40 || tools.length > 20 || messages.some(message => !message || typeof message !== "object")) return sendJson(response, 400, { error: "Request exceeds limits." }, context);
  logRequest(context, "provider-start", { messageCount: messages.length, toolCount: tools.length, bodyBytes: context.bodyBytes });
  const started = Date.now();
  const result = await provider.respond(messages as never, tools as never);
  logRequest(context, "provider-complete", { durationMs: Date.now() - started, resultType: result.type });
  return sendJson(response, 200, result, context);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response: ServerResponse, status: number, body: unknown, context?: RequestContext): void {
  if (response.destroyed || response.writableEnded) {
    if (context) logRequest(context, "response-skipped", { status, reason: "client-disconnected" });
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body), () => {
    if (context) logRequest(context, "response-written", { status });
  });
}

function clientError(error: BackendProviderError): string {
  switch (error.kind) {
    case "authentication": return "The AI backend could not authenticate with its provider.";
    case "rate_limit": return "The AI provider is rate limited or its quota is exhausted.";
    case "invalid_request": return "The AI provider rejected the request. Check the backend model configuration.";
    case "timeout": return "The AI provider took too long to respond.";
    case "network": return "The AI backend could not reach the AI provider.";
    case "server": return "The AI provider is temporarily unavailable.";
    case "not_found": return "The configured local AI model is not installed.";
    case "invalid_response": return "The AI provider returned an invalid response.";
  }
}

function sanitizeLogMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(?:api[-_ ]?key|token|secret|authorization)\s*[:=]\s*\S+/gi, "[redacted]")
    .slice(0, 500);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
