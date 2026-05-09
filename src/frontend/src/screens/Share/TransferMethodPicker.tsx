import React from 'react';
import styles from '../../styles/screens/TransferMethodPicker.module.css';

interface Props {
    onSelectP2P: () => void;
    onSelectQuick: () => void;
    onBack: () => void;
}

const TransferMethodPicker: React.FC<Props> = ({ onSelectP2P, onSelectQuick, onBack }) => {
    return (
        <div className={styles.container}>
            <button className={styles.backBtn} onClick={onBack}>← Back</button>
            <h2 className={styles.heading}>Choose Transfer Method</h2>
            <p className={styles.subtitle}>How would you like to share?</p>

            <div className={styles.cards}>
                <MethodCard
                    emoji="🌐"
                    title="Quick Share"
                    description="Share files via a link or QR code. The receiver only needs a browser — no app required."
                    color="#0066FF"
                    onClick={onSelectQuick}
                />
                <MethodCard
                    emoji="🔗"
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
    emoji: string;
    title: string;
    description: string;
    color: string;
    onClick: () => void;
}

const MethodCard: React.FC<CardProps> = ({ emoji, title, description, color, onClick }) => (
    <div
        className={styles.card}
        onClick={onClick}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = color}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = '#222'}
    >
        <div className={styles.cardEmoji}>{emoji}</div>
        <div className={styles.cardTitle}>{title}</div>
        <div className={styles.cardDesc}>{description}</div>
    </div>
);

export default TransferMethodPicker;