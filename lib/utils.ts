import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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

