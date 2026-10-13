import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function generateClientInitials(companyName: string) {
  if (!companyName) return "";
  const words = companyName.trim().split(/\s+/);
  if (words.length > 1) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return companyName.substring(0, 2).toUpperCase();
}

export function toTitleCase(str: string): string {
  if (!str) return "";
  return str.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

export function getStatusColor(status: string) {
  switch(status?.toUpperCase()) {
    case 'NOT STARTED': 
    case 'REJECTED':
    case 'DELAYED':
      return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    case 'ASSIGNED':
      return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
    case 'PENDING': 
    case 'PENDING_APPROVAL':
    case 'IN PROGRESS':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'IN VERIFICATION': 
    case 'IN REVISION':
      return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    case 'APPROVED':
    case 'COMPLETED': 
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'DATA MISSING': 
    default: 
      return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
  }
}

/**
 * Standardized Canonical Scope Key resolver across all ecosystem applications [SCH-01, SCH-04].
 * Converts any scope name / label into canonical camelCase (e.g. detailedEngineering, permitPackage).
 */
export function toCanonicalScopeKey(scopeName: string): string {
  if (!scopeName) return "scope";
  const lower = scopeName.toLowerCase().trim();
  if (lower === "pvsyst" || lower === "pv-syst" || lower === "pv syst") return "pvsyst";
  if (lower === "predesign" || lower === "pre-design" || lower === "pre design") return "preDesign";
  if (lower === "ceig") return "ceig";
  if (lower === "ifp") return "ifp";
  if (lower.includes("detailed")) return "detailedEngineering";
  if (lower.includes("permit")) return "permitPackage";
  if (lower.includes("sld") || lower.includes("single line")) return "sld";
  if (lower.includes("bom") || lower.includes("bill of materials")) return "bom";
  if (lower.includes("stamp")) return "peStamping";
  if (lower.includes("as-built") || lower.includes("asbuilt")) return "asBuilt";
  if (lower.includes("interconnection")) return "interconnection";

  const clean = lower.replace(/[^a-z0-9\s_-]/g, "");
  const parts = clean.split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "scope";
  if (parts.length === 1) return parts[0];
  return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

export const toScopeKey = toCanonicalScopeKey;

/**
 * Safe String Identifier sanitizer per DAT-01 audit finding.
 * Prevents numeric coercion that strips leading zeros or causes scientific notation.
 */
export function safeStringIdentifier(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 0 })
      : "";
  }
  return String(value).trim();
}

/**
 * Standardized canonical project date resolution [PRJ-02].
 * Strictly evaluates: projectDate -> date -> completedDate -> createdAt -> updatedAt.
 */
export function resolveProjectDate(project: Record<string, any>): Date | null {
  if (!project) return null;
  const raw = project.projectDate || project.date || project.completedDate || project.createdAt || project.updatedAt;
  const millis = getSafeTimestampMillis(raw);
  if (millis <= 0) return null;
  const d = new Date(millis);
  return isNaN(d.getTime()) ? null : d;
}

export interface ScopeItem {
  key: string;
  label: string;
}

export function parsePackageScopes(selectedScopeName: string, scopeObj?: any): ScopeItem[] {
  if (!selectedScopeName) return [];

  // 1. If Firestore scope document has explicit sub-scopes / modules
  if (scopeObj) {
    if (Array.isArray(scopeObj.scopes) && scopeObj.scopes.length > 0) {
      return scopeObj.scopes.map((s: string) => ({
        key: toScopeKey(s),
        label: s.trim()
      }));
    }
    if (Array.isArray(scopeObj.includedScopes) && scopeObj.includedScopes.length > 0) {
      return scopeObj.includedScopes.map((s: string) => ({
        key: toScopeKey(s),
        label: s.trim()
      }));
    }
    if (Array.isArray(scopeObj.modules) && scopeObj.modules.length > 0) {
      return scopeObj.modules.map((m: any) => {
        const name = typeof m === 'string' ? m : (m.name || m.phaseName || m.phaseKey || 'Scope');
        return {
          key: toScopeKey(name),
          label: name.trim()
        };
      });
    }
  }

  // 2. Parse '+' separator, e.g. "Pre-Design + CEIG + IFP + PVsyst"
  if (selectedScopeName.includes('+')) {
    const rawParts = selectedScopeName.split('+').map(p => p.trim()).filter(Boolean);
    return rawParts.map(p => ({
      key: toScopeKey(p),
      label: p
    }));
  }

  // 3. Parse '&' separator, e.g. "Pre-Design & CEIG"
  if (selectedScopeName.includes('&')) {
    const rawParts = selectedScopeName.split('&').map(p => p.trim()).filter(Boolean);
    return rawParts.map(p => ({
      key: toScopeKey(p),
      label: p
    }));
  }

  // 4. Parse comma if it's a list, e.g. "Pre-Design, CEIG, IFP"
  if (selectedScopeName.includes(',') && !selectedScopeName.includes('(')) {
    const rawParts = selectedScopeName.split(',').map(p => p.trim()).filter(Boolean);
    return rawParts.map(p => ({
      key: toScopeKey(p),
      label: p
    }));
  }

  // Single scope
  return [{
    key: toScopeKey(selectedScopeName),
    label: selectedScopeName.trim()
  }];
}

export interface DesignerPerson {
  id: string;
  uid: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  role: string;
  employeeId: string;
  displayLabel?: string;
  isOwner?: boolean;
}

/**
 * Recursively cleanses Firestore payloads by removing undefined values
 * and replacing common optional employee/user fields with safe defaults ("" or null),
 * completely preventing FirebaseError: Function setDoc() called with invalid data. Unsupported field value: undefined [RULE 2 / FIRESTORE-SAFE].
 */
export function sanitizeFirestorePayload<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return null as any;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeFirestorePayload(item)) as any;
  }
  if (typeof obj === "object" && !(obj instanceof Date) && !(obj?.toMillis && typeof obj.toMillis === "function")) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) {
        // Fall back safe string for sensitive employee/user fields
        if (["phone", "contactNumber", "mobile", "dateOfJoining", "dob", "bankDetails", "address", "emergencyContact"].includes(key)) {
          cleaned[key] = "";
        } else {
          // Skip undefined property so Firestore never rejects
          continue;
        }
      } else if (value !== null && typeof value === "object") {
        cleaned[key] = sanitizeFirestorePayload(value);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned as T;
  }
  return obj;
}

/**
 * Reconciles or writes an employee user record with universal payload sanitization
 * wrapped in an isolated error boundary so failures on a single document never abort or crash [RULE 2].
 */
export async function safeSyncEmployeeUserDoc(db: any, docId: string, data: any): Promise<boolean> {
  if (!db || !docId) return false;
  try {
    const sanitized = sanitizeFirestorePayload({
      ...data,
      phone: data.phone || data.contactNumber || "",
      updatedAt: new Date().toISOString()
    });
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "users", docId), sanitized, { merge: true });
    return true;
  } catch (err) {
    console.warn(`[SafeUserSync] Isolated sync notice for users/${docId}:`, err);
    return false;
  }
}

/**
 * Dual Role Inclusion:
 * Queries active staff where role or designation includes 'DESIGNER', 'LEAD_DESIGNER', or 'OWNER' (case-insensitive).
 * Dedicated designers are displayed as `Name (Designer)` and company partners as `Name (Partner / Designer)`.
 * Binds designer's work email (@solarithmdesign.com) and Employee ID [RULE 3 / DESIGNER-01].
 */
export function filterAndDeduplicateDesigners(empDocs: any[], userDocs: any[] = []): DesignerPerson[] {
  const allDocs = [...(empDocs || []), ...(userDocs || [])];

  const normalizeName = (name: string) => (name || "").toLowerCase().replace(/[^a-z]/g, "");

  const rawList = allDocs.map(doc => {
    const d = typeof doc?.data === "function" ? doc.data() : (doc || {});
    const docId = doc?.id || d?.id || d?.uid || "";
    const canonicalUid = d?.uid || doc?.id || d?.id || "";
    
    // Resolve email preferring @solarithmdesign.com
    const primaryEmail = (d.email || "").trim().toLowerCase();
    const personalEmail = (d.personalEmail || d.personalEmailAddress || "").trim().toLowerCase();
    const workEmail = primaryEmail.includes("@solarithmdesign.com")
      ? primaryEmail
      : (personalEmail.includes("@solarithmdesign.com") ? personalEmail : primaryEmail);

    const empId = (d.employeeId || d.empId || "").trim().toUpperCase();

    return {
      id: docId,
      uid: canonicalUid,
      name: d.name || d.displayName || d.employeeName || d.fullName || primaryEmail.split('@')[0] || "Unnamed Employee",
      email: workEmail || primaryEmail,
      primaryEmail,
      personalEmail,
      department: (d.department || "").trim(),
      designation: (d.designation || "").trim(),
      role: (d.role || d.assignedRole || "").trim(),
      employeeId: empId || (docId ? `EMP-${docId.slice(0, 6).toUpperCase()}` : "")
    };
  }).filter(u => Boolean(u.email));

  // 1. Dual Role Inclusion:
  // Match staff where role or designation includes 'DESIGNER', 'LEAD_DESIGNER', or 'OWNER' (case-insensitive)
  const designCandidates = rawList.filter(u => {
    const dept = u.department.toLowerCase();
    const role = u.role.toLowerCase();
    const desig = u.designation.toLowerCase();

    const isOwnerOrPartner = (
      role.includes("owner") ||
      desig.includes("owner") ||
      role.includes("partner") ||
      desig.includes("partner") ||
      role.includes("director") ||
      desig.includes("director") ||
      role.includes("founder") ||
      desig.includes("founder")
    );

    const isDesignerRole = (
      role.includes("designer") ||
      desig.includes("designer") ||
      role.includes("lead_designer") ||
      desig.includes("lead_designer") ||
      role.includes("lead designer") ||
      desig.includes("lead designer") ||
      role === "designer" ||
      desig === "designer" ||
      role === "lead_designer" ||
      dept === "design" ||
      dept.includes("design") ||
      dept.includes("engineering") ||
      role.includes("engineering") ||
      desig.includes("engineering") ||
      role.includes("engineer") ||
      desig.includes("engineer") ||
      dept.includes("technical") ||
      role === "employee"
    );

    return isOwnerOrPartner || isDesignerRole;
  });

  // 2. Deduplicate User Records & format display labels:
  // Match by official workspace email (@solarithmdesign.com) and deduplicate by employee ID or normalized name so each team member appears exactly once.
  const deduplicated: Array<any> = [];

  for (const candidate of designCandidates) {
    const candNormName = normalizeName(candidate.name);
    const candEmpId = candidate.employeeId;
    const candEmail = candidate.email;
    const candPersonal = candidate.personalEmail;

    const existingIndex = deduplicated.findIndex(item => {
      if (candEmpId && item.employeeId && candEmpId === item.employeeId) return true;
      if (candEmail && (item.email === candEmail || item.personalEmail === candEmail)) return true;
      if (candPersonal && (item.email === candPersonal || item.personalEmail === candPersonal)) return true;
      if (candNormName && item.normName && candNormName === item.normName) return true;
      return false;
    });

    const isWorkspace = candEmail.includes("@solarithmdesign.com");

    const roleLower = candidate.role.toLowerCase();
    const desigLower = candidate.designation.toLowerCase();
    const isOwner = (
      roleLower.includes("owner") ||
      desigLower.includes("owner") ||
      roleLower.includes("partner") ||
      desigLower.includes("partner") ||
      roleLower.includes("director") ||
      desigLower.includes("director") ||
      roleLower.includes("founder") ||
      desigLower.includes("founder")
    );

    const displayLabel = isOwner
      ? `${candidate.name} (Partner / Designer)`
      : `${candidate.name} (Designer)`;

    const candidateObj = {
      ...candidate,
      normName: candNormName,
      isWorkspace,
      isOwner,
      displayLabel
    };

    if (existingIndex === -1) {
      deduplicated.push(candidateObj);
    } else {
      const existing = deduplicated[existingIndex];
      const existingIsWorkspace = existing.email.includes("@solarithmdesign.com");
      if (!existingIsWorkspace && isWorkspace) {
        deduplicated[existingIndex] = {
          ...candidateObj,
          normName: candNormName || existing.normName,
          employeeId: candidate.employeeId || existing.employeeId,
          isWorkspace: true
        };
      } else {
        // Merge attributes prioritizing @solarithmdesign.com and non-empty employeeId
        deduplicated[existingIndex] = {
          ...existing,
          employeeId: existing.employeeId || candidate.employeeId,
          email: existingIsWorkspace ? existing.email : (isWorkspace ? candidate.email : existing.email),
          isOwner: existing.isOwner || isOwner,
          displayLabel: (existing.isOwner || isOwner)
            ? `${existing.name || candidate.name} (Partner / Designer)`
            : `${existing.name || candidate.name} (Designer)`
        };
      }
    }
  }

  // Fallback if no specific design candidates found
  const finalPool = deduplicated.length > 0 ? deduplicated : rawList.map(c => ({
    ...c,
    displayLabel: `${c.name} (Designer)`,
    isOwner: false
  }));

  // Sort alphabetically by name for clean presentation
  finalPool.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return finalPool.map(d => ({
    id: d.id,
    uid: d.uid || d.id,
    name: d.name,
    email: d.email,
    department: d.department,
    designation: d.designation,
    role: d.role,
    employeeId: d.employeeId,
    displayLabel: d.displayLabel || (d.isOwner ? `${d.name} (Partner / Designer)` : `${d.name} (Designer)`),
    isOwner: Boolean(d.isOwner)
  }));
}

/**
 * Decoupled Directory Fetcher:
 * Reads /employees and /users safely without failing if background writes fail.
 * Directory fetching is strictly read-only without side-effect mutations [DATA-03].
 */
export async function fetchEmployees(db: any): Promise<DesignerPerson[]> {
  if (!db) return [];
  try {
    const { collection, getDocs } = await import("firebase/firestore");
    const [empResult, userResult] = await Promise.allSettled([
      getDocs(collection(db, "employees")),
      getDocs(collection(db, "users"))
    ]);

    const empDocs = empResult.status === "fulfilled" ? empResult.value.docs : [];
    const userDocs = userResult.status === "fulfilled" ? userResult.value.docs : [];

    if (empResult.status === "rejected") {
      console.warn("Notice: /employees directory fetch rejected, continuing with /users:", empResult.reason);
    }
    if (userResult.status === "rejected") {
      console.warn("Notice: /users directory fetch rejected, continuing with /employees:", userResult.reason);
    }

    return filterAndDeduplicateDesigners(empDocs, userDocs);
  } catch (err) {
    console.error("Error in fetchEmployees:", err);
    return [];
  }
}

/**
 * Safely extracts epoch milliseconds from any date representation:
 * - Firestore Timestamp with .toMillis()
 * - Objects with { seconds, nanoseconds }
 * - JavaScript Date instance with .getTime()
 * - ISO string or any plain date string parsed via new Date(value).getTime()
 * - Epoch number in milliseconds or seconds
 * - Missing, null, or invalid values safely fall back to 0.
 */
export function getSafeTimestampMillis(value: any): number {
  if (value == null) return 0;

  try {
    // 1. If value is a Firestore Timestamp with a .toMillis function, use .toMillis()
    if (typeof value.toMillis === "function") {
      const millis = value.toMillis();
      return typeof millis === "number" && !isNaN(millis) ? millis : 0;
    }

    // 2. If it has seconds and nanoseconds properties, calculate epoch milliseconds from seconds
    if (typeof value.seconds === "number" && !isNaN(value.seconds)) {
      const seconds = value.seconds;
      const nanos = typeof value.nanoseconds === "number" && !isNaN(value.nanoseconds) ? value.nanoseconds : 0;
      return seconds * 1000 + Math.floor(nanos / 1000000);
    }

    // 3. If it is a Javascript Date instance, use .getTime()
    if (value instanceof Date) {
      const time = value.getTime();
      return isNaN(time) ? 0 : time;
    }

    // 4. If it has a .toDate function (e.g. some Firestore Timestamp wrappers)
    if (typeof value.toDate === "function") {
      const d = value.toDate();
      if (d instanceof Date) {
        const time = d.getTime();
        return isNaN(time) ? 0 : time;
      }
    }

    // 5. If it is an ISO string or any plain date string, parse it using new Date(value).getTime()
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      // Handle DD-MM-YYYY or DD/MM/YYYY formats
      const ddmmyyyy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (ddmmyyyy) {
        const d = parseInt(ddmmyyyy[1], 10);
        const m = parseInt(ddmmyyyy[2], 10) - 1;
        const y = parseInt(ddmmyyyy[3], 10);
        const dt = new Date(y, m, d).getTime();
        if (!isNaN(dt)) return dt;
      }
      const parsed = new Date(trimmed).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }

    // 6. If it is already a number
    if (typeof value === "number" && !isNaN(value)) {
      if (value > 0 && value < 10000000000) {
        return value * 1000;
      }
      return value;
    }
  } catch (err) {
    console.warn("Failed to extract safe timestamp millis:", err);
  }

  // Fallback to 0 if missing, null, or invalid
  return 0;
}

/**
 * Safely extracts epoch milliseconds for project sorting,
 * strictly evaluating project dates in priority:
 * 1. projectDate
 * 2. date
 * 3. createdAt
 * 4. updatedAt
 */
export function getProjectTimestampMillis(project: any): number {
  if (!project) return 0;
  // Priority 1: projectDate
  if (project.projectDate) {
    const t = getSafeTimestampMillis(project.projectDate);
    if (t > 0) return t;
  }
  // Priority 2: date
  if (project.date) {
    const t = getSafeTimestampMillis(project.date);
    if (t > 0) return t;
  }
  // Priority 3: createdAt
  if (project.createdAt) {
    const t = getSafeTimestampMillis(project.createdAt);
    if (t > 0) return t;
  }
  // Priority 4: updatedAt
  if (project.updatedAt) {
    const t = getSafeTimestampMillis(project.updatedAt);
    if (t > 0) return t;
  }
  return 0;
}

/**
 * Safely formats any date-like value to the given pattern (defaults to 'yyyy-MM-dd').
 */
export function formatSafeDate(value: any, formatPattern: string = "yyyy-MM-dd", fallback: string = "-"): string {
  if (value == null) return fallback;

  if (typeof value === "string" && formatPattern === "yyyy-MM-dd" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const millis = getSafeTimestampMillis(value);
  if (millis <= 0) return fallback;

  try {
    const d = new Date(millis);
    if (isNaN(d.getTime())) return fallback;
    return format(d, formatPattern);
  } catch {
    return fallback;
  }
}

/**
 * Safely determines the display date string for a project row in tables,
 * prioritizing projectDate, date, createdAt, updatedAt.
 */
export function getProjectDisplayDate(project: any): string {
  if (!project) return "-";
  if (project.projectDate && typeof project.projectDate === "string" && project.projectDate.trim()) {
    return project.projectDate.trim();
  }
  if (project.date && typeof project.date === "string" && project.date.trim()) {
    return project.date.trim();
  }
  if (project.createdAt) {
    const formatted = formatSafeDate(project.createdAt, "yyyy-MM-dd");
    if (formatted !== "-") return formatted;
  }
  if (project.updatedAt) {
    const formatted = formatSafeDate(project.updatedAt, "yyyy-MM-dd");
    if (formatted !== "-") return formatted;
  }
  return "-";
}

/**
 * Normalizes scope strings for case-insensitive and punctuation-insensitive deduplication [ENG-SCOPE-01].
 * Treats variations like "PRE DESIGN", "PRE-DESIGN", "pre design", "Pre_Design" as identical.
 * Also normalizes compound package variations like "PRE DESIGN + PVSYST" and "PRE-DESIGN + PVsyst".
 */
export function normalizeScopeDeduplicationKey(scopeStr: string): string {
  if (!scopeStr) return "";
  return scopeStr
    .toLowerCase()
    .trim()
    .replace(/&/g, "+")
    .replace(/[^a-z0-9+]/g, "");
}

/**
 * Validates if a scope record is active and visible in the Admin Console master taxonomy.
 */
export function isScopeVisibleInAdmin(item: any): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.active === false || item.isActive === false) return false;
  if (item.visible === false || item.isVisible === false) return false;
  if (item.enabled === false) return false;
  if (item.deleted === true || item.isDeleted === true) return false;
  const status = String(item.status || "").toLowerCase().trim();
  if (status === "inactive" || status === "archived" || status === "deleted" || status === "disabled") {
    return false;
  }
  return true;
}


