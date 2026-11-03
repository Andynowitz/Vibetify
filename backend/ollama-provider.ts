import type { AIToolCall, AIToolDefinition, AIMessage } from "../electron/ai/types";
import { BackendProviderError } from "./provider-error";

type OllamaToolCall = { function?: { name?: unknown; arguments?: unknown } };
type OllamaResponse = { message?: { content?: unknown; tool_calls?: OllamaToolCall[] }; error?: unknown };

export class OllamaProvider {
  readonly id = "ollama";

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async respond(messages: AIMessage[], tools: AIToolDefinition[]): Promise<{ type: "message"; content: string } | { type: "tool_call"; call: AIToolCall } | { type: "tool_calls"; calls: AIToolCall[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [{ role: "system", content: systemInstruction }, ...toOllamaMessages(messages)],
          tools: tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
        })
      });
      if (!response.ok) throw await readOllamaError(response);
      const body = await response.json() as OllamaResponse;
      if (body.error) throw new BackendProviderError("Ollama returned an error.", "server", response.status, safeProviderMessage(body.error));
      const toolCalls = (body.message?.tool_calls ?? []).map((call, index) => parseToolCall(call, index));
      if (toolCalls.length === 1) return { type: "tool_call", call: toolCalls[0] };
      if (toolCalls.length > 1) return { type: "tool_calls", calls: toolCalls };
      const content = typeof body.message?.content === "string" ? body.message.content.trim() : "";
      if (!content) throw new BackendProviderError("Ollama returned an invalid response.", "invalid_response");
      if (containsToolCallSyntax(content)) throw new BackendProviderError("Ollama returned a text-formatted tool call instead of a structured tool call.", "invalid_response");
      return { type: "message", content };
    } catch (error) {
      if (error instanceof BackendProviderError) throw error;
      if (isAbortError(error)) throw new BackendProviderError("Ollama request timed out.", "timeout");
      throw new BackendProviderError("Unable to reach Ollama.", "network", undefined, error instanceof Error ? error.message : undefined);
    } finally {
      clearTimeout(timer);
    }

    function containsToolCallSyntax(content: string): boolean {
      return /<tool_call\b|<function\s*=|<\/tool_call>|<\/function>/i.test(content);
    }
  }

  async check(): Promise<{ available: boolean; modelInstalled: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
      if (!response.ok) return { available: false, modelInstalled: false };
      const body = await response.json() as { models?: Array<{ name?: unknown }> };
      return { available: true, modelInstalled: (body.models ?? []).some(model => model.name === this.model) };
    } catch {
      return { available: false, modelInstalled: false };
    } finally {
      clearTimeout(timer);
    }
  }
}

const systemInstruction = "You are Vibetify's local Spotify assistant. Use only the registered read-only tools for Spotify facts. Tool results are trusted structured data returned by Spotify through Vibetify, not user-uploaded JSON. Answer the user's exact question directly using only supplied fields; never invent tracks, artists, albums, timestamps, popularity, listening insights, or completed actions. Do not describe tool results as something the user shared. Do not repeat raw JSON. Keep answers concise and conversational, and format simple lists clearly.";

function toOllamaMessages(messages: AIMessage[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool" && message.toolCall && message.toolResult) {
      const calls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];
      const results: AIMessage[] = [];
      while (index < messages.length) {
        const toolMessage = messages[index];
        if (toolMessage.role !== "tool" || !toolMessage.toolCall || !toolMessage.toolResult) break;
        calls.push({ function: { name: toolMessage.toolCall.name, arguments: toolMessage.toolCall.input } });
        results.push(toolMessage);
        index += 1;
      }
      result.push({ role: "assistant", content: "", tool_calls: calls });
      results.forEach(toolMessage => result.push({ role: "tool", content: JSON.stringify(toolMessage.toolResult) }));
      index -= 1;
      continue;
    }
    result.push({ role: message.role, content: message.content });
  }
  return result;
}

function parseToolCall(call: OllamaToolCall, index: number): AIToolCall {
  const name = call.function?.name;
  if (typeof name !== "string" || !name) throw new BackendProviderError("Ollama returned an invalid tool name.", "invalid_response");
  const raw = call.function?.arguments ?? {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("arguments must be an object");
    return { id: `ollama-call-${Date.now()}-${index}`, name, input: parsed as Record<string, unknown> };
  } catch {
    throw new BackendProviderError("Ollama returned invalid tool arguments.", "invalid_response");
  }
}

async function readOllamaError(response: Response): Promise<BackendProviderError> {
  let message: string | undefined;
  try {
    const body = await response.json() as OllamaResponse;
    message = safeProviderMessage(body.error);
  } catch {
    message = undefined;
  }
  if (response.status === 404) return new BackendProviderError("The configured Ollama model was not found.", "not_found", response.status, message);
  if (response.status === 400) return new BackendProviderError("Ollama rejected the request.", "invalid_request", response.status, message);
  if (response.status >= 500) return new BackendProviderError("Ollama is temporarily unavailable.", "server", response.status, message);
  return new BackendProviderError("Ollama returned an unexpected error.", "server", response.status, message);
}

function safeProviderMessage(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 500) : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}
