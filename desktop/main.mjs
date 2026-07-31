import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  app,
  BrowserWindow,
  crashReporter,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from "electron";
import electronUpdater from "electron-updater";
import { startPortDeckServer } from "../server/app.mjs";
import { buildLoginItemSettings, desktopSettingsSnapshot, isHiddenLaunch } from "./lib/startup.mjs";
import { buildTrayMenuTemplate } from "./lib/tray-menu.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "PortDeck";
const DEFAULT_PORT = Number(process.env.PORTDECK_PORT || 4399);
const { autoUpdater } = electronUpdater;

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));

let mainWindow = null;
let tray = null;
let backend = null;
let trayRefreshTimer = null;
let updateCheckTimer = null;
let isQuitting = false;
let startedHidden = false;
let crashReporterStarted = false;
const healthStates = new Map();
const notificationTimes = new Map();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  app.dock?.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    app.dock?.hide();
  }
  else showMainWindow();
}

function getDesktopSettings() {
  return desktopSettingsSnapshot({
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    loginItemSettings: app.getLoginItemSettings(),
    startedHidden,
  });
}

function broadcastDesktopSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:settings-changed", getDesktopSettings());
}

function setOpenAtLogin(enabled) {
  if (!app.isPackaged) return getDesktopSettings();
  app.setLoginItemSettings(buildLoginItemSettings(enabled));
  createApplicationMenu();
  broadcastDesktopSettings();
  refreshTrayMenu();
  return getDesktopSettings();
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true }).show();
}

function versionParts(value) {
  return String(value || "0").replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

async function checkForUpdates() {
  if (canUseAutomaticUpdater()) {
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo?.version || app.getVersion();
    return {
      available: isNewerVersion(latestVersion, app.getVersion()),
      canAutoUpdate: true,
      currentVersion: app.getVersion(),
      latestVersion,
    };
  }
  const response = await fetch("https://api.github.com/repos/Pixelmoss/PortDeck/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `PortDeck/${app.getVersion()}` },
  });
  if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status})`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || "").replace(/^v/, "");
  return {
    available: isNewerVersion(latestVersion, app.getVersion()),
    canAutoUpdate: false,
    currentVersion: app.getVersion(),
    latestVersion,
    releaseUrl: release.html_url,
  };
}

function canUseAutomaticUpdater() {
  return app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

function sendUpdateStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status", status);
}

function initializeAutoUpdater() {
  if (!canUseAutomaticUpdater()) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({ state: "available", version: info.version });
    notify("PortDeck · 有新版本", `PortDeck ${info.version} 已可下载，安装前会再次询问你。`);
  });
  autoUpdater.on("update-not-available", () => sendUpdateStatus({ state: "current", version: app.getVersion() }));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus({ state: "downloading", percent: Math.round(progress.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => sendUpdateStatus({ state: "error", message: error.message }));
  updateCheckTimer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => console.error("Automatic update check failed:", error));
  }, 15_000);
  updateCheckTimer.unref?.();
}

function notifyHealthTransitions(services, preferences = {}) {
  const enabled = preferences.notificationsEnabled !== false && preferences.notificationFrequency !== "off";
  for (const service of services) {
    if (service.status !== "running") continue;
    const next = service.health?.status;
    const previous = healthStates.get(service.id);
    healthStates.set(service.id, next);
    if (!enabled || !previous || previous === next || !["healthy", "unhealthy"].includes(next)) continue;
    const key = `${service.id}:${next}`;
    const now = Date.now();
    if (now - (notificationTimes.get(key) || 0) < 60_000) continue;
    notificationTimes.set(key, now);
    notify(
      next === "unhealthy" ? "PortDeck · 服务健康异常" : "PortDeck · 服务已经恢复",
      next === "unhealthy" ? `「${service.name}」健康检查失败` : `「${service.name}」已恢复正常响应`,
    );
  }
}

function isInternalUrl(rawUrl) {
  if (!backend) return false;
  try {
    return new URL(rawUrl).origin === new URL(backend.url).origin;
  } catch {
    return false;
  }
}

function createMainWindow({ showOnReady = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#080a0f",
    title: APP_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    app.dock?.hide();
  });

  mainWindow.once("ready-to-show", () => {
    if (showOnReady) showMainWindow();
  });
  mainWindow.loadURL(backend.url);
}

function createTrayImage() {
  const image = nativeImage.createFromNamedImage("NSStatusAvailable");
  if (!image.isEmpty()) image.setTemplateImage(true);
  return image;
}

async function readServiceSummary() {
  try {
    const response = await fetch(`${backend.url}/api/services`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("Unable to refresh tray services:", error);
    return { services: [], summary: { running: 0, managed: 0, conflicts: 0 } };
  }
}

async function runTrayAction(service, action) {
  try {
    const riskResponse = await fetch(`${backend.url}/api/services/${encodeURIComponent(service.id)}/risk/${action}`);
    const riskPayload = await riskResponse.json().catch(() => ({}));
    if (!riskResponse.ok) throw new Error(riskPayload.error || `HTTP ${riskResponse.status}`);
    if (riskPayload.risk?.requiresAcknowledgement) {
      notify("PortDeck · 需要风险确认", `请在主窗口确认「${service.name}」的${action === "stop" ? "停止" : action === "start" ? "启动" : "重启"}命令`);
      showMainWindow();
      return;
    }
    const response = await fetch(`${backend.url}/api/services/${encodeURIComponent(service.id)}/${action}`, {
      method: "POST",
      headers: { Origin: new URL(backend.url).origin, "Content-Type": "application/json" },
      body: JSON.stringify({ riskAcknowledged: true, source: "tray" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    notify("PortDeck", action === "start"
      ? `已启动「${service.name}」`
      : action === "stop"
        ? `已发送「${service.name}」的停止信号`
        : `正在重启「${service.name}」`);
  } catch (error) {
    notify("PortDeck 操作失败", error.message);
    showMainWindow();
  } finally {
    setTimeout(refreshTrayMenu, 750);
  }
}

async function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const { services, summary, preferences } = await readServiceSummary();
  notifyHealthTransitions(services, preferences);
  const settings = getDesktopSettings();

  tray.setToolTip(`PortDeck · ${summary.running || 0} 个服务运行中`);
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    services,
    summary,
    openAtLogin: settings.openAtLogin,
    canOpenAtLogin: settings.canOpenAtLogin,
    handlers: {
      openUrl: (url) => shell.openExternal(url),
      showWindow: showMainWindow,
      runAction: runTrayAction,
      refresh: refreshTrayMenu,
      setOpenAtLogin,
    },
  })));
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.on("click", toggleMainWindow);
  refreshTrayMenu();
  trayRefreshTimer = setInterval(refreshTrayMenu, 5000);
  trayRefreshTimer.unref?.();
}

function createApplicationMenu() {
  const settings = getDesktopSettings();
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "打开 PortDeck", accelerator: "CommandOrControl+Shift+P", click: showMainWindow },
        {
          label: settings.canOpenAtLogin ? "登录时静默启动" : "登录时启动（打包后可用）",
          type: "checkbox",
          checked: settings.openAtLogin,
          enabled: settings.canOpenAtLogin,
          click: (menuItem) => setOpenAtLogin(menuItem.checked),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "显示",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:get-settings", () => getDesktopSettings());
  ipcMain.handle("desktop:set-open-at-login", (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new TypeError("openAtLogin must be a boolean");
    return setOpenAtLogin(enabled);
  });
  ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
  ipcMain.handle("desktop:download-update", async () => {
    if (!canUseAutomaticUpdater()) throw new Error("自动下载只在正式安装包中可用");
    await autoUpdater.downloadUpdate();
    return { ok: true };
  });
  ipcMain.handle("desktop:install-update", () => {
    if (!canUseAutomaticUpdater()) throw new Error("自动安装只在正式安装包中可用");
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
}

async function startApplication() {
  const userData = app.getPath("userData");
  startedHidden = isHiddenLaunch({
    wasOpenedAtLogin: app.getLoginItemSettings().wasOpenedAtLogin,
    argv: process.argv,
  });
  backend = await startPortDeckServer({
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    dataRoot: userData,
    version: app.getVersion(),
    allowPortFallback: true,
  });
  const preferences = backend.registry.getPreferences();
  if (preferences.crashReportingEnabled && !crashReporterStarted) {
    crashReporter.start({ companyName: "PortDeck", productName: "PortDeck", uploadToServer: false });
    crashReporterStarted = true;
  }
  registerDesktopIpc();
  initializeAutoUpdater();
  createApplicationMenu();
  createMainWindow({ showOnReady: !startedHidden });
  createTray();
  if (startedHidden) {
    app.dock?.hide();
    console.log("PortDeck started in menu-bar-only mode");
  }
}

app.on("second-instance", () => showMainWindow());
app.on("activate", () => showMainWindow());
app.on("before-quit", () => { isQuitting = true; });
app.on("window-all-closed", () => {
  // PortDeck stays available from the macOS menu bar.
});

app.whenReady().then(startApplication).catch((error) => {
  console.error("PortDeck failed to start:", error);
  app.quit();
});

app.on("will-quit", () => {
  if (trayRefreshTimer) clearInterval(trayRefreshTimer);
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  backend?.close().catch((error) => console.error("Unable to close PortDeck server:", error));
});
