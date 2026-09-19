"use client";

import { useState, useEffect, useRef } from "react";
import { collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS, RegisteredAppItem } from "@/src/config/schema";
import { appRegistry, RegisteredApp } from "@/src/config/appRegistry";
import { LayoutGrid, ExternalLink, Briefcase, ShieldCheck, Layers, BarChart3, AppWindow, Loader2 } from "lucide-react";

interface AppLauncherDropdownProps {
  currentUserRole?: string;
}

export default function AppLauncherDropdown({ currentUserRole = "sales" }: AppLauncherDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [apps, setApps] = useState<RegisteredApp[]>(appRegistry);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Close dropdown on outside click
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // Subscribe to registeredApps from central database
    try {
      const appsRef = collection(db, COLLECTIONS.REGISTERED_APPS);
      const q = query(appsRef, where("active", "==", true));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (!snapshot.empty) {
            const firestoreApps: RegisteredApp[] = snapshot.docs.map((d) => {
              const data = d.data() as RegisteredAppItem;
              return {
                id: d.id,
                name: data.name,
                url: data.url,
                description: data.description || "",
                category: data.category || "General",
                active: data.active,
                icon: data.icon || "AppWindow",
                allowedRoles: data.allowedRoles,
                createdAt: data.createdAt
              };
            });

            // Merge with local fallback registry (avoiding duplicate IDs/names)
            const mergedMap = new Map<string, RegisteredApp>();
            appRegistry.forEach((app) => mergedMap.set(app.name.toLowerCase(), app));
            firestoreApps.forEach((app) => mergedMap.set(app.name.toLowerCase(), app));
            setApps(Array.from(mergedMap.values()));
          }
        },
        (err) => {
          // Gracefully retain local registry if permission restricted or not populated
          console.warn("App launcher live sync notice:", err);
        }
      );
      return () => unsubscribe();
    } catch (e) {
      console.warn("App launcher init error:", e);
    }
  }, []);

  const getIcon = (iconName?: string) => {
    switch (iconName) {
      case "Briefcase":
        return <Briefcase className="w-5 h-5 text-amber-500" />;
      case "ShieldCheck":
        return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
      case "Layers":
        return <Layers className="w-5 h-5 text-blue-500" />;
      case "BarChart3":
        return <BarChart3 className="w-5 h-5 text-purple-500" />;
      default:
        return <AppWindow className="w-5 h-5 text-amber-500" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        id="app-launcher-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Solarithm Ecosystem Apps"
        title="Solarithm Ecosystem Apps"
        className="p-2 text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-[#D4AF37] hover:bg-gray-100 dark:hover:bg-[#2A2A2A] rounded-lg transition-colors"
      >
        <LayoutGrid className="w-5 h-5" />
      </button>

      {isOpen && (
        <div
          id="app-launcher-menu"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-gray-200 dark:border-[#333333] p-4 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#2A2A2A] mb-3">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">Solarithm Ecosystem</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Integrated suite of solar enterprise apps</p>
            </div>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-[#D4AF37]">
              Master Registry
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 max-h-[360px] overflow-y-auto pr-1">
            {apps.map((app) => (
              <a
                key={app.id || app.name}
                href={app.url || app.path || "#"}
                className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all ${
                  app.id === "solarithm-commerce"
                    ? "bg-amber-50/50 dark:bg-[#2A2A2A] border-amber-300 dark:border-amber-500/50"
                    : "bg-gray-50/50 dark:bg-[#1A1A1A] border-gray-200/60 dark:border-[#2E2E2E] hover:border-amber-400 dark:hover:border-[#D4AF37]/60"
                }`}
              >
                <div className="p-2 rounded-lg bg-white dark:bg-[#252525] border border-gray-100 dark:border-[#333333] shrink-0 mt-0.5">
                  {getIcon(app.icon)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                      {app.name}
                    </span>
                    {app.id === "solarithm-commerce" ? (
                      <span className="text-[10px] text-amber-600 dark:text-[#D4AF37] font-medium bg-amber-100/70 dark:bg-amber-900/30 px-1.5 py-0.5 rounded shrink-0">
                        Current
                      </span>
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                    {app.description}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
