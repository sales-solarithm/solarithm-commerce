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

export function toScopeKey(scopeName: string): string {
  const trimmed = (scopeName || '').trim();
  if (!trimmed) return 'scope';
  
  const lower = trimmed.toLowerCase();
  if (lower === 'pvsyst' || lower === 'pv-syst' || lower === 'pv syst') return 'pvsyst';
  if (lower === 'predesign' || lower === 'pre-design' || lower === 'pre design') return 'preDesign';
  if (lower === 'ceig') return 'ceig';
  if (lower === 'ifp') return 'ifp';
  if (lower === 'detailed engineering' || lower === 'detailed-engineering' || lower === 'detailedengineering') return 'detailedEngineering';

  const cleaned = trimmed.replace(/[^\w\s-]/g, '').trim();
  if (/^[A-Z0-9]+$/.test(cleaned)) {
    return cleaned.toLowerCase();
  }
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return 'scope';
  if (parts.length === 1) return parts[0].toLowerCase();
  return parts[0].toLowerCase() + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
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
  name: string;
  email: string;
  department: string;
  designation: string;
  role: string;
  employeeId: string;
}

export function filterAndDeduplicateDesigners(empDocs: any[], userDocs: any[] = []): DesignerPerson[] {
  const allDocs = [...(empDocs || []), ...(userDocs || [])];

  const normalizeName = (name: string) => (name || "").toLowerCase().replace(/[^a-z]/g, "");

  const rawList = allDocs.map(doc => {
    const d = typeof doc?.data === "function" ? doc.data() : (doc || {});
    const docId = doc?.id || d?.id || "";
    return {
      id: docId,
      name: d.name || d.displayName || d.employeeName || d.email || "Unnamed Employee",
      email: (d.email || "").trim().toLowerCase(),
      personalEmail: (d.personalEmail || d.personalEmailAddress || "").trim().toLowerCase(),
      department: (d.department || "").trim(),
      designation: (d.designation || "").trim(),
      role: (d.role || d.assignedRole || "").trim(),
      employeeId: (d.employeeId || "").trim().toUpperCase()
    };
  }).filter(u => Boolean(u.email));

  // 1. Relax Designer Query / Filtering Logic:
  // Populate the dropdown with any user where:
  // - department.toLowerCase() === 'design' OR includes 'design'
  // - role.toLowerCase().includes('design')
  // - designation.toLowerCase().includes('design')
  const designCandidates = rawList.filter(u => {
    const dept = u.department.toLowerCase();
    const role = u.role.toLowerCase();
    const desig = u.designation.toLowerCase();
    return (
      dept === "design" ||
      dept.includes("design") ||
      role.includes("design") ||
      desig.includes("design")
    );
  });

  // 2. Deduplicate User Records:
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

    if (existingIndex === -1) {
      deduplicated.push({
        ...candidate,
        normName: candNormName,
        isWorkspace
      });
    } else {
      const existing = deduplicated[existingIndex];
      const existingIsWorkspace = existing.email.includes("@solarithmdesign.com");
      if (!existingIsWorkspace && isWorkspace) {
        deduplicated[existingIndex] = {
          ...candidate,
          normName: candNormName || existing.normName,
          isWorkspace: true
        };
      } else if (isWorkspace && !existing.employeeId && candidate.employeeId) {
        deduplicated[existingIndex] = {
          ...existing,
          ...candidate,
          normName: candNormName || existing.normName,
          isWorkspace: true
        };
      }
    }
  }

  // Fallback if no specific design candidates found
  const finalPool = deduplicated.length > 0 ? deduplicated : rawList;

  // Sort by name for clean presentation
  finalPool.sort((a, b) => a.name.localeCompare(b.name));

  return finalPool.map(d => ({
    id: d.id,
    name: d.name,
    email: d.email,
    department: d.department,
    designation: d.designation,
    role: d.role,
    employeeId: d.employeeId
  }));
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


