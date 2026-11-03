import type { AIToolDefinition, AIToolPermission } from "./types";

export type RegisteredTool = {
  name: string;
  description: string;
  permission: AIToolPermission;
  inputSchema?: Record<string, unknown>;
  validate(input: unknown): Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) throw new Error(`AI tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  async execute(name: string, input: unknown): Promise<{ name: string; ok: boolean; data?: unknown; error?: string }> {
    const tool = this.tools.get(name);
    if (!tool) return { name, ok: false, error: "This AI tool is not available." };
    if (tool.permission !== "read-only") return { name, ok: false, error: "This tool is not permitted." };
    try {
      return { name, ok: true, data: await tool.execute(tool.validate(input)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The tool failed.";
      console.warn(JSON.stringify({ component: "ai-tool", event: "execution-failed", tool: name, error: message.slice(0, 300) }));
      return { name, ok: false, error: message };
    }
  }

  definitions(): AIToolDefinition[] {
    return [...this.tools.values()].map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false }
    }));
  }
}

export function noInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && Object.keys(input).length) throw new Error("This tool does not accept input.");
  return {};
}

export function optionalLimit(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return { limit: 8 };
  const value = (input as { limit?: unknown }).limit;
  if (value === undefined) return { limit: 8 };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20) throw new Error("Limit must be an integer from 1 to 20.");
  return { limit: value };
}
