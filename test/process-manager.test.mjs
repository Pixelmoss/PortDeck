import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isProcessAlive, ProcessManager } from "../server/services/process-manager.mjs";

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => {};
  child.kill = () => {};
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

test("isProcessAlive distinguishes an existing process from ESRCH", () => {
  assert.equal(isProcessAlive(42, () => {}), true);
  assert.equal(isProcessAlive(42, () => { const error = new Error(); error.code = "ESRCH"; throw error; }), false);
  assert.equal(isProcessAlive(1, () => {}), false);
});

test("ProcessManager rejects overlapping operations for one service", async () => {
  const manager = new ProcessManager({ logDirectory: "/tmp" });
  let release;
  const first = manager.runExclusive("svc", () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(manager.runExclusive("svc", async () => {}), /另一个操作/);
  release();
  await first;
  assert.equal(manager.snapshot("svc").operation, "idle");
});

test("ProcessManager gracefully stops a discovered process", async () => {
  let alive = true;
  const signals = [];
  const killImpl = (pid, signal) => {
    if (signal === 0) {
      if (!alive) { const error = new Error(); error.code = "ESRCH"; throw error; }
      return;
    }
    signals.push([pid, signal]);
    alive = false;
  };
  const manager = new ProcessManager({ logDirectory: "/tmp", killImpl, stopTimeoutMs: 10 });
  const result = await manager.stopDiscovered(321);
  assert.deepEqual(result, { method: "signal", pid: 321, forced: false });
  assert.deepEqual(signals, [[321, "SIGTERM"]]);
});

test("ProcessManager escalates to SIGKILL when graceful stop times out", async () => {
  let alive = true;
  const signals = [];
  const killImpl = (pid, signal) => {
    if (signal === 0) {
      if (!alive) { const error = new Error(); error.code = "ESRCH"; throw error; }
      return;
    }
    signals.push([pid, signal]);
    if (signal === "SIGKILL") alive = false;
  };
  const manager = new ProcessManager({ logDirectory: "/tmp", killImpl, stopTimeoutMs: 15, killTimeoutMs: 15 });
  const result = await manager.stopDiscovered(654);
  assert.equal(result.forced, true);
  assert.deepEqual(signals, [[654, "SIGTERM"], [654, "SIGKILL"]]);
});

test("ProcessManager tails logs without returning the entire file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-log-test-"));
  await writeFile(path.join(directory, "svc.log"), "0123456789");
  const manager = new ProcessManager({ logDirectory: directory });
  assert.equal(await manager.readLog("svc", 4), "6789");
  assert.equal(await manager.readLog("missing"), "");
});

test("ProcessManager restarts an auto-restart service after an unexpected exit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-restart-test-"));
  const children = [];
  const manager = new ProcessManager({
    logDirectory: directory,
    restartDelayMs: 5,
    spawnImpl: () => {
      const child = fakeChild(700 + children.length);
      children.push(child);
      return child;
    },
  });
  await manager.start({ id: "svc", name: "Demo", startCommand: "demo", autoRestart: true });
  children[0].emit("exit", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(children.length, 2);
  assert.equal(manager.snapshot("svc").managedPid, 701);
  manager.close();
});

test("ProcessManager starts and stops a real detached process group", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portdeck-real-process-test-"));
  const manager = new ProcessManager({ logDirectory: directory, stopTimeoutMs: 1500, killTimeoutMs: 500 });
  const service = {
    id: "real-process",
    name: "Real process",
    startCommand: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setInterval(() => {}, 1000)")}`,
  };
  let pid;
  try {
    ({ pid } = await manager.start(service));
    assert.equal(isProcessAlive(pid), true);
    const result = await manager.stop(service, pid);
    assert.equal(result.forced, false);
    assert.equal(isProcessAlive(pid), false);
  } finally {
    if (isProcessAlive(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }
    manager.close();
  }
});
