import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "./services/catalog.mjs";
import { ProcessManager } from "./services/process-manager.mjs";
import { ServiceRegistry } from "./services/registry.mjs";
import { scanListeningServices } from "./services/scanner.mjs";
import {
  hasTrustedOrigin,
  isLocalRequest,
  readJson,
  sendError,
  sendJson,
} from "./lib/http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WEB_ROOT = path.join(ROOT, "web");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function summarize(services) {
  return {
    total: services.length,
    running: services.filter((item) => item.status === "running").length,
    managed: services.filter((item) => item.source === "managed").length,
    discovered: services.filter((item) => item.source === "discovered").length,
    conflicts: services.filter((item) => item.status === "conflict").length,
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startPortDeckServer({
  host = "127.0.0.1",
  port = 4399,
  dataRoot = path.join(ROOT, "data"),
  webRoot = DEFAULT_WEB_ROOT,
  version = "0.3.0",
  allowPortFallback = false,
  scanner = scanListeningServices,
  logger = console,
} = {}) {
  const registry = new ServiceRegistry(path.join(dataRoot, "services.json"));
  const processManager = new ProcessManager({ logDirectory: path.join(dataRoot, "logs") });
  await registry.load();

  const startedAt = Date.now();
  let scanCache = { at: 0, services: [] };
  let dashboardPort = port;

  async function getCatalog({ fresh = false } = {}) {
    const now = Date.now();
    if (fresh || now - scanCache.at > 1500) {
      scanCache = { at: now, services: await scanner() };
    }
    return buildCatalog(registry.list(), scanCache.services, dashboardPort);
  }

  async function handleApi(request, response, url) {
    if (!hasTrustedOrigin(request)) {
      return sendError(response, 403, "Blocked untrusted request origin");
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        name: "PortDeck",
        version,
        platform: process.platform,
        uptime: Math.round((Date.now() - startedAt) / 1000),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/services") {
      const services = await getCatalog({ fresh: url.searchParams.get("fresh") === "1" });
      return sendJson(response, 200, {
        services,
        summary: summarize(services),
        scannedAt: new Date(scanCache.at).toISOString(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/services") {
      const body = await readJson(request);
      if (!body.startCommand) return sendError(response, 400, "启动命令不能为空");
      const service = await registry.upsert(body);
      scanCache.at = 0;
      return sendJson(response, 201, { service });
    }

    const serviceMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/);
    if (serviceMatch && request.method === "PUT") {
      const id = decodeURIComponent(serviceMatch[1]);
      if (!registry.find(id)) return sendError(response, 404, "服务不存在");
      const service = await registry.upsert(await readJson(request), id);
      scanCache.at = 0;
      return sendJson(response, 200, { service });
    }

    if (serviceMatch && request.method === "DELETE") {
      const id = decodeURIComponent(serviceMatch[1]);
      const removed = await registry.remove(id);
      if (!removed) return sendError(response, 404, "服务不存在");
      scanCache.at = 0;
      return sendJson(response, 200, { ok: true });
    }

    const actionMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/(start|stop|restart|logs)$/);
    if (actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];

      if (action === "logs" && request.method === "GET") {
        if (!registry.find(id)) return sendError(response, 404, "只有受管服务有运行日志");
        return sendJson(response, 200, { logs: await processManager.readLog(id) });
      }

      if (request.method !== "POST") return sendError(response, 405, "Method not allowed");
      const catalog = await getCatalog({ fresh: true });
      const current = catalog.find((item) => item.id === id) || null;
      if (!current) return sendError(response, 404, "服务不存在或已经停止");

      if (action === "start") {
        if (current.source !== "managed") return sendError(response, 400, "请先将发现的服务设为受管服务");
        if (current.status === "running") return sendError(response, 409, "服务已经在运行");
        if (current.status === "conflict") {
          return sendError(response, 409, `端口 ${current.port} 已被 PID ${current.conflict.pid} 占用`, current.conflict);
        }
        const result = await processManager.start(current);
        const service = await registry.upsert({ ...current, lastPid: result.pid }, id);
        scanCache.at = 0;
        return sendJson(response, 202, { ok: true, service, ...result });
      }

      if (action === "stop") {
        const result = current.source === "managed"
          ? await processManager.stop(current, current.pid)
          : processManager.stopDiscovered(current.pid);
        scanCache.at = 0;
        return sendJson(response, 202, { ok: true, ...result });
      }

      if (action === "restart") {
        if (current.source !== "managed") return sendError(response, 400, "只有受管服务可以重启");
        if (current.status === "running") {
          await processManager.stop(current, current.pid);
          await new Promise((resolve) => setTimeout(resolve, 650));
        }
        const result = await processManager.start(current);
        const service = await registry.upsert({ ...current, lastPid: result.pid }, id);
        scanCache.at = 0;
        return sendJson(response, 202, { ok: true, service, ...result });
      }
    }

    return sendError(response, 404, "API route not found");
  }

  async function serveStatic(request, response, pathname) {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(webRoot, `.${requested}`);
    if (!filePath.startsWith(`${webRoot}${path.sep}`)) return sendError(response, 403, "Forbidden");

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      if (request.method === "HEAD") return response.end();
      response.end(body);
    } catch (error) {
      if (error.code === "ENOENT") return sendError(response, 404, "File not found");
      throw error;
    }
  }

  function createServer() {
    return http.createServer(async (request, response) => {
      try {
        if (!isLocalRequest(request)) return sendError(response, 403, "PortDeck only accepts local requests");
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
        if (request.method !== "GET" && request.method !== "HEAD") return sendError(response, 405, "Method not allowed");
        return await serveStatic(request, response, url.pathname);
      } catch (error) {
        logger.error(error);
        return sendError(response, error.statusCode || 500, error.message || "Internal server error");
      }
    });
  }

  let server = createServer();
  try {
    await listen(server, port, host);
  } catch (error) {
    if (!allowPortFallback || error.code !== "EADDRINUSE") throw error;
    server = createServer();
    await listen(server, 0, host);
  }

  dashboardPort = server.address().port;
  const url = `http://${host}:${dashboardPort}`;
  logger.log(`PortDeck is running at ${url}`);

  return {
    server,
    host,
    port: dashboardPort,
    url,
    dataRoot,
    registry,
    processManager,
    close: () => closeServer(server),
  };
}
