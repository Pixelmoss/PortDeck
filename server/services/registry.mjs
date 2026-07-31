import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { normalizeProcessIdentity } from "./process-identity.mjs";

const REGISTRY_VERSION = 3;

function cleanString(value, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validatePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function validateProtocol(value, fallback = "http") {
  return value === "https" ? "https" : value === "http" ? "http" : fallback;
}

export function sanitizeService(input, existing = {}) {
  const name = cleanString(input.name, 120) || existing.name || "Untitled service";
  const preferredPort = validatePort(input.preferredPort ?? input.port ?? existing.preferredPort);
  const now = new Date().toISOString();

  const lastPidValue = Object.hasOwn(input, "lastPid") ? input.lastPid : existing.lastPid;
  const lastPid = Number(lastPidValue);
  const processIdentityInput = Object.hasOwn(input, "processIdentity")
    ? input.processIdentity
    : existing.processIdentity;
  const processIdentity = processIdentityInput
    ? normalizeProcessIdentity(processIdentityInput)
    : null;

  return {
    id: existing.id || `svc_${randomUUID()}`,
    name,
    kind: cleanString(input.kind, 80) || existing.kind || "Custom",
    cwd: cleanString(input.cwd) || existing.cwd || "",
    startCommand: cleanString(input.startCommand) || existing.startCommand || "",
    stopCommand: cleanString(input.stopCommand) || existing.stopCommand || "",
    preferredPort,
    protocol: validateProtocol(input.protocol, existing.protocol || "http"),
    healthPath: cleanString(input.healthPath, 240) || existing.healthPath || "/",
    healthCheckEnabled: Boolean(input.healthCheckEnabled ?? existing.healthCheckEnabled ?? true),
    notes: cleanString(input.notes, 2000) || existing.notes || "",
    autoRestart: Boolean(input.autoRestart ?? existing.autoRestart),
    lastPid: Number.isInteger(lastPid) && lastPid > 1 ? lastPid : null,
    processIdentity: processIdentity?.pid ? processIdentity : null,
    desiredState: (Object.hasOwn(input, "desiredState") ? input.desiredState : existing.desiredState) === "running"
      ? "running"
      : "stopped",
    lastSeenAt: cleanString(
      Object.hasOwn(input, "lastSeenAt") ? input.lastSeenAt : existing.lastSeenAt,
      80,
    ) || null,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

export class ServiceRegistry {
  constructor(filePath, { maxBackups = 10, now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.backupDirectory = path.join(path.dirname(filePath), "backups");
    this.maxBackups = maxBackups;
    this.now = now;
    this.services = [];
    this.loadedVersion = REGISTRY_VERSION;
    this.recoveredFromBackup = null;
    this.recoveryNotice = null;
    this.persistQueue = Promise.resolve();
  }

  decode(raw) {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !Array.isArray(data.services)) {
      throw new TypeError("服务注册表格式无效");
    }
    const version = Number(data.version) || 1;
    const services = data.services.map((service) => {
      const migrated = sanitizeService(service, service);
      migrated.createdAt = cleanString(service.createdAt, 80) || migrated.createdAt;
      migrated.updatedAt = cleanString(service.updatedAt, 80) || migrated.updatedAt;
      return migrated;
    });
    return { version, services };
  }

  async listBackupFiles() {
    try {
      return (await readdir(this.backupDirectory))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .reverse();
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async pruneBackups() {
    const files = await this.listBackupFiles();
    await Promise.all(files.slice(this.maxBackups).map((name) => (
      unlink(path.join(this.backupDirectory, name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      })
    )));
  }

  async backupCurrent(reason = "auto") {
    try {
      await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    await mkdir(this.backupDirectory, { recursive: true });
    const timestamp = this.now().toISOString().replace(/[:.]/g, "-");
    const fileName = `services-${timestamp}-${reason}-${randomUUID().slice(0, 8)}.json`;
    await copyFile(this.filePath, path.join(this.backupDirectory, fileName));
    await this.pruneBackups();
    return fileName;
  }

  async writePrimary() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify({ version: REGISTRY_VERSION, services: this.services }, null, 2));
    await rename(tempPath, this.filePath);
    this.loadedVersion = REGISTRY_VERSION;
  }

  async restoreLatestBackup() {
    for (const name of await this.listBackupFiles()) {
      try {
        const decoded = this.decode(await readFile(path.join(this.backupDirectory, name), "utf8"));
        this.services = decoded.services;
        this.loadedVersion = decoded.version;
        this.recoveredFromBackup = name;
        await this.writePrimary();
        return name;
      } catch {
        // Continue until a valid backup is found.
      }
    }
    return null;
  }

  async load() {
    try {
      const decoded = this.decode(await readFile(this.filePath, "utf8"));
      this.services = decoded.services;
      this.loadedVersion = decoded.version;
      if (decoded.version < REGISTRY_VERSION) await this.save({ reason: `migrate-v${decoded.version}` });
    } catch (error) {
      if (error.code === "ENOENT") {
        this.services = [];
      } else {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const corruptName = `services-corrupt-${this.now().toISOString().replace(/[:.]/g, "-")}.json`;
        const corruptPath = path.join(path.dirname(this.filePath), corruptName);
        await rename(this.filePath, corruptPath).catch(() => {});
        const restored = await this.restoreLatestBackup();
        this.recoveryNotice = restored
          ? `配置文件损坏，已从备份 ${restored} 恢复`
          : `配置文件损坏，已保留为 ${corruptName}；未找到可用备份`;
        if (!restored) {
          this.services = [];
          await this.writePrimary();
        }
      }
    }
    return this.list();
  }

  list() {
    return structuredClone(this.services);
  }

  find(id) {
    const service = this.services.find((item) => item.id === id);
    return service ? structuredClone(service) : null;
  }

  async upsert(input, id = null) {
    const index = id ? this.services.findIndex((item) => item.id === id) : -1;
    const existing = index >= 0 ? this.services[index] : {};
    const service = sanitizeService(input, existing);
    if (index >= 0) this.services[index] = service;
    else this.services.push(service);
    await this.save({ reason: index >= 0 ? "update" : "create" });
    return structuredClone(service);
  }

  async remove(id) {
    const before = this.services.length;
    this.services = this.services.filter((item) => item.id !== id);
    if (this.services.length !== before) await this.save({ reason: "remove" });
    return this.services.length !== before;
  }

  async save({ reason = "auto", backup = true } = {}) {
    const operation = this.persistQueue.catch(() => {}).then(async () => {
      if (backup) await this.backupCurrent(reason);
      await this.writePrimary();
    });
    this.persistQueue = operation;
    await operation;
  }

  async createManualBackup() {
    let fileName = null;
    const operation = this.persistQueue.catch(() => {}).then(async () => {
      if (!(await readFile(this.filePath, "utf8").catch(() => null))) await this.writePrimary();
      fileName = await this.backupCurrent("manual");
    });
    this.persistQueue = operation;
    await operation;
    return fileName;
  }

  async status() {
    return {
      schemaVersion: REGISTRY_VERSION,
      loadedVersion: this.loadedVersion,
      serviceCount: this.services.length,
      backupCount: (await this.listBackupFiles()).length,
      recoveredFromBackup: this.recoveredFromBackup,
      recoveryNotice: this.recoveryNotice,
    };
  }
}
