import { useState, useEffect } from "react";

type Language = "fi" | "en";

const STORAGE_KEY = "preferred-language";

export function useLanguage() {
  const [lang, setLangState] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "fi" || stored === "en") {
        return stored;
      }
    }
    return "fi";
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem(STORAGE_KEY, newLang);
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "fi" || stored === "en") {
      setLangState(stored);
    }
  }, []);

  return { lang, setLang };
}
