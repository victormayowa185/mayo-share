import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Screen } from '../../App';
import { IoIosSend } from 'react-icons/io';
import { MdGetApp } from 'react-icons/md';
import styles from '../../styles/screens/HomeScreen.module.css';

gsap.registerPlugin(useGSAP);

interface Props {
  currentScreen: Screen;
  setScreen: (s: Screen) => void;
}

const HomeScreen: React.FC<Props> = ({ setScreen }) => {
  const { t } = useTranslation();

  // Refs for GSAP
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  // Entrance animation
  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

    tl.fromTo(
      [headingRef.current, subtitleRef.current],
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.1 }
    );

    if (cardsRef.current) {
      tl.fromTo(
        cardsRef.current.querySelectorAll(`.${styles.card}`),
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.1,
          ease: 'power2.out',
        },
        '-=0.2'
      );
    }
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h1 className={styles.heading} ref={headingRef}>
          {t('homeHeading')}
        </h1>
        <p className={styles.subtitle} ref={subtitleRef}>
          {t('homeSubtitle')}
        </p>

        <div className={styles.cardsContainer} ref={cardsRef}>
          <ActionCard
            icon={<IoIosSend size={48} />}
            title={t('shareFiles')}
            description={t('shareFilesDesc')}
            onClick={() => setScreen('share-hotspot-check')}
            color="#7C3EFF"
          />
          <ActionCard
            icon={<MdGetApp size={48} />}
            title={t('receiveFiles')}
            description={t('receiveFilesDesc')}
            onClick={() => setScreen('receive')}
            color="#7C3EFF"
          />
        </div>
      </div>
    </div>
  );
};

interface CardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  color: string;
}

const ActionCard: React.FC<CardProps> = ({ icon, title, description, onClick, color }) => (
  <button
    type="button"
    className={styles.card}
    onClick={onClick}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = color;
      e.currentTarget.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = '';
      e.currentTarget.style.transform = 'translateY(0)';
    }}

  >
    <div className={styles.cardEmoji} aria-hidden="true">{icon}</div>
    <div className={styles.cardTitle}>{title}</div>
    <div className={styles.cardDescription}>{description}</div>
  </button>
);

export default HomeScreen;