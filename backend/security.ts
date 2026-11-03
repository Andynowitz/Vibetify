import { createHmac, timingSafeEqual } from "node:crypto";

export class AccessTokenService {
  constructor(private readonly secret: string, private readonly lifetimeSeconds = 900) {}

  issue(subject: string): string {
    const encode = (value: string) => Buffer.from(value).toString("base64url");
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = encode(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + this.lifetimeSeconds }));
    return `${header}.${body}.${this.sign(`${header}.${body}`)}`;
  }

  verify(header: string | undefined): string | undefined {
    if (!header?.startsWith("Bearer ")) return undefined;
    const parts = header.slice(7).split(".");
    if (parts.length !== 3 || !safeEqual(parts[2], this.sign(`${parts[0]}.${parts[1]}`))) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
      return typeof payload.sub === "string" && typeof payload.exp === "number" && payload.exp > Date.now() / 1000 ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const current = this.entries.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
