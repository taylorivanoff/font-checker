/**
 * Facade matching the Electron preload API (window.fontChecker).
 * Requires vendor/tauri-tray-bridge.js and withGlobalTauri.
 */
(function () {
  const bridge = window.tauriTrayBridge;
  if (!bridge) {
    console.error("tauriTrayBridge missing — load vendor/tauri-tray-bridge.js first");
    return;
  }

  const IPC_TIMEOUT_MS = 30_000;
  const SCAN_TIMEOUT_MS = 10 * 60_000;

  function invoke(cmd, args, timeoutMs) {
    const ms = timeoutMs == null ? IPC_TIMEOUT_MS : timeoutMs;
    return Promise.race([
      bridge.invoke(cmd, args || {}),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`IPC timeout (${cmd})`)), ms);
      }),
    ]);
  }

  function onEvent(event, cb) {
    let unlisten = null;
    bridge.listen(event, cb).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }

  window.fontChecker = {
    getState: () => bridge.getAppState(),
    getSettings: () => bridge.getSettings(),
    setSettings: (partial) => bridge.setSettings(partial),
    pickFolder: (title) => invoke("dialog_pick_folder", { title: title || null }),
    scan: (payload) => invoke("fonts_scan", { payload: payload || {} }, SCAN_TIMEOUT_MS),
    showItemInFolder: (filePath) => invoke("shell_show_item", { filePath }),
    openPath: (targetPath) => invoke("shell_open_path", { targetPath }),
    onSettingsChanged: (cb) => bridge.onSettingsChanged(cb),
    onStatus: (cb) => onEvent("fonts:status", cb),
  };
})();
