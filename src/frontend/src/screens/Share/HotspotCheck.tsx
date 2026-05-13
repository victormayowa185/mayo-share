import React, { useState } from 'react';
import { FaArrowLeft, FaCheckCircle, FaArrowRight } from 'react-icons/fa';
import styles from '../../styles/screens/HotspotCheck.module.css';

interface Props {
  onReady: () => void;
  onBack: () => void;
  onHotspotStarted: (ip: string) => void;
}

const HotspotCheck: React.FC<Props> = ({ onReady, onBack, onHotspotStarted }) => {
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [success, setSuccess] = useState(false);

  const startHotspot = async () => {
    setRunning(true);
    setStatus('Starting hotspot...');
    try {
      const result = await window.electronAPI.startHotspot();
      setStatus(result);
      if (result.includes('SUCCESS')) {
        setSuccess(true);
        const ipMatch = result.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
        if (ipMatch && ipMatch[1]) {
          onHotspotStarted(ipMatch[1]);
        }
      }
    } catch (err: any) {
      setStatus('Error: ' + (err.message || err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.title}>Start Offline Hotspot</h2>
      <p className={styles.subtitle}>Your hotspot must be active before sharing files.</p>

      {!success && (
        <button className={styles.btn} onClick={startHotspot} disabled={running}>
          {running ? 'Starting...' : 'Start Hotspot'}
        </button>
      )}

      {status && <pre className={styles.log}>{status}</pre>}

      {success && (
        <div className={styles.successRow}>
          <div className={styles.successMsg}>
            <FaCheckCircle style={{ marginRight: 8 }} />
            Hotspot is active!
          </div>
          <button className={styles.btn} onClick={onReady}>
            Continue <FaArrowRight style={{ marginLeft: 6 }} />
          </button>
        </div>
      )}
    </div>
  );
};

export default HotspotCheck;