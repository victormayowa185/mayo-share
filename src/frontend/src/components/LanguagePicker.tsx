import React, { useState, useRef, useEffect } from "react";
import styles from "../styles/components/LanguagePicker.module.css";

interface LanguageOption {
  code: string;
  name: string;
}

interface Props {
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
}

const LanguagePicker: React.FC<Props> = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const selectedOption = options.find((o) => o.code === value) || options[0];
  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase())
  );

  // Reset focused index when filtered list changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [filtered]);

  // Scroll focused option into view
  useEffect(() => {
    if (open && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [focusedIndex, open]);

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
    selectorRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;

    if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
      selectorRef.current?.focus();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filtered[focusedIndex]) {
      e.preventDefault();
      handleSelect(filtered[focusedIndex].code);
    }
  };

  const handleSelectorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(!open);
      if (!open) {
        const selectedIdx = filtered.findIndex(o => o.code === value);
        setFocusedIndex(selectedIdx >= 0 ? selectedIdx : 0);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div
        ref={selectorRef}
        className={styles.selector}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="language-listbox"
        aria-label="Select language"
        tabIndex={0}
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        onKeyDown={handleSelectorKeyDown}
      >
        <span className={styles.selectedLabel}>{selectedOption.name}</span>
        <span className={styles.arrow} aria-hidden="true">▼</span>
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
            aria-label="Search languages"
          />
          <ul
            className={styles.list}
            role="listbox"
            id="language-listbox"
          >
            {filtered.map((opt, idx) => (
              <li
                key={opt.code}
                ref={(el) => (optionRefs.current[idx] = el)}
                role="option"
                aria-selected={opt.code === value}
                className={`${styles.option} ${opt.code === value ? styles.selected : ""} ${idx === focusedIndex ? styles.focused : ""}`}
                onClick={() => handleSelect(opt.code)}
              >
                {opt.name}
              </li>
            ))}
            {filtered.length === 0 && (
              <li className={styles.noResult} role="option" aria-disabled="true">
                No language found
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LanguagePicker;