import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const appPath = path.resolve(process.argv[2] || "release/mac-arm64/PortDeck.app");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  if (result.status !== 0) {
    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }
  return stdout || stderr;
}

try {
  if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`);
  const infoPath = path.join(appPath, "Contents/Info");
  const version = run("/usr/bin/defaults", ["read", infoPath, "CFBundleShortVersionString"]);
  if (version !== packageJson.version) throw new Error(`Expected version ${packageJson.version}, received ${version}`);

  const executable = path.join(appPath, "Contents/MacOS/PortDeck");
  const architectures = run("/usr/bin/lipo", ["-archs", executable]).split(/\s+/).filter(Boolean);
  if (!architectures.some((arch) => ["arm64", "x86_64"].includes(arch))) {
    throw new Error(`Unexpected executable architectures: ${architectures.join(", ")}`);
  }

  const resources = path.join(appPath, "Contents/Resources");
  if (!existsSync(path.join(resources, "app.asar"))) throw new Error("Packaged app.asar is missing");
  const locales = ["en.lproj", "zh_CN.lproj"].filter((name) => existsSync(path.join(resources, name)));
  if (locales.length !== 2) throw new Error(`Expected English and Simplified Chinese resources, found: ${locales.join(", ") || "none"}`);

  console.log(`Verified PortDeck ${version} bundle (${architectures.join("+")}; ${locales.join("+")}): ${appPath}`);
} catch (error) {
  console.error(`Bundle verification failed:\n${error.message}`);
  process.exitCode = 1;
}
