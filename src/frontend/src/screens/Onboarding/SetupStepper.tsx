import React, { useState } from 'react';

interface Props {
  onComplete: () => void;
}

const steps = [
  {
    title: 'Open Add Hardware Wizard',
    instruction: 'Click the button below. A hardware wizard will open automatically.',
    note: 'When it opens, click "Next" to continue.',
  },
  {
    title: 'Select Hardware Type',
    instruction: 'In the wizard, choose "Install the hardware that I manually select from a list", then click Next.',
    note: 'Scroll down and select "Network adapters", then click Next.',
  },
  {
    title: 'Select the Loopback Adapter',
    instruction: 'In the Manufacturer list, select "Microsoft". In the Model list, select "Microsoft KM-TEST Loopback Adapter".',
    note: 'Click Next, then Finish.',
  },
  {
    title: 'Verify Setup',
    instruction: 'Click the button below to check if the adapter was installed correctly.',
    note: 'You should see a green checkmark if everything is ready.',
  },
];

const SetupStepper: React.FC<Props> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  const launchWizard = async () => {
    try {
      await window.electronAPI.startHotspot(); // temporary — we'll add a dedicated launchWizard IPC later
    } catch {
      // ignore
    }
  };

  const verifySetup = async () => {
    setVerifyStatus('checking');
    try {
      const result = await window.electronAPI.startHotspot();
      if (result.includes('SUCCESS') || result.includes('Loopback') || result.includes('Using adapter')) {
        setVerifyStatus('ok');
      } else {
        setVerifyStatus('fail');
      }
    } catch {
      setVerifyStatus('fail');
    }
  };

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div style={{
      background: '#0A0A0A',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      padding: '40px 20px',
    }}>
      <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🦅 MAYO Share</div>
      <div style={{ color: '#888', marginBottom: '40px' }}>First-time setup</div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '40px' }}>
        {steps.map((_, i) => (
          <div key={i} style={{
            width: '32px', height: '4px', borderRadius: '2px',
            background: i <= currentStep ? '#0066FF' : '#333',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>

      {/* Card */}
      <div style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: '16px',
        padding: '32px',
        maxWidth: '480px',
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{ color: '#0066FF', fontSize: '0.85rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Step {currentStep + 1} of {steps.length}
        </div>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.3rem' }}>{step.title}</h2>
        <p style={{ color: '#ccc', lineHeight: '1.6', marginBottom: '12px' }}>{step.instruction}</p>
        <p style={{ color: '#777', fontSize: '0.9rem', marginBottom: '28px' }}>{step.note}</p>

        {/* Action for step 1 */}
        {currentStep === 0 && (
          <button onClick={launchWizard} style={btnStyle}>
            Open Hardware Wizard
          </button>
        )}

        {/* Action for step 3 (verify) */}
        {isLastStep && (
          <div>
            <button onClick={verifySetup} style={btnStyle} disabled={verifyStatus === 'checking'}>
              {verifyStatus === 'checking' ? 'Checking...' : 'Verify Setup'}
            </button>
            {verifyStatus === 'ok' && (
              <div style={{ color: '#4CAF50', marginTop: '16px', fontSize: '1.1rem' }}>
                ✅ Setup complete! You are ready to use MAYO Share.
              </div>
            )}
            {verifyStatus === 'fail' && (
              <div style={{ color: '#f44336', marginTop: '16px', fontSize: '0.95rem' }}>
                ❌ Adapter not found. Please go back and repeat the steps.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '32px' }}>
        {currentStep > 0 && (
          <button onClick={() => setCurrentStep(s => s - 1)} style={ghostBtnStyle}>
            ← Back
          </button>
        )}
        {!isLastStep && (
          <button onClick={() => setCurrentStep(s => s + 1)} style={btnStyle}>
            Next →
          </button>
        )}
        {isLastStep && verifyStatus === 'ok' && (
          <button onClick={onComplete} style={{ ...btnStyle, background: '#4CAF50' }}>
            Enter MAYO Share →
          </button>
        )}
        <button onClick={onComplete} style={ghostBtnStyle}>
          Skip for now
        </button>
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: '12px 28px',
  fontSize: '16px',
  background: '#0066FF',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '12px 28px',
  fontSize: '16px',
  background: 'transparent',
  color: '#888',
  border: '1px solid #333',
  borderRadius: '8px',
  cursor: 'pointer',
};

export default SetupStepper;