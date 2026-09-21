"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReviewRecord, ReviewerDecision } from "@/domain/models/detail";

interface CaseStoreValue {
  reviews: Record<string, ReviewRecord>;
  saveReview: (caseId: string, decision: ReviewerDecision, note: string) => void;
  resetDemo: () => void;
}

const CaseStore = createContext<CaseStoreValue | null>(null);
const storageKey = "vericargo-demo-reviews";

export function CaseStoreProvider({ children }: { children: React.ReactNode }) {
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>(() => {
    if (typeof window === "undefined") return {};
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return {};
    try {
      return JSON.parse(saved) as Record<string, ReviewRecord>;
    } catch {
      return {};
    }
  });

  const value = useMemo<CaseStoreValue>(() => ({
    reviews,
    saveReview: (caseId, decision, note) => {
      setReviews((current) => {
        const next = { ...current, [caseId]: { caseId, decision, reviewedAt: new Date().toISOString(), reviewer: "Aina Rahman", note } };
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    resetDemo: () => { window.localStorage.removeItem(storageKey); setReviews({}); },
  }), [reviews]);

  return <CaseStore.Provider value={value}>{children}</CaseStore.Provider>;
}

export function useCaseStore() {
  const context = useContext(CaseStore);
  if (!context) throw new Error("useCaseStore must be used within CaseStoreProvider");
  return context;
}
