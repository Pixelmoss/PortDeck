import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ServiceRegistry, sanitizeService } from "../server/services/registry.mjs";

test("sanitizeService normalizes user-controlled fields", () => {
  const service = sanitizeService({
    name: "  API  ",
    preferredPort: "8899",
    startCommand: " npm run dev ",
    autoRestart: true,
  });
  assert.equal(service.name, "API");
  assert.equal(service.preferredPort, 8899);
  assert.equal(service.startCommand, "npm run dev");
  assert.equal(service.autoRestart, true);
});

test("ServiceRegistry persists and reloads services", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-test-"));
  const filePath = path.join(directory, "services.json");
  const registry = new ServiceRegistry(filePath);
  await registry.load();
  const created = await registry.upsert({ name: "Web", startCommand: "npm run dev", preferredPort: 3000 });

  const reloaded = new ServiceRegistry(filePath);
  await reloaded.load();
  assert.equal(reloaded.find(created.id).name, "Web");
  assert.equal(reloaded.find(created.id).healthCheckEnabled, true);
  assert.equal(reloaded.find(created.id).protocol, "http");
  assert.equal(reloaded.find(created.id).desiredState, "stopped");
  assert.equal(reloaded.find(created.id).workspaceId, "default");
  assert.match(await readFile(filePath, "utf8"), /"version": 4/);
});

test("ServiceRegistry migrates v2 data and keeps a backup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-migration-test-"));
  const filePath = path.join(directory, "services.json");
  await writeFile(filePath, JSON.stringify({
    version: 2,
    services: [{ id: "svc_old", name: "Old", startCommand: "npm start" }],
  }));

  const registry = new ServiceRegistry(filePath);
  await registry.load();
  assert.equal(registry.find("svc_old").desiredState, "stopped");
  assert.equal((await registry.status()).backupCount, 1);
  assert.match(await readFile(filePath, "utf8"), /"version": 4/);
});

test("ServiceRegistry stores workspaces, preferences, audit history and import/export snapshots", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-v4-test-"));
  const registry = new ServiceRegistry(path.join(directory, "services.json"));
  await registry.load();
  const workspace = await registry.upsertWorkspace({ name: "Client A", color: "#112233" });
  const service = await registry.upsert({
    name: "API",
    startCommand: "npm start",
    workspaceId: workspace.id,
    group: "Backend",
    tags: ["api", "important", "api"],
    favorite: true,
  });
  await registry.updatePreferences({ locale: "en-US", notificationFrequency: "all" });
  await registry.recordAudit({ action: "start", serviceId: service.id, serviceName: service.name, outcome: "success" });
  await registry.recordAudit({ action: "stop", serviceId: service.id, serviceName: service.name, outcome: "blocked" });

  const snapshot = registry.exportSnapshot();
  assert.equal(snapshot.format, "portdeck-config");
  assert.equal(snapshot.services[0].favorite, true);
  assert.deepEqual(snapshot.services[0].tags, ["api", "important"]);
  assert.equal(registry.getPreferences().locale, "en-US");

  await registry.updatePreferences({ locale: "zh-CN" });
  assert.equal(registry.getPreferences().locale, "zh-CN");
  assert.equal(registry.listAudit()[0].action, "stop");
  assert.equal(registry.listAudit()[0].outcome, "blocked");

  const imported = new ServiceRegistry(path.join(directory, "imported.json"));
  await imported.load();
  await imported.importSnapshot(snapshot, { mode: "replace" });
  assert.equal(imported.find(service.id).group, "Backend");
  assert.ok(imported.listWorkspaces().some((item) => item.name === "Client A"));
});

test("ServiceRegistry restores the latest valid backup after corruption", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-recovery-test-"));
  const filePath = path.join(directory, "services.json");
  const registry = new ServiceRegistry(filePath);
  await registry.load();
  const service = await registry.upsert({ name: "Recover me", startCommand: "npm start" });
  await registry.createManualBackup();
  await writeFile(filePath, "{ definitely-not-json");

  const recovered = new ServiceRegistry(filePath);
  await recovered.load();
  assert.equal(recovered.find(service.id).name, "Recover me");
  const status = await recovered.status();
  assert.ok(status.recoveredFromBackup);
  assert.match(status.recoveryNotice, /已从备份/);
});
