import React from "react";
import styles from "../styles/screens/SettingsScreen.module.css";

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
  danger?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  body,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  danger,
}) => {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <h3>{title}</h3>
        <p>{body}</p>
        <div className={styles.modalActions}>
          {cancelLabel && onCancel && (
            <button className={`${styles.modalBtn} ${styles.modalBtnGhost}`} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            className={`${styles.modalBtn} ${danger ? styles.modalBtnDanger : styles.modalBtnPrimary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;