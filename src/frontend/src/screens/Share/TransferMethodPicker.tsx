import React from 'react';
import { VscGlobe } from 'react-icons/vsc';
import { FaLink } from 'react-icons/fa6';
import { FaArrowLeft } from 'react-icons/fa';
import styles from '../../styles/screens/TransferMethodPicker.module.css';

interface Props {
  onSelectP2P: () => void;
  onSelectQuick: () => void;
  onBack: () => void;
}

const TransferMethodPicker: React.FC<Props> = ({ onSelectP2P, onSelectQuick, onBack }) => {
  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.heading}>Choose Transfer Method</h2>
      <p className={styles.subtitle}>How would you like to share?</p>

      <div className={styles.cards}>
        <MethodCard
          icon={<VscGlobe size={40} />}
          title="Quick Share"
          description="Share files via a link or QR code. The receiver only needs a browser — no app required."
          color="#0066FF"
          onClick={onSelectQuick}
        />
        <MethodCard
          icon={<FaLink size={36} />}
          title="Device Connect"
          description="Full P2P session — queue multiple files, cancel anytime, resume transfers. Requires MAYO Share on both devices."
          color="#4CAF50"
          onClick={onSelectP2P}
        />
      </div>
    </div>
  );
};

interface CardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  onClick: () => void;
}

const MethodCard: React.FC<CardProps> = ({ icon, title, description, color, onClick }) => (
  <div
    className={styles.card}
    onClick={onClick}
    onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.borderColor = color)}
    onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = '#222')}
  >
    <div className={styles.cardEmoji}>{icon}</div>
    <div className={styles.cardTitle}>{title}</div>
    <div className={styles.cardDesc}>{description}</div>
  </div>
);

export default TransferMethodPicker;