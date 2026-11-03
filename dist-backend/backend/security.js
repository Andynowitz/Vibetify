"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixedWindowRateLimiter = exports.AccessTokenService = void 0;
const node_crypto_1 = require("node:crypto");
class AccessTokenService {
    secret;
    lifetimeSeconds;
    constructor(secret, lifetimeSeconds = 900) {
        this.secret = secret;
        this.lifetimeSeconds = lifetimeSeconds;
    }
    issue(subject) {
        const encode = (value) => Buffer.from(value).toString("base64url");
        const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
        const body = encode(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + this.lifetimeSeconds }));
        return `${header}.${body}.${this.sign(`${header}.${body}`)}`;
    }
    verify(header) {
        if (!header?.startsWith("Bearer "))
            return undefined;
        const parts = header.slice(7).split(".");
        if (parts.length !== 3 || !safeEqual(parts[2], this.sign(`${parts[0]}.${parts[1]}`)))
            return undefined;
        try {
            const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
            return typeof payload.sub === "string" && typeof payload.exp === "number" && payload.exp > Date.now() / 1000 ? payload.sub : undefined;
        }
        catch {
            return undefined;
        }
    }
    sign(value) {
        return (0, node_crypto_1.createHmac)("sha256", this.secret).update(value).digest("base64url");
    }
}
exports.AccessTokenService = AccessTokenService;
class FixedWindowRateLimiter {
    limit;
    windowMs;
    entries = new Map();
    constructor(limit, windowMs) {
        this.limit = limit;
        this.windowMs = windowMs;
    }
    allow(key) {
        const now = Date.now();
        const current = this.entries.get(key);
        if (!current || now - current.startedAt >= this.windowMs) {
            this.entries.set(key, { startedAt: now, count: 1 });
            return true;
        }
        if (current.count >= this.limit)
            return false;
        current.count += 1;
        return true;
    }
}
exports.FixedWindowRateLimiter = FixedWindowRateLimiter;
function safeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && (0, node_crypto_1.timingSafeEqual)(a, b);
}
