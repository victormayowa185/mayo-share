import React, { useState, useEffect, useRef } from "react";
import { FaFolderOpen } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { getTheme, applyTheme } from "../../themeInit";
import styles from "../../styles/screens/SettingsScreen.module.css";
import LanguagePicker from "../../components/LanguagePicker"; // ✅ IMPORT

gsap.registerPlugin(useGSAP);

// Language list (same as in LanguageSelectScreen)
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "yo", name: "Yorùbá" },
  { code: "ha", name: "Hausa" },
  { code: "ig", name: "Igbo" },
  { code: "ar", name: "العربية" },
  { code: "bn", name: "বাংলা" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "ur", name: "اردو" },
  { code: "zh", name: "中文" },
];

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
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark">("system");

  const cardsRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (cardsRef.current) {
      const ctx = gsap.context(() => {
        const cards = cardsRef.current!.querySelectorAll(`.${styles.card}`);
        gsap.fromTo(
          cards,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.35,
            stagger: 0.1,
            ease: "power2.out",
          }
        );
      });
      return () => ctx.revert();
    }
  }, []);

  useEffect(() => {
    const saved = getTheme();
    setThemeMode(saved);
  }, []);

  const handleThemeChange = (mode: "system" | "light" | "dark") => {
    setThemeMode(mode);
    applyTheme(mode);
  };

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

  const handleDeviceNameSave = async () => {
    if (!editDeviceName.trim()) {
      setStatus(t("deviceNameRequired"));
      setTimeout(() => setStatus(""), 2000);
      return;
    }
    try {
      await window.electronAPI.setDeviceName(editDeviceName);
      setDeviceName(editDeviceName);
      setEditingDevice(false);
      setStatus(t("deviceNameUpdated"));
      setTimeout(() => setStatus(""), 2000);
    } catch (err: any) {
      setStatus(t("saveFailed") + ": " + err.message);
    }
  };

  // Handle language change with the custom picker
  const handleLanguageChange = async (lang: string) => {
    await window.electronAPI.setLanguage(lang);
    const newTranslations = await window.electronAPI.getTranslations(lang);
    i18next.addResourceBundle(lang, "translation", newTranslations);
    await i18next.changeLanguage(lang);
    setCurrentLang(lang);
  };

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("settings")}</h2>

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
                <button className={styles.btn} onClick={handleDeviceNameSave}>
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

        {/* Language Card – NOW USING CUSTOM PICKER */}

        <div className={styles.card}>
          <h3>{t("language")}</h3>
          <p className={styles.cardDesc}>Select your preferred interface language.</p>
          <div style={{ width: '100%', marginTop: 12 }}>
            <LanguagePicker
              options={LANGUAGES}
              value={currentLang}
              onChange={handleLanguageChange}
            />
          </div>
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
            <FaFolderOpen size={20} color="#7C3EFF" />
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