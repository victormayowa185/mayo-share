import React, { useState, useRef, useEffect } from "react";
import styles from "../styles/components/LanguagePicker.module.css";

interface LanguageOption {
  code: string;
  name: string; // native name, e.g. "Yorùbá"
}

interface Props {
  options: LanguageOption[];
  value: string;            // currently selected language code (e.g. "en")
  onChange: (code: string) => void;
}

const LanguagePicker: React.FC<Props> = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.code === value) || options[0];

  // Filter based on search text (case‑insensitive)
  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div
        className={styles.selector}
        onClick={() => {
          setOpen(!open);
          if (!open) {
            // Focus input after animation frame
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
      >
        <span className={styles.selectedLabel}>{selectedOption.name}</span>
        <span className={styles.arrow}>▼</span>
      </div>

      {open && (
        <div className={styles.dropdown}>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search language…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <ul className={styles.list}>
            {filtered.map((opt) => (
              <li
                key={opt.code}
                className={`${styles.option} ${opt.code === value ? styles.selected : ""}`}
                onClick={() => handleSelect(opt.code)}
              >
                {opt.name}
              </li>
            ))}
            {filtered.length === 0 && (
              <li className={styles.noResult}>No language found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LanguagePicker;