import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export async function initI18n() {
  try {
    let lang = await window.electronAPI.getLanguage();
    // Fallback to 'en' if no language is set
    if (!lang) lang = "en";

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
    // Last resort – init with empty English resources so the app doesn't crash
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: { en: { translation: {} } }
    });
  }
}