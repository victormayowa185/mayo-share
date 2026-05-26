import React, { useState, useEffect, useRef } from "react";
import { FaFolderOpen } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "../../styles/screens/SettingsScreen.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
}

const SettingsScreen: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();
  const [savePath, setSavePath] = useState("");
  const [editPath, setEditPath] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState("");
  const [currentLang, setCurrentLang] = useState("en");
  const [deviceName, setDeviceName] = useState("");
  const [editDeviceName, setEditDeviceName] = useState("");
  const [editingDevice, setEditingDevice] = useState(false);

  // Theme state
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");
  let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

  // Apply theme based on mode
  const applyTheme = (mode: "system" | "light" | "dark") => {
    // Clean up previous listener
    if (systemThemeListener) {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      mql.removeEventListener("change", systemThemeListener);
      systemThemeListener = null;
    }

    if (mode === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const theme = mql.matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", theme);
      // Listen for system changes
      systemThemeListener = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      mql.addEventListener("change", systemThemeListener);
    } else {
      document.documentElement.setAttribute("data-theme", mode);
    }
  };

  // Load saved theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("theme-mode") as "system" | "light" | "dark" | null;
    if (saved && ["system", "light", "dark"].includes(saved)) {
      setThemeMode(saved);
      applyTheme(saved);
    } else {
      applyTheme("system");
    }
  }, []);

  const handleThemeChange = (mode: "system" | "light" | "dark") => {
    setThemeMode(mode);
    localStorage.setItem("theme-mode", mode);
    applyTheme(mode);
  };

  // Ref for GSAP animation
  const cardsRef = useRef<HTMLDivElement>(null);

  // GSAP entrance animation – stagger each card into view
  useGSAP(() => {
    if (cardsRef.current) {
      const cards = cardsRef.current.querySelectorAll(`.${styles.card}`);
      gsap.fromTo(
        cards,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.1,
          ease: "power2.out",
        },
      );
    }
  }, []);

  useEffect(() => {
    (async () => {
      const name = await window.electronAPI.getHostname();
      setDeviceName(name);
      setEditDeviceName(name);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const lang = await window.electronAPI.getLanguage();
      setCurrentLang(lang);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const path = await window.electronAPI.getSavePath();
      setSavePath(path);
      setEditPath(path);
    })();
  }, []);

  const handleBrowse = async () => {
    try {
      const folder = await window.electronAPI.selectSaveFolder();
      if (folder) {
        setEditPath(folder);
        setIsEditing(true);
      }
    } catch (err: any) {
      setStatus("Could not open folder picker: " + err.message);
    }
  };

  const handleSave = async () => {
    try {
      await window.electronAPI.setSavePath(editPath);
      setSavePath(editPath);
      setIsEditing(false);
      setStatus(t("saveFolderUpdated"));
      setTimeout(() => setStatus(""), 2000);
    } catch (err: any) {
      setStatus(t("saveFailed") + ": " + err.message);
    }
  };

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("settings")}</h2>

      {/* All cards are wrapped in this div so GSAP can animate them */}
      <div ref={cardsRef} style={{ width: "100%", display: "contents" }}>
        {/* Device Name Card */}
        <div className={styles.card}>
          <h3>{t("deviceName")}</h3>
          <p className={styles.cardDesc}>{t("deviceNameDesc")}</p>
          {!editingDevice ? (
            <>
              <div className={styles.pathDisplay}>{deviceName}</div>
              <button
                className={styles.btn}
                onClick={() => setEditingDevice(true)}
              >
                {t("changeDeviceName")}
              </button>
            </>
          ) : (
            <div className={styles.editRow}>
              <input
                className={styles.pathInput}
                value={editDeviceName}
                onChange={(e) => setEditDeviceName(e.target.value)}
                placeholder="My Laptop"
              />
              <div className={styles.editButtons}>
                <button
                  className={styles.btn}
                  onClick={async () => {
                    await window.electronAPI.setDeviceName(editDeviceName);
                    setDeviceName(editDeviceName);
                    setEditingDevice(false);
                  }}
                >
                  {t("save")}
                </button>
                <button
                  className={styles.ghostBtn}
                  onClick={() => {
                    setEditDeviceName(deviceName);
                    setEditingDevice(false);
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Language Card */}
        <div className={styles.card}>
          <h3>{t("language")}</h3>
          <select
            className={styles.langSelect}
            value={currentLang}
            onChange={async (e) => {
              const lang = e.target.value;
              await window.electronAPI.setLanguage(lang);
              const newTranslations =
                await window.electronAPI.getTranslations(lang);
              i18next.addResourceBundle(lang, "translation", newTranslations);
              await i18next.changeLanguage(lang);
              setCurrentLang(lang);
            }}
          >
            <option value="en">English</option>
            <option value="yo">Yoruba</option>
            <option value="ha">Hausa</option>
            <option value="ig">Igbo</option>
            <option value="ar">Arabic</option>
            <option value="bn">Bengali</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="hi">Hindi</option>
            <option value="pt">Portuguese</option>
            <option value="ru">Russian</option>
            <option value="ur">Urdu</option>
            <option value="zh">Chinese</option>
          </select>
        </div>

        {/* Theme Card */}
        <div className={styles.card}>
          <h3>{t("theme")}</h3>
          <p className={styles.cardDesc}>{t("themeDesc")}</p>
          <div className={styles.themeButtons}>
            <button
              className={`${styles.themeBtn} ${themeMode === "system" ? styles.active : ""}`}
              onClick={() => handleThemeChange("system")}
            >
              {t("system")}
            </button>
            <button
              className={`${styles.themeBtn} ${themeMode === "light" ? styles.active : ""}`}
              onClick={() => handleThemeChange("light")}
            >
              {t("light")}
            </button>
            <button
              className={`${styles.themeBtn} ${themeMode === "dark" ? styles.active : ""}`}
              onClick={() => handleThemeChange("dark")}
            >
              {t("dark")}
            </button>
          </div>
        </div>

        {/* Save Folder Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <FaFolderOpen size={20} color="#b169e0" />
            <h3>{t("saveFolder")}</h3>
          </div>
          <p className={styles.cardDesc}>{t("saveFolderDesc")}</p>

          {!isEditing ? (
            <>
              <div className={styles.pathDisplay}>{savePath}</div>
              <button className={styles.btn} onClick={() => setIsEditing(true)}>
                {t("changeFolder")}
              </button>
            </>
          ) : (
            <div className={styles.editRow}>
              <input
                className={styles.pathInput}
                value={editPath}
                onChange={(e) => setEditPath(e.target.value)}
                placeholder="C:\mayo-received"
              />
              <div className={styles.editButtons}>
                <button className={styles.btn} onClick={handleBrowse}>
                  {t("browse")}
                </button>
                <button className={styles.btn} onClick={handleSave}>
                  {t("save")}
                </button>
                <button
                  className={styles.ghostBtn}
                  onClick={() => {
                    setEditPath(savePath);
                    setIsEditing(false);
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
          {status && <p className={styles.status}>{status}</p>}
        </div>

        {/* About Card */}
        <div className={styles.card}>
          <h3>{t("about")}</h3>
          <p className={styles.cardDesc}>{t("aboutDescription")}</p>

          <p className={styles.aboutLabel}>{t("platforms")}</p>
          <p className={styles.cardDesc}>{t("platformsDetail")}</p>

          <p className={styles.aboutLabel}>{t("author")}</p>
          <p className={styles.cardDesc}>{t("authorName")}</p>

          <p className={styles.aboutLabel}>{t("contributions")}</p>
          <p className={styles.cardDesc}>{t("contributionsDetail")}</p>

          <p className={styles.aboutLabel}>{t("translations")}</p>
          <p className={styles.cardDesc}>{t("translationsDetail")}</p>

          <p className={styles.aboutLabel}>{t("license")}</p>
          <p className={styles.cardDesc}>{t("licenseDetail")}</p>

          <a
            href="https://github.com/victormayowa185/mayo-manual"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.supportLink}
          >
            {t("viewOnGitHub")}
          </a>
        </div>
      </div>
    </div>
  );
};

export default SettingsScreen;