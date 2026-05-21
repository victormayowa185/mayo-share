import React from 'react';
import { useTranslation } from 'react-i18next';
import { FaArrowLeft } from 'react-icons/fa';
import styles from '../styles/components/BackButton.module.css';

interface Props {
  onClick: () => void;
  className?: string;
}

const BackButton: React.FC<Props> = ({ onClick, className }) => {
  const { t } = useTranslation();
  return (
    <button className={`${styles.backBtn} ${className || ''}`} onClick={onClick}>
      <FaArrowLeft style={{ marginRight: 6 }} /> {t('back')}
    </button>
  );
};

export default BackButton;