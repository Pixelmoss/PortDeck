import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outputDirectory = path.resolve(process.argv[2] || "release");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const result = spawnSync("npm", ["sbom", "--sbom-format", "cyclonedx"], {
  cwd: projectRoot,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  throw new Error(`Unable to generate SBOM: ${String(result.stderr || result.stdout || "unknown error").trim()}`);
}

JSON.parse(result.stdout);
await mkdir(outputDirectory, { recursive: true });
const output = path.join(outputDirectory, `PortDeck-${packageJson.version}-sbom.cdx.json`);
await writeFile(output, result.stdout);
console.log(`Wrote ${output}`);
