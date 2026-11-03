"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = exports.OpenAIProviderError = void 0;
const provider_error_1 = require("./provider-error");
class OpenAIProviderError extends provider_error_1.BackendProviderError {
    providerType;
    providerCode;
    requestId;
    constructor(message, kind, status, providerMessage, providerType, providerCode, requestId) {
        super(message, kind, status, providerMessage, providerType, providerCode, requestId);
        this.providerType = providerType;
        this.providerCode = providerCode;
        this.requestId = requestId;
        this.name = "OpenAIProviderError";
    }
}
exports.OpenAIProviderError = OpenAIProviderError;
class OpenAIProvider {
    apiKey;
    model;
    timeoutMs;
    constructor(apiKey, model, timeoutMs) {
        this.apiKey = apiKey;
        this.model = model;
        this.timeoutMs = timeoutMs;
    }
    async respond(messages, tools) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    model: this.model,
                    input: toOpenAIInput(messages),
                    tools: tools.map(tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema })),
                    tool_choice: "auto"
                })
            });
            if (!response.ok)
                throw await readProviderError(response);
            const body = await response.json();
            const output = body.output ?? [];
            const functionCall = output.find(item => item.type === "function_call" && item.name && item.call_id);
            if (functionCall?.name && functionCall.call_id) {
                let input = {};
                try {
                    const parsed = JSON.parse(functionCall.arguments ?? "{}");
                    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                        throw new Error("invalid arguments");
                    input = parsed;
                }
                catch {
                    throw new Error("OpenAI returned invalid tool arguments.");
                }
                return { type: "tool_call", call: { id: functionCall.call_id, name: functionCall.name, input } };
            }
            const text = output.flatMap(item => item.type === "message" ? (item.content ?? []).filter(part => part.type === "output_text").map(part => part.text ?? "") : []).join("").trim();
            if (!text)
                throw new Error("OpenAI returned an empty response.");
            return { type: "message", content: text };
        }
        catch (error) {
            if (error instanceof OpenAIProviderError)
                throw error;
            if (isAbortError(error)) {
                throw new OpenAIProviderError("OpenAI request timed out.", "timeout", undefined, undefined, undefined, undefined, undefined);
            }
            const providerMessage = error instanceof Error ? error.message : "The network request failed.";
            throw new OpenAIProviderError("Unable to reach OpenAI.", "network", undefined, providerMessage);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
exports.OpenAIProvider = OpenAIProvider;
async function readProviderError(response) {
    const provider = await readErrorBody(response);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (response.status === 401)
        return new OpenAIProviderError("OpenAI authorization failed.", "authentication", response.status, provider.message, provider.type, provider.code, requestId);
    if (response.status === 429)
        return new OpenAIProviderError("OpenAI is rate limited or quota is exhausted.", "rate_limit", response.status, provider.message, provider.type, provider.code, requestId);
    if (response.status === 400)
        return new OpenAIProviderError("OpenAI rejected the request.", "invalid_request", response.status, provider.message, provider.type, provider.code, requestId);
    if (response.status >= 500)
        return new OpenAIProviderError("OpenAI is temporarily unavailable.", "server", response.status, provider.message, provider.type, provider.code, requestId);
    return new OpenAIProviderError("OpenAI returned an unexpected error.", "server", response.status, provider.message, provider.type, provider.code, requestId);
}
async function readErrorBody(response) {
    try {
        const text = (await response.text()).slice(0, 8_192);
        try {
            const body = JSON.parse(text);
            return {
                message: typeof body.error?.message === "string" ? body.error.message : undefined,
                type: typeof body.error?.type === "string" ? body.error.type : undefined,
                code: typeof body.error?.code === "string" ? body.error.code : undefined
            };
        }
        catch {
            return { message: text || undefined };
        }
    }
    catch {
        return {};
    }
}
function isAbortError(error) {
    return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}
function toOpenAIInput(messages) {
    const input = [];
    for (const message of messages) {
        if (message.role === "tool" && message.toolCall && message.toolResult) {
            input.push({ type: "function_call", call_id: message.toolCall.id, name: message.toolCall.name, arguments: JSON.stringify(message.toolCall.input) }, { type: "function_call_output", call_id: message.toolCall.id, output: JSON.stringify(message.toolResult) });
            continue;
        }
        input.push({ role: message.role, content: message.content });
    }
    return input;
}
