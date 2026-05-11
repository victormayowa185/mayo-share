import React from 'react';
import { FaArrowLeft, FaClipboardList } from 'react-icons/fa';
import styles from '../../styles/screens/ActivityScreen.module.css';

interface Props {
  onBack: () => void;
}

const ActivityScreen: React.FC<Props> = ({ onBack }) => {
  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <div className={styles.content}>
        <FaClipboardList size={48} color="#888" />
        <h2 className={styles.title}>Activity</h2>
        <p className={styles.subtitle}>Your recent file transfers will appear here.</p>
        <p className={styles.emptyText}>No recent activity.</p>
      </div>
    </div>
  );
};

export default ActivityScreen;