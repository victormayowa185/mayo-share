import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  startHotspot: () => ipcRenderer.invoke('start-hotspot'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  startFileServer: (filePath: string) => ipcRenderer.invoke('start-file-server', filePath),
  stopFileServer: () => ipcRenderer.invoke('stop-file-server'),
  ping: () => ipcRenderer.invoke('ping'),
});