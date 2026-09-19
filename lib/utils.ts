import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
