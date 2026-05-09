import React, { useState } from 'react';

const TopBar: React.FC = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <header style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: '#111',
      borderBottom: '1px solid #222',
      padding: '0 24px',
      height: '60px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ color: '#0066FF', fontWeight: 'bold', fontSize: '1.2rem', letterSpacing: '0.5px' }}>
        🦅 MAYO Share
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <IconBtn title="Help">❓</IconBtn>

        <div style={{ position: 'relative' }}>
          <IconBtn title="Profile" onClick={() => setDropdownOpen(o => !o)}>👤</IconBtn>

          {dropdownOpen && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                onClick={() => setDropdownOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
              />
              <div style={{
                position: 'absolute',
                right: 0,
                top: '44px',
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderRadius: '12px',
                minWidth: '200px',
                zIndex: 100,
                overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}>
                <DropdownItem icon="👤" label="My Device" muted />
                <div style={{ height: '1px', background: '#2a2a2a' }} />
                <DropdownItem icon="🌓" label="Theme: Dark" />
                <DropdownItem icon="📋" label="Activity" />
                <DropdownItem icon="🆘" label="Get Support" />
                <DropdownItem icon="⭐" label="Rate Us" />
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

const IconBtn: React.FC<{ children: React.ReactNode; title?: string; onClick?: () => void }> = ({ children, title, onClick }) => (
  <button
    title={title}
    onClick={onClick}
    style={{
      background: 'transparent',
      border: 'none',
      color: 'white',
      fontSize: '1.1rem',
      cursor: 'pointer',
      padding: '8px',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
    onMouseEnter={e => (e.currentTarget.style.background = '#222')}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
  >
    {children}
  </button>
);

const DropdownItem: React.FC<{ icon: string; label: string; muted?: boolean }> = ({ icon, label, muted }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    color: muted ? '#666' : '#ccc',
    cursor: muted ? 'default' : 'pointer',
    fontSize: '0.9rem',
  }}
    onMouseEnter={e => { if (!muted) (e.currentTarget as HTMLDivElement).style.background = '#252525'; }}
    onMouseLeave={e => { if (!muted) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </div>
);

export default TopBar;
