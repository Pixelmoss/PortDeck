import { spawn } from "node:child_process";
import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
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

export class ProcessManager {
  constructor({
    logDirectory,
    stopTimeoutMs = 4000,
    killTimeoutMs = 1500,
    commandTimeoutMs = 12_000,
    restartDelayMs = 1200,
    spawnImpl = spawn,
    killImpl = process.kill,
  }) {
    this.logDirectory = logDirectory;
    this.stopTimeoutMs = stopTimeoutMs;
    this.killTimeoutMs = killTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.restartDelayMs = restartDelayMs;
    this.spawnImpl = spawnImpl;
    this.killImpl = killImpl;
    this.launched = new Map();
    this.operations = new Map();
    this.restartTimers = new Map();
    this.lastExit = new Map();
    this.shuttingDown = false;
  }

  logPath(serviceId) {
    return path.join(this.logDirectory, `${serviceId}.log`);
  }

  snapshot(serviceId) {
    const launched = this.launched.get(serviceId);
    return {
      operation: this.operations.has(serviceId) ? "busy" : "idle",
      managedPid: launched?.pid || null,
      autoRestartPending: this.restartTimers.has(serviceId),
      lastExit: this.lastExit.get(serviceId) || null,
    };
  }

  async runExclusive(serviceId, operation) {
    if (this.operations.has(serviceId)) throw httpError("服务正在执行另一个操作，请稍后再试", 409);
    const promise = Promise.resolve().then(operation);
    this.operations.set(serviceId, promise);
    try {
      return await promise;
    } finally {
      if (this.operations.get(serviceId) === promise) this.operations.delete(serviceId);
    }
  }

  async appendLog(serviceId, message) {
    await mkdir(this.logDirectory, { recursive: true });
    const handle = await open(this.logPath(serviceId), "a");
    try {
      await handle.write(message);
    } finally {
      await closeHandle(handle);
    }
  }

  async spawnService(service) {
    if (!service.startCommand) throw httpError("请先配置启动命令", 400);
    const tracked = this.launched.get(service.id);
    if (tracked && isProcessAlive(tracked.pid, this.killImpl)) throw httpError("服务已经由 PortDeck 启动", 409);

    const cwd = service.cwd || process.cwd();
    await mkdir(this.logDirectory, { recursive: true });
    const logPath = this.logPath(service.id);
    const logHandle = await open(logPath, "a");
    await logHandle.write(`\n\n[${new Date().toISOString()}] Starting: ${service.startCommand}\n`);

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
    const entry = { pid: child.pid, child, service: structuredClone(service), expectedStop: false };
    this.launched.set(service.id, entry);
    this.lastExit.delete(service.id);

    child.once("exit", (code, signal) => this.handleExit(service.id, entry, code, signal));
    child.once("error", (error) => {
      this.appendLog(service.id, `[${new Date().toISOString()}] Process error: ${error.message}\n`).catch(() => {});
    });
    return { pid: child.pid, logPath };
  }

  handleExit(serviceId, entry, code, signal) {
    if (this.launched.get(serviceId) !== entry) return;
    this.launched.delete(serviceId);
    const exitedAt = new Date().toISOString();
    this.lastExit.set(serviceId, { code, signal, exitedAt, expected: entry.expectedStop });
    this.appendLog(serviceId, `[${exitedAt}] Exited: code=${code ?? "null"} signal=${signal || "none"}\n`).catch(() => {});

    if (!entry.expectedStop && entry.service.autoRestart && !this.shuttingDown) {
      const timer = setTimeout(() => {
        this.restartTimers.delete(serviceId);
        this.start(entry.service).catch((error) => {
          this.appendLog(serviceId, `[${new Date().toISOString()}] Auto-restart failed: ${error.message}\n`).catch(() => {});
        });
      }, this.restartDelayMs);
      timer.unref?.();
      this.restartTimers.set(serviceId, timer);
    }
  }

  start(service) {
    return this.runExclusive(service.id, () => this.spawnService(service));
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

  async stopProcess(service, runningPid) {
    const restartTimer = this.restartTimers.get(service.id);
    if (restartTimer) clearTimeout(restartTimer);
    this.restartTimers.delete(service.id);

    const entry = this.launched.get(service.id);
    if (entry) entry.expectedStop = true;
    const pid = entry?.pid || runningPid || service.lastPid;

    if (service.stopCommand) {
      await this.runStopCommand(service);
      if (!pid || await waitForProcessExit(pid, { timeoutMs: this.stopTimeoutMs, killImpl: this.killImpl })) {
        this.launched.delete(service.id);
        return { method: "command", pid: pid || null, forced: false };
      }
    }

    if (!pid) throw httpError("没有找到正在运行的进程", 404);
    const group = Boolean(entry);
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
    return { method: service.stopCommand ? "command+signal" : "signal", pid, forced };
  }

  stop(service, runningPid) {
    return this.runExclusive(service.id, () => this.stopProcess(service, runningPid));
  }

  stopDiscovered(pid) {
    const id = `discovered:${pid}`;
    return this.runExclusive(id, async () => {
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
    });
  }

  restart(service, runningPid) {
    return this.runExclusive(service.id, async () => {
      if (runningPid || this.launched.has(service.id)) await this.stopProcess(service, runningPid);
      return this.spawnService(service);
    });
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

  close() {
    this.shuttingDown = true;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
  }
}
