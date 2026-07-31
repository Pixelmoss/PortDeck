import { access, readFile } from "node:fs/promises";
import path from "node:path";

const FRAMEWORKS = [
  ["Next.js", /next-server|next dev|next start|[\"']next[\"']/],
  ["Vite", /\bvite\b/],
  ["Nuxt", /\bnuxt(?:i)?\b/],
  ["Astro", /\bastro\b/],
  ["Webpack", /\bwebpack\b/],
  ["FastAPI", /uvicorn|fastapi/],
  ["Flask", /\bflask\b/],
  ["Django", /django|manage\.py\s+runserver/],
  ["Rails", /\brails\b|\bpuma\b/],
  ["Docker", /docker|com\.docker/],
  ["Redis", /\bredis(?:-server)?\b/],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/],
  ["MySQL", /\bmysqld?\b/],
  ["Python", /python/],
  ["Node.js", /node|bun|deno/],
  ["Java", /\bjava\b/],
  ["Go", /go-build|\/go\//],
];

const PACKAGE_FRAMEWORKS = [
  ["Next.js", ["next"]],
  ["Nuxt", ["nuxt", "nuxt3"]],
  ["Astro", ["astro"]],
  ["Vite", ["vite"]],
  ["Webpack", ["webpack", "webpack-dev-server"]],
];

export function classifyService(service) {
  const haystack = `${service.processName || ""} ${service.command || ""}`.toLowerCase();
  return FRAMEWORKS.find(([, pattern]) => pattern.test(haystack))?.[0]
    || service.processName
    || "Unknown";
}

function displayPackageName(name, cwd) {
  const normalized = String(name || "").split("/").at(-1)?.trim();
  return normalized || path.basename(cwd || "") || "Untitled service";
}

function dependencyKind(manifest) {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  return PACKAGE_FRAMEWORKS.find(([, names]) => names.some((name) => dependencies[name]))?.[0] || "Node.js";
}

async function exists(filePath, accessImpl) {
  try {
    await accessImpl(filePath);
    return true;
  } catch {
    return false;
  }
}

async function packageManager(cwd, accessImpl) {
  if (await exists(path.join(cwd, "pnpm-lock.yaml"), accessImpl)) return "pnpm";
  if (await exists(path.join(cwd, "yarn.lock"), accessImpl)) return "yarn";
  if (await exists(path.join(cwd, "bun.lockb"), accessImpl) || await exists(path.join(cwd, "bun.lock"), accessImpl)) return "bun";
  return "npm";
}

function scriptCommand(manager, script) {
  if (manager === "yarn") return `yarn ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `${manager} run ${script}`;
}

function commandSuggestion(service) {
  const command = String(service.command || "").trim();
  const patterns = [
    /(?:^|\s)((?:npm|pnpm)\s+(?:run\s+)?(?:dev|start|serve)(?:\s+[^;&|]+)?)/i,
    /(?:^|\s)((?:yarn|bun)\s+(?:run\s+)?(?:dev|start|serve)(?:\s+[^;&|]+)?)/i,
    /(?:^|\s)((?:uvicorn|fastapi|flask)\s+[^;&|]+)/i,
    /(?:^|\s)(python(?:\d+(?:\.\d+)*)?\s+[^;&|]+\.py(?:\s+[^;&|]+)?)/i,
    /(?:^|\s)(docker\s+compose\s+up(?:\s+[^;&|]+)?)/i,
  ];
  return patterns.map((pattern) => command.match(pattern)?.[1]?.trim()).find(Boolean) || "";
}

async function readText(filePath, readFileImpl) {
  try {
    return await readFileImpl(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function recognizeService(service, {
  readFileImpl = readFile,
  accessImpl = access,
} = {}) {
  const cwd = service.cwd && path.isAbsolute(service.cwd) ? service.cwd : "";
  const fallbackKind = classifyService(service);
  const fallback = {
    name: service.name || displayPackageName("", cwd) || service.processName,
    kind: fallbackKind,
    suggestedStartCommand: commandSuggestion(service),
    confidence: "medium",
    signals: ["process-command"],
  };
  if (!cwd || cwd === "/") return fallback;

  const packageText = await readText(path.join(cwd, "package.json"), readFileImpl);
  if (packageText) {
    try {
      const manifest = JSON.parse(packageText);
      const scripts = manifest.scripts || {};
      const script = ["dev", "start", "serve"].find((name) => typeof scripts[name] === "string");
      const manager = await packageManager(cwd, accessImpl);
      return {
        name: displayPackageName(manifest.name, cwd),
        kind: dependencyKind(manifest),
        suggestedStartCommand: script ? scriptCommand(manager, script) : fallback.suggestedStartCommand,
        confidence: "high",
        signals: ["package.json", ...(script ? [`script:${script}`] : [])],
      };
    } catch {
      // A malformed project manifest must never make port scanning fail.
    }
  }

  const pythonManifest = await readText(path.join(cwd, "pyproject.toml"), readFileImpl)
    || await readText(path.join(cwd, "requirements.txt"), readFileImpl);
  if (pythonManifest) {
    const lower = pythonManifest.toLowerCase();
    const kind = lower.includes("fastapi") ? "FastAPI"
      : lower.includes("django") ? "Django"
        : lower.includes("flask") ? "Flask"
          : "Python";
    return {
      ...fallback,
      name: path.basename(cwd),
      kind,
      confidence: "high",
      signals: ["python-manifest"],
    };
  }

  const composeFile = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]
    .map((name) => path.join(cwd, name));
  for (const filePath of composeFile) {
    if (await exists(filePath, accessImpl)) {
      return {
        name: path.basename(cwd),
        kind: "Docker Compose",
        suggestedStartCommand: "docker compose up",
        confidence: "high",
        signals: [path.basename(filePath)],
      };
    }
  }

  return fallback;
}

export function isLikelyHttp(port, kind) {
  if (["Redis", "PostgreSQL", "MySQL"].includes(kind)) return false;
  return ![22, 25, 53, 110, 143, 445, 993, 995].includes(port);
}
