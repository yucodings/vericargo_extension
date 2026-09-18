"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, Clock3, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shared/AppShell";
import { CaseFlagBadge } from "@/components/shared/CaseFlagBadge";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { comparisonCases } from "@/data/fixtures";
import { useCaseStore } from "@/state/CaseStore";

export function ReviewQueuePage() {
  const { reviews } = useCaseStore();
  const pending = comparisonCases.filter((item) => !["CONFIRMED_MATCH", "CONFIRMED_MISMATCH"].includes(reviews[item.id]?.decision));
  const completed = comparisonCases.length - pending.length;
  return <AppShell><div className="mx-auto max-w-[1500px]">
    <PageHeader eyebrow="Human review" title="Decision queue" description="Every system outcome arrives here. Review the evidence before confirming a final match or mismatch." />
    <div className="mb-6 grid gap-4 sm:grid-cols-3"><QueueMetric icon={Clock3} label="Awaiting decision" value={pending.length} /><QueueMetric icon={CircleCheck} label="Confirmed this session" value={completed} /><QueueMetric icon={ShieldCheck} label="Auto-decisions" value={0} /></div>
    <div className="grid gap-4">{pending.map((item, index) => <Card key={item.id} className="rounded-xl border-[var(--line)] shadow-none"><CardContent className="grid gap-5 p-5 lg:grid-cols-[52px_minmax(0,1fr)_auto] lg:items-center"><div className="grid h-12 w-12 place-items-center rounded-lg bg-[var(--sky)] text-lg font-bold text-[var(--ocean)]">{String(index + 1).padStart(2, "0")}</div><div><div className="mb-2 flex flex-wrap items-center gap-2"><Link href={`/cases/${item.id}`} className="focus-ring rounded text-lg font-bold text-[var(--navy)] hover:text-[var(--ocean)]">{item.id}</Link><CaseFlagBadge suggestion={item.suggestion} />{item.confidence && <span className="text-sm font-semibold text-[var(--muted)]">{Math.round(item.confidence * 100)}% confidence</span>}</div><p className="font-medium">{item.subject}</p><p className="mt-1 text-sm text-[var(--muted)]">{item.reason}</p></div><Button asChild className="h-11 bg-[var(--ocean)] hover:bg-[#095965]"><Link href={`/review/${item.id}`}>Review evidence <ArrowRight /></Link></Button></CardContent></Card>)}
      {pending.length === 0 && <div className="rounded-xl border border-[var(--line)] bg-white px-6 py-16 text-center"><CircleCheck className="mx-auto h-12 w-12 text-[var(--match)]" /><h2 className="mt-4 text-xl font-bold">Review queue complete</h2><p className="mt-1 text-[var(--muted)]">All comparison cases have a human-confirmed decision.</p></div>}
    </div>
  </div></AppShell>;
}

function QueueMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: number }) {
  return <Card className="rounded-xl border-[var(--line)] shadow-none"><CardContent className="flex items-center gap-4 p-5"><span className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--sky)] text-[var(--ocean)]"><Icon className="h-5 w-5" /></span><div><p className="text-2xl font-bold">{value}</p><p className="text-sm text-[var(--muted)]">{label}</p></div></CardContent></Card>;
}
