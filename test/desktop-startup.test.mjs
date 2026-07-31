import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLoginItemSettings,
  desktopSettingsSnapshot,
  isHiddenLaunch,
} from "../desktop/lib/startup.mjs";

test("buildLoginItemSettings enables silent login launch", () => {
  assert.deepEqual(buildLoginItemSettings(true), { openAtLogin: true, openAsHidden: true });
  assert.deepEqual(buildLoginItemSettings(false), { openAtLogin: false, openAsHidden: false });
});

test("isHiddenLaunch recognizes macOS login launch and explicit hidden mode", () => {
  assert.equal(isHiddenLaunch({ wasOpenedAtLogin: true }), true);
  assert.equal(isHiddenLaunch({ argv: ["PortDeck", "--hidden"] }), true);
  assert.equal(isHiddenLaunch({ argv: ["PortDeck"] }), false);
});

test("desktopSettingsSnapshot only exposes renderer-safe state", () => {
  assert.deepEqual(desktopSettingsSnapshot({
    appVersion: "0.3.0",
    isPackaged: true,
    loginItemSettings: { openAtLogin: true, executableWillLaunchAtLogin: true },
    startedHidden: true,
  }), {
    version: "0.3.0",
    canOpenAtLogin: true,
    openAtLogin: true,
    startedHidden: true,
  });
});
