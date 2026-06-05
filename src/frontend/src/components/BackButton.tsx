import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FaArrowLeft } from 'react-icons/fa';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import styles from '../styles/components/BackButton.module.css';

gsap.registerPlugin(useGSAP);

interface Props {
  onClick: () => void;
  className?: string;
}

const BackButton: React.FC<Props> = ({ onClick, className }) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Subtle entrance animation
  useGSAP(() => {
    if (buttonRef.current) {
      gsap.fromTo(
        buttonRef.current,
        { opacity: 0, x: -8 },
        { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' }
      );
    }
  }, []);

  return (
    <button
      ref={buttonRef}
      className={`${styles.backBtn} ${className || ''}`}
      onClick={onClick}
      aria-label={t('back')}
    >
      <FaArrowLeft style={{ marginRight: 6 }} aria-hidden="true" /> {t('back')}
    </button>
  );
};

export default BackButton;