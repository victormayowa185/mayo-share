import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FaFolderOpen } from "react-icons/fa";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "../../styles/screens/SaveFolderScreen.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onComplete: () => void;
}

const SaveFolderScreen: React.FC<Props> = ({ onComplete }) => {
  const { t } = useTranslation();
  const [savePath, setSavePath] = useState("");

  const mayoRef = useRef<HTMLSpanElement>(null);
  const shareRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Load the current/default save path on mount (Downloads by default).
  useEffect(() => {
    (async () => {
      try {
        const path = await window.electronAPI.getSavePath();
        setSavePath(path);
      } catch { /* ignore */ }
    })();
  }, []);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.fromTo(mayoRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4 });
    tl.fromTo(shareRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4 }, "+=0.2");
    tl.fromTo(
      [subtitleRef.current, cardRef.current, btnRef.current],
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, stagger: 0.1 },
      "+=0.2"
    );
  }, []);

  const handleChange = async () => {
    try {
      const folder = await window.electronAPI.selectSaveFolder();
      if (folder) {
        await window.electronAPI.setSavePath(folder); // persist immediately
        setSavePath(folder);
      }
    } catch { /* ignore */ }
  };

  const handleContinue = async () => {
    // Make sure the path (default or chosen) is persisted before moving on.
    try {
      if (savePath) await window.electronAPI.setSavePath(savePath);
    } catch { /* ignore */ }
    onComplete();
  };

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h1 className={styles.logo}>
          <span ref={mayoRef} className={styles.mayo}>MAYO</span>{" "}
          <span ref={shareRef} className={styles.share}>Share</span>
        </h1>

        <p className={styles.subtitle} ref={subtitleRef}>{t("firstTimeSetup")}</p>

        <div className={styles.card} ref={cardRef}>
          <div className={styles.cardHeader}>
            <FaFolderOpen size={20} color="var(--accent)" />
            <h3>{t("saveFolder")}</h3>
          </div>
          <p className={styles.cardDesc}>{t("saveFolderDesc")}</p>

          <div className={styles.pathDisplay} title={savePath}>{savePath}</div>

          <button className={styles.changeBtn} onClick={handleChange}>
            <FaFolderOpen style={{ marginRight: 6 }} /> {t("changeFolder")}
          </button>
        </div>

        <button className={styles.continueBtn} ref={btnRef} onClick={handleContinue}>
          {t("continue")}
        </button>
      </div>
    </div>
  );
};

export default SaveFolderScreen;
