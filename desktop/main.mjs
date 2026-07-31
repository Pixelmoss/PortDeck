import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from "electron";
import { startPortDeckServer } from "../server/app.mjs";
import { buildLoginItemSettings, desktopSettingsSnapshot, isHiddenLaunch } from "./lib/startup.mjs";
import { buildTrayMenuTemplate } from "./lib/tray-menu.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "PortDeck";
const DEFAULT_PORT = Number(process.env.PORTDECK_PORT || 4399);

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));

let mainWindow = null;
let tray = null;
let backend = null;
let trayRefreshTimer = null;
let isQuitting = false;
let startedHidden = false;

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
    const response = await fetch(`${backend.url}/api/services/${encodeURIComponent(service.id)}/${action}`, {
      method: "POST",
      headers: { Origin: new URL(backend.url).origin },
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
  const { services, summary } = await readServiceSummary();
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
  registerDesktopIpc();
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
  backend?.close().catch((error) => console.error("Unable to close PortDeck server:", error));
});
