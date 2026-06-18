import i18next from "i18next";
import { initReactI18next } from "react-i18next";

// Supported language codes — must match src/locales/*.json files
const SUPPORTED = new Set([
  "en", "yo", "ha", "ig", "ar", "bn", "es", "fr", "hi", "pt", "ru", "ur", "zh"
]);

/**
 * Detect the OS/browser language and return the best supported code.
 * Falls back to "en" if nothing matches.
 */
function detectSystemLang(): string {
  const candidates = [
    ...(typeof navigator !== "undefined" ? (navigator.languages || []) : []),
    typeof navigator !== "undefined" ? navigator.language : "",
  ].filter(Boolean);

  for (const raw of candidates) {
    const code = raw.toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED.has(code)) return code;
  }
  return "en";
}

export async function initI18n() {
  try {
    let lang = await window.electronAPI.getLanguage();

    // If no language has been saved yet, auto-detect from the system
    if (!lang || !SUPPORTED.has(lang)) {
      lang = detectSystemLang();
    }

    let translations = await window.electronAPI.getTranslations(lang);

    // If translations are missing or empty, fall back to English
    if (!translations || Object.keys(translations).length === 0) {
      console.warn(`Missing translations for "${lang}", falling back to English`);
      translations = await window.electronAPI.getTranslations("en");
      lang = "en";
    }

    await i18next.use(initReactI18next).init({
      resources: {
        [lang]: { translation: translations }
      },
      lng: lang,
      fallbackLng: "en",
      interpolation: { escapeValue: false }
    });
  } catch (err) {
    console.error("i18n initialization failed:", err);
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: { en: { translation: {} } }
    });
  }
}