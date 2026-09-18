import { AlertTriangle, Check, CircleHelp } from "lucide-react";
import type { Suggestion } from "@/domain/models/case";

const config = {
  SUGGESTED_MATCH: { label: "Suggested match", icon: Check, className: "bg-[var(--match-bg)] text-[var(--match)]" },
  SUGGESTED_MISMATCH: { label: "Suggested mismatch", icon: AlertTriangle, className: "bg-[var(--mismatch-bg)] text-[var(--mismatch)]" },
  HUMAN_REVIEW: { label: "Review required", icon: CircleHelp, className: "bg-[var(--review-bg)] text-[var(--review)]" },
} satisfies Record<Suggestion, { label: string; icon: typeof Check; className: string }>;

export function CaseFlagBadge({ suggestion }: { suggestion: Suggestion }) {
  const item = config[suggestion];
  const Icon = item.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold ${item.className}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</span>;
}
