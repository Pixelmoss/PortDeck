export function buildLoginItemSettings(enabled) {
  return {
    openAtLogin: Boolean(enabled),
    openAsHidden: Boolean(enabled),
  };
}

export function isHiddenLaunch({ wasOpenedAtLogin = false, argv = [] } = {}) {
  return Boolean(wasOpenedAtLogin || argv.includes("--hidden"));
}

export function desktopSettingsSnapshot({
  appVersion,
  isPackaged,
  loginItemSettings = {},
  startedHidden = false,
} = {}) {
  return {
    version: appVersion || "0.0.0",
    canOpenAtLogin: Boolean(isPackaged),
    openAtLogin: Boolean(loginItemSettings.openAtLogin),
    startedHidden: Boolean(startedHidden),
  };
}
