import test from "node:test";
import assert from "node:assert/strict";
import { buildTrayMenuTemplate, traySummaryLabel } from "../desktop/lib/tray-menu.mjs";

function handlers(events) {
  return {
    openUrl: (url) => events.push(["open", url]),
    showWindow: () => events.push(["show"]),
    runAction: (service, action) => events.push([action, service.id]),
    refresh: () => events.push(["refresh"]),
    setOpenAtLogin: (enabled) => events.push(["login", enabled]),
  };
}

test("traySummaryLabel includes conflicts only when present", () => {
  assert.equal(traySummaryLabel({ running: 2, managed: 3 }), "2 运行中 · 3 受管");
  assert.equal(traySummaryLabel({ running: 2, managed: 3, conflicts: 1 }), "2 运行中 · 3 受管 · 1 冲突");
  assert.equal(traySummaryLabel({ running: 2, managed: 3, unhealthy: 1 }), "2 运行中 · 3 受管 · 1 异常");
});

test("tray menu supports English labels", () => {
  assert.equal(
    traySummaryLabel({ running: 2, managed: 3, conflicts: 1, unhealthy: 1 }, "en-US"),
    "2 running · 3 managed · 1 conflict · 1 unhealthy",
  );
  const template = buildTrayMenuTemplate({
    locale: "en-US",
    handlers: handlers([]),
    canOpenAtLogin: false,
  });
  assert.ok(template.some((item) => item.label === "No services are running"));
  assert.ok(template.some((item) => item.label === "Scan now"));
  assert.ok(template.some((item) => item.label === "Quit PortDeck"));
  assert.match(template.find((item) => item.type === "checkbox").label, /packaged app/);
});

test("tray menu exposes running and offline managed service actions", () => {
  const events = [];
  const template = buildTrayMenuTemplate({
    services: [
      { id: "run", name: "Running", port: 3000, status: "running", source: "managed", url: "http://127.0.0.1:3000" },
      { id: "off", name: "Offline", preferredPort: 8899, status: "offline", source: "managed" },
    ],
    summary: { running: 1, managed: 2 },
    openAtLogin: true,
    canOpenAtLogin: true,
    handlers: handlers(events),
  });

  const running = template.find((item) => item.label?.startsWith("Running"));
  running.submenu.find((item) => item.label === "重启服务").click();
  running.submenu.find((item) => item.label === "停止服务").click();
  const offline = template.find((item) => item.label?.startsWith("启动离线服务"));
  offline.submenu[0].click();
  const login = template.find((item) => item.type === "checkbox");
  login.click({ checked: false });

  assert.deepEqual(events, [["restart", "run"], ["stop", "run"], ["start", "off"], ["login", false]]);
  assert.equal(login.checked, true);
  assert.equal(login.enabled, true);
});

test("tray menu disables login setting for unpackaged builds", () => {
  const template = buildTrayMenuTemplate({
    handlers: handlers([]),
    canOpenAtLogin: false,
  });
  const login = template.find((item) => item.type === "checkbox");
  assert.equal(login.enabled, false);
  assert.match(login.label, /打包后可用/);
  assert.ok(template.some((item) => item.label === "当前没有运行中的服务"));
});
