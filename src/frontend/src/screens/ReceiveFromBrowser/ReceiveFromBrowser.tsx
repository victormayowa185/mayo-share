import React, { useState, useEffect } from 'react';
import { FaArrowLeft, FaCheckCircle, FaCopy, FaSpinner } from 'react-icons/fa';
import styles from '../../styles/screens/ReceiveFromBrowser.module.css';

interface ReceivedFile {
  id: string;
  name: string;
  time: string;
}

interface Props {
  onBack: () => void;
}

const ReceiveFromBrowser: React.FC<Props> = ({ onBack }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [isReceiving, setIsReceiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startingHotspot, setStartingHotspot] = useState(false);
  const [hotspotStatus, setHotspotStatus] = useState('');
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);

  // Listen for incoming files
  useEffect(() => {
    window.electronAPI.onUploadUpdate((data) => {
      if (data.event === 'received') {
        const newFile: ReceivedFile = {
          id: Date.now().toString() + Math.random(),
          name: data.fileName,
          time: new Date().toLocaleTimeString(),
        };
        setReceivedFiles(prev => [...prev, newFile]);
      }
    });
  }, []);

  const startReceiving = async () => {
    try {
      setStartingHotspot(true);
      setHotspotStatus('Checking hotspot...');
      const status = await window.electronAPI.checkHotspotStatus();
      let ip = status.ip;

      if (!status.active) {
        setHotspotStatus('Starting hotspot...');
        const result = await window.electronAPI.startHotspot();
        if (result.includes('SUCCESS')) {
          const ipMatch = result.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
          if (ipMatch && ipMatch[1]) {
            ip = ipMatch[1];
          }
        } else {
          throw new Error('Hotspot could not be started. ' + result);
        }
      }

      setHotspotStatus('Hotspot active. Starting upload server...');
      const url = await window.electronAPI.startUploadServer();
      setShareUrl(url);
      setIsReceiving(true);
      setStartingHotspot(false);
      setHotspotStatus('');

      if ((window as any).QRCode) {
        (window as any).QRCode.toDataURL(url, { width: 200, margin: 2 }, (_: any, dataURL: string) => {
          setQrDataUrl(dataURL);
        });
      }
    } catch (err: any) {
      alert('Error: ' + (err.message || err));
      setStartingHotspot(false);
      setHotspotStatus('');
    }
  };

  const stopReceiving = async () => {
    await window.electronAPI.stopUploadServer();
    setShareUrl('');
    setQrDataUrl('');
    setIsReceiving(false);
    setCopied(false);
    // Leave receivedFiles so the user can still see them after stopping
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={styles.container}>
      <button
        className={styles.backBtn}
        onClick={() => {
          if (isReceiving) stopReceiving();
          onBack();
        }}
      >
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.title}>Receive from Browser</h2>
      <p className={styles.subtitle}>
        {isReceiving
          ? 'Ask the sender to open this link and send files.'
          : 'Start a receiving session so others can send files to you.'}
      </p>

      {/* Show hotspot progress */}
      {startingHotspot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: '#aaa' }}>
          <FaSpinner className={styles.spinner} />
          <span>{hotspotStatus}</span>
        </div>
      )}

      {!isReceiving && !startingHotspot && (
        <button className={styles.btn} onClick={startReceiving}>
          Start Receiving
        </button>
      )}

      {isReceiving && (
        <div className={styles.sharingPanel}>
          {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className={styles.qr} />}
          <div className={styles.urlRow}>
            <span className={styles.url}>{shareUrl}</span>
            <button className={styles.copyBtn} onClick={copyLink}>
              {copied ? (
                <><FaCheckCircle style={{ marginRight: 4 }} color="#4CAF50" size={14} /> Copied</>
              ) : (
                <><FaCopy style={{ marginRight: 4 }} size={14} /> Copy</>
              )}
            </button>
          </div>
          <p className={styles.hint}>Tell the sender to connect to your hotspot and open this link.</p>
          <button className={styles.stopBtn} onClick={stopReceiving}>
            Stop Receiving
          </button>

          {/* Received files list */}
          {receivedFiles.length > 0 && (
            <div className={styles.receivedSection}>
              <h3 className={styles.receivedTitle}>Received Files</h3>
              <ul className={styles.fileList}>
                {receivedFiles.map(f => (
                  <li key={f.id} className={styles.fileItem}>
                    <FaCheckCircle size={14} color="#4CAF50" style={{ marginRight: 8 }} />
                    <span className={styles.fileName}>{f.name}</span>
                    <span className={styles.fileTime}>{f.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReceiveFromBrowser;