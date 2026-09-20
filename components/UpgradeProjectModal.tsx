"use client";

import { useState, useMemo, useCallback } from "react";
import { doc, updateDoc, serverTimestamp, collection, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS, PROJECT_FIELDS, PROJECT_STATUS } from "@/src/config/schema";
import { toScopeKey, parsePackageScopes, type ScopeItem } from "@/lib/utils";
import confetti from "canvas-confetti";
import {
  X,
  Sparkles,
  Layers,
  Lock,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Building2,
  MapPin,
  Zap,
  UserCheck,
  ShieldCheck
} from "lucide-react";

interface UpgradeProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: any;
  lockedEmail: string | null;
  designers: any[];
  scopesData: any[];
  onSuccess: (msg: string) => void;
}

export default function UpgradeProjectModal({
  isOpen,
  onClose,
  project,
  lockedEmail,
  designers,
  scopesData,
  onSuccess
}: UpgradeProjectModalProps) {
  // Format scope key back to a user-friendly label
  const getScopeLabel = useCallback((keyOrName: string): string => {
    const lower = keyOrName.toLowerCase();
    if (lower === "predesign" || lower === "pre-design") return "Pre-Design";
    if (lower === "pvsyst" || lower === "pv-syst") return "PVsyst";
    if (lower === "ceig") return "CEIG";
    if (lower === "ifp") return "IFP";
    if (lower === "detailedengineering" || lower === "detailed engineering") return "Detailed Engineering";
    
    // Check scopesData
    const found = scopesData.find(s => toScopeKey(s.name) === keyOrName || s.name === keyOrName);
    if (found) return found.name;
    return keyOrName;
  }, [scopesData]);

  // Derive historical scopes already existing on this project
  const historicalScopes = useMemo((): Array<{ key: string; label: string; designerEmail: string; designerName: string }> => {
    if (!project) return [];

    const result: Array<{ key: string; label: string; designerEmail: string; designerName: string }> = [];

    if (project.assignedScopes && typeof project.assignedScopes === "object" && Object.keys(project.assignedScopes).length > 0) {
      for (const [key, email] of Object.entries(project.assignedScopes)) {
        const dEmail = String(email || "");
        const dObj = designers.find(d => d.email === dEmail);
        result.push({
          key,
          label: getScopeLabel(key),
          designerEmail: dEmail,
          designerName: dObj?.name || (dEmail ? dEmail.split("@")[0] : "Assigned Designer")
        });
      }
      return result;
    }

    // Fallback for legacy projects without assignedScopes map
    if (project.scopeOfWork) {
      const parsed = parsePackageScopes(project.scopeOfWork);
      const fallbackEmail = project.designerEmail || "";
      const dObj = designers.find(d => d.email === fallbackEmail);
      parsed.forEach(p => {
        result.push({
          key: p.key,
          label: p.label,
          designerEmail: fallbackEmail,
          designerName: dObj?.name || project.designerName || (fallbackEmail ? fallbackEmail.split("@")[0] : "Assigned Designer")
        });
      });
      return result;
    }

    return [];
  }, [project, designers, getScopeLabel]);

  // Set of keys already present in the project
  const historicalScopeKeys = useMemo(() => {
    return new Set(historicalScopes.map(s => s.key));
  }, [historicalScopes]);

  // Available new scopes that can be appended strictly from Firestore
  const availableCandidateScopes = useMemo(() => {
    const dbScopeNames = scopesData.map(s => s.name || s.packageName).filter(Boolean) as string[];
    const combined = Array.from(new Set(dbScopeNames)).sort((a, b) => a.localeCompare(b));
    
    // Filter out scopes that are already assigned historically
    return combined.filter(scopeName => {
      const key = toScopeKey(scopeName);
      return !historicalScopeKeys.has(key);
    });
  }, [scopesData, historicalScopeKeys]);

  // State for newly added scopes to append: Array of { key, label, designerEmail }
  const [newlySelectedScopes, setNewlySelectedScopes] = useState<
    Array<{ key: string; label: string; designerEmail: string }>
  >([]);
  const [selectedDropdownScope, setSelectedDropdownScope] = useState<string>("");
  const [upgradeNotes, setUpgradeNotes] = useState<string>("");
  const [revisedCapacity, setRevisedCapacity] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen || !project) return null;

  const handleAddScope = (scopeName: string) => {
    if (!scopeName) return;
    const key = toScopeKey(scopeName);
    
    // Ensure not already added
    if (historicalScopeKeys.has(key) || newlySelectedScopes.some(s => s.key === key)) {
      return;
    }

    setNewlySelectedScopes(prev => [
      ...prev,
      {
        key,
        label: scopeName,
        designerEmail: ""
      }
    ]);
    setSelectedDropdownScope("");
    setErrorMsg("");
  };

  const handleRemoveNewScope = (keyToRemove: string) => {
    setNewlySelectedScopes(prev => prev.filter(s => s.key !== keyToRemove));
  };

  const handleDesignerChange = (key: string, designerEmail: string) => {
    setNewlySelectedScopes(prev =>
      prev.map(s => (s.key === key ? { ...s, designerEmail } : s))
    );
    setErrorMsg("");
  };

  const handleQuickAssignAll = (designerEmail: string) => {
    if (!designerEmail) return;
    setNewlySelectedScopes(prev =>
      prev.map(s => ({ ...s, designerEmail }))
    );
    setErrorMsg("");
  };

  const handleSaveUpgrade = async () => {
    if (newlySelectedScopes.length === 0) {
      setErrorMsg("Please select at least one new scope to append.");
      return;
    }

    // Verify all new scopes have designers
    const unassigned = newlySelectedScopes.filter(s => !s.designerEmail || !s.designerEmail.trim());
    if (unassigned.length > 0) {
      setErrorMsg(`Please assign a designer for all new scopes (${unassigned.map(u => u.label).join(", ")}).`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const projectRef = doc(db, COLLECTIONS.PROJECTS, project.id);

      // CRITICAL DATABASE RULE:
      // When saving the upgrade, the new scopes must be APPENDED to the existing assignedScopes object in Firestore
      // using a merge update via dot notation (e.g., { 'assignedScopes.pvsyst': 'newDesigner@email.com' }).
      // It must never overwrite or delete the historical scopes and their assigned designers.
      const updatePayload: Record<string, any> = {
        [PROJECT_FIELDS.UPDATED_AT]: serverTimestamp()
      };

      const auditAssignedMap: Record<string, string> = {};

      newlySelectedScopes.forEach(s => {
        updatePayload[`${PROJECT_FIELDS.ASSIGNED_SCOPES}.${s.key}`] = s.designerEmail;
        auditAssignedMap[s.key] = s.designerEmail;
      });

      // Update scopeOfWork combined title
      const newScopeLabels = newlySelectedScopes.map(s => s.label);
      const existingScopeTitle = project.scopeOfWork || project[PROJECT_FIELDS.SCOPE_OF_WORK] || "";
      const updatedScopeOfWork = existingScopeTitle
        ? `${existingScopeTitle} + ${newScopeLabels.join(" + ")}`
        : newScopeLabels.join(" + ");
      updatePayload[PROJECT_FIELDS.SCOPE_OF_WORK] = updatedScopeOfWork;

      // Append new module phases to project.modules
      const existingModules = Array.isArray(project.modules) ? project.modules : [];
      const newModules = newlySelectedScopes.map(s => {
        const dObj = designers.find(d => d.email === s.designerEmail);
        return {
          phaseKey: s.key,
          phaseName: s.label,
          status: PROJECT_STATUS.NOT_STARTED,
          assignedDesignerEmail: s.designerEmail,
          assignedDesignerName: dObj?.name || s.designerEmail.split("@")[0],
          startedAt: null,
          completedAt: null
        };
      });

      updatePayload[PROJECT_FIELDS.MODULES] = [...existingModules, ...newModules];

      // Optional remarks / capacity updates
      if (upgradeNotes.trim()) {
        const existingRemarks = project.remarks || "";
        updatePayload.remarks = existingRemarks
          ? `${existingRemarks} | Scope Upgrade: ${upgradeNotes.trim()}`
          : `Scope Upgrade: ${upgradeNotes.trim()}`;
      }

      if (revisedCapacity && !isNaN(Number(revisedCapacity)) && Number(revisedCapacity) > 0) {
        updatePayload[PROJECT_FIELDS.PLANT_CAPACITY] = Number(revisedCapacity);
      }

      await updateDoc(projectRef, updatePayload);

      // Audit Log per Master Blueprint
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
          action: "PROJECT_SCOPE_UPGRADED",
          actor: lockedEmail,
          target: project.projectName || project.id,
          details: {
            projectId: project.id,
            projectNumber: project.projectNumber || project.srNumber || "",
            appendedScopes: auditAssignedMap,
            previousScopeCount: historicalScopes.length,
            newTotalScopes: historicalScopes.length + newlySelectedScopes.length,
            updatedScopeOfWork,
            timestamp: serverTimestamp()
          },
          timestamp: serverTimestamp()
        });
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#D4AF37", "#1A1A1A", "#FFFFFF", "#E5C158"]
      });

      onSuccess(`Project "${project.projectName}" successfully upgraded with ${newlySelectedScopes.length} new scope(s)!`);
      onClose();
    } catch (err: any) {
      console.error("Failed to upgrade project scope:", err);
      setErrorMsg(err.message || "Failed to upgrade project. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#181818] text-white rounded-2xl shadow-2xl border border-[#3A3A3A] overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[#2A2A2A] bg-[#1E1E1E] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2A2A2A] border border-amber-500/30 flex items-center justify-center text-[#D4AF37]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
                  Upgrade Project Scopes
                </h2>
                <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-amber-500/20 text-[#D4AF37] border border-amber-500/30">
                  {project.projectNumber || project.srNumber || "PROJECT"}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Split-Scope Architecture: Append new deliverables while preserving historical assignments
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-[#2A2A2A]"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 bg-[#141414]">
          {errorMsg && (
            <div className="p-3.5 bg-rose-500/10 text-rose-400 rounded-xl flex items-start gap-2.5 border border-rose-500/30 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}

          {/* Project Snapshot Card */}
          <div className="p-4 rounded-xl bg-[#1C1C1C] border border-[#2D2D2D] grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <div className="truncate">
                <span className="text-xs text-gray-400 block">Project / Client</span>
                <span className="font-semibold text-white truncate block">{project.projectName}</span>
                <span className="text-xs text-gray-300">Client: {project.clientName}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <div className="truncate">
                <span className="text-xs text-gray-400 block">Client Site Location</span>
                <span className="font-semibold text-white truncate block">{project.location || "N/A"}</span>
                {project.plantCapacity && (
                  <span className="text-xs text-amber-400/90 font-mono">
                    {project.plantCapacity} {project.capacityUnit || "KW"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 1. Historical Scopes Section (Immutable & Preserved) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm sm:text-base font-bold text-gray-200">
                  Historical Scopes ({historicalScopes.length})
                </h3>
              </div>
              <span className="text-xs text-emerald-400/90 font-medium flex items-center gap-1">
                <Lock className="w-3 h-3" /> Preserved & Immutable
              </span>
            </div>

            {historicalScopes.length === 0 ? (
              <div className="p-3 text-xs text-gray-500 bg-[#1C1C1C] rounded-lg border border-[#2A2A2A] italic">
                No prior split scopes registered. Initial scope: {project.scopeOfWork || "Standard"}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {historicalScopes.map(scope => (
                  <div
                    key={scope.key}
                    className="p-3 rounded-xl bg-[#1C1C1C] border border-[#2D2D2D] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                        <span className="font-semibold text-sm text-gray-200 truncate">{scope.label}</span>
                        <span className="text-[10px] font-mono text-gray-400">({scope.key})</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1 truncate">
                        <UserCheck className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="truncate">{scope.designerName} ({scope.designerEmail})</span>
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                      Active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Add New Scopes Section (Split-Scope Architecture) */}
          <div className="space-y-3 pt-3 border-t border-[#262626]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#D4AF37]" />
                  <h3 className="text-sm sm:text-base font-bold text-[#D4AF37]">
                    Append New Scopes to Project
                  </h3>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Select new engineering scopes to add and designate a designer for each phase.
                </p>
              </div>

              {newlySelectedScopes.length > 1 && designers.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0 bg-[#202020] px-2.5 py-1 rounded-lg border border-[#333333]">
                  <span className="text-[11px] font-medium text-gray-400">Quick Assign All:</span>
                  <select
                    defaultValue=""
                    onChange={(e) => handleQuickAssignAll(e.target.value)}
                    className="text-xs py-0.5 px-1.5 rounded bg-[#181818] border border-[#3A3A3A] text-white focus:ring-1 focus:ring-[#D4AF37] outline-none"
                  >
                    <option value="" disabled>Choose</option>
                    {designers.map(d => (
                      <option key={d.id} value={d.email}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Scope Selection Controls */}
            {availableCandidateScopes.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-semibold text-gray-400 mr-1">Quick Add:</span>
                  {availableCandidateScopes.map(candidate => {
                    const candidateKey = toScopeKey(candidate);
                    const isSelected = newlySelectedScopes.some(s => s.key === candidateKey);
                    return (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            handleRemoveNewScope(candidateKey);
                          } else {
                            handleAddScope(candidate);
                          }
                        }}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
                          isSelected
                            ? "bg-amber-500/20 text-[#D4AF37] border-amber-500/50 shadow-xs"
                            : "bg-[#202020] text-gray-300 border-[#333333] hover:border-amber-500/40 hover:text-white"
                        }`}
                      >
                        {isSelected ? <CheckCircle2 className="w-3.5 h-3.5 text-[#D4AF37]" /> : <Plus className="w-3.5 h-3.5" />}
                        <span>{candidate}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Dropdown fallback for custom or long lists */}
                <div className="flex items-center gap-2 mt-2">
                  <select
                    value={selectedDropdownScope}
                    onChange={(e) => {
                      setSelectedDropdownScope(e.target.value);
                      if (e.target.value) handleAddScope(e.target.value);
                    }}
                    className="flex-1 p-2 text-xs rounded-lg bg-[#202020] border border-[#333333] text-gray-200 outline-none focus:ring-1 focus:ring-[#D4AF37]"
                  >
                    <option value="">+ Choose another scope from registry...</option>
                    {availableCandidateScopes.map(s => (
                      <option key={s} value={s} disabled={newlySelectedScopes.some(n => n.key === toScopeKey(s))}>
                        {s} {newlySelectedScopes.some(n => n.key === toScopeKey(s)) ? "(Already Selected)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[#202020] border border-[#333333] text-xs text-amber-400/90 text-center font-medium">
                All available scopes from the registry are already assigned to this project.
              </div>
            )}

            {/* List of New Scopes with Designer Dropdowns */}
            {newlySelectedScopes.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-500/90">
                  New Scope Assignments ({newlySelectedScopes.length}):
                </div>

                <div className="space-y-2.5">
                  {newlySelectedScopes.map(item => (
                    <div
                      key={item.key}
                      className="p-3.5 rounded-xl bg-[#202020] border border-amber-500/30 shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#D4AF37] animate-pulse"></span>
                          <span className="text-sm font-bold text-white">{item.label} Scope</span>
                          <span className="text-[11px] font-mono text-gray-400">key: {item.key}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveNewScope(item.key)}
                          className="text-gray-400 hover:text-rose-400 p-1 rounded transition-colors"
                          title="Remove scope"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-300 block">
                          Assigned Designer for {item.label} *
                        </label>
                        <select
                          value={item.designerEmail}
                          onChange={(e) => handleDesignerChange(item.key, e.target.value)}
                          className={`w-full p-2 rounded-lg text-sm bg-[#161616] border ${
                            !item.designerEmail ? "border-amber-500/60" : "border-[#3A3A3A]"
                          } text-white focus:ring-1 focus:ring-[#D4AF37] outline-none`}
                        >
                          <option value="">Select designer for {item.label}</option>
                          {designers.map(d => (
                            <option key={d.id} value={d.email}>
                              {d.name} ({d.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 3. Optional Project Capacity Revision & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[#262626]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[#D4AF37]" />
                Revised Plant Capacity (Optional)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder={project.plantCapacity ? `Current: ${project.plantCapacity} KW` : "e.g. 100"}
                value={revisedCapacity}
                onChange={(e) => setRevisedCapacity(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-[#202020] border border-[#333333] text-white text-sm outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-300 block">
                Upgrade Remarks / Scope Reason (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Added PVsyst simulation for client"
                value={upgradeNotes}
                onChange={(e) => setUpgradeNotes(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-[#202020] border border-[#333333] text-white text-sm outline-none focus:ring-1 focus:ring-[#D4AF37]"
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-4 bg-[#1E1E1E] border-t border-[#2A2A2A] flex flex-col-reverse sm:flex-row justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-300 bg-[#262626] border border-[#3A3A3A] rounded-lg hover:bg-[#303030] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveUpgrade}
            disabled={isSubmitting || newlySelectedScopes.length === 0}
            className="w-full sm:w-auto px-5 py-2 text-sm font-bold text-black bg-[#D4AF37] hover:bg-[#c59f2e] active:scale-[0.98] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Appending Scopes in Firestore...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Save Scope Upgrade ({newlySelectedScopes.length} New)</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
