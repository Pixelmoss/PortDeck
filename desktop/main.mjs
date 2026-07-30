import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { startPortDeckServer } from "../server/app.mjs";

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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showMainWindow();
}

function isInternalUrl(rawUrl) {
  if (!backend) return false;
  try {
    return new URL(rawUrl).origin === new URL(backend.url).origin;
  } catch {
    return false;
  }
}

function createMainWindow() {
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
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
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

async function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const { services, summary } = await readServiceSummary();
  const runningServices = services.filter((service) => service.status === "running").slice(0, 6);
  const openAtLogin = app.getLoginItemSettings().openAtLogin;

  const serviceItems = runningServices.length
    ? runningServices.map((service) => ({
        label: `${service.name}${service.port ? `  :${service.port}` : ""}`,
        click: () => service.url ? shell.openExternal(service.url) : showMainWindow(),
      }))
    : [{ label: "当前没有运行中的服务", enabled: false }];

  tray.setToolTip(`PortDeck · ${summary.running || 0} 个服务运行中`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: `${summary.running || 0} 运行中 · ${summary.managed || 0} 受管${summary.conflicts ? ` · ${summary.conflicts} 冲突` : ""}`,
      enabled: false,
    },
    { type: "separator" },
    ...serviceItems,
    { type: "separator" },
    { label: "打开 PortDeck", accelerator: "CommandOrControl+Shift+P", click: showMainWindow },
    { label: "重新扫描", click: refreshTrayMenu },
    {
      label: app.isPackaged ? "登录时启动" : "登录时启动（打包后可用）",
      type: "checkbox",
      checked: openAtLogin,
      enabled: app.isPackaged,
      click: (menuItem) => app.setLoginItemSettings({ openAtLogin: menuItem.checked }),
    },
    { type: "separator" },
    { label: "退出 PortDeck", role: "quit" },
  ]));
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.on("click", toggleMainWindow);
  refreshTrayMenu();
  trayRefreshTimer = setInterval(refreshTrayMenu, 5000);
  trayRefreshTimer.unref?.();
}

function createApplicationMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "打开 PortDeck", accelerator: "CommandOrControl+Shift+P", click: showMainWindow },
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

async function startApplication() {
  const userData = app.getPath("userData");
  backend = await startPortDeckServer({
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    dataRoot: userData,
    version: app.getVersion(),
    allowPortFallback: true,
  });
  createApplicationMenu();
  createMainWindow();
  createTray();
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
