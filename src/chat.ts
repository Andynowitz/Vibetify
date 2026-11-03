export function createOptimisticMessage(content: string): AIConversationMessage {
  return {
    id: `pending-${crypto.randomUUID()}`,
    role: "user",
    content,
    createdAt: new Date().toISOString()
  };
}

export function normalizeEscapedMarkdown(content: string): string {
  let normalized = content;
  if ((normalized.match(/\\\*\\\*/g) ?? []).length >= 2) normalized = normalized.replace(/\\\*\\\*/g, "**");
  if ((normalized.match(/\\_\\_/g) ?? []).length >= 2) normalized = normalized.replace(/\\_\\_/g, "__");
  normalized = normalized.replace(/(^|\n)\\(#{1,6})\s/g, "$1$2 ");
  normalized = normalized.replace(/(^|\n)\\---(?=\s|$)/g, "$1---");
  return normalized;
}
