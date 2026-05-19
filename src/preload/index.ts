import { contextBridge, ipcRenderer } from "electron";

interface FolderFile {
  absolute: string;
  relative: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  checkHotspotStatus: () => ipcRenderer.invoke("check-hotspot-status"),
  getWifiSSID: (): Promise<string | null> =>
    ipcRenderer.invoke("get-wifi-ssid"),
  getActivity: (): Promise<any[]> => ipcRenderer.invoke("get-activity"),
  onActivityUpdated: (callback: (entry: any) => void) => {
    ipcRenderer.on("activity-updated", (_event, entry) => callback(entry));
  },
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
  // ---------- Discovery (mDNS) ----------
  startAdvertising: (sdpOffer: string): Promise<number> =>
    ipcRenderer.invoke("start-advertising", sdpOffer),
  startBrowsing: (): Promise<void> => ipcRenderer.invoke("start-browsing"),
  stopDiscovery: (): Promise<void> => ipcRenderer.invoke("stop-discovery"),
  onDeviceFound: (
    callback: (device: { name: string; host: string; port: number }) => void,
  ) => {
    ipcRenderer.on("device-found", (_event, device) => callback(device));
  },
  onAnswerReceived: (callback: (answerSDP: string) => void) => {
    ipcRenderer.on("answer-received", (_event, answerSDP) =>
      callback(answerSDP),
    );
  },

  approveSender: (sessionId: string) =>
    ipcRenderer.invoke("approve-sender", sessionId),
  declineSender: (sessionId: string) =>
    ipcRenderer.invoke("decline-sender", sessionId),

  // Listen for new pending senders
  onSenderConnected: (
    callback: (data: { sessionId: string; senderName: string }) => void,
  ) => {
    ipcRenderer.on("sender-connected", (_event, data) => callback(data));
  },

  startFileServer: (files: (string | FolderFile)[]): Promise<string> =>
    ipcRenderer.invoke("start-file-server", files),
  stopFileServer: () => ipcRenderer.invoke("stop-file-server"),
  getFileSize: (filePath: string) =>
    ipcRenderer.invoke("get-file-size", filePath),
  onDownloadUpdate: (
    callback: (data: { event: string; fileName: string }) => void,
  ) => {
    ipcRenderer.on("download-update", (_event, data) => callback(data));
  },

  // ---------- Upload server (Receive from Browser) ----------
  startUploadServer: (): Promise<string> =>
    ipcRenderer.invoke("start-upload-server"),
  stopUploadServer: () => ipcRenderer.invoke("stop-upload-server"),
  onUploadUpdate: (
    callback: (data: { event: string; fileName: string }) => void,
  ) => {
    ipcRenderer.on("upload-update", (_event, data) => callback(data));
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
});
