import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { FaCircle, FaUsers } from "react-icons/fa";
import styles from "../styles/components/StatusBar.module.css";

gsap.registerPlugin(useGSAP);

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
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);

  // Subtle entrance animation – plays once on mount
  useGSAP(() => {
    if (barRef.current) {
      gsap.fromTo(
        barRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: "power2.out" }
      );
    }
  }, []);

  return (
    <footer className={styles.bar} ref={barRef}>
      <div className={styles.left}>
        {connectionLabel ? (
          <span className={styles.hotspotOn}>
            <FaCircle size={8} color="#4caf50" style={{ marginRight: 6 }} />
            {connectionLabel}
          </span>
        ) : hotspotActive ? (
          <span className={styles.hotspotOn}>
            <FaCircle size={8} color="#4caf50" style={{ marginRight: 6 }} />
            {t("hotspotActive")} · {hotspotIP}
          </span>
        ) : (
          <span className={styles.hotspotOff}>
            <FaCircle size={8} color="#555" style={{ marginRight: 6 }} />
            {t("noNetwork")}
          </span>
        )}
      </div>

      <div className={styles.center}>
        {connectedDevices !== undefined && connectedDevices > 0 && (
          <span className={styles.transfer}>
            <FaUsers size={14} style={{ marginRight: 4 }} />
            {t("connectedDevices", { count: connectedDevices })}
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