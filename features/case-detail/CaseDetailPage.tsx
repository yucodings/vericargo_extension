"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, FileCheck2, Mail, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/shared/AppShell";
import { CaseFlagBadge } from "@/components/shared/CaseFlagBadge";
import { ComparisonResultBadge } from "@/components/shared/ComparisonResultBadge";
import { EvidenceViewer } from "@/features/evidence/EvidenceViewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDetailedCase } from "@/data/fixtures/detailedCases";

export function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const item = getDetailedCase(params.caseId);
  const [selectedKey, setSelectedKey] = useState(item.fields.find((field) => field.comparison !== "MATCH")?.key ?? item.fields[0].key);
  const selected = item.fields.find((field) => field.key === selectedKey) ?? item.fields[0];
  return <AppShell><div className="mx-auto max-w-[1500px]">
    <Link href="/inbox" className="focus-ring mb-5 inline-flex items-center gap-2 rounded text-sm font-semibold text-[var(--ocean)] hover:underline"><ArrowLeft className="h-4 w-4" />Back to inbox</Link>
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--ocean)]">Case {item.id}</span><CaseFlagBadge suggestion={item.suggestion} /></div><h1 className="text-3xl font-bold tracking-[-0.03em]">{item.subject}</h1><p className="mt-2 text-[var(--muted)]">{item.sender} · {item.receivedAt}</p></div><Button asChild className="h-11 bg-[var(--ocean)] text-base hover:bg-[#095965]"><Link href={`/review/${item.id}`}>Review this case <ArrowRight /></Link></Button></div>
    <div className="mb-6 grid gap-4 md:grid-cols-3"><SummaryCard icon={Mail} label="Intent" value="Document comparison" detail="Email evidence sufficient" /><SummaryCard icon={FileCheck2} label="Documents" value={`${item.documents.length}/2 available`} detail={item.documents.map((doc) => doc.type === "SI" ? "SI" : "Draft BL").join(" + ")} /><SummaryCard icon={ShieldAlert} label="Decision control" value="Human review required" detail="No automatic final decision" /></div>
    <Card className="mb-6 overflow-hidden rounded-xl border-[var(--line)] shadow-none"><div className="border-b border-[var(--line)] px-5 py-4 sm:px-6"><h2 className="text-lg font-bold">Official seven-field comparison</h2><p className="text-sm text-[var(--muted)]">Select a field to inspect its source evidence.</p></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-[#f8fafb]"><TableHead className="pl-6">Field</TableHead><TableHead>Shipping Instruction</TableHead><TableHead>Draft BL</TableHead><TableHead>Result</TableHead><TableHead>Confidence</TableHead><TableHead className="pr-6 text-right">Evidence</TableHead></TableRow></TableHeader><TableBody>{item.fields.map((field) => <TableRow key={field.key} className={selectedKey === field.key ? "bg-[#f0f8f8]" : ""}><TableCell className="pl-6 font-bold">{field.label}</TableCell><TableCell>{field.si.normalizedValue}</TableCell><TableCell>{field.bl.normalizedValue}</TableCell><TableCell><ComparisonResultBadge result={field.comparison} /></TableCell><TableCell className="font-semibold">{field.confidence ? `${Math.round(field.confidence * 100)}%` : "—"}</TableCell><TableCell className="pr-6 text-right"><Button size="sm" variant="outline" onClick={() => setSelectedKey(field.key)} className="border-[var(--line)] bg-white">View</Button></TableCell></TableRow>)}</TableBody></Table></div></Card>
    <EvidenceViewer field={selected} />
  </div></AppShell>;
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof Mail; label: string; value: string; detail: string }) {
  return <Card className="rounded-xl border-[var(--line)] shadow-none"><CardContent className="flex gap-3 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--sky)] text-[var(--ocean)]"><Icon className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p><p className="font-bold">{value}</p><p className="text-sm text-[var(--muted)]">{detail}</p></div></CardContent></Card>;
}
