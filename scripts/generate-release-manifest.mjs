import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseDirectory = path.resolve(process.argv[2] || "release");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const artifactPrefix = `PortDeck-${packageJson.version}-`;
const names = (await readdir(releaseDirectory))
  .filter((name) => name.startsWith(artifactPrefix) && /\.(?:dmg|zip)$/.test(name))
  .sort();
if (!names.length) throw new Error(`No PortDeck ${packageJson.version} DMG or ZIP artifacts found in ${releaseDirectory}`);
const artifacts = [];
for (const name of names) {
  const filePath = path.join(releaseDirectory, name);
  const body = await readFile(filePath);
  artifacts.push({
    name,
    bytes: (await stat(filePath)).size,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}
const manifest = {
  schemaVersion: 1,
  product: "PortDeck",
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  artifacts,
};
const output = path.join(releaseDirectory, `PortDeck-${packageJson.version}-manifest.json`);
await writeFile(output, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${output} with ${artifacts.length} artifacts`);
