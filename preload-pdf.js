const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfData', {
  onData: (cb) => ipcRenderer.on('pdf-data', (_e, payload) => cb(payload)),
  ready: () => ipcRenderer.send('pdf-ready'),
});
