"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendProviderError = void 0;
class BackendProviderError extends Error {
    kind;
    status;
    providerMessage;
    providerType;
    providerCode;
    requestId;
    constructor(message, kind, status, providerMessage, providerType, providerCode, requestId) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.providerMessage = providerMessage;
        this.providerType = providerType;
        this.providerCode = providerCode;
        this.requestId = requestId;
        this.name = "BackendProviderError";
    }
}
exports.BackendProviderError = BackendProviderError;
