import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const appPath = path.resolve(process.argv[2] || "release/mac-arm64/PortDeck.app");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!existsSync(appPath)) {
  console.error(`App bundle not found: ${appPath}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  return output;
}

try {
  const version = run("/usr/bin/defaults", ["read", path.join(appPath, "Contents/Info"), "CFBundleShortVersionString"]);
  if (version !== packageJson.version) throw new Error(`Expected version ${packageJson.version}, received ${version}`);

  const executable = path.join(appPath, "Contents/MacOS/PortDeck");
  const architectures = run("/usr/bin/lipo", ["-archs", executable]).split(/\s+/).filter(Boolean);
  if (!architectures.some((arch) => ["arm64", "x86_64"].includes(arch))) {
    throw new Error(`Unexpected executable architectures: ${architectures.join(", ")}`);
  }

  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const signature = run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]);
  if (!signature.includes("Developer ID Application")) throw new Error("The app is not signed with a Developer ID Application certificate");

  run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
  run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  console.log(`Verified signed and notarized PortDeck ${version} (${architectures.join("+")}): ${appPath}`);
} catch (error) {
  console.error(`Release verification failed:\n${error.message}`);
  process.exitCode = 1;
}
