import React, { useState } from 'react';
import { FaArrowLeft, FaCheckCircle, FaCopy } from 'react-icons/fa';
import styles from '../../styles/screens/ReceiveFromBrowser.module.css';

interface Props {
  onBack: () => void;
}

const ReceiveFromBrowser: React.FC<Props> = ({ onBack }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [isReceiving, setIsReceiving] = useState(false);
  const [copied, setCopied] = useState(false);

  const startReceiving = async () => {
    try {
      const url = await window.electronAPI.startUploadServer();
      setShareUrl(url);
      setIsReceiving(true);

      if ((window as any).QRCode) {
        (window as any).QRCode.toDataURL(url, { width: 200, margin: 2 }, (_: any, dataURL: string) => {
          setQrDataUrl(dataURL);
        });
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  const stopReceiving = async () => {
    await window.electronAPI.stopUploadServer();
    setShareUrl('');
    setQrDataUrl('');
    setIsReceiving(false);
    setCopied(false);
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

      {!isReceiving && (
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
        </div>
      )}
    </div>
  );
};

export default ReceiveFromBrowser;