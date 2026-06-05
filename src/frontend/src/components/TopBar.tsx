import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FaHistory, FaQuestionCircle, FaStar, FaCog } from "react-icons/fa";
import { CgProfile } from "react-icons/cg";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "../styles/components/TopBar.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onNavigate?: (screen: any) => void;
}

const TopBar: React.FC<Props> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hostname, setHostname] = useState("My Device");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Menu items for keyboard navigation
  const menuItems = [
    { id: "activity", icon: FaHistory, label: t("activity") },
    { id: "support", icon: FaQuestionCircle, label: t("getSupport") },
    { id: "settings", icon: FaCog, label: t("settings") },
    { id: "rate", icon: FaStar, label: t("rateUs") },
  ];

  const loadHostname = async () => {
    try {
      const name = await window.electronAPI.getHostname();
      setHostname(name);
    } catch {
      setHostname("My Device");
    }
  };

  useEffect(() => {
    loadHostname();
  }, []);

  useEffect(() => {
    window.electronAPI.onDeviceNameChanged((newName: string) => {
      setHostname(newName);
    });
  }, []);

  useGSAP(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
      );
    }
  }, []);

  // Reset focused index when menu opens/closes
  useEffect(() => {
    if (dropdownOpen) {
      setFocusedIndex(0);
      itemRefs.current[0]?.focus();
    } else {
      buttonRef.current?.focus();
    }
  }, [dropdownOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!dropdownOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setDropdownOpen(false);
      buttonRef.current?.focus();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, menuItems.length - 1));
      itemRefs.current[focusedIndex + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
      itemRefs.current[focusedIndex - 1]?.focus();
    } else if (e.key === "Enter" && menuItems[focusedIndex]) {
      e.preventDefault();
      onNavigate?.(menuItems[focusedIndex].id);
      setDropdownOpen(false);
    }
  };

  return (
    <header className={styles.topbar} ref={headerRef}>
      <div className={styles.logo}>
        <span className={styles.logoText}>MAYO</span>
        <span className={styles.logoShare}>Share</span>
      </div>

      <div className={styles.actions}>
        <div className={styles.dropdownWrapper}>
          <button
            ref={buttonRef}
            className={styles.iconBtn}
            aria-label={t("profile")}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            onClick={() => setDropdownOpen((o) => !o)}
          >
            <CgProfile size={20} aria-hidden="true" />
          </button>

          {dropdownOpen && (
            <>
              <div
                className={styles.backdrop}
                onClick={() => setDropdownOpen(false)}
              />
              <div
                ref={menuRef}
                className={styles.menu}
                role="menu"
                id="profile-menu"
                onKeyDown={handleKeyDown}
              >
                <div className={styles.menuItemMuted} role="presentation">
                  <CgProfile size={18} aria-hidden="true" />
                  <span>{hostname}</span>
                </div>
                <div className={styles.divider} role="separator" />
                {menuItems.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      ref={(el) => (itemRefs.current[idx] = el)}
                      className={styles.menuItem}
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => {
                        onNavigate?.(item.id);
                        setDropdownOpen(false);
                      }}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;