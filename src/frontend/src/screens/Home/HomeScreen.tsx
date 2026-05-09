import React from 'react';
import { Screen } from '../../App';
import TopBar from '../../components/TopBar';

interface Props {
  currentScreen: Screen;
  setScreen: (s: Screen) => void;
}

const HomeScreen: React.FC<Props> = ({ setScreen }) => {
  return (
    <div style={{ background: '#0A0A0A', minHeight: '100vh', color: 'white', fontFamily: 'Arial, sans-serif' }}>
      <TopBar />
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 60px)',
        padding: '40px 20px',
        gap: '20px',
      }}>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '8px' }}>What do you want to do?</h1>
        <p style={{ color: '#888', marginBottom: '32px' }}>Choose an action to get started</p>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <ActionCard
            emoji="📤"
            title="Share Files"
            description="Send files to another device over your local hotspot"
            onClick={() => setScreen('share-hotspot-check')}
            color="#0066FF"
          />
          <ActionCard
            emoji="📥"
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
  emoji: string;
  title: string;
  description: string;
  onClick: () => void;
  color: string;
}

const ActionCard: React.FC<CardProps> = ({ emoji, title, description, onClick, color }) => (
  <div
    onClick={onClick}
    style={{
      background: '#111',
      border: `1px solid #222`,
      borderRadius: '16px',
      padding: '32px 28px',
      width: '220px',
      cursor: 'pointer',
      textAlign: 'center',
      transition: 'border-color 0.2s, transform 0.1s',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLDivElement).style.borderColor = color;
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.borderColor = '#222';
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
    }}
  >
    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>{emoji}</div>
    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '8px' }}>{title}</div>
    <div style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.5' }}>{description}</div>
  </div>
);

export default HomeScreen;