// Shared Cross-App Inactivity Tracker per Ecosystem Architecture Audit [AUT-04] / [AUT-05]
export const SHARED_INACTIVITY_KEY = "solarithm_last_activity";
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export function recordUserActivity(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SHARED_INACTIVITY_KEY, Date.now().toString());
  } catch {
    // Ignore storage quota/security sandbox exceptions
  }
}

export function initGlobalInactivityMonitor(onTimeout: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
  const handleActivity = () => recordUserActivity();

  events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));
  recordUserActivity();

  const intervalId = setInterval(() => {
    try {
      const stored = localStorage.getItem(SHARED_INACTIVITY_KEY);
      const lastActive = stored ? parseInt(stored, 10) : Date.now();
      if (Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) {
        clearInterval(intervalId);
        onTimeout();
      }
    } catch {
      // In case localStorage is blocked
    }
  }, 10000);

  return () => {
    events.forEach((evt) => window.removeEventListener(evt, handleActivity));
    clearInterval(intervalId);
  };
}
