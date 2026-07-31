function matchesManaged(managed, discovered) {
  if (managed.lastPid && managed.lastPid === discovered.pid) return true;
  if (managed.cwd && discovered.cwd) {
    return managed.cwd === discovered.cwd
      && (!managed.preferredPort || managed.preferredPort === discovered.port);
  }
  return Boolean(managed.preferredPort && managed.preferredPort === discovered.port);
}

export function buildCatalog(managedServices, discoveredServices, dashboardPort) {
  const claimed = new Set();
  const managed = managedServices.map((service) => {
    const running = discoveredServices.find((item) => {
      const key = `${item.pid}:${item.port}`;
      return !claimed.has(key) && matchesManaged(service, item);
    });

    if (running) claimed.add(`${running.pid}:${running.port}`);
    const preferredPortOwner = service.preferredPort
      ? discoveredServices.find((item) => item.port === service.preferredPort)
      : null;
    const conflict = !running && preferredPortOwner ? preferredPortOwner : null;

    return {
      ...service,
      source: "managed",
      status: running ? "running" : conflict ? "conflict" : "offline",
      pid: running?.pid || null,
      port: running?.port || service.preferredPort,
      url: running?.port
        ? `${service.protocol || "http"}://127.0.0.1:${running.port}`
        : service.preferredPort
          ? `${service.protocol || "http"}://127.0.0.1:${service.preferredPort}`
          : null,
      command: running?.command || service.startCommand,
      elapsed: running?.elapsed || null,
      processName: running?.processName || null,
      conflict: conflict
        ? { pid: conflict.pid, processName: conflict.processName, command: conflict.command }
        : null,
    };
  });

  const discovered = discoveredServices
    .filter((item) => !claimed.has(`${item.pid}:${item.port}`))
    .filter((item) => item.port !== dashboardPort)
    .filter((item) => item.visibility !== "hidden")
    .map((item) => ({
      ...item,
      id: `discovered_${item.pid}_${item.port}`,
      source: "discovered",
      status: "running",
      preferredPort: item.port,
      startCommand: "",
      stopCommand: "",
      healthPath: "/",
      healthCheckEnabled: true,
      protocol: "http",
    }));

  return [...managed, ...discovered].sort((a, b) => {
    const rank = { running: 0, conflict: 1, offline: 2 };
    return (rank[a.status] - rank[b.status]) || (a.port || 99999) - (b.port || 99999);
  });
}
