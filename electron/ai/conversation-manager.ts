import { promises as fs } from "node:fs";
import path from "node:path";
import type { Conversation, AIMessage } from "./types";

export class ConversationManager {
  private conversations: Conversation[] = [];
  private loaded = false;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as unknown;
      if (Array.isArray(parsed)) this.conversations = parsed.filter(isConversation);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("AI conversations could not be loaded.");
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.conversations));
  }

  async list(): Promise<Conversation[]> {
    await this.ensureLoaded();
    return this.conversations.map(conversation => ({ ...conversation, messages: [] }));
  }

  async get(id: string): Promise<Conversation | undefined> {
    await this.ensureLoaded();
    const conversation = this.conversations.find(item => item.id === id);
    return conversation ? cloneConversation(conversation) : undefined;
  }

  async create(): Promise<Conversation> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const conversation: Conversation = { id: crypto.randomUUID(), title: "New conversation", createdAt: now, updatedAt: now, messages: [] };
    this.conversations.unshift(conversation);
    await this.save();
    return cloneConversation(conversation);
  }

  async append(id: string, message: AIMessage): Promise<Conversation> {
    await this.ensureLoaded();
    const conversation = this.conversations.find(item => item.id === id);
    if (!conversation) throw new Error("Conversation was not found.");
    conversation.messages.push(message);
    conversation.updatedAt = message.createdAt;
    if (conversation.title === "New conversation" && message.role === "user") conversation.title = message.content.slice(0, 60);
    await this.save();
    return cloneConversation(conversation);
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();
    this.conversations = this.conversations.filter(conversation => conversation.id !== id);
    await this.save();
  }

  async runExclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(id, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Conversation>;
  return typeof item.id === "string" && typeof item.title === "string" && Array.isArray(item.messages);
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map(message => ({
      ...message,
      ...(message.toolCall ? { toolCall: { ...message.toolCall, input: { ...message.toolCall.input } } } : {}),
      ...(message.toolResult ? { toolResult: { ...message.toolResult } } : {})
    }))
  };
}
