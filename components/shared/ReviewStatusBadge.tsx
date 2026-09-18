import { CircleCheck, Clock3, Eye } from "lucide-react";

export function ReviewStatusBadge({ status }: { status: "PENDING_REVIEW" | "IN_REVIEW" | "CONFIRMED" }) {
  const config = {
    PENDING_REVIEW: { label: "Pending review", Icon: Clock3, className: "bg-slate-100 text-slate-700" },
    IN_REVIEW: { label: "In review", Icon: Eye, className: "bg-[var(--review-bg)] text-[var(--review)]" },
    CONFIRMED: { label: "Confirmed", Icon: CircleCheck, className: "bg-[var(--match-bg)] text-[var(--match)]" },
  }[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold ${config.className}`}><config.Icon className="h-3.5 w-3.5" />{config.label}</span>;
}
