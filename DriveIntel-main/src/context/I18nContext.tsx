import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import translations, { LangCode, TranslationKeys, LANGUAGES } from '../i18n/translations';

interface I18nContextType {
  lang: LangCode;
  t: (key: TranslationKeys) => string;
  setLang: (code: LangCode) => void;
  languages: typeof LANGUAGES;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  t: (key) => key,
  setLang: () => {},
  languages: LANGUAGES,
});

const PREFS_KEY = 'driveintel_prefs';

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<LangCode>('en');

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then(raw => {
      if (raw) {
        const p = JSON.parse(raw);
        if (p.language && translations[p.language as LangCode]) {
          setLangState(p.language as LangCode);
        }
      }
    }).catch(() => {});
  }, []);

  const setLang = useCallback((code: LangCode) => {
    setLangState(code);
    AsyncStorage.getItem(PREFS_KEY).then(raw => {
      const p = raw ? JSON.parse(raw) : {};
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...p, language: code }));
    }).catch(() => {});
  }, []);

  const t = useCallback((key: TranslationKeys): string => {
    return (translations[lang] as any)[key] ?? (translations.en as any)[key] ?? key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, t, setLang, languages: LANGUAGES }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
export default I18nContext;
