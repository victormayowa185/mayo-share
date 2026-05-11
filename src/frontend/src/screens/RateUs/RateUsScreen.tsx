import React from 'react';
import { FaArrowLeft, FaStar } from 'react-icons/fa';
import styles from '../../styles/screens/RateUsScreen.module.css';

interface Props {
  onBack: () => void;
}

const RateUsScreen: React.FC<Props> = ({ onBack }) => {
  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <div className={styles.content}>
        <h2 className={styles.title}>Rate Us</h2>
        <p className={styles.paragraph}>Enjoying MAYO Share? Let others know!</p>
        <div className={styles.stars}>
          {[...Array(5)].map((_, i) => (
            <FaStar key={i} size={32} color="#b169e0" />
          ))}
        </div>
        <button
          className={styles.btn}
          onClick={() =>
            alert('Rating will be available on Microsoft Store / Website soon!')
          }
        >
          Rate Now
        </button>
      </div>
    </div>
  );
};

export default RateUsScreen;