import { contextBridge, ipcRenderer } from "electron";

interface FolderFile {
  absolute: string;
  relative: string;
}

interface ActivityEntry {
  type: string;
  fileName: string;
  timestamp: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  checkHotspotStatus: () => ipcRenderer.invoke("check-hotspot-status"),
  getWifiSSID: (): Promise<string | null> =>
    ipcRenderer.invoke("get-wifi-ssid"),
  getActivity: (): Promise<ActivityEntry[]> => ipcRenderer.invoke("get-activity"),

  onActivityUpdated: (callback: (entry: ActivityEntry) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: ActivityEntry) => callback(entry);
    ipcRenderer.on("activity-updated", handler);
    return () => ipcRenderer.removeListener("activity-updated", handler);
  },

  onDeviceNameChanged: (callback: (name: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, name: string) => callback(name);
    ipcRenderer.on("device-name-changed", handler);
    return () => ipcRenderer.removeListener("device-name-changed", handler);
  },

  onDownloadProgress: (callback: (data: { fileName: string; percent: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("download-progress", handler);
    return () => ipcRenderer.removeListener("download-progress", handler);
  },

  startFileServer: (files: (string | FolderFile)[], ip?: string, message?: string): Promise<string> =>
    ipcRenderer.invoke("start-file-server", files, ip, message),

  getPlatform: () => ipcRenderer.invoke("get-platform"),

  submitRating: (data: any) => ipcRenderer.invoke("submit-rating", data),
  getTranslations: (lang: string) =>
    ipcRenderer.invoke("get-translations", lang),
  launchHardwareWizard: () => ipcRenderer.invoke("launch-hardware-wizard"),
  setDeviceName: (name: string) => ipcRenderer.invoke("set-device-name", name),
  clearActivity: () => ipcRenderer.invoke("clear-activity"),

  onActivityCleared: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("activity-cleared", handler);
    return () => ipcRenderer.removeListener("activity-cleared", handler);
  },

  getLanguage: () => ipcRenderer.invoke("get-language"),
  setLanguage: (lang: string) => ipcRenderer.invoke("set-language", lang),
  getSavePath: () => ipcRenderer.invoke("get-save-path"),
  setSavePath: (path: string) => ipcRenderer.invoke("set-save-path", path),
  selectSaveFolder: () => ipcRenderer.invoke("select-save-folder"),
  fixFirewall: () => ipcRenderer.invoke("fix-firewall"),
  diagnoseNetwork: () => ipcRenderer.invoke("diagnose-network"),
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke("read-text-file", filePath),
  writeTextFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("write-text-file", filePath, content),
  startHotspot: () => ipcRenderer.invoke("start-hotspot"),
  selectFile: () => ipcRenderer.invoke("select-file"),
  getHostname: () => ipcRenderer.invoke("get-hostname"),
  selectFolder: (): Promise<FolderFile[] | null> =>
    ipcRenderer.invoke("select-folder"),

  getLocalIP: (): Promise<string | null> => ipcRenderer.invoke("get-local-ip"),

  // ---------- 4-Digit Code P2P ----------
  generateCode: (sdpOffer: string): Promise<string> =>
    ipcRenderer.invoke("generate-code", sdpOffer),
  joinByCode: (senderIP: string, code: string): Promise<string> =>
    ipcRenderer.invoke("join-by-code", senderIP, code),
  submitAnswer: (senderIP: string, code: string, answerSDP: string): Promise<void> =>
    ipcRenderer.invoke("submit-answer", senderIP, code, answerSDP),
  stopSignaling: (): Promise<void> =>
    ipcRenderer.invoke("stop-signaling"),

  onAnswerReceived: (callback: (answerSDP: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, answerSDP: string) => callback(answerSDP);
    ipcRenderer.on("answer-received", handler);
    return () => ipcRenderer.removeListener("answer-received", handler);
  },

  approveSender: (sessionId: string) =>
    ipcRenderer.invoke("approve-sender", sessionId),
  declineSender: (sessionId: string) =>
    ipcRenderer.invoke("decline-sender", sessionId),

  onSenderConnected: (callback: (data: { sessionId: string; senderName: string; deviceType: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("sender-connected", handler);
    return () => ipcRenderer.removeListener("sender-connected", handler);
  },

  stopFileServer: () => ipcRenderer.invoke("stop-file-server"),
  getFileSize: (filePath: string) =>
    ipcRenderer.invoke("get-file-size", filePath),

  onDownloadUpdate: (callback: (data: { event: string; fileName: string; clientIp?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("download-update", handler);
    return () => ipcRenderer.removeListener("download-update", handler);
  },

  // ---------- Upload server (Receive from Browser) ----------
  startUploadServer: (ip?: string): Promise<string> =>
    ipcRenderer.invoke("start-upload-server", ip),
  stopUploadServer: () => ipcRenderer.invoke("stop-upload-server"),

  onUploadUpdate: (callback: (data: { event: string; fileName: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("upload-update", handler);
    return () => ipcRenderer.removeListener("upload-update", handler);
  },

  compressSDP: (sdp: string) => ipcRenderer.invoke("compress-sdp", sdp),
  decompressSDP: (compact: string) =>
    ipcRenderer.invoke("decompress-sdp", compact),
  ping: () => ipcRenderer.invoke("ping"),
  readFileChunk: (filePath: string, start: number, size: number) =>
    ipcRenderer.invoke("read-file-chunk", filePath, start, size),
  createReceiveFile: (filePath: string) =>
    ipcRenderer.invoke("create-receive-file", filePath),
  appendReceiveChunk: (filePath: string, data: string) =>
    ipcRenderer.invoke("append-receive-chunk", filePath, data),
  saveResumeState: (transferId: string, offset: number, filePath: string) =>
    ipcRenderer.invoke("save-resume-state", transferId, offset, filePath),
  getResumeState: (transferId: string) =>
    ipcRenderer.invoke("get-resume-state", transferId),
  clearResumeState: (transferId: string) =>
    ipcRenderer.invoke("clear-resume-state", transferId),
  getClipboardFiles: () => ipcRenderer.invoke("get-clipboard-files"),
  saveTempFile: (fileName: string, base64Data: string) =>
    ipcRenderer.invoke("save-temp-file", fileName, base64Data),

  // ==================== ADDED FOR P2P ACTIVITY & FULL PASTE SUPPORT ====================
  logP2pActivity: (type: "sent" | "received", fileName: string) =>
    ipcRenderer.invoke("log-p2p-activity", type, fileName),
  isDirectory: (filePath: string) => ipcRenderer.invoke("is-directory", filePath),
  walkDirectory: (dirPath: string) => ipcRenderer.invoke("walk-directory", dirPath),
});