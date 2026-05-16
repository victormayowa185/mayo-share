import React from 'react';
import { FaArrowLeft } from 'react-icons/fa';
import styles from '../styles/components/BackButton.module.css';

interface Props {
  onClick: () => void;
}

const BackButton: React.FC<Props> = ({ onClick }) => (
  <button className={styles.backBtn} onClick={onClick}>
    <FaArrowLeft style={{ marginRight: 6 }} /> Back
  </button>
);

export default BackButton;