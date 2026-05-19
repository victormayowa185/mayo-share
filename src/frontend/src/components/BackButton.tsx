import React from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import styles from '../styles/components/BackButton.module.css';

interface Props {
  onClick: () => void;
  className?: string; 
}

const BackButton: React.FC<Props> = ({ onClick, className }) => (
  <button className={`${styles.backBtn} ${className || ''}`} onClick={onClick}>
    <FaArrowLeft style={{ marginRight: 6 }} /> Back
  </button>
);

export default BackButton;