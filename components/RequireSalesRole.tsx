"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function checkSalesAuthorization(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem("solarithm_commerce_session");
    if (!raw) return false;
    const session = JSON.parse(raw);
    const role = String(session?.role || "").toLowerCase();
    return Boolean(session?.authenticated && ["sales", "admin", "owner", "superadmin"].includes(role));
  } catch {
    return false;
  }
}

export function RequireSalesRole({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized] = useState<boolean>(() => checkSalesAuthorization());

  useEffect(() => {
    if (!authorized) {
      router.replace("/");
    }
  }, [authorized, router]);

  if (!authorized) {
    return null;
  }
  return <>{children}</>;
}

export default RequireSalesRole;
