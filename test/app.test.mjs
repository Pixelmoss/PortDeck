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
      version: "0.2.0-test",
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
  assert.equal(health.version, "0.2.0-test");

  const html = await fetch(instance.url).then((response) => response.text());
  assert.match(html, /PortDeck · 本地服务控制台/);
});
