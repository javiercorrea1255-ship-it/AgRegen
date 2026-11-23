import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { translations, type Locale } from "./translations";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

const STORAGE_KEY = "agregen-locale";

function setLocaleCookie(value: string) {
  if (typeof document === "undefined") return;
  // 1 year, lax — readable by SSR middleware to render localized HTML
  // before React hydrates.
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${STORAGE_KEY}=${value}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ["es", "en", "pt", "zh", "nah"].includes(stored)) {
        // Backfill cookie on first load so SSR can read it on next request.
        setLocaleCookie(stored);
        return stored as Locale;
      }
    } catch {}
    return "es";
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {}
    setLocaleCookie(newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = getNestedValue(translations[locale], key);
      if (value === undefined) {
        value = getNestedValue(translations["es"], key);
      }
      if (value === undefined) {
        return key;
      }
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          value = value!.replace(`{${k}}`, String(v));
        });
      }
      return value;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

export const localeNames: Record<Locale, string> = {
  es: "Español",
  en: "English",
  pt: "Português",
  zh: "中文",
  nah: "Nāhuatl",
};

export const localeFlags: Record<Locale, string> = {
  es: "🇲🇽",
  en: "🇺🇸",
  pt: "🇧🇷",
  zh: "🇨🇳",
  nah: "🦅",
};
