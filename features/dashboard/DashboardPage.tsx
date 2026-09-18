import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleDot, Clock3, Files, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/shared/AppShell";
import { CaseFlagBadge } from "@/components/shared/CaseFlagBadge";
import { cases, comparisonCases } from "@/data/fixtures";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const metrics = [
  { label: "Inbox cases", value: cases.length, note: "All received", icon: Files, tone: "navy" },
  { label: "Verification cases", value: comparisonCases.length, note: "SI ↔ Draft BL", icon: CircleDot, tone: "ocean" },
  { label: "Pending review", value: comparisonCases.filter((item) => item.reviewStatus !== "CONFIRMED").length, note: "Human decision required", icon: Clock3, tone: "review" },
  { label: "Suggested mismatches", value: comparisonCases.filter((item) => item.suggestion === "SUGGESTED_MISMATCH").length, note: "Not auto-confirmed", icon: TriangleAlert, tone: "mismatch" },
];

const tones: Record<string, string> = { navy: "bg-[#eaf0f5] text-[var(--navy)]", ocean: "bg-[var(--sky)] text-[var(--ocean)]", review: "bg-[var(--review-bg)] text-[var(--review)]", mismatch: "bg-[var(--mismatch-bg)] text-[var(--mismatch)]" };

export function DashboardPage() {
  return <AppShell><div className="mx-auto max-w-[1500px]">
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-sm font-semibold uppercase tracking-[0.13em] text-[var(--ocean)]">Friday · 19 September 2026</p><h1 className="text-3xl font-bold tracking-[-0.03em] text-[var(--ink)] sm:text-[2.2rem]">Good morning, Aina</h1><p className="mt-2 text-base text-[var(--muted)]">Five verification cases are waiting for a human decision.</p></div><Button asChild className="h-11 bg-[var(--ocean)] px-5 text-base hover:bg-[#095965]"><Link href="/review">Open review queue <ArrowRight className="ml-1" /></Link></Button></div>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Case metrics">{metrics.map((metric) => <Card key={metric.label} className="rounded-xl border-[var(--line)] shadow-none"><CardContent className="p-5"><div className="mb-5 flex items-start justify-between"><p className="font-medium text-[var(--muted)]">{metric.label}</p><span className={`grid h-10 w-10 place-items-center rounded-lg ${tones[metric.tone]}`}><metric.icon className="h-5 w-5" /></span></div><p className="text-3xl font-bold tracking-tight">{metric.value}</p><p className="mt-1 text-sm text-[var(--muted)]">{metric.note}</p></CardContent></Card>)}</section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
      <Card className="overflow-hidden rounded-xl border-[var(--line)] shadow-none"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-6"><div><h2 className="text-lg font-bold">Cases requiring attention</h2><p className="text-sm text-[var(--muted)]">System suggestions awaiting reviewer confirmation</p></div><Link href="/inbox" className="focus-ring rounded text-sm font-semibold text-[var(--ocean)] hover:underline">View all</Link></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-[#f8fafb]"><TableHead className="pl-6">Case</TableHead><TableHead>Sender</TableHead><TableHead>System suggestion</TableHead><TableHead>Confidence</TableHead><TableHead className="pr-6 text-right">Received</TableHead></TableRow></TableHeader><TableBody>{comparisonCases.slice(0, 4).map((item) => <TableRow key={item.id} className="group"><TableCell className="pl-6"><Link href={`/cases/${item.id}`} className="focus-ring rounded font-bold text-[var(--navy)] group-hover:text-[var(--ocean)]">{item.id}</Link><p className="mt-0.5 max-w-[210px] truncate text-sm text-[var(--muted)]">{item.subject}</p></TableCell><TableCell className="max-w-[210px] truncate text-sm">{item.sender}</TableCell><TableCell><CaseFlagBadge suggestion={item.suggestion} /></TableCell><TableCell className="font-semibold">{item.confidence ? `${Math.round(item.confidence * 100)}%` : "—"}</TableCell><TableCell className="pr-6 text-right text-sm text-[var(--muted)]">{item.receivedAt}</TableCell></TableRow>)}</TableBody></Table></div></Card>
      <Card className="rounded-xl border-[var(--line)] bg-[var(--navy)] text-white shadow-none"><CardContent className="p-6"><div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-lg bg-white/10"><CheckCircle2 className="h-6 w-6 text-[#55d8c8]" /></span><div><h2 className="text-lg font-bold">Human decision gate</h2><p className="text-sm text-slate-300">Automation stops here</p></div></div><div><GateStep number="1" label="System assesses evidence" detail="Match, mismatch or uncertainty" /><GateStep number="2" label="Case enters review" detail="Every outcome, every time" /><GateStep number="3" label="Reviewer decides" detail="Confirm, correct or retry" last /></div><div className="mt-6 border-t border-white/10 pt-5"><p className="text-sm leading-6 text-slate-300">High confidence improves prioritisation. It never replaces the reviewer’s final decision.</p></div></CardContent></Card>
    </section>
  </div></AppShell>;
}

function GateStep({ number, label, detail, last = false }: { number: string; label: string; detail: string; last?: boolean }) {
  return <div className="grid grid-cols-[32px_1fr] gap-3"><div className="flex flex-col items-center"><span className="grid h-8 w-8 place-items-center rounded-full border border-[#55d8c8]/60 bg-[#55d8c8]/10 text-sm font-bold text-[#7ce5d9]">{number}</span>{!last && <span className="h-9 w-px bg-white/15" />}</div><div className="pt-1"><p className="text-sm font-semibold">{label}</p><p className="text-xs text-slate-400">{detail}</p></div></div>;
}
