import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { initI18n } from "./i18n";
import { ThemeProvider } from "./context/ThemeContext";
import "./styles/main.css";
import "./styles/themes.css";   // <-- new

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container!);

initI18n().then(() => {
  root.render(
    <React.StrictMode>
      <I18nextProvider i18n={i18next}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </I18nextProvider>
    </React.StrictMode>
  );
});