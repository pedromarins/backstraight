const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pill', {
  show: () => ipcRenderer.send('pill-show'),
  hide: () => ipcRenderer.send('pill-hide'),
});

contextBridge.exposeInMainWorld('config', {
  get: () => ipcRenderer.invoke('get-config'),
  save: (cfg) => ipcRenderer.invoke('save-config', cfg),
  onChange: (cb) => ipcRenderer.on('config-changed', (_e, cfg) => cb(cfg)),
});

contextBridge.exposeInMainWorld('onboarding', {
  complete: () => ipcRenderer.send('onboarding-complete'),
});

contextBridge.exposeInMainWorld('monitoring', {
  onPause: (cb) => ipcRenderer.on('monitoring-pause', cb),
  onResume: (cb) => ipcRenderer.on('monitoring-resume', cb),
});

contextBridge.exposeInMainWorld('stats', {
  flush: (snapshot) => ipcRenderer.send('stats-flush', snapshot),
  getDaily: (dateStr) => ipcRenderer.invoke('get-daily-stats', dateStr),
  getWeekly: (weekStartStr) => ipcRenderer.invoke('get-weekly-stats', weekStartStr),
  getMonthly: (yearMonth) => ipcRenderer.invoke('get-monthly-stats', yearMonth),
  getRange: () => ipcRenderer.invoke('get-stats-range'),
});

contextBridge.exposeInMainWorld('report', {
  exportPDF: (payload) => ipcRenderer.invoke('export-pdf', payload),
});
