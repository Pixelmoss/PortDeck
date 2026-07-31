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

const REGISTRY_VERSION = 4;
const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_PREFERENCES = Object.freeze({
  locale: "zh-CN",
  onboardingComplete: false,
  notificationsEnabled: true,
  notificationFrequency: "important",
  crashReportingEnabled: false,
  sortBy: "status",
  sortDirection: "asc",
});

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

function cleanStringArray(value, { maxItems = 12, maxLength = 40 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function sanitizePreferences(input = {}, existing = {}) {
  const notificationFrequency = ["all", "important", "off"].includes(input.notificationFrequency)
    ? input.notificationFrequency
    : existing.notificationFrequency || DEFAULT_PREFERENCES.notificationFrequency;
  const sortBy = ["status", "name", "port", "workspace", "manual"].includes(input.sortBy)
    ? input.sortBy
    : existing.sortBy || DEFAULT_PREFERENCES.sortBy;
  return {
    locale: input.locale === "en-US" ? "en-US" : existing.locale === "en-US" ? "en-US" : "zh-CN",
    onboardingComplete: Boolean(input.onboardingComplete ?? existing.onboardingComplete),
    notificationsEnabled: Boolean(input.notificationsEnabled ?? existing.notificationsEnabled ?? true),
    notificationFrequency,
    crashReportingEnabled: Boolean(input.crashReportingEnabled ?? existing.crashReportingEnabled),
    sortBy,
    sortDirection: input.sortDirection === "desc" ? "desc" : existing.sortDirection === "desc" ? "desc" : "asc",
  };
}

function sanitizeWorkspace(input = {}, existing = {}) {
  return {
    id: existing.id || cleanString(input.id, 80) || `ws_${randomUUID()}`,
    name: cleanString(input.name, 80) || existing.name || "Workspace",
    color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : existing.color || "#65e6a7",
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : existing.order || 0,
    createdAt: existing.createdAt || cleanString(input.createdAt, 80) || new Date().toISOString(),
  };
}

function defaultWorkspace() {
  return sanitizeWorkspace({ id: DEFAULT_WORKSPACE_ID, name: "Default", color: "#65e6a7", order: 0 });
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
    workspaceId: cleanString(input.workspaceId, 80) || existing.workspaceId || DEFAULT_WORKSPACE_ID,
    group: cleanString(input.group, 80) || existing.group || "",
    tags: Object.hasOwn(input, "tags") ? cleanStringArray(input.tags) : cleanStringArray(existing.tags),
    favorite: Boolean(input.favorite ?? existing.favorite),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : Number(existing.order) || 0,
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
    this.workspaces = [defaultWorkspace()];
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.audit = [];
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
    const workspaces = Array.isArray(data.workspaces)
      ? data.workspaces.map((workspace) => sanitizeWorkspace(workspace, workspace))
      : [defaultWorkspace()];
    if (!workspaces.some((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)) workspaces.unshift(defaultWorkspace());
    const preferences = sanitizePreferences(data.preferences || {}, DEFAULT_PREFERENCES);
    const audit = Array.isArray(data.audit) ? data.audit.filter((entry) => entry && typeof entry === "object").slice(-500) : [];
    return { version, services, workspaces, preferences, audit };
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
    await writeFile(tempPath, JSON.stringify({
      version: REGISTRY_VERSION,
      services: this.services,
      workspaces: this.workspaces,
      preferences: this.preferences,
      audit: this.audit,
    }, null, 2));
    await rename(tempPath, this.filePath);
    this.loadedVersion = REGISTRY_VERSION;
  }

  async restoreLatestBackup() {
    for (const name of await this.listBackupFiles()) {
      try {
        const decoded = this.decode(await readFile(path.join(this.backupDirectory, name), "utf8"));
        this.services = decoded.services;
        this.workspaces = decoded.workspaces;
        this.preferences = decoded.preferences;
        this.audit = decoded.audit;
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
      this.workspaces = decoded.workspaces;
      this.preferences = decoded.preferences;
      this.audit = decoded.audit;
      this.loadedVersion = decoded.version;
      if (decoded.version < REGISTRY_VERSION) await this.save({ reason: `migrate-v${decoded.version}` });
    } catch (error) {
      if (error.code === "ENOENT") {
        this.services = [];
        this.workspaces = [defaultWorkspace()];
        this.preferences = { ...DEFAULT_PREFERENCES };
        this.audit = [];
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
          this.workspaces = [defaultWorkspace()];
          this.preferences = { ...DEFAULT_PREFERENCES };
          this.audit = [];
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

  getPreferences() {
    return structuredClone(this.preferences);
  }

  listWorkspaces() {
    return structuredClone(this.workspaces).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  listAudit({ limit = 100 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return structuredClone(this.audit.slice(-safeLimit).reverse());
  }

  async updatePreferences(input) {
    this.preferences = sanitizePreferences(input, this.preferences);
    await this.save({ reason: "preferences" });
    return this.getPreferences();
  }

  async upsertWorkspace(input, id = null) {
    const index = id ? this.workspaces.findIndex((item) => item.id === id) : -1;
    const existing = index >= 0 ? this.workspaces[index] : {};
    const workspace = sanitizeWorkspace({ ...input, ...(id ? { id } : {}) }, existing);
    if (index >= 0) this.workspaces[index] = workspace;
    else this.workspaces.push(workspace);
    await this.save({ reason: index >= 0 ? "workspace-update" : "workspace-create" });
    return structuredClone(workspace);
  }

  async removeWorkspace(id) {
    if (id === DEFAULT_WORKSPACE_ID) return false;
    const before = this.workspaces.length;
    this.workspaces = this.workspaces.filter((workspace) => workspace.id !== id);
    if (this.workspaces.length === before) return false;
    this.services = this.services.map((service) => service.workspaceId === id
      ? { ...service, workspaceId: DEFAULT_WORKSPACE_ID, updatedAt: new Date().toISOString() }
      : service);
    await this.save({ reason: "workspace-remove" });
    return true;
  }

  async recordAudit(entry) {
    this.audit.push({
      id: `audit_${randomUUID()}`,
      at: new Date().toISOString(),
      action: cleanString(entry.action, 80) || "unknown",
      serviceId: cleanString(entry.serviceId, 180) || null,
      serviceName: cleanString(entry.serviceName, 120) || null,
      outcome: ["success", "failure", "blocked"].includes(entry.outcome) ? entry.outcome : "success",
      message: cleanString(entry.message, 500) || "",
      source: ["web", "tray", "native", "system"].includes(entry.source) ? entry.source : "web",
    });
    if (this.audit.length > 500) this.audit.splice(0, this.audit.length - 500);
    await this.save({ reason: "audit", backup: false });
    return structuredClone(this.audit.at(-1));
  }

  exportSnapshot() {
    return {
      format: "portdeck-config",
      version: REGISTRY_VERSION,
      exportedAt: new Date().toISOString(),
      services: this.list(),
      workspaces: this.listWorkspaces(),
      preferences: this.getPreferences(),
    };
  }

  async importSnapshot(snapshot, { mode = "merge" } = {}) {
    if (!snapshot || snapshot.format !== "portdeck-config" || !Array.isArray(snapshot.services)) {
      throw new TypeError("PortDeck 配置文件格式无效");
    }
    const incomingServices = snapshot.services.map((service) => sanitizeService(service, service));
    const incomingWorkspaces = Array.isArray(snapshot.workspaces)
      ? snapshot.workspaces.map((workspace) => sanitizeWorkspace(workspace, workspace))
      : [defaultWorkspace()];
    if (mode === "replace") {
      this.services = incomingServices;
      this.workspaces = incomingWorkspaces;
    } else {
      const services = new Map(this.services.map((service) => [service.id, service]));
      incomingServices.forEach((service) => services.set(service.id, service));
      this.services = [...services.values()];
      const workspaces = new Map(this.workspaces.map((workspace) => [workspace.id, workspace]));
      incomingWorkspaces.forEach((workspace) => workspaces.set(workspace.id, workspace));
      this.workspaces = [...workspaces.values()];
    }
    if (!this.workspaces.some((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)) this.workspaces.unshift(defaultWorkspace());
    if (snapshot.preferences) this.preferences = sanitizePreferences(snapshot.preferences, this.preferences);
    await this.save({ reason: `import-${mode}` });
    return { serviceCount: this.services.length, workspaceCount: this.workspaces.length, mode };
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
      workspaceCount: this.workspaces.length,
      auditCount: this.audit.length,
      backupCount: (await this.listBackupFiles()).length,
      recoveredFromBackup: this.recoveredFromBackup,
      recoveryNotice: this.recoveryNotice,
    };
  }
}
