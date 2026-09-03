import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors } from '../theme/colors';

type ColorScheme = typeof darkColors;

interface ThemeContextType {
  isDark: boolean;
  colors: ColorScheme;
  toggleTheme: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: true,
  colors: darkColors,
  toggleTheme: () => {},
});

const PREFS_KEY = 'driveintel_prefs';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then(raw => {
      if (raw) {
        const p = JSON.parse(raw);
        if (p.darkMode !== undefined) setIsDark(p.darkMode);
      }
    }).catch(() => {});
  }, []);

  const toggleTheme = (value: boolean) => {
    setIsDark(value);
    AsyncStorage.getItem(PREFS_KEY).then(raw => {
      const p = raw ? JSON.parse(raw) : {};
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...p, darkMode: value }));
    }).catch(() => {});
  };

  const colors = useMemo(() => (isDark ? darkColors : lightColors), [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
export default ThemeContext;
