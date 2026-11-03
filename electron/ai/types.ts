export type AIMessageRole = "user" | "assistant" | "tool";

export type AIToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AIMessage = {
  id: string;
  role: AIMessageRole;
  content: string;
  createdAt: string;
  toolCall?: AIToolCall;
  toolResult?: { name: string; ok: boolean; data?: unknown; error?: string };
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AIMessage[];
};

export type AIProviderRequest = {
  messages: AIMessage[];
  toolResults?: AIMessage[];
  tools?: AIToolDefinition[];
};

export type AIToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AIProviderResponse =
  | { type: "message"; content: string }
  | { type: "tool_call"; call: AIToolCall }
  | { type: "tool_calls"; calls: AIToolCall[] };

export interface AIProvider {
  readonly id: string;
  respond(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export type AIToolPermission = "read-only";
