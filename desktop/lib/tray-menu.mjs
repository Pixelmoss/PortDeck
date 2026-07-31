function serviceLabel(service) {
  const port = service.port || service.preferredPort;
  const health = service.health?.status === "healthy" ? "● "
    : service.health?.status === "unhealthy" ? "! "
      : "";
  return `${health}${service.name}${port ? `  :${port}` : ""}`;
}

function runningServiceItem(service, handlers) {
  const submenu = [];
  if (service.url) submenu.push({ label: "在浏览器中打开", click: () => handlers.openUrl(service.url) });
  submenu.push({ label: "在 PortDeck 中查看", click: handlers.showWindow });
  if (service.health?.status === "healthy") {
    submenu.push({ label: `健康 · ${service.health.latencyMs ?? "-"}ms · HTTP ${service.health.code}`, enabled: false });
  } else if (service.health?.status === "unhealthy") {
    submenu.push({ label: `健康异常 · ${service.health.error || "无响应"}`, enabled: false });
  }
  submenu.push({ type: "separator" });
  if (service.source === "managed") {
    submenu.push({ label: "重启服务", click: () => handlers.runAction(service, "restart") });
  }
  submenu.push({ label: "停止服务", click: () => handlers.runAction(service, "stop") });
  return { label: serviceLabel(service), submenu };
}

function offlineServiceItem(service, handlers) {
  return {
    label: serviceLabel(service),
    click: () => handlers.runAction(service, "start"),
  };
}

export function traySummaryLabel(summary = {}) {
  const parts = [
    `${summary.running || 0} 运行中`,
    `${summary.managed || 0} 受管`,
  ];
  if (summary.conflicts) parts.push(`${summary.conflicts} 冲突`);
  if (summary.unhealthy) parts.push(`${summary.unhealthy} 异常`);
  return parts.join(" · ");
}

export function buildTrayMenuTemplate({
  services = [],
  summary = {},
  openAtLogin = false,
  canOpenAtLogin = false,
  handlers,
  serviceLimit = 8,
} = {}) {
  const running = services
    .filter((service) => service.status === "running")
    .slice(0, serviceLimit);
  const offlineManaged = services
    .filter((service) => service.source === "managed" && service.status === "offline")
    .slice(0, serviceLimit);
  const favorites = services
    .filter((service) => service.favorite)
    .slice(0, serviceLimit);

  const runningItems = running.length
    ? running.map((service) => runningServiceItem(service, handlers))
    : [{ label: "当前没有运行中的服务", enabled: false }];

  const template = [
    { label: traySummaryLabel(summary), enabled: false },
    { type: "separator" },
    ...runningItems,
  ];

  if (favorites.length) {
    template.push({
      label: `收藏服务 (${favorites.length})`,
      submenu: favorites.map((service) => service.status === "running"
        ? runningServiceItem(service, handlers)
        : offlineServiceItem(service, handlers)),
    });
  }

  if (offlineManaged.length) {
    template.push({
      label: `启动离线服务 (${offlineManaged.length})`,
      submenu: offlineManaged.map((service) => offlineServiceItem(service, handlers)),
    });
  }

  template.push(
    { type: "separator" },
    { label: "打开 PortDeck", accelerator: "CommandOrControl+Shift+P", click: handlers.showWindow },
    { label: "立即重新扫描", click: handlers.refresh },
    {
      label: canOpenAtLogin ? "登录时静默启动" : "登录时启动（打包后可用）",
      type: "checkbox",
      checked: Boolean(openAtLogin),
      enabled: Boolean(canOpenAtLogin),
      click: (menuItem) => handlers.setOpenAtLogin(menuItem.checked),
    },
    { type: "separator" },
    { label: "退出 PortDeck", role: "quit" },
  );

  return template;
}
