import React from "react";
import { FaCircle, FaUsers } from "react-icons/fa";
import styles from "../styles/components/StatusBar.module.css";

interface Props {
  hotspotActive: boolean;
  hotspotIP: string;
  transferLabel: string | null;
  transferProgress: number | null;
  appVersion: string;
  connectedDevices?: number;
  connectionLabel?: string | null;
}

const StatusBar: React.FC<Props> = ({
  hotspotActive,
  hotspotIP,
  transferLabel,
  transferProgress,
  appVersion,
  connectedDevices,
  connectionLabel,
}) => {
  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        {connectionLabel ? (
          <span className={styles.hotspotOn}>
            <FaCircle size={8} color="#4caf50" style={{ marginRight: 6 }} />
            {connectionLabel}
          </span>
        ) : hotspotActive ? (
          <span className={styles.hotspotOn}>
            <FaCircle size={8} color="#4caf50" style={{ marginRight: 6 }} />
            Hotspot active · {hotspotIP}
          </span>
        ) : (
          <span className={styles.hotspotOff}>
            <FaCircle size={8} color="#555" style={{ marginRight: 6 }} />
            No network
          </span>
        )}
      </div>

      <div className={styles.center}>
        {connectedDevices !== undefined && connectedDevices > 0 && (
          <span className={styles.transfer}>
            <FaUsers size={14} style={{ marginRight: 4 }} />
            {connectedDevices} connected
          </span>
        )}
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
