"use client";

import Link from "next/link";
import { ArrowRight, Database, FileClock, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shared/AppShell";
import { PageHeader } from "@/components/shared/PageHeader";
import { AuditTimeline } from "./AuditTimeline";
import { Card, CardContent } from "@/components/ui/card";
import { detailedCases } from "@/data/fixtures/detailedCases";
import { useCaseStore } from "@/state/CaseStore";

export function AuditPage() {
  const { reviews } = useCaseStore();
  const featured = detailedCases[0];
  return <AppShell><div className="mx-auto max-w-[1500px]">
    <PageHeader eyebrow="Audit trail" title="Trace every decision" description="System suggestions and human actions are recorded separately so the final outcome can always be explained." />
    <div className="mb-6 grid gap-4 sm:grid-cols-3"><AuditMetric icon={FileClock} label="Events recorded" value={detailedCases.reduce((total, item) => total + item.audit.length, 0) + Object.keys(reviews).length} /><AuditMetric icon={Database} label="Evidence-linked cases" value={detailedCases.filter((item) => item.evidenceComplete).length} /><AuditMetric icon={ShieldCheck} label="Automatic final decisions" value={0} /></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]"><Card className="rounded-xl border-[var(--line)] shadow-none"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4"><div><h2 className="text-lg font-bold">Case {featured.id}</h2><p className="text-sm text-[var(--muted)]">Complete processing history</p></div><Link href={`/cases/${featured.id}`} className="focus-ring flex items-center gap-1 rounded text-sm font-semibold text-[var(--ocean)] hover:underline">Open case <ArrowRight className="h-4 w-4" /></Link></div><CardContent className="p-5"><AuditTimeline events={featured.audit} review={reviews[featured.id]} /></CardContent></Card>
      <Card className="h-fit rounded-xl border-[var(--line)] shadow-none"><div className="border-b border-[var(--line)] px-5 py-4"><h2 className="text-lg font-bold">Case ledger</h2><p className="text-sm text-[var(--muted)]">Comparison activity in this demo</p></div><CardContent className="divide-y divide-[var(--line)] p-0">{detailedCases.map((item) => <Link key={item.id} href={`/cases/${item.id}`} className="focus-ring flex items-center justify-between px-5 py-4 hover:bg-slate-50"><div><p className="font-bold">{item.id}</p><p className="text-sm text-[var(--muted)]">{item.audit.length + (reviews[item.id] ? 1 : 0)} audit events</p></div><span className={`h-2.5 w-2.5 rounded-full ${reviews[item.id]?.decision.startsWith("CONFIRMED") ? "bg-[var(--match)]" : "bg-amber-400"}`} /></Link>)}</CardContent></Card>
    </div>
  </div></AppShell>;
}

function AuditMetric({ icon: Icon, label, value }: { icon: typeof FileClock; label: string; value: number }) { return <Card className="rounded-xl border-[var(--line)] shadow-none"><CardContent className="flex items-center gap-4 p-5"><span className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--sky)] text-[var(--ocean)]"><Icon className="h-5 w-5" /></span><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-[var(--muted)]">{label}</p></div></CardContent></Card>; }
