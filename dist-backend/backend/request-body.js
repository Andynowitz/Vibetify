"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestBodyError = void 0;
exports.readJsonBody = readJsonBody;
class RequestBodyError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "RequestBodyError";
    }
}
exports.RequestBodyError = RequestBodyError;
function readJsonBody(request, maxBodyBytes, onSize) {
    return new Promise((resolve, reject) => {
        let size = 0;
        let data = "";
        let settled = false;
        request.setEncoding("utf8");
        request.on("data", chunk => {
            if (settled)
                return;
            size += Buffer.byteLength(chunk);
            onSize?.(size);
            if (size > maxBodyBytes) {
                settled = true;
                reject(new RequestBodyError(413, "Request is too large."));
                request.resume();
                return;
            }
            data += chunk;
        });
        request.on("end", () => {
            if (settled)
                return;
            settled = true;
            try {
                resolve(JSON.parse(data));
            }
            catch {
                reject(new RequestBodyError(400, "Request is invalid."));
            }
        });
        request.on("error", error => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
    });
}
