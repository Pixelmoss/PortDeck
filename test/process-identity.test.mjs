import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePsIdentity,
  processIdentityMatches,
} from "../server/services/process-identity.mjs";

test("parsePsIdentity extracts pid, start time and command", () => {
  assert.deepEqual(
    parsePsIdentity("  123 Thu Jul 31 10:00:00 2026 node server.js --port 3000\n"),
    {
      pid: 123,
      startedAt: "Thu Jul 31 10:00:00 2026",
      cwd: "",
      command: "node server.js --port 3000",
    },
  );
});

test("processIdentityMatches rejects pid reuse even when cwd is unchanged", () => {
  const expected = {
    pid: 123,
    startedAt: "Thu Jul 31 10:00:00 2026",
    cwd: "/tmp/app",
    command: "node server.js",
  };
  assert.equal(processIdentityMatches(expected, expected), true);
  assert.equal(processIdentityMatches(expected, {
    ...expected,
    startedAt: "Thu Jul 31 11:00:00 2026",
  }), false);
});
