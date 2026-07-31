import { desktopText } from "./i18n.mjs";

function serviceLabel(service) {
  const port = service.port || service.preferredPort;
  const health = service.health?.status === "healthy" ? "● "
    : service.health?.status === "unhealthy" ? "! "
      : "";
  return `${health}${service.name}${port ? `  :${port}` : ""}`;
}

function runningServiceItem(service, handlers, locale) {
  const submenu = [];
  if (service.url) submenu.push({ label: desktopText(locale, "openInBrowser"), click: () => handlers.openUrl(service.url) });
  submenu.push({ label: desktopText(locale, "viewInPortDeck"), click: handlers.showWindow });
  if (service.health?.status === "healthy") {
    submenu.push({ label: `${desktopText(locale, "healthy")} · ${service.health.latencyMs ?? "-"}ms · HTTP ${service.health.code}`, enabled: false });
  } else if (service.health?.status === "unhealthy") {
    submenu.push({ label: `${desktopText(locale, "unhealthy")} · ${service.health.error || desktopText(locale, "noResponse")}`, enabled: false });
  }
  submenu.push({ type: "separator" });
  if (service.source === "managed") {
    submenu.push({ label: desktopText(locale, "restartService"), click: () => handlers.runAction(service, "restart") });
  }
  submenu.push({ label: desktopText(locale, "stopService"), click: () => handlers.runAction(service, "stop") });
  return { label: serviceLabel(service), submenu };
}

function offlineServiceItem(service, handlers) {
  return {
    label: serviceLabel(service),
    click: () => handlers.runAction(service, "start"),
  };
}

export function traySummaryLabel(summary = {}, locale = "zh-CN") {
  const parts = [
    desktopText(locale, "runningCount", { count: summary.running || 0 }),
    desktopText(locale, "managedCount", { count: summary.managed || 0 }),
  ];
  if (summary.conflicts) parts.push(desktopText(locale, summary.conflicts === 1 ? "conflictCountOne" : "conflictCount", { count: summary.conflicts }));
  if (summary.unhealthy) parts.push(desktopText(locale, "unhealthyCount", { count: summary.unhealthy }));
  return parts.join(" · ");
}

export function buildTrayMenuTemplate({
  services = [],
  summary = {},
  openAtLogin = false,
  canOpenAtLogin = false,
  handlers,
  serviceLimit = 8,
  locale = "zh-CN",
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
    ? running.map((service) => runningServiceItem(service, handlers, locale))
    : [{ label: desktopText(locale, "noRunningServices"), enabled: false }];

  const template = [
    { label: traySummaryLabel(summary, locale), enabled: false },
    { type: "separator" },
    ...runningItems,
  ];

  if (favorites.length) {
    template.push({
      label: desktopText(locale, "favorites", { count: favorites.length }),
      submenu: favorites.map((service) => service.status === "running"
        ? runningServiceItem(service, handlers, locale)
        : offlineServiceItem(service, handlers)),
    });
  }

  if (offlineManaged.length) {
    template.push({
      label: desktopText(locale, offlineManaged.length === 1 ? "startOfflineOne" : "startOffline", { count: offlineManaged.length }),
      submenu: offlineManaged.map((service) => offlineServiceItem(service, handlers)),
    });
  }

  template.push(
    { type: "separator" },
    { label: desktopText(locale, "openPortDeck"), accelerator: "CommandOrControl+Shift+P", click: handlers.showWindow },
    { label: desktopText(locale, "rescan"), click: handlers.refresh },
    {
      label: desktopText(locale, canOpenAtLogin ? "launchAtLogin" : "launchAtLoginUnavailable"),
      type: "checkbox",
      checked: Boolean(openAtLogin),
      enabled: Boolean(canOpenAtLogin),
      click: (menuItem) => handlers.setOpenAtLogin(menuItem.checked),
    },
    { type: "separator" },
    { label: desktopText(locale, "quitPortDeck"), role: "quit" },
  );

  return template;
}
