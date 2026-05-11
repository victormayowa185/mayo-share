import React from 'react';
import {
  FaCircle,
  FaUpload,
  FaDownload,
} from 'react-icons/fa';
import styles from '../styles/components/StatusBar.module.css';

interface Props {
  hotspotActive: boolean;
  hotspotIP: string;
  transferLabel: string | null;       // e.g. "Sending photo.jpg"
  transferProgress: number | null;    // 0-100 or null
  appVersion: string;
}

const StatusBar: React.FC<Props> = ({
  hotspotActive,
  hotspotIP,
  transferLabel,
  transferProgress,
  appVersion,
}) => {
  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        {hotspotActive ? (
          <span className={styles.hotspotOn}>
            <FaCircle size={8} color="#4caf50" style={{ marginRight: 6 }} />
            Hotspot active · {hotspotIP}
          </span>
        ) : (
          <span className={styles.hotspotOff}>
            <FaCircle size={8} color="#555" style={{ marginRight: 6 }} />
            Hotspot off
          </span>
        )}
      </div>

      <div className={styles.center}>
        {transferLabel && (
          <span className={styles.transfer}>
            {transferLabel}
            {transferProgress !== null && ` — ${transferProgress}%`}
          </span>
        )}
      </div>

      <div className={styles.right}>
        <span className={styles.version}>v{appVersion}</span>
      </div>
    </footer>
  );
};

export default StatusBar;