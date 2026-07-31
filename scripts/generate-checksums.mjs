import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseDirectory = path.resolve(process.argv[2] || "release");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const prefix = `PortDeck-${packageJson.version}-`;
const names = (await readdir(releaseDirectory))
  .filter((name) => name.startsWith(prefix) && /\.(?:dmg|zip|blockmap)$/.test(name))
  .sort();

if (!names.length) throw new Error(`No PortDeck ${packageJson.version} release artifacts found in ${releaseDirectory}`);

const lines = [];
for (const name of names) {
  const digest = createHash("sha256").update(await readFile(path.join(releaseDirectory, name))).digest("hex");
  lines.push(`${digest}  ${name}`);
}

const output = path.join(releaseDirectory, `PortDeck-${packageJson.version}-SHA256SUMS.txt`);
await writeFile(output, `${lines.join("\n")}\n`);
console.log(`Wrote ${output} with ${lines.length} checksums`);
