import React, { useState } from 'react';
import { FaRegQuestionCircle } from 'react-icons/fa';
import { CgProfile } from 'react-icons/cg';
import styles from '../../styles/components/TopBar.module.css';

const TopBar: React.FC = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <header className={styles.topbar}>
      <div className={styles.logo}>🦅 MAYO Share</div>

      <div className={styles.actions}>
        <button className={styles.iconBtn} title="Help">
          <FaRegQuestionCircle size={20} />
        </button>

        <div className={styles.dropdownWrapper}>
          <button
            className={styles.iconBtn}
            title="Profile"
            onClick={() => setDropdownOpen(o => !o)}
          >
            <CgProfile size={20} />
          </button>

          {dropdownOpen && (
            <>
              <div
                className={styles.backdrop}
                onClick={() => setDropdownOpen(false)}
              />
              <div className={styles.menu}>
                <div className={styles.menuItemMuted}>
                  <CgProfile size={18} />
                  <span>My Device</span>
                </div>
                <div className={styles.divider} />
                <div className={styles.menuItem}>
                  {/* Replace with your theme icon import later */}
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