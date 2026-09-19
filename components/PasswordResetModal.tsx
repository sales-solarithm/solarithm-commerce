"use client";

import { useState } from "react";
import { collection, addDoc, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS, APPROVAL_TYPES, APPROVAL_STATUS } from "@/src/config/schema";
import { Loader2, KeyRound, CheckCircle2, AlertCircle, X, ShieldAlert } from "lucide-react";

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
}

export default function PasswordResetModal({ isOpen, onClose, initialEmail = "" }: PasswordResetModalProps) {
  const [email, setEmail] = useState(initialEmail);
  const [employeeName, setEmployeeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setStatusMessage({ type: "error", text: "Please provide a valid company email address." });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      // Check if there is already a pending approval for this email
      const approvalsRef = collection(db, COLLECTIONS.APPROVALS);
      const existingQuery = query(
        approvalsRef,
        where("type", "==", APPROVAL_TYPES.PASSWORD_RESET_REQUEST),
        where("requestedEmail", "==", normalizedEmail)
      );
      
      const existingSnap = await getDocs(existingQuery);
      const hasPending = existingSnap.docs.some(doc => {
        const d = doc.data();
        const s = String(d.status || "").toLowerCase();
        return s === "pending";
      });

      if (hasPending) {
        setStatusMessage({
          type: "info",
          text: "A password reset request for this email is already pending review in the Admin Console."
        });
        setIsSubmitting(false);
        return;
      }

      // Write strictly according to Master Blueprint schema
      const requestPayload = {
        type: APPROVAL_TYPES.PASSWORD_RESET_REQUEST,
        requestedEmail: normalizedEmail,
        email: normalizedEmail,
        appName: "Solarithm Commerce",
        appId: "solarithm-commerce",
        employeeName: employeeName.trim() || "",
        name: employeeName.trim() || "",
        employeeId: employeeId.trim() || "",
        reason: reason.trim() || "Locked out / Password reset requested from Solarithm Commerce",
        status: APPROVAL_STATUS.PENDING,
        timestamp: serverTimestamp(),
        createdAt: new Date().toISOString()
      };

      await addDoc(approvalsRef, requestPayload);

      // Optional telemetry log to auditLogs
      try {
        await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
          action: "PASSWORD_RESET_REQUESTED",
          actor: normalizedEmail,
          target: "approvals",
          details: { appName: "Solarithm Commerce", reason: reason.trim() },
          timestamp: serverTimestamp()
        });
      } catch (logErr) {
        console.warn("Audit log notice:", logErr);
      }

      setStatusMessage({
        type: "success",
        text: "Password reset request dispatched to the Admin Console queue. An administrator will review your request."
      });
    } catch (err: any) {
      console.error("Error submitting password reset request:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to submit request. Please try again or contact your administrator."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="password-reset-modal"
        className="w-full max-w-lg bg-[#1E1E1E] text-white border border-[#333333] rounded-xl shadow-2xl p-6 relative overflow-hidden"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-gray-400 hover:text-white rounded-lg hover:bg-[#2A2A2A] transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[#D4AF37]">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white font-sans">Request Password Reset</h3>
            <p className="text-sm text-gray-400">Dispatches approval ticket directly to Solarithm Admin Console</p>
          </div>
        </div>

        {statusMessage && (
          <div className={`p-4 rounded-lg mb-4 flex items-start gap-3 border ${
            statusMessage.type === "success" 
              ? "bg-green-950/40 border-green-700 text-green-200"
              : statusMessage.type === "info"
              ? "bg-amber-950/40 border-amber-700 text-amber-200"
              : "bg-red-950/40 border-red-700 text-red-200"
          }`}>
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-green-400 mt-0.5" />
            ) : statusMessage.type === "info" ? (
              <ShieldAlert className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
            )}
            <div className="text-sm font-medium">{statusMessage.text}</div>
          </div>
        )}

        {statusMessage?.type === "success" ? (
          <div className="pt-2 flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-[#D4AF37] text-black font-semibold rounded-lg hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Company Work Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@solarithmdesign.com"
                className="w-full p-2.5 rounded-lg border border-[#333333] bg-[#2A2A2A] text-white focus:ring-2 focus:ring-[#D4AF37] outline-none text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Full Name (Optional)
                </label>
                <input
                  type="text"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full p-2.5 rounded-lg border border-[#333333] bg-[#2A2A2A] text-white focus:ring-2 focus:ring-[#D4AF37] outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Employee ID (Optional)
                </label>
                <input
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="e.g. SOL-042"
                  className="w-full p-2.5 rounded-lg border border-[#333333] bg-[#2A2A2A] text-white focus:ring-2 focus:ring-[#D4AF37] outline-none text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Reason / Note
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Account locked or password reset requested"
                className="w-full p-2.5 rounded-lg border border-[#333333] bg-[#2A2A2A] text-white focus:ring-2 focus:ring-[#D4AF37] outline-none text-sm resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-[#2A2A2A] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-[#D4AF37] text-black font-semibold text-sm rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Submit Request</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
