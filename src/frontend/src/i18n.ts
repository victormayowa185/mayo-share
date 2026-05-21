import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export async function initI18n() {
  const lang = await window.electronAPI.getLanguage();
  const translations = await window.electronAPI.getTranslations(lang);

  await i18next
    .use(initReactI18next)
    .init({
      resources: {
        [lang]: { translation: translations }
      },
      lng: lang,
      fallbackLng: "en",
      interpolation: { escapeValue: false }
    });
}