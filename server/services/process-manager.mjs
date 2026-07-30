import { spawn } from "node:child_process";
import { open, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

function killPid(pid, signal = "SIGTERM") {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("Invalid process id");
  process.kill(pid, signal);
}

export class ProcessManager {
  constructor({ logDirectory }) {
    this.logDirectory = logDirectory;
    this.launched = new Map();
  }

  async start(service) {
    if (!service.startCommand) {
      const error = new Error("请先配置启动命令");
      error.statusCode = 400;
      throw error;
    }

    const cwd = service.cwd || process.cwd();
    await mkdir(this.logDirectory, { recursive: true });
    const logPath = path.join(this.logDirectory, `${service.id}.log`);
    const logHandle = await open(logPath, "a");
    await logHandle.write(`\n\n[${new Date().toISOString()}] Starting: ${service.startCommand}\n`);

    const child = spawn(service.startCommand, {
      cwd,
      shell: process.env.SHELL || "/bin/zsh",
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: {
        ...process.env,
        ...(service.preferredPort ? { PORT: String(service.preferredPort) } : {}),
      },
    });

    child.once("error", () => logHandle.close());
    child.once("exit", () => {
      this.launched.delete(service.id);
      logHandle.close();
    });
    child.unref();
    this.launched.set(service.id, child.pid);
    return { pid: child.pid, logPath };
  }

  async stop(service, runningPid) {
    if (service.stopCommand) {
      await new Promise((resolve, reject) => {
        const child = spawn(service.stopCommand, {
          cwd: service.cwd || process.cwd(),
          shell: process.env.SHELL || "/bin/zsh",
          stdio: "ignore",
        });
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`停止命令退出码：${code}`)));
        child.once("error", reject);
      });
      return { method: "command" };
    }

    const pid = this.launched.get(service.id) || runningPid || service.lastPid;
    if (!pid) {
      const error = new Error("没有找到正在运行的进程");
      error.statusCode = 404;
      throw error;
    }

    try {
      if (this.launched.get(service.id)) process.kill(-pid, "SIGTERM");
      else killPid(pid, "SIGTERM");
    } catch (error) {
      if (error.code === "ESRCH") return { method: "signal", alreadyStopped: true };
      throw error;
    }
    this.launched.delete(service.id);
    return { method: "signal", pid };
  }

  stopDiscovered(pid) {
    killPid(pid, "SIGTERM");
    return { method: "signal", pid };
  }

  async readLog(serviceId, maxBytes = 128 * 1024) {
    const logPath = path.join(this.logDirectory, `${serviceId}.log`);
    try {
      const buffer = await readFile(logPath);
      return buffer.subarray(Math.max(0, buffer.length - maxBytes)).toString("utf8");
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }
}
