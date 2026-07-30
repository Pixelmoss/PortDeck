import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function cleanString(value, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validatePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function sanitizeService(input, existing = {}) {
  const name = cleanString(input.name, 120) || existing.name || "Untitled service";
  const preferredPort = validatePort(input.preferredPort ?? input.port ?? existing.preferredPort);
  const now = new Date().toISOString();

  return {
    id: existing.id || `svc_${randomUUID()}`,
    name,
    kind: cleanString(input.kind, 80) || existing.kind || "Custom",
    cwd: cleanString(input.cwd) || existing.cwd || "",
    startCommand: cleanString(input.startCommand) || existing.startCommand || "",
    stopCommand: cleanString(input.stopCommand) || existing.stopCommand || "",
    preferredPort,
    healthPath: cleanString(input.healthPath, 240) || existing.healthPath || "/",
    notes: cleanString(input.notes, 2000) || existing.notes || "",
    autoRestart: Boolean(input.autoRestart ?? existing.autoRestart),
    lastPid: Number(input.lastPid ?? existing.lastPid) || null,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

export class ServiceRegistry {
  constructor(filePath) {
    this.filePath = filePath;
    this.services = [];
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.filePath, "utf8"));
      this.services = Array.isArray(data.services) ? data.services : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.services = [];
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
    await this.save();
    return structuredClone(service);
  }

  async remove(id) {
    const before = this.services.length;
    this.services = this.services.filter((item) => item.id !== id);
    if (this.services.length !== before) await this.save();
    return this.services.length !== before;
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify({ version: 1, services: this.services }, null, 2));
    await rename(tempPath, this.filePath);
  }
}
