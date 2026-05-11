import React, { useState, useEffect } from 'react';
import HomeScreen from './screens/Home/HomeScreen';
import SetupStepper from './screens/Onboarding/SetupStepper';
import HotspotCheck from './screens/Share/HotspotCheck';
import TransferMethodPicker from './screens/Share/TransferMethodPicker';
import QuickShare from './screens/Share/QuickShare';
import P2PSession from './screens/Share/P2PSession';
import ReceiveScreen from './screens/Receive/ReceiveScreen';
import ActivityScreen from './screens/Activity/ActivityScreen';
import SupportScreen from './screens/Support/SupportScreen';
import RateUsScreen from './screens/RateUs/RateUsScreen';

export type Screen =
  | 'home'
  | 'share-hotspot-check'
  | 'share-method-picker'
  | 'share-p2p'
  | 'share-quick'
  | 'receive'
  | 'settings'
  | 'activity'
  | 'support'
  | 'rate'
  ;

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('home');
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    const done = localStorage.getItem('mayo-setup-complete');
    setSetupComplete(done === 'true');
  }, []);

  const completeSetup = () => {
    localStorage.setItem('mayo-setup-complete', 'true');
    setSetupComplete(true);
  };

  if (setupComplete === null) {
    return (
      <div style={{ background: '#0A0A0A', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#0066FF', fontSize: '1.5rem' }}>🦅 MAYO Share</div>
      </div>
    );
  }

  if (!setupComplete) {
    return <SetupStepper onComplete={completeSetup} />;
  }

  switch (screen) {
    case 'share-hotspot-check':
      return (
        <HotspotCheck
          onReady={() => setScreen('share-method-picker')}
          onBack={() => setScreen('home')}
        />
      );

    case 'share-method-picker':
      return (
        <TransferMethodPicker
          onSelectP2P={() => setScreen('share-p2p')}
          onSelectQuick={() => setScreen('share-quick')}
          onBack={() => setScreen('share-hotspot-check')}
        />
      );

    case 'share-quick':
      return <QuickShare onBack={() => setScreen('share-method-picker')} />;

    case 'share-p2p':
      return <P2PSession onBack={() => setScreen('share-method-picker')} />;

    case 'receive':
      return <ReceiveScreen onBack={() => setScreen('home')} />;

    case 'activity':
      return <ActivityScreen onBack={() => setScreen('home')} />;
    case 'support':
      return <SupportScreen onBack={() => setScreen('home')} />;
    case 'rate':
      return <RateUsScreen onBack={() => setScreen('home')} />;

    case 'home':
    default:
      return <HomeScreen currentScreen={screen} setScreen={setScreen} />;

  }
};

export default App;