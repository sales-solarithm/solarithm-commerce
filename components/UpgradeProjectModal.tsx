"use client";

import { useState, useMemo, useCallback } from "react";
import { doc, updateDoc, serverTimestamp, collection, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS, PROJECT_FIELDS, PROJECT_STATUS } from "@/src/config/schema";
import { toCanonicalScopeKey, parsePackageScopes, normalizeScopeDeduplicationKey, isScopeVisibleInAdmin, sanitizeFirestorePayload, type ScopeItem } from "@/lib/utils";
import confetti from "canvas-confetti";
import {
  X,
  Sparkles,
  Layers,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Building2,
  MapPin,
  Zap,
  UserCheck,
  ShieldCheck,
  Check,
  Info,
  Users
} from "lucide-react";

interface UpgradeProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: any;
  lockedEmail: string | null;
  designers: any[];
  scopesData: any[];
  initialTargetScope?: string;
  onSuccess: (msg: string) => void;
}

export default function UpgradeProjectModal({
  isOpen,
  onClose,
  project,
  lockedEmail,
  designers,
  scopesData,
  initialTargetScope,
  onSuccess
}: UpgradeProjectModalProps) {
  // Filter designers strictly to members of the Design department or design role and deduplicate
  const designMembers = useMemo(() => {
    const list = (designers || []).filter(d => {
      if (!d || !d.email) return false;
      const dept = (d.department || "").toLowerCase();
      const role = (d.role || "").toLowerCase();
      const desig = (d.designation || "").toLowerCase();
      return (
        dept.includes("design") ||
        role.includes("design") ||
        role === "employee" ||
        role === "designer" ||
        desig.includes("design")
      );
    });

    const seen = new Set<string>();
    const unique: any[] = [];
    for (const m of list) {
      const em = m.email.toLowerCase();
      if (!seen.has(em)) {
        seen.add(em);
        unique.push(m);
      }
    }
    return unique.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [designers]);

  // Format scope key back to a user-friendly label strictly from Firestore master scope list
  const getScopeLabel = useCallback((keyOrName: string): string => {
    if (!keyOrName) return "";
    const canonicalKey = toCanonicalScopeKey(keyOrName);
    const dedupKey = normalizeScopeDeduplicationKey(keyOrName);
    
    // Check scopesData dynamically from Admin Console
    const found = scopesData.find(s => {
      const sName = (s.name || s.packageName || s.title || s.label || "").trim();
      return sName === keyOrName || 
        toCanonicalScopeKey(sName) === canonicalKey || 
        normalizeScopeDeduplicationKey(sName) === dedupKey;
    });
    if (found) {
      return (found.name || found.packageName || found.title || found.label || "").trim();
    }
    return keyOrName;
  }, [scopesData]);

  // Derive historical scopes already existing on this project
  const historicalScopes = useMemo((): Array<{
    key: string;
    label: string;
    designerEmail: string;
    designerName: string;
    status?: string;
  }> => {
    if (!project) return [];

    const result: Array<{
      key: string;
      label: string;
      designerEmail: string;
      designerName: string;
      status?: string;
    }> = [];

    // 1. From assignedScopes map
    if (project.assignedScopes && typeof project.assignedScopes === "object") {
      Object.entries(project.assignedScopes).forEach(([rawKey, emailVal]) => {
        const email = String(emailVal || "").trim();
        if (email) {
          const canonicalKey = toCanonicalScopeKey(rawKey);
          const dObj = designers.find(d => d.email.toLowerCase() === email.toLowerCase());
          result.push({
            key: canonicalKey,
            label: getScopeLabel(canonicalKey),
            designerEmail: email,
            designerName: dObj?.name || email.split("@")[0]
          });
        }
      });
    }

    // 2. From modules array if present
    if (Array.isArray(project.modules) && project.modules.length > 0) {
      project.modules.forEach((mod: any) => {
        const canonicalKey = toCanonicalScopeKey(mod.phaseKey || mod.phaseName || "");
        const email = String(mod.assignedDesignerEmail || "").trim();
        const existingIdx = result.findIndex(r => r.key === canonicalKey);
        if (existingIdx === -1 && canonicalKey) {
          const dObj = designers.find(d => d.email.toLowerCase() === email.toLowerCase());
          result.push({
            key: canonicalKey,
            label: mod.phaseName || getScopeLabel(canonicalKey),
            designerEmail: email,
            designerName: mod.assignedDesignerName || dObj?.name || (email ? email.split("@")[0] : "Unassigned"),
            status: mod.status
          });
        } else if (existingIdx >= 0 && mod.status) {
          result[existingIdx].status = mod.status;
        }
      });
    }

    // 3. Fallback: single scope project
    if (result.length === 0 && project.scopeOfWork) {
      const canonicalKey = toCanonicalScopeKey(project.scopeOfWork);
      const email = String(project.designerEmail || "").trim();
      const dObj = designers.find(d => d.email.toLowerCase() === email.toLowerCase());
      result.push({
        key: canonicalKey,
        label: project.scopeOfWork,
        designerEmail: email,
        designerName: project.designerName || dObj?.name || (email ? email.split("@")[0] : "Unassigned"),
        status: project.status
      });
    }

    return result;
  }, [project, designers, getScopeLabel]);

  // Fast lookup map for historical scopes
  const historicalScopeMap = useMemo(() => {
    const map = new Map<string, typeof historicalScopes[0]>();
    historicalScopes.forEach(s => {
      map.set(toCanonicalScopeKey(s.key), s);
    });
    return map;
  }, [historicalScopes]);

  // Target Package Selection State
  const [selectedTargetPackage, setSelectedTargetPackage] = useState<string>(() => {
    if (initialTargetScope) return initialTargetScope;
    return "";
  });

  // Designer assignments for newly added sub-scopes: { [canonicalScopeKey]: designerEmail }
  const [newlyAssignedDesigners, setNewlyAssignedDesigners] = useState<Record<string, string>>({});
  const [upgradeNotes, setUpgradeNotes] = useState("");
  const [revisedCapacity, setRevisedCapacity] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Available packages from Firestore scopes collection with strict deduplication
  const availablePackages = useMemo(() => {
    const scopeMap = new Map<string, { canonicalLabel: string; order: number }>();
    for (const item of scopesData) {
      if (!isScopeVisibleInAdmin(item)) continue;
      const canonicalLabel = (item.name || item.packageName || item.title || item.label || item.scopeName || "").trim();
      if (!canonicalLabel) continue;

      const dedupKey = normalizeScopeDeduplicationKey(canonicalLabel);
      if (!dedupKey) continue;

      const order = typeof item.order === "number"
        ? item.order
        : typeof item.displayOrder === "number"
          ? item.displayOrder
          : 999999;

      if (!scopeMap.has(dedupKey)) {
        scopeMap.set(dedupKey, { canonicalLabel, order });
      } else {
        const existing = scopeMap.get(dedupKey)!;
        if (order < existing.order) existing.order = order;
        if (canonicalLabel === canonicalLabel.toUpperCase() && existing.canonicalLabel !== existing.canonicalLabel.toUpperCase()) {
          existing.canonicalLabel = canonicalLabel;
        }
      }
    }
    return Array.from(scopeMap.values())
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.canonicalLabel.localeCompare(b.canonicalLabel, undefined, { sensitivity: "base" });
      })
      .map(e => e.canonicalLabel);
  }, [scopesData]);

  // Target Scope Document if matching
  const targetScopeDoc = useMemo(() => {
    if (!selectedTargetPackage) return null;
    return scopesData.find(s => s.name === selectedTargetPackage) || null;
  }, [selectedTargetPackage, scopesData]);

  // Parse the target package into constituent sub-scopes
  const targetSubScopes = useMemo((): ScopeItem[] => {
    if (!selectedTargetPackage) return [];
    return parsePackageScopes(selectedTargetPackage, targetScopeDoc).map(s => ({
      key: toCanonicalScopeKey(s.key),
      label: s.label
    }));
  }, [selectedTargetPackage, targetScopeDoc]);

  // Categorize sub-scopes: preserved vs. brand-new
  const { preservedSubScopes, newSubScopes } = useMemo(() => {
    const preserved: Array<ScopeItem & { designerEmail: string; designerName: string }> = [];
    const added: ScopeItem[] = [];

    targetSubScopes.forEach(sub => {
      const canonicalKey = toCanonicalScopeKey(sub.key);
      const existing = historicalScopeMap.get(canonicalKey);
      if (existing) {
        preserved.push({
          ...sub,
          key: canonicalKey,
          designerEmail: existing.designerEmail,
          designerName: existing.designerName
        });
      } else {
        added.push({
          ...sub,
          key: canonicalKey
        });
      }
    });

    return { preservedSubScopes: preserved, newSubScopes: added };
  }, [targetSubScopes, historicalScopeMap]);

  const handleDesignerChange = (scopeKey: string, designerEmail: string) => {
    const canonicalKey = toCanonicalScopeKey(scopeKey);
    setNewlyAssignedDesigners(prev => ({
      ...prev,
      [canonicalKey]: designerEmail
    }));
    setErrorMsg("");
  };

  const handleQuickAssignAllNew = (designerEmail: string) => {
    if (!designerEmail) return;
    const update: Record<string, string> = { ...newlyAssignedDesigners };
    newSubScopes.forEach(s => {
      update[s.key] = designerEmail;
    });
    setNewlyAssignedDesigners(update);
    setErrorMsg("");
  };

  if (!isOpen || !project) return null;

  const currentProjectScope = String(project.scopeOfWork || "Standard").trim();
  const isSamePackage = selectedTargetPackage && selectedTargetPackage.trim().toLowerCase() === currentProjectScope.toLowerCase();

  const handleSaveUpgrade = async () => {
    if (!selectedTargetPackage) {
      setErrorMsg("Please select a target Scope of Work / Package to upgrade to.");
      return;
    }

    if (newSubScopes.length === 0) {
      setErrorMsg(
        "The selected package does not contain any new sub-scopes beyond what this project already has. Please choose an expanded package."
      );
      return;
    }

    // Verify all new sub-scopes have an assigned designer
    const unassigned = newSubScopes.filter(s => !newlyAssignedDesigners[s.key] || !newlyAssignedDesigners[s.key].trim());
    if (unassigned.length > 0) {
      setErrorMsg(`Please assign a designer for all newly added sub-scopes (${unassigned.map(u => u.label).join(", ")}).`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const projectRef = doc(db, COLLECTIONS.PROJECTS, project.id);

      // [WRK-02 Remediated]: Maintain a single, complete assignedScopes map directly.
      // Do NOT specify both parent 'assignedScopes' and nested 'assignedScopes.key' paths in the same payload.
      const updatedAssignedScopes: Record<string, string> = {
        ...(project.assignedScopes || {})
      };

      // Backfill historical scopes into the map with canonical keys
      historicalScopes.forEach(h => {
        const canonicalKey = toCanonicalScopeKey(h.key);
        if (!updatedAssignedScopes[canonicalKey] && h.designerEmail) {
          updatedAssignedScopes[canonicalKey] = h.designerEmail;
        }
      });

      // Merge new sub-scopes with canonical keys
      newSubScopes.forEach(s => {
        const canonicalKey = toCanonicalScopeKey(s.key);
        updatedAssignedScopes[canonicalKey] = newlyAssignedDesigners[canonicalKey] || newlyAssignedDesigners[s.key];
      });

      // 2. Append new modules while strictly preserving existing modules and their status
      const existingModules: any[] = Array.isArray(project.modules) ? [...project.modules] : [];
      
      // If legacy project had no modules array, synthesize historical modules
      if (existingModules.length === 0 && historicalScopes.length > 0) {
        historicalScopes.forEach(h => {
          existingModules.push({
            phaseKey: toCanonicalScopeKey(h.key),
            phaseName: h.label,
            status: h.status || project.status || "ASSIGNED",
            assignedDesignerEmail: h.designerEmail,
            assignedDesignerName: h.designerName,
            startedAt: null,
            completedAt: null
          });
        });
      }

      const newModules = newSubScopes.map(s => {
        const canonicalKey = toCanonicalScopeKey(s.key);
        const dEmail = newlyAssignedDesigners[canonicalKey] || newlyAssignedDesigners[s.key];
        const dObj = designers.find(d => d.email.toLowerCase() === dEmail.toLowerCase());
        return {
          phaseKey: canonicalKey,
          phaseName: s.label,
          status: "ASSIGNED",
          assignedDesignerEmail: dEmail,
          assignedDesignerName: dObj?.name || dEmail.split("@")[0],
          assignedDesignerId: dObj?.id || dObj?.uid || "",
          assignedDesignerUid: dObj?.uid || dObj?.id || "",
          startedAt: null,
          completedAt: null
        };
      });

      const updatePayload: Record<string, any> = {
        [PROJECT_FIELDS.SCOPE_OF_WORK]: selectedTargetPackage,
        [PROJECT_FIELDS.ASSIGNED_SCOPES]: updatedAssignedScopes,
        [PROJECT_FIELDS.MODULES]: [...existingModules, ...newModules],
        [PROJECT_FIELDS.UPDATED_AT]: serverTimestamp()
      };

      // 3. Optional remarks / capacity updates
      if (upgradeNotes.trim()) {
        const existingRemarks = project.remarks || "";
        updatePayload.remarks = existingRemarks
          ? `${existingRemarks} | Scope Upgrade to ${selectedTargetPackage}: ${upgradeNotes.trim()}`
          : `Scope Upgrade to ${selectedTargetPackage}: ${upgradeNotes.trim()}`;
      }

      if (revisedCapacity !== "" && !isNaN(Number(revisedCapacity)) && Number(revisedCapacity) >= 0) {
        updatePayload[PROJECT_FIELDS.PLANT_CAPACITY] = Number(revisedCapacity);
      }

      await updateDoc(projectRef, sanitizeFirestorePayload(updatePayload));

      // 4. Audit Log
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), sanitizeFirestorePayload({
          action: "PROJECT_SCOPE_UPGRADED",
          actor: lockedEmail || "sales",
          target: project.projectName || project.id,
          details: {
            projectId: project.id,
            projectNumber: project.projectNumber || project.srNumber || "",
            previousScope: currentProjectScope,
            upgradedScope: selectedTargetPackage,
            preservedScopes: preservedSubScopes.map(p => ({ key: p.key, label: p.label, designer: p.designerEmail })),
            newlyAddedScopes: newSubScopes.map(n => ({ key: n.key, label: n.label, designer: newlyAssignedDesigners[n.key] })),
            totalSubScopes: preservedSubScopes.length + newSubScopes.length
          },
          timestamp: serverTimestamp()
        }));
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#D4AF37", "#1A1A1A", "#FFFFFF", "#E5C158"]
      });

      onSuccess(
        `Project "${project.projectName}" successfully upgraded to ${selectedTargetPackage} with ${newSubScopes.length} new sub-scope(s)!`
      );
      onClose();
    } catch (err: any) {
      console.error("Failed to upgrade project scope:", err);
      setErrorMsg(err.message || "Failed to upgrade project. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-[#181818] text-gray-900 dark:text-white rounded-2xl shadow-2xl border border-gray-200 dark:border-[#3A3A3A] overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-gray-200 dark:border-[#2A2A2A] bg-gray-50 dark:bg-[#1E1E1E] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-[#2A2A2A] border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-[#D4AF37]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold font-sans text-gray-900 dark:text-white tracking-wide">
                  Upgrade Scope of Work / Package
                </h2>
                <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-[#D4AF37] border border-amber-300 dark:border-amber-500/30">
                  {project.projectNumber || project.srNumber || "PROJECT"}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Select an expanded package while preserving originally assigned sub-scopes &amp; designers
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2A2A2A]"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1 bg-white dark:bg-[#141414]">
          {errorMsg && (
            <div className="p-3.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl flex items-start gap-2.5 border border-rose-500/30 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}

          {/* Project Snapshot Card */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1C1C1C] border border-gray-200 dark:border-[#2D2D2D] grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-amber-600 dark:text-[#D4AF37] shrink-0" />
              <div className="truncate">
                <span className="text-[11px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider block">Project &amp; Client</span>
                <span className="font-semibold text-gray-900 dark:text-white truncate block">{project.projectName}</span>
                <span className="text-xs text-gray-600 dark:text-gray-300">Client: {project.clientName}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <MapPin className="w-4 h-4 text-amber-600 dark:text-[#D4AF37] shrink-0" />
              <div className="truncate">
                <span className="text-[11px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider block">Site Location &amp; Capacity</span>
                <span className="font-semibold text-gray-900 dark:text-white truncate block">{project.location || "N/A"}</span>
                {(project.plantCapacity !== null && project.plantCapacity !== undefined && project.plantCapacity !== "") && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-mono">
                    {project.plantCapacity} {project.capacityUnit || "KW"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Current Registered Package Badge */}
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2D2D2D] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-400">Current Scope of Work:</span>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-semibold">
                {currentProjectScope}
              </span>
            </div>
            <span className="text-gray-500 font-mono">
              {historicalScopes.length} registered sub-scope(s)
            </span>
          </div>

          {/* 1. Historical Scopes Section (Immutable & Preserved) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                  Original Scope History ({historicalScopes.length})
                </h3>
              </div>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Lock className="w-3 h-3" /> Preserved from Original Entry
              </span>
            </div>

            {historicalScopes.length === 0 ? (
              <div className="p-3 text-xs text-gray-500 bg-gray-50 dark:bg-[#1C1C1C] rounded-lg border border-gray-200 dark:border-[#2A2A2A] italic">
                Initial scope: {currentProjectScope}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {historicalScopes.map(scope => (
                  <div
                    key={scope.key}
                    className="p-3 rounded-xl bg-emerald-50/70 dark:bg-[#191F1A] border border-emerald-500/30 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-semibold text-xs sm:text-sm text-gray-800 dark:text-gray-200 truncate">{scope.label}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1 truncate">
                        <UserCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400/80 shrink-0" />
                        <span className="truncate text-gray-700 dark:text-gray-300">{scope.designerName}</span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">({scope.designerEmail})</span>
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 shrink-0">
                      Active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Upgrade Scope of Work / Package Section */}
          <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-[#262626]">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-600 dark:text-[#D4AF37]" />
                <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-[#D4AF37]">
                  Upgrade Scope of Work / Package
                </h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Select a target package from the registered scope repository. When a combined package is selected, each sub-scope will be deconstructed with individual designer assignments.
              </p>
            </div>

            {/* Target Scope Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block">
                Target Scope of Work / Package *
              </label>
              <select
                value={selectedTargetPackage}
                onChange={(e) => {
                  setSelectedTargetPackage(e.target.value);
                  setNewlyAssignedDesigners({});
                  setErrorMsg("");
                }}
                className="w-full p-2.5 rounded-lg text-sm bg-gray-50 dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#3A3A3A] text-gray-900 dark:text-white focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] outline-none"
              >
                <option value="">-- Select Target Scope or Package --</option>
                {availablePackages.map(pkg => (
                  <option key={pkg} value={pkg}>
                    {pkg} {pkg.toLowerCase() === currentProjectScope.toLowerCase() ? "(Current Package)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {isSamePackage && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  The project is currently registered under <strong>{currentProjectScope}</strong>. Please select an upgraded or broader package to add new engineering deliverables.
                </span>
              </div>
            )}

            {/* Target Package Sub-Scopes Deconstruction (Parity with New Entry Flow) */}
            {selectedTargetPackage && !isSamePackage && targetSubScopes.length > 0 && (
              <div className="space-y-3 pt-2">
                {/* Summary header bar & Quick Assign All button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2D2D2D]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      Component Sub-Scopes ({targetSubScopes.length}):
                    </span>
                    <span className="px-2 py-0.5 text-[11px] rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-medium">
                      {preservedSubScopes.length} Preserved
                    </span>
                    <span className="px-2 py-0.5 text-[11px] rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-medium">
                      {newSubScopes.length} New
                    </span>
                  </div>

                  {newSubScopes.length > 1 && designMembers.length > 0 && (
                    <div className="flex items-center gap-1.5 shrink-0 bg-white dark:bg-[#242424] px-2.5 py-1 rounded-lg border border-gray-200 dark:border-[#383838]">
                      <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Quick Assign All New:</span>
                      <select
                        defaultValue=""
                        onChange={(e) => handleQuickAssignAllNew(e.target.value)}
                        className="text-xs py-0.5 px-1.5 rounded bg-gray-50 dark:bg-[#161616] border border-gray-300 dark:border-[#3A3A3A] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#D4AF37] outline-none"
                      >
                        <option value="" disabled>Choose Designer</option>
                        {designMembers.map(d => (
                          <option key={d.id} value={d.email}>
                            {d.displayLabel || (d.isOwner ? `${d.name} (Partner / Designer)` : `${d.name} (Designer)`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Sub-Scopes Split Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {targetSubScopes.map(sub => {
                    const normalizedKey = toCanonicalScopeKey(sub.key);
                    const historicalMatch = historicalScopeMap.get(normalizedKey) || historicalScopeMap.get(toCanonicalScopeKey(sub.label));

                    // 1. Existing Sub-Scope: Pre-filled with historical designer, locked
                    if (historicalMatch) {
                      return (
                        <div
                          key={sub.key}
                          className="space-y-1.5 p-3.5 rounded-xl bg-emerald-50/60 dark:bg-[#171D18] border border-emerald-500/40 shadow-xs flex flex-col justify-between"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                {sub.label} Scope
                              </span>
                              <span className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-300 dark:border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                                <Lock className="w-2.5 h-2.5" />
                                Locked / Preserved
                              </span>
                            </div>

                            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block">
                              Assigned Designer (Locked)
                            </label>
                            
                            <div className="w-full p-2 rounded-lg border border-emerald-500/30 bg-white dark:bg-[#111712] text-gray-800 dark:text-gray-300 text-xs flex items-center justify-between cursor-not-allowed">
                              <span className="font-medium text-gray-900 dark:text-white truncate">
                                {historicalMatch.designerName} ({historicalMatch.designerEmail})
                              </span>
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-1 shrink-0 ml-1.5">
                                <Lock className="w-2.5 h-2.5" /> Preserved
                              </span>
                            </div>
                          </div>

                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400/80 pt-1 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 shrink-0" />
                            Retained from original entry · No duplicate task created
                          </p>
                        </div>
                      );
                    }

                    // 2. New Sub-Scope: Individual Designer Assignment Dropdown
                    const canonicalKey = toCanonicalScopeKey(sub.key);
                    const assignedEmail = newlyAssignedDesigners[canonicalKey] || newlyAssignedDesigners[sub.key] || "";
                    const isAssigned = Boolean(assignedEmail);

                    return (
                      <div
                        key={sub.key}
                        className={`space-y-1.5 p-3.5 rounded-xl bg-amber-50/50 dark:bg-[#1C1A14] border transition-all flex flex-col justify-between ${
                          isAssigned
                            ? "border-amber-500/50 shadow-sm"
                            : "border-amber-500/80 ring-1 ring-amber-500/30"
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-[#D4AF37] flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-[#D4AF37] shrink-0" />
                              {sub.label} Scope
                            </span>
                            <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                              <Sparkles className="w-2.5 h-2.5" />
                              New Sub-Scope
                            </span>
                          </div>

                          <label className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center justify-between">
                            <span>Assign Designer for {sub.label} *</span>
                            {!isAssigned && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Assignment Required</span>
                            )}
                          </label>

                          <select
                            value={assignedEmail}
                            onChange={(e) => handleDesignerChange(canonicalKey, e.target.value)}
                            className={`w-full p-2 rounded-lg text-xs bg-white dark:bg-[#141414] border ${
                              !isAssigned
                                ? "border-amber-500/70 focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                                : "border-gray-300 dark:border-[#3A3A3A] focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37]"
                            } text-gray-900 dark:text-white outline-none`}
                          >
                            <option value="">Select designer for {sub.label}</option>
                            {designMembers.map(d => (
                              <option key={d.id} value={d.email}>
                                {d.displayLabel || (d.isOwner ? `${d.name} (Partner / Designer)` : `${d.name} (Designer)`)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="pt-1">
                          {isAssigned ? (
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 truncate">
                              <Check className="w-3 h-3 shrink-0" />
                              Assigned to {assignedEmail}
                            </p>
                          ) : (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              <Users className="w-3 h-3 shrink-0 text-gray-400" />
                              Select a designer from Design department
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {newSubScopes.length === 0 && preservedSubScopes.length > 0 && (
                  <div className="p-3 rounded-lg bg-gray-100 dark:bg-[#202020] border border-gray-300 dark:border-[#333333] text-xs text-amber-700 dark:text-amber-400/90 text-center font-medium">
                    All sub-scopes in this package are already registered and preserved. Choose an expanded package with additional deliverables.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Optional Project Capacity Revision & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-200 dark:border-[#262626]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-600 dark:text-[#D4AF37]" />
                Revised Plant Capacity (Optional)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder={(project.plantCapacity !== null && project.plantCapacity !== undefined && project.plantCapacity !== "") ? `Current: ${project.plantCapacity} KW` : "e.g. 100"}
                value={revisedCapacity}
                onChange={(e) => setRevisedCapacity(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-[#202020] border border-gray-300 dark:border-[#333333] text-gray-900 dark:text-white text-sm outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block">
                Upgrade Remarks / Scope Reason (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Upgraded to full package for client request"
                value={upgradeNotes}
                onChange={(e) => setUpgradeNotes(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-[#202020] border border-gray-300 dark:border-[#333333] text-gray-900 dark:text-white text-sm outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-4 bg-gray-50 dark:bg-[#1E1E1E] border-t border-gray-200 dark:border-[#2A2A2A] flex flex-col-reverse sm:flex-row justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-[#262626] border border-gray-300 dark:border-[#3A3A3A] rounded-lg hover:bg-gray-100 dark:hover:bg-[#303030] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveUpgrade}
            disabled={
              isSubmitting ||
              !selectedTargetPackage ||
              isSamePackage ||
              newSubScopes.length === 0 ||
              newSubScopes.some(s => !newlyAssignedDesigners[s.key] || !newlyAssignedDesigners[s.key].trim())
            }
            className="w-full sm:w-auto px-5 py-2 text-sm font-bold text-black bg-[#D4AF37] hover:bg-[#c59f2e] active:scale-[0.98] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Upgrading Scope in Firestore...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>
                  Save Scope Upgrade{" "}
                  {newSubScopes.length > 0 ? `(${newSubScopes.length} New Scopes)` : ""}
                </span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
