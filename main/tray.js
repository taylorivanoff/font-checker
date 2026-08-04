import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'node:path';

let tray = null;

export function createTray(iconPath, handlers, appName) {
  if (tray) return tray;

  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  if (process.platform === 'darwin') {
    image = image.resize({ width: 18, height: 18 });
    image.setTemplateImage(true);
  } else if (!image.isEmpty()) {
    image = image.resize({ width: 16, height: 16 });
  }

  tray = new Tray(image);
  tray.setToolTip(appName);
  updateTrayMenu(handlers, appName);

  tray.on('click', () => handlers.toggleWindow());
  tray.on('double-click', () => handlers.showWindow());
  return tray;
}

export function updateTrayMenu(handlers, appName) {
  if (!tray || tray.isDestroyed()) return;
  const settings = handlers.getSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Show ${appName}`, click: () => handlers.showWindow() },
    { label: `Hide ${appName}`, click: () => handlers.hideWindow() },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: !!settings.alwaysOnTop,
      click: (item) => handlers.setAlwaysOnTop(item.checked)
    },
    {
      label: 'Start Minimised',
      type: 'checkbox',
      checked: !!settings.startMinimised,
      click: (item) => handlers.setStartMinimised(item.checked)
    },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => handlers.checkForUpdates() },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => handlers.quit() }
  ]));
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

export function getIconPath(appPath) {
  return path.join(appPath || app.getAppPath(), 'resources', 'icon.png');
}
