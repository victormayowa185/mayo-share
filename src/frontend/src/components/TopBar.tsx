import React, { useState, useEffect } from 'react';
import { FaRegQuestionCircle, FaMoon, FaHistory, FaQuestionCircle, FaStar } from 'react-icons/fa';
import { CgProfile } from 'react-icons/cg';
import styles from '../styles/components/TopBar.module.css';
interface Props {
  onNavigate?: (screen: string) => void;
}

const TopBar: React.FC<Props> = ({ onNavigate }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hostname, setHostname] = useState('My Device');

  useEffect(() => {
    window.electronAPI.getHostname()
      .then(setHostname)
      .catch(() => setHostname('My Device'));
  }, []);

  return (
    <header className={styles.topbar}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>
          {/* Paste your cleaned SVG logo here (already there) */}
          <svg id="svg" fill="currentColor" version="1.1" width="400" height="354.74" viewBox="0 0 400 354.74" xmlns="http://www.w3.org/2000/svg">
            <g id="svgg">
              <path id="path0" d="M245.923 1.004 … (your full path0) … " stroke="none" fill-rule="evenodd"></path>
              <path id="path1" d="M218.129 14.393 … (your full path1) … " stroke="none" fill-rule="evenodd"></path>
            </g>
          </svg>
        </span>
        <span className={styles.logoText}>MAYO Share</span>
      </div>

      <div className={styles.actions}>
        <button className={styles.iconBtn} title="Help">
          <FaRegQuestionCircle size={20} />
        </button>

        <div className={styles.dropdownWrapper}>
          <button className={styles.iconBtn} title="Profile" onClick={() => setDropdownOpen(o => !o)}>
            <CgProfile size={20} />
          </button>

          {dropdownOpen && (
            <>
              <div className={styles.backdrop} onClick={() => setDropdownOpen(false)} />
              <div className={styles.menu}>
                <div className={styles.menuItemMuted}>
                  <CgProfile size={18} />
                  <span>{hostname}</span>
                </div>
                <div className={styles.divider} />
                <div className={styles.menuItem} onClick={() => { onNavigate?.('activity'); setDropdownOpen(false); }}>
                  <FaHistory size={16} /><span>Activity</span>
                </div>
                <div className={styles.menuItem} onClick={() => { onNavigate?.('support'); setDropdownOpen(false); }}>
                  <FaQuestionCircle size={16} /><span>Get Support</span>
                </div>
                <div className={styles.menuItem} onClick={() => { onNavigate?.('rate'); setDropdownOpen(false); }}>
                  <FaStar size={16} /><span>Rate Us</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;