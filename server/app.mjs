import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "./services/catalog.mjs";
import { ServiceInspector } from "./services/inspector.mjs";
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
    healthy: services.filter((item) => item.health?.status === "healthy").length,
    unhealthy: services.filter((item) => item.health?.status === "unhealthy").length,
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
  version = "1.1.0",
  allowPortFallback = false,
  scanner = scanListeningServices,
  logger = console,
} = {}) {
  const registry = new ServiceRegistry(path.join(dataRoot, "services.json"));
  const processManager = new ProcessManager({
    logDirectory: path.join(dataRoot, "logs"),
    onRuntimeChange: async (event) => {
      const service = registry.find(event.serviceId);
      if (!service) return;
      if (event.type === "auto-restarted") {
        await registry.upsert({
          ...service,
          lastPid: event.pid,
          processIdentity: event.processIdentity,
          desiredState: "running",
          lastSeenAt: new Date().toISOString(),
        }, service.id);
      } else if (event.type === "exited") {
        await registry.upsert({
          ...service,
          lastPid: null,
          processIdentity: null,
          desiredState: !event.expected && event.autoRestart ? "running" : "stopped",
          lastSeenAt: event.exitedAt,
        }, service.id);
      }
    },
  });
  const inspector = new ServiceInspector();
  await registry.load();
  const recoveredProcesses = await processManager.recover(registry.list());
  const recoveredIds = new Set(recoveredProcesses.map((item) => item.serviceId));
  const startupScan = await scanner().catch((error) => {
    logger.error("Unable to scan services during recovery:", error);
    return [];
  });
  for (const service of registry.list()) {
    if (service.desiredState !== "running" || !service.autoRestart || recoveredIds.has(service.id)) continue;
    const occupied = service.preferredPort
      ? startupScan.find((item) => item.port === service.preferredPort)
      : null;
    if (occupied) {
      processManager.recordError(
        service.id,
        "startup-recovery",
        new Error(`端口 ${service.preferredPort} 已被 PID ${occupied.pid} 占用，未自动恢复服务`),
      );
      continue;
    }
    try {
      const result = await processManager.start(service);
      await registry.upsert({
        ...service,
        lastPid: result.pid,
        processIdentity: result.processIdentity,
        desiredState: "running",
        lastSeenAt: new Date().toISOString(),
      }, service.id);
    } catch (error) {
      logger.error(`Unable to restore ${service.name}:`, error);
    }
  }

  const startedAt = Date.now();
  let scanCache = { at: Date.now(), services: startupScan };
  let dashboardPort = port;
  const activeLogStreams = new Set();

  async function getCatalog({ fresh = false } = {}) {
    const now = Date.now();
    if (fresh || now - scanCache.at > 1500) {
      scanCache = { at: now, services: await scanner() };
    }
    const catalog = buildCatalog(registry.list(), scanCache.services, dashboardPort)
      .map((service) => {
        const runtime = processManager.snapshot(service.id);
        const ownership = service.source === "managed" && service.pid && runtime.managedPid === service.pid
          ? runtime.ownership
          : "external";
        return { ...service, ownership, runtime };
      });
    return inspector.decorate(catalog, { fresh });
  }

  async function streamLogs(request, response, serviceId) {
    if (!registry.find(serviceId)) return sendError(response, 404, "只有受管服务有运行日志");
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 1200\n\n");
    activeLogStreams.add(response);
    let previous = "";
    let reading = false;

    const sendUpdate = async () => {
      if (reading || response.destroyed) return;
      reading = true;
      try {
        const current = await processManager.readLog(serviceId);
        if (current === previous) return;
        const payload = current.startsWith(previous)
          ? { type: "append", text: current.slice(previous.length) }
          : { type: "reset", text: current };
        previous = current;
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (error) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      } finally {
        reading = false;
      }
    };

    await sendUpdate();
    const interval = setInterval(sendUpdate, 500);
    interval.unref?.();
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    heartbeat.unref?.();
    request.once("close", () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      activeLogStreams.delete(response);
    });
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

    if (request.method === "GET" && url.pathname === "/api/system/diagnostics") {
      const services = await getCatalog({ fresh: true });
      return sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        application: {
          name: "PortDeck",
          version,
          platform: process.platform,
          architecture: process.arch,
          node: process.version,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        },
        registry: await registry.status(),
        summary: summarize(services),
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          kind: service.kind,
          source: service.source,
          status: service.status,
          ownership: service.ownership,
          port: service.port || service.preferredPort || null,
          projectDirectory: service.cwd ? path.basename(service.cwd) : null,
          health: service.health ? {
            status: service.health.status,
            statusCode: service.health.statusCode || null,
            latencyMs: service.health.latencyMs || null,
            error: service.health.error || null,
          } : null,
          runtime: {
            operation: service.runtime.operation,
            ownership: service.runtime.ownership,
            recovered: service.runtime.recovered,
            autoRestartPending: service.runtime.autoRestartPending,
            lastExit: service.runtime.lastExit,
            lastError: service.runtime.lastError,
          },
        })),
        processManager: await processManager.diagnostics(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/system/backup") {
      const fileName = await registry.createManualBackup();
      return sendJson(response, 201, {
        ok: true,
        fileName,
        registry: await registry.status(),
      });
    }

    const logStreamMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/logs\/stream$/);
    if (logStreamMatch && request.method === "GET") {
      return streamLogs(request, response, decodeURIComponent(logStreamMatch[1]));
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
        const service = await registry.upsert({
          ...current,
          lastPid: result.pid,
          processIdentity: result.processIdentity,
          desiredState: "running",
          lastSeenAt: new Date().toISOString(),
        }, id);
        scanCache.at = 0;
        inspector.clear(id);
        return sendJson(response, 202, { ok: true, service, ...result });
      }

      if (action === "stop") {
        const result = current.source === "managed"
          ? await processManager.stop(current, current.pid, current.processIdentity)
          : await processManager.stopDiscovered(current.pid, current.processIdentity);
        if (current.source === "managed") {
          await registry.upsert({
            ...current,
            lastPid: null,
            processIdentity: null,
            desiredState: "stopped",
            lastSeenAt: new Date().toISOString(),
          }, id);
        }
        scanCache.at = 0;
        inspector.clear(id);
        return sendJson(response, 202, { ok: true, ...result });
      }

      if (action === "restart") {
        if (current.source !== "managed") return sendError(response, 400, "只有受管服务可以重启");
        const result = await processManager.restart(
          current,
          current.status === "running" ? current.pid : null,
          current.processIdentity,
        );
        const service = await registry.upsert({
          ...current,
          lastPid: result.pid,
          processIdentity: result.processIdentity,
          desiredState: "running",
          lastSeenAt: new Date().toISOString(),
        }, id);
        scanCache.at = 0;
        inspector.clear(id);
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
        "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: http://127.0.0.1:* https://127.0.0.1:* http://localhost:* https://localhost:*; connect-src 'self'; frame-ancestors 'none'",
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
        return sendError(
          response,
          error.statusCode || 500,
          error.message || "Internal server error",
          error.details,
        );
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
    inspector,
    recoveredProcesses,
    close: async () => {
      processManager.close();
      for (const response of activeLogStreams) response.end();
      activeLogStreams.clear();
      await closeServer(server);
    },
  };
}
