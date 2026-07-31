import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function clean(value, maxLength = 16_384) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeProcessIdentity(input = {}) {
  const pid = Number(input.pid);
  return {
    pid: Number.isInteger(pid) && pid > 1 ? pid : null,
    startedAt: clean(input.startedAt, 120),
    cwd: clean(input.cwd, 4096),
    command: clean(input.command),
  };
}

export function processIdentityMatches(expectedInput, actualInput) {
  const expected = normalizeProcessIdentity(expectedInput);
  const actual = normalizeProcessIdentity(actualInput);
  if (!expected.pid || expected.pid !== actual.pid) return false;

  // The kernel process start time is the strongest protection against PID reuse.
  if (expected.startedAt) {
    if (!actual.startedAt || expected.startedAt !== actual.startedAt) return false;
    if (expected.cwd && actual.cwd && expected.cwd !== actual.cwd) return false;
    return true;
  }

  // Older registry records do not have a start time. Fail closed unless both
  // stable fallback fields are present and still match.
  return Boolean(
    expected.cwd
    && actual.cwd
    && expected.command
    && actual.command
    && expected.cwd === actual.cwd
    && expected.command === actual.command,
  );
}

export function parsePsIdentity(output) {
  const tokens = String(output || "").trim().split(/\s+/);
  if (tokens.length < 7) return null;
  const pid = Number(tokens[0]);
  if (!Number.isInteger(pid) || pid <= 1) return null;
  return normalizeProcessIdentity({
    pid,
    startedAt: tokens.slice(1, 6).join(" "),
    command: tokens.slice(6).join(" "),
  });
}

function parseCwd(output) {
  const line = String(output || "").split("\n").find((item) => item.startsWith("n"));
  return line ? line.slice(1).trim() : "";
}

export async function readProcessIdentity(pid, { execFileImpl = execFileAsync } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  let psOutput = "";
  try {
    ({ stdout: psOutput } = await execFileImpl("/bin/ps", [
      "-ww",
      "-o",
      "pid=",
      "-o",
      "lstart=",
      "-o",
      "command=",
      "-p",
      String(pid),
    ], { timeout: 2500, maxBuffer: 1024 * 1024 }));
  } catch (error) {
    psOutput = error.stdout || "";
  }

  const identity = parsePsIdentity(psOutput);
  if (!identity) return null;

  try {
    const { stdout } = await execFileImpl("/usr/sbin/lsof", [
      "-a",
      "-d",
      "cwd",
      "-p",
      String(pid),
      "-Fn",
    ], { timeout: 2500, maxBuffer: 1024 * 1024 });
    identity.cwd = parseCwd(stdout);
  } catch (error) {
    identity.cwd = parseCwd(error.stdout);
  }
  return identity;
}
