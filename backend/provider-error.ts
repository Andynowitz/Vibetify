export type BackendProviderErrorKind = "authentication" | "rate_limit" | "invalid_request" | "not_found" | "server" | "network" | "timeout" | "invalid_response";

export class BackendProviderError extends Error {
  constructor(
    message: string,
    readonly kind: BackendProviderErrorKind,
    readonly status?: number,
    readonly providerMessage?: string,
    readonly providerType?: string,
    readonly providerCode?: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "BackendProviderError";
  }
}
