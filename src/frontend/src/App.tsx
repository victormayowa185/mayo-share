import React, { useState, useEffect } from 'react';
import HomeScreen from './screens/Home/HomeScreen';
import SetupStepper from './screens/Onboarding/SetupStepper';

export type Screen =
  | 'home'
  | 'share-hotspot-check'
  | 'share-method-picker'
  | 'share-p2p'
  | 'share-quick'
  | 'receive'
  | 'settings';

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('home');
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if setup was already completed (stored in localStorage for now)
    const done = localStorage.getItem('mayo-setup-complete');
    setSetupComplete(done === 'true');
  }, []);

  const completeSetup = () => {
    localStorage.setItem('mayo-setup-complete', 'true');
    setSetupComplete(true);
  };

  // Still loading
  if (setupComplete === null) {
    return (
      <div style={{ background: '#0A0A0A', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#0066FF', fontSize: '1.5rem' }}>🦅 MAYO Share</div>
      </div>
    );
  }

  // First launch — show onboarding
  if (!setupComplete) {
    return <SetupStepper onComplete={completeSetup} />;
  }

  // Main app
  return <HomeScreen currentScreen={screen} setScreen={setScreen} />;
};

export default App;