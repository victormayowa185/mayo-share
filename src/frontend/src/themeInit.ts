export function initTheme() {
  const saved = localStorage.getItem("theme-mode") as
    | "system"
    | "light"
    | "dark"
    | null;
  const apply = (mode: "system" | "light" | "dark") => {
    if (mode === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute(
        "data-theme",
        isDark ? "dark" : "light",
      );
    } else {
      document.documentElement.setAttribute("data-theme", mode);
    }
  };
  if (saved && ["system", "light", "dark"].includes(saved)) {
    apply(saved);
  } else {
    apply("system");
    localStorage.setItem("theme-mode", "system");
  }
}

export function applyTheme(mode: "system" | "light" | "dark") {
  if (mode === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute(
      "data-theme",
      isDark ? "dark" : "light",
    );
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
  localStorage.setItem("theme-mode", mode);
}

// NEW: Get current theme from localStorage (single source of truth)
export function getTheme(): "system" | "light" | "dark" {
  const saved = localStorage.getItem("theme-mode") as
    | "system"
    | "light"
    | "dark"
    | null;
  if (saved && ["system", "light", "dark"].includes(saved)) {
    return saved;
  }
  return "system";
}
