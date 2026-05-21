import React, { useState, useEffect } from "react";
import { FaFolderOpen } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import styles from "../../styles/screens/SettingsScreen.module.css";

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

      {/* Language Card */}
      <div className={styles.card}>
        <h3>{t("language")}</h3>
        <select
          className={styles.langSelect}
          value={currentLang}
          onChange={async (e) => {
            const lang = e.target.value;
            await window.electronAPI.setLanguage(lang);
            const newTranslations = await window.electronAPI.getTranslations(lang);
            i18next.addResourceBundle(lang, "translation", newTranslations);
            await i18next.changeLanguage(lang);
            setCurrentLang(lang);
          }}
        >
          <option value="en">English</option>
          <option value="yo">Yoruba</option>
          <option value="ha">Hausa</option>
          <option value="ig">Igbo</option>
        </select>
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
    </div>
  );
};

export default SettingsScreen;