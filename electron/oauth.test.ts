import { describe, expect, it } from "vitest";
import { createCodeChallenge, createCodeVerifier, createState, isValidLoopbackRedirect, isValidState } from "./oauth";

describe("Spotify OAuth helpers", () => {
  it("creates a verifier and a base64url SHA-256 challenge", () => {
    const verifier = createCodeVerifier();
    const challenge = createCodeChallenge(verifier);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });

  it("creates unpredictable state values", () => {
    expect(createState()).not.toBe(createState());
  });

  it("only accepts loopback callback URLs", () => {
    expect(isValidLoopbackRedirect("http://127.0.0.1:5173/auth/callback")).toBe(true);
    expect(isValidLoopbackRedirect("http://localhost:5173/auth/callback")).toBe(true);
    expect(isValidLoopbackRedirect("https://example.com/auth/callback")).toBe(false);
    expect(isValidLoopbackRedirect("http://127.0.0.1:5173/other")).toBe(false);
  });

  it("rejects missing or mismatched OAuth state", () => {
    expect(isValidState("expected", "expected")).toBe(true);
    expect(isValidState("expected", "wrong")).toBe(false);
    expect(isValidState(undefined, "expected")).toBe(false);
    expect(isValidState("expected", null)).toBe(false);
  });
});
