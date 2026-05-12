export {};

interface FolderFile {
  absolute: string;
  relative: string;
}

declare global {
  interface Window {
    electronAPI: {
      startHotspot: () => Promise<string>;
      selectFile: () => Promise<string[] | null>;
      selectFolder: () => Promise<FolderFile[] | null>;
      startFileServer: (files: (string | FolderFile)[]) => Promise<string>;
      stopFileServer: () => Promise<void>;
      getFileSize: (filePath: string) => Promise<number>;
      onDownloadUpdate: (callback: (data: { event: string; fileName: string }) => void) => void;
      compressSDP: (sdp: string) => Promise<string>;
      decompressSDP: (compact: string) => Promise<string>;
      ping: () => Promise<string>;
      readFileChunk: (filePath: string, start: number, size: number) => Promise<string>;
      createReceiveFile: (filePath: string) => Promise<void>;
      appendReceiveChunk: (filePath: string, data: string) => Promise<void>;
      saveResumeState: (transferId: string, offset: number, filePath: string) => Promise<void>;
      getResumeState: (transferId: string) => Promise<{ offset: number; filePath: string } | null>;
      clearResumeState: (transferId: string) => Promise<void>;
      getClipboardFiles: () => Promise<{ paths: string[]; type: 'files' | 'none' }>;
      saveTempFile: (fileName: string, base64Data: string) => Promise<string>;
      getHostname: () => Promise<string>;
    };
  }
}