import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readJsonBody, RequestBodyError } from "./request-body";

class MockRequest extends EventEmitter {
  destroyed = false;
  setEncoding(): void {}
  resume(): void {}
}

function requestWith(chunks: string[]): MockRequest {
  const request = new MockRequest();
  queueMicrotask(() => {
    for (const chunk of chunks) request.emit("data", chunk);
    request.emit("end");
  });
  return request;
}

describe("backend request body handling", () => {
  it("parses valid JSON and reports its size", async () => {
    const sizes: number[] = [];
    await expect(readJsonBody(requestWith(['{"messages":[],"tools":[]}']), 1024, size => sizes.push(size)))
      .resolves.toEqual({ messages: [], tools: [] });
    expect(sizes.at(-1)).toBe(26);
  });

  it("returns a 413 error without destroying the client socket", async () => {
    const request = requestWith(["x".repeat(20)]);
    await expect(readJsonBody(request, 10)).rejects.toMatchObject<RequestBodyError>({ status: 413 });
    expect(request.destroyed).toBe(false);
  });

  it("returns a 400 error for malformed JSON", async () => {
    await expect(readJsonBody(requestWith(["not-json"]), 1024)).rejects.toMatchObject<RequestBodyError>({ status: 400 });
  });
});
