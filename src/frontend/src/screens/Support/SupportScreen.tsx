import React from 'react';
import { FaArrowLeft, FaEnvelope, FaGlobe } from 'react-icons/fa';
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
      <div className={styles.content}>
        <h2 className={styles.title}>Get Support</h2>
        <p className={styles.paragraph}>
          If you're stuck, replay the setup guide or contact us.
        </p>
        <div className={styles.card}>
          <div className={styles.contactRow}>
            <FaEnvelope size={16} color="#888" />
            <span>victormayowa185@gmail.com</span>
          </div>
          <div className={styles.contactRow}>
            <FaGlobe size={16} color="#888" />
            <span>github.com/victormayowa185</span>
          </div>
        </div>
        <button
          className={styles.btn}
          onClick={() => alert('Onboarding replay coming soon')}
        >
          Replay Onboarding
        </button>
      </div>
    </div>
  );
};

export default SupportScreen;