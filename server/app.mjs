import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "./services/catalog.mjs";
import { ServiceInspector } from "./services/inspector.mjs";
import { ProcessManager } from "./services/process-manager.mjs";
import { ServiceRegistry } from "./services/registry.mjs";
import { scanListeningServices } from "./services/scanner.mjs";
import { previewCommandRisk, riskForServiceAction } from "./services/risk.mjs";
import { listServiceTemplates } from "./services/templates.mjs";
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
  version = "1.5.0",
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

  async function executeServiceAction(current, action) {
    const id = current.id;
    if (action === "start") {
      if (current.source !== "managed") throw Object.assign(new Error("请先将发现的服务设为受管服务"), { statusCode: 400 });
      if (current.status === "running") throw Object.assign(new Error("服务已经在运行"), { statusCode: 409 });
      if (current.status === "conflict") {
        throw Object.assign(new Error(`端口 ${current.port} 已被 PID ${current.conflict.pid} 占用`), {
          statusCode: 409,
          details: current.conflict,
        });
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
      return { ok: true, service, ...result };
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
      return { ok: true, ...result };
    }

    if (action === "restart") {
      if (current.source !== "managed") throw Object.assign(new Error("只有受管服务可以重启"), { statusCode: 400 });
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
      return { ok: true, service, ...result };
    }
    throw Object.assign(new Error("不支持的服务操作"), { statusCode: 400 });
  }

  async function recordAction(current, action, outcome, message = "", source = "web") {
    await registry.recordAudit({
      action,
      serviceId: current?.id,
      serviceName: current?.name,
      outcome,
      message,
      source,
    }).catch((error) => logger.error("Unable to write audit record:", error));
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

    if (request.method === "GET" && url.pathname === "/api/capabilities") {
      return sendJson(response, 200, {
        version: 1,
        capabilities: [
          "service-discovery",
          "health-checks",
          "process-management",
          "log-streaming",
          "configuration-storage",
          "system-notifications",
          "login-launch",
          "workspaces",
          "audit-history",
          "risk-preview",
          "configuration-import-export",
        ],
      });
    }

    if (request.method === "GET" && url.pathname === "/api/templates") {
      return sendJson(response, 200, { templates: listServiceTemplates() });
    }

    if (request.method === "POST" && url.pathname === "/api/risk/preview") {
      const body = await readJson(request);
      return sendJson(response, 200, { risk: previewCommandRisk(body.command, { action: body.action }) });
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      return sendJson(response, 200, {
        preferences: registry.getPreferences(),
        workspaces: registry.listWorkspaces(),
      });
    }

    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const preferences = await registry.updatePreferences(await readJson(request));
      await registry.recordAudit({ action: "settings-update", outcome: "success", source: "web" });
      return sendJson(response, 200, { preferences, workspaces: registry.listWorkspaces() });
    }

    if (request.method === "GET" && url.pathname === "/api/audit") {
      return sendJson(response, 200, { entries: registry.listAudit({ limit: url.searchParams.get("limit") }) });
    }

    if (request.method === "GET" && url.pathname === "/api/workspaces") {
      return sendJson(response, 200, { workspaces: registry.listWorkspaces() });
    }

    if (request.method === "POST" && url.pathname === "/api/workspaces") {
      const workspace = await registry.upsertWorkspace(await readJson(request));
      await registry.recordAudit({ action: "workspace-create", outcome: "success", message: workspace.name, source: "web" });
      return sendJson(response, 201, { workspace });
    }

    const workspaceMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (workspaceMatch && request.method === "PUT") {
      const id = decodeURIComponent(workspaceMatch[1]);
      const workspace = await registry.upsertWorkspace(await readJson(request), id);
      return sendJson(response, 200, { workspace });
    }

    if (workspaceMatch && request.method === "DELETE") {
      const id = decodeURIComponent(workspaceMatch[1]);
      const removed = await registry.removeWorkspace(id);
      if (!removed) return sendError(response, 400, "默认工作区不能删除，或工作区不存在");
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/system/export") {
      return sendJson(response, 200, registry.exportSnapshot());
    }

    if (request.method === "POST" && url.pathname === "/api/system/import") {
      const body = await readJson(request);
      const result = await registry.importSnapshot(body.snapshot, { mode: body.mode === "replace" ? "replace" : "merge" });
      await registry.recordAudit({ action: "config-import", outcome: "success", message: result.mode, source: "web" });
      scanCache.at = 0;
      return sendJson(response, 200, { ok: true, ...result });
    }

    if (request.method === "GET" && url.pathname === "/api/services") {
      const services = await getCatalog({ fresh: url.searchParams.get("fresh") === "1" });
      return sendJson(response, 200, {
        services,
        summary: summarize(services),
        scannedAt: new Date(scanCache.at).toISOString(),
        preferences: registry.getPreferences(),
        workspaces: registry.listWorkspaces(),
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

    if (request.method === "POST" && url.pathname === "/api/services/bulk") {
      const body = await readJson(request);
      const ids = [...new Set(Array.isArray(body.ids) ? body.ids.map(String) : [])].slice(0, 50);
      const action = ["start", "stop", "restart"].includes(body.action) ? body.action : null;
      if (!ids.length || !action) return sendError(response, 400, "请选择服务和批量操作");
      const catalog = await getCatalog({ fresh: true });
      const targets = ids.map((id) => catalog.find((service) => service.id === id)).filter(Boolean);
      const risks = targets.map((service) => ({ serviceId: service.id, serviceName: service.name, ...riskForServiceAction(service, action) }));
      if (risks.some((risk) => risk.requiresAcknowledgement) && body.riskAcknowledged !== true) {
        await Promise.all(targets.map((service) => recordAction(
          service,
          `bulk-${action}`,
          "blocked",
          "等待用户确认命令风险",
          body.source || "web",
        )));
        return sendError(response, 428, "批量操作包含需要确认的命令", { risks });
      }
      const results = [];
      for (const service of targets) {
        try {
          const result = await executeServiceAction(service, action);
          await recordAction(service, `bulk-${action}`, "success", "", body.source || "web");
          results.push({ serviceId: service.id, ok: true, result });
        } catch (error) {
          await recordAction(service, `bulk-${action}`, "failure", error.message, body.source || "web");
          results.push({ serviceId: service.id, ok: false, error: error.message, statusCode: error.statusCode || 500 });
        }
      }
      return sendJson(response, 207, { ok: results.every((item) => item.ok), results });
    }

    const logStreamMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/logs\/stream$/);
    if (logStreamMatch && request.method === "GET") {
      return streamLogs(request, response, decodeURIComponent(logStreamMatch[1]));
    }

    const riskMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/risk\/(start|stop|restart)$/);
    if (riskMatch && request.method === "GET") {
      const id = decodeURIComponent(riskMatch[1]);
      const catalog = await getCatalog({ fresh: true });
      const current = catalog.find((item) => item.id === id);
      if (!current) return sendError(response, 404, "服务不存在或已经停止");
      return sendJson(response, 200, { risk: riskForServiceAction(current, riskMatch[2]) });
    }

    if (request.method === "POST" && url.pathname === "/api/services") {
      const body = await readJson(request);
      if (!body.startCommand) return sendError(response, 400, "启动命令不能为空");
      const service = await registry.upsert(body);
      await recordAction(service, "service-create", "success");
      scanCache.at = 0;
      return sendJson(response, 201, { service });
    }

    const serviceMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/);
    if (serviceMatch && request.method === "PUT") {
      const id = decodeURIComponent(serviceMatch[1]);
      if (!registry.find(id)) return sendError(response, 404, "服务不存在");
      const service = await registry.upsert(await readJson(request), id);
      await recordAction(service, "service-update", "success");
      scanCache.at = 0;
      return sendJson(response, 200, { service });
    }

    if (serviceMatch && request.method === "DELETE") {
      const id = decodeURIComponent(serviceMatch[1]);
      const current = registry.find(id);
      const removed = await registry.remove(id);
      if (!removed) return sendError(response, 404, "服务不存在");
      await recordAction(current, "service-remove", "success");
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
      const body = await readJson(request);
      const risk = riskForServiceAction(current, action);
      if (risk.requiresAcknowledgement && body.riskAcknowledged !== true) {
        await recordAction(current, action, "blocked", "等待用户确认命令风险", body.source || "web");
        return sendError(response, 428, "执行前需要确认风险", { risk });
      }
      try {
        const result = await executeServiceAction(current, action);
        await recordAction(current, action, "success", "", body.source || "web");
        return sendJson(response, 202, result);
      } catch (error) {
        await recordAction(current, action, "failure", error.message, body.source || "web");
        throw error;
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
