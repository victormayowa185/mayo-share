
import React from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import styles from '../../styles/screens/SupportScreen.module.css';

interface Props {
  onBack: () => void;
}

const SupportScreen: React.FC<Props> = ({ onBack }) => {
  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.title}>Get Support</h2>
      <p className={styles.paragraph}>
        If you're stuck, replay the setup guide or contact us.
      </p>
      <div className={styles.card}>
        <p>📧 victormayowa@example.com</p>
        <p>🌐 github.com/victormayowa185</p>
      </div>
      <button className={styles.btn} onClick={() => alert('Onboarding replay coming soon')}>
        Replay Onboarding
      </button>
    </div>
  );
};

export default SupportScreen;