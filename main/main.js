import { app, ipcMain, dialog, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const loadElectronTrayBase = require('./load-electron-tray-base.cjs');
const { configureAppIsolation, run } = loadElectronTrayBase();

configureAppIsolation({
  appId: 'io.github.taylorivanoff.font-checker',
  appName: 'Font Checker'
});

import * as store from './store.js';
import { checkSite } from '../src/checker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'Font Checker';

function resolveOutDir(requested) {
  const settings = store.getSettings();
  const chosen = (requested || settings.outDir || '').trim();
  if (chosen) return chosen;
  return path.join(app.getPath('documents'), 'Font Checker');
}

run({
  appName: APP_NAME,
  appId: 'io.github.taylorivanoff.font-checker',
  iconPath: path.join(app.getAppPath(), 'resources', 'icon.png'),
  splashPath: path.join(app.getAppPath(), 'resources', 'splash.html'),
  store: { instance: store.prefsStore },
  window: {
    html: path.join(__dirname, '..', 'renderer', 'index.html'),
    preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
    minWidth: 460,
    minHeight: 460,
    defaultBounds: { width: 760, height: 620 },
    fullscreenable: false
  },
  dev: { entryModule: { filename: fileURLToPath(import.meta.url) } },
  hooks: {
    getSettings: () => store.getSettings(),
    setSettings: (partial) => store.setSettings(partial),
    getAppState: () => ({
      settings: store.getSettings(),
      platform: process.platform,
      version: app.getVersion(),
      dark: nativeTheme.shouldUseDarkColors
    }),
    registerIpc: ({ sendToRenderer, getMainWindow }) => {
      ipcMain.handle('dialog:pickFolder', async () => {
        const win = getMainWindow();
        const result = await dialog.showOpenDialog(win, {
          title: 'Choose output folder',
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
  }
});
