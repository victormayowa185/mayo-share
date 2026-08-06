import { contextBridge, ipcRenderer, webUtils } from "electron";


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
 
  setDeviceName: (name: string) => ipcRenderer.invoke("set-device-name", name),
  clearActivity: () => ipcRenderer.invoke("clear-activity"),

  onActivityCleared: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("activity-cleared", handler);
    return () => ipcRenderer.removeListener("activity-cleared", handler);
  },

  getLanguage: () => ipcRenderer.invoke("get-language"),
  setLanguage: (lang: string) => ipcRenderer.invoke("set-language", lang),
  isLanguageSet: () => ipcRenderer.invoke("is-language-set"),
  getSavePath: () => ipcRenderer.invoke("get-save-path"),
  getDiskSpace: () => ipcRenderer.invoke("get-disk-space"),
  setSavePath: (path: string) => ipcRenderer.invoke("set-save-path", path),
  selectSaveFolder: () => ipcRenderer.invoke("select-save-folder"),
  fixFirewall: () => ipcRenderer.invoke("fix-firewall"),
  diagnoseNetwork: () => ipcRenderer.invoke("diagnose-network"),
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke("read-text-file", filePath),
  writeTextFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("write-text-file", filePath, content),

  selectFile: () => ipcRenderer.invoke("select-file"),
  getHostname: () => ipcRenderer.invoke("get-hostname"),
  selectFolder: (): Promise<FolderFile[] | null> =>
    ipcRenderer.invoke("select-folder"),

  getLocalIP: (): Promise<string | null> => ipcRenderer.invoke("get-local-ip"),

  // ═══════════════════════════════════════════════════════════════════════
  // NEW: P2P Manager API (replaces old WebRTC 4-digit code signaling)
  // ═══════════════════════════════════════════════════════════════════════
  p2pHostStart: (): Promise<{ code: string; ip: string; port: number }> =>
    ipcRenderer.invoke("p2p-host-start"),
  p2pHostStop: (): Promise<void> => ipcRenderer.invoke("p2p-host-stop"),
  p2pJoin: (ip: string, code: string): Promise<void> => ipcRenderer.invoke("p2p-join", ip, code),
  p2pDisconnect: (): Promise<void> => ipcRenderer.invoke("p2p-disconnect"),
  p2pSendControl: (msg: any): Promise<void> => ipcRenderer.invoke("p2p-send-control", msg),
  p2pCancelSend: (): Promise<void> => ipcRenderer.invoke("p2p-cancel-send"),
  p2pSendFile: (filePath: string, offset: number, size: number, signerId: string | null): Promise<void> =>
    ipcRenderer.invoke("p2p-send-file", filePath, offset, size, signerId),
  p2pBeginReceive: (id: string, savePath: string, resume: boolean, verifierId: string | null): Promise<void> =>
    ipcRenderer.invoke("p2p-begin-receive", id, savePath, resume, verifierId),
  p2pEndReceive: (): Promise<void> => ipcRenderer.invoke("p2p-end-receive"),

  onP2PConnected: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("p2p-connected", handler);
    return () => ipcRenderer.removeListener("p2p-connected", handler);
  },
  onP2PDisconnected: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("p2p-disconnected", handler);
    return () => ipcRenderer.removeListener("p2p-disconnected", handler);
  },
  onP2PControl: (cb: (msg: any) => void): (() => void) => {
    const handler = (_e: any, msg: any) => cb(msg);
    ipcRenderer.on("p2p-control", handler);
    return () => ipcRenderer.removeListener("p2p-control", handler);
  },
  onP2PSendProgress: (cb: (p: { filePath: string; sentTotal: number; size: number }) => void): (() => void) => {
    const handler = (_e: any, p: any) => cb(p);
    ipcRenderer.on("p2p-send-progress", handler);
    return () => ipcRenderer.removeListener("p2p-send-progress", handler);
  },
  onP2PReceiveProgress: (cb: (p: { id: string; chunkLength: number }) => void): (() => void) => {
    const handler = (_e: any, p: any) => cb(p);
    ipcRenderer.on("p2p-receive-progress", handler);
    return () => ipcRenderer.removeListener("p2p-receive-progress", handler);
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

  ping: () => ipcRenderer.invoke("ping"),

  // DELETED: Old WebRTC signaling APIs (replaced by P2PManager)
  // - generateCode, joinByCode, submitAnswer, stopSignaling
  // - onAnswerReceived
  // - compressSDP, decompressSDP
  // - getIceServers
  // - readFileChunk, appendReceiveChunk (no longer called from renderer)
  // createReceiveFile and finishReceiveFile kept for now (can fold into p2pBeginReceive/p2pEndReceive later)

  createReceiveFile: (filePath: string, resume?: boolean) =>
    ipcRenderer.invoke("create-receive-file", filePath, resume),
  finishReceiveFile: (filePath: string) =>
    ipcRenderer.invoke("finish-receive-file", filePath),
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

  // Modern Electron removed File.path — this returns the real on-disk path for a
  // dragged-and-dropped File/folder. Runs in the preload, not over IPC.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getIntegrityCheck: () => ipcRenderer.invoke('get-integrity-check'),
  setIntegrityCheck: (enabled: boolean) => ipcRenderer.invoke('set-integrity-check', enabled),
  getWebEncryption: () => ipcRenderer.invoke('get-web-encryption'),
  setWebEncryption: (enabled: boolean) => ipcRenderer.invoke('set-web-encryption', enabled),
  startStreamSign: () => ipcRenderer.invoke('start-stream-sign'),
  streamSignChunk: (signerKey: string, chunk: Uint8Array) => ipcRenderer.invoke('stream-sign-chunk', signerKey, chunk),
  finishStreamSign: (signerKey: string) => ipcRenderer.invoke('finish-stream-sign', signerKey),

  // ---------- Solana offline integrity ----------
  getPublicKey: () => ipcRenderer.invoke("get-public-key"),
  signFile: (filePath: string) => ipcRenderer.invoke("sign-file", filePath),
  verifyFile: (filePath: string, signature: string, senderPublicKey: string) =>
    ipcRenderer.invoke("verify-file", filePath, signature, senderPublicKey),
  safetyNumber: (pubA: string, pubB: string) => ipcRenderer.invoke("safety-number", pubA, pubB),

  startVerifyHash: () => ipcRenderer.invoke("start-verify-hash"),
  updateVerifyHash: (verifierId: string, chunk: Uint8Array) =>
    ipcRenderer.invoke("update-verify-hash", verifierId, chunk),
  finishVerifyHash: (verifierId: string) => ipcRenderer.invoke("finish-verify-hash", verifierId),
  verifyHash: (hash: string, signature: string, publicKey: string) =>
    ipcRenderer.invoke("verify-hash", hash, signature, publicKey),
});