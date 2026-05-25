import React from "react";
import { useTheme } from "../context/ThemeContext";
import { FaSun, FaMoon } from "react-icons/fa";
import styles from "../styles/components/LightModeToggle.module.css";

const LightModeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button className={styles.toggleBtn} onClick={toggleTheme} title="Toggle light/dark mode">
      {isDark ? <FaSun size={18} /> : <FaMoon size={18} />}
    </button>
  );
};

export default LightModeToggle;