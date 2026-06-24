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

// Supported language codes (must match the list above)
const SUPPORTED_CODES = new Set(LANGUAGES.map(l => l.code));

/**
 * Given a browser/OS locale string like "fr-FR", "zh-Hans-CN", "pt-BR",
 * return the best matching code from SUPPORTED_CODES, or "en" as fallback.
 */
function detectSystemLanguage(): string {
  // navigator.languages is ordered by preference; navigator.language is the top pick
  const candidates: string[] = [
    ...(navigator.languages || []),
    navigator.language,
  ].filter(Boolean);

  for (const raw of candidates) {
    // Try exact match first (e.g. "fr")
    const lower = raw.toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_CODES.has(lower)) return lower;
  }

  return "en"; // default fallback
}

interface Props {
  onComplete: () => void;
}

const LanguageSelectScreen: React.FC<Props> = ({ onComplete }) => {
  const { t } = useTranslation();

  // Detect system language immediately — this is what shows in the picker
  // before the user changes anything, and the welcome text will already be
  // in that language because i18n was initialised with it.
  const [currentLang, setCurrentLang] = useState<string>(() => detectSystemLanguage());

  // Refs for GSAP
  const mayoRef = useRef<HTMLSpanElement>(null);
  const shareRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // On mount: apply the detected language so the whole screen renders in it
  useEffect(() => {
    (async () => {
      const detected = detectSystemLanguage();

      // Only override if no language has been explicitly saved before
      const saved = await window.electronAPI.getLanguage();
      const langToUse = (saved && SUPPORTED_CODES.has(saved)) ? saved : detected;

      setCurrentLang(langToUse);

      // Switch i18n to detected/saved language so the UI text is in that lang
      try {
        const translations = await window.electronAPI.getTranslations(langToUse);
        if (translations && Object.keys(translations).length > 0) {
          i18next.addResourceBundle(langToUse, "translation", translations, true, true);
          await i18next.changeLanguage(langToUse);
        }
      } catch { /* keep whatever language is already loaded */ }
    })();
  }, []);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    tl.fromTo(
      mayoRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4 }
    );

    tl.fromTo(
      shareRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4 },
      "+=0.3"
    );

    tl.fromTo(
      [subtitleRef.current, pickerRef.current, btnRef.current],
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, stagger: 0.1 },
      "+=0.2"
    );
  }, []);

  const handleLanguageChange = async (lang: string) => {
    // Only switch the in-memory UI language for live preview.
    // Do NOT call setLanguage() here — that persists languageSet:true and would
    // permanently skip this screen just because the user previewed a language.
    // Persistence happens only in handleContinue() when the user clicks Continue.
    const newTranslations = await window.electronAPI.getTranslations(lang);
    i18next.addResourceBundle(lang, "translation", newTranslations, true, true);
    await i18next.changeLanguage(lang);
    setCurrentLang(lang);
  };


const handleContinue = async () => {
    // Always persist the selected language via IPC (even if user never touched
    // the dropdown). This is what App.tsx checks — not localStorage — so it
    // works correctly in both dev and the production exe.
    await window.electronAPI.setLanguage(currentLang);
    onComplete();
  };

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
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