export {};

declare global {
  interface Window {
    electronAPI: {
      startHotspot: () => Promise<string>;
      selectFile: () => Promise<string[] | null>;
      startFileServer: (filePath: string) => Promise<string>;
      stopFileServer: () => Promise<void>;
      getFileSize: (filePath: string) => Promise<number>;
      onDownloadUpdate: (callback: (status: string) => void) => void;
      compressSDP: (sdp: string) => Promise<string>;
      decompressSDP: (compact: string) => Promise<string>;
      ping: () => Promise<string>;
      readFileChunk: (filePath: string, start: number, size: number) => Promise<string>;
      createReceiveFile: (filePath: string) => Promise<void>;
      appendReceiveChunk: (filePath: string, data: string) => Promise<void>;
      saveResumeState: (transferId: string, offset: number, filePath: string) => Promise<void>;
      getResumeState: (transferId: string) => Promise<{ offset: number; filePath: string } | null>;
      clearResumeState: (transferId: string) => Promise<void>;
    };
  }
}