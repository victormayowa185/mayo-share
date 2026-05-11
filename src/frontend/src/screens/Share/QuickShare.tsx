import React, { useState, useEffect, useCallback } from 'react';
import { FaArrowLeft, FaCheckCircle, FaTimes, FaFolderOpen } from 'react-icons/fa';
import styles from '../../styles/screens/QuickShare.module.css';

interface Props {
  onBack: () => void;
}

interface FileEntry {
  id: string;
  path: string;
  name: string;
  size: number;
  downloadStatus: 'idle' | 'downloading' | 'done';
}

const formatBytes = (b: number) => {
  if (b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const QuickShare: React.FC<Props> = ({ onBack }) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [shareUrl, setShareUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => { window.electronAPI.stopFileServer(); };
  }, []);

  // Listen for download events
  useEffect(() => {
    window.electronAPI.onDownloadUpdate((data) => {
      setFiles(prev => prev.map(f =>
        f.name === data.fileName
          ? { ...f, downloadStatus: data.event === 'started' ? 'downloading' : 'done' }
          : f
      ));
    });
  }, []);

  // Ctrl+V paste handler
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (isSharing) return;
    e.preventDefault();

    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // Case 1: clipboard has files (dragged/copied from explorer)
    if (clipboard.files && clipboard.files.length > 0) {
      const newFiles: FileEntry[] = [];
      for (let i = 0; i < clipboard.files.length; i++) {
        const f = clipboard.files[i];
        const filePath = (f as any).path;
        if (filePath) {
          newFiles.push({
            id: Date.now().toString() + Math.random(),
            path: filePath,
            name: f.name,
            size: f.size,
            downloadStatus: 'idle',
          });
        }
      }
      if (newFiles.length > 0) { setFiles(prev => [...prev, ...newFiles]); return; }
    }

    // Case 2: clipboard has an image (screenshot, copy from browser)
    const imageItem = Array.from(clipboard.items).find(item => item.type.startsWith('image/'));
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `screenshot-${timestamp}.png`;
          const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
          const size = blob.size;
          setFiles(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            path: savedPath, name: fileName, size, downloadStatus: 'idle',
          }]);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }

    // Case 3: clipboard has text
    const text = clipboard.getData('text/plain');
    if (text && text.trim()) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `pasted-text-${timestamp}.txt`;
      const base64 = btoa(unescape(encodeURIComponent(text)));
      const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
      const size = new Blob([text]).size;
      setFiles(prev => [...prev, {
        id: Date.now().toString() + Math.random(),
        path: savedPath, name: fileName, size, downloadStatus: 'idle',
      }]);
    }
  }, [isSharing]);

  useEffect(() => {
    document.addEventListener('paste', handlePaste as any);
    return () => document.removeEventListener('paste', handlePaste as any);
  }, [handlePaste]);

  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: FileEntry[] = await Promise.all(paths.map(async p => ({
      id: Date.now().toString() + Math.random(),
      path: p,
      name: p.split('\\').pop() || p,
      size: await window.electronAPI.getFileSize(p),
      downloadStatus: 'idle' as const,
    })));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const addFolder = async () => {
    const paths = await window.electronAPI.selectFolder();
    if (!paths) return;
    const newFiles: FileEntry[] = await Promise.all(paths.map(async p => ({
      id: Date.now().toString() + Math.random(),
      path: p,
      name: p.split('\\').pop() || p,
      size: await window.electronAPI.getFileSize(p),
      downloadStatus: 'idle' as const,
    })));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const startSharing = async () => {
    if (files.length === 0) return;
    try {
      const url = await window.electronAPI.startFileServer(files.map(f => f.path));
      setShareUrl(url);
      setIsSharing(true);
      if ((window as any).QRCode) {
        (window as any).QRCode.toDataURL(url, { width: 180, margin: 2 }, (_: any, dataURL: string) => {
          setQrDataUrl(dataURL);
        });
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const stopSharing = async () => {
    await window.electronAPI.stopFileServer();
    setShareUrl('');
    setQrDataUrl('');
    setIsSharing(false);
    setCopied(false);
    setFiles(prev => prev.map(f => ({ ...f, downloadStatus: 'idle' })));
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={() => { stopSharing(); onBack(); }}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.title}>Quick Share</h2>
      <p className={styles.subtitle}>
        {isSharing ? 'Share the link or QR code — receiver opens it in any browser.' : 'Add files, then start sharing.'}
      </p>

      {/* File list */}
      {files.length > 0 && (
        <div className={styles.fileList}>
          {files.map(f => (
            <div key={f.id} className={styles.fileRow}>
              <span className={styles.fileRowName}>{f.name}</span>
              <span className={styles.fileRowSize}>{formatBytes(f.size)}</span>
              <span className={styles.fileRowStatus}>
                {f.downloadStatus === 'idle' && ''}
                {f.downloadStatus === 'downloading' && <div className={styles.miniSpinner} />}
                {f.downloadStatus === 'done' && <FaCheckCircle color="#4CAF50" size={16} />}
              </span>
              {!isSharing && (
                <button className={styles.removeBtn} onClick={() => removeFile(f.id)} title="Remove file">
                  <FaTimes size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons — before sharing */}
      {!isSharing && (
        <div className={styles.actionRow}>
          <button className={styles.btn} onClick={addFiles}>Add Files</button>
          <button className={styles.ghostBtn} onClick={addFolder}>Add Folder</button>
          {files.length > 0 && (
            <button className={styles.shareBtn} onClick={startSharing}>
              Start Sharing ({files.length} file{files.length > 1 ? 's' : ''})
            </button>
          )}
        </div>
      )}

      {/* Sharing panel */}
      {isSharing && (
        <div className={styles.sharingPanel}>
          {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className={styles.qr} />}
          <div className={styles.urlRow}>
            <span className={styles.url}>{shareUrl}</span>
            <button className={styles.copyBtn} onClick={copyLink}>
              {copied ? (
                <><FaCheckCircle style={{ marginRight: 4 }} color="#4CAF50" size={14} /> Copied</>
              ) : (
                'Copy Link'
              )}
            </button>
          </div>
          <p className={styles.hint}>Tell the receiver to connect to your hotspot and open this link.</p>
          <button className={styles.stopBtn} onClick={stopSharing}>Stop Sharing</button>
        </div>
      )}

      {files.length === 0 && !isSharing && (
        <div className={styles.emptyState}>
          <FaFolderOpen size={48} color="#555" />
          <p>No files added yet.</p>
          <p className={styles.emptyHint}>Click "Add Files", "Add Folder", or press Ctrl+V to paste.</p>
        </div>
      )}
    </div>
  );
};

export default QuickShare;