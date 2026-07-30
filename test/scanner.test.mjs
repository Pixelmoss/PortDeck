import test from "node:test";
import assert from "node:assert/strict";
import { parseCwdFields, parseLsofFields } from "../server/services/scanner.mjs";

test("parseLsofFields groups listening ports by process", () => {
  const output = [
    "p120",
    "cnode",
    "n127.0.0.1:3000",
    "n*:3001",
    "p220",
    "cPython",
    "n[::1]:8899",
  ].join("\n");

  assert.deepEqual(parseLsofFields(output), [
    { pid: 120, processName: "node", host: "127.0.0.1", port: 3000 },
    { pid: 120, processName: "node", host: "*", port: 3001 },
    { pid: 220, processName: "Python", host: "::1", port: 8899 },
  ]);
});

test("parseCwdFields maps working directories to process ids", () => {
  const result = parseCwdFields("p120\nn/tmp/app\np220\nn/Volumes/project\n");
  assert.equal(result.get(120), "/tmp/app");
  assert.equal(result.get(220), "/Volumes/project");
});
