"use client";

import { CaseStoreProvider } from "@/state/CaseStore";

export function Providers({ children }: { children: React.ReactNode }) {
  return <CaseStoreProvider>{children}</CaseStoreProvider>;
}
