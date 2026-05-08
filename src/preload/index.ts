import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  startHotspot: () => ipcRenderer.invoke('start-hotspot'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  startFileServer: (filePath: string) => ipcRenderer.invoke('start-file-server', filePath),
  stopFileServer: () => ipcRenderer.invoke('stop-file-server'),
  getFileSize: (filePath: string) => ipcRenderer.invoke('get-file-size', filePath),
  onDownloadUpdate: (callback: (status: string) => void) => {
    ipcRenderer.on('download-update', (_event, status: string) => callback(status));
  },
  compressSDP: (sdp: string) => ipcRenderer.invoke('compress-sdp', sdp),
  decompressSDP: (compact: string) => ipcRenderer.invoke('decompress-sdp', compact),
  ping: () => ipcRenderer.invoke('ping'),
  readFileChunk: (filePath: string, start: number, size: number) => ipcRenderer.invoke('read-file-chunk', filePath, start, size),
  createReceiveFile: (filePath: string) => ipcRenderer.invoke('create-receive-file', filePath),
  appendReceiveChunk: (filePath: string, data: string) => ipcRenderer.invoke('append-receive-chunk', filePath, data),
});