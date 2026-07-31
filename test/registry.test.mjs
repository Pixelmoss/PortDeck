import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
  assert.match(await readFile(filePath, "utf8"), /"version": 2/);
});
