
import type { AIProvider, AIProviderRequest, AIProviderResponse, AIToolCall } from "./types";

type BackendResponse =
  | { type: "message"; content: string }
  | { type: "tool_call"; call: AIToolCall }
  | { type: "tool_calls"; calls: AIToolCall[] };

type BackendErrorResponse = { error?: unknown };

export class BackendAIProvider implements AIProvider {
  readonly id = "backend";

  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async respond(request: AIProviderRequest): Promise<AIProviderResponse> {
    let response: Response;
    let stage = "access-token";

    try {
      const token = await this.getAccessToken();

      stage = "POST /v1/ai/respond";

      response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/v1/ai/respond`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            messages: request.messages,
            tools: request.tools ?? []
          })
        }
      );
    } catch (error) {
      logDiagnostic("connection-failed", error, undefined, {
        stage,
        backendOrigin: safeBackendOrigin(this.baseUrl),
        electronVersion: process.versions.electron ?? "not-electron",
        nodeVersion: process.versions.node
      });

      throw new Error(
        "The AI backend is unavailable. Start the local backend and check its connection settings."
      );
    }

    if (!response.ok) {
      const error = await readBackendError(response);

      logDiagnostic(
        "backend-http-error",
        new Error(error ?? `HTTP ${response.status}`),
        response.status
      );

      if (response.status === 401) {
        throw new Error("AI backend authorization expired.");
      }

      if (response.status === 429) {
        throw new Error(error ?? "The AI service is temporarily rate limited.");
      }

      throw new Error(
        error ??
          (response.status >= 500
            ? "The AI provider is temporarily unavailable."
            : "The AI request was rejected.")
      );
    }

    let result: BackendResponse;

    try {
      result = await response.json() as BackendResponse;
    } catch (error) {
      logDiagnostic("invalid-response-body", error, response.status);
      throw new Error("The AI backend returned an invalid response.");
    }

    if (result.type === "message" && typeof result.content === "string") {
      if (/<tool_call\b|<function\s*=|<\/tool_call>|<\/function>/i.test(result.content)) {
        logDiagnostic(
          "text-formatted-tool-call",
          new Error("Provider returned tool syntax as text."),
          response.status
        );

        throw new Error("The AI provider returned an invalid tool call.");
      }

      return result;
    }

    if (
      result.type === "tool_call" &&
      result.call &&
      typeof result.call.name === "string"
    ) {
      return result;
    }

    if (
      result.type === "tool_calls" &&
      Array.isArray(result.calls) &&
      result.calls.every(call => typeof call.name === "string")
    ) {
      return result;
    }

    logDiagnostic(
      "invalid-provider-response",
      new Error("Unexpected response shape."),
      response.status
    );

    throw new Error("The AI service returned an invalid response.");
  }

  async status(): Promise<{
    provider: string;
    model: string;
    available: boolean;
    modelInstalled: boolean;
  }> {
    const token = await this.getAccessToken();

    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/v1/ai/status`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
    } catch (error) {
      logDiagnostic("status-connection-failed", error, undefined, {
        backendOrigin: safeBackendOrigin(this.baseUrl),
        electronVersion: process.versions.electron ?? "not-electron",
        nodeVersion: process.versions.node
      });

      throw new Error("The AI backend status is unavailable.");
    }

    if (!response.ok) {
      throw new Error("The AI backend status is unavailable.");
    }

    let result: {
      provider?: unknown;
      model?: unknown;
      available?: unknown;
      modelInstalled?: unknown;
    };

    try {
      result = await response.json() as typeof result;
    } catch (error) {
      logDiagnostic("status-invalid-response", error, response.status);
      throw new Error("The AI backend returned invalid status.");
    }

    if (
      typeof result.provider !== "string" ||
      typeof result.model !== "string"
    ) {
      throw new Error("The AI backend returned invalid status.");
    }

    return {
      provider: result.provider,
      model: result.model,
      available: result.available === true,
      modelInstalled: result.modelInstalled === true
    };
  }
}

function logDiagnostic(
  event: string,
  error: unknown,
  status?: number,
  metadata?: Record<string, unknown>
): void {
  const err = error instanceof Error ? error : undefined;

  const cause = (err as (Error & { cause?: unknown }) | undefined)?.cause;

  const causeObject =
    cause && typeof cause === "object"
      ? cause as Record<string, unknown>
      : undefined;

  console.error(JSON.stringify({
    component: "ai-backend-client",
    event,
    status,
    errorName: err?.name ?? "Unknown",
    error: sanitizeDiagnostic(err?.message ?? "unknown error"),
    causeName: causeObject?.name,
    causeMessage:
      typeof causeObject?.message === "string"
        ? sanitizeDiagnostic(causeObject.message)
        : undefined,
    causeCode: causeObject?.code,
    causeErrno: causeObject?.errno,
    causeSyscall: causeObject?.syscall,
    causeAddress: causeObject?.address,
    causePort: causeObject?.port,
    ...metadata
  }));
}

function safeBackendOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "[invalid-url]";
  }
}

function sanitizeDiagnostic(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted]")
    .replace(
      /(?:api[-_ ]?key|token|secret|authorization)\s*[:=]\s*\S+/gi,
      "[redacted]"
    )
    .replace(/\b(?:secret|token|api[-_ ]?key)[A-Za-z0-9._-]*/gi, "[redacted]")
    .slice(0, 300);
}

async function readBackendError(
  response: Response
): Promise<string | undefined> {
  try {
    const body = await response.json() as BackendErrorResponse;

    return typeof body.error === "string" && body.error.length <= 300
      ? sanitizeDiagnostic(body.error)
      : undefined;
  } catch {
    return undefined;
  }
}
