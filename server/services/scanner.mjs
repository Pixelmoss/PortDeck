import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyService, isLikelyHttp, recognizeService } from "./recognizer.mjs";
import { normalizeProcessIdentity } from "./process-identity.mjs";

const execFileAsync = promisify(execFile);

function normalizeAddress(rawAddress) {
  const value = rawAddress.replace(/\s+\(LISTEN\)$/, "");
  const ipv6Match = value.match(/^\[(.*)]:(\d+)$/);
  if (ipv6Match) return { host: ipv6Match[1], port: Number(ipv6Match[2]) };

  const separator = value.lastIndexOf(":");
  if (separator === -1) return null;
  return {
    host: value.slice(0, separator),
    port: Number(value.slice(separator + 1)),
  };
}

export function parseLsofFields(output) {
  const services = [];
  let process = null;

  for (const line of output.split("\n")) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);

    if (field === "p") {
      process = { pid: Number(value), processName: "unknown" };
    } else if (field === "c" && process) {
      process.processName = value;
    } else if (field === "n" && process) {
      const address = normalizeAddress(value);
      if (!address || !Number.isInteger(address.port)) continue;
      services.push({ ...process, ...address });
    }
  }

  return services;
}

export function parseCwdFields(output) {
  const cwdByPid = new Map();
  let pid = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n") && pid) cwdByPid.set(pid, line.slice(1));
  }

  return cwdByPid;
}

export function parseProcessRows(output) {
  const rows = new Map();
  for (const line of String(output || "").split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 9) continue;
    const pid = Number(tokens[0]);
    const ppid = Number(tokens[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    rows.set(pid, {
      ppid,
      elapsed: tokens[2],
      startedAt: tokens.slice(3, 8).join(" "),
      command: tokens.slice(8).join(" "),
    });
  }
  return rows;
}

async function readCommands(pids) {
  if (!pids.length) return new Map();
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("/bin/ps", [
      "-ww",
      "-o",
      "pid=",
      "-o",
      "ppid=",
      "-o",
      "etime=",
      "-o",
      "lstart=",
      "-o",
      "command=",
      "-p",
      pids.join(","),
    ], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    stdout = error.stdout || "";
  }

  return parseProcessRows(stdout);
}

async function readWorkingDirectories(pids) {
  if (!pids.length) return new Map();
  try {
    const { stdout } = await execFileAsync("/usr/sbin/lsof", [
      "-a",
      "-d",
      "cwd",
      "-p",
      pids.join(","),
      "-Fn",
    ], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
    return parseCwdFields(stdout);
  } catch (error) {
    if (error.stdout) return parseCwdFields(error.stdout);
    return new Map();
  }
}

function friendlyName(service) {
  if (service.cwd && service.cwd !== "/") {
    return service.cwd.split("/").filter(Boolean).at(-1) || service.processName;
  }
  return service.processName;
}

function classifyVisibility(service) {
  const command = service.command || "";
  const hiddenProcessNames = new Set([
    "ControlCenter",
    "AirPlayXPCHelper",
    "rapportd",
    "sharingd",
    "identityservicesd",
    "WeChat",
    "QQ",
  ]);
  if (hiddenProcessNames.has(service.processName)) return "hidden";
  if (command.includes("/System/Library/") || command.includes("/usr/libexec/")) return "hidden";
  if (/\/(Applications|Library\/Containers)\/.*\.app\/Contents\//.test(command)) return "hidden";
  return "development";
}

export async function scanListeningServices() {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("/usr/sbin/lsof", [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fpcn",
    ], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    if (error.code === 1) return [];
    throw error;
  }

  const sockets = parseLsofFields(stdout);
  const pids = [...new Set(sockets.map((item) => item.pid))];
  const [commands, cwdByPid] = await Promise.all([
    readCommands(pids),
    readWorkingDirectories(pids),
  ]);

  const unique = new Map();
  for (const socket of sockets) {
    const key = `${socket.pid}:${socket.port}`;
    if (unique.has(key)) continue;
    const details = commands.get(socket.pid) || {};
    const service = {
      ...socket,
      ...details,
      cwd: cwdByPid.get(socket.pid) || "",
    };
    service.processIdentity = normalizeProcessIdentity(service);
    service.kind = classifyService(service);
    service.name = friendlyName(service);
    service.isHttp = isLikelyHttp(service.port, service.kind);
    service.url = service.isHttp ? `http://127.0.0.1:${service.port}` : null;
    service.visibility = classifyVisibility(service);
    unique.set(key, service);
  }

  const recognized = await Promise.all([...unique.values()].map(async (service) => {
    const recognition = await recognizeService(service);
    return {
      ...service,
      name: recognition.name || service.name,
      kind: recognition.kind || service.kind,
      suggestedStartCommand: recognition.suggestedStartCommand,
      recognition: {
        confidence: recognition.confidence,
        signals: recognition.signals,
      },
    };
  }));

  return recognized.sort((a, b) => a.port - b.port);
}
