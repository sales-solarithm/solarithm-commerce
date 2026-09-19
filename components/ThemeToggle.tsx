"use client";

import { useTheme } from '@/lib/ThemeContext';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useEffect, useState, useRef, useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

export default function ThemeToggle() {
  const { theme, setTheme, toggleTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleQuickToggle = () => {
    if (typeof document !== 'undefined') {
      const isCurrentlyDark = document.documentElement.classList.contains('dark');
      if (isCurrentlyDark) {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        setTheme('light');
      } else {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        setTheme('dark');
      }
    } else {
      toggleTheme();
    }
  };

  const handleSelectTheme = (newTheme: 'light' | 'dark' | 'system') => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      if (newTheme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(isDark ? 'dark' : 'light');
      } else if (newTheme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.add('light');
      }
    }
    setTheme(newTheme);
    setIsOpen(false);
  };

  if (!mounted) return <div className="w-9 h-9" />;

  return (
    <div className="relative inline-flex items-center" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleQuickToggle}
        title={`Current mode: ${theme}. Click to switch theme.`}
        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-[#2A2A2A] dark:hover:bg-[#333333] border border-gray-300 dark:border-[#333333] transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
        aria-label="Toggle theme"
      >
        {theme === 'light' ? (
          <Sun size={18} className="text-amber-600 transition-transform duration-200 hover:rotate-45" />
        ) : theme === 'dark' ? (
          <Moon size={18} className="text-[#D4AF37] transition-transform duration-200 hover:-rotate-12" />
        ) : (
          <Monitor size={18} className="text-gray-700 dark:text-[#D4AF37]" />
        )}
      </button>

      {/* Small subtle options toggle button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="ml-1 p-1 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors text-[10px]"
        title="Theme preferences"
        aria-expanded={isOpen}
      >
        <span className="sr-only">Theme preferences</span>
        ▼
      </button>
      
      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] rounded-lg shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-150">
          <button
            type="button"
            onClick={() => handleSelectTheme('light')}
            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors hover:bg-gray-100 dark:hover:bg-[#2A2A2A] ${
              theme === 'light' ? 'text-amber-600 font-bold bg-amber-50 dark:bg-[#2A2A2A]' : 'text-gray-700 dark:text-gray-200'
            }`}
          >
            <Sun size={14} className="text-amber-600" />
            <span>Light</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectTheme('dark')}
            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors hover:bg-gray-100 dark:hover:bg-[#2A2A2A] ${
              theme === 'dark' ? 'text-[#D4AF37] font-bold bg-amber-50/50 dark:bg-[#2A2A2A]' : 'text-gray-700 dark:text-gray-200'
            }`}
          >
            <Moon size={14} className="text-[#D4AF37]" />
            <span>Dark</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectTheme('system')}
            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors hover:bg-gray-100 dark:hover:bg-[#2A2A2A] ${
              theme === 'system' ? 'text-[#D4AF37] font-bold bg-amber-50/50 dark:bg-[#2A2A2A]' : 'text-gray-700 dark:text-gray-200'
            }`}
          >
            <Monitor size={14} />
            <span>System</span>
          </button>
        </div>
      )}
    </div>
  );
}

