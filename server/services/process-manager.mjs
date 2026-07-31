import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  truncate,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  normalizeProcessIdentity,
  processIdentityMatches,
  readProcessIdentity,
} from "./process-identity.mjs";

function httpError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

export function isProcessAlive(pid, killImpl = process.kill) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    killImpl(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function waitForProcessExit(pid, {
  timeoutMs = 4000,
  intervalMs = 80,
  killImpl = process.kill,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid, killImpl)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return !isProcessAlive(pid, killImpl);
}

function signalPid(pid, signal, { group = false, killImpl = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) throw httpError("Invalid process id", 400);
  killImpl(group ? -pid : pid, signal);
}

function closeHandle(handle) {
  return handle?.close().catch(() => {});
}

function safeServiceId(serviceId) {
  return String(serviceId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
}

export class ProcessManager {
  constructor({
    logDirectory,
    stopTimeoutMs = 4000,
    killTimeoutMs = 1500,
    commandTimeoutMs = 12_000,
    restartDelayMs = 1200,
    monitorIntervalMs = 2000,
    maxLogBytes = 5 * 1024 * 1024,
    retainedLogFiles = 3,
    spawnImpl = spawn,
    killImpl = process.kill,
    inspectProcessImpl = readProcessIdentity,
    onRuntimeChange = () => {},
  }) {
    this.logDirectory = logDirectory;
    this.stopTimeoutMs = stopTimeoutMs;
    this.killTimeoutMs = killTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.restartDelayMs = restartDelayMs;
    this.monitorIntervalMs = monitorIntervalMs;
    this.maxLogBytes = maxLogBytes;
    this.retainedLogFiles = retainedLogFiles;
    this.spawnImpl = spawnImpl;
    this.killImpl = killImpl;
    this.inspectProcessImpl = inspectProcessImpl;
    this.onRuntimeChange = onRuntimeChange;
    this.launched = new Map();
    this.operations = new Map();
    this.logOperations = new Map();
    this.restartTimers = new Map();
    this.lastExit = new Map();
    this.recentErrors = [];
    this.monitorTimer = null;
    this.shuttingDown = false;
  }

  logPath(serviceId) {
    return path.join(this.logDirectory, `${safeServiceId(serviceId)}.log`);
  }

  snapshot(serviceId) {
    const launched = this.launched.get(serviceId);
    return {
      operation: this.operations.has(serviceId) ? "busy" : "idle",
      managedPid: launched?.pid || null,
      ownership: launched?.ownership || "external",
      recovered: Boolean(launched?.recovered),
      processIdentity: launched?.identity || null,
      autoRestartPending: this.restartTimers.has(serviceId),
      lastExit: this.lastExit.get(serviceId) || null,
      lastError: this.recentErrors.findLast?.((item) => item.serviceId === serviceId) || null,
    };
  }

  recordError(serviceId, operation, error) {
    this.recentErrors.push({
      serviceId,
      operation,
      message: error?.message || String(error),
      statusCode: error?.statusCode || 500,
      at: new Date().toISOString(),
    });
    if (this.recentErrors.length > 50) this.recentErrors.splice(0, this.recentErrors.length - 50);
  }

  async runExclusive(serviceId, operation, operationName = "operation") {
    if (this.operations.has(serviceId)) throw httpError("服务正在执行另一个操作，请稍后再试", 409);
    const promise = Promise.resolve().then(operation);
    this.operations.set(serviceId, promise);
    try {
      return await promise;
    } catch (error) {
      this.recordError(serviceId, operationName, error);
      throw error;
    } finally {
      if (this.operations.get(serviceId) === promise) this.operations.delete(serviceId);
    }
  }

  async withLogLock(serviceId, operation) {
    const previous = this.logOperations.get(serviceId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.logOperations.set(serviceId, current);
    try {
      return await current;
    } finally {
      if (this.logOperations.get(serviceId) === current) this.logOperations.delete(serviceId);
    }
  }

  async rotateLogIfNeeded(serviceId) {
    if (!this.maxLogBytes) return false;
    const logPath = this.logPath(serviceId);
    try {
      if ((await stat(logPath)).size < this.maxLogBytes) return false;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }

    if (this.retainedLogFiles <= 0) {
      await unlink(logPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
      return true;
    }
    for (let index = this.retainedLogFiles - 1; index >= 1; index -= 1) {
      await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await copyFile(logPath, `${logPath}.1`).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    // The child inherits an O_APPEND descriptor. Copy-truncating keeps that
    // descriptor attached to the active log while resetting its size.
    await truncate(logPath, 0).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return true;
  }

  async appendLog(serviceId, message) {
    await mkdir(this.logDirectory, { recursive: true });
    return this.withLogLock(serviceId, async () => {
      await this.rotateLogIfNeeded(serviceId);
      const handle = await open(this.logPath(serviceId), "a");
      try {
        await handle.write(message);
      } finally {
        await closeHandle(handle);
      }
    });
  }

  async inspectProcess(pid) {
    const identity = await this.inspectProcessImpl(pid);
    return identity ? normalizeProcessIdentity(identity) : null;
  }

  async assertProcessIdentity(pid, expectedInput) {
    const expected = expectedInput ? normalizeProcessIdentity(expectedInput) : null;
    const actual = await this.inspectProcess(pid);
    if (!expected || !actual || !processIdentityMatches(expected, actual)) {
      throw httpError(
        `PID ${pid} 的进程身份已经变化，PortDeck 已拒绝发送停止信号`,
        409,
        { reason: "process_identity_mismatch", expected, actual },
      );
    }
    return actual;
  }

  async spawnService(service) {
    if (!service.startCommand) throw httpError("请先配置启动命令", 400);
    const tracked = this.launched.get(service.id);
    if (tracked && isProcessAlive(tracked.pid, this.killImpl)) throw httpError("服务已经由 PortDeck 启动", 409);

    const cwd = service.cwd || process.cwd();
    await mkdir(this.logDirectory, { recursive: true });
    const logPath = this.logPath(service.id);
    const logHandle = await this.withLogLock(service.id, async () => {
      await this.rotateLogIfNeeded(service.id);
      const handle = await open(logPath, "a");
      await handle.write(`\n\n[${new Date().toISOString()}] Starting: ${service.startCommand}\n`);
      return handle;
    });

    let child;
    try {
      child = this.spawnImpl(service.startCommand, {
        cwd,
        shell: process.env.SHELL || "/bin/zsh",
        detached: true,
        stdio: ["ignore", logHandle.fd, logHandle.fd],
        env: {
          ...process.env,
          ...(service.preferredPort ? { PORT: String(service.preferredPort) } : {}),
        },
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      await closeHandle(logHandle);
      throw httpError(`启动失败：${error.message}`, 500);
    }

    await closeHandle(logHandle);
    child.unref();
    const identity = await this.inspectProcess(child.pid).catch(() => null)
      || normalizeProcessIdentity({ pid: child.pid, cwd, command: service.startCommand });
    const entry = {
      pid: child.pid,
      child,
      identity,
      ownership: "portdeck",
      recovered: false,
      service: structuredClone(service),
      expectedStop: false,
    };
    this.launched.set(service.id, entry);
    this.startRecoveryMonitor();
    this.lastExit.delete(service.id);

    child.once("exit", (code, signal) => this.handleExit(service.id, entry, code, signal));
    child.once("error", (error) => {
      this.appendLog(service.id, `[${new Date().toISOString()}] Process error: ${error.message}\n`).catch(() => {});
    });
    return { pid: child.pid, logPath, processIdentity: identity, ownership: "portdeck" };
  }

  handleExit(serviceId, entry, code, signal) {
    if (this.launched.get(serviceId) !== entry) return;
    this.launched.delete(serviceId);
    const exitedAt = new Date().toISOString();
    this.lastExit.set(serviceId, { code, signal, exitedAt, expected: entry.expectedStop });
    this.appendLog(serviceId, `[${exitedAt}] Exited: code=${code ?? "null"} signal=${signal || "none"}\n`).catch(() => {});
    if (!entry.suppressExitPersistence) {
      Promise.resolve(this.onRuntimeChange({
        type: "exited",
        serviceId,
        expected: entry.expectedStop,
        autoRestart: Boolean(entry.service.autoRestart),
        exitedAt,
      })).catch((error) => this.recordError(serviceId, "persist-exit", error));
    }

    if (!entry.expectedStop && entry.service.autoRestart && !this.shuttingDown) {
      const timer = setTimeout(() => {
        this.restartTimers.delete(serviceId);
        this.start(entry.service)
          .then((result) => this.onRuntimeChange({
            type: "auto-restarted",
            serviceId,
            pid: result.pid,
            processIdentity: result.processIdentity,
          }))
          .catch((error) => {
            this.appendLog(serviceId, `[${new Date().toISOString()}] Auto-restart failed: ${error.message}\n`).catch(() => {});
          });
      }, this.restartDelayMs);
      timer.unref?.();
      this.restartTimers.set(serviceId, timer);
    }
  }

  start(service) {
    return this.runExclusive(service.id, () => this.spawnService(service), "start");
  }

  async runStopCommand(service) {
    const child = this.spawnImpl(service.stopCommand, {
      cwd: service.cwd || process.cwd(),
      shell: process.env.SHELL || "/bin/zsh",
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(httpError(`停止命令超过 ${this.commandTimeoutMs}ms 未完成`, 504));
      }, this.commandTimeoutMs);
      timeout.unref?.();
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        code === 0 ? resolve() : reject(httpError(`停止命令退出码：${code}`, 500));
      });
    });
  }

  async stopProcess(service, runningPid, processIdentity = null) {
    const restartTimer = this.restartTimers.get(service.id);
    if (restartTimer) clearTimeout(restartTimer);
    this.restartTimers.delete(service.id);

    const entry = this.launched.get(service.id);
    if (entry) entry.expectedStop = true;
    const pid = entry?.pid || runningPid || service.lastPid;
    if (!pid) throw httpError("没有找到正在运行的进程", 404);

    if (!entry?.child || entry.identity?.startedAt) {
      await this.assertProcessIdentity(pid, entry?.identity || processIdentity || service.processIdentity);
    }

    if (service.stopCommand) {
      await this.runStopCommand(service);
      if (!pid || await waitForProcessExit(pid, { timeoutMs: this.stopTimeoutMs, killImpl: this.killImpl })) {
        this.launched.delete(service.id);
        return { method: "command", pid: pid || null, forced: false };
      }
    }

    const group = Boolean(entry && ["portdeck", "recovered"].includes(entry.ownership));
    try {
      signalPid(pid, "SIGTERM", { group, killImpl: this.killImpl });
    } catch (error) {
      if (error.code === "ESRCH") {
        this.launched.delete(service.id);
        return { method: "signal", pid, alreadyStopped: true, forced: false };
      }
      throw error;
    }

    let exited = await waitForProcessExit(pid, { timeoutMs: this.stopTimeoutMs, killImpl: this.killImpl });
    let forced = false;
    if (!exited) {
      forced = true;
      try {
        signalPid(pid, "SIGKILL", { group, killImpl: this.killImpl });
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      exited = await waitForProcessExit(pid, { timeoutMs: this.killTimeoutMs, killImpl: this.killImpl });
    }
    this.launched.delete(service.id);
    if (!exited) throw httpError(`无法停止 PID ${pid}`, 500);
    return {
      method: service.stopCommand ? "command+signal" : "signal",
      pid,
      forced,
      ownership: entry?.ownership || "external",
    };
  }

  stop(service, runningPid, processIdentity = null) {
    return this.runExclusive(
      service.id,
      () => this.stopProcess(service, runningPid, processIdentity),
      "stop",
    );
  }

  stopDiscovered(pid, processIdentity) {
    const id = `discovered:${pid}`;
    return this.runExclusive(id, async () => {
      await this.assertProcessIdentity(pid, processIdentity);
      try {
        signalPid(pid, "SIGTERM", { killImpl: this.killImpl });
      } catch (error) {
        if (error.code === "ESRCH") return { method: "signal", pid, alreadyStopped: true, forced: false };
        throw error;
      }
      let exited = await waitForProcessExit(pid, { timeoutMs: this.stopTimeoutMs, killImpl: this.killImpl });
      let forced = false;
      if (!exited) {
        forced = true;
        signalPid(pid, "SIGKILL", { killImpl: this.killImpl });
        exited = await waitForProcessExit(pid, { timeoutMs: this.killTimeoutMs, killImpl: this.killImpl });
      }
      if (!exited) throw httpError(`无法停止 PID ${pid}`, 500);
      return { method: "signal", pid, forced };
    }, "stop-discovered");
  }

  restart(service, runningPid, processIdentity = null) {
    return this.runExclusive(service.id, async () => {
      if (runningPid || this.launched.has(service.id)) {
        const entry = this.launched.get(service.id);
        if (entry) entry.suppressExitPersistence = true;
        await this.stopProcess(service, runningPid, processIdentity);
      }
      return this.spawnService(service);
    }, "restart");
  }

  async recover(services) {
    const recovered = [];
    for (const service of services) {
      if (!service.lastPid || !service.processIdentity || service.desiredState !== "running") continue;
      const actual = await this.inspectProcess(service.lastPid).catch(() => null);
      if (!actual || !processIdentityMatches(service.processIdentity, actual)) continue;
      const entry = {
        pid: service.lastPid,
        child: null,
        identity: actual,
        ownership: "recovered",
        recovered: true,
        service: structuredClone(service),
        expectedStop: false,
      };
      this.launched.set(service.id, entry);
      recovered.push({ serviceId: service.id, pid: service.lastPid, processIdentity: actual });
    }
    if (recovered.length) this.startRecoveryMonitor();
    return recovered;
  }

  startRecoveryMonitor() {
    if (this.monitorTimer || !this.monitorIntervalMs) return;
    this.monitorTimer = setInterval(() => this.monitorRecoveredProcesses().catch((error) => {
      this.recordError("system", "recovery-monitor", error);
    }), this.monitorIntervalMs);
    this.monitorTimer.unref?.();
  }

  async monitorRecoveredProcesses() {
    for (const [serviceId, entry] of this.launched) {
      await this.withLogLock(serviceId, () => this.rotateLogIfNeeded(serviceId));
      if (!entry.recovered || entry.expectedStop) continue;
      const actual = await this.inspectProcess(entry.pid).catch(() => null);
      if (actual && processIdentityMatches(entry.identity, actual)) continue;
      this.handleExit(serviceId, entry, null, "process-lost");
    }
  }

  async readLog(serviceId, maxBytes = 256 * 1024) {
    const logPath = this.logPath(serviceId);
    let metadata;
    try {
      metadata = await stat(logPath);
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
    const length = Math.min(metadata.size, maxBytes);
    if (!length) return "";
    const handle = await open(logPath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, metadata.size - length);
      return buffer.toString("utf8");
    } finally {
      await closeHandle(handle);
    }
  }

  async diagnostics() {
    let files = [];
    try {
      files = await readdir(this.logDirectory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const logs = [];
    for (const name of files.filter((item) => item.endsWith(".log") || /\.log\.\d+$/.test(item))) {
      const metadata = await stat(path.join(this.logDirectory, name)).catch(() => null);
      if (metadata) logs.push({ name, bytes: metadata.size, modifiedAt: metadata.mtime.toISOString() });
    }
    return {
      trackedProcesses: [...this.launched.entries()].map(([serviceId, entry]) => ({
        serviceId,
        pid: entry.pid,
        ownership: entry.ownership,
        recovered: entry.recovered,
      })),
      recentErrors: structuredClone(this.recentErrors),
      logs,
      logPolicy: { maxBytes: this.maxLogBytes, retainedFiles: this.retainedLogFiles },
    };
  }

  close() {
    this.shuttingDown = true;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
  }
}
