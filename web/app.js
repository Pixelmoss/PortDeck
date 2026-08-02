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
  workspaces: [],
  preferences: null,
  templates: [],
  workspaceFilter: "all",
  selected: new Set(),
  pendingRiskAction: null,
  scannedAt: null,
  dataSafetyRegistry: null,
  updateStatusInfo: null,
  inspectedServiceId: null,
  inspectorLogs: new Map(),
  inspectorLogLoading: new Set(),
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
  workspaceFilter: document.querySelector("#workspaceFilter"),
  addWorkspaceButton: document.querySelector("#addWorkspaceButton"),
  workspaceDialog: document.querySelector("#workspaceDialog"),
  workspaceForm: document.querySelector("#workspaceForm"),
  sortSelect: document.querySelector("#sortSelect"),
  bulkBar: document.querySelector("#bulkBar"),
  selectedCount: document.querySelector("#selectedCount"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  templateSelect: document.querySelector("#templateSelect"),
  serviceWorkspace: document.querySelector("#serviceWorkspace"),
  riskDialog: document.querySelector("#riskDialog"),
  riskTitle: document.querySelector("#riskTitle"),
  riskContent: document.querySelector("#riskContent"),
  riskConfirmButton: document.querySelector("#riskConfirmButton"),
  historyButton: document.querySelector("#historyButton"),
  historyDialog: document.querySelector("#historyDialog"),
  historyList: document.querySelector("#historyList"),
  onboardingDialog: document.querySelector("#onboardingDialog"),
  finishOnboardingButton: document.querySelector("#finishOnboardingButton"),
  onboardingEnglishButton: document.querySelector("#onboardingEnglishButton"),
  localeSelect: document.querySelector("#localeSelect"),
  notificationFrequencySelect: document.querySelector("#notificationFrequencySelect"),
  crashReportingToggle: document.querySelector("#crashReportingToggle"),
  exportConfigButton: document.querySelector("#exportConfigButton"),
  importConfigButton: document.querySelector("#importConfigButton"),
  importConfigFile: document.querySelector("#importConfigFile"),
  checkUpdateButton: document.querySelector("#checkUpdateButton"),
  updateStatus: document.querySelector("#updateStatus"),
  inspector: document.querySelector("#serviceInspector"),
  scanMetric: document.querySelector("#scanMetric"),
};

const FILTER_LABELS = {
  all: "全部服务",
  running: "正在运行",
  managed: "受管服务",
  discovered: "自动发现",
  offline: "已离线",
  unhealthy: "健康异常",
  favorites: "收藏服务",
};

const ENGLISH_TEXT = new Map(Object.entries({
  "服务": "Services", "全部服务": "All services", "正在运行": "Running", "受管服务": "Managed",
  "自动发现": "Discovered", "已离线": "Offline", "健康异常": "Unhealthy", "收藏服务": "Favorites",
  "工作区": "Workspace", "全部工作区": "All workspaces", "桌面设置": "Desktop settings",
  "实时扫描已开启": "Live scan enabled", "每 5 秒检查监听端口": "Checks listening ports every 5 seconds",
  "仅限本机访问": "Local access only", "本地服务": "Local services", "立即扫描": "Scan now",
  "添加服务": "Add service", "服务概览": "Service overview", "健康服务": "Healthy", "端口冲突": "Port conflicts",
  "个服务在线": "services online", "HTTP 检查通过": "HTTP checks passed", "超时或响应错误": "Timeout or response error",
  "可靠生命周期管理": "Reliable lifecycle management", "需要处理": "Needs attention", "运行中": "Running",
  "已选择": "Selected", "项": "items", "批量启动": "Start selected", "批量重启": "Restart selected",
  "批量停止": "Stop selected", "清除": "Clear", "添加受管服务": "Add managed service", "服务模板": "Service template",
  "自定义配置": "Custom", "服务名称": "Service name", "首选端口": "Preferred port", "服务类型": "Service type",
  "工作目录": "Working directory", "服务分组": "Service group", "标签": "Tags", "使用逗号分隔": "Comma separated",
  "启动命令": "Start command", "停止命令": "Stop command", "访问协议": "Protocol", "健康检查路径": "Health path",
  "备注": "Notes", "HTTP 健康检查": "HTTP health check", "异常退出后自动重启": "Restart after failure",
  "取消": "Cancel", "保存服务": "Save service", "PortDeck 桌面设置": "PortDeck settings",
  "登录时静默启动": "Launch quietly at login", "服务状态通知": "Service notifications", "全部通知": "All notifications",
  "仅异常与恢复": "Failures and recovery only", "关闭通知": "Notifications off", "崩溃报告（默认关闭）": "Crash reports (off by default)",
  "数据安全与诊断": "Data safety and diagnostics", "备份配置": "Back up configuration", "导出诊断": "Export diagnostics",
  "导出配置": "Export configuration", "导入配置": "Import configuration", "软件更新": "Software updates",
  "检查更新": "Check for updates", "当前版本": "Current version", "完成": "Done", "新建工作区": "New workspace",
  "工作区名称": "Workspace name", "标识颜色": "Color", "创建": "Create", "执行前风险预览": "Risk preview",
  "了解风险并继续": "Acknowledge and continue", "操作历史": "Activity history", "开始使用": "Get started",
  "状态排序": "Sort by status", "名称排序": "Sort by name", "端口排序": "Sort by port",
  "工作区排序": "Sort by workspace", "手动顺序": "Manual order", "正在读取本机监听端口…": "Reading local listening ports…",
  "保存启动命令后，即使服务停止，它仍会留在控制台里等待下次启动。": "Saved services remain in the dashboard when stopped and can be started again later.",
  "必填": "Required", "可选，不填则发送 SIGTERM": "Optional; sends SIGTERM when empty", "可选说明": "Optional notes",
  "检测状态码、响应时间、页面标题和 favicon": "Checks status, latency, page title, and favicon",
  "只监督由 PortDeck 启动的进程": "Only supervises processes started by PortDeck", "设为收藏": "Favorite",
  "置顶显示并加入菜单栏快捷操作": "Pins the service and adds menu-bar shortcuts",
  "关闭主窗口后 PortDeck 会继续驻留在 macOS 菜单栏，可直接启停受管服务。": "PortDeck remains in the macOS menu bar after the main window closes.",
  "开机后只显示菜单栏图标，不弹出主窗口。": "Shows only the menu-bar icon after login.",
  "切换中文或英文界面。": "Switch between Chinese and English.", "控制健康异常、恢复和普通操作通知。": "Control failure, recovery, and operation notifications.",
  "明确开启后，下次启动时生成本地崩溃诊断；不会自动上传。": "When explicitly enabled, local crash diagnostics start after relaunch and are never uploaded automatically.",
  "自动保留最近 10 份配置备份，日志按大小轮转。": "Keeps 10 configuration backups and rotates logs by size.",
  "自动检查正式版本；下载和安装都由你确认，不会静默安装。": "Checks official releases automatically; download and installation both require confirmation.",
  "把本地服务整理成一个工作台": "Turn local services into one control deck", "1 · 自动发现": "1 · Automatic discovery",
  "启动本机 Web 服务后自动出现在列表。": "Local web services appear automatically after they start.", "2 · 安全纳管": "2 · Safe management",
  "配置启停命令，并在执行前查看风险。": "Configure lifecycle commands and review risk before execution.", "3 · 持续观察": "3 · Continuous monitoring",
  "健康检查、实时日志、异常与恢复通知。": "Health checks, live logs, failure and recovery notifications.",
  "连接中": "Connecting", "运行日志": "Runtime logs", "暂无日志": "No logs yet",
  "正在读取开机启动状态…": "Reading login-launch status…", "语言 / Language": "Language / 语言",
  "已开启登录时静默启动": "Quiet login launch enabled", "未开启登录时启动": "Login launch disabled",
  "PortDeck 首页": "PortDeck home", "服务筛选": "Service filters", "服务排序": "Service sorting",
  "关闭": "Close", "关闭日志": "Close logs", "例如：前端 / 数据服务": "Example: Frontend / Data",
  "开发, API, 重要": "Development, API, Important", "例如：交易工具": "Example: Trading tools",
  "本地服务控制台": "Local service console", "扫描正常": "Scanner ready", "每 5 秒检查本机端口": "Checks local ports every 5 seconds",
  "健康检查通过": "Health checks passed", "最近扫描": "Last scan", "等待扫描": "Waiting", "端口": "Port",
  "健康状态": "Health", "操作": "Actions", "服务详情": "Service details", "已选择": "Selected",
  "选择一个服务查看详情": "Select a service to view details",
  "端口、健康状态、进程和快捷操作会显示在这里。": "Port, health, process details, and quick actions appear here.",
}));

const ENGLISH_RISK_FINDINGS = {
  "privilege-escalation": "The command requests administrator privileges and may modify the whole system.",
  "recursive-delete": "The command force-deletes files recursively; the data may be unrecoverable.",
  "force-kill": "The command force-terminates a process without allowing it to save state.",
  permissions: "The command changes file permissions or ownership.",
  "docker-down": "The command stops and removes Compose containers and networks.",
  "shell-download": "The command downloads and immediately executes a remote script.",
  "system-path": "The command references a system directory and may affect macOS or other apps.",
  "external-process": "The target was not started by PortDeck; its process identity will be verified again.",
};

function isEnglish() {
  return state.preferences?.locale === "en-US";
}

function tr(zh, en) {
  return isEnglish() ? en : zh;
}

function translateTree(root, locale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const trimmed = node.nodeValue.trim();
    if (!trimmed) continue;
    if (!node.__portdeckZh && ENGLISH_TEXT.has(trimmed)) node.__portdeckZh = trimmed;
    if (!node.__portdeckZh) continue;
    const replacement = locale === "en-US" ? ENGLISH_TEXT.get(node.__portdeckZh) : node.__portdeckZh;
    node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), replacement);
  }
  root.querySelectorAll?.("[title], [aria-label], [placeholder]").forEach((node) => {
    for (const attribute of ["title", "aria-label", "placeholder"]) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      const key = `__portdeckZh_${attribute}`;
      if (!node[key] && ENGLISH_TEXT.has(value)) node[key] = value;
      if (node[key]) node.setAttribute(attribute, locale === "en-US" ? ENGLISH_TEXT.get(node[key]) : node[key]);
    }
  });
}

function applyLocale(locale = "zh-CN") {
  document.documentElement.lang = locale;
  translateTree(document.body, locale);
  document.title = locale === "en-US" ? "PortDeck · Local service dashboard" : "PortDeck · 本地服务控制台";
  const searchPlaceholder = locale === "en-US" ? "Search name, port, or command" : "搜索名称、端口或命令";
  elements.search.placeholder = searchPlaceholder;
  FILTER_LABELS.all = locale === "en-US" ? "All services" : "全部服务";
  FILTER_LABELS.running = locale === "en-US" ? "Running" : "正在运行";
  FILTER_LABELS.managed = locale === "en-US" ? "Managed" : "受管服务";
  FILTER_LABELS.discovered = locale === "en-US" ? "Discovered" : "自动发现";
  FILTER_LABELS.offline = locale === "en-US" ? "Offline" : "已离线";
  FILTER_LABELS.unhealthy = locale === "en-US" ? "Unhealthy" : "健康异常";
  FILTER_LABELS.favorites = locale === "en-US" ? "Favorites" : "收藏服务";
  elements.onboardingEnglishButton.textContent = locale === "en-US" ? "切换到中文" : "View in English";
  elements.localeSelect.value = locale;
  renderScanStatus();
  renderDataSafetyStatus();
  renderUpdateStatus();
  if (state.desktop) applyDesktopSettings(state.desktop);
}

function renderScanStatus() {
  if (!state.scannedAt) return;
  if (elements.scanMetric) {
    elements.scanMetric.textContent = tr(
      state.scannedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
      state.scannedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    );
  }
  const englishServiceCount = `${state.summary.total} ${state.summary.total === 1 ? "service" : "services"}`;
  elements.scanStatus.textContent = tr(
    `最近扫描 ${state.scannedAt.toLocaleTimeString("zh-CN", { hour12: false })} · ${state.summary.total} 个服务`,
    `Last scan ${state.scannedAt.toLocaleTimeString("en-US", { hour12: false })} · ${englishServiceCount}`,
  );
}

function englishRecoveryNotice(notice) {
  const restored = notice?.match(/^配置文件损坏，已从备份 (.+) 恢复$/);
  if (restored) return `Configuration was corrupted and restored from backup ${restored[1]}`;
  const quarantined = notice?.match(/^配置文件损坏，已保留为 (.+)；未找到可用备份$/);
  if (quarantined) return `Configuration was corrupted and preserved as ${quarantined[1]}; no valid backup was found`;
  return notice;
}

function renderDataSafetyStatus() {
  const registry = state.dataSafetyRegistry;
  if (!registry) return;
  const englishBackupCount = `${registry.backupCount} ${registry.backupCount === 1 ? "backup" : "backups"}`;
  elements.dataSafetyStatus.textContent = registry.recoveryNotice
    ? (isEnglish() ? englishRecoveryNotice(registry.recoveryNotice) : registry.recoveryNotice)
    : tr(
      `配置 schema v${registry.schemaVersion} · ${registry.backupCount} 份备份 · 日志自动轮转`,
      `Configuration schema v${registry.schemaVersion} · ${englishBackupCount} · automatic log rotation`,
    );
}

function renderUpdateStatus() {
  const status = state.updateStatusInfo;
  if (!status) return;
  const version = status.version || "";
  if (status.state === "browser-unavailable") elements.updateStatus.textContent = tr("浏览器模式无法检查桌面应用更新。", "Desktop updates are unavailable in browser mode.");
  if (status.state === "checking") elements.updateStatus.textContent = tr("正在检查 GitHub Release…", "Checking GitHub Releases…");
  if (status.state === "checking-auto") elements.updateStatus.textContent = tr("正在自动检查更新…", "Checking for updates automatically…");
  if (status.state === "available") elements.updateStatus.textContent = tr(`发现 ${version}，等待下载确认。`, `${version} is available and awaiting download confirmation.`);
  if (status.state === "available-auto") elements.updateStatus.textContent = tr(`发现 ${version}，点击“检查更新”下载。`, `${version} is available. Click “Check for updates” to download.`);
  if (status.state === "current") elements.updateStatus.textContent = tr(`当前 ${version} 已是最新版本。`, `${version} is the latest version.`);
  if (status.state === "downloading") elements.updateStatus.textContent = status.percent == null
    ? tr(`正在下载 ${version}…`, `Downloading ${version}…`)
    : tr(`正在下载更新… ${status.percent}%`, `Downloading update… ${status.percent}%`);
  if (status.state === "downloaded") elements.updateStatus.textContent = status.installPrompt
    ? tr(`${version} 已下载；点击“检查更新”可立即安装。`, `${version} downloaded; click “Check for updates” to install now.`)
    : tr(`${version} 已下载，重启后安装。`, `${version} downloaded; restart to install.`);
  if (status.state === "error") elements.updateStatus.textContent = tr(`更新失败：${status.message}`, `Update failed: ${status.message}`);
}

function setUpdateStatus(status) {
  state.updateStatusInfo = status;
  renderUpdateStatus();
}

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
  if (!value) return tr("工作目录未知", "Working directory unknown");
  const parts = value.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : value;
}

function filteredServices() {
  const filtered = state.services.filter((service) => {
    const filterMatch = state.filter === "all"
      || (state.filter === "running" && service.status === "running")
      || (state.filter === "managed" && service.source === "managed")
      || (state.filter === "discovered" && service.source === "discovered")
      || (state.filter === "offline" && service.status === "offline")
      || (state.filter === "unhealthy" && service.health?.status === "unhealthy")
      || (state.filter === "favorites" && service.favorite);
    if (!filterMatch) return false;
    if (state.workspaceFilter !== "all" && service.workspaceId !== state.workspaceFilter) return false;

    const haystack = [service.name, service.kind, service.port, service.command, service.cwd]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query.toLowerCase());
  });
  const direction = state.preferences?.sortDirection === "desc" ? -1 : 1;
  const sortBy = state.preferences?.sortBy || "status";
  const statusRank = { running: 0, conflict: 1, offline: 2 };
  return filtered.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    let result = 0;
    if (sortBy === "name") result = a.name.localeCompare(b.name);
    else if (sortBy === "port") result = (a.port || a.preferredPort || 99999) - (b.port || b.preferredPort || 99999);
    else if (sortBy === "workspace") result = String(a.workspaceId).localeCompare(String(b.workspaceId));
    else if (sortBy === "manual") result = (a.order || 0) - (b.order || 0);
    else result = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    return result * direction || a.name.localeCompare(b.name);
  });
}

function renderMetrics() {
  state.summary.favorites = state.services.filter((service) => service.favorite).length;
  state.summary.offline = state.services.filter((service) => service.status === "offline").length;
  document.querySelector("#runningMetric").textContent = state.summary.running;
  document.querySelector("#healthyMetric").textContent = state.summary.healthy;
  document.querySelector("#offlineMetric").textContent = state.summary.offline;
  for (const [key, value] of Object.entries(state.summary)) {
    document.querySelectorAll(`[data-count="${key}"]`).forEach((node) => { node.textContent = value; });
  }
}

function actionButtons(service, { expanded = false } = {}) {
  const busy = state.acting.has(service.id) || service.runtime?.operation === "busy" ? " disabled" : "";
  const buttons = [];
  const add = (action, label, className = "") => buttons.push(`<button class="row-action ${className}" data-action="${action}" data-id="${escapeHtml(service.id)}"${busy}>${label}</button>`);

  if (!expanded) {
    if (service.source === "discovered") {
      if (service.status === "running" && service.url) add("open", tr("打开", "Open"), "action-open");
      add("manage", tr("纳入管理", "Manage"), "manage action-manage");
      return buttons.join("");
    }
    if (service.status === "running" && service.url) add("open", tr("打开", "Open"), "action-open");
    if (service.status === "running") add("stop", tr("停止", "Stop"), "stop action-stop");
    if (service.status !== "running") {
      add("start", tr("启动", "Start"), "start action-start");
      add("edit", tr("编辑", "Edit"), "action-edit");
    }
    return buttons.join("");
  }

  if (service.status === "running" && service.url) add("open", tr("浏览器打开", "Open in browser"), "action-open primary-action");
  if (service.source === "managed" && service.status !== "running") add("start", tr("启动服务", "Start service"), "start action-start primary-action");
  if (service.status === "running") add("stop", tr("停止服务", "Stop service"), "stop action-stop");
  if (service.source === "managed" && service.status === "running") add("restart", tr("重新启动", "Restart"), "action-restart");
  if (service.source === "discovered") add("manage", tr("纳入管理", "Manage service"), "manage action-manage");
  if (service.source === "managed") {
    add("logs", tr("查看完整日志", "View full logs"), "action-logs");
    add("edit", tr("编辑配置", "Edit configuration"), "action-edit");
    add("favorite", service.favorite ? tr("取消收藏", "Remove favorite") : tr("加入收藏", "Add favorite"), `favorite action-favorite${service.favorite ? " active" : ""}`);
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
    return `<span class="badge health unhealthy" title="${escapeHtml(health.error || tr("健康检查失败", "Health check failed"))}">UNHEALTHY</span>`;
  }
  if (health.status === "disabled") return '<span class="badge health disabled">CHECK OFF</span>';
  return '<span class="badge health unknown">NO HTTP</span>';
}

function ownershipBadge(service) {
  if (service.status !== "running" || service.source !== "managed") return "";
  if (service.ownership === "portdeck") {
    return `<span class="badge ownership portdeck" title="${tr("当前进程由 PortDeck 启动并持续跟踪", "This process was started and is tracked by PortDeck")}">OWNED</span>`;
  }
  if (service.ownership === "recovered") {
    return `<span class="badge ownership recovered" title="${tr("PortDeck 重启后通过进程身份恢复了管理关系", "PortDeck recovered process ownership after relaunch")}">RECOVERED</span>`;
  }
  return `<span class="badge ownership external" title="${tr("外部进程；停止前会重新验证进程身份", "External process; its identity will be verified before stopping")}">EXTERNAL</span>`;
}

function faviconMarkup(service) {
  if (!service.health?.faviconUrl || service.health.status !== "healthy") return "";
  try {
    const url = new URL(service.health.faviconUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return "";
    return `<img src="${escapeHtml(url.href)}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true" />`;
  } catch {
    return "";
  }
}

function renderService(service) {
  const port = service.port || service.preferredPort;
  const portClass = service.status === "running" ? "" : " offline";
  const runtime = service.status === "running"
    ? `PID ${escapeHtml(service.pid)}${service.elapsed ? ` · ${escapeHtml(service.elapsed)}` : ""}`
    : service.status === "conflict"
      ? tr(`PID ${escapeHtml(service.conflict?.pid)} 正在占用端口`, `PID ${escapeHtml(service.conflict?.pid)} is using the port`)
      : tr("等待启动", "Waiting to start");
  const workspace = state.workspaces.find((item) => item.id === service.workspaceId);
  const selected = state.selected.has(service.id);
  const inspected = state.inspectedServiceId === service.id;
  const health = service.status !== "running"
    ? tr("未运行", "Not running")
    : service.health?.status === "healthy"
      ? tr(`正常 ${Number.isFinite(service.health.latencyMs) ? `${service.health.latencyMs}ms` : ""}`.trim(), `Healthy ${Number.isFinite(service.health.latencyMs) ? `${service.health.latencyMs}ms` : ""}`.trim())
      : service.health?.status === "unhealthy"
        ? tr("检查异常", "Unhealthy")
        : tr("未检查", "Not checked");
  const healthClass = service.health?.status === "unhealthy" ? " unhealthy" : service.status !== "running" ? " offline" : "";
  const source = service.source === "managed" ? tr("受管服务", "Managed") : tr("自动发现", "Discovered");

  return `
    <article class="service-row${selected ? " selected" : ""}${inspected ? " inspected" : ""}" data-status="${escapeHtml(service.status)}" data-inspect-id="${escapeHtml(service.id)}" tabindex="0" aria-label="${escapeHtml(service.name)}">
      <label class="service-select"><input type="checkbox" data-select-id="${escapeHtml(service.id)}"${selected ? " checked" : ""} aria-label="${tr("选择", "Select")} ${escapeHtml(service.name)}" /></label>
      <div class="service-main">
        <div class="service-avatar" data-kind="${escapeHtml(service.kind)}"><span>${escapeHtml(initials(service))}</span>${faviconMarkup(service)}</div>
        <div class="service-copy">
          <div class="service-title">
            <strong title="${escapeHtml(service.name)}">${escapeHtml(service.name)}</strong>
          </div>
          <div class="service-subtitle" title="${escapeHtml(service.cwd)}">${source} · ${escapeHtml(workspace?.name || "Default")}${service.group ? ` / ${escapeHtml(service.group)}` : ""} · ${escapeHtml(shortPath(service.cwd))}</div>
        </div>
      </div>
      <div class="service-port">
        <div class="port-line"><span class="port-pill${portClass}">${port ? `:${escapeHtml(port)}` : tr("无端口", "No port")}</span></div>
        <div class="service-meta">${runtime}</div>
      </div>
      <div class="service-detail">
        <strong class="service-health${healthClass}">${escapeHtml(health)}</strong>
        <div class="service-meta">${escapeHtml(service.kind || service.processName || tr("本地进程", "Local process"))}</div>
      </div>
      <div class="service-actions">${actionButtons(service)}</div>
    </article>`;
}

function inspectorStatus(service) {
  if (service.status === "running") return tr("运行中", "Running");
  if (service.status === "conflict") return tr("端口冲突", "Port conflict");
  return tr("已离线", "Offline");
}

function inspectorHealth(service) {
  if (service.status !== "running") return tr("未运行", "Not running");
  if (service.health?.status === "healthy") return Number.isFinite(service.health.latencyMs) ? `${service.health.latencyMs}ms` : tr("正常", "Healthy");
  if (service.health?.status === "unhealthy") return tr("检查异常", "Unhealthy");
  if (service.health?.status === "disabled") return tr("已关闭", "Disabled");
  return tr("未检查", "Not checked");
}

function renderInspector() {
  if (!elements.inspector) return;
  const service = findService(state.inspectedServiceId);
  if (!service) {
    elements.inspector.innerHTML = `<div class="inspector-empty"><span class="inspector-empty-icon">⌘</span><strong>${tr("选择一个服务查看详情", "Select a service to view details")}</strong><p>${tr("端口、健康状态、进程和快捷操作会显示在这里。", "Port, health, process details, and quick actions appear here.")}</p></div>`;
    return;
  }
  const port = service.port || service.preferredPort || tr("未设置", "Not set");
  const command = service.command || service.startCommand || tr("尚未记录启动命令", "No start command recorded");
  const logs = state.inspectorLogs.get(service.id);
  const logText = logs == null
    ? tr("正在读取最近日志…", "Loading recent logs…")
    : logs || tr("暂无由 PortDeck 启动的日志。", "No logs from a PortDeck-started process yet.");
  const source = service.source === "managed" ? tr("受管服务", "Managed") : tr("自动发现", "Discovered");
  elements.inspector.innerHTML = `
    <div class="inspector-head"><strong>${tr("服务详情", "Service details")}</strong><span>${tr("已选择", "Selected")}</span></div>
    <h2 class="inspector-title">${escapeHtml(service.name)}</h2>
    <span class="inspector-url">${escapeHtml(service.url || `http://127.0.0.1:${port}`)}</span>
    <div class="inspector-actions">${actionButtons(service, { expanded: true })}</div>
    <section class="inspector-group">
      <label>${tr("运行信息", "Runtime")}</label>
      <div class="inspector-grid">
        <div><small>${tr("状态", "Status")}</small><strong>${escapeHtml(inspectorStatus(service))}</strong></div>
        <div><small>${tr("健康", "Health")}</small><strong>${escapeHtml(inspectorHealth(service))}</strong></div>
        <div><small>${tr("进程", "Process")}</small><strong>${service.pid ? `PID ${escapeHtml(service.pid)}` : tr("未运行", "Not running")}</strong></div>
        <div><small>${tr("类型", "Type")}</small><strong>${escapeHtml(service.kind || service.processName || source)}</strong></div>
        <div><small>${tr("端口", "Port")}</small><strong class="mono">:${escapeHtml(port)}</strong></div>
        <div><small>${tr("来源", "Source")}</small><strong>${escapeHtml(source)}</strong></div>
      </div>
    </section>
    <section class="inspector-group"><label>${tr("启动命令", "Start command")}</label><div class="inspector-command">${escapeHtml(command)}</div></section>
    <section class="inspector-group"><label>${tr("最近日志", "Recent logs")}</label><pre class="inspector-log">${escapeHtml(logText)}</pre></section>`;
  translateTree(elements.inspector, state.preferences?.locale || "zh-CN");
}

async function loadInspectorLogs(serviceId) {
  if (!serviceId || state.inspectorLogs.has(serviceId) || state.inspectorLogLoading.has(serviceId)) return;
  const service = findService(serviceId);
  if (!service || service.source !== "managed") {
    state.inspectorLogs.set(serviceId, "");
    if (state.inspectedServiceId === serviceId) renderInspector();
    return;
  }
  state.inspectorLogLoading.add(serviceId);
  try {
    const { logs } = await api(`/api/services/${encodeURIComponent(serviceId)}/logs`);
    state.inspectorLogs.set(serviceId, logs || "");
  } catch {
    state.inspectorLogs.set(serviceId, tr("暂时无法读取日志。", "Logs are temporarily unavailable."));
  } finally {
    state.inspectorLogLoading.delete(serviceId);
    if (state.inspectedServiceId === serviceId) renderInspector();
  }
}

function inspectService(serviceId) {
  if (!findService(serviceId)) return;
  state.inspectedServiceId = serviceId;
  render();
  loadInspectorLogs(serviceId);
}

function render() {
  renderMetrics();
  elements.sectionTitle.textContent = FILTER_LABELS[state.filter];
  const services = filteredServices();
  if (!findService(state.inspectedServiceId) && services.length) {
    state.inspectedServiceId = services[0].id;
    loadInspectorLogs(state.inspectedServiceId);
  }
  elements.bulkBar.hidden = state.selected.size === 0;
  elements.selectedCount.textContent = state.selected.size;
  renderInspector();

  if (state.loading) {
    elements.list.innerHTML = '<div class="loading-row"><span></span><span></span><span></span></div>';
    translateTree(elements.list, state.preferences?.locale || "zh-CN");
    return;
  }
  if (!services.length) {
    elements.list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌁</div>
        <strong>${tr("这里暂时没有服务", "No services here yet")}</strong>
        <p>${state.query ? tr("换个关键词试试", "Try another search") : tr("启动一个本地服务，PortDeck 会自动发现它", "Start a local service and PortDeck will discover it")}</p>
      </div>`;
    translateTree(elements.list, state.preferences?.locale || "zh-CN");
    return;
  }
  elements.list.innerHTML = services.map(renderService).join("");
  translateTree(elements.list, state.preferences?.locale || "zh-CN");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || tr(`请求失败 (${response.status})`, `Request failed (${response.status})`));
    error.details = payload.details;
    throw error;
  }
  return payload;
}

function renderWorkspaceOptions() {
  const currentFilter = state.workspaceFilter;
  elements.workspaceFilter.innerHTML = `<option value="all">${tr("全部工作区", "All workspaces")}</option>${state.workspaces
    .map((workspace) => `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>`).join("")}`;
  elements.workspaceFilter.value = state.workspaces.some((item) => item.id === currentFilter) ? currentFilter : "all";
  elements.serviceWorkspace.innerHTML = state.workspaces
    .map((workspace) => `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>`).join("");
}

async function loadTemplates() {
  const data = await api("/api/templates");
  state.templates = data.templates;
  elements.templateSelect.innerHTML = `<option value="">${tr("自定义配置", "Custom")}</option>${state.templates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join("")}`;
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
    state.workspaces = data.workspaces || state.workspaces;
    state.preferences = data.preferences || state.preferences;
    renderWorkspaceOptions();
    if (state.preferences) {
      elements.sortSelect.value = state.preferences.sortBy;
      elements.localeSelect.value = state.preferences.locale;
      elements.notificationFrequencySelect.value = state.preferences.notificationFrequency;
      elements.crashReportingToggle.checked = state.preferences.crashReportingEnabled;
      if (!state.preferences.onboardingComplete && !elements.onboardingDialog.open) elements.onboardingDialog.showModal();
      applyLocale(state.preferences.locale);
    }
    state.scannedAt = new Date(data.scannedAt);
    renderScanStatus();
  } catch (error) {
    elements.scanStatus.textContent = tr("扫描失败", "Scan failed");
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
    ? tr("已开启登录时静默启动", "Quiet login launch enabled")
    : tr("未开启登录时启动", "Login launch disabled");
  elements.openAtLoginToggle.checked = settings.openAtLogin;
  elements.openAtLoginToggle.disabled = !settings.canOpenAtLogin;
  elements.desktopVersion.textContent = settings.version;
  elements.openAtLoginDescription.textContent = settings.canOpenAtLogin
    ? tr("开机后只显示菜单栏图标，不弹出主窗口。", "Shows only the menu-bar icon after login.")
    : tr("开发模式不会修改 macOS 登录项，请在打包应用中设置。", "Development mode does not change macOS login items.");
}

async function loadDesktopSettings() {
  if (!window.portdeckDesktop?.getSettings) return null;
  const settings = await window.portdeckDesktop.getSettings();
  applyDesktopSettings(settings);
  return settings;
}

async function loadDataSafetyStatus() {
  const diagnostics = await api("/api/system/diagnostics");
  state.dataSafetyRegistry = diagnostics.registry;
  renderDataSafetyStatus();
  return diagnostics;
}

async function createConfigBackup() {
  elements.backupConfigButton.disabled = true;
  try {
    const result = await api("/api/system/backup", { method: "POST" });
    state.dataSafetyRegistry = result.registry;
    renderDataSafetyStatus();
    toast(tr("配置备份已创建", "Configuration backup created"));
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
    toast(tr("诊断报告已导出", "Diagnostics exported"));
  } finally {
    elements.exportDiagnosticsButton.disabled = false;
  }
}

function findService(id) {
  return state.services.find((service) => service.id === id);
}

function setFormValues(service = {}) {
  const fields = ["id", "name", "preferredPort", "kind", "cwd", "startCommand", "stopCommand", "protocol", "healthPath", "notes", "workspaceId", "group"];
  for (const name of fields) {
    const input = elements.form.elements.namedItem(name);
    input.value = service[name] ?? "";
  }
  elements.form.elements.healthCheckEnabled.checked = service.healthCheckEnabled !== false;
  elements.form.elements.autoRestart.checked = Boolean(service.autoRestart);
  elements.form.elements.favorite.checked = Boolean(service.favorite);
  elements.form.elements.tags.value = Array.isArray(service.tags) ? service.tags.join(", ") : "";
  if (!elements.form.elements.protocol.value) elements.form.elements.protocol.value = "http";
  if (!elements.form.elements.healthPath.value) elements.form.elements.healthPath.value = "/";
  if (!elements.form.elements.workspaceId.value) elements.form.elements.workspaceId.value = "default";
}

function openServiceDialog(service = null, mode = "add") {
  elements.form.reset();
  if (mode === "promote") {
    elements.dialogTitle.textContent = tr("纳入服务管理", "Manage discovered service");
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
    elements.dialogTitle.textContent = tr("编辑受管服务", "Edit managed service");
    elements.dialogEyebrow.textContent = "SERVICE CONFIGURATION";
    setFormValues(service);
  } else {
    elements.dialogTitle.textContent = tr("添加受管服务", "Add managed service");
    elements.dialogEyebrow.textContent = "MANAGED SERVICE";
    setFormValues({ protocol: "http", healthPath: "/", healthCheckEnabled: true, autoRestart: false });
  }
  elements.dialog.showModal();
  setTimeout(() => elements.form.elements.name.focus(), 40);
}

function riskLabel(severity) {
  const labels = isEnglish()
    ? { none: "No command", low: "Low risk", medium: "Review required", high: "High risk", critical: "Critical risk" }
    : { none: "无命令", low: "低风险", medium: "需要注意", high: "高风险", critical: "严重风险" };
  return labels[severity] || severity;
}

function confirmRisk(risk, title) {
  return new Promise((resolve) => {
    state.pendingRiskAction = resolve;
    elements.riskTitle.textContent = `${title} · ${riskLabel(risk.severity)}`;
    elements.riskContent.innerHTML = `
      <div class="risk-severity ${escapeHtml(risk.severity)}">${escapeHtml(riskLabel(risk.severity))}</div>
      <code>${escapeHtml(risk.command || "PortDeck process signal")}</code>
      <ul>${risk.findings.length
        ? risk.findings.map((item) => `<li><strong>${escapeHtml(item.severity.toUpperCase())}</strong>${escapeHtml(isEnglish() ? ENGLISH_RISK_FINDINGS[item.id] || item.message : item.message)}</li>`).join("")
        : `<li>${tr("未发现高风险模式。PortDeck 仍会记录这次操作。", "No high-risk pattern found. PortDeck will still audit this action.")}</li>`}</ul>`;
    elements.riskConfirmButton.className = risk.severity === "low" || risk.severity === "none" ? "primary-button" : "danger-button";
    elements.riskDialog.showModal();
  });
}

function finishRisk(confirmed) {
  elements.riskDialog.close();
  const resolve = state.pendingRiskAction;
  state.pendingRiskAction = null;
  resolve?.(confirmed);
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
  if (action === "favorite") {
    await api(`/api/services/${encodeURIComponent(service.id)}`, {
      method: "PUT",
      body: JSON.stringify({ ...service, favorite: !service.favorite }),
    });
    await loadServices({ fresh: false, silent: true });
    return;
  }
  if (["start", "stop", "restart"].includes(action)) {
    const { risk } = await api(`/api/services/${encodeURIComponent(service.id)}/risk/${action}`);
    const verb = action === "start" ? tr("启动", "Start") : action === "stop" ? tr("停止", "Stop") : tr("重启", "Restart");
    const confirmed = await confirmRisk(risk, isEnglish() ? `${verb} “${service.name}”` : `${verb}「${service.name}」`);
    if (!confirmed) return;
    state.inspectorLogs.delete(service.id);
  }

  state.acting.add(service.id);
  render();
  try {
    const result = await api(`/api/services/${encodeURIComponent(service.id)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ riskAcknowledged: true, source: "web" }),
    });
    toast(action === "start"
      ? tr("服务启动命令已执行", "Service start command executed")
      : action === "stop"
        ? result.forced ? tr("服务无响应，已强制停止", "Service was unresponsive and was force-stopped") : tr("服务已安全停止", "Service stopped safely")
        : tr("服务已完成重启", "Service restarted"));
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
  elements.logTitle.textContent = `${service.name} · ${tr("运行日志", "Runtime logs")}`;
  elements.logContent.textContent = tr("正在连接实时日志…", "Connecting to live logs…");
  elements.logLiveStatus.textContent = tr("连接中", "Connecting");
  elements.logLiveStatus.className = "live-dot connecting";
  elements.logDrawer.classList.add("open");
  elements.drawerBackdrop.classList.add("open");
  elements.logDrawer.setAttribute("aria-hidden", "false");
  const source = new EventSource(`/api/services/${encodeURIComponent(service.id)}/logs/stream`);
  state.logSource = source;
  source.addEventListener("open", () => {
    elements.logLiveStatus.textContent = tr("实时", "Live");
    elements.logLiveStatus.className = "live-dot connected";
  });
  source.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "reset") elements.logContent.textContent = payload.text || tr("暂无由 PortDeck 启动的日志。", "No logs from a PortDeck-started process yet.");
      if (payload.type === "append" && payload.text) {
        const placeholders = [
          tr("正在连接实时日志…", "Connecting to live logs…"),
          tr("暂无由 PortDeck 启动的日志。", "No logs from a PortDeck-started process yet."),
        ];
        if (placeholders.includes(elements.logContent.textContent)) {
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
    elements.logLiveStatus.textContent = tr("重连中", "Reconnecting");
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

async function updatePreferences(patch) {
  const data = await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
  state.preferences = data.preferences;
  state.workspaces = data.workspaces;
  renderWorkspaceOptions();
  applyLocale(state.preferences.locale);
  render();
  if (patch.locale && window.portdeckDesktop?.setLocale) {
    await window.portdeckDesktop.setLocale(state.preferences.locale);
  }
  return data.preferences;
}

function downloadJson(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function performBulkAction(action) {
  const targets = state.services.filter((service) => state.selected.has(service.id));
  const risks = [];
  for (const service of targets) {
    try {
      const { risk } = await api(`/api/services/${encodeURIComponent(service.id)}/risk/${action}`);
      risks.push({ ...risk, serviceName: service.name });
    } catch (error) {
      toast(error.message, "error");
      return;
    }
  }
  const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const severity = risks.reduce((highest, item) => rank[item.severity] > rank[highest] ? item.severity : highest, "none");
  const combined = {
    command: risks.map((item) => `${item.serviceName}: ${item.command}`).join("\n"),
    severity,
    findings: risks.flatMap((item) => item.findings.map((finding) => ({ ...finding, message: `${item.serviceName}: ${finding.message}` }))),
  };
  const bulkVerb = action === "start" ? tr("启动", "start") : action === "stop" ? tr("停止", "stop") : tr("重启", "restart");
  if (!await confirmRisk(combined, tr(`批量${bulkVerb} ${targets.length} 项服务`, `${bulkVerb[0].toUpperCase()}${bulkVerb.slice(1)} ${targets.length} selected services`))) return;
  const result = await api("/api/services/bulk", {
    method: "POST",
    body: JSON.stringify({ ids: [...state.selected], action, riskAcknowledged: true, source: "web" }),
  });
  const failures = result.results.filter((item) => !item.ok);
  const succeeded = result.results.length - failures.length;
  toast(
    failures.length
      ? tr(`${succeeded} 项成功，${failures.length} 项失败`, `${succeeded} succeeded, ${failures.length} failed`)
      : tr("批量操作已执行", "Bulk operation completed"),
    failures.length ? "error" : "success",
  );
  state.selected.clear();
  await loadServices({ fresh: true, silent: true });
}

async function showHistory() {
  const { entries } = await api("/api/audit?limit=200");
  elements.historyList.innerHTML = entries.length ? entries.map((entry) => `
    <article class="history-entry ${escapeHtml(entry.outcome)}">
      <span>${new Date(entry.at).toLocaleString()}</span>
      <strong>${escapeHtml(entry.action)}</strong>
      <p>${escapeHtml(entry.serviceName || entry.message || "PortDeck")}</p>
      <code>${escapeHtml(entry.source)} · ${escapeHtml(entry.outcome)}</code>
    </article>`).join("") : `<div class="empty-state"><strong>${tr("还没有操作记录", "No activity recorded yet")}</strong></div>`;
  elements.historyDialog.showModal();
}

async function exportConfig() {
  downloadJson(await api("/api/system/export"), `PortDeck-config-${new Date().toISOString().slice(0, 10)}.json`);
  toast(tr("配置已导出", "Configuration exported"));
}

async function importConfigFile(file) {
  const snapshot = JSON.parse(await file.text());
  const commandCount = Array.isArray(snapshot.services) ? snapshot.services.filter((service) => service.startCommand || service.stopCommand).length : 0;
  const risk = {
    severity: commandCount ? "high" : "medium",
    command: tr(
      `${file.name} · ${commandCount} 个服务包含可执行命令`,
      `${file.name} · ${commandCount} services contain executable commands`,
    ),
    findings: [{ severity: "high", message: tr("导入会把配置文件中的命令加入 PortDeck；请只导入你信任的文件。", "Imported commands become executable by PortDeck; import only files you trust.") }],
  };
  if (!await confirmRisk(risk, tr("导入配置", "Import configuration"))) return;
  const result = await api("/api/system/import", { method: "POST", body: JSON.stringify({ snapshot, mode: "merge" }) });
  toast(tr(`已导入配置，共 ${result.serviceCount} 个服务`, `Configuration imported · ${result.serviceCount} services`));
  await loadServices({ fresh: true, silent: true });
}

async function checkForUpdates() {
  if (!window.portdeckDesktop?.checkForUpdates) {
    setUpdateStatus({ state: "browser-unavailable" });
    return;
  }
  elements.checkUpdateButton.disabled = true;
  setUpdateStatus({ state: "checking" });
  try {
    const result = await window.portdeckDesktop.checkForUpdates();
    setUpdateStatus({ state: result.available ? "available" : "current", version: result.available ? result.latestVersion : result.currentVersion });
    if (result.available && result.canAutoUpdate && window.confirm(tr(
      `发现 PortDeck ${result.latestVersion}，是否下载更新？`,
      `PortDeck ${result.latestVersion} is available. Download it now?`,
    ))) {
      setUpdateStatus({ state: "downloading", version: result.latestVersion });
      await window.portdeckDesktop.downloadUpdate();
      setUpdateStatus({ state: "downloaded", version: result.latestVersion, installPrompt: false });
      if (window.confirm(tr(
        `PortDeck ${result.latestVersion} 已下载，是否现在重启并安装？`,
        `PortDeck ${result.latestVersion} has downloaded. Restart and install now?`,
      ))) {
        await window.portdeckDesktop.installUpdate();
      }
    } else if (result.available && result.releaseUrl && window.confirm(tr(
      `发现 PortDeck ${result.latestVersion}，是否打开下载页面？`,
      `PortDeck ${result.latestVersion} is available. Open the download page?`,
    ))) {
      window.open(result.releaseUrl, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    setUpdateStatus({ state: "error", message: error.message });
  } finally {
    elements.checkUpdateButton.disabled = false;
  }
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
  const selection = event.target.closest("[data-select-id]");
  if (selection) {
    selection.checked ? state.selected.add(selection.dataset.selectId) : state.selected.delete(selection.dataset.selectId);
    render();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (button) {
    const service = findService(button.dataset.id);
    if (service) performAction(service, button.dataset.action).catch((error) => toast(error.message, "error"));
    return;
  }
  const row = event.target.closest("[data-inspect-id]");
  if (row) inspectService(row.dataset.inspectId);
});

elements.list.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const row = event.target.closest("[data-inspect-id]");
  if (!row || event.target.matches("input, button")) return;
  event.preventDefault();
  inspectService(row.dataset.inspectId);
});

elements.inspector?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const service = findService(button.dataset.id);
  if (service) performAction(service, button.dataset.action).catch((error) => toast(error.message, "error"));
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value.trim();
  render();
});

elements.workspaceFilter.addEventListener("change", () => {
  state.workspaceFilter = elements.workspaceFilter.value;
  render();
});
elements.sortSelect.addEventListener("change", () => {
  updatePreferences({ sortBy: elements.sortSelect.value }).catch((error) => toast(error.message, "error"));
});
elements.clearSelectionButton.addEventListener("click", () => { state.selected.clear(); render(); });
document.querySelectorAll("[data-bulk-action]").forEach((button) => {
  button.addEventListener("click", () => performBulkAction(button.dataset.bulkAction).catch((error) => toast(error.message, "error")));
});
elements.riskConfirmButton.addEventListener("click", () => finishRisk(true));
document.querySelectorAll("[data-risk-cancel]").forEach((button) => button.addEventListener("click", () => finishRisk(false)));
elements.riskDialog.addEventListener("cancel", (event) => { event.preventDefault(); finishRisk(false); });
elements.historyButton.addEventListener("click", () => showHistory().catch((error) => toast(error.message, "error")));
document.querySelectorAll("[data-close-history]").forEach((button) => button.addEventListener("click", () => elements.historyDialog.close()));
elements.addWorkspaceButton.addEventListener("click", () => elements.workspaceDialog.showModal());
document.querySelectorAll("[data-close-workspace]").forEach((button) => button.addEventListener("click", () => elements.workspaceDialog.close()));
elements.workspaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/workspaces", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(elements.workspaceForm))) });
    elements.workspaceDialog.close();
    elements.workspaceForm.reset();
    await loadServices({ fresh: false, silent: true });
    toast(tr("工作区已创建", "Workspace created"));
  } catch (error) { toast(error.message, "error"); }
});
elements.templateSelect.addEventListener("change", () => {
  const template = state.templates.find((item) => item.id === elements.templateSelect.value);
  if (!template) return;
  const { id: templateId, ...templateValues } = template;
  const currentName = elements.form.elements.name.value;
  setFormValues({ ...templateValues, id: "", name: currentName || template.name, workspaceId: elements.form.elements.workspaceId.value });
  elements.templateSelect.value = templateId;
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
      toast(enabled ? tr("已开启登录时静默启动", "Quiet login launch enabled") : tr("已关闭登录时启动", "Login launch disabled"));
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
  elements.localeSelect.addEventListener("change", () => {
    updatePreferences({ locale: elements.localeSelect.value }).catch((error) => toast(error.message, "error"));
  });
  elements.notificationFrequencySelect.addEventListener("change", () => {
    updatePreferences({
      notificationFrequency: elements.notificationFrequencySelect.value,
      notificationsEnabled: elements.notificationFrequencySelect.value !== "off",
    }).catch((error) => toast(error.message, "error"));
  });
  elements.crashReportingToggle.addEventListener("change", () => {
    updatePreferences({ crashReportingEnabled: elements.crashReportingToggle.checked })
      .then(() => toast(elements.crashReportingToggle.checked
        ? tr("已开启本地崩溃诊断", "Local crash diagnostics enabled")
        : tr("已关闭崩溃诊断", "Crash diagnostics disabled")))
      .catch((error) => toast(error.message, "error"));
  });
  elements.exportConfigButton.addEventListener("click", () => exportConfig().catch((error) => toast(error.message, "error")));
  elements.importConfigButton.addEventListener("click", () => elements.importConfigFile.click());
  elements.importConfigFile.addEventListener("change", () => {
    const file = elements.importConfigFile.files[0];
    if (file) importConfigFile(file).catch((error) => toast(error.message, "error"));
    elements.importConfigFile.value = "";
  });
  elements.checkUpdateButton.addEventListener("click", checkForUpdates);
  window.portdeckDesktop.onSettingsChanged(applyDesktopSettings);
  window.portdeckDesktop.onUpdateStatus?.((status) => {
    setUpdateStatus({
      ...status,
      state: status.state === "checking" ? "checking-auto"
        : status.state === "available" ? "available-auto"
          : status.state,
      installPrompt: status.state === "downloaded",
    });
  });
  loadDesktopSettings().catch((error) => {
    elements.desktopSettingsSummary.textContent = tr("无法读取桌面设置", "Unable to read desktop settings");
    console.error(error);
  });
}

elements.finishOnboardingButton.addEventListener("click", () => {
  updatePreferences({ onboardingComplete: true })
    .then(() => elements.onboardingDialog.close())
    .catch((error) => toast(error.message, "error"));
});
elements.onboardingEnglishButton.addEventListener("click", () => {
  updatePreferences({ locale: isEnglish() ? "zh-CN" : "en-US" }).catch((error) => toast(error.message, "error"));
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.form));
  const id = formData.id;
  delete formData.id;
  formData.preferredPort = formData.preferredPort ? Number(formData.preferredPort) : null;
  formData.healthCheckEnabled = elements.form.elements.healthCheckEnabled.checked;
  formData.autoRestart = elements.form.elements.autoRestart.checked;
  formData.favorite = elements.form.elements.favorite.checked;
  formData.tags = String(formData.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  delete formData.template;

  try {
    await api(id ? `/api/services/${encodeURIComponent(id)}` : "/api/services", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(formData),
    });
    elements.dialog.close();
    toast(id ? tr("服务配置已更新", "Service configuration updated") : tr("服务已加入管理", "Service added to management"));
    await loadServices({ fresh: true, silent: true });
  } catch (error) {
    toast(error.message, "error");
  }
});

loadTemplates().catch((error) => toast(error.message, "error"));
loadServices({ fresh: true });
setInterval(() => {
  if (document.visibilityState === "visible" && !elements.dialog.open) {
    loadServices({ fresh: true, silent: true });
  }
}, 5000);
