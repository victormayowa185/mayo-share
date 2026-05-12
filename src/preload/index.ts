import { contextBridge, ipcRenderer } from 'electron';

interface FolderFile {
  absolute: string;
  relative: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  startHotspot: () => ipcRenderer.invoke('start-hotspot'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  getHostname: () => ipcRenderer.invoke('get-hostname'),
  selectFolder: (): Promise<FolderFile[] | null> => ipcRenderer.invoke('select-folder'),
  startFileServer: (files: (string | FolderFile)[]): Promise<string> =>
    ipcRenderer.invoke('start-file-server', files),
  stopFileServer: () => ipcRenderer.invoke('stop-file-server'),
  getFileSize: (filePath: string) => ipcRenderer.invoke('get-file-size', filePath),
  onDownloadUpdate: (callback: (data: { event: string; fileName: string }) => void) => {
    ipcRenderer.on('download-update', (_event, data) => callback(data));
  },
  compressSDP: (sdp: string) => ipcRenderer.invoke('compress-sdp', sdp),
  decompressSDP: (compact: string) => ipcRenderer.invoke('decompress-sdp', compact),
  ping: () => ipcRenderer.invoke('ping'),
  readFileChunk: (filePath: string, start: number, size: number) => ipcRenderer.invoke('read-file-chunk', filePath, start, size),
  createReceiveFile: (filePath: string) => ipcRenderer.invoke('create-receive-file', filePath),
  appendReceiveChunk: (filePath: string, data: string) => ipcRenderer.invoke('append-receive-chunk', filePath, data),
  saveResumeState: (transferId: string, offset: number, filePath: string) => ipcRenderer.invoke('save-resume-state', transferId, offset, filePath),
  getResumeState: (transferId: string) => ipcRenderer.invoke('get-resume-state', transferId),
  clearResumeState: (transferId: string) => ipcRenderer.invoke('clear-resume-state', transferId),
  getClipboardFiles: () => ipcRenderer.invoke('get-clipboard-files'),
  saveTempFile: (fileName: string, base64Data: string) => ipcRenderer.invoke('save-temp-file', fileName, base64Data),
});