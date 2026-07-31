import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIB = 1024 * 1024;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));

const budgetsMiB = {
  arm64: { dmg: 100, zip: 110 },
  x64: { dmg: 105, zip: 115 },
  universal: { dmg: 165, zip: 180 },
};

function option(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function formatBytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB (${(bytes / MIB).toFixed(1)} MiB)`;
}

const arch = option("--arch") || process.arch;
if (!(arch in budgetsMiB)) {
  throw new Error(`Unsupported architecture: ${arch}. Expected arm64, x64, or universal.`);
}

const releaseDirectory = path.resolve(option("--release-dir") || path.join(projectRoot, "release"));
const environmentBudget = Number.parseFloat(process.env.PORTDECK_SIZE_BUDGET_MIB || "");
const artifactPrefix = `PortDeck-${packageJson.version}-${arch}`;
const artifacts = ["dmg", "zip"].map((extension) => ({
  extension,
  path: path.join(releaseDirectory, `${artifactPrefix}.${extension}`),
  budgetMiB: Number.isFinite(environmentBudget) ? environmentBudget : budgetsMiB[arch][extension],
}));

let failed = false;
console.log(`PortDeck ${packageJson.version} ${arch} package size check`);
for (const artifact of artifacts) {
  let size;
  try {
    size = (await stat(artifact.path)).size;
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Missing build artifact: ${artifact.path}`);
    throw error;
  }
  const budgetBytes = Math.round(artifact.budgetMiB * MIB);
  const withinBudget = size <= budgetBytes;
  failed ||= !withinBudget;
  console.log(`${withinBudget ? "PASS" : "FAIL"} ${path.basename(artifact.path)}: ${formatBytes(size)} / ${artifact.budgetMiB} MiB budget`);
}

if (failed) {
  console.error(`One or more ${arch} artifacts exceeded their bundle-size budget.`);
  process.exit(1);
}
