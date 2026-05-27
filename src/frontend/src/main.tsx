import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { initI18n } from "./i18n";
import "./styles/main.css";
import "./styles/themes.css";
import { initTheme } from './themeInit';

const container = document.getElementById("root");
initTheme();  // ✅ initialise theme once, before React renders
const root = ReactDOM.createRoot(container!);

initI18n().then(() => {
  root.render(
    <React.StrictMode>
      <I18nextProvider i18n={i18next}>
        <App />
      </I18nextProvider>
    </React.StrictMode>
  );
});