import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import LanguagePicker from "../../components/LanguagePicker";
import styles from "../../styles/screens/LanguageSelectScreen.module.css";

gsap.registerPlugin(useGSAP);

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
  onComplete: () => void;
}

const LanguageSelectScreen: React.FC<Props> = ({ onComplete }) => {
  const { t } = useTranslation();
  const [currentLang, setCurrentLang] = useState("en");

  // Refs for GSAP
  const mayoRef = useRef<HTMLSpanElement>(null);
  const shareRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (async () => {
      const lang = await window.electronAPI.getLanguage();
      setCurrentLang(lang);
    })();
  }, []);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    // 1. "MAYO" fades in
    tl.fromTo(
      mayoRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4 }
    );

    // 2. "Share" follows with a slight overlap
    tl.fromTo(
      shareRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4 },
      "+=0.3"
    );

    // 3. Subtitle, picker, and button stagger in
    tl.fromTo(
      [subtitleRef.current, pickerRef.current, btnRef.current],
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, stagger: 0.1 },
      "+=0.2"
    );
  }, []);

  const handleLanguageChange = async (lang: string) => {
    await window.electronAPI.setLanguage(lang);
    const newTranslations = await window.electronAPI.getTranslations(lang);
    i18next.addResourceBundle(lang, "translation", newTranslations);
    await i18next.changeLanguage(lang);
    setCurrentLang(lang);
  };

  const handleContinue = () => {
    localStorage.setItem("mayo-language-set", "true");
    onComplete();
  };

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        {/* App name text – no logo image */}
        <h1 className={styles.logo}>
          <span ref={mayoRef} className={styles.mayo}>MAYO</span>{" "}
          <span ref={shareRef} className={styles.share}>Share</span>
        </h1>

        <p className={styles.subtitle} ref={subtitleRef}>
          {t("chooseLanguage")}
        </p>

        <div ref={pickerRef} className={styles.pickerWrapper}>
          <LanguagePicker
            options={LANGUAGES}
            value={currentLang}
            onChange={handleLanguageChange}
          />
        </div>

        <button
          ref={btnRef}
          className={styles.continueBtn}
          onClick={handleContinue}
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
};

export default LanguageSelectScreen;