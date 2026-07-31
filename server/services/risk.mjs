const RULES = [
  { id: "privilege-escalation", severity: "critical", pattern: /(^|[;&|]\s*)sudo\s+/i, message: "命令请求管理员权限，可能修改整个系统。" },
  { id: "recursive-delete", severity: "critical", pattern: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, message: "命令包含递归强制删除，数据可能无法恢复。" },
  { id: "force-kill", severity: "high", pattern: /\b(?:kill\s+-9|pkill\s+-9|killall\s+-9)\b/i, message: "命令会强制终止进程，进程没有机会保存状态。" },
  { id: "permissions", severity: "high", pattern: /\b(?:chmod|chown)\s+(?:-[a-z]+\s+)?(?:-R\s+)?/i, message: "命令会修改文件权限或所有者。" },
  { id: "docker-down", severity: "medium", pattern: /\bdocker(?:-compose|\s+compose)\s+down\b/i, message: "命令会停止并移除 Compose 容器和网络。" },
  { id: "shell-download", severity: "high", pattern: /\b(?:curl|wget)\b[^\n|]*(?:\||\$\()\s*(?:sh|bash|zsh)\b/i, message: "命令会下载并立即执行远程脚本。" },
  { id: "system-path", severity: "high", pattern: /(?:^|\s)(?:\/System|\/Library|\/usr|\/etc)\//, message: "命令引用系统目录，可能影响其他应用或 macOS。" },
];

const RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function previewCommandRisk(command, { action = "execute", external = false } = {}) {
  const normalized = typeof command === "string" ? command.trim() : "";
  const findings = RULES.filter((rule) => rule.pattern.test(normalized)).map(({ pattern, ...rule }) => rule);
  if (external) {
    findings.push({ id: "external-process", severity: "medium", message: "目标进程不是由 PortDeck 启动；执行前会再次验证进程身份。" });
  }
  const severity = findings.reduce(
    (highest, item) => RANK[item.severity] > RANK[highest] ? item.severity : highest,
    normalized ? "low" : "none",
  );
  return { action, command: normalized, severity, requiresAcknowledgement: RANK[severity] >= RANK.medium, findings };
}

export function riskForServiceAction(service, action) {
  if (action === "stop") {
    return previewCommandRisk(service.stopCommand || "SIGTERM", { action, external: service.ownership === "external" });
  }
  return previewCommandRisk(service.startCommand || service.command || "", { action });
}
