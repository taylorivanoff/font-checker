import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  shell,
  nativeTheme
} from 'electron';
import updater from 'electron-updater';
const { autoUpdater } = updater;
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import {
  createTray,
  updateTrayMenu,
  destroyTray,
  getIconPath
} from './tray.js';
import { checkSite } from '../src/checker.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_NAME = 'Font Checker';
const START_MINIMIZED_ARG = '--start-minimised';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let mainWindow = null;
let splashWindow = null;
let trayHandlers = null;
let isQuitting = false;
let manualUpdateCheck = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  if (!app.isPackaged) {
    try {
      require('electron-reloader')({ filename: __filename, children: [] }, {
        watchRenderer: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/bun.lock', '**/package-lock.json']
      });
    } catch {
      // electron-reloader is a devDependency; ignore if missing.
    }
  }
}

const MIN_WIDTH = 460;
const MIN_HEIGHT = 460;
const DEFAULT_BOUNDS = { width: 760, height: 620 };
let saveBoundsTimer = null;

function normalizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BOUNDS };
  return {
    x: Number.isFinite(raw.x) ? Math.round(raw.x) : undefined,
    y: Number.isFinite(raw.y) ? Math.round(raw.y) : undefined,
    width: Math.max(MIN_WIDTH, Math.round(raw.width || DEFAULT_BOUNDS.width)),
    height: Math.max(MIN_HEIGHT, Math.round(raw.height || DEFAULT_BOUNDS.height))
  };
}

function boundsVisibleOnAnyDisplay(bounds) {
  const displays = screen.getAllDisplays();
  if (!displays.length) return true;
  const cx = (bounds.x ?? 0) + bounds.width / 2;
  const cy = (bounds.y ?? 0) + bounds.height / 2;
  return displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    const onCenter = cx >= x && cx < x + width && cy >= y && cy < y + height;
    const onOrigin = Number.isFinite(bounds.x)
      && Number.isFinite(bounds.y)
      && bounds.x < x + width
      && bounds.x + bounds.width > x
      && bounds.y < y + height
      && bounds.y + bounds.height > y;
    return onCenter || onOrigin;
  });
}

function getWindowBounds() {
  const saved = normalizeBounds(store.getWindowBounds());
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return { width: saved.width, height: saved.height };
  }
  if (!boundsVisibleOnAnyDisplay(saved)) {
    return { width: saved.width, height: saved.height };
  }
  return saved;
}

function saveWindowBounds(immediate = false) {
  const persist = () => {
    saveBoundsTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) return;
    store.setWindowBounds(normalizeBounds(mainWindow.getBounds()));
  };

  if (immediate) {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    persist();
    return;
  }

  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(persist, 150);
}

function createSplash() {
  const splashPath = path.join(app.getAppPath(), 'resources', 'splash.html');
  splashWindow = new BrowserWindow({
    width: 280,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { nodeIntegration: false }
  });
  splashWindow.loadFile(splashPath);
  splashWindow.center();
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

function platformWindowOptions() {
  const isMac = process.platform === 'darwin';
  if (isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 10, y: 7 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    };
  }
  return {
    frame: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f3f3f3',
    autoHideMenuBar: true
  };
}

function applyWindowOpacity(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const opacity = Math.min(1, Math.max(0.35, Number(value) || 0.94));
  mainWindow.setOpacity(opacity);
}

function createWindow() {
  if (mainWindow) return mainWindow;

  const bounds = getWindowBounds();
  const settings = store.getSettings();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    icon: getIconPath(),
    ...platformWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    }, false);
  } else {
    mainWindow.setSize(bounds.width, bounds.height, false);
  }

  mainWindow.setMenu(null);
  applyWindowOpacity(settings.opacity);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    closeSplash();
    applyWindowOpacity(store.getSettings().opacity);
    const startMinimised = process.argv.includes(START_MINIMIZED_ARG) || store.getSettings().startMinimised;
    if (!startMinimised) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('resize', () => saveWindowBounds(false));
  mainWindow.on('move', () => saveWindowBounds(false));
  mainWindow.on('resized', () => saveWindowBounds(true));
  mainWindow.on('moved', () => saveWindowBounds(true));
  mainWindow.on('close', (event) => {
    saveWindowBounds(true);
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('hide', () => saveWindowBounds(true));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function toggleWindow() {
  if (!mainWindow || !mainWindow.isVisible()) showWindow();
  else hideWindow();
}

function syncLoginItemArgs() {
  const login = app.getLoginItemSettings();
  if (!login.openAtLogin) return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: store.getSettings().startMinimised ? [START_MINIMIZED_ARG] : []
  });
}

function applyAlwaysOnTop(value) {
  store.setSettings({ alwaysOnTop: value });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(value);
  if (trayHandlers) updateTrayMenu(trayHandlers, APP_NAME);
  sendToRenderer('settings:changed', store.getSettings());
}

function setStartMinimised(value) {
  store.setSettings({ startMinimised: value });
  syncLoginItemArgs();
  if (trayHandlers) updateTrayMenu(trayHandlers, APP_NAME);
  sendToRenderer('settings:changed', store.getSettings());
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) return;
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (_) {
    manualUpdateCheck = false;
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-not-available', () => {
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', () => {
    manualUpdateCheck = false;
    isQuitting = true;
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on('error', () => {
    manualUpdateCheck = false;
  });

  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
}

function resolveOutDir(requested) {
  const settings = store.getSettings();
  const chosen = (requested || settings.outDir || '').trim();
  if (chosen) return chosen;
  return path.join(app.getPath('documents'), 'Font Checker');
}

function registerIpc() {
  ipcMain.handle('app:getState', () => ({
    settings: store.getSettings(),
    platform: process.platform,
    version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors
  }));

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:set', (_e, partial) => {
    const prev = store.getSettings();
    const settings = store.setSettings(partial || {});
    if (partial?.alwaysOnTop !== undefined && partial.alwaysOnTop !== prev.alwaysOnTop) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
    }
    if (partial?.opacity !== undefined) applyWindowOpacity(settings.opacity);
    if (partial?.startMinimised !== undefined) syncLoginItemArgs();
    if (trayHandlers) updateTrayMenu(trayHandlers, APP_NAME);
    sendToRenderer('settings:changed', settings);
    return settings;
  });

  ipcMain.handle('dialog:pickFolder', async (_e, title = 'Choose output folder') => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('fonts:scan', async (_e, payload = {}) => {
    const url = String(payload.url || '').trim();
    if (!url) return { ok: false, error: 'Enter a page URL.' };

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'Invalid URL.' };
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      return { ok: false, error: 'URL must start with http:// or https://' };
    }

    const settings = store.getSettings();
    const mode = payload.mode || settings.mode || 'convert';
    const download = mode === 'download' || mode === 'convert';
    const convert = mode === 'convert';
    const outDir = resolveOutDir(payload.outDir);
    const timeoutMs = Number(payload.timeoutMs) || settings.timeoutMs;

    store.setSettings({ mode, outDir, timeoutMs });
    store.pushRecentUrl(parsed.href);
    sendToRenderer('settings:changed', store.getSettings());
    sendToRenderer('fonts:status', { status: 'running', url: parsed.href });

    try {
      const result = await checkSite(parsed.href, {
        download,
        convert,
        outDir,
        timeoutMs
      });
      const payloadOut = {
        ok: true,
        url: result.url,
        checkedAt: result.checkedAt,
        warnings: result.warnings || [],
        fonts: result.fonts || [],
        outDir: download || convert ? outDir : null
      };
      sendToRenderer('fonts:status', { status: 'done', url: parsed.href, count: payloadOut.fonts.length });
      return payloadOut;
    } catch (err) {
      const error = err?.message || String(err);
      sendToRenderer('fonts:status', { status: 'error', url: parsed.href, error });
      return { ok: false, error };
    }
  });

  ipcMain.handle('shell:showItem', (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle('shell:openPath', async (_e, targetPath) => {
    if (!targetPath) return { ok: false };
    const err = await shell.openPath(targetPath);
    return { ok: !err, error: err || null };
  });
}

app.whenReady().then(() => {
  syncLoginItemArgs();
  createSplash();
  registerIpc();
  createWindow();

  trayHandlers = {
    showWindow,
    hideWindow,
    toggleWindow,
    getSettings: () => store.getSettings(),
    setAlwaysOnTop: applyAlwaysOnTop,
    setStartMinimised,
    checkForUpdates: () => checkForUpdates(true),
    quit: () => {
      isQuitting = true;
      app.quit();
    }
  };
  createTray(getIconPath(), trayHandlers, APP_NAME);
  setupAutoUpdater();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowBounds(true);
  closeSplash();
  destroyTray();
});
