"use client";

import { useEffect, useState, useMemo, useSyncExternalStore } from "react";
import { db } from "@/lib/firebase";
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  serverTimestamp, 
  getDocs, 
  doc, 
  getDoc, 
  updateDoc 
} from "firebase/firestore";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import confetti from "canvas-confetti";
import { format } from "date-fns";
import { 
  Loader2, 
  FileText, 
  UserPlus, 
  FolderOpen, 
  Building2, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  XCircle, 
  X, 
  Briefcase, 
  Menu, 
  Clock3, 
  Users, 
  Layers, 
  Sparkles, 
  Lock, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Filter, 
  RotateCcw,
  Mail
} from "lucide-react";
import { 
  COLLECTIONS, 
  CLIENT_STATUS, 
  CLIENT_FIELDS, 
  PROJECT_FIELDS 
} from "@/src/config/schema";
import ThemeToggle from "@/components/ThemeToggle";
import UpgradeProjectModal from "@/components/UpgradeProjectModal";
import { 
  generateClientInitials, 
  toTitleCase, 
  getStatusColor, 
  toCanonicalScopeKey, 
  parsePackageScopes, 
  getTodayDateString, 
  filterAndDeduplicateDesigners, 
  getSafeTimestampMillis, 
  getProjectTimestampMillis, 
  formatSafeDate, 
  getProjectDisplayDate, 
  safeStringIdentifier, 
  resolveProjectDate, 
  normalizeScopeDeduplicationKey, 
  isScopeVisibleInAdmin, 
  sanitizeFirestorePayload, 
  type ScopeItem 
} from "@/lib/utils";
import { initGlobalInactivityMonitor } from "@/lib/inactivityTracker";

// --- SCHEMAS ---

const clientSchema = z.object({
  companyName: z.string().min(1, "Company Name is required"),
  contactPerson: z.string().min(1, "Contact Person is required"),
  email: z.string().min(1, "Client Email Address is required").email("Please enter a valid email address"),
  phone: z.string().min(1, "Contact Number is required").regex(/^\d{10}$/, "Contact Number must be a valid 10-digit number"),
  city: z.string().min(1, "City is required"),
  gstin: z.string().optional(),
  billingAddress: z.string().optional(),
  proposalNumber: z.string().min(1, "Proposal Number is required"),
  pan: z.string().optional(),
  pincode: z.string().optional(),
  consumerNumber: z.string().optional(),
  sanctionNumber: z.string().optional(),
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
  date: z.string().min(1, "Project Date is required"),
  scopeOfWork: z.string().min(1, "Scope of Work is required"),
  subService: z.string().optional().nullable(),
  plantCapacity: z.number({ message: "Capacity must be a number" }).positive("System capacity must be greater than 0").nullable().optional(),
  capacityUnit: z.string().nullable().optional(),
  location: z.string().min(1, "Location is required"),
  designerId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

const emptySubscribe = () => () => {};

const SESSION_STORAGE_KEY = "solarithm_commerce_session";
let sessionListeners: Array<() => void> = [];

const subscribeSession = (listener: () => void) => {
  sessionListeners.push(listener);
  return () => {
    sessionListeners = sessionListeners.filter(l => l !== listener);
  };
};

const notifySessionChanged = () => {
  sessionListeners.forEach(l => {
    try {
      l();
    } catch {
      // Ignore
    }
  });
};

function getSessionSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSessionSnapshot(): string | null {
  return null;
}

// --- MAIN COMPONENT ---
export default function ProjectEntryTool() {
  const hasMounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const sessionRaw = useSyncExternalStore(subscribeSession, getSessionSnapshot, getServerSessionSnapshot);

  const activeSession = useMemo(() => {
    if (!sessionRaw) return null;
    try {
      const parsed = JSON.parse(sessionRaw);
      return parsed?.authenticated ? parsed : null;
    } catch {
      return null;
    }
  }, [sessionRaw]);

  const isAuthenticated = Boolean(activeSession?.authenticated);
  const userEmail = activeSession?.email || null;
  const userRole = activeSession?.role || null;
  const userName = activeSession?.name || null;

  const [tempEmail, setTempEmail] = useState("");
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"register" | "new_project" | "my_projects">("new_project");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Inactivity Monitor (15 minutes)
  useEffect(() => {
    if (!isAuthenticated) return;
    const cleanup = initGlobalInactivityMonitor(() => {
      setErrorMessage("Session expired due to inactivity. Please claim your profile again.");
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {}
      notifySessionChanged();
    });
    return () => cleanup();
  }, [isAuthenticated]);

  const handleLogout = () => {
    setTempEmail("");
    setErrorMessage("");
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {}
    notifySessionChanged();
  };

  const isCommerceAppIdentifier = (appId: string): boolean => {
    if (!appId || typeof appId !== "string") return false;
    const raw = appId.trim().toLowerCase();
    const normalized = raw.replace(/[^a-z0-9]/g, "");
    return (
      raw === "solarithm_commerce" ||
      raw === "solarithm-commerce" ||
      raw === "commerce" ||
      raw === "project_entry" ||
      raw === "project-entry" ||
      raw === "all" ||
      normalized === "solarithmcommerce" ||
      normalized === "projectentry" ||
      normalized.includes("commerce")
    );
  };

  // Strictly Email Locking (No password challenge)
  const handleUnlock = async (enteredEmail: string) => {
    if (!enteredEmail || !enteredEmail.trim()) {
      setErrorMessage("Please enter your work email.");
      return;
    }

    const normalizedEmail = enteredEmail.trim().toLowerCase();
    setIsVerifyingEmail(true);
    setErrorMessage("");

    // Super Admin Bypass
    const SUPER_ADMIN_EMAILS = ["jayjalpa2002@gmail.com", "jay.solarithm@gmail.com"];
    if (SUPER_ADMIN_EMAILS.includes(normalizedEmail)) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        authenticated: true,
        email: normalizedEmail,
        role: "owner",
        name: normalizedEmail.split('@')[0],
        timestamp: Date.now()
      }));
      notifySessionChanged();
      setIsVerifyingEmail(false);
      return;
    }

    try {
      let userDoc: any = null;
      let userId: string = "";

      // 1. Search in /users collection
      const usersRef = collection(db, COLLECTIONS.USERS);
      const userSnap = await getDocs(query(usersRef, where("email", "==", normalizedEmail)));
      if (!userSnap.empty) {
        userDoc = userSnap.docs[0].data();
        userId = userSnap.docs[0].id;
      } else {
        const allUsersSnap = await getDocs(usersRef);
        const match = allUsersSnap.docs.find(d => {
          const data = d.data();
          const em = (data.email || "").trim().toLowerCase();
          const pem = (data.personalEmailAddress || "").trim().toLowerCase();
          return em === normalizedEmail || pem === normalizedEmail || d.id.toLowerCase() === normalizedEmail;
        });
        if (match) {
          userDoc = match.data();
          userId = match.id;
        }
      }

      // 2. Search in /employees directory if not resolved
      if (!userDoc) {
        const empRef = collection(db, COLLECTIONS.EMPLOYEES);
        const empSnap = await getDocs(query(empRef, where("email", "==", normalizedEmail)));
        if (!empSnap.empty) {
          userDoc = empSnap.docs[0].data();
          userId = empSnap.docs[0].id;
        } else {
          const allEmpSnap = await getDocs(empRef);
          const match = allEmpSnap.docs.find(d => {
            const data = d.data();
            const em = (data.email || "").trim().toLowerCase();
            return em === normalizedEmail || d.id.toLowerCase() === normalizedEmail;
          });
          if (match) {
            userDoc = match.data();
            userId = match.id;
          }
        }
      }

      if (!userDoc) {
        if (normalizedEmail.endsWith("@solarithmdesign.com")) {
          userDoc = {
            email: normalizedEmail,
            name: normalizedEmail.split('@')[0],
            role: "sales",
            department: "Sales"
          };
        } else {
          setErrorMessage(`No account found for "${normalizedEmail}". Please contact your administrator.`);
          setIsVerifyingEmail(false);
          return;
        }
      }

      // Check Role, Designation, Department, and Assigned Apps
      const roleStr = String(userDoc.role || userDoc.assignedRole || "").toLowerCase().trim();
      const deptStr = String(userDoc.department || "").toLowerCase().trim();
      const desigStr = String(userDoc.designation || "").toLowerCase().trim();

      const isPermittedRoleOrDesig = [
        "sales", "admin", "owner", "director", "commercial", "partner", "administrator", "superadmin", "founder", "head"
      ].some(r => roleStr.includes(r) || desigStr.includes(r));

      const isSalesDepartment = [
        "sales", "commercial", "business development", "marketing", "presales", "pre-sales"
      ].some(s => deptStr.includes(s));

      const accessibleApps: string[] = Array.isArray(userDoc.accessibleApps)
        ? userDoc.accessibleApps
        : (Array.isArray(userDoc.assignedApps) ? userDoc.assignedApps : (Array.isArray(userDoc.apps) ? userDoc.apps : []));

      const hasAppPermission = accessibleApps.some(appId => isCommerceAppIdentifier(appId));
      const isOfficialDomain = normalizedEmail.endsWith("@solarithmdesign.com");

      const isPermitted = isPermittedRoleOrDesig || isSalesDepartment || hasAppPermission || isOfficialDomain;

      if (isPermitted) {
        const isAdminOrOwner = [
          "admin", "owner", "administrator", "superadmin", "director", "partner", "founder", "head"
        ].some(r => roleStr.includes(r) || desigStr.includes(r));
        const derivedRole = isAdminOrOwner 
          ? (roleStr.includes("owner") ? "owner" : "admin") 
          : "sales";
        const displayName = userDoc.name || userDoc.fullName || normalizedEmail.split('@')[0];

        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
          authenticated: true,
          email: normalizedEmail,
          role: derivedRole,
          name: displayName,
          timestamp: Date.now()
        }));
        setErrorMessage("");
        notifySessionChanged();
      } else {
        setErrorMessage("Access Denied: Your account does not have Sales, Commercial, or Administrative access.");
      }
    } catch (err: any) {
      console.error("Lock & Access Error:", err);
      setErrorMessage("Network or authorization issue. Please verify your connection.");
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  if (!hasMounted) return null;

  // --- LOCK SCREEN (Zero Password - Work Email Only) ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] p-4 font-sans select-none relative transition-colors duration-200">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] p-8 rounded-2xl shadow-2xl border border-gray-200 dark:border-[#333333] text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-[#2A2A2A] border border-amber-200 dark:border-[#3A3A3A] flex items-center justify-center mb-5 shadow-inner">
            <Briefcase className="w-7 h-7 text-amber-600 dark:text-[#D4AF37]" />
          </div>

          <div className="flex items-center justify-center gap-1.5 mb-2">
            <h1 className="text-2xl font-bold tracking-wide text-gray-900 dark:text-white">Solarithm</h1>
            <span className="text-2xl font-bold tracking-wide text-amber-600 dark:text-[#D4AF37]">Commerce</span>
          </div>

          <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm">
            Please enter your work email to claim your profile and continue.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleUnlock(tempEmail);
            }}
            className="space-y-4"
          >
            <div className="text-left space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">
                Work Email
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={tempEmail}
                  onChange={(e) => {
                    setTempEmail(e.target.value);
                    setErrorMessage("");
                  }}
                  placeholder="name@solarithmdesign.com"
                  className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] outline-none text-sm transition-all"
                  disabled={isVerifyingEmail}
                  autoFocus
                />
                <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-medium text-left flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifyingEmail || !tempEmail.trim()}
              className="w-full py-3 bg-[#D4AF37] hover:bg-[#c59f2e] text-black font-bold rounded-xl transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-md cursor-pointer"
            >
              {isVerifyingEmail ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
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
      <header className="bg-white dark:bg-[#1E1E1E] border-b border-gray-200 dark:border-[#D4AF37] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shrink-0 z-10 relative shadow-sm">
        <div className="flex items-center gap-2.5 sm:gap-4">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 -ml-1 text-gray-600 dark:text-gray-300 hover:text-[#D4AF37] rounded-lg md:hidden"
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
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:block">Client acquisition, proposal management, and dynamic pricing engine.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-sm text-gray-600 dark:text-gray-200 hidden lg:block">
            Logged in as: <span className="text-gray-900 dark:text-gray-100 font-medium">{userEmail}</span>
          </div>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="px-3 sm:px-4 py-1.5 sm:py-2 bg-[#D4AF37] text-black text-xs sm:text-sm font-semibold rounded-lg hover:opacity-90 transition-colors shadow-sm cursor-pointer"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Drawer Backdrop */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-[#1E1E1E] border-r border-gray-200 dark:border-[#333333] flex flex-col shrink-0 shadow-2xl transition-transform duration-300 md:static md:w-64 md:shadow-sm md:translate-x-0 ${
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-4 border-b border-gray-200 dark:border-[#333333] flex items-center justify-between md:hidden">
            <h2 className="font-bold text-gray-900 dark:text-white text-base">Solarithm Commerce</h2>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 py-4 space-y-1 px-2 md:px-0">
            <button
              onClick={() => { setActiveTab("register"); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 md:px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "register"
                  ? "bg-amber-50 dark:bg-[#2A2A2A] text-amber-700 dark:text-[#D4AF37] md:border-r-2 md:border-amber-500"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2A2A]"
              }`}
            >
              <UserPlus className="w-5 h-5 shrink-0" />
              <span>Register New Client</span>
            </button>
            <button
              onClick={() => { setActiveTab("new_project"); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 md:px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "new_project"
                  ? "bg-amber-50 dark:bg-[#2A2A2A] text-amber-700 dark:text-[#D4AF37] md:border-r-2 md:border-amber-500"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2A2A]"
              }`}
            >
              <FileText className="w-5 h-5 shrink-0" />
              <span>New Project</span>
            </button>
            <button
              onClick={() => { setActiveTab("my_projects"); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 md:px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "my_projects"
                  ? "bg-amber-50 dark:bg-[#2A2A2A] text-amber-700 dark:text-[#D4AF37] md:border-r-2 md:border-amber-500"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2A2A2A]"
              }`}
            >
              <FolderOpen className="w-5 h-5 shrink-0" />
              <span>My Projects</span>
            </button>
          </nav>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto flex flex-col min-w-0 bg-gray-50 dark:bg-[#121212]">
          <div className="flex-1 w-full max-w-full min-w-0">
            {activeTab === "register" && <RegisterClientTab lockedEmail={userEmail} currentUser={currentUserObj} />}
            {activeTab === "new_project" && <NewProjectTab lockedEmail={userEmail} setActiveTab={setActiveTab} currentUser={currentUserObj} />}
            {activeTab === "my_projects" && <MyProjectsTab lockedEmail={userEmail} currentUser={currentUserObj} />}
          </div>
          <footer className="mt-auto pt-8 pb-4 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">© 2026 Solarithm. All Rights Reserved.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

// --- REGISTER CLIENT TAB ---
function RegisterClientTab({ lockedEmail, currentUser }: { lockedEmail: string | null; currentUser: any }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [clients, setClients] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [proposals, setProposals] = useState<any[]>([]);

  // Fixed Retainer Project Package States
  const [commercialModel, setCommercialModel] = useState<"STANDARD" | "FIXED_PACKAGE">("STANDARD");
  const [scopeCovered, setScopeCovered] = useState<"Pre Design" | "Post Design">("Pre Design");
  const [projectsPerMonth, setProjectsPerMonth] = useState<number>(100);
  const [durationMonths, setDurationMonths] = useState<number>(1);
  const [confirmationDate, setConfirmationDate] = useState<string>(getTodayDateString());

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema)
  });

  const watchedGstin = useWatch({ control, name: "gstin" });
  const isGstinProvided = Boolean(watchedGstin && watchedGstin.trim().length > 0);

  useEffect(() => {
    if (!lockedEmail) return;

    // Resilient Clients listener (Reads from master /clients and filters client-side)
    const clientsRef = collection(db, "clients");
    const unsub = onSnapshot(clientsRef, (snapshot) => {
      try {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const normalizedLockedEmail = lockedEmail.toLowerCase().trim();
        const isAdmin = ["owner", "admin", "superadmin"].includes(String(currentUser?.role || "").toLowerCase().trim());

        // Client-side filtering: list clients where salesPersonEmail, registeredBy, registeredByEmail, or salesPerson matches lockedEmail
        const relevantClients = isAdmin 
          ? data 
          : data.filter((c: any) => {
              const spEmail = String(c.salesPersonEmail || "").toLowerCase().trim();
              const regBy = String(c.registeredBy || "").toLowerCase().trim();
              const regByEmail = String(c.registeredByEmail || "").toLowerCase().trim();
              const sp = String(c.salesPerson || "").toLowerCase().trim();

              return (
                spEmail === normalizedLockedEmail ||
                regBy === normalizedLockedEmail ||
                regByEmail === normalizedLockedEmail ||
                sp === normalizedLockedEmail
              );
            });

        relevantClients.sort((a: any, b: any) => getSafeTimestampMillis(b.createdAt) - getSafeTimestampMillis(a.createdAt));
        setClients(relevantClients);
      } catch (err) {
        console.error("Error processing clients:", err);
      } finally {
        setLoadingClients(false);
      }
    }, () => {
      setLoadingClients(false);
    });

    // Proposals listener: extract proposal identifier flexibly
    const unsubP = onSnapshot(collection(db, COLLECTIONS.PROPOSALS), (snapshot) => {
      try {
        const pList = snapshot.docs.map(doc => {
          const d = doc.data();
          const pNum = String(d.proposalNumber || d.proposalId || d.number || doc.id || "").trim();
          return {
            id: doc.id,
            ...d,
            proposalNumber: pNum
          };
        });
        setProposals(pList);
      } catch {
        setProposals([]);
      }
    }, () => {
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
      const clientEmailClean = (data.email || "").trim().toLowerCase();
      const contactNumberClean = safeStringIdentifier(data.phone);

      const payload: any = {
        [CLIENT_FIELDS.COMPANY_NAME]: toTitleCase(data.companyName),
        [CLIENT_FIELDS.CONTACT_PERSON]: toTitleCase(data.contactPerson),
        [CLIENT_FIELDS.EMAIL]: clientEmailClean,
        [CLIENT_FIELDS.CLIENT_EMAIL]: clientEmailClean,
        [CLIENT_FIELDS.PHONE]: contactNumberClean,
        [CLIENT_FIELDS.CONTACT_NUMBER]: contactNumberClean,
        [CLIENT_FIELDS.CITY]: toTitleCase(data.city),
        [CLIENT_FIELDS.GSTIN]: safeStringIdentifier(data.gstin).toUpperCase(),
        [CLIENT_FIELDS.PAN]: safeStringIdentifier(data.pan).toUpperCase(),
        [CLIENT_FIELDS.PINCODE]: safeStringIdentifier(data.pincode),
        [CLIENT_FIELDS.CONSUMER_NUMBER]: safeStringIdentifier(data.consumerNumber),
        [CLIENT_FIELDS.SANCTION_NUMBER]: safeStringIdentifier(data.sanctionNumber),
        [CLIENT_FIELDS.BILLING_ADDRESS]: data.billingAddress ? data.billingAddress.trim() : "",
        [CLIENT_FIELDS.PROPOSAL_NUMBER]: data.proposalNumber,
        [CLIENT_FIELDS.PRICING_CATEGORY]: pricingCategory,
        [CLIENT_FIELDS.STATUS]: CLIENT_STATUS.APPROVED, // Auto-available for projects
        [CLIENT_FIELDS.SALES_PERSON_EMAIL]: lockedEmail,
        registeredBy: lockedEmail,
        registeredByEmail: lockedEmail,
        commercialModel,
        subscriptionPlan: commercialModel === "FIXED_PACKAGE" ? {
          scopeCovered,
          projectsPerMonth: Number(projectsPerMonth),
          durationMonths: Number(durationMonths),
          confirmationDate,
          status: "PENDING_APPROVAL"
        } : null,
        createdAt: serverTimestamp()
      };
      
      await addDoc(collection(db, COLLECTIONS.CLIENTS), sanitizeFirestorePayload(payload));
      setSuccessMsg("Client registered successfully!");
      reset();
      setCommercialModel("STANDARD");
      setScopeCovered("Pre Design");
      setProjectsPerMonth(100);
      setDurationMonths(1);
      setConfirmationDate(getTodayDateString());
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to register client");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      <div className="w-full bg-white dark:bg-[#1E1E1E] p-5 sm:p-8 rounded-2xl border border-gray-200 dark:border-[#333333] shadow-sm">
        <h2 className="text-xl sm:text-2xl font-bold font-sans text-gray-900 dark:text-white mb-2">Register New Client</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm">Register a new client before creating a project.</p>
        
        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center gap-2 border border-emerald-500/30">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{successMsg}</span>
          </div>
        )}
        
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl flex items-start gap-2 border border-rose-500/30">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="text-sm font-medium">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Company Name *</label>
            <input {...register("companyName")} placeholder="e.g. Acme Solar Solutions" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
            {errors.companyName && <p className="text-xs text-rose-500">{errors.companyName.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Contact Person *</label>
            <input {...register("contactPerson")} placeholder="e.g. Rajesh Sharma" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
            {errors.contactPerson && <p className="text-xs text-rose-500">{errors.contactPerson.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">City *</label>
            <input {...register("city")} placeholder="e.g. Ahmedabad" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
            {errors.city && <p className="text-xs text-rose-500">{errors.city.message}</p>}
          </div>
          
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Proposal Number *</label>
            {proposals.length > 0 ? (
              <select {...register("proposalNumber")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]">
                <option value="">Select proposal from Admin Console</option>
                {proposals.map(p => {
                  const pNum = p.proposalNumber || p.proposalId || p.number || p.id;
                  const label = p.clientName ? `${pNum} (${p.clientName})` : pNum;
                  return (
                    <option key={p.id} value={pNum}>{label}</option>
                  );
                })}
              </select>
            ) : (
              <input {...register("proposalNumber")} placeholder="e.g. PROP-2026-001" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
            )}
            {errors.proposalNumber && <p className="text-xs text-rose-500">{errors.proposalNumber.message}</p>}
          </div>

          {/* COMMERCIAL MODEL TOGGLE & FIXED PACKAGE SETUP */}
          <div className="md:col-span-2 space-y-3 pt-1 pb-1">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider block">
              Commercial Model *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCommercialModel("STANDARD")}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                  commercialModel === "STANDARD"
                    ? "border-[#D4AF37] bg-amber-500/10 dark:bg-[#D4AF37]/10 text-gray-900 dark:text-white ring-1 ring-[#D4AF37]"
                    : "border-gray-200 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  commercialModel === "STANDARD" ? "border-[#D4AF37] bg-[#D4AF37]" : "border-gray-400 dark:border-gray-600"
                }`}>
                  {commercialModel === "STANDARD" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                </div>
                <div>
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">Standard</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pay-as-you-go / kW-based commercial rate card</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCommercialModel("FIXED_PACKAGE")}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                  commercialModel === "FIXED_PACKAGE"
                    ? "border-[#D4AF37] bg-amber-500/10 dark:bg-[#D4AF37]/10 text-gray-900 dark:text-white ring-1 ring-[#D4AF37]"
                    : "border-gray-200 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  commercialModel === "FIXED_PACKAGE" ? "border-[#D4AF37] bg-[#D4AF37]" : "border-gray-400 dark:border-gray-600"
                }`}>
                  {commercialModel === "FIXED_PACKAGE" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                </div>
                <div>
                  <div className="font-semibold text-sm text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span>Fixed Project Package</span>
                    <span className="px-1.5 py-0.5 text-[10px] bg-[#D4AF37] text-black font-bold rounded">Retainer</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Fixed monthly volume package with bonus quota</div>
                </div>
              </button>
            </div>

            {commercialModel === "FIXED_PACKAGE" && (
              <div className="p-4 sm:p-5 rounded-xl border border-[#D4AF37]/40 bg-amber-50/50 dark:bg-[#1A1812] space-y-4 mt-3">
                <div className="flex items-center gap-2 text-[#D4AF37] font-semibold text-sm border-b border-[#D4AF37]/20 pb-2">
                  <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                  <span>Fixed Retainer Project Package Setup</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase">Scope Covered</label>
                    <select
                      value={scopeCovered}
                      onChange={(e) => setScopeCovered(e.target.value as "Pre Design" | "Post Design")}
                      className="w-full p-2 text-sm rounded-lg border border-gray-300 dark:border-[#333333] bg-white dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#D4AF37]"
                    >
                      <option value="Pre Design">Pre Design</option>
                      <option value="Post Design">Post Design</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase">Projects / Month</label>
                    <select
                      value={projectsPerMonth}
                      onChange={(e) => setProjectsPerMonth(Number(e.target.value))}
                      className="w-full p-2 text-sm rounded-lg border border-gray-300 dark:border-[#333333] bg-white dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#D4AF37]"
                    >
                      <option value={100}>100 Projects/Month</option>
                      <option value={200}>200 Projects/Month</option>
                      <option value={300}>300 Projects/Month</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase">Plan Duration</label>
                    <select
                      value={durationMonths}
                      onChange={(e) => setDurationMonths(Number(e.target.value))}
                      className="w-full p-2 text-sm rounded-lg border border-gray-300 dark:border-[#333333] bg-white dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#D4AF37]"
                    >
                      <option value={1}>1 Month</option>
                      <option value={3}>3 Months</option>
                      <option value={6}>6 Months</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase">Confirmation Date</label>
                    <input
                      type="date"
                      value={confirmationDate}
                      onChange={(e) => setConfirmationDate(e.target.value)}
                      className="w-full p-2 text-sm rounded-lg border border-gray-300 dark:border-[#333333] bg-white dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[#D4AF37]"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Client Email *</label>
            <input type="email" {...register("email")} placeholder="contact@acmesolar.com" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
            {errors.email && <p className="text-xs text-rose-500">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Contact Phone *</label>
            <input type="tel" maxLength={10} {...register("phone")} placeholder="9876543210 (10 digits)" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37] font-mono" />
            {errors.phone && <p className="text-xs text-rose-500">{errors.phone.message}</p>}
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">GSTIN (Optional)</label>
            <input {...register("gstin")} placeholder="24ABCDE1234F1Z5" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none uppercase font-mono" />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
              Billing Address {isGstinProvided && <span className="text-rose-500">*</span>}
            </label>
            <textarea {...register("billingAddress")} rows={2} placeholder="Complete billing address" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none resize-none" />
            {errors.billingAddress && <p className="text-xs text-rose-500">{errors.billingAddress.message}</p>}
          </div>

          <div className="md:col-span-2 flex justify-end pt-2">
            <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-[#D4AF37] text-black font-bold rounded-lg hover:bg-[#c59f2e] transition-all flex items-center gap-2 cursor-pointer">
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Submit Client Registration
            </button>
          </div>
        </form>
      </div>

      {/* My Registered Clients Section */}
      <div className="w-full bg-white dark:bg-[#1E1E1E] p-5 sm:p-8 rounded-2xl border border-gray-200 dark:border-[#333333] shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg sm:text-xl font-bold font-sans text-gray-900 dark:text-white">My Registered Clients</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Clients registered by {lockedEmail} (Displaying all approved, active, and pending records)</p>
          </div>
          <span className="px-3 py-1 bg-amber-500/10 text-amber-600 dark:text-[#D4AF37] font-semibold text-xs rounded-full border border-amber-500/30">
            {clients.length} {clients.length === 1 ? "Client" : "Clients"}
          </span>
        </div>

        {loadingClients ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" /></div>
        ) : clients.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
            No clients registered under your email yet. Register a client using the form above.
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-[#333333]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-50 dark:bg-[#252525] border-b border-gray-200 dark:border-[#333333] text-xs uppercase font-semibold text-gray-600 dark:text-gray-400">
                <tr>
                  <th className="py-3 px-4">Company Name</th>
                  <th className="py-3 px-4">Contact Person</th>
                  <th className="py-3 px-4">City</th>
                  <th className="py-3 px-4">Phone</th>
                  <th className="py-3 px-4">Proposal</th>
                  <th className="py-3 px-4">Commercial Model</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
                {clients.map((c) => {
                  const company = c.companyName || c.clientName || c.name || "Client";
                  const contact = c.contactPerson || "-";
                  const city = c.city || "-";
                  const phone = c.phone || c.contactNumber || "-";
                  const propNum = c.proposalNumber || "-";
                  const status = c.status || "approved";
                  const subPlan = c.subscriptionPlan || c.retainerPlan;

                  return (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                      <td className="py-3 px-4 font-semibold text-gray-900 dark:text-white">{company}</td>
                      <td className="py-3 px-4 text-gray-600 dark:text-gray-300">{contact}</td>
                      <td className="py-3 px-4 text-gray-600 dark:text-gray-300">{city}</td>
                      <td className="py-3 px-4 font-mono text-xs">{phone}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs text-amber-600 dark:text-[#D4AF37]">{propNum}</span>
                          {c.commercialModel === "FIXED_PACKAGE" && subPlan && (
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                              ({subPlan.scopeCovered} · {subPlan.projectsPerMonth}/mo · {subPlan.durationMonths}M)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {c.commercialModel === "FIXED_PACKAGE" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-[#D4AF37] border border-amber-500/30 w-fit">
                              <Sparkles className="w-3 h-3" />
                              Fixed Package ({subPlan?.scopeCovered || "Retainer"})
                            </span>
                            {subPlan?.projectsPerMonth && (
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                                {subPlan.projectsPerMonth}/mo · {subPlan.durationMonths} month{subPlan.durationMonths > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-[#333333]">
                            Standard
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${getStatusColor(status)}`}>
                          {toTitleCase(String(status).replace(/_/g, " "))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// --- NEW PROJECT TAB (Resilient Admin Console Mapping) ---
function NewProjectTab({ lockedEmail, setActiveTab, currentUser }: { lockedEmail: string | null, setActiveTab: any, currentUser: any }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  const [clients, setClients] = useState<any[]>([]);
  const [designers, setDesigners] = useState<any[]>([]);
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [scopesData, setScopesData] = useState<any[]>([]);
  const [existingProjects, setExistingProjects] = useState<any[]>([]);
  
  const { register, handleSubmit, formState: { errors }, reset, setValue, control } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      capacityUnit: 'KW',
      date: getTodayDateString()
    }
  });

  const selectedClientId = useWatch({ control, name: "clientId" });
  const selectedScope = useWatch({ control, name: "scopeOfWork" });
  const selectedSubService = useWatch({ control, name: "subService" });
  const capacityValue = useWatch({ control, name: "plantCapacity" });
  const capacityUnit = useWatch({ control, name: "capacityUnit" });
  const enteredProjectName = useWatch({ control, name: "projectName" }) || "";
  const enteredLocation = useWatch({ control, name: "location" }) || "";

  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // 1. Fetch Clients (Strict user-specific filtering [DIRECTIVE 2])
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "clients"), (snapshot) => {
      const normalizedUser = (lockedEmail || "").toLowerCase().trim();
      const isAdmin = ["owner", "admin", "superadmin"].includes(String(currentUser?.role || "").toLowerCase().trim());

      const activeList = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter((c: any) => {
        const st = String(c.status || "").toLowerCase().trim();
        // Allow approved, active, pending_approval, or unset
        if (["rejected", "deleted", "archived", "disabled"].includes(st)) return false;

        // Admin/owner can see all active clients
        if (isAdmin) return true;

        // Sales representative sees ONLY clients registered by them
        const spEmail = String(c.salesPersonEmail || "").toLowerCase().trim();
        const regBy = String(c.registeredBy || "").toLowerCase().trim();
        const regByEmail = String(c.registeredByEmail || "").toLowerCase().trim();
        const sp = String(c.salesPerson || "").toLowerCase().trim();

        return (
          spEmail === normalizedUser ||
          regBy === normalizedUser ||
          regByEmail === normalizedUser ||
          sp === normalizedUser
        );
      });

      activeList.sort((a: any, b: any) => {
        const nameA = (a.companyName || a.clientName || a.name || "").trim().toLowerCase();
        const nameB = (b.companyName || b.clientName || b.name || "").trim().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      setClients(activeList);
    }, () => setClients([]));
    return () => unsub();
  }, [lockedEmail, currentUser]);

  // 2. Fetch Designers/Employees
  useEffect(() => {
    let cachedEmp: any[] = [];
    let cachedUsers: any[] = [];
    const sync = () => setDesigners(filterAndDeduplicateDesigners(cachedEmp, cachedUsers));

    const unsubEmp = onSnapshot(collection(db, "employees"), snap => {
      cachedEmp = snap.docs;
      sync();
    }, () => {});

    const unsubUsers = onSnapshot(collection(db, "users"), snap => {
      cachedUsers = snap.docs;
      sync();
    }, () => {});

    return () => {
      unsubEmp();
      unsubUsers();
    };
  }, []);

  // 3. Fetch Master Scopes from Admin Console (/scopes, /packages, /pricingRules)
  useEffect(() => {
    let sList: any[] = [];
    let pkList: any[] = [];
    let prList: any[] = [];

    const sync = () => {
      const combined = [...sList, ...pkList, ...prList];
      const seen = new Set<string>();
      const res: any[] = [];
      for (const item of combined) {
        const name = (item.name || item.packageName || item.title || item.label || item.scopeName || item.scope || item.serviceName || "").trim();
        if (!name) continue;
        const key = normalizeScopeDeduplicationKey(name);
        if (!seen.has(key)) {
          seen.add(key);
          res.push({ ...item, name });
        }
      }
      setScopesData(res);
    };

    const unsubS = onSnapshot(collection(db, "scopes"), snap => {
      sList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sync();
    }, () => {});

    const unsubPk = onSnapshot(collection(db, "packages"), snap => {
      pkList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sync();
    }, () => {});

    const unsubPr = onSnapshot(collection(db, "pricingRules"), snap => {
      prList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPricingRules(prList);
      sync();
    }, () => {});

    return () => {
      unsubS();
      unsubPk();
      unsubPr();
    };
  }, []);

  // 4. Fetch Projects (for Deduplication)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "projects"), snap => {
      setExistingProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setExistingProjects([]));
    return () => unsub();
  }, []);

  // Pure Dynamic Scope List: populated EXCLUSIVELY from Firestore (/scopes, /packages, /pricingRules)
  const uniqueScopes = useMemo((): string[] => {
    const scopeMap = new Map<string, string>();
    
    // Dynamically populate from live Admin Console scopes/packages/pricingRules
    scopesData.forEach(item => {
      const name = (item.name || item.packageName || item.title || item.label || item.scopeName || "").trim();
      if (name) {
        const key = normalizeScopeDeduplicationKey(name);
        if (!scopeMap.has(key)) {
          scopeMap.set(key, name);
        }
      }
    });

    return Array.from(scopeMap.values()).sort((a, b) => a.localeCompare(b));
  }, [scopesData]);

  const selectedScopeDoc = useMemo(() => {
    if (!selectedScope) return null;
    const targetKey = normalizeScopeDeduplicationKey(selectedScope);
    return scopesData.find(s => normalizeScopeDeduplicationKey(s.name) === targetKey) || null;
  }, [scopesData, selectedScope]);

  // Dynamic Sub-Services / Modules mapped directly from selected Firestore scope/package
  const subServices = useMemo((): string[] => {
    if (!selectedScopeDoc) return [];
    const list: string[] = [];
    if (Array.isArray(selectedScopeDoc.subServices)) {
      selectedScopeDoc.subServices.forEach((s: any) => {
        const val = typeof s === "string" ? s : (s?.name || s?.title || s?.label || "");
        if (val && !list.includes(val)) list.push(val);
      });
    }
    if (Array.isArray(selectedScopeDoc.modules)) {
      selectedScopeDoc.modules.forEach((m: any) => {
        const val = typeof m === "string" ? m : (m?.name || m?.phaseName || m?.title || "");
        if (val && !list.includes(val)) list.push(val);
      });
    }
    return list;
  }, [selectedScopeDoc]);

  const packageScopes = useMemo((): ScopeItem[] => {
    if (!selectedScope) return [];
    return parsePackageScopes(selectedScope, selectedScopeDoc).map(s => ({
      key: toCanonicalScopeKey(s.key),
      label: s.label
    }));
  }, [selectedScope, selectedScopeDoc]);

  const [assignedScopes, setAssignedScopes] = useState<Record<string, string>>({});
  const [scopeAssignmentErrors, setScopeAssignmentErrors] = useState<Record<string, string>>({});

  // Deduplication check
  const matchedExistingProject = useMemo(() => {
    const trimmedName = enteredProjectName.trim().toLowerCase();
    const normalizeLoc = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const trimmedLoc = normalizeLoc(enteredLocation);

    if (!selectedClientId || !trimmedName || !trimmedLoc) return null;

    const selClient = clients.find(c => c.id === selectedClientId);
    const selClientNorm = normalizeLoc(selClient?.companyName || selClient?.clientName || selClient?.name);

    const capNum = (capacityValue !== null && capacityValue !== undefined && !isNaN(Number(capacityValue)))
      ? Number(capacityValue)
      : null;

    return existingProjects.find((p: any) => {
      const pClientMatch = (p.clientId === selectedClientId) || (normalizeLoc(p.clientName) === selClientNorm);
      if (!pClientMatch) return false;
      if ((p.projectName || "").trim().toLowerCase() !== trimmedName) return false;
      const pCap = Number(p.plantCapacity ?? p.capacity);
      if (capNum !== null && !isNaN(pCap) && pCap !== capNum) return false;
      if (normalizeLoc(p.location) !== trimmedLoc) return false;
      return true;
    }) || null;
  }, [existingProjects, selectedClientId, enteredProjectName, capacityValue, enteredLocation, clients]);

  const isScopeUpgrade = Boolean(
    matchedExistingProject && 
    selectedScope && 
    String(matchedExistingProject.scopeOfWork || "").trim().toLowerCase() !== selectedScope.trim().toLowerCase()
  );

  const onSubmit = async (data: any) => {
    if (!lockedEmail) return;

    if (matchedExistingProject) {
      setErrorMsg("This project already exists. Click 'Upgrade Project' to append scopes.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const client = clients.find(c => c.id === data.clientId);
      if (!client) throw new Error("Client not found");
      const clientName = client.companyName || client.clientName || client.name || "Client";

      // Validate designer assignment
      const errorsMap: Record<string, string> = {};
      packageScopes.forEach(s => {
        if (!assignedScopes[s.key]) {
          errorsMap[s.key] = `Please assign a designer for ${s.label}`;
        }
      });

      if (Object.keys(errorsMap).length > 0) {
        setScopeAssignmentErrors(errorsMap);
        throw new Error("Please assign designers to all scope phases");
      }

      const assignedClean: Record<string, string> = {};
      packageScopes.forEach(s => {
        assignedClean[s.key] = assignedScopes[s.key];
      });

      const firstScope = packageScopes[0]?.key;
      const primaryEmail = firstScope ? assignedClean[firstScope] : "";
      const primaryDesigner = designers.find(d => d.email === primaryEmail);

      const pSnap = await getDocs(collection(db, "projects"));
      const seq = (pSnap.size + 1).toString().padStart(3, '0');
      const [year, month] = (data.date || getTodayDateString()).split('-');
      const srNumber = `${generateClientInitials(clientName)}-${year}-${month}-${seq}`;

      const modulesData = packageScopes.map(s => ({
        phaseKey: s.key,
        phaseName: s.label,
        status: "ASSIGNED",
        assignedDesignerEmail: assignedClean[s.key],
        assignedDesignerName: designers.find(d => d.email === assignedClean[s.key])?.name || assignedClean[s.key].split('@')[0],
        startedAt: null,
        completedAt: null
      }));

      const payload = {
        projectName: toTitleCase(data.projectName),
        projectNumber: srNumber,
        srNumber,
        date: data.date,
        projectDate: data.date,
        clientId: client.id,
        clientName: toTitleCase(clientName),
        scopeOfWork: data.scopeOfWork.trim(),
        subService: data.subService || "Standard",
        plantCapacity: (data.plantCapacity !== null && data.plantCapacity !== undefined && data.plantCapacity !== "") ? Number(data.plantCapacity) : null,
        capacityUnit: data.capacityUnit || "KW",
        location: toTitleCase(data.location),
        designerEmail: primaryEmail,
        designerName: primaryDesigner?.name || primaryEmail.split('@')[0],
        assignedScopes: assignedClean,
        modules: modulesData,
        remarks: data.remarks || null,
        salesPersonEmail: lockedEmail,
        salesPerson: currentUser?.name || lockedEmail,
        status: "ASSIGNED",
        paymentStatus: "PENDING",
        pricingCategory: client.pricingCategory || "T1",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(collection(db, "projects"), sanitizeFirestorePayload(payload));

      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      reset();
      setAssignedScopes({});
      setTimeout(() => setActiveTab("my_projects"), 1500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-[#1E1E1E] p-5 sm:p-8 rounded-2xl border border-gray-200 dark:border-[#333333] shadow-sm animate-in fade-in duration-300">
      <h2 className="text-xl sm:text-2xl font-bold font-sans text-gray-900 dark:text-white mb-2">New Project Entry</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm">Create and assign a new solar engineering project.</p>

      {errorMsg && (
        <div className="mb-6 p-4 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl flex items-start gap-2 border border-rose-500/30">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Client Selection (Mapped directly from Admin Console /clients) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Client *</label>
          <select {...register("clientId")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]">
            <option value="">-- Choose Client ({clients.length} available) --</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.companyName || c.clientName || c.name || "Client"}
              </option>
            ))}
          </select>
          {errors.clientId && <p className="text-xs text-rose-500">{errors.clientId.message}</p>}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Project Date *</label>
          <input type="date" {...register("date")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Project Name / Site *</label>
          <input type="text" placeholder="e.g. 50kW Rooftop Solar Installation" {...register("projectName")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
          {errors.projectName && <p className="text-xs text-rose-500">{errors.projectName.message}</p>}
        </div>

        {/* Scope of Work Dropdown (Mapped dynamically from Admin Console Scopes & Packages) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Scope of Work / Package *</label>
          <select {...register("scopeOfWork")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]">
            <option value="">-- Choose Scope or Multi-Scope Package --</option>
            {uniqueScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {errors.scopeOfWork && <p className="text-xs text-rose-500">{errors.scopeOfWork.message}</p>}
        </div>

        {/* Dynamic Sub-Service dropdown if available on selected scope/package */}
        {subServices.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Sub-Service / Module</label>
            <select {...register("subService")} className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]">
              <option value="">-- Select Sub-Service (Optional) --</option>
              {subServices.map(sub => (
                <option key={sub} value={sub}>{sub}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Plant Capacity</label>
          <div className="flex gap-2">
            <input type="number" step="0.01" min="0" placeholder="e.g. 100" {...register("plantCapacity", { valueAsNumber: true })} className="flex-1 p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
            <select {...register("capacityUnit")} className="w-24 p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none">
              <option value="KW">KW</option>
              <option value="MW">MW</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Location / Site Address *</label>
          <input {...register("location")} placeholder="Plot 42, MIDC Industrial Area, Pune" className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#141414] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#D4AF37]" />
          {errors.location && <p className="text-xs text-rose-500">{errors.location.message}</p>}
        </div>

        {/* Dynamic Multi-Stage Designer Assignment */}
        {packageScopes.length > 0 && (
          <div className="md:col-span-2 space-y-4 p-4 sm:p-5 rounded-xl border border-amber-500/20 bg-amber-50/30 dark:bg-[#181818]">
            <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-[#2A2A2A]">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Designer Scope Allocation</h3>
              </div>
              {packageScopes.length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Quick Assign All:</span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const batch: Record<string, string> = {};
                      packageScopes.forEach(s => { batch[s.key] = e.target.value; });
                      setAssignedScopes(batch);
                      setScopeAssignmentErrors({});
                    }}
                    className="p-1 rounded border border-gray-300 dark:border-[#333333] bg-white dark:bg-[#121212] text-xs outline-none"
                  >
                    <option value="" disabled>Choose Designer</option>
                    {designers.map(d => <option key={d.id} value={d.email}>{d.displayLabel || d.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {packageScopes.map((scope) => (
                <div key={scope.key} className="space-y-1.5 p-3 rounded-lg bg-white dark:bg-[#202020] border border-gray-200 dark:border-[#333333]">
                  <span className="text-xs font-semibold text-amber-700 dark:text-[#D4AF37] block">{scope.label} Scope *</span>
                  <select
                    value={assignedScopes[scope.key] || ""}
                    onChange={(e) => {
                      setAssignedScopes(prev => ({ ...prev, [scope.key]: e.target.value }));
                      setScopeAssignmentErrors(prev => {
                        const n = { ...prev };
                        delete n[scope.key];
                        return n;
                      });
                    }}
                    className="w-full p-2 rounded-lg border border-gray-300 dark:border-[#333333] bg-gray-50 dark:bg-[#161616] text-xs outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  >
                    <option value="">Select designer for {scope.label}</option>
                    {designers.map(d => <option key={d.id} value={d.email}>{d.displayLabel || d.name}</option>)}
                  </select>
                  {scopeAssignmentErrors[scope.key] && (
                    <p className="text-[11px] text-rose-500 font-medium">{scopeAssignmentErrors[scope.key]}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deduplication Alert / Upgrade Button */}
        {matchedExistingProject && (
          <div className="md:col-span-2 p-4 rounded-xl border border-amber-500/50 bg-amber-500/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#D4AF37] shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">Existing Project Match Detected</h4>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {matchedExistingProject.projectName} ({matchedExistingProject.clientName}) already exists with scope: {matchedExistingProject.scopeOfWork}.
                </p>
              </div>
            </div>
            {isScopeUpgrade && (
              <button
                type="button"
                onClick={() => setIsUpgradeModalOpen(true)}
                className="px-4 py-2 bg-[#D4AF37] text-black font-bold rounded-lg text-xs whitespace-nowrap cursor-pointer hover:bg-[#c59f2e]"
              >
                Upgrade Project Scope
              </button>
            )}
          </div>
        )}

        <div className="md:col-span-2 flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !!matchedExistingProject}
            className="px-6 py-2.5 bg-[#D4AF37] hover:bg-[#c59f2e] text-black font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Submit Project
          </button>
        </div>
      </form>

      {isUpgradeModalOpen && matchedExistingProject && (
        <UpgradeProjectModal
          isOpen={isUpgradeModalOpen}
          project={matchedExistingProject}
          lockedEmail={lockedEmail}
          designers={designers}
          scopesData={scopesData}
          initialTargetScope={selectedScope}
          onClose={() => setIsUpgradeModalOpen(false)}
          onSuccess={(msg) => {
            setToastMsg(msg);
            reset();
            setTimeout(() => setActiveTab("my_projects"), 1200);
          }}
        />
      )}
    </div>
  );
}

// --- MY PROJECTS TAB ---
function MyProjectsTab({ lockedEmail, currentUser }: { lockedEmail: string | null; currentUser: any }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [designers, setDesigners] = useState<any[]>([]);
  const [scopesData, setScopesData] = useState<any[]>([]);
  const [projectToUpgrade, setProjectToUpgrade] = useState<any | null>(null);

  useEffect(() => {
    if (!lockedEmail) return;

    const isAdmin = ["owner", "admin"].includes(currentUser?.role);
    const q = isAdmin 
      ? query(collection(db, "projects"))
      : query(collection(db, "projects"), where("salesPersonEmail", "==", lockedEmail));

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a: any, b: any) => getProjectTimestampMillis(b) - getProjectTimestampMillis(a));
      setProjects(data);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [lockedEmail, currentUser]);

  useEffect(() => {
    let cachedEmp: any[] = [];
    let cachedUsers: any[] = [];
    const sync = () => setDesigners(filterAndDeduplicateDesigners(cachedEmp, cachedUsers));

    const unsubEmp = onSnapshot(collection(db, "employees"), snap => {
      cachedEmp = snap.docs;
      sync();
    }, () => {});

    const unsubUsers = onSnapshot(collection(db, "users"), snap => {
      cachedUsers = snap.docs;
      sync();
    }, () => {});

    return () => {
      unsubEmp();
      unsubUsers();
    };
  }, []);

  useEffect(() => {
    let sList: any[] = [];
    let pkList: any[] = [];
    let prList: any[] = [];

    const sync = () => {
      const combined = [...sList, ...pkList, ...prList];
      const seen = new Set<string>();
      const res: any[] = [];
      for (const item of combined) {
        const name = (item.name || item.packageName || item.title || item.label || item.scopeName || item.scope || item.serviceName || "").trim();
        if (!name) continue;
        const key = normalizeScopeDeduplicationKey(name);
        if (!seen.has(key)) {
          seen.add(key);
          res.push({ ...item, name });
        }
      }
      setScopesData(res);
    };

    const unsubS = onSnapshot(collection(db, "scopes"), snap => {
      sList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sync();
    }, () => {});

    const unsubPk = onSnapshot(collection(db, "packages"), snap => {
      pkList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sync();
    }, () => {});

    const unsubPr = onSnapshot(collection(db, "pricingRules"), snap => {
      prList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sync();
    }, () => {});

    return () => {
      unsubS();
      unsubPk();
      unsubPr();
    };
  }, []);

  return (
    <div className="w-full bg-white dark:bg-[#1E1E1E] p-5 sm:p-8 rounded-2xl border border-gray-200 dark:border-[#333333] shadow-sm">
      <h2 className="text-xl sm:text-2xl font-bold font-sans text-gray-900 dark:text-white mb-4">My Submitted Projects</h2>
      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#D4AF37]" /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No projects submitted yet.</div>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-[#333333]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-[#252525] border-b border-gray-200 dark:border-[#333333] text-xs uppercase font-semibold text-gray-600 dark:text-gray-400">
              <tr>
                <th className="py-3 px-4">SR. No</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Client Name</th>
                <th className="py-3 px-4">Project Name</th>
                <th className="py-3 px-4">Scope</th>
                <th className="py-3 px-4">Capacity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2A2A2A]">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                  <td className="py-3 px-4 font-mono font-medium">{p.projectNumber || p.srNumber || '-'}</td>
                  <td className="py-3 px-4 text-gray-500">{getProjectDisplayDate(p)}</td>
                  <td className="py-3 px-4 font-semibold text-gray-900 dark:text-white">{p.clientName}</td>
                  <td className="py-3 px-4">{p.projectName}</td>
                  <td className="py-3 px-4">{p.scopeOfWork}</td>
                  <td className="py-3 px-4">{p.plantCapacity ? `${p.plantCapacity} ${p.capacityUnit || 'KW'}` : '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${getStatusColor(p.status)}`}>
                      {toTitleCase((p.status || 'ASSIGNED').replace(/_/g, ' '))}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setProjectToUpgrade(p)}
                      className="px-3 py-1 bg-[#D4AF37] text-black font-semibold rounded-lg text-xs hover:bg-[#c59f2e] transition-all cursor-pointer inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Upgrade Scope
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {projectToUpgrade && (
        <UpgradeProjectModal
          isOpen={Boolean(projectToUpgrade)}
          project={projectToUpgrade}
          lockedEmail={lockedEmail}
          designers={designers}
          scopesData={scopesData}
          onClose={() => setProjectToUpgrade(null)}
          onSuccess={() => setProjectToUpgrade(null)}
        />
      )}
    </div>
  );
}