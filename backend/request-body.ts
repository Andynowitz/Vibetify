import type { IncomingMessage } from "node:http";

export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export function readJsonBody(request: IncomingMessage, maxBodyBytes: number, onSize?: (size: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      if (settled) return;
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
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(data));
      } catch {
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
