import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog } from "../server/services/catalog.mjs";

const managed = [{
  id: "svc_one",
  name: "Managed app",
  preferredPort: 3000,
  cwd: "/tmp/app",
  startCommand: "npm run dev",
}];

test("buildCatalog attaches a running process to a managed service", () => {
  const catalog = buildCatalog(managed, [{
    pid: 42,
    port: 3000,
    cwd: "/tmp/app",
    processName: "node",
    command: "node server.js",
    kind: "Node.js",
    url: "http://127.0.0.1:3000",
  }], 4399);

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].status, "running");
  assert.equal(catalog[0].pid, 42);
  assert.equal(catalog[0].source, "managed");
});

test("buildCatalog reports a port conflict when another process owns the preferred port", () => {
  const catalog = buildCatalog([{ ...managed[0], cwd: "/tmp/expected" }], [{
    pid: 88,
    port: 3000,
    cwd: "/tmp/other",
    processName: "python",
    command: "python app.py",
    kind: "Python",
    url: "http://127.0.0.1:3000",
  }], 4399);

  const managedRow = catalog.find((item) => item.id === "svc_one");
  assert.equal(managedRow.status, "conflict");
  assert.equal(managedRow.conflict.pid, 88);
  assert.ok(catalog.some((item) => item.source === "discovered" && item.pid === 88));
});

test("buildCatalog hides PortDeck's own listener", () => {
  const catalog = buildCatalog([], [{ pid: 10, port: 4399, cwd: "/tmp", processName: "node" }], 4399);
  assert.deepEqual(catalog, []);
});
