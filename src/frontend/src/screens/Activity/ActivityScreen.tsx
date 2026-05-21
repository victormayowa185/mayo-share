import React, { useState, useEffect } from "react";
import {
  FaClipboardList,
  FaUpload,
  FaDownload,
} from "react-icons/fa";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/ActivityScreen.module.css";

interface ActivityEntry {
  type: "sent" | "received";
  fileName: string;
  timestamp: string;
}

interface Props {
  onBack: () => void;
}

const ActivityScreen: React.FC<Props> = ({ onBack }) => {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  const loadActivities = async () => {
    const data = await window.electronAPI.getActivity();
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
            Clear History
          </button>
        </div>
      )}

      <div className={styles.content}>
        <h2 className={styles.title}>Activity</h2>
        {activities.length === 0 ? (
          <>
            <FaClipboardList size={48} color="#888" />
            <p className={styles.subtitle}>
              Your recent file transfers will appear here.
            </p>
            <p className={styles.emptyText}>No recent activity.</p>
          </>
        ) : (
          <ul className={styles.activityList}>
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