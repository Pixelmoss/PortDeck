import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = process.env.PORTDECK_BUILD_OUTPUT_DIR
  ? path.resolve(process.env.PORTDECK_BUILD_OUTPUT_DIR)
  : path.join(projectRoot, "release");
const stageRoot = await mkdtemp(path.join(os.tmpdir(), "portdeck-build-"));
const sourceEntries = ["package.json", "package-lock.json", "desktop", "server", "web", "scripts"];

console.log(`Building PortDeck in APFS staging directory: ${stageRoot}`);
for (const entry of sourceEntries) {
  await cp(path.join(projectRoot, entry), path.join(stageRoot, entry), { recursive: true });
}
await symlink(path.join(projectRoot, "node_modules"), path.join(stageRoot, "node_modules"), "dir");

const builderPath = path.join(projectRoot, "node_modules", ".bin", "electron-builder");
const builderArgs = ["--mac", ...process.argv.slice(2)];
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(builderPath, builderArgs, {
    cwd: stageRoot,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  console.error(`Build failed; staging directory preserved at ${stageRoot}`);
  process.exit(exitCode);
}

await mkdir(outputRoot, { recursive: true });
for (const entry of await readdir(path.join(stageRoot, "release"))) {
  const source = path.join(stageRoot, "release", entry);
  const destination = path.join(outputRoot, entry);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
}
await rm(stageRoot, { recursive: true, force: true });
console.log(`Build artifacts copied to ${outputRoot}`);
