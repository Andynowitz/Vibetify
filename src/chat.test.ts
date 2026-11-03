import { describe, expect, it } from "vitest";
import { createOptimisticMessage, normalizeEscapedMarkdown } from "./chat";

describe("chat markdown normalization", () => {
  it("creates an immediate user message without assistant content", () => {
    const message = createOptimisticMessage("Show my playlists");
    expect(message).toMatchObject({ role: "user", content: "Show my playlists" });
    expect(message.id).toMatch(/^pending-/);
  });

  it("normalizes paired escaped emphasis markers", () => {
    expect(normalizeEscapedMarkdown(String.raw`The **Spotify** API`)).toBe("The **Spotify** API");
    expect(normalizeEscapedMarkdown(String.raw`The \*\*Spotify\*\* API`)).toBe("The **Spotify** API");
  });

  it("normalizes escaped headings and separators only at line boundaries", () => {
    expect(normalizeEscapedMarkdown(String.raw`\# Heading
\---
text`)).toBe("# Heading\n---\ntext");
  });

  it("does not remove unrelated backslashes", () => {
    expect(normalizeEscapedMarkdown(String.raw`C:\music\track`)).toBe(String.raw`C:\music\track`);
  });
});
