import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyService, recognizeService } from "../server/services/recognizer.mjs";

test("classifyService recognizes common development runtimes", () => {
  assert.equal(classifyService({ processName: "node", command: "next dev" }), "Next.js");
  assert.equal(classifyService({ processName: "Python", command: "uvicorn api:app" }), "FastAPI");
  assert.equal(classifyService({ processName: "redis-server", command: "redis-server *:6379" }), "Redis");
});

test("recognizeService reads package metadata and suggests the right package manager", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "portdeck-recognizer-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({
    name: "@pixelmoss/dashboard",
    scripts: { dev: "vite --host" },
    devDependencies: { vite: "latest" },
  }));
  await writeFile(path.join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");

  const result = await recognizeService({ cwd, processName: "node", command: "node vite.js" });
  assert.equal(result.name, "dashboard");
  assert.equal(result.kind, "Vite");
  assert.equal(result.suggestedStartCommand, "pnpm run dev");
  assert.equal(result.confidence, "high");
  assert.deepEqual(result.signals, ["package.json", "script:dev"]);
});

test("recognizeService falls back to a portable process command suggestion", async () => {
  const result = await recognizeService({
    cwd: "",
    name: "API",
    processName: "Python",
    command: "/opt/python uvicorn api:app --port 8899",
  });
  assert.equal(result.kind, "FastAPI");
  assert.equal(result.suggestedStartCommand, "uvicorn api:app --port 8899");
});

test("recognizeService prefers the active Python project over an incidental Compose file", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "portdeck-python-recognizer-"));
  await writeFile(path.join(cwd, "pyproject.toml"), "dependencies = ['fastapi']");
  await writeFile(path.join(cwd, "compose.yml"), "services: {}");
  const result = await recognizeService({ cwd, processName: "Python", command: "uvicorn api:app" });
  assert.equal(result.kind, "FastAPI");
  assert.deepEqual(result.signals, ["python-manifest"]);
});
