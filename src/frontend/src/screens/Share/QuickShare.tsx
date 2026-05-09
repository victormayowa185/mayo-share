import React, { useState, useEffect, useRef } from 'react';
import styles from '../../styles/screens/QuickShare.module.css';

interface Props {
  onBack: () => void;
}

type Status = 'idle' | 'sharing' | 'downloading' | 'done';

const QuickShare: React.FC<Props> = ({ onBack }) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [shareUrl, setShareUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      window.electronAPI.stopFileServer();
    };
  }, []);

  const selectFile = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths || paths.length === 0) return;
    const filePath = paths[0];
    const size = await window.electronAPI.getFileSize(filePath);
    setSelectedFile(filePath);
    setFileName(filePath.split('\\').pop() || filePath);
    setFileSize(size);
  };

  const startSharing = async () => {
    if (!selectedFile) return;
    try {
      const url = await window.electronAPI.startFileServer(selectedFile);
      setShareUrl(url);
      setStatus('sharing');

      // Generate QR
      if ((window as any).QRCode) {
        (window as any).QRCode.toDataURL(url, { width: 200, margin: 2 }, (_: any, dataURL: string) => {
          setQrDataUrl(dataURL);
        });
      }

      window.electronAPI.onDownloadUpdate((s) => {
        if (s === 'started') setStatus('downloading');
        if (s === 'completed') setStatus('done');
      });
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const stopSharing = async () => {
    await window.electronAPI.stopFileServer();
    setShareUrl('');
    setQrDataUrl('');
    setStatus('idle');
    setCopied(false);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const formatBytes = (b: number) => {
    if (b === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={() => { stopSharing(); onBack(); }}>← Back</button>
      <h2 className={styles.title}>Quick Share</h2>
      <p className={styles.subtitle}>Share a file — receiver opens the link in any browser.</p>

      {status === 'idle' && (
        <div className={styles.selectArea}>
          <button className={styles.btn} onClick={selectFile}>Select File</button>
          {selectedFile && (
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{fileName}</span>
              <span className={styles.fileSize}>{formatBytes(fileSize)}</span>
              <button className={styles.shareBtn} onClick={startSharing}>Start Sharing</button>
            </div>
          )}
        </div>
      )}

      {(status === 'sharing' || status === 'downloading' || status === 'done') && (
        <div className={styles.sharingPanel}>
          <div className={styles.fileChip}>{fileName} — {formatBytes(fileSize)}</div>

          {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className={styles.qr} />}

          <div className={styles.urlRow}>
            <span className={styles.url}>{shareUrl}</span>
            <button className={styles.copyBtn} onClick={copyLink}>
              {copied ? '✅ Copied' : 'Copy Link'}
            </button>
          </div>

          <div className={styles.statusRow}>
            {status === 'sharing' && <><div className={styles.spinner} /> <span>Waiting for receiver...</span></>}
            {status === 'downloading' && <><div className={styles.spinner} /> <span style={{ color: '#0066FF' }}>Sending file...</span></>}
            {status === 'done' && <span className={styles.doneMsg}>✅ Download complete!</span>}
          </div>

          <button className={styles.stopBtn} onClick={stopSharing}>Stop Sharing</button>
        </div>
      )}

      {/* QR library loaded from CDN */}
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js" />
    </div>
  );
};

export default QuickShare;