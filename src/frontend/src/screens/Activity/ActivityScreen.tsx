import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FaClipboardList, FaUpload, FaDownload } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "../../styles/screens/ActivityScreen.module.css";

gsap.registerPlugin(useGSAP);

interface ActivityEntry {
  type: "sent" | "received";
  fileName: string;
  timestamp: string;
}

interface Props {
  onBack: () => void;
}

const ActivityScreen: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  // Refs for GSAP
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);

  const loadActivities = async () => {
    const data = await window.electronAPI.getActivity();
     // @ts-ignore 
    setActivities(data);
  };

  const clearHistory = async () => {
    await window.electronAPI.clearActivity();
    setActivities([]);
  };

  useEffect(() => {
    loadActivities();

    window.electronAPI.onActivityUpdated(() => {
      loadActivities();
    });

    window.electronAPI.onActivityCleared(() => {
      setActivities([]);
    });
  }, []);

  // GSAP entrance animation
  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    // Animate the title
    tl.fromTo(titleRef.current, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 });

    if (activities.length > 0 && listRef.current) {
      // Animate each list item with a stagger
      const items = listRef.current.querySelectorAll(`.${styles.activityItem}`);
      tl.fromTo(items, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.05 }, "-=0.1");
    } else if (emptyRef.current) {
      // Animate the empty state
      tl.fromTo(emptyRef.current, { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: 0.3 }, "-=0.1");
    }
  }, [activities]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />

      {activities.length > 0 && (
        <div className={styles.clearFixed}>
          <button className={styles.clearBtn} onClick={clearHistory}>
            {t("clearHistory")}
          </button>
        </div>
      )}

      <div className={styles.content}>
        <h2 className={styles.title} ref={titleRef}>
          {t("activity")}
        </h2>

        {activities.length === 0 ? (
          <div ref={emptyRef}>
            <FaClipboardList size={48} color="#888" />
            <p className={styles.subtitle}>{t("activityDescription")}</p>
            <p className={styles.emptyText}>{t("noRecentActivity")}</p>
          </div>
        ) : (
          <ul className={styles.activityList} ref={listRef}>
            {activities.map((entry, idx) => (
              <li key={idx} className={styles.activityItem}>
                <span className={styles.activityIcon}>
                  {entry.type === "sent" ? (
                    <FaUpload size={14} color="#4CAF50" />
                  ) : (
                    <FaDownload size={14} color="#0066FF" />
                  )}
                </span>
                <span className={styles.activityName}>{entry.fileName}</span>
                <span className={styles.activityTime}>
                  {formatTime(entry.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ActivityScreen;