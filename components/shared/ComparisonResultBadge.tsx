import { Check, CircleHelp, X } from "lucide-react";
import type { Comparison } from "@/domain/models/case";

export function ComparisonResultBadge({ result }: { result: Comparison }) {
  const config = {
    MATCH: { label: "Match", Icon: Check, className: "bg-[var(--match-bg)] text-[var(--match)]" },
    MISMATCH: { label: "Mismatch", Icon: X, className: "bg-[var(--mismatch-bg)] text-[var(--mismatch)]" },
    UNRESOLVED: { label: "Unresolved", Icon: CircleHelp, className: "bg-[var(--review-bg)] text-[var(--review)]" },
  }[result];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold ${config.className}`}><config.Icon className="h-3.5 w-3.5" />{config.label}</span>;
}
