"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export const CANONICAL_THEME_KEY = "solarithm_theme_mode";
export const LEGACY_THEME_KEY = "solarithm-theme";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = (localStorage.getItem(CANONICAL_THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY)) as Theme;
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          return saved;
        }
        return document.documentElement.classList.contains('dark') ? 'dark' : 'dark';
      } catch {
        return 'dark';
      }
    }
    return 'dark';
  });

  const applyThemeToDOM = (t: Theme) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');

    if (t === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (systemDark) {
        root.classList.add('dark');
      } else {
        root.classList.add('light');
      }
    } else if (t === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.add('light');
    }
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    applyThemeToDOM(newTheme);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(CANONICAL_THEME_KEY, newTheme);
        localStorage.setItem(LEGACY_THEME_KEY, newTheme);
      } catch {
        // Ignore storage exceptions
      }
    }
  };

  const toggleTheme = () => {
    if (typeof document === 'undefined') return;
    const isCurrentlyDark = document.documentElement.classList.contains('dark');
    const nextTheme: Theme = isCurrentlyDark ? 'light' : 'dark';
    setTheme(nextTheme);
  };

  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Handle system theme changes dynamically
  useEffect(() => {
    if (theme !== 'system') return;
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (typeof document === 'undefined') return;
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(e.matches ? 'dark' : 'light');
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
