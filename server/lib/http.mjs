const MAX_BODY_BYTES = 1024 * 1024;

export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export function sendError(response, status, message, details) {
  sendJson(response, status, {
    error: message,
    ...(details ? { details } : {}),
  });
}

export async function readJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

export function isLocalRequest(request) {
  const host = (request.headers.host || "").split(":")[0].toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

export function hasTrustedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
