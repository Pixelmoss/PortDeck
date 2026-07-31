import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const appPath = path.resolve(process.argv[2] || "release/mac-arm64/PortDeck.app");
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
  if (version !== "1.0.0") throw new Error(`Expected version 1.0.0, received ${version}`);

  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const signature = run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]);
  if (!signature.includes("Developer ID Application")) throw new Error("The app is not signed with a Developer ID Application certificate");

  run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
  run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  console.log(`Verified signed and notarized PortDeck ${version}: ${appPath}`);
} catch (error) {
  console.error(`Release verification failed:\n${error.message}`);
  process.exitCode = 1;
}
