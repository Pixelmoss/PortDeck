import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPortDeckServer } from "../server/app.mjs";

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
