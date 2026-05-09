import React, { useState } from 'react';
import styles from '../../styles/screens/HotspotCheck.module.css';

interface Props {
  onReady: () => void;
  onBack: () => void;
}

const HotspotCheck: React.FC<Props> = ({ onReady, onBack }) => {
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [success, setSuccess] = useState(false);

  const startHotspot = async () => {
    setRunning(true);
    setStatus('Starting hotspot...');
    try {
      const result = await window.electronAPI.startHotspot();
      setStatus(result);
      if (result.includes('SUCCESS')) setSuccess(true);
    } catch (err: any) {
      setStatus('Error: ' + (err.message || err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>← Back</button>
      <h2 className={styles.title}>Start Offline Hotspot</h2>
      <p className={styles.subtitle}>Your hotspot must be active before sharing files.</p>

      {!success && (
        <button className={styles.btn} onClick={startHotspot} disabled={running}>
          {running ? 'Starting...' : 'Start Hotspot'}
        </button>
      )}

      {status && (
        <pre className={styles.log}>{status}</pre>
      )}

      {success && (
        <div className={styles.successRow}>
          <div className={styles.successMsg}>✅ Hotspot is active!</div>
          <button className={styles.btn} onClick={onReady}>Continue →</button>
        </div>
      )}
    </div>
  );
};

export default HotspotCheck;