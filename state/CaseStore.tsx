"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReviewRecord, ReviewerDecision } from "@/domain/models/detail";

interface CaseStoreValue {
  reviews: Record<string, ReviewRecord>;
  saveReview: (caseId: string, decision: ReviewerDecision, note: string) => void;
  resetDemo: () => void;
}

const CaseStore = createContext<CaseStoreValue | null>(null);
const storageKey = "blink-demo-reviews";

export function CaseStoreProvider({ children }: { children: React.ReactNode }) {
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) setReviews(JSON.parse(saved));
  }, []);

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
