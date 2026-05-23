import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FaHistory, FaQuestionCircle, FaStar, FaCog } from "react-icons/fa";
import { CgProfile } from "react-icons/cg";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "../styles/components/TopBar.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onNavigate?: (screen: string) => void;
}

const TopBar: React.FC<Props> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hostname, setHostname] = useState("My Device");

  const headerRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
      );
    }
  }, []);

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

  return (
    <header className={styles.topbar} ref={headerRef}>
      <div className={styles.logo}>
        <span className={styles.logoText}>MAYO</span>
        <span className={styles.logoShare}>Share</span>
      </div>

      <div className={styles.actions}>
        <div className={styles.dropdownWrapper}>
          <button
            className={styles.iconBtn}
            data-tooltip={t("profile")}
            onClick={() => setDropdownOpen((o) => !o)}
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
                  <span>{hostname}</span>
                </div>
                <div className={styles.divider} />
                <div
                  className={styles.menuItem}
                  onClick={() => {
                    onNavigate?.("activity");
                    setDropdownOpen(false);
                  }}
                >
                  <FaHistory size={16} />
                  <span>{t("activity")}</span>
                </div>
                <div
                  className={styles.menuItem}
                  onClick={() => {
                    onNavigate?.("support");
                    setDropdownOpen(false);
                  }}
                >
                  <FaQuestionCircle size={16} />
                  <span>{t("getSupport")}</span>
                </div>
                <div
                  className={styles.menuItem}
                  onClick={() => {
                    onNavigate?.("settings");
                    setDropdownOpen(false);
                  }}
                >
                  <FaCog size={16} />
                  <span>{t("settings")}</span>
                </div>
                <div
                  className={styles.menuItem}
                  onClick={() => {
                    onNavigate?.("rate");
                    setDropdownOpen(false);
                  }}
                >
                  <FaStar size={16} />
                  <span>{t("rateUs")}</span>
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
