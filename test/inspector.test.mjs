import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHealthUrl,
  extractPageMetadata,
  probeHttpService,
  ServiceInspector,
} from "../server/services/inspector.mjs";

test("buildHealthUrl resolves a configured path against the service origin", () => {
  assert.equal(buildHealthUrl({ url: "http://127.0.0.1:3000/app", healthPath: "/api/health" }), "http://127.0.0.1:3000/api/health");
  assert.equal(buildHealthUrl({ url: "file:///tmp/demo" }), null);
  assert.equal(buildHealthUrl({ url: "http://127.0.0.1:3000", healthPath: "https://example.com/health" }), null);
});

test("extractPageMetadata reads title and favicon", () => {
  const result = extractPageMetadata(`<!doctype html><title> Demo &amp; API </title><link rel="icon" href="/logo.png">`, "http://127.0.0.1:3000/");
  assert.deepEqual(result, { title: "Demo & API", faviconUrl: "http://127.0.0.1:3000/logo.png" });
});

test("probeHttpService reports status, latency and page metadata", async () => {
  const result = await probeHttpService({
    status: "running",
    url: "http://127.0.0.1:3000",
    healthPath: "/",
  }, {
    fetchImpl: async () => new Response("<title>Local dashboard</title>", {
      status: 200,
      headers: { "content-type": "text/html", server: "test-server" },
    }),
    now: (() => {
      const values = [1_000, 1_005, 1_021];
      return () => values.shift() ?? 1_021;
    })(),
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.code, 200);
  assert.equal(result.latencyMs, 16);
  assert.equal(result.title, "Local dashboard");
  assert.equal(result.server, "test-server");
});

test("ServiceInspector caches probes until a fresh inspection is requested", async () => {
  let calls = 0;
  const inspector = new ServiceInspector({
    ttlMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    },
  });
  const service = { id: "svc", status: "running", url: "http://127.0.0.1:3000", healthPath: "/" };
  await inspector.inspect(service);
  await inspector.inspect(service);
  await inspector.inspect(service, { fresh: true });
  assert.equal(calls, 2);
});

test("probeHttpService truncates a large HTML response without blocking", async () => {
  const result = await probeHttpService({
    status: "running",
    url: "http://127.0.0.1:3000",
  }, {
    fetchImpl: async () => new Response(`<title>Large page</title>${"x".repeat(128 * 1024)}`, {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  assert.equal(result.status, "healthy");
  assert.equal(result.title, "Large page");
});

test("ServiceInspector has a hard timeout even when fetch ignores AbortSignal", async () => {
  const inspector = new ServiceInspector({
    timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  const result = await inspector.inspect({ id: "stuck", status: "running", url: "http://127.0.0.1:1" });
  assert.equal(result.status, "unhealthy");
  assert.match(result.error, /Timeout/);
  assert.ok(Date.now() - startedAt < 1000);
});
