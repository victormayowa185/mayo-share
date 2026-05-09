import React, { useState } from 'react';
import styles from '../../styles/components/TopBar.module.css';

const TopBar: React.FC = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <header className={styles.topbar}>
      <div className={styles.logo}>🦅 MAYO Share</div>

      <div className={styles.actions}>
        <button className={styles.iconBtn} title="Help">❓</button>

        <div className={styles.dropdownWrapper}>
          <button
            className={styles.iconBtn}
            title="Profile"
            onClick={() => setDropdownOpen(o => !o)}
          >
            👤
          </button>

          {dropdownOpen && (
            <>
              <div
                className={styles.backdrop}
                onClick={() => setDropdownOpen(false)}
              />
              <div className={styles.menu}>
                <div className={styles.menuItemMuted}>
                  <span>👤</span>
                  <span>My Device</span>
                </div>
                <div className={styles.divider} />
                <div className={styles.menuItem}>
                  <span>🌓</span>
                  <span>Theme: Dark</span>
                </div>
                <div className={styles.menuItem}>
                  <span>📋</span>
                  <span>Activity</span>
                </div>
                <div className={styles.menuItem}>
                  <span>🆘</span>
                  <span>Get Support</span>
                </div>
                <div className={styles.menuItem}>
                  <span>⭐</span>
                  <span>Rate Us</span>
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