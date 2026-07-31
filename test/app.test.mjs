import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { startPortDeckServer } from "../server/app.mjs";
import { isProcessAlive } from "../server/services/process-manager.mjs";

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("startPortDeckServer can be embedded on a dynamic port", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "portdeck-app-test-"));
  let instance;
  try {
    instance = await startPortDeckServer({
      port: 0,
      dataRoot,
      version: "1.0.0-test",
      scanner: async () => [],
      logger: { log() {}, error() {} },
    });
  } catch (error) {
    if (error.code === "EPERM") return t.skip("The current sandbox blocks local listening sockets");
    throw error;
  }
  t.after(() => instance.close());

  assert.ok(instance.port > 0);
  const health = await fetch(`${instance.url}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.version, "1.0.0-test");

  const html = await fetch(instance.url).then((response) => response.text());
  assert.match(html, /PortDeck · 本地服务控制台/);

  const backup = await fetch(`${instance.url}/api/system/backup`, { method: "POST" })
    .then((response) => response.json());
  assert.equal(backup.ok, true);
  const diagnostics = await fetch(`${instance.url}/api/system/diagnostics`)
    .then((response) => response.json());
  assert.equal(diagnostics.application.version, "1.0.0-test");
  assert.equal(diagnostics.registry.schemaVersion, 4);

  const capabilities = await fetch(`${instance.url}/api/capabilities`).then((response) => response.json());
  assert.ok(capabilities.capabilities.includes("risk-preview"));
  const templates = await fetch(`${instance.url}/api/templates`).then((response) => response.json());
  assert.equal(templates.templates.length, 4);

  const workspace = await fetch(`${instance.url}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Trading" }),
  }).then((response) => response.json());
  assert.equal(workspace.workspace.name, "Trading");

  const settings = await fetch(`${instance.url}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "en-US", notificationFrequency: "all" }),
  }).then((response) => response.json());
  assert.equal(settings.preferences.locale, "en-US");

  const exported = await fetch(`${instance.url}/api/system/export`).then((response) => response.json());
  assert.equal(exported.format, "portdeck-config");
  assert.ok(exported.workspaces.some((item) => item.name === "Trading"));
});

test("managed service logs are exposed as a real-time event stream", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "portdeck-stream-test-"));
  let instance;
  try {
    instance = await startPortDeckServer({
      port: 0,
      dataRoot,
      scanner: async () => [],
      logger: { log() {}, error() {} },
    });
  } catch (error) {
    if (error.code === "EPERM") return t.skip("The current sandbox blocks local listening sockets");
    throw error;
  }
  t.after(() => instance.close());

  const created = await fetch(`${instance.url}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Stream demo", startCommand: "npm start" }),
  }).then((response) => response.json());
  await instance.processManager.appendLog(created.service.id, "hello from stream\n");

  const controller = new AbortController();
  const response = await fetch(`${instance.url}/api/services/${created.service.id}/logs/stream`, { signal: controller.signal });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes("hello from stream")) {
    const { done, value } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  controller.abort();
  await reader.cancel().catch(() => {});
  assert.match(received, /"type":"append"/);
  assert.match(received, /hello from stream/);
});

test("managed service lifecycle exposes owned identity and stops safely", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "portdeck-lifecycle-test-"));
  let instance;
  try {
    instance = await startPortDeckServer({
      port: 0,
      dataRoot,
      scanner: undefined,
      logger: { log() {}, error() {} },
    });
  } catch (error) {
    if (error.code === "EPERM") return t.skip("The current sandbox blocks local listening sockets");
    throw error;
  }
  t.after(() => instance.close());

  const preferredPort = await findFreePort();
  const script = "import('node:http').then(({createServer}) => createServer((_,res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1'))";
  const created = await fetch(`${instance.url}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Lifecycle test",
      preferredPort,
      cwd: process.cwd(),
      startCommand: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      healthCheckEnabled: false,
    }),
  }).then((response) => response.json());

  let pid;
  try {
    const started = await fetch(`${instance.url}/api/services/${created.service.id}/start`, { method: "POST" })
      .then((response) => response.json());
    pid = started.pid;
    const running = await waitFor(async () => {
      const payload = await fetch(`${instance.url}/api/services?fresh=1`).then((response) => response.json());
      return payload.services.find((service) => service.id === created.service.id && service.status === "running");
    });
    assert.ok(running);
    assert.equal(running.ownership, "portdeck");
    assert.equal(running.processIdentity.pid, pid);
    assert.ok(running.processIdentity.startedAt);

    const stopped = await fetch(`${instance.url}/api/services/${created.service.id}/stop`, { method: "POST" })
      .then((response) => response.json());
    assert.equal(stopped.ok, true);
    assert.equal(isProcessAlive(pid), false);
    pid = null;
  } finally {
    if (isProcessAlive(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }
  }
});

test("service actions expose risk previews and require acknowledgement for risky commands", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "portdeck-risk-test-"));
  let instance;
  try {
    instance = await startPortDeckServer({ port: 0, dataRoot, scanner: async () => [], logger: { log() {}, error() {} } });
  } catch (error) {
    if (error.code === "EPERM") return t.skip("The current sandbox blocks local listening sockets");
    throw error;
  }
  t.after(() => instance.close());
  const created = await fetch(`${instance.url}/api/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Risky", startCommand: "sudo rm -rf ./cache" }),
  }).then((response) => response.json());
  const preview = await fetch(`${instance.url}/api/services/${created.service.id}/risk/start`).then((response) => response.json());
  assert.equal(preview.risk.severity, "critical");
  const blocked = await fetch(`${instance.url}/api/services/${created.service.id}/start`, { method: "POST" });
  assert.equal(blocked.status, 428);
  const audit = await fetch(`${instance.url}/api/audit`).then((response) => response.json());
  assert.equal(audit.entries[0].action, "start");
  assert.equal(audit.entries[0].outcome, "blocked");
});
