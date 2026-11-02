import { createHash, randomBytes } from "node:crypto";

export function createCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function createState(): string {
  return randomBytes(32).toString("base64url");
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isValidLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      Boolean(url.port) &&
      url.pathname === "/auth/callback" &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function isValidState(expected: string | undefined, received: string | null): boolean {
  return Boolean(expected && received && expected === received);
}
