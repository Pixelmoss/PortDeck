const MAX_PAGE_BYTES = 64 * 1024;

function cleanText(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function extractPageMetadata(html, baseUrl) {
  const title = cleanText(html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'"));
  const iconHref = html.match(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["']/i)?.[1];
  let faviconUrl = "";
  try {
    faviconUrl = new URL(iconHref || "/favicon.ico", baseUrl).href;
  } catch {
    // Invalid icon URLs are ignored.
  }
  return { title, faviconUrl };
}

export function buildHealthUrl(service) {
  if (!service?.url) return null;
  try {
    const base = new URL(service.url);
    if (!["http:", "https:"].includes(base.protocol)) return null;
    const healthPath = String(service.healthPath || "/").trim() || "/";
    const result = new URL(healthPath, `${base.origin}/`);
    return result.origin === base.origin ? result.href : null;
  } catch {
    return null;
  }
}

async function readLimitedText(response) {
  if (!response.body?.getReader) return (await response.text()).slice(0, MAX_PAGE_BYTES);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";
  try {
    while (received < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, Math.max(0, MAX_PAGE_BYTES - received));
      received += chunk.length;
      result += decoder.decode(chunk, { stream: true });
    }
  } finally {
    // Electron's bundled fetch may keep cancel() pending until the peer closes.
    // Fire-and-forget keeps a large or streaming page from blocking the catalog.
    reader.cancel().catch(() => {});
  }
  return result + decoder.decode();
}

export async function probeHttpService(service, {
  fetchImpl = fetch,
  timeoutMs = 1800,
  now = () => Date.now(),
} = {}) {
  const healthUrl = buildHealthUrl(service);
  const checkedAt = new Date(now()).toISOString();
  if (service.healthCheckEnabled === false) {
    return { status: "disabled", checkedAt, url: healthUrl, latencyMs: null, code: null, error: "" };
  }
  if (!healthUrl || service.status !== "running") {
    return { status: "unknown", checkedAt, url: healthUrl, latencyMs: null, code: null, error: "" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  const startedAt = now();
  try {
    const response = await fetchImpl(healthUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.5", "User-Agent": "PortDeck/1.0" },
    });
    const latencyMs = Math.max(0, now() - startedAt);
    const contentType = response.headers.get("content-type") || "";
    const html = contentType.includes("text/html") ? await readLimitedText(response) : "";
    const page = html ? extractPageMetadata(html, response.url || service.url) : { title: "", faviconUrl: "" };
    return {
      status: response.ok ? "healthy" : "unhealthy",
      checkedAt,
      url: healthUrl,
      latencyMs,
      code: response.status,
      error: response.ok ? "" : `HTTP ${response.status}`,
      server: cleanText(response.headers.get("server"), 80),
      ...page,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      checkedAt,
      url: healthUrl,
      latencyMs: Math.max(0, now() - startedAt),
      code: null,
      error: error.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : cleanText(error.message),
      title: "",
      faviconUrl: "",
      server: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export class ServiceInspector {
  constructor({ ttlMs = 5000, fetchImpl = fetch, timeoutMs = 1800 } = {}) {
    this.ttlMs = ttlMs;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
  }

  async inspect(service, { fresh = false } = {}) {
    const key = `${service.id}:${service.status}:${service.url || ""}:${service.healthPath || "/"}`;
    const cached = this.cache.get(key);
    if (!fresh && cached && Date.now() - cached.at < this.ttlMs) return cached.value;
    let timeout;
    const hardTimeout = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({
        status: service.healthCheckEnabled === false ? "disabled" : service.status === "running" ? "unhealthy" : "unknown",
        checkedAt: new Date().toISOString(),
        url: buildHealthUrl(service),
        latencyMs: this.timeoutMs,
        code: null,
        error: `Timeout after ${this.timeoutMs}ms`,
        title: "",
        faviconUrl: "",
        server: "",
      }), this.timeoutMs + 250);
    });
    const value = await Promise.race([
      probeHttpService(service, { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs }),
      hardTimeout,
    ]);
    clearTimeout(timeout);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async decorate(services, options) {
    return Promise.all(services.map(async (service) => ({
      ...service,
      health: await this.inspect(service, options),
    })));
  }

  clear(serviceId = null) {
    for (const key of this.cache.keys()) {
      if (!serviceId || key.startsWith(`${serviceId}:`)) this.cache.delete(key);
    }
  }
}
