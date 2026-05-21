import React from "react";
import { FaEnvelope, FaGlobe } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/SupportScreen.module.css";

interface Props {
  onBack: () => void;
  onReplayOnboarding?: () => void;
  onNavigateTo?: (screen: string) => void; // new
}

const SupportScreen: React.FC<Props> = ({
  onBack,
  onReplayOnboarding,
  onNavigateTo,
}) => {
  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
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
        </div>
        <button className={styles.btn} onClick={() => onReplayOnboarding?.()}>
          Replay Onboarding
        </button>
        <button
          className={styles.btn}
          onClick={() => onNavigateTo?.("troubleshoot")}
        >
          Troubleshoot
        </button>
      </div>
    </div>
  );
};

export default SupportScreen;
