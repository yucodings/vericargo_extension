"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, PenLine, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/shared/AppShell";
import { CaseFlagBadge } from "@/components/shared/CaseFlagBadge";
import { ComparisonResultBadge } from "@/components/shared/ComparisonResultBadge";
import { EvidenceViewer } from "@/features/evidence/EvidenceViewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getDetailedCase } from "@/data/fixtures/detailedCases";
import type { ReviewerDecision } from "@/domain/models/detail";
import { useCaseStore } from "@/state/CaseStore";

export function ReviewWorkspace() {
  const params = useParams<{ caseId: string }>();
  const item = getDetailedCase(params.caseId);
  const attentionField = item.fields.find((field) => field.comparison !== "MATCH") ?? item.fields[0];
  const [selectedKey, setSelectedKey] = useState(attentionField.key);
  const [dialog, setDialog] = useState<ReviewerDecision | null>(null);
  const [note, setNote] = useState("");
  const [correction, setCorrection] = useState("");
  const { reviews, saveReview } = useCaseStore();
  const record = reviews[item.id];
  const selected = item.fields.find((field) => field.key === selectedKey) ?? item.fields[0];
  const final = record && ["CONFIRMED_MATCH", "CONFIRMED_MISMATCH"].includes(record.decision);

  function submit() {
    if (!dialog) return;
    const actionNote = dialog === "CORRECTED" ? `Corrected ${selected.label} to “${correction}”. Case returned to review.` : note || defaultNote(dialog);
    saveReview(item.id, dialog, actionNote);
    setDialog(null); setNote(""); setCorrection("");
  }

  return <AppShell><div className="mx-auto max-w-[1500px]">
    <Link href="/review" className="focus-ring mb-5 inline-flex items-center gap-2 rounded text-sm font-semibold text-[var(--ocean)] hover:underline"><ArrowLeft className="h-4 w-4" />Back to review queue</Link>
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--ocean)]">Review {item.id}</span><CaseFlagBadge suggestion={item.suggestion} /></div><h1 className="text-3xl font-bold tracking-[-0.03em]">{item.subject}</h1><p className="mt-2 text-[var(--muted)]">System reason: {item.reason}</p></div><div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Final decision: {final ? record.decision.replaceAll("_", " ") : "Pending reviewer"}</div></div>
    {record && <div className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${final ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><ShieldCheck className={`mt-0.5 h-5 w-5 ${final ? "text-emerald-700" : "text-amber-700"}`} /><div><p className="font-bold">{final ? "Human decision recorded" : "Action recorded — review still required"}</p><p className="text-sm">{record.note}</p></div></div>}
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit rounded-xl border-[var(--line)] shadow-none"><div className="border-b border-[var(--line)] px-4 py-4"><h2 className="font-bold">Fields to inspect</h2><p className="text-sm text-[var(--muted)]">Official scope only</p></div><CardContent className="p-2">{item.fields.map((field) => <button key={field.key} onClick={() => setSelectedKey(field.key)} className={`focus-ring flex w-full items-center justify-between rounded-lg px-3 py-3 text-left hover:bg-slate-50 ${selectedKey === field.key ? "bg-[var(--sky)]" : ""}`}><span className="font-medium">{field.label}</span><ComparisonResultBadge result={field.comparison} /></button>)}</CardContent></Card>
      <div className="space-y-6"><EvidenceViewer field={selected} />
        <Card className="rounded-xl border-[var(--line)] shadow-none"><div className="border-b border-[var(--line)] px-5 py-4"><h2 className="text-lg font-bold">Reviewer action</h2><p className="text-sm text-[var(--muted)]">A final result is created only by Confirm Match or Confirm Mismatch.</p></div><CardContent className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4"><Button onClick={() => setDialog("CONFIRMED_MATCH")} className="h-12 bg-[var(--match)] hover:bg-[#0e6f4a]"><Check />Confirm Match</Button><Button onClick={() => setDialog("CONFIRMED_MISMATCH")} className="h-12 bg-[var(--mismatch)] hover:bg-[#a83328]"><X />Confirm Mismatch</Button><Button onClick={() => setDialog("CORRECTED")} variant="outline" className="h-12 border-[var(--line)]"><PenLine />Correct Value</Button><Button onClick={() => setDialog("RETRY_REQUESTED")} variant="outline" className="h-12 border-[var(--line)]"><RotateCcw />Retry Processing</Button></CardContent></Card>
      </div>
    </div>
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>{dialogTitle(dialog)}</DialogTitle><DialogDescription>{dialogDescription(dialog, selected.label)}</DialogDescription></DialogHeader>{dialog === "CORRECTED" ? <div className="space-y-4 py-2"><div className="space-y-2"><Label htmlFor="field">Field</Label><Select value={selectedKey} onValueChange={setSelectedKey}><SelectTrigger id="field"><SelectValue /></SelectTrigger><SelectContent>{item.fields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="correction">Corrected value</Label><Input id="correction" value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Enter the verified value" /></div></div> : <div className="space-y-2 py-2"><Label htmlFor="review-note">Reviewer note</Label><Textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for the audit trail" /></div>}<DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={submit} disabled={dialog === "CORRECTED" && !correction.trim()} className="bg-[var(--ocean)] hover:bg-[#095965]">Record action</Button></DialogFooter></DialogContent></Dialog>
  </div></AppShell>;
}

function defaultNote(decision: ReviewerDecision) {
  if (decision === "CONFIRMED_MATCH") return "Reviewer confirmed that the seven official fields match.";
  if (decision === "CONFIRMED_MISMATCH") return "Reviewer confirmed a discrepancy in the official comparison scope.";
  if (decision === "RETRY_REQUESTED") return "Reviewer requested document processing to run again. Case remains in review.";
  return "Reviewer corrected a value. Case remains in review.";
}
function dialogTitle(decision: ReviewerDecision | null) { return decision === "CONFIRMED_MATCH" ? "Confirm final match" : decision === "CONFIRMED_MISMATCH" ? "Confirm final mismatch" : decision === "CORRECTED" ? "Correct extracted value" : "Retry document processing"; }
function dialogDescription(decision: ReviewerDecision | null, field: string) { return decision === "CORRECTED" ? `Update ${field}. The case will be re-verified and returned to human review.` : decision === "RETRY_REQUESTED" ? "The case will stay open and return to the processing flow." : "This human action will create the final case decision and an audit record."; }
