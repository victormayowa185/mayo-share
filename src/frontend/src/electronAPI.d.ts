export { };

interface FolderFile {
  absolute: string;
  relative: string;
}

declare global {
  interface Window {
    electronAPI: {
      getLocalIP: () => Promise<string | null>;
      getWifiSSID: () => Promise<string | null>;
      getActivity: () => Promise<
        Array<{ type: string; fileName: string; timestamp: string }>
      >;
      onActivityUpdated: (
        callback: (entry: {
          type: string;
          fileName: string;
          timestamp: string;
        }) => void,
      ) => () => void;
      onDownloadProgress: (
        callback: (data: { fileName: string; percent: number }) => void,
      ) => () => void;
      readTextFile: (filePath: string) => Promise<string>;
      writeTextFile: (filePath: string, content: string) => Promise<void>;
      selectFile: () => Promise<string[] | null>;
      selectFolder: () => Promise<FolderFile[] | null>;
      fixFirewall: () => Promise<{
        success: boolean;
        output?: string;
        error?: string;
      }>;
      onDownloadUpdate: (callback: (data: { event: string; fileName: string; clientIp?: string }) => void) => () => void;
      getPlatform: () => Promise<string>;
      submitRating: (data: {
        rating: number;
        timestamp: string;
        appVersion: string;
      }) => Promise<{ success: boolean; error?: string }>;
      clearActivity: () => Promise<void>;
      onActivityCleared: (callback: () => void) => () => void;
      onDeviceNameChanged: (callback: (name: string) => void) => () => void;
      setDeviceName: (name: string) => Promise<void>;
      getTranslations: (lang: string) => Promise<Record<string, string>>;
      getLanguage: () => Promise<string>;
      setLanguage: (lang: string) => Promise<void>;
      isLanguageSet: () => Promise<boolean>;
      getSavePath: () => Promise<string>;
      getDiskSpace: () => Promise<{ free: number; total: number }>;
      setSavePath: (path: string) => Promise<void>;
      selectSaveFolder: () => Promise<string | null>;
      diagnoseNetwork: () => Promise<{
        ssid: string | null;
        profileCategory: string | null;
        loopbackAdapterPresent: boolean;
        port3001Listening: boolean;
      }>;
      startFileServer: (
        files: (string | FolderFile)[],
        ip?: string,
        message?: string,
      ) => Promise<string>;
      stopFileServer: () => Promise<void>;
      getFileSize: (filePath: string) => Promise<number>;

      // Upload server (Receive from Browser)
      startUploadServer: (ip?: string) => Promise<string>;
      stopUploadServer: () => Promise<void>;
      onUploadUpdate: (
        callback: (data: { event: string; fileName: string }) => void,
      ) => () => void;

      approveSender: (sessionId: string) => Promise<void>;
      declineSender: (sessionId: string) => Promise<void>;
      onSenderConnected: (
        callback: (data: {
          sessionId: string;
          senderName: string;
          deviceType: string;
        }) => void,
      ) => () => void;

      // DELETED: Old WebRTC signaling APIs (replaced by P2PManager)
      // generateCode, joinByCode, submitAnswer, stopSignaling, onAnswerReceived,
      // compressSDP, decompressSDP, getIceServers removed

      checkHotspotStatus: () => Promise<{ active: boolean; ip: string }>;
      ping: () => Promise<string>;

      // DELETED: readFileChunk, appendReceiveChunk (now handled in main process by p2pTransfer.ts)
      // createReceiveFile and finishReceiveFile kept for now (guide says "leave in place")
      createReceiveFile: (filePath: string, resume?: boolean) => Promise<void>;
      finishReceiveFile: (filePath: string) => Promise<void>;

      saveResumeState: (
        transferId: string,
        offset: number,
        filePath: string,
      ) => Promise<void>;
      getResumeState: (
        transferId: string,
      ) => Promise<{ offset: number; filePath: string } | null>;
      clearResumeState: (transferId: string) => Promise<void>;
      getClipboardFiles: () => Promise<{
        paths: string[];
        type: "files" | "none";
      }>;

      getIntegrityCheck: () => Promise<boolean>;
      setIntegrityCheck: (enabled: boolean) => Promise<void>;
      getWebEncryption: () => Promise<boolean>;
      setWebEncryption: (enabled: boolean) => Promise<void>;
      startStreamSign: () => Promise<string>;
      streamSignChunk: (signerKey: string, chunk: Uint8Array) => Promise<void>;
      finishStreamSign: (signerKey: string) => Promise<{ hash: string; signature: string; publicKey: string } | null>;

      saveTempFile: (fileName: string, base64Data: string) => Promise<string>;
      getHostname: () => Promise<string>;

      // ---------- P2P activity & file-system helpers ----------
      logP2pActivity: (type: "sent" | "received", fileName: string) => Promise<void>;
      isDirectory: (filePath: string) => Promise<boolean>;
      walkDirectory: (dirPath: string) => Promise<FolderFile[]>;

      // ---------- Solana offline integrity ----------
      getPathForFile: (file: File) => string;

      getPublicKey: () => Promise<string>;
      signFile: (filePath: string) => Promise<{ hash: string; signature: string; publicKey: string }>;
      verifyFile: (filePath: string, signature: string, senderPublicKey: string) => Promise<{ valid: boolean; hash: string; reason?: string }>;
      safetyNumber: (pubA: string, pubB: string) => Promise<string>;

      startVerifyHash: () => Promise<string>;
      updateVerifyHash: (verifierId: string, chunk: Uint8Array) => Promise<void>;
      finishVerifyHash: (verifierId: string) => Promise<string | null>;
      verifyHash: (hash: string, signature: string, publicKey: string) => Promise<{ valid: boolean; reason?: string }>;

      // ========== NEW: P2PManager APIs (replaces WebRTC data channel) ==========
      p2pHostStart: () => Promise<{ code: string; ip: string; port: number }>;
      p2pHostStop: () => Promise<void>;
      p2pJoin: (ip: string, code: string) => Promise<void>;
      p2pDisconnect: () => Promise<void>;
      p2pSendControl: (msg: any) => Promise<void>;
      p2pCancelSend: () => Promise<void>;
      p2pSendFile: (filePath: string, offset: number, size: number, signerId: string | null) => Promise<void>;
      p2pBeginReceive: (id: string, savePath: string, resume: boolean, verifierId: string | null) => Promise<void>;
      p2pEndReceive: () => Promise<void>;

      onP2PConnected: (cb: () => void) => () => void;
      onP2PDisconnected: (cb: () => void) => () => void;
      onP2PControl: (cb: (msg: any) => void) => () => void;
      onP2PSendProgress: (cb: (p: { filePath: string; sentTotal: number; size: number }) => void) => () => void;
      onP2PReceiveProgress: (cb: (p: { id: string; chunkLength: number }) => void) => () => void;
    };
  }
}