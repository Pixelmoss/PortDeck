import test from "node:test";
import assert from "node:assert/strict";
import { desktopText, normalizeLocale } from "../desktop/lib/i18n.mjs";

test("normalizeLocale only accepts supported application locales", () => {
  assert.equal(normalizeLocale("en-US"), "en-US");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("fr-FR"), "zh-CN");
});

test("desktopText translates and interpolates desktop messages", () => {
  assert.equal(desktopText("zh-CN", "runningTooltip", { count: 2 }), "PortDeck · 2 个服务运行中");
  assert.equal(desktopText("en-US", "runningTooltip", { count: 2 }), "PortDeck · 2 services running");
  assert.equal(
    desktopText("en-US", "healthRecoveryBody", { name: "API" }),
    "“API” is responding normally again",
  );
  assert.equal(desktopText("zh-CN", "updateSourceUnavailable"), "暂时无法访问更新源，请前往 PortDeck Releases 手动检查。");
});
