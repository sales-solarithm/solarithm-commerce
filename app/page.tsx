"use client";

import { useEffect, useState, useMemo } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, addDoc, serverTimestamp, getDocs, orderBy, limit, doc, getDoc, writeBatch, updateDoc } from "firebase/firestore";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import confetti from "canvas-confetti";
import { format } from "date-fns";
import { Loader2, LogOut, FileText, UserPlus, FolderOpen, ArrowLeft, Building2, CheckCircle2, Clock, AlertCircle, XCircle, X, Briefcase, Menu, BarChart3, CheckSquare, Clock3, RefreshCw, Users, Layers, Sparkles, Lock } from "lucide-react";
import { COLLECTIONS, CLIENT_STATUS, PROJECT_STATUS, CLIENT_FIELDS, PROJECT_FIELDS, APPROVAL_TYPES, APPROVAL_STATUS } from "@/src/config/schema";
import ThemeToggle from "@/components/ThemeToggle";
import AppLauncherDropdown from "@/components/AppLauncherDropdown";
import UpgradeProjectModal from "@/components/UpgradeProjectModal";
import { generateClientInitials, toTitleCase, getStatusColor, toScopeKey, parsePackageScopes, type ScopeItem } from "@/lib/utils";

// --- SCHEMAS ---

const clientSchema = z.object({
  companyName: z.string().min(1, "Company Name is required"),
  contactPerson: z.string().min(1, "Contact Person is required"),
  city: z.string().min(1, "City is required"),
  gstin: z.string().optional(),
  billingAddress: z.string().optional(),
  proposalNumber: z.string().min(1, "Proposal Number is required"),
}).superRefine((data, ctx) => {
  const hasGstin = Boolean(data.gstin && data.gstin.trim().length > 0);
  const hasBillingAddress = Boolean(data.billingAddress && data.billingAddress.trim().length > 0);
  if (hasGstin && !hasBillingAddress) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Billing Address is required when GSTIN is provided",
      path: ["billingAddress"],
    });
  }
});

type ClientFormData = z.infer<typeof clientSchema>;

const projectSchema = z.object({
  projectName: z.string().min(1, "Project Name is required"),
  clientId: z.string().min(1, "Client is required"),
  scopeOfWork: z.string().min(1, "Scope of Work is required"),
  subService: z.string().optional().nullable(),
  plantCapacity: z.number().nullable().optional(),
  capacityUnit: z.string().nullable().optional(),
  location: z.string().min(1, "Location is required"),
  designerId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

// --- CONSTANTS ---
const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

// --- MAIN COMPONENT ---
export default function ProjectEntryTool() {
  // Restore existing active session from sessionStorage if available
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = sessionStorage.getItem("solarithm_commerce_session");
      if (stored) {
        const session = JSON.parse(stored);
        return Boolean(session?.authenticated);
      }
    } catch {
      // Ignore storage read errors
    }
    return false;
  });

  const [userEmail, setUserEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem("solarithm_commerce_session");
      if (stored) {
        const session = JSON.parse(stored);
        return session?.email || null;
      }
    } catch {
      // Ignore
    }
    return null;
  });

  const [userRole, setUserRole] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem("solarithm_commerce_session");
      if (stored) {
        const session = JSON.parse(stored);
        return session?.role || null;
      }
    } catch {
      // Ignore
    }
    return null;
  });

  const [userName, setUserName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem("solarithm_commerce_session");
      if (stored) {
        const session = JSON.parse(stored);
        return session?.name || null;
      }
    } catch {
      // Ignore
    }
    return null;
  });

  const [tempEmail, setTempEmail] = useState("");
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [deniedAppDiagnostics, setDeniedAppDiagnostics] = useState<{
    apps: string[];
    email: string;
    role: string;
    dept: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"register" | "new_project" | "my_projects">("new_project");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Inactivity timeout (resets session after 5 minutes of inactivity)
  useEffect(() => {
    if (!isAuthenticated) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsAuthenticated(false);
        setUserEmail(null);
        setUserRole(null);
        setUserName(null);
        setErrorMessage("Session expired due to inactivity. Please log in again.");
        try {
          sessionStorage.removeItem("solarithm_commerce_session");
        } catch {
          // Ignore
        }
      }, 300000);
    };

    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);
    window.addEventListener("scroll", resetTimer);

    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
      window.removeEventListener("scroll", resetTimer);
    };
  }, [isAuthenticated]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserEmail(null);
    setUserRole(null);
    setUserName(null);
    setTempEmail("");
    setErrorMessage("");
    setDeniedAppDiagnostics(null);
    try {
      sessionStorage.removeItem("solarithm_commerce_session");
    } catch {
      // Ignore
    }
  };

  // Cross-checks against potential naming formats (slugs, display names, snake_case variants)
  const isCommerceAppIdentifier = (appId: string): boolean => {
    if (!appId || typeof appId !== "string") return false;
    const raw = appId.trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");

    const knownExact = [
      "solarithm_commerce",
      "solarithm-commerce",
      "solarithm commerce",
      "commerce",
      "project_entry",
      "project-entry",
      "projectentry"
    ];
    if (knownExact.includes(raw.toLowerCase())) return true;
    if (normalized === "solarithmcommerce" || normalized === "commerce" || normalized === "projectentry") {
      return true;
    }
    if (normalized.includes("commerce") || (normalized.includes("project") && normalized.includes("entry"))) {
      return true;
    }
    return false;
  };

  const handleUnlock = async (enteredEmail: string) => {
    if (!enteredEmail || !enteredEmail.trim()) {
      setErrorMessage("Please enter your work email.");
      setDeniedAppDiagnostics(null);
      return;
    }

    // 1. User Identification & Lookup:
    // Ensure check ignores trailing spaces and letter casing so matches are exact
    const normalizedEmail = enteredEmail.trim().toLowerCase();
    setIsVerifyingEmail(true);
    setErrorMessage("");
    setDeniedAppDiagnostics(null);

    // Super Admin Bypass
    const SUPER_ADMIN_EMAILS = ["jayjalpa2002@gmail.com", "jay.solarithm@gmail.com"];
    if (SUPER_ADMIN_EMAILS.includes(normalizedEmail)) {
      setIsAuthenticated(true);
      setUserEmail(normalizedEmail);
      setUserRole("owner");
      setUserName(normalizedEmail);
      setIsVerifyingEmail(false);
      try {
        sessionStorage.setItem("solarithm_commerce_session", JSON.stringify({
          authenticated: true,
          email: normalizedEmail,
          role: "owner",
          name: normalizedEmail,
          timestamp: Date.now()
        }));
      } catch {
        // Ignore
      }
      return;
    }

    try {
      const usersRef = collection(db, COLLECTIONS.USERS);
      let userDoc: any = null;
      let userId: string = "";

      // Exact match query on users collection
      const usersQ = query(usersRef, where("email", "==", normalizedEmail));
      const querySnapshot = await getDocs(usersQ);

      if (!querySnapshot.empty) {
        userDoc = querySnapshot.docs[0].data();
        userId = querySnapshot.docs[0].id;
      } else {
        // Fallback case-sensitive query if email was stored with original casing
        const enteredTrimmed = enteredEmail.trim();
        if (enteredTrimmed !== normalizedEmail) {
          const caseQ = query(usersRef, where("email", "==", enteredTrimmed));
          const caseSnap = await getDocs(caseQ);
          if (!caseSnap.empty) {
            userDoc = caseSnap.docs[0].data();
            userId = caseSnap.docs[0].id;
          }
        }
      }

      // If still not matched, scan all user records in users collection to guarantee
      // case-insensitive and whitespace-insensitive matching
      if (!userDoc) {
        const allUsersSnap = await getDocs(usersRef);
        const matchedDoc = allUsersSnap.docs.find(d => {
          const data = d.data();
          const dEmail = (data.email || "").trim().toLowerCase();
          const dPersonalEmail = (data.personalEmailAddress || "").trim().toLowerCase();
          const docId = d.id.trim().toLowerCase();
          return dEmail === normalizedEmail || dPersonalEmail === normalizedEmail || docId === normalizedEmail;
        });
        if (matchedDoc) {
          userDoc = matchedDoc.data();
          userId = matchedDoc.id;
        }
      }

      // Secondary lookup: check employees collection
      if (!userDoc) {
        const empRef = collection(db, COLLECTIONS.EMPLOYEES);
        const empQ = query(empRef, where("email", "==", normalizedEmail));
        const empSnap = await getDocs(empQ);
        if (!empSnap.empty) {
          userDoc = empSnap.docs[0].data();
          userId = empSnap.docs[0].id;
        } else {
          const allEmpSnap = await getDocs(empRef);
          const matchedEmp = allEmpSnap.docs.find(d => {
            const data = d.data();
            const dEmail = (data.email || "").trim().toLowerCase();
            return dEmail === normalizedEmail || d.id.trim().toLowerCase() === normalizedEmail;
          });
          if (matchedEmp) {
            userDoc = matchedEmp.data();
            userId = matchedEmp.id;
          }
        }
      }

      // If no user document is found across the database
      if (!userDoc) {
        setErrorMessage("No account found with this email.");
        setDeniedAppDiagnostics(null);
        setIsVerifyingEmail(false);
        return;
      }

      // 2. Access Validation Logic:
      // Reference the exact document structure and field: accessibleApps
      const accessibleApps: string[] = Array.isArray(userDoc.accessibleApps)
        ? userDoc.accessibleApps
        : (Array.isArray(userDoc.assignedApps) ? userDoc.assignedApps : (Array.isArray(userDoc.apps) ? userDoc.apps : []));

      // Cross-check against potential naming formats (slugs, display names, snake_case variants)
      const hasAppPermission = accessibleApps.some(appId => isCommerceAppIdentifier(appId));

      // Automatic grant: administrative role or Sales department
      const roleStr = String(userDoc.role || "").toLowerCase().trim();
      const assignedRoleStr = String(userDoc.assignedRole || "").toLowerCase().trim();
      const deptStr = String(userDoc.department || "").toLowerCase().trim();
      const designationStr = String(userDoc.designation || "").toLowerCase().trim();

      const isAdminRole = ["admin", "owner", "administrator", "superadmin", "management", "director"].some(
        r => roleStr === r || assignedRoleStr === r || designationStr.includes(r)
      );

      const isSalesDept = ["sales", "commercial", "business development", "presales", "pre-sales"].some(
        s => deptStr.includes(s) || roleStr.includes(s) || assignedRoleStr.includes(s) || designationStr.includes(s)
      );

      // Check companion app registry allowedEmployees if applicable
      let hasRegistryEmployeeAccess = false;
      const employeeId = userDoc.employeeId || userId || "";
      if (employeeId) {
        try {
          const appDocRef = doc(db, "apps", "solarithm_commerce");
          const appDocSnap = await getDoc(appDocRef);
          if (appDocSnap.exists()) {
            const allowedEmployees: string[] = appDocSnap.data().allowedEmployees || [];
            if (allowedEmployees.includes(employeeId) || allowedEmployees.includes(normalizedEmail)) {
              hasRegistryEmployeeAccess = true;
            }
          }
        } catch {
          // non-blocking companion check
        }
        if (!hasRegistryEmployeeAccess) {
          try {
            const appDocRef2 = doc(db, "registeredApps", "solarithm-commerce");
            const appDocSnap2 = await getDoc(appDocRef2);
            if (appDocSnap2.exists()) {
              const allowedEmployees: string[] = appDocSnap2.data().allowedEmployees || [];
              if (allowedEmployees.includes(employeeId) || allowedEmployees.includes(normalizedEmail)) {
                hasRegistryEmployeeAccess = true;
              }
            }
          } catch {
            // non-blocking companion check
          }
        }
      }

      const hasPermission = isAdminRole || isSalesDept || hasAppPermission || hasRegistryEmployeeAccess;

      if (hasPermission) {
        // 4. Session Activation:
        // Once validated, store active user state and redirect directly into the workspace
        const derivedRole = isAdminRole ? (roleStr.includes("owner") ? "owner" : "admin") : (isSalesDept ? "sales" : (userDoc.role || userDoc.assignedRole || "sales"));
        const displayName = userDoc.name || normalizedEmail;

        setIsAuthenticated(true);
        setUserEmail(normalizedEmail);
        setUserRole(derivedRole);
        setUserName(displayName);
        setErrorMessage("");
        setDeniedAppDiagnostics(null);

        try {
          sessionStorage.setItem("solarithm_commerce_session", JSON.stringify({
            authenticated: true,
            email: normalizedEmail,
            role: derivedRole,
            name: displayName,
            timestamp: Date.now()
          }));
        } catch {
          // Ignore
        }
      } else {
        // 3. Error Handling & Diagnostics:
        // Print retrieved list of assigned app identifiers directly to browser console
        console.warn(
          `[Solarithm Commerce] Access Denied for ${normalizedEmail}. Retrieved assigned app identifiers:`,
          accessibleApps,
          `User profile:`,
          userDoc
        );

        // Display on-screen alongside denial notice
        setDeniedAppDiagnostics({
          apps: accessibleApps,
          email: normalizedEmail,
          role: userDoc.role || userDoc.assignedRole || "Unassigned",
          dept: userDoc.department || "Unassigned"
        });

        setErrorMessage("Access Denied: You do not have permission to access Solarithm Commerce.");
      }
    } catch (error: any) {
      console.error("Error verifying access in Solarithm directory:", error);
      setDeniedAppDiagnostics(null);

      // Do not display generic denial errors if network or database read timeouts occur; handle as connection notices
      const errMsg = error?.message || String(error);
      const errCode = error?.code || "";

      if (
        errCode.includes("unavailable") ||
        errCode.includes("deadline-exceeded") ||
        errCode.includes("network") ||
        errMsg.toLowerCase().includes("timeout") ||
        errMsg.toLowerCase().includes("network") ||
        errMsg.toLowerCase().includes("failed to fetch") ||
        errMsg.toLowerCase().includes("offline")
      ) {
        setErrorMessage("Connection Notice: Unable to connect to the database server. Please check your network connection and try again.");
      } else if (errCode.includes("permission-denied")) {
        setErrorMessage("Security Notice: Database read permission error. Please verify access rules with your administrator.");
      } else {
        setErrorMessage(`Connection Notice: Unable to verify permissions (${errMsg || "Database read timeout"}). Please try again.`);
      }
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  // Lock Screen (Dark Charcoal #121212 & Metallic Gold #D4AF37)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#121212] p-4 font-sans select-none">
        <div className="w-full max-w-md bg-[#1E1E1E] p-8 rounded-xl shadow-2xl border border-[#333333] text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#2A2A2A] border border-[#3A3A3A] flex items-center justify-center mb-5 shadow-inner">
            <Briefcase className="w-7 h-7 text-[#D4AF37]" />
          </div>

          <div className="flex items-center justify-center gap-1.5 mb-2">
            <h1 className="text-2xl font-bold tracking-wide text-white">Solarithm</h1>
            <span className="text-2xl font-bold tracking-wide text-[#D4AF37]">Commerce</span>
          </div>

          <p className="text-gray-400 mb-6 text-sm sm:text-base">
            Please enter your work email to claim your profile and continue.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleUnlock(tempEmail);
            }}
            className="space-y-4"
          >
            <div className="text-left">
              <input
                type="email"
                value={tempEmail}
                onChange={(e) => {
                  setTempEmail(e.target.value);
                  setErrorMessage("");
                }}
                placeholder="name@company.com"
                className="w-full p-3.5 rounded-lg border border-[#2A2A2A] bg-[#121212] text-white placeholder-gray-500 focus:ring-2 focus:border-[#D4AF37] focus:ring-[#D4AF37] outline-none text-sm sm:text-base transition-colors"
                disabled={isVerifyingEmail}
                autoFocus
              />
            </div>

            {errorMessage && (
              <div className="text-left space-y-2">
                <p className="text-red-500 text-sm sm:text-base font-medium">
                  {errorMessage}
                </p>
                {deniedAppDiagnostics && (
                  <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs text-red-200">
                    <div className="flex items-center gap-1.5 font-semibold text-red-100 mb-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Permission Diagnostics</span>
                    </div>
                    <div className="space-y-1 text-gray-300">
                      <p><span className="text-gray-400">Account:</span> {deniedAppDiagnostics.email}</p>
                      <p><span className="text-gray-400">Role / Dept:</span> {deniedAppDiagnostics.role} &bull; {deniedAppDiagnostics.dept}</p>
                      <div className="pt-1.5 border-t border-red-900/50">
                        <span className="text-gray-400">Assigned Apps in Profile:</span>
                        {deniedAppDiagnostics.apps.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {deniedAppDiagnostics.apps.map((app, idx) => (
                              <span key={idx} className="px-1.5 py-0.5 rounded bg-black/60 border border-red-700/50 font-mono text-[11px] text-amber-300">
                                {app}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-amber-200/70 italic text-[11px] mt-0.5">
                            No application identifiers currently assigned (accessibleApps is empty)
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifyingEmail || !tempEmail.trim()}
              className="w-full py-3.5 bg-[#D4AF37] text-black font-semibold rounded-lg hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-base shadow-md"
            >
              {isVerifyingEmail ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Verifying Permissions...</span>
                </div>
              ) : (
                "Lock & Access"
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const currentUserObj = {
    email: userEmail,
    role: userRole,
    name: userName
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-gray-200 flex flex-col font-sans transition-colors duration-200">
      {/* Top Header */}
      <header className="bg-white dark:bg-[#1E1E1E] border-b border-gray-200 dark:border-[#D4AF37] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shrink-0 z-10 relative shadow-sm transition-colors duration-200">
        <div className="flex items-center gap-2.5 sm:gap-4">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 -ml-1 text-gray-600 dark:text-gray-300 hover:text-[#D4AF37] hover:bg-gray-100 dark:hover:bg-[#2A2A2A] rounded-lg md:hidden transition-colors"
            aria-label="Toggle navigation drawer"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-50 dark:bg-[#2A2A2A] border border-amber-200 dark:border-[#333333] flex items-center justify-center overflow-hidden shrink-0">
            <Briefcase className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600 dark:text-[#D4AF37]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <h1 className="text-gray-900 dark:text-white font-bold text-lg sm:text-xl tracking-wide">Solarithm</h1>
              <span className="text-amber-600 dark:text-[#D4AF37] font-bold text-lg sm:text-xl tracking-wide">Commerce</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">Client acquisition, proposal management, and dynamic pricing engine.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-sm text-gray-600 dark:text-gray-200 hidden lg:block">Logged in as: <span className="text-gray-900 dark:text-gray-100 font-medium">{userEmail}</span></div>
          <AppLauncherDropdown currentUserRole={userRole || "sales"} />
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="px-3 sm:px-4 py-1.5 sm:py-2 bg-[#D4AF37] text-black text-sm sm:text-base font-medium rounded hover:opacity-90 transition-colors shadow-sm whitespace-nowrap"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Drawer Backdrop */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden animate-in fade-in duration-200"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar Navigation (Desktop Persistent & Mobile Slide-Out Drawer) */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-[#1E1E1E] border-r border-gray-200 dark:border-[#333333] flex flex-col shrink-0 shadow-2xl transition-transform duration-300 ease-in-out md:static md:w-64 md:shadow-sm md:z-0 md:translate-x-0 ${
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Mobile Drawer Header */}
          <div className="p-4 border-b border-gray-200 dark:border-[#333333] flex items-center justify-between md:hidden">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-[#2A2A2A] border border-amber-200 dark:border-[#333333] flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-amber-600 dark:text-[#D4AF37]" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white text-base leading-tight">Solarithm Commerce</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Sales Navigation</p>
              </div>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#2A2A2A] transition-colors"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 py-4 md:py-6 space-y-1 px-2 md:px-0">
            <button
              onClick={() => {
                setActiveTab("register");
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 md:px-6 py-3 rounded-lg md:rounded-none transition-colors text-base font-medium ${
                activeTab === "register"
                  ? "bg-amber-50 dark:bg-[#2A2A2A] text-amber-700 dark:text-[#D4AF37] md:border-r-2 md:border-amber-500 dark:md:border-[#D4AF37]"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] hover:text-amber-700 dark:hover:text-[#D4AF37] border-r-0 md:border-r-2 md:border-transparent"
              }`}
            >
              <UserPlus className="w-5 h-5 shrink-0" />
              <span>Register New Client</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("new_project");
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 md:px-6 py-3 rounded-lg md:rounded-none transition-colors text-base font-medium ${
                activeTab === "new_project"
                  ? "bg-amber-50 dark:bg-[#2A2A2A] text-amber-700 dark:text-[#D4AF37] md:border-r-2 md:border-amber-500 dark:md:border-[#D4AF37]"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] hover:text-amber-700 dark:hover:text-[#D4AF37] border-r-0 md:border-r-2 md:border-transparent"
              }`}
            >
              <FileText className="w-5 h-5 shrink-0" />
              <span>New Project</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("my_projects");
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 md:px-6 py-3 rounded-lg md:rounded-none transition-colors text-base font-medium ${
                activeTab === "my_projects"
                  ? "bg-amber-50 dark:bg-[#2A2A2A] text-amber-700 dark:text-[#D4AF37] md:border-r-2 md:border-amber-500 dark:md:border-[#D4AF37]"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2A2A] hover:text-amber-700 dark:hover:text-[#D4AF37] border-r-0 md:border-r-2 md:border-transparent"
              }`}
            >
              <FolderOpen className="w-5 h-5 shrink-0" />
              <span>My Projects</span>
            </button>
          </nav>

          {/* Mobile Footer in Drawer */}
          <div className="p-4 border-t border-gray-200 dark:border-[#333333] md:hidden">
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              Logged in: <span className="text-gray-800 dark:text-gray-200 font-medium">{userEmail}</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto flex flex-col min-w-0 bg-gray-50 dark:bg-[#121212] transition-colors duration-200">
          <div className="flex-1 w-full max-w-full min-w-0 transition-all duration-300">
            {activeTab === "register" && <RegisterClientTab lockedEmail={userEmail} currentUser={currentUserObj} />}
            {activeTab === "new_project" && <NewProjectTab lockedEmail={userEmail} setActiveTab={setActiveTab} currentUser={currentUserObj} />}
            {activeTab === "my_projects" && <MyProjectsTab lockedEmail={userEmail} currentUser={currentUserObj} />}
          </div>
          
          {/* Footer */}
          <footer className="mt-auto pt-8 pb-4 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">© 2026 Solarithm. All Rights Reserved. Unauthorized replication prohibited.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

// --- TAB COMPONENTS ---

function RegisterClientTab({ lockedEmail, currentUser }: { lockedEmail: string | null; currentUser: any }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [clients, setClients] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [proposals, setProposals] = useState<any[]>([]);

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema)
  });

  const watchedGstin = useWatch({
    control,
    name: "gstin"
  });
  const isGstinProvided = Boolean(watchedGstin && watchedGstin.trim().length > 0);

  useEffect(() => {
    // Strictly defer data fetching until Firebase currentUser is defined and loaded
    if (!currentUser || !lockedEmail) {
      return;
    }

    const q = query(
      collection(db, "clients"),
      where("salesPersonEmail", "==", lockedEmail)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setClients(data);
      setLoadingClients(false);
    }, (err) => {
      console.error("Error fetching clients in RegisterClientTab:", err);
      setClients([]);
      setLoadingClients(false);
    });

    const pq = query(collection(db, COLLECTIONS.PROPOSALS));
    const unsubP = onSnapshot(pq, (snapshot) => {
      setProposals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("Error fetching proposals in RegisterClientTab:", err);
      setProposals([]);
    });

    return () => {
      unsub();
      unsubP();
    };
  }, [lockedEmail, currentUser]);

  const onSubmit = async (data: ClientFormData) => {
    if (!lockedEmail) return;
    setIsSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");
    
    try {
      const selectedProposal = proposals.find(p => p.proposalNumber === data.proposalNumber);
      const pricingCategory = selectedProposal?.pricingCategory || 'T1';

      const payload = {
        [CLIENT_FIELDS.COMPANY_NAME]: toTitleCase(data.companyName),
        [CLIENT_FIELDS.CONTACT_PERSON]: toTitleCase(data.contactPerson),
        [CLIENT_FIELDS.CITY]: toTitleCase(data.city),
        [CLIENT_FIELDS.GSTIN]: data.gstin ? data.gstin.toUpperCase().trim() : "",
        [CLIENT_FIELDS.BILLING_ADDRESS]: data.billingAddress ? data.billingAddress.trim() : "",
        [CLIENT_FIELDS.PROPOSAL_NUMBER]: data.proposalNumber,
        [CLIENT_FIELDS.PRICING_CATEGORY]: pricingCategory,
        [CLIENT_FIELDS.STATUS]: CLIENT_STATUS.PENDING,
        [CLIENT_FIELDS.SALES_PERSON_EMAIL]: lockedEmail,
        [CLIENT_FIELDS.CREATED_AT]: serverTimestamp()
      };
      
      const clientRef = await addDoc(collection(db, COLLECTIONS.CLIENTS), payload);
      
      // Audit log entry per Master Blueprint
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
          action: "CLIENT_REGISTERED",
          actor: lockedEmail,
          target: payload[CLIENT_FIELDS.COMPANY_NAME],
          details: { clientId: clientRef.id, proposalNumber: data.proposalNumber },
          timestamp: serverTimestamp()
        });
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      setSuccessMsg("Client registered successfully. Awaiting admin approval.");
      reset();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to register client");
    } finally {
      setIsSubmitting(false);
    }
  };

  const approvedCount = useMemo(() => clients.filter(c => c.status === CLIENT_STATUS.APPROVED).length, [clients]);
  const pendingCount = useMemo(() => clients.filter(c => c.status === CLIENT_STATUS.PENDING || !c.status).length, [clients]);
  const rejectedCount = useMemo(() => clients.filter(c => c.status === CLIENT_STATUS.REJECTED).length, [clients]);

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Total Registered</p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mt-1">{clients.length}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-[#2A2A2A] flex items-center justify-center text-amber-600 dark:text-[#D4AF37]">
            <Building2 className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Approved Clients</p>
            <p className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{approvedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Pending Approval</p>
            <p className="text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">{pendingCount}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Rejected / Returned</p>
            <p className="text-2xl sm:text-3xl font-bold text-rose-600 dark:text-rose-400 mt-1">{rejectedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <XCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="w-full bg-white dark:bg-[#1E1E1E] p-4 sm:p-6 md:p-8 rounded-xl border border-gray-200 dark:border-[#333333] shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold font-sans text-gray-900 dark:text-white mb-2">Register New Client</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm sm:text-base">Register a new client before creating a project. Once approved, this client will be available in your project form.</p>
        
        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg flex items-center gap-2 border border-emerald-500/30">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-sm sm:text-base font-medium">{successMsg}</span>
          </div>
        )}
        
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg flex items-start gap-2 border border-rose-500/30">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span className="text-sm sm:text-base font-medium">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Company Name *</label>
            <input {...register("companyName")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none" />
            {errors.companyName && <p className="text-sm text-rose-500">{errors.companyName.message as string}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Contact Person *</label>
            <input {...register("contactPerson")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none" />
            {errors.contactPerson && <p className="text-sm text-rose-500">{errors.contactPerson.message as string}</p>}
          </div>
          
          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Proposal Number *</label>
            <select {...register("proposalNumber")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none">
              <option value="">Select a proposal</option>
              {proposals.map(p => (
                <option key={p.id} value={p.proposalNumber}>{p.proposalNumber}</option>
              ))}
            </select>
            {errors.proposalNumber && <p className="text-sm text-rose-500">{errors.proposalNumber.message as string}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">City *</label>
            <input {...register("city")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none" />
            {errors.city && <p className="text-sm text-rose-500">{errors.city.message as string}</p>}
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">GSTIN (Optional)</label>
            <input
              {...register("gstin")}
              placeholder="e.g. 24ABCDE1234F1Z5"
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none uppercase font-mono text-sm sm:text-base"
            />
            {errors.gstin && <p className="text-sm text-rose-500">{errors.gstin.message as string}</p>}
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">
                Billing Address / Registered Office Address {isGstinProvided ? <span className="text-rose-500 font-bold">*</span> : <span className="text-gray-400 font-normal text-xs">(Optional)</span>}
              </label>
              {isGstinProvided && (
                <span className="text-xs font-medium text-amber-600 dark:text-[#D4AF37]">
                  Mandatory when GSTIN is provided
                </span>
              )}
            </div>
            <textarea
              {...register("billingAddress")}
              rows={3}
              placeholder="Complete registered office address, building, street, city, state, and PIN code for billing/invoicing"
              className={`w-full p-2.5 rounded-lg border ${
                errors.billingAddress
                  ? "border-rose-500 focus:ring-rose-500"
                  : "border-gray-300 dark:border-[#2A2A2A] focus:ring-[#D4AF37] focus-within:border-[#D4AF37]"
              } bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 outline-none text-sm sm:text-base resize-y transition-colors`}
            />
            {errors.billingAddress && (
              <p className="text-sm text-rose-500 font-medium">{errors.billingAddress.message as string}</p>
            )}
          </div>

          <div className="md:col-span-2 flex justify-end mt-2 sm:mt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-6 py-2.5 bg-[#D4AF37] text-black font-semibold rounded-lg hover:opacity-90 focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] focus:ring-offset-2 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserPlus className="w-5 h-5" />}
              Submit Client Registration
            </button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="w-full bg-white dark:bg-[#1E1E1E] p-4 sm:p-6 md:p-8 rounded-xl border border-gray-200 dark:border-[#333333] shadow-sm">
        <h3 className="text-lg font-bold font-sans text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-amber-600 dark:text-[#D4AF37]" />
          My Registered Clients
        </h3>
        
        {loadingClients ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-600 dark:text-[#D4AF37]" /></div>
        ) : clients.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">No clients registered yet.</div>
        ) : (
          <div className="w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-[#333333] bg-white dark:bg-[#1E1E1E]">
            <table className="w-full text-left border-collapse whitespace-nowrap min-w-[640px]">
              <thead className="bg-gray-50 dark:bg-transparent border-b border-gray-200 dark:border-[#333333]">
                <tr className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm uppercase font-semibold">
                  <th className="py-3 px-4">Company Name</th>
                  <th className="py-3 px-4">City</th>
                  <th className="py-3 px-4">GSTIN & Address</th>
                  <th className="py-3 px-4">Proposal</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody className="text-sm sm:text-base divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                {clients.map(client => (
                  <tr key={client.id} className="transition-colors hover:bg-gray-50 dark:hover:bg-[#2A2A2A]">
                    <td className="py-3 px-4 font-medium text-gray-800 dark:text-gray-200">{toTitleCase(client.companyName)}</td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-200">{toTitleCase(client.city)}</td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-200">
                      <div className="font-mono text-xs">{client.gstin || <span className="text-gray-400 font-sans">No GSTIN</span>}</div>
                      {client.billingAddress && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[220px]" title={client.billingAddress}>
                          {client.billingAddress}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-200">{client.proposalNumber}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium border text-center ${getStatusColor(client.status)}`}>
                        {toTitleCase(client.status.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 dark:text-gray-200">
                      {client.createdAt ? format(client.createdAt.toDate(), 'MMM dd, yyyy') : '...'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewProjectTab({ lockedEmail, setActiveTab, currentUser }: { lockedEmail: string | null, setActiveTab: any, currentUser: any }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  const [clients, setClients] = useState<any[]>([]);
  const [designers, setDesigners] = useState<any[]>([]);
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [scopesData, setScopesData] = useState<any[]>([]);
  
  const { register, handleSubmit, formState: { errors }, reset, setValue, control } = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      capacityUnit: 'KW'
    }
  });

  const selectedClientId = useWatch({ control, name: "clientId" });
  const selectedScope = useWatch({ control, name: "scopeOfWork" });
  const selectedSubService = useWatch({ control, name: "subService" });
  const capacityValue = useWatch({ control, name: "plantCapacity" });
  const capacityUnit = useWatch({ control, name: "capacityUnit" });
  const enteredProjectName = useWatch({ control, name: "projectName" }) || "";
  const enteredLocation = useWatch({ control, name: "location" }) || "";

  // Search-First Deduplication Gate States
  const [matchedExistingProject, setMatchedExistingProject] = useState<any | null>(null);
  const [isDedupChecking, setIsDedupChecking] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const DEFAULT_SCOPES = useMemo(() => [
    "Pre-Design",
    "CEIG",
    "IFP",
    "PVsyst",
    "Detailed Engineering",
    "Pre-Design + CEIG",
    "Pre-Design + PVsyst",
    "Pre-Design + CEIG + IFP",
    "Pre-Design + CEIG + IFP + PVsyst",
    "Pre-Design + CEIG + IFP + PVsyst + Detailed Engineering"
  ], []);

  const uniqueScopes = useMemo(() => {
    const dbScopes = scopesData.map(s => s.name).filter(Boolean);
    return Array.from(new Set([...DEFAULT_SCOPES, ...dbScopes]));
  }, [scopesData, DEFAULT_SCOPES]);

  const selectedScopeDoc = useMemo(() => {
    return scopesData.find(s => s.name === selectedScope);
  }, [scopesData, selectedScope]);

  const packageScopes = useMemo((): ScopeItem[] => {
    if (!selectedScope) return [];
    return parsePackageScopes(selectedScope, selectedScopeDoc);
  }, [selectedScope, selectedScopeDoc]);

  // Map each scope key (e.g. preDesign, pvsyst) to assigned designer email
  const [assignedScopes, setAssignedScopes] = useState<Record<string, string>>({});
  const [scopeAssignmentErrors, setScopeAssignmentErrors] = useState<Record<string, string>>({});

  const uniqueSubServices = useMemo((): string[] => {
    if (!selectedScope) return [];
    const scopeObj = scopesData.find(s => s.name === selectedScope);
    
    if (scopeObj?.hasSubServices) {
      return ["Standard", "Special", "Premium"];
    }
    
    const subs = scopeObj?.subServices || [];
    return Array.from(new Set(subs)).filter(Boolean) as string[];
  }, [scopesData, selectedScope]);

  // Handle resetting subService when scope changes
  useEffect(() => {
    setValue("subService", "");
  }, [selectedScope, setValue]);

  const calculatedPrice = useMemo(() => {
    if (!selectedClientId || !selectedScope || !capacityValue) return null;
    
    const client = clients.find(c => c.id === selectedClientId);
    if (!client) return null;
    
    const category = client.pricingCategory || 'T1';
    
    const match = pricingRules.find(rule => {
      if (rule.serviceName !== selectedScope && rule.scope !== selectedScope) return false;
      
      if (uniqueSubServices.length > 0) {
        if (rule.subService !== selectedSubService) return false;
      }
      
      const ruleUnit = (rule.unit || 'KW').toUpperCase();
      let capInRuleUnit = capacityValue;
      
      if (capacityUnit === 'KW' && ruleUnit === 'MW') capInRuleUnit = capacityValue / 1000;
      else if (capacityUnit === 'MW' && ruleUnit === 'KW') capInRuleUnit = capacityValue * 1000;
      else if (capacityUnit === 'W' && ruleUnit === 'KW') capInRuleUnit = capacityValue / 1000;
      else if (capacityUnit === 'KW' && ruleUnit === 'W') capInRuleUnit = capacityValue * 1000;
      else if (capacityUnit === 'W' && ruleUnit === 'MW') capInRuleUnit = capacityValue / 1000000;
      else if (capacityUnit === 'MW' && ruleUnit === 'W') capInRuleUnit = capacityValue * 1000000;
      
      const min = rule.minCapacity ?? 0;
      const max = rule.maxCapacity ?? Infinity;
      if (capInRuleUnit < min || capInRuleUnit > max) return false;
      
      return true;
    });
    
    if (match) {
      let rate = 0;
      if (category === 'T1') rate = match.tier1Price ?? match.t1Price ?? match.T1 ?? match.t1 ?? 0;
      if (category === 'T2') rate = match.tier2Price ?? match.t2Price ?? match.T2 ?? match.t2 ?? 0;
      if (category === 'T3') rate = match.tier3Price ?? match.t3Price ?? match.T3 ?? match.t3 ?? 0;
      if (category === 'T4') rate = match.tier4Price ?? match.t4Price ?? match.T4 ?? match.t4 ?? 0;
      
      const priceType = (match.priceType || 'per_unit').toLowerCase();
      let total = rate;
      if (priceType !== 'fixed' && priceType !== 'lump sum') {
        const ruleUnit = (match.unit || 'KW').toUpperCase();
        let capInRuleUnit = capacityValue;
        if (capacityUnit === 'KW' && ruleUnit === 'MW') capInRuleUnit = capacityValue / 1000;
        else if (capacityUnit === 'MW' && ruleUnit === 'KW') capInRuleUnit = capacityValue * 1000;
        else if (capacityUnit === 'W' && ruleUnit === 'KW') capInRuleUnit = capacityValue / 1000;
        else if (capacityUnit === 'KW' && ruleUnit === 'W') capInRuleUnit = capacityValue * 1000;
        else if (capacityUnit === 'W' && ruleUnit === 'MW') capInRuleUnit = capacityValue / 1000000;
        else if (capacityUnit === 'MW' && ruleUnit === 'W') capInRuleUnit = capacityValue * 1000000;
        
        total = rate * capInRuleUnit;
      }
      
      return { rate, total, category, priceType: match.priceType, unit: match.unit };
    }
    
    return null;
  }, [selectedClientId, selectedScope, selectedSubService, capacityValue, capacityUnit, clients, pricingRules, uniqueSubServices]);

  useEffect(() => {
    // Strictly defer data fetching until Firebase currentUser is defined and loaded
    if (!currentUser || !lockedEmail) {
      return;
    }

    const q = query(
      collection(db, "clients"),
      where("salesPersonEmail", "==", lockedEmail),
      where("status", "==", "approved")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("Error fetching clients in NewProjectTab:", err);
      setClients([]);
    });
    
    // Fetch roster strictly from employees collection using Master Blueprint schema
    const eq = query(collection(db, COLLECTIONS.EMPLOYEES));
    const unsubD = onSnapshot(eq, (snapshot) => {
      if (!snapshot.empty) {
        const list = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            name: data.name || data.email || "Unnamed Employee",
            email: data.email || "",
            department: data.department || "",
            designation: data.designation || "",
            role: data.role || "",
            employeeId: data.employeeId || ""
          };
        }).filter(emp => Boolean(emp.email));

        // Prioritize Design/Engineering staff if specified, otherwise include full employee roster
        const designStaff = list.filter(emp => {
          const dept = emp.department.toLowerCase();
          const role = emp.role.toLowerCase();
          const desig = emp.designation.toLowerCase();
          return dept.includes('design') || dept.includes('eng') || role.includes('designer') || role.includes('engineer') || desig.includes('design') || desig.includes('engineer');
        });

        setDesigners(designStaff.length > 0 ? designStaff : list);
      } else {
        setDesigners([]);
      }
    }, (err) => {
      console.error("Error fetching employees roster in NewProjectTab:", err);
      setDesigners([]);
    });

    const pq = query(collection(db, "pricingRules"));
    const unsubP = onSnapshot(pq, (snapshot) => {
      setPricingRules(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("Error fetching pricing rules in NewProjectTab:", err);
      setPricingRules([]);
    });

    const sq = query(collection(db, "scopes"));
    const unsubS = onSnapshot(sq, (snapshot) => {
      setScopesData(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("Error fetching scopes in NewProjectTab:", err);
      setScopesData([]);
    });

    return () => {
      unsub();
      unsubD();
      unsubP();
      unsubS();
    };
  }, [lockedEmail, currentUser]);

  // Search-First Deduplication Gate: Real-time debounced query against existing central projects
  useEffect(() => {
    const trimmedName = String(enteredProjectName || "").trim();
    const trimmedLoc = String(enteredLocation || "").trim();

    const timer = setTimeout(async () => {
      if (trimmedName.length < 3 && trimmedLoc.length < 4) {
        setMatchedExistingProject(null);
        setIsDedupChecking(false);
        return;
      }

      setIsDedupChecking(true);

      try {
        const pRef = collection(db, COLLECTIONS.PROJECTS);
        const snap = await getDocs(pRef);

        if (snap.empty) {
          setMatchedExistingProject(null);
          setIsDedupChecking(false);
          return;
        }

        const allProjects = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const cleanStr = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const cleanNameInput = cleanStr(trimmedName);
        const cleanLocInput = cleanStr(trimmedLoc);

        const match = allProjects.find((p: any) => {
          const pNameClean = cleanStr(p.projectName);
          const pLocClean = cleanStr(p.location);

          // 1. Exact or highly probable match on Project Name (min 3 clean characters)
          if (cleanNameInput.length >= 3) {
            if (pNameClean === cleanNameInput) return true;
            if (pNameClean.length >= 5 && cleanNameInput.length >= 5) {
              if (pNameClean.includes(cleanNameInput) || cleanNameInput.includes(pNameClean)) {
                return true;
              }
            }
          }

          // 2. Exact or highly probable match on Client Site Address / Location
          if (cleanLocInput.length >= 5) {
            if (pLocClean === cleanLocInput) return true;
            if (p.clientId && selectedClientId && p.clientId === selectedClientId) {
              if (pLocClean.includes(cleanLocInput) || cleanLocInput.includes(pLocClean)) {
                return true;
              }
            }
          }

          return false;
        });

        setMatchedExistingProject(match || null);
      } catch (err) {
        console.error("Deduplication query error:", err);
      } finally {
        setIsDedupChecking(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [enteredProjectName, enteredLocation, selectedClientId]);

  const onSubmit = async (data: any) => {
    if (!lockedEmail) return;

    // Strictly disable creation if an exact or highly probable match exists
    if (matchedExistingProject) {
      setErrorMsg("Project already exists in central registry. Creation is blocked to prevent duplication. Please click 'Upgrade Project' to append new scopes.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");
    setScopeAssignmentErrors({});
    
    try {
      const client = clients.find(c => c.id === data.clientId);
      if (!client) throw new Error("Client not found or not approved");

      if (packageScopes.length === 0) {
        throw new Error("Please select a Scope of Work");
      }

      // Validate that every scope in the package has an assigned designer
      // Note: One person can be assigned to multiple scopes, or different people to different scopes
      const errorsMap: Record<string, string> = {};
      for (const scope of packageScopes) {
        if (!assignedScopes[scope.key] || !assignedScopes[scope.key].trim()) {
          errorsMap[scope.key] = `Please assign a designer for ${scope.label}`;
        }
      }

      if (Object.keys(errorsMap).length > 0) {
        setScopeAssignmentErrors(errorsMap);
        throw new Error(`Please assign a designer to all scopes (${Object.keys(errorsMap).length} unassigned)`);
      }

      // Build assignedScopes mapping strictly per schema: { preDesign: 'designerA@email.com', pvsyst: 'designerB@email.com' }
      const assignedScopesClean: Record<string, string> = {};
      packageScopes.forEach(s => {
        assignedScopesClean[s.key] = assignedScopes[s.key];
      });

      const firstScopeKey = packageScopes[0]?.key;
      const primaryDesignerEmail = firstScopeKey ? assignedScopesClean[firstScopeKey] : "";
      const primaryDesigner = designers.find(d => d.email === primaryDesignerEmail) || {
        name: primaryDesignerEmail ? primaryDesignerEmail.split('@')[0] : "Assigned Designer",
        email: primaryDesignerEmail
      };

      const modulesData = packageScopes.map(s => {
        const dEmail = assignedScopesClean[s.key];
        const dObj = designers.find(d => d.email === dEmail);
        return {
          phaseKey: s.key,
          phaseName: s.label,
          status: PROJECT_STATUS.NOT_STARTED,
          assignedDesignerEmail: dEmail,
          assignedDesignerName: dObj?.name || (dEmail ? dEmail.split('@')[0] : "Unassigned"),
          startedAt: null,
          completedAt: null
        };
      });

      const pSnap = await getDocs(collection(db, COLLECTIONS.PROJECTS));
      const totalProjects = pSnap.size;
      
      const date = new Date();
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      
      const sequence = (totalProjects + 1).toString().padStart(3, '0');
      const initials = generateClientInitials(client.companyName);
      const srNumber = `${initials}-${year}-${month}-${sequence}`;

      const payload = {
        [PROJECT_FIELDS.PROJECT_NAME]: toTitleCase(data.projectName),
        [PROJECT_FIELDS.PROJECT_NUMBER]: srNumber,
        srNumber: srNumber,
        projectDate: `${year}-${month}-${date.getDate().toString().padStart(2, '0')}`,
        [PROJECT_FIELDS.CLIENT_ID]: client.id,
        [PROJECT_FIELDS.CLIENT_NAME]: client.companyName,
        [PROJECT_FIELDS.SCOPE_OF_WORK]: toTitleCase(data.scopeOfWork),
        [PROJECT_FIELDS.SUB_SERVICE]: data.subService ? toTitleCase(data.subService) : 'Standard',
        [PROJECT_FIELDS.PLANT_CAPACITY]: data.plantCapacity ? Number(data.plantCapacity) : null,
        [PROJECT_FIELDS.CAPACITY_UNIT]: data.capacityUnit || 'KW',
        [PROJECT_FIELDS.LOCATION]: toTitleCase(data.location),
        [PROJECT_FIELDS.DESIGNER_EMAIL]: primaryDesigner.email,
        designerName: primaryDesigner.name,
        [PROJECT_FIELDS.ASSIGNED_SCOPES]: assignedScopesClean,
        [PROJECT_FIELDS.MODULES]: modulesData,
        remarks: data.remarks ? toTitleCase(data.remarks) : null,
        salesPersonEmail: lockedEmail,
        salesPersonName: lockedEmail,
        [PROJECT_FIELDS.STATUS]: PROJECT_STATUS.NOT_STARTED,
        paymentStatus: 'UNPAID',
        [PROJECT_FIELDS.PRICING_CATEGORY]: client.pricingCategory || 'T1',
        proposalNumber: client.proposalNumber || '',
        rate: calculatedPrice ? calculatedPrice.rate : null,
        projectValue: calculatedPrice ? calculatedPrice.total : null,
        projectCost: calculatedPrice ? calculatedPrice.total : null,
        [PROJECT_FIELDS.CREATED_AT]: serverTimestamp(),
        [PROJECT_FIELDS.UPDATED_AT]: serverTimestamp(),
      };
      
      const projRef = await addDoc(collection(db, COLLECTIONS.PROJECTS), payload);
      
      // Audit log entry per Master Blueprint
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
          action: "PROJECT_CREATED",
          actor: lockedEmail,
          target: payload[PROJECT_FIELDS.PROJECT_NAME],
          details: {
            projectId: projRef.id,
            projectName: payload[PROJECT_FIELDS.PROJECT_NAME],
            projectNumber: srNumber,
            clientName: client.companyName,
            clientId: client.id,
            scopeOfWork: payload[PROJECT_FIELDS.SCOPE_OF_WORK],
            assignedScopes: assignedScopesClean,
            modules: modulesData.map(m => ({ phaseKey: m.phaseKey, assignedDesigner: m.assignedDesignerEmail })),
            plantCapacity: payload[PROJECT_FIELDS.PLANT_CAPACITY],
            capacityUnit: payload[PROJECT_FIELDS.CAPACITY_UNIT],
            location: payload[PROJECT_FIELDS.LOCATION],
            designerEmail: primaryDesigner.email,
            designerName: primaryDesigner.name
          },
          timestamp: serverTimestamp()
        });
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }
      
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#D4AF37', '#1A1A1A', '#4A3728']
      });
      
      reset();
      setAssignedScopes({});
      
      setTimeout(() => {
        setActiveTab("my_projects");
      }, 2000);
      
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-[#1E1E1E] p-4 sm:p-6 md:p-8 rounded-xl border border-gray-200 dark:border-[#333333] shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-xl sm:text-2xl font-bold font-sans text-gray-900 dark:text-white mb-2">New Project Entry</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm sm:text-base">Submit a new project. Only your approved clients will appear in the dropdown.</p>

      {errorMsg && (
        <div className="mb-6 p-4 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg flex items-start gap-2 border border-rose-500/30">
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span className="text-sm sm:text-base font-medium">{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <div className="space-y-1 md:col-span-2">
          <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Client *</label>
          <select {...register("clientId")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none">
            <option value="">Select an approved client</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>
          {errors.clientId && <p className="text-sm text-rose-500">{errors.clientId.message as string}</p>}
        </div>

        <div className="space-y-1 md:col-span-2">
          <div className="flex items-center justify-between">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Project Name *</label>
            {isDedupChecking && (
              <span className="text-xs text-[#D4AF37] flex items-center gap-1 font-medium animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking registry...
              </span>
            )}
          </div>
          <input 
            type="text" 
            placeholder="e.g. 50kW Rooftop Solar Installation" 
            {...register("projectName")} 
            className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none" 
          />
          {errors.projectName && <p className="text-sm text-rose-500">{errors.projectName.message as string}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Scope of Work / Package *</label>
          <select {...register("scopeOfWork")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none">
            {uniqueScopes.length === 0 ? (
              <option value="">No scopes available</option>
            ) : (
              <option value="">Select scope or multi-scope package</option>
            )}
            {uniqueScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {errors.scopeOfWork && <p className="text-sm text-rose-500">{errors.scopeOfWork.message as string}</p>}
        </div>

        {uniqueSubServices.length > 0 && (
          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Sub-Service</label>
            <select {...register("subService")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none">
              <option value="">Select sub-service (optional)</option>
              {uniqueSubServices.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.subService && <p className="text-sm text-rose-500">{errors.subService.message as string}</p>}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Plant Capacity</label>
          <div className="flex gap-2">
            <input type="number" step="0.01" min="0" placeholder="Leave blank if N/A" {...register("plantCapacity", { valueAsNumber: true, setValueAs: v => v === "" || isNaN(v) ? null : parseFloat(v) })} className="flex-1 p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none" />
            <select {...register("capacityUnit")} className="w-24 p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none">
              <option value="KW">KW</option>
              <option value="MW">MW</option>
            </select>
          </div>
          {errors.plantCapacity && <p className="text-sm text-rose-500">{errors.plantCapacity.message as string}</p>}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Location / Site Address *</label>
            {isDedupChecking && (
              <span className="text-xs text-[#D4AF37] flex items-center gap-1 font-medium animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking address...
              </span>
            )}
          </div>
          <input {...register("location")} placeholder="e.g. Plot 42, MIDC Industrial Area, Pune, Maharashtra" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none" />
          {errors.location && <p className="text-sm text-rose-500">{errors.location.message as string}</p>}
        </div>

        {/* Dynamic Scope Designer Assignment Section */}
        {packageScopes.length > 1 ? (
          <div className="md:col-span-2 space-y-4 p-4 sm:p-5 rounded-xl border border-amber-500/20 bg-amber-50/40 dark:bg-[#181818] shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-[#2A2A2A]">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-600 dark:text-[#D4AF37]" />
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                    Multi-Stage Scope Assignment ({packageScopes.length} Scopes)
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Assign individual designers to each phase of this multi-scope package. One person can handle multiple scopes, or different people can be assigned per scope.
                </p>
              </div>

              {/* Quick Batch Assignment */}
              {designers.length > 0 && (
                <div className="flex items-center gap-2 shrink-0 bg-white dark:bg-[#202020] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#333333]">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    Quick Assign All:
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const batch: Record<string, string> = {};
                        packageScopes.forEach(s => {
                          batch[s.key] = e.target.value;
                        });
                        setAssignedScopes(batch);
                        setScopeAssignmentErrors({});
                      }
                    }}
                    className="text-xs py-1 px-2 rounded border border-gray-300 dark:border-[#3A3A3A] bg-gray-50 dark:bg-[#191919] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  >
                    <option value="" disabled>Choose designer</option>
                    {designers.map(d => (
                      <option key={d.id} value={d.email}>{d.name} ({d.email})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {packageScopes.map((scope) => {
                const currentEmail = assignedScopes[scope.key] || "";
                const scopeError = scopeAssignmentErrors[scope.key];
                return (
                  <div key={scope.key} className="space-y-1.5 p-3.5 rounded-lg bg-white dark:bg-[#202020] border border-gray-200 dark:border-[#2E2E2E] shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-[#D4AF37] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#D4AF37]"></span>
                        {scope.label} Scope
                      </span>
                      <span className="text-[11px] font-mono text-gray-400">key: {scope.key}</span>
                    </div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block">
                      Assigned Designer *
                    </label>
                    <select
                      value={currentEmail}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAssignedScopes(prev => ({ ...prev, [scope.key]: val }));
                        if (val) {
                          setScopeAssignmentErrors(prev => {
                            const n = { ...prev };
                            delete n[scope.key];
                            return n;
                          });
                        }
                      }}
                      className={`w-full p-2.5 rounded-lg border ${
                        scopeError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-gray-300 dark:border-[#333333]'
                      } bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white text-sm focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none`}
                    >
                      <option value="">Select designer for {scope.label}</option>
                      {designers.map(d => (
                        <option key={d.id} value={d.email}>
                          {d.name} ({d.email})
                        </option>
                      ))}
                    </select>
                    {scopeError && <p className="text-xs text-rose-500 font-medium">{scopeError}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : packageScopes.length === 1 ? (
          <div className="space-y-1 md:col-span-1">
            <div className="flex items-center justify-between">
              <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">
                Designer ({packageScopes[0].label}) *
              </label>
              <span className="text-xs font-mono text-amber-600 dark:text-[#D4AF37]">{packageScopes[0].key}</span>
            </div>
            <select
              value={assignedScopes[packageScopes[0].key] || ""}
              onChange={(e) => {
                const val = e.target.value;
                setAssignedScopes({ [packageScopes[0].key]: val });
                if (val) setScopeAssignmentErrors({});
              }}
              className={`w-full p-2.5 rounded-lg border ${
                scopeAssignmentErrors[packageScopes[0].key] ? 'border-rose-500 ring-1 ring-rose-500' : 'border-gray-300 dark:border-[#2A2A2A]'
              } bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none`}
            >
              <option value="">Select designer</option>
              {designers.map(d => (
                <option key={d.id} value={d.email}>{d.name} ({d.email})</option>
              ))}
            </select>
            {scopeAssignmentErrors[packageScopes[0].key] && (
              <p className="text-sm text-rose-500">{scopeAssignmentErrors[packageScopes[0].key]}</p>
            )}
          </div>
        ) : (
          <div className="space-y-1 md:col-span-2 p-4 rounded-xl border border-dashed border-gray-300 dark:border-[#333333] text-center text-sm text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-[#191919]">
            <Users className="w-5 h-5 mx-auto mb-1 text-gray-400" />
            Please select a Scope of Work above to assign designers to scopes.
          </div>
        )}

        <div className="space-y-1 md:col-span-2">
          <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Remarks / Notes (Optional)</label>
          <textarea {...register("remarks")} rows={3} placeholder="Any special instructions for the designer..." className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none"></textarea>
          {errors.remarks && <p className="text-sm text-rose-500">{errors.remarks.message as string}</p>}
        </div>

        <div className="space-y-1 md:col-span-2">
          <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">Sales Person</label>
          <input value={lockedEmail || ""} disabled className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-100 dark:bg-[#141414] text-gray-500 cursor-not-allowed outline-none font-medium" />
        </div>

        {calculatedPrice && (
          <div className="md:col-span-2 bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mt-2">
            <div>
              <p className="text-sm sm:text-base text-amber-600 dark:text-amber-400 font-semibold">Estimated Pricing ({calculatedPrice.category})</p>
              <p className="text-xs sm:text-sm text-amber-700/80 dark:text-amber-400/80 mt-0.5">Based on {selectedScope} {selectedSubService ? `- ${selectedSubService}` : ''} ({capacityValue} {capacityUnit})</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Rate: ₹{calculatedPrice.rate.toLocaleString('en-IN')}</p>
              <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Total: ₹{calculatedPrice.total.toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}

        {/* Search-First Deduplication Gate Alert */}
        {matchedExistingProject && (
          <div className="md:col-span-2 p-4 sm:p-5 rounded-xl border border-amber-500/50 bg-[#141414] text-white shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5 text-[#D4AF37]">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base sm:text-lg font-bold text-white tracking-wide">
                      Project Already Exists
                    </span>
                    <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-amber-500/20 text-[#D4AF37] border border-amber-500/30">
                      {matchedExistingProject.projectNumber || matchedExistingProject.srNumber || "REGISTERED"}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-gray-300">
                    A project matching <span className="font-semibold text-white">&quot;{matchedExistingProject.projectName}&quot;</span> (Client: <span className="text-white font-semibold">{matchedExistingProject.clientName}</span>, Location: <span className="text-white font-semibold">{matchedExistingProject.location}</span>) is already registered in the central database.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-gray-400">
                    <span>Registered Scope:</span>
                    <span className="font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {matchedExistingProject.scopeOfWork || "Standard"}
                    </span>
                    {matchedExistingProject.plantCapacity && (
                      <span className="text-gray-400 font-mono">
                        • {matchedExistingProject.plantCapacity} {matchedExistingProject.capacityUnit || "KW"}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsUpgradeModalOpen(true)}
                className="w-full sm:w-auto shrink-0 px-5 py-2.5 bg-[#D4AF37] hover:bg-[#c59f2e] active:scale-[0.98] text-black font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-wide cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Upgrade Project</span>
              </button>
            </div>
          </div>
        )}

        <div className="md:col-span-2 flex justify-end mt-2 sm:mt-4">
          <button
            type="submit"
            disabled={isSubmitting || !!matchedExistingProject}
            className={`w-full sm:w-auto px-6 py-2.5 font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm ${
              matchedExistingProject
                ? "bg-gray-300 dark:bg-[#2A2A2A] text-gray-500 cursor-not-allowed border border-gray-400 dark:border-[#3A3A3A]"
                : "bg-[#D4AF37] text-black hover:opacity-90 cursor-pointer focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] focus:ring-offset-2"
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Submitting Project...</span>
              </>
            ) : matchedExistingProject ? (
              <>
                <Lock className="w-4 h-4 text-gray-500" />
                <span>Submission Blocked: Project Already Exists</span>
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                <span>Submit Project</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Upgrade Project Modal for Deduplication Pathway */}
      {isUpgradeModalOpen && matchedExistingProject && (
        <UpgradeProjectModal
          isOpen={isUpgradeModalOpen}
          project={matchedExistingProject}
          lockedEmail={lockedEmail}
          designers={designers}
          scopesData={scopesData}
          onClose={() => setIsUpgradeModalOpen(false)}
          onSuccess={(msg) => {
            setToastMsg(msg);
            reset();
            setAssignedScopes({});
            setMatchedExistingProject(null);
            setTimeout(() => {
              setActiveTab("my_projects");
            }, 1500);
          }}
        />
      )}

      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-emerald-500 text-white rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300 border border-emerald-600">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-white" />
          <span className="font-semibold text-sm sm:text-base">{toastMsg}</span>
        </div>
      )}
    </div>
  );
}

function MyProjectsTab({ lockedEmail, currentUser }: { lockedEmail: string | null; currentUser: any }) {
  // Strict initial empty state - never inject fallback or dummy test data
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(() => Boolean(lockedEmail && currentUser));
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [projectToUpgrade, setProjectToUpgrade] = useState<any | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [designers, setDesigners] = useState<any[]>([]);
  const [scopesData, setScopesData] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 4000);
  };

  useEffect(() => {
    // Strictly defer data fetching until Firebase currentUser is defined and loaded
    if (!currentUser || !lockedEmail) {
      return;
    }

    const SUPER_ADMIN_EMAILS = ['jayjalpa2002@gmail.com', 'jay.solarithm@gmail.com'];
    const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(lockedEmail.toLowerCase().trim());

    // Fetch directly from live central Firebase projects collection
    const q = isSuperAdmin
      ? query(collection(db, COLLECTIONS.PROJECTS))
      : query(
          collection(db, COLLECTIONS.PROJECTS),
          where("salesPersonEmail", "==", lockedEmail)
        );

    const unsub = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        // Strict empty state when central database returns 0 projects
        setProjects([]);
        setLoading(false);
        return;
      }
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setProjects(data);
      setLoading(false);
    }, (err) => {
      console.error("Failed to query central projects collection:", err);
      setProjects([]);
      setLoading(false);
    });
    return () => unsub();
  }, [lockedEmail, currentUser]);

  useEffect(() => {
    // Strictly defer designer lookup until auth session is active
    if (!currentUser) {
      return;
    }

    // Fetch roster strictly from employees collection using Master Blueprint schema
    const eq = query(collection(db, COLLECTIONS.EMPLOYEES));
    const unsubD = onSnapshot(eq, (snapshot) => {
      if (!snapshot.empty) {
        const list = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            name: data.name || data.email || "Unnamed Employee",
            email: data.email || "",
            department: data.department || "",
            designation: data.designation || "",
            role: data.role || "",
            employeeId: data.employeeId || ""
          };
        }).filter(emp => Boolean(emp.email));

        const designStaff = list.filter(emp => {
          const dept = emp.department.toLowerCase();
          const role = emp.role.toLowerCase();
          const desig = emp.designation.toLowerCase();
          return dept.includes('design') || dept.includes('eng') || role.includes('designer') || role.includes('engineer') || desig.includes('design') || desig.includes('engineer');
        });

        setDesigners(designStaff.length > 0 ? designStaff : list);
      } else {
        setDesigners([]);
      }
    }, (err) => {
      console.error("Failed to query employees roster in MyProjectsTab:", err);
      setDesigners([]);
    });
    return () => unsubD();
  }, [currentUser]);

  // Fetch available scopes definition for Upgrade Project
  useEffect(() => {
    const sq = query(collection(db, COLLECTIONS.SCOPES));
    const unsubS = onSnapshot(sq, (snap) => {
      setScopesData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("Failed to query scopes in MyProjectsTab:", err);
      setScopesData([]);
    });
    return () => unsubS();
  }, []);

  const handleReassignDesigner = async (projectId: string, designerEmail: string) => {
    const selectedDesigner = designers.find(d => d.email === designerEmail);
    if (!selectedDesigner) return;

    try {
      const projectRef = doc(db, COLLECTIONS.PROJECTS, projectId);
      const proj = projects.find(p => p.id === projectId);
      
      const updateData: any = {
        [PROJECT_FIELDS.DESIGNER_EMAIL]: designerEmail,
        designerName: selectedDesigner.name,
        [PROJECT_FIELDS.UPDATED_AT]: serverTimestamp()
      };

      // If single scope assignedScopes exists, keep it in sync
      if (proj?.assignedScopes && Object.keys(proj.assignedScopes).length === 1) {
        const singleKey = Object.keys(proj.assignedScopes)[0];
        updateData[PROJECT_FIELDS.ASSIGNED_SCOPES] = { [singleKey]: designerEmail };
      }

      await updateDoc(projectRef, updateData);

      // Audit trail per Master Blueprint
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
          action: "PROJECT_DESIGNER_REASSIGNED",
          actor: lockedEmail,
          target: projectId,
          details: { designerEmail: selectedDesigner.email, designerName: selectedDesigner.name },
          timestamp: serverTimestamp()
        });
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      showToast("Designer successfully reassigned");
    } catch (err: any) {
      console.error("Failed to reassign designer:", err);
      showToast("Error reassigning designer: " + err.message);
    }
  };

  const handleReassignScopeDesigner = async (projectId: string, scopeKey: string, newEmail: string) => {
    const selectedDesigner = designers.find(d => d.email === newEmail);
    if (!selectedDesigner) return;

    try {
      const proj = projects.find(p => p.id === projectId);
      const existingScopes = proj?.assignedScopes || {};
      const updatedScopes = { ...existingScopes, [scopeKey]: newEmail };
      
      const projectRef = doc(db, COLLECTIONS.PROJECTS, projectId);
      const updateData: any = {
        [PROJECT_FIELDS.ASSIGNED_SCOPES]: updatedScopes,
        [PROJECT_FIELDS.UPDATED_AT]: serverTimestamp()
      };

      // Also update modules array if present
      if (Array.isArray(proj?.modules)) {
        updateData.modules = proj.modules.map((m: any) => {
          if (m.phaseKey === scopeKey) {
            return {
              ...m,
              assignedDesignerEmail: newEmail,
              assignedDesignerName: selectedDesigner.name
            };
          }
          return m;
        });
      }

      await updateDoc(projectRef, updateData);

      // Audit log per blueprint
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
          action: "PROJECT_SCOPE_DESIGNER_REASSIGNED",
          actor: lockedEmail,
          target: projectId,
          details: {
            scopeKey,
            designerEmail: newEmail,
            designerName: selectedDesigner.name
          },
          timestamp: serverTimestamp()
        });
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      showToast(`Designer for ${scopeKey} updated to ${selectedDesigner.name}`);
    } catch (err: any) {
      console.error("Failed to reassign scope designer:", err);
      showToast("Error reassigning scope designer: " + err.message);
    }
  };

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const queryStr = searchQuery.toLowerCase().trim();
    return projects.filter(p => {
      const clientName = (p.clientName || "").toLowerCase();
      const projectNumber = (p.projectNumber || p.srNumber || "").toLowerCase();
      const projectName = (p.projectName || "").toLowerCase();
      return clientName.includes(queryStr) || projectNumber.includes(queryStr) || projectName.includes(queryStr);
    });
  }, [projects, searchQuery]);

  const completedCount = useMemo(() => projects.filter(p => p.status === 'completed' || p.status === 'approved').length, [projects]);
  const inProgressCount = useMemo(() => projects.filter(p => p.status === 'in_progress' || p.status === 'assigned').length, [projects]);
  const pendingProjectsCount = useMemo(() => projects.filter(p => p.status === 'pending' || !p.status || p.status === 'submitted').length, [projects]);

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Total Projects</p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mt-1">{projects.length}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-[#2A2A2A] flex items-center justify-center text-amber-600 dark:text-[#D4AF37]">
            <FolderOpen className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">In Progress</p>
            <p className="text-2xl sm:text-3xl font-bold text-sky-600 dark:text-sky-400 mt-1">{inProgressCount}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400">
            <Clock3 className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Pending Review</p>
            <p className="text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">{pendingProjectsCount}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E1E1E] border border-gray-200 dark:border-[#333333] p-4 sm:p-5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">Completed</p>
            <p className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{completedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="w-full bg-white dark:bg-[#1E1E1E] p-4 sm:p-6 md:p-8 rounded-xl border border-gray-200 dark:border-[#333333] shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold font-sans text-gray-900 dark:text-white">My Projects</h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base mt-1">Track the status of all your submitted projects.</p>
          </div>
        </div>

        {/* Search Filter Bar */}
        {projects.length > 0 && (
          <div className="mb-6">
            <div className="relative max-w-md w-full">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Client, Project No., or Project Name..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] focus:border-transparent outline-none text-sm sm:text-base transition-all shadow-sm"
              />
              <div className="absolute left-3 top-2.5 text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-amber-600 dark:text-[#D4AF37]" /></div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-300 dark:border-[#333333] rounded-xl">
            <FolderOpen className="w-12 h-12 mx-auto text-gray-400 dark:text-[#333333] mb-3" />
            <p>No projects submitted yet.</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-[#333333] rounded-xl">
            <FolderOpen className="w-12 h-12 mx-auto text-gray-400 dark:text-[#333333] mb-3" />
            <p>No projects found matching &quot;{searchQuery}&quot;</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-[#333333] bg-white dark:bg-[#1E1E1E]">
            <table className="w-full text-left border-collapse whitespace-nowrap min-w-[760px]">
              <thead className="bg-gray-50 dark:bg-transparent border-b border-gray-200 dark:border-[#333333]">
                <tr className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm uppercase font-semibold">
                  <th className="py-3 px-4">SR. No</th>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Project Name</th>
                  <th className="py-3 px-4">Scope</th>
                  <th className="py-3 px-4">Capacity</th>
                  <th className="py-3 px-4">Designer</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm sm:text-base divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                {filteredProjects.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-gray-50 dark:hover:bg-[#2A2A2A]">
                    <td className="py-3 px-4 font-medium text-gray-800 dark:text-gray-200">{p.projectNumber || p.srNumber || '-'}</td>
                    <td className="py-3 px-4 text-gray-800 dark:text-gray-200 font-medium">
                      {toTitleCase(p.clientName)}
                    </td>
                    <td className="py-3 px-4 text-gray-800 dark:text-gray-200 font-medium">
                      {toTitleCase(p[PROJECT_FIELDS.PROJECT_NAME] || '-')}
                    </td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-200">
                      {toTitleCase(p.scopeOfWork)}
                      {p.subService && <span className="block text-xs sm:text-sm text-gray-500 dark:text-gray-400">{toTitleCase(p.subService)}</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-200">
                      {p.plantCapacity ? `${p.plantCapacity} ${p.capacityUnit || 'KW'}` : <span className="text-gray-400 italic">TBD</span>}
                    </td>
                    <td className="py-3 px-4">
                      {p.assignedScopes && Object.keys(p.assignedScopes).length > 1 ? (
                        <div className="flex flex-col gap-1.5 py-1 min-w-[220px]">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-[#D4AF37] uppercase tracking-wider">
                            <Layers className="w-3.5 h-3.5" />
                            <span>Split Scope ({Object.keys(p.assignedScopes).length})</span>
                          </div>
                          <div className="space-y-1">
                            {Object.entries(p.assignedScopes).map(([sKey, dEmail]) => {
                              const dEmailStr = String(dEmail || "");
                              const designerObj = designers.find(d => d.email === dEmailStr);
                              return (
                                <div key={sKey} className="flex items-center justify-between gap-1.5 bg-gray-50 dark:bg-[#252525] px-2 py-1 rounded border border-gray-200 dark:border-[#333333] text-xs">
                                  <span className="font-semibold text-gray-700 dark:text-gray-300 font-mono text-[11px] truncate max-w-[75px]" title={sKey}>
                                    {sKey}:
                                  </span>
                                  <select
                                    value={dEmailStr}
                                    onChange={(e) => handleReassignScopeDesigner(p.id, sKey, e.target.value)}
                                    className="bg-transparent text-gray-900 dark:text-gray-100 text-xs font-medium focus:outline-none cursor-pointer max-w-[135px] truncate"
                                    title={`Assigned: ${designerObj ? designerObj.name : dEmailStr}`}
                                  >
                                    <option value="" className="bg-white dark:bg-[#1E1E1E]">Unassigned</option>
                                    {designers.map(d => (
                                      <option key={d.id} value={d.email} className="bg-white dark:bg-[#1E1E1E]">
                                        {d.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <select
                          value={p.designerEmail || (p.assignedScopes ? Object.values(p.assignedScopes)[0] : "") || ""}
                          onChange={(e) => handleReassignDesigner(p.id, e.target.value)}
                          className="bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#2A2A2A] rounded-lg px-2.5 py-1 text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] cursor-pointer max-w-[200px] hover:border-[#D4AF37]/50 transition-colors"
                        >
                          <option value="" className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">Unassigned</option>
                          {designers.map(d => (
                            <option key={d.id} value={d.email} className="bg-white dark:bg-[#1E1E1E] text-gray-900 dark:text-white">
                              {toTitleCase(d.name)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium border text-center ${getStatusColor(p.status)}`}>
                        {toTitleCase(p.status.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <div className="flex flex-row justify-end items-center gap-2">
                        <button
                          onClick={() => setProjectToUpgrade(p)}
                          className="px-2.5 py-1 bg-[#D4AF37] hover:bg-[#c59f2e] active:scale-[0.98] text-black text-xs sm:text-sm font-semibold rounded-lg transition-all shadow-sm whitespace-nowrap flex items-center gap-1 cursor-pointer"
                          title="Upgrade Project Scopes & Assign Designers"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Upgrade Scope</span>
                        </button>
                        <button
                          onClick={() => setSelectedProject(p)}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-[#1E1E1E] dark:hover:bg-[#2A2A2A] text-gray-700 dark:text-gray-200 text-xs sm:text-sm font-semibold rounded-lg border border-gray-300 dark:border-[#2A2A2A] transition-colors shadow-sm whitespace-nowrap"
                        >
                          Request Change
                        </button>
                        <button
                          onClick={() => {
                            showToast("Transfer Project coming soon!");
                          }}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-[#1E1E1E] dark:hover:bg-[#2A2A2A] text-gray-700 dark:text-gray-200 text-xs sm:text-sm font-semibold rounded-lg border border-gray-300 dark:border-[#2A2A2A] transition-colors shadow-sm whitespace-nowrap"
                        >
                          Transfer Project
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Upgrade Project Scope Modal */}
        {projectToUpgrade && (
          <UpgradeProjectModal
            isOpen={Boolean(projectToUpgrade)}
            project={projectToUpgrade}
            lockedEmail={lockedEmail}
            designers={designers}
            scopesData={scopesData}
            onClose={() => setProjectToUpgrade(null)}
            onSuccess={(msg) => {
              setProjectToUpgrade(null);
              showToast(msg);
            }}
          />
        )}

        {selectedProject && (
          <RequestChangeModal
            project={selectedProject}
            lockedEmail={lockedEmail}
            onClose={() => setSelectedProject(null)}
            onSuccess={(msg) => {
              setSelectedProject(null);
              showToast(msg);
            }}
          />
        )}

        {toastMsg && (
          <div className="fixed bottom-6 right-6 z-50 p-4 bg-emerald-500 text-white rounded-lg shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300 border border-emerald-600">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-white" />
            <span className="font-semibold text-sm sm:text-base">{toastMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface RequestChangeModalProps {
  project: any;
  lockedEmail: string | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function RequestChangeModal({ project, lockedEmail, onClose, onSuccess }: RequestChangeModalProps) {
  const [fieldToChange, setFieldToChange] = useState("");
  const [requestedValue, setRequestedValue] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const currentValue = useMemo(() => {
    if (!fieldToChange) return "";
    if (fieldToChange === "Plant Capacity") {
      return String(project[PROJECT_FIELDS.PLANT_CAPACITY] || "");
    } else if (fieldToChange === "Scope of Work") {
      return String(project[PROJECT_FIELDS.SCOPE_OF_WORK] || "");
    } else if (fieldToChange === "Sub Service") {
      return String(project[PROJECT_FIELDS.SUB_SERVICE] || "");
    } else if (fieldToChange === "Location") {
      return String(project[PROJECT_FIELDS.LOCATION] || "");
    } else if (fieldToChange === "Designer") {
      if (project.assignedScopes && Object.keys(project.assignedScopes).length > 1) {
        return Object.entries(project.assignedScopes).map(([k, v]) => `${k}: ${v}`).join(', ');
      }
      return String(project.designerName || project.designerEmail || "");
    }
    return "N/A";
  }, [fieldToChange, project]);

  const handleSubmit = async () => {
    if (!fieldToChange || !currentValue || !requestedValue || !reason) {
      setErrorMsg("All fields marked with * are required.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const payload = {
        projectId: project.id || "",
        projectNumber: project.projectNumber || project.srNumber || "",
        clientName: project.clientName || "",
        fieldToChange,
        currentValue,
        requestedValue: fieldToChange === "Designer" ? requestedValue : toTitleCase(requestedValue),
        reason: toTitleCase(reason),
        requestedBy: lockedEmail || "",
        status: "pending",
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, COLLECTIONS.CHANGE_REQUESTS), payload);
      onSuccess("Change Request sent to Admin");
    } catch (err: any) {
      console.error("Error submitting change request: ", err);
      setErrorMsg(err.message || "Failed to submit change request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#1E1E1E] rounded-xl shadow-xl border border-gray-200 dark:border-[#333333] overflow-hidden transform transition-all scale-100 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-[#333333] flex justify-between items-center bg-gray-50 dark:bg-[#1E1E1E]">
          <div>
            <h3 className="text-base sm:text-lg font-bold font-sans text-gray-900 dark:text-white">
              Request Project Change
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {project.projectNumber || project.srNumber || '-'} - {project.clientName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2A2A2A]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 bg-white dark:bg-[#1E1E1E]">
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg flex items-start gap-2 border border-rose-500/30 text-sm sm:text-base">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">
              Field to Change *
            </label>
            <select
              value={fieldToChange}
              onChange={(e) => setFieldToChange(e.target.value)}
              disabled={isSubmitting}
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none"
            >
              <option value="">Select a field</option>
              <option value="Scope of Work">Scope of Work</option>
              <option value="Plant Capacity">Plant Capacity</option>
              <option value="Location">Location</option>
              <option value="Sub Service">Sub Service</option>
              <option value="Designer">Designer</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">
              Current Value *
            </label>
            <input
              type="text"
              value={currentValue}
              readOnly
              placeholder="Select a field first"
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-100 dark:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 cursor-not-allowed focus:ring-0 outline-none font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">
              Requested Value *
            </label>
            <input
              type="text"
              value={requestedValue}
              onChange={(e) => setRequestedValue(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. 75 KW"
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200">
              Reason for Change *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
              rows={3}
              placeholder="Provide a detailed explanation for this change request..."
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] text-gray-900 dark:text-white focus:ring-2 focus-within:border-[#D4AF37] focus:ring-[#D4AF37] outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-[#1E1E1E] border-t border-gray-200 dark:border-[#333333] flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#2A2A2A] rounded-lg hover:bg-gray-100 dark:hover:bg-[#2A2A2A] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !fieldToChange || !currentValue || !requestedValue || !reason}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base font-medium text-black bg-[#D4AF37] rounded-lg hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Request
          </button>
        </div>
      </div>
    </div>
  );
}
