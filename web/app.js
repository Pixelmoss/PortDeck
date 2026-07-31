const state = {
  services: [],
  summary: { total: 0, running: 0, managed: 0, discovered: 0, conflicts: 0, healthy: 0, unhealthy: 0 },
  filter: "all",
  query: "",
  loading: true,
  acting: new Set(),
  desktop: null,
  refreshing: false,
  logSource: null,
};

if (window.portdeckDesktop) document.documentElement.classList.add("desktop-shell");

const elements = {
  list: document.querySelector("#serviceList"),
  search: document.querySelector("#searchInput"),
  refresh: document.querySelector("#refreshButton"),
  add: document.querySelector("#addButton"),
  sectionTitle: document.querySelector("#sectionTitle"),
  scanStatus: document.querySelector("#scanStatus"),
  dialog: document.querySelector("#serviceDialog"),
  form: document.querySelector("#serviceForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogEyebrow: document.querySelector("#dialogEyebrow"),
  logDrawer: document.querySelector("#logDrawer"),
  logTitle: document.querySelector("#logTitle"),
  logContent: document.querySelector("#logContent"),
  logLiveStatus: document.querySelector("#logLiveStatus"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  toastRegion: document.querySelector("#toastRegion"),
  desktopSettingsButton: document.querySelector("#desktopSettingsButton"),
  desktopSettingsSummary: document.querySelector("#desktopSettingsSummary"),
  desktopSettingsDialog: document.querySelector("#desktopSettingsDialog"),
  openAtLoginToggle: document.querySelector("#openAtLoginToggle"),
  openAtLoginDescription: document.querySelector("#openAtLoginDescription"),
  desktopVersion: document.querySelector("#desktopVersion"),
  dataSafetyStatus: document.querySelector("#dataSafetyStatus"),
  backupConfigButton: document.querySelector("#backupConfigButton"),
  exportDiagnosticsButton: document.querySelector("#exportDiagnosticsButton"),
};

const FILTER_LABELS = {
  all: "全部服务",
  running: "正在运行",
  managed: "受管服务",
  discovered: "自动发现",
  offline: "已离线",
  unhealthy: "健康异常",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(service) {
  const source = service.kind || service.name || "SV";
  if (source === "Node.js") return "JS";
  if (source === "Next.js") return "N";
  if (source === "PostgreSQL") return "PG";
  return source.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "SV";
}

function shortPath(value) {
  if (!value) return "工作目录未知";
  const parts = value.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : value;
}

function filteredServices() {
  return state.services.filter((service) => {
    const filterMatch = state.filter === "all"
      || (state.filter === "running" && service.status === "running")
      || (state.filter === "managed" && service.source === "managed")
      || (state.filter === "discovered" && service.source === "discovered")
      || (state.filter === "offline" && service.status === "offline")
      || (state.filter === "unhealthy" && service.health?.status === "unhealthy");
    if (!filterMatch) return false;

    const haystack = [service.name, service.kind, service.port, service.command, service.cwd]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query.toLowerCase());
  });
}

function renderMetrics() {
  document.querySelector("#runningMetric").textContent = state.summary.running;
  document.querySelector("#managedMetric").textContent = state.summary.managed;
  document.querySelector("#healthyMetric").textContent = state.summary.healthy;
  document.querySelector("#unhealthyMetric").textContent = state.summary.unhealthy;
  document.querySelector("#conflictMetric").textContent = state.summary.conflicts;
  for (const [key, value] of Object.entries(state.summary)) {
    document.querySelectorAll(`[data-count="${key}"]`).forEach((node) => { node.textContent = value; });
  }
}

function actionButtons(service) {
  const busy = state.acting.has(service.id) || service.runtime?.operation === "busy" ? " disabled" : "";
  const buttons = [];

  if (service.status === "running" && service.url) {
    buttons.push(`<button class="row-action" data-action="open" data-id="${escapeHtml(service.id)}" title="浏览器打开"${busy}>↗</button>`);
  }
  if (service.status === "running") {
    buttons.push(`<button class="row-action stop" data-action="stop" data-id="${escapeHtml(service.id)}" title="停止服务"${busy}>■</button>`);
  }
  if (service.source === "discovered") {
    buttons.push(`<button class="row-action manage" data-action="manage" data-id="${escapeHtml(service.id)}"${busy}>纳入管理</button>`);
  } else {
    if (service.status !== "running") {
      buttons.push(`<button class="row-action start" data-action="start" data-id="${escapeHtml(service.id)}" title="启动服务"${busy}>▶</button>`);
    } else {
      buttons.push(`<button class="row-action" data-action="restart" data-id="${escapeHtml(service.id)}" title="重启服务"${busy}>↻</button>`);
    }
    buttons.push(`<button class="row-action" data-action="logs" data-id="${escapeHtml(service.id)}" title="查看日志">⌁</button>`);
    buttons.push(`<button class="row-action" data-action="edit" data-id="${escapeHtml(service.id)}" title="编辑配置">···</button>`);
  }

  return buttons.join("");
}

function healthBadge(service) {
  const health = service.health;
  if (!health || service.status !== "running") return "";
  if (health.status === "healthy") {
    const latency = Number.isFinite(health.latencyMs) ? ` ${health.latencyMs}MS` : "";
    return `<span class="badge health healthy" title="${escapeHtml(health.url)}">HEALTHY${latency}</span>`;
  }
  if (health.status === "unhealthy") {
    return `<span class="badge health unhealthy" title="${escapeHtml(health.error || "健康检查失败")}">UNHEALTHY</span>`;
  }
  if (health.status === "disabled") return '<span class="badge health disabled">CHECK OFF</span>';
  return '<span class="badge health unknown">NO HTTP</span>';
}

function ownershipBadge(service) {
  if (service.status !== "running" || service.source !== "managed") return "";
  if (service.ownership === "portdeck") {
    return '<span class="badge ownership portdeck" title="当前进程由 PortDeck 启动并持续跟踪">OWNED</span>';
  }
  if (service.ownership === "recovered") {
    return '<span class="badge ownership recovered" title="PortDeck 重启后通过进程身份恢复了管理关系">RECOVERED</span>';
  }
  return '<span class="badge ownership external" title="外部进程；停止前会重新验证进程身份">EXTERNAL</span>';
}

function faviconMarkup(service) {
  if (!service.health?.faviconUrl || service.health.status !== "healthy") return "";
  try {
    const url = new URL(service.health.faviconUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return "";
    return `<img src="${escapeHtml(url.href)}" alt="" />`;
  } catch {
    return "";
  }
}

function renderService(service) {
  const sourceBadge = service.source === "managed"
    ? '<span class="badge managed">MANAGED</span>'
    : '<span class="badge discovered">DISCOVERED</span>';
  const conflictBadge = service.status === "conflict" ? '<span class="badge conflict">CONFLICT</span>' : "";
  const health = healthBadge(service);
  const ownership = ownershipBadge(service);
  const port = service.port || service.preferredPort;
  const portClass = service.status === "running" ? "" : " offline";
  const runtime = service.status === "running"
    ? `${escapeHtml(service.kind || service.processName)} · PID ${escapeHtml(service.pid)}${service.elapsed ? ` · ${escapeHtml(service.elapsed)}` : ""}`
    : service.status === "conflict"
      ? `PID ${escapeHtml(service.conflict?.pid)} 正在占用端口`
      : "等待启动";
  const command = service.command || service.startCommand || "尚未记录启动命令";

  return `
    <article class="service-row" data-status="${escapeHtml(service.status)}">
      <div class="service-main">
        <div class="service-avatar" data-kind="${escapeHtml(service.kind)}">${faviconMarkup(service) || escapeHtml(initials(service))}</div>
        <div class="service-copy">
          <div class="service-title">
            <strong title="${escapeHtml(service.name)}">${escapeHtml(service.name)}</strong>
            ${sourceBadge}${ownership}${conflictBadge}${health}
          </div>
          <div class="service-subtitle" title="${escapeHtml(service.cwd)}">${escapeHtml(shortPath(service.cwd))}</div>
        </div>
      </div>
      <div class="service-port">
        <div class="port-line">
          <span class="port-pill${portClass}">${port ? `:${escapeHtml(port)}` : "NO PORT"}</span>
          <code>${service.status === "running" ? "LISTEN" : service.status.toUpperCase()}</code>
        </div>
        <div class="service-meta">${runtime}</div>
      </div>
      <div class="service-detail">
        <strong title="${escapeHtml(command)}">${escapeHtml(command)}</strong>
        <div class="service-meta">${escapeHtml(service.health?.title || service.url || "本地进程")}</div>
      </div>
      <div class="service-actions">${actionButtons(service)}</div>
    </article>`;
}

function render() {
  renderMetrics();
  elements.sectionTitle.textContent = FILTER_LABELS[state.filter];
  const services = filteredServices();

  if (state.loading) {
    elements.list.innerHTML = '<div class="loading-row"><span></span><span></span><span></span></div>';
    return;
  }
  if (!services.length) {
    elements.list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌁</div>
        <strong>这里暂时没有服务</strong>
        <p>${state.query ? "换个关键词试试" : "启动一个本地服务，PortDeck 会自动发现它"}</p>
      </div>`;
    return;
  }
  elements.list.innerHTML = services.map(renderService).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败 (${response.status})`);
    error.details = payload.details;
    throw error;
  }
  return payload;
}

async function loadServices({ fresh = false, silent = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  if (!silent) {
    state.loading = true;
    elements.refresh.classList.add("spinning");
    render();
  }
  try {
    const data = await api(`/api/services${fresh ? "?fresh=1" : ""}`);
    state.services = data.services;
    state.summary = data.summary;
    const scanned = new Date(data.scannedAt);
    elements.scanStatus.textContent = `最近扫描 ${scanned.toLocaleTimeString("zh-CN", { hour12: false })} · ${data.summary.total} 个服务`;
  } catch (error) {
    elements.scanStatus.textContent = "扫描失败";
    toast(error.message, "error");
  } finally {
    state.refreshing = false;
    state.loading = false;
    elements.refresh.classList.remove("spinning");
    render();
  }
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 3500);
}

function applyDesktopSettings(settings) {
  state.desktop = settings;
  elements.desktopSettingsSummary.textContent = settings.openAtLogin
    ? "已开启登录时静默启动"
    : "未开启登录时启动";
  elements.openAtLoginToggle.checked = settings.openAtLogin;
  elements.openAtLoginToggle.disabled = !settings.canOpenAtLogin;
  elements.desktopVersion.textContent = settings.version;
  elements.openAtLoginDescription.textContent = settings.canOpenAtLogin
    ? "开机后只显示菜单栏图标，不弹出主窗口。"
    : "开发模式不会修改 macOS 登录项，请在打包应用中设置。";
}

async function loadDesktopSettings() {
  if (!window.portdeckDesktop?.getSettings) return null;
  const settings = await window.portdeckDesktop.getSettings();
  applyDesktopSettings(settings);
  return settings;
}

async function loadDataSafetyStatus() {
  const diagnostics = await api("/api/system/diagnostics");
  const registry = diagnostics.registry;
  elements.dataSafetyStatus.textContent = registry.recoveryNotice
    || `配置 schema v${registry.schemaVersion} · ${registry.backupCount} 份备份 · 日志自动轮转`;
  return diagnostics;
}

async function createConfigBackup() {
  elements.backupConfigButton.disabled = true;
  try {
    const result = await api("/api/system/backup", { method: "POST" });
    elements.dataSafetyStatus.textContent = `已创建 ${result.fileName} · 共 ${result.registry.backupCount} 份备份`;
    toast("配置备份已创建");
  } finally {
    elements.backupConfigButton.disabled = false;
  }
}

async function exportDiagnostics() {
  elements.exportDiagnosticsButton.disabled = true;
  try {
    const diagnostics = await api("/api/system/diagnostics");
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `PortDeck-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast("诊断报告已导出");
  } finally {
    elements.exportDiagnosticsButton.disabled = false;
  }
}

function findService(id) {
  return state.services.find((service) => service.id === id);
}

function setFormValues(service = {}) {
  const fields = ["id", "name", "preferredPort", "kind", "cwd", "startCommand", "stopCommand", "protocol", "healthPath", "notes"];
  for (const name of fields) {
    const input = elements.form.elements.namedItem(name);
    input.value = service[name] ?? "";
  }
  elements.form.elements.healthCheckEnabled.checked = service.healthCheckEnabled !== false;
  elements.form.elements.autoRestart.checked = Boolean(service.autoRestart);
  if (!elements.form.elements.protocol.value) elements.form.elements.protocol.value = "http";
  if (!elements.form.elements.healthPath.value) elements.form.elements.healthPath.value = "/";
}

function openServiceDialog(service = null, mode = "add") {
  elements.form.reset();
  if (mode === "promote") {
    elements.dialogTitle.textContent = "纳入服务管理";
    elements.dialogEyebrow.textContent = "PROMOTE DISCOVERED SERVICE";
    setFormValues({
      name: service.name,
      preferredPort: service.port,
      kind: service.kind,
      cwd: service.cwd,
      startCommand: service.suggestedStartCommand || service.command,
      protocol: "http",
      healthPath: "/",
      healthCheckEnabled: true,
      autoRestart: false,
    });
  } else if (mode === "edit") {
    elements.dialogTitle.textContent = "编辑受管服务";
    elements.dialogEyebrow.textContent = "SERVICE CONFIGURATION";
    setFormValues(service);
  } else {
    elements.dialogTitle.textContent = "添加受管服务";
    elements.dialogEyebrow.textContent = "MANAGED SERVICE";
    setFormValues({ protocol: "http", healthPath: "/", healthCheckEnabled: true, autoRestart: false });
  }
  elements.dialog.showModal();
  setTimeout(() => elements.form.elements.name.focus(), 40);
}

async function performAction(service, action) {
  if (state.acting.has(service.id)) return;
  if (action === "open") {
    window.open(service.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (action === "manage") return openServiceDialog(service, "promote");
  if (action === "edit") return openServiceDialog(service, "edit");
  if (action === "logs") return showLogs(service);
  if (action === "stop") {
    const externalWarning = service.ownership === "external"
      ? "\n\n此进程不是由 PortDeck 启动的；发送信号前会再次验证 PID、启动时间和工作目录。"
      : "";
    if (!window.confirm(`确定停止「${service.name}」吗？${externalWarning}`)) return;
  }

  state.acting.add(service.id);
  render();
  try {
    const result = await api(`/api/services/${encodeURIComponent(service.id)}/${action}`, { method: "POST" });
    toast(action === "start"
      ? "服务启动命令已执行"
      : action === "stop"
        ? result.forced ? "服务无响应，已强制停止" : "服务已安全停止"
        : "服务已完成重启");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await loadServices({ fresh: true, silent: true });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.acting.delete(service.id);
    render();
  }
}

async function showLogs(service) {
  state.logSource?.close();
  state.logSource = null;
  elements.logTitle.textContent = `${service.name} · 运行日志`;
  elements.logContent.textContent = "正在连接实时日志…";
  elements.logLiveStatus.textContent = "连接中";
  elements.logLiveStatus.className = "live-dot connecting";
  elements.logDrawer.classList.add("open");
  elements.drawerBackdrop.classList.add("open");
  elements.logDrawer.setAttribute("aria-hidden", "false");
  const source = new EventSource(`/api/services/${encodeURIComponent(service.id)}/logs/stream`);
  state.logSource = source;
  source.addEventListener("open", () => {
    elements.logLiveStatus.textContent = "实时";
    elements.logLiveStatus.className = "live-dot connected";
  });
  source.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "reset") elements.logContent.textContent = payload.text || "暂无由 PortDeck 启动的日志。";
      if (payload.type === "append" && payload.text) {
        if (elements.logContent.textContent === "正在连接实时日志…" || elements.logContent.textContent === "暂无由 PortDeck 启动的日志。") {
          elements.logContent.textContent = "";
        }
        elements.logContent.textContent += payload.text;
      }
      elements.logContent.scrollTop = elements.logContent.scrollHeight;
    } catch {
      // Ignore malformed stream events and let EventSource reconnect.
    }
  });
  source.addEventListener("error", () => {
    elements.logLiveStatus.textContent = "重连中";
    elements.logLiveStatus.className = "live-dot connecting";
  });
}

function closeLogs() {
  state.logSource?.close();
  state.logSource = null;
  elements.logDrawer.classList.remove("open");
  elements.drawerBackdrop.classList.remove("open");
  elements.logDrawer.setAttribute("aria-hidden", "true");
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    render();
  });
});

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const service = findService(button.dataset.id);
  if (service) performAction(service, button.dataset.action);
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value.trim();
  render();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === "Escape") closeLogs();
});

elements.refresh.addEventListener("click", () => loadServices({ fresh: true }));
elements.add.addEventListener("click", () => openServiceDialog());
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => elements.dialog.close()));
document.querySelector("#closeLogButton").addEventListener("click", closeLogs);
elements.drawerBackdrop.addEventListener("click", closeLogs);

if (window.portdeckDesktop) {
  elements.desktopSettingsButton.addEventListener("click", async () => {
    try {
      await loadDesktopSettings();
      await loadDataSafetyStatus().catch(() => {});
      elements.desktopSettingsDialog.showModal();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  document.querySelectorAll("[data-close-desktop-settings]").forEach((button) => {
    button.addEventListener("click", () => elements.desktopSettingsDialog.close());
  });
  elements.openAtLoginToggle.addEventListener("change", async () => {
    const enabled = elements.openAtLoginToggle.checked;
    elements.openAtLoginToggle.disabled = true;
    try {
      applyDesktopSettings(await window.portdeckDesktop.setOpenAtLogin(enabled));
      toast(enabled ? "已开启登录时静默启动" : "已关闭登录时启动");
    } catch (error) {
      await loadDesktopSettings().catch(() => {});
      toast(error.message, "error");
    }
  });
  elements.backupConfigButton.addEventListener("click", () => {
    createConfigBackup().catch((error) => toast(error.message, "error"));
  });
  elements.exportDiagnosticsButton.addEventListener("click", () => {
    exportDiagnostics().catch((error) => toast(error.message, "error"));
  });
  window.portdeckDesktop.onSettingsChanged(applyDesktopSettings);
  loadDesktopSettings().catch((error) => {
    elements.desktopSettingsSummary.textContent = "无法读取桌面设置";
    console.error(error);
  });
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.form));
  const id = formData.id;
  delete formData.id;
  formData.preferredPort = formData.preferredPort ? Number(formData.preferredPort) : null;
  formData.healthCheckEnabled = elements.form.elements.healthCheckEnabled.checked;
  formData.autoRestart = elements.form.elements.autoRestart.checked;

  try {
    await api(id ? `/api/services/${encodeURIComponent(id)}` : "/api/services", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(formData),
    });
    elements.dialog.close();
    toast(id ? "服务配置已更新" : "服务已加入管理");
    await loadServices({ fresh: true, silent: true });
  } catch (error) {
    toast(error.message, "error");
  }
});

loadServices({ fresh: true });
setInterval(() => {
  if (document.visibilityState === "visible" && !elements.dialog.open) {
    loadServices({ fresh: true, silent: true });
  }
}, 5000);
