import React from 'react';
import { Screen } from '../../App';
import TopBar from '../../components/TopBar';
import { IoIosSend } from 'react-icons/io';
import { MdGetApp } from 'react-icons/md';
import styles from '../../styles/screens/HomeScreen.module.css';

interface Props {
  currentScreen: Screen;
  setScreen: (s: Screen) => void;
}

const HomeScreen: React.FC<Props> = ({ setScreen }) => {
  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h1 className={styles.heading}>What do you want to do?</h1>
        <p className={styles.subtitle}>Choose an action to get started</p>

        <div className={styles.cardsContainer}>
          <ActionCard
            icon={<IoIosSend size={48} />}
            title="Share Files"
            description="Send files to another device over your local hotspot"
            onClick={() => setScreen('share-hotspot-check')}
            color="#0066FF"
          />
          <ActionCard
            icon={<MdGetApp size={48} />}
            title="Receive Files"
            description="Accept files from another device on the same network"
            onClick={() => setScreen('receive')}
            color="#4CAF50"
          />
        </div>
      </div>
    </div>
  );
};

interface CardProps {
  icon: React.ReactNode;       // replaced emoji string
  title: string;
  description: string;
  onClick: () => void;
  color: string;
}

const ActionCard: React.FC<CardProps> = ({ icon, title, description, onClick, color }) => (
  <div
    className={styles.card}
    onClick={onClick}
    onMouseEnter={e => {
      (e.currentTarget as HTMLDivElement).style.borderColor = color;
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.borderColor = '#222';
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
    }}
  >
    <div className={styles.cardEmoji}>{icon}</div>
    <div className={styles.cardTitle}>{title}</div>
    <div className={styles.cardDescription}>{description}</div>
  </div>
);

export default HomeScreen;