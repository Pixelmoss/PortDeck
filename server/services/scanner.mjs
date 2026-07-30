import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

async function readCommands(pids) {
  if (!pids.length) return new Map();
  const { stdout } = await execFileAsync("/bin/ps", [
    "-ww",
    "-o",
    "pid=",
    "-o",
    "ppid=",
    "-o",
    "etime=",
    "-o",
    "command=",
    "-p",
    pids.join(","),
  ]);

  const rows = new Map();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    rows.set(Number(match[1]), {
      ppid: Number(match[2]),
      elapsed: match[3],
      command: match[4],
    });
  }
  return rows;
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
    ]);
    return parseCwdFields(stdout);
  } catch (error) {
    if (error.stdout) return parseCwdFields(error.stdout);
    return new Map();
  }
}

function classifyService(service) {
  const haystack = `${service.processName} ${service.command}`.toLowerCase();
  if (/next-server|next dev|next start/.test(haystack)) return "Next.js";
  if (/vite/.test(haystack)) return "Vite";
  if (/nuxt/.test(haystack)) return "Nuxt";
  if (/astro/.test(haystack)) return "Astro";
  if (/webpack/.test(haystack)) return "Webpack";
  if (/uvicorn|fastapi/.test(haystack)) return "FastAPI";
  if (/flask/.test(haystack)) return "Flask";
  if (/django|manage\.py runserver/.test(haystack)) return "Django";
  if (/rails|puma/.test(haystack)) return "Rails";
  if (/docker|com\.docker/.test(haystack)) return "Docker";
  if (/python/.test(haystack)) return "Python";
  if (/node|bun|deno/.test(haystack)) return "Node.js";
  if (/java/.test(haystack)) return "Java";
  if (/go-build|\/go\//.test(haystack)) return "Go";
  if (/redis/.test(haystack)) return "Redis";
  if (/postgres/.test(haystack)) return "PostgreSQL";
  if (/mysql/.test(haystack)) return "MySQL";
  return service.processName || "Unknown";
}

function friendlyName(service) {
  if (service.cwd && service.cwd !== "/") {
    return service.cwd.split("/").filter(Boolean).at(-1) || service.processName;
  }
  return service.processName;
}

function isLikelyHttp(port, kind) {
  if (["Redis", "PostgreSQL", "MySQL"].includes(kind)) return false;
  return ![22, 25, 53, 110, 143, 445, 993, 995].includes(port);
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
    ]));
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
    service.kind = classifyService(service);
    service.name = friendlyName(service);
    service.isHttp = isLikelyHttp(service.port, service.kind);
    service.url = service.isHttp ? `http://127.0.0.1:${service.port}` : null;
    service.visibility = classifyVisibility(service);
    unique.set(key, service);
  }

  return [...unique.values()].sort((a, b) => a.port - b.port);
}
