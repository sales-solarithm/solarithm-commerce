"use client";

import React from "react";

interface RequireSalesRoleProps {
  children: React.ReactNode;
}

export function RequireSalesRole({ children }: RequireSalesRoleProps) {
  return <>{children}</>;
}

