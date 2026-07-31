import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(projectRoot, "native", "PortDeckNative");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const appRoot = path.join(projectRoot, "release", "PortDeckNative.app");
const contents = path.join(appRoot, "Contents");
const macOSDirectory = path.join(contents, "MacOS");
const resourcesDirectory = path.join(contents, "Resources");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

run("swift", ["build", "--package-path", packageRoot]);
const binResult = spawnSync("swift", ["build", "--show-bin-path", "--package-path", packageRoot], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (binResult.status !== 0) process.exit(binResult.status ?? 1);
const binary = path.join(binResult.stdout.trim(), "PortDeckNative");

await rm(appRoot, { recursive: true, force: true });
await mkdir(macOSDirectory, { recursive: true });
await mkdir(resourcesDirectory, { recursive: true });
await copyFile(binary, path.join(macOSDirectory, "PortDeckNative"));
await chmod(path.join(macOSDirectory, "PortDeckNative"), 0o755);
await copyFile(path.join(projectRoot, "desktop", "resources", "icon.icns"), path.join(resourcesDirectory, "AppIcon.icns"));

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>PortDeckNative</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>io.portdeck.native</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>PortDeck Native</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${packageJson.version}</string>
  <key>CFBundleVersion</key><string>${packageJson.version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
await writeFile(path.join(contents, "Info.plist"), infoPlist);
console.log(`Built ${appRoot}`);
