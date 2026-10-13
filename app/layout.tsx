import type {Metadata} from 'next';
import { Inter } from "next/font/google";
import './globals.css';
import { ThemeProvider } from '@/lib/ThemeContext';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Solarithm OS',
  description: 'Enterprise solar operating system and admin console for project management, proposals, clients, billing, and commissions.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var mode = localStorage.getItem('solarithm_theme_mode') || localStorage.getItem('solarithm-theme');
                  var supportDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (mode === 'light' || (!mode && !supportDark)) {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.classList.add('light');
                  } else {
                    document.documentElement.classList.remove('light');
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `
          }}
        />
      </head>
      <body suppressHydrationWarning className="font-sans text-base text-gray-900 dark:text-gray-200 bg-gray-50 dark:bg-[#121212] transition-colors duration-200">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
