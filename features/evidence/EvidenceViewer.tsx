import { FileText, LocateFixed } from "lucide-react";
import type { FieldResult, SourceEvidence } from "@/domain/models/detail";
import { ComparisonResultBadge } from "@/components/shared/ComparisonResultBadge";

export function EvidenceViewer({ field }: { field: FieldResult }) {
  return <section aria-labelledby="evidence-title" className="overflow-hidden rounded-xl border border-[var(--line)] bg-white">
    <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ocean)]">Selected evidence</p><h2 id="evidence-title" className="mt-1 text-xl font-bold">{field.label}</h2></div><ComparisonResultBadge result={field.comparison} /></div>
    <div className="grid lg:grid-cols-2"><DocumentEvidence title="Shipping Instruction" evidence={field.si} side="SI" /><DocumentEvidence title="Draft Bill of Lading" evidence={field.bl} side="BL" /></div>
    <div className="grid gap-4 border-t border-[var(--line)] bg-[#f8fafb] p-5 sm:grid-cols-3"><EvidenceFact label="Normalization" value={field.normalization} /><EvidenceFact label="Comparison reason" value={field.reason} /><EvidenceFact label="Risk confidence" value={field.confidence ? `${Math.round(field.confidence * 100)}%` : "Not available"} /></div>
  </section>;
}

function DocumentEvidence({ title, evidence, side }: { title: string; evidence: SourceEvidence; side: string }) {
  return <article className="border-[var(--line)] p-5 first:border-b lg:first:border-b-0 lg:first:border-r"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><FileText className="h-5 w-5 text-[var(--ocean)]" /><h3 className="font-bold">{title}</h3></div><span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{side}</span></div><div className="mb-4 min-h-40 border border-slate-200 bg-[#fbfbf8] p-4 shadow-[0_2px_8px_rgb(15_23_42/5%)]"><div className="mb-5 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400"><span>{evidence.source}</span><span>{evidence.page ? `Page ${evidence.page}` : "No page"}</span></div><p className={`border-l-4 px-3 py-2 font-mono text-sm leading-6 ${evidence.normalizedValue === "Missing" || evidence.normalizedValue === "Unresolved" ? "border-amber-400 bg-amber-50" : "border-[#24aaa3] bg-[#eaf8f6]"}`}>{evidence.evidence}</p></div><dl className="grid grid-cols-2 gap-4"><div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Raw value</dt><dd className="mt-1 font-semibold">{evidence.rawValue}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Normalized</dt><dd className="mt-1 font-semibold text-[var(--ocean)]">{evidence.normalizedValue}</dd></div></dl></article>;
}

function EvidenceFact({ label, value }: { label: string; value: string }) {
  return <div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"><LocateFixed className="h-3.5 w-3.5" />{label}</div><p className="text-sm font-medium leading-6">{value}</p></div>;
}
