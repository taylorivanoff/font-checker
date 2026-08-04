const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fontChecker', {
  getState: () => ipcRenderer.invoke('app:getState'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', title),
  scan: (payload) => ipcRenderer.invoke('fonts:scan', payload),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  onSettingsChanged: (cb) => {
    const listener = (_e, settings) => cb(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  onStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('fonts:status', listener);
    return () => ipcRenderer.removeListener('fonts:status', listener);
  }
});
