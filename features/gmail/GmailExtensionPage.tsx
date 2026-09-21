"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Download,
  FileCheck2,
  FileText,
  Inbox,
  Mail,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRoundCheck,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gmailCases as fixtureCases } from "@/data/fixtures/gmailCases";
import type { Comparison, EmailCategory, FieldComparison, GmailCase, OfficialField, ReviewReason } from "@/domain/models/workflow";
import { buildSubmission } from "@/domain/submission/buildSubmission";
import { reprocessAfterDraftEdit } from "@/domain/workflow/verification";

type InboxFilter = "ALL" | EmailCategory | "HUMAN_REVIEW";

const categoryPresentation: Record<EmailCategory, { label: string; className: string }> = {
  DOCUMENT_COMPARISON: { label: "Document Comparison", className: "bg-rose-50 text-rose-700 border-rose-200" },
  NEW_SI: { label: "New SI", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  INVOICE_QUERY: { label: "Invoice Query", className: "bg-amber-50 text-amber-800 border-amber-200" },
  GENERAL: { label: "General", className: "bg-blue-50 text-blue-700 border-blue-200" },
  SPAM: { label: "Spam", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

const filterOptions: { key: InboxFilter; label: string }[] = [
  { key: "ALL", label: "All mail" },
  { key: "DOCUMENT_COMPARISON", label: "Compare docs" },
  { key: "NEW_SI", label: "New SI" },
  { key: "INVOICE_QUERY", label: "Invoices" },
  { key: "HUMAN_REVIEW", label: "Human review" },
];

function cloneCases() {
  return fixtureCases.map((item) => ({
    ...item,
    recipients: [...item.recipients],
    triageEvidence: [...item.triageEvidence],
    attachments: item.attachments.map((attachment) => ({ ...attachment })),
    fields: item.fields.map((field) => ({ ...field, si: { ...field.si }, draftBl: { ...field.draftBl } })),
    criticalGateFailures: [...item.criticalGateFailures],
    ignoredSuggestions: [...item.ignoredSuggestions],
  }));
}

export function GmailExtensionPage() {
  const [cases, setCases] = useState<GmailCase[]>(cloneCases);
  const [selectedId, setSelectedId] = useState<string | null>("email_002");
  const [selectedField, setSelectedField] = useState<OfficialField>("container_count");
  const [filter, setFilter] = useState<InboxFilter>("ALL");
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [notice, setNotice] = useState("Demo inbox is ready");

  const selected = cases.find((item) => item.emailId === selectedId) ?? null;
  const activeField = selected?.fields.find((field) => field.field === selectedField)
    ?? selected?.fields.find((field) => field.comparison !== "MATCH")
    ?? selected?.fields[0]
    ?? null;

  const filteredCases = useMemo(() => cases.filter((item) => {
    const matchesQuery = `${item.senderName} ${item.sender} ${item.subject}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "ALL"
      || (filter === "HUMAN_REVIEW" && item.workflowStatus === "HUMAN_REVIEW")
      || item.category === filter;
    return matchesQuery && matchesFilter;
  }), [cases, filter, query]);

  function openEmail(item: GmailCase) {
    setSelectedId(item.emailId);
    setSelectedField(item.fields.find((field) => field.comparison !== "MATCH")?.field ?? "shipper");
    setManualValue("");
    setNotice(`${item.senderName} opened in contextual analysis`);
  }

  function updateCase(emailId: string, updater: (item: GmailCase) => GmailCase) {
    setCases((current) => current.map((item) => item.emailId === emailId ? updater(item) : item));
  }

  function applyValue(value: string, field: OfficialField = selectedField) {
    if (!selected || !value.trim()) return;
    updateCase(selected.emailId, (item) => reprocessAfterDraftEdit(item, field, value.trim()));
    setSelectedField(field);
    setManualValue("");
    setNotice("Draft BL updated. Fresh processing run started from Phase 5.");
  }

  function ignoreSuggestion(field: OfficialField = selectedField) {
    if (!selected) return;
    const ignoredField = selected.fields.find((entry) => entry.field === field);
    if (!ignoredField) return;
    updateCase(selected.emailId, (item) => ({
      ...item,
      ignoredSuggestions: item.ignoredSuggestions.includes(field)
        ? item.ignoredSuggestions
        : [...item.ignoredSuggestions, field],
    }));
    setSelectedField(field);
    setNotice(`${ignoredField.label} suggestion ignored; the evidence remains in the audit trail.`);
  }

  function sendToHumanReview() {
    if (!selected) return;
    updateCase(selected.emailId, (item) => ({
      ...item,
      workflowStatus: "HUMAN_REVIEW",
      reviewReason: item.reviewReason ?? "LOW_CONFIDENCE",
      reviewDetail: item.reviewDetail ?? "A user requested a reviewer decision.",
    }));
    setNotice("Case sent to Human Review with its source evidence.");
  }

  function verifySuggestedResult() {
    if (!selected?.suggestedResult) return;
    updateCase(selected.emailId, (item) => ({
      ...item,
      workflowStatus: "VERIFIED",
      processingStage: "FINAL_RESULT",
      reviewerDecision: item.suggestedResult,
      reviewReason: null,
      reviewDetail: null,
    }));
    setNotice(`Reviewer verified the suggested ${selected.suggestedResult.toLowerCase()} result.`);
  }

  function retryProcessing() {
    if (!selected) return;
    updateCase(selected.emailId, (item) => ({
      ...item,
      processingRuns: item.processingRuns + 1,
      reviewDetail: `Retry ${item.processingRuns + 1} completed. The blocking condition remains and still requires review.`,
    }));
    setNotice("Retry completed; the case remains visible in Human Review.");
  }

  function downloadSubmission() {
    const payload = JSON.stringify(buildSubmission(cases), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sample_submission.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Submission JSON generated for every email in the demo inbox.");
  }

  return (
    <main className="min-h-screen bg-[#edf3f8] p-2 text-[#15233b] sm:p-4">
      <header className="mx-auto mb-3 flex max-w-[1800px] items-center gap-3 rounded-2xl border border-[#d6e0e9] bg-white px-3 py-3 shadow-[0_10px_30px_rgba(29,54,86,0.07)] sm:px-5">
        <button className="focus-ring flex shrink-0 items-center gap-3 rounded-xl" onClick={() => setSelectedId(null)} aria-label="Show inbox overview">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0b57d0] text-white"><Mail className="h-5 w-5" /></span>
          <span className="hidden sm:block"><strong className="block text-lg tracking-[0.12em] text-[#123b78]">VeriCargo</strong><small className="block text-xs text-slate-500">Gmail shipping assistant</small></span>
        </button>
        <label className="relative mx-auto block min-w-0 max-w-2xl flex-1"><span className="sr-only">Search inbox</span><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 rounded-full border-0 bg-[#eef3fb] pl-12 shadow-none" placeholder="Search mail" /></label>
        <Button onClick={downloadSubmission} variant="outline" className="h-10 border-[#b9cbea] text-[#0b57d0]"><Download className="h-4 w-4" /><span className="hidden sm:inline">Export JSON</span></Button>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#143b70] text-sm font-bold text-white">AR</span>
      </header>

      <div className="mx-auto grid max-w-[1800px] gap-3 xl:h-[calc(100vh-105px)] xl:grid-cols-[350px_minmax(420px,1fr)_430px]">
        <InboxPanel cases={filteredCases} allCases={cases} selectedId={selectedId} filter={filter} onFilter={setFilter} onSelect={openEmail} />
        <EmailPanel item={selected} onClose={() => setSelectedId(null)} onCompare={() => setNotice("The latest processing run is already reflected in the VeriCargo panel.")} />
        <AssistantPanel item={selected} allCases={cases} activeField={activeField} selectedField={selectedField} manualValue={manualValue} notice={notice} onField={setSelectedField} onManualValue={setManualValue} onApply={applyValue} onIgnore={ignoreSuggestion} onHumanReview={sendToHumanReview} onVerify={verifySuggestedResult} onRetry={retryProcessing} onOpen={openEmail} />
      </div>
    </main>
  );
}

function InboxPanel({ cases, allCases, selectedId, filter, onFilter, onSelect }: { cases: GmailCase[]; allCases: GmailCase[]; selectedId: string | null; filter: InboxFilter; onFilter: (value: InboxFilter) => void; onSelect: (item: GmailCase) => void }) {
  return <section className="flex h-[520px] min-h-0 flex-col overflow-hidden rounded-2xl border border-[#d6e0e9] bg-white shadow-[0_10px_30px_rgba(29,54,86,0.06)] xl:h-auto" aria-label="Gmail inbox"><div className="border-b border-slate-200 p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#0b57d0]">Inbox</p><h1 className="text-xl font-bold">Shipping operations</h1></div><Badge variant="secondary" className="rounded-full">{allCases.length}</Badge></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{filterOptions.map((option) => <button key={option.key} onClick={() => onFilter(option.key)} className={`focus-ring whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === option.key ? "border-[#0b57d0] bg-[#0b57d0] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{option.label}</button>)}</div></div><div className="flex-1 overflow-y-auto">{cases.map((item) => { const category = categoryPresentation[item.category]; return <button key={item.emailId} onClick={() => onSelect(item)} className={`focus-ring block w-full border-b border-slate-100 px-4 py-4 text-left transition hover:bg-[#f5f8fd] ${selectedId === item.emailId ? "bg-[#edf4ff] shadow-[inset_3px_0_0_#0b57d0]" : ""}`}><div className="mb-1 flex items-center justify-between gap-3"><span className="truncate font-bold">{item.senderName}</span><span className="shrink-0 text-xs text-slate-500">{item.receivedAt}</span></div><p className="truncate text-sm font-semibold text-slate-800">{item.subject}</p><p className="mt-1 line-clamp-1 text-sm text-slate-500">{item.body}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="outline" className={category.className}>{category.label}</Badge>{item.workflowStatus === "HUMAN_REVIEW" ? <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">Human Review</Badge> : null}{item.workflowStatus === "VERIFIED" ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Verified</Badge> : null}</div></button>; })}{cases.length === 0 ? <div className="px-6 py-16 text-center"><Inbox className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-bold">No matching emails</p><p className="text-sm text-slate-500">Try another label or search.</p></div> : null}</div></section>;
}

function EmailPanel({ item, onClose, onCompare }: { item: GmailCase | null; onClose: () => void; onCompare: () => void }) {
  if (!item) return <section className="grid min-h-[520px] place-items-center rounded-2xl border border-[#d6e0e9] bg-white p-8 text-center shadow-[0_10px_30px_rgba(29,54,86,0.06)]"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#e8f0fe] text-[#0b57d0]"><Inbox className="h-8 w-8" /></span><h2 className="mt-5 text-2xl font-bold">VeriCargo inbox overview</h2><p className="mx-auto mt-2 max-w-md text-slate-500">Choose an email to open contextual analysis, or use the VeriCargo panel to review categories and Human Review cases.</p></div></section>;
  return <article className="flex min-h-[600px] flex-col overflow-hidden rounded-2xl border border-[#d6e0e9] bg-white shadow-[0_10px_30px_rgba(29,54,86,0.06)] xl:min-h-0"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div className="flex items-center gap-2 text-slate-500"><button className="focus-ring rounded-lg p-2 hover:bg-slate-100" onClick={onClose} aria-label="Close email"><ArrowLeft className="h-5 w-5" /></button><Archive className="h-5 w-5" /><Tag className="h-5 w-5" /></div><span className="text-xs font-semibold text-slate-400">{item.gmailMessageId}</span></div><div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-2xl font-bold tracking-[-0.02em]">{item.subject}</h2><div className="mt-3 flex flex-wrap gap-2"><CategoryBadge category={item.category} />{item.workflowStatus === "HUMAN_REVIEW" ? <Badge className="bg-violet-600">VeriCargo/Human Review</Badge> : null}</div></div><span className="text-sm text-slate-500">{item.receivedAt}</span></div><div className="mt-7 flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#dce8fb] font-bold text-[#174a8b]">{item.senderName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div className="min-w-0"><p className="font-bold">{item.senderName} <span className="font-normal text-slate-500">&lt;{item.sender}&gt;</span></p><p className="text-sm text-slate-500">to shipping.ops@averis.example</p></div></div><div className="mt-7 max-w-3xl whitespace-pre-line text-base leading-7 text-slate-700">{item.body}</div>{item.attachments.length > 0 ? <div className="mt-8"><p className="mb-3 text-sm font-bold text-slate-700">{item.attachments.length} attachment{item.attachments.length === 1 ? "" : "s"}</p><div className="grid gap-3 sm:grid-cols-2">{item.attachments.map((attachment) => <div key={attachment.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[#d93025] shadow-sm"><FileText className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate font-semibold">{attachment.filename}</p><p className="text-xs text-slate-500">{attachment.documentType.replaceAll("_", " ")} · {Math.round(attachment.documentTypeConfidence * 100)}%</p></div></div></div>)}</div></div> : null}</div><div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-8"><Button className="bg-[#0b57d0] hover:bg-[#0948ae]"><Send className="h-4 w-4" />Reply</Button>{item.category === "DOCUMENT_COMPARISON" ? <Button variant="outline" onClick={onCompare} className="border-[#b9cbea] text-[#0b57d0]"><FileCheck2 className="h-4 w-4" />Compare documents</Button> : null}</div></article>;
}

type AssistantProps = { item: GmailCase | null; allCases: GmailCase[]; activeField: FieldComparison | null; selectedField: OfficialField; manualValue: string; notice: string; onField: (field: OfficialField) => void; onManualValue: (value: string) => void; onApply: (value: string, field?: OfficialField) => void; onIgnore: (field?: OfficialField) => void; onHumanReview: () => void; onVerify: () => void; onRetry: () => void; onOpen: (item: GmailCase) => void };

function AssistantPanel(props: AssistantProps) {
  const { item } = props;
  return <aside className="flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-[#cbd8ea] bg-white shadow-[0_14px_35px_rgba(20,59,112,0.12)] xl:min-h-0" aria-label="VeriCargo extension"><div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-[#f7faff] to-white px-5 py-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0b57d0] text-white"><Sparkles className="h-5 w-5" /></span><div><h2 className="font-bold tracking-[0.08em] text-[#123b78]">VeriCargo</h2><p className="text-xs text-slate-500">Shipping verification</p></div></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Live</span></div>{!item ? <InboxOverview cases={props.allCases} onOpen={props.onOpen} notice={props.notice} /> : item.category !== "DOCUMENT_COMPARISON" ? <ClassifiedView item={item} notice={props.notice} /> : <Tabs defaultValue="comparison" className="flex min-h-0 flex-1 flex-col"><TabsList className="grid h-auto grid-cols-3 rounded-none border-b border-slate-200 bg-white p-0"><TabsTrigger value="comparison" className="rounded-none border-b-2 border-transparent py-3 data-[state=active]:border-[#0b57d0] data-[state=active]:shadow-none">Comparison</TabsTrigger><TabsTrigger value="evidence" className="rounded-none border-b-2 border-transparent py-3 data-[state=active]:border-[#0b57d0] data-[state=active]:shadow-none">Evidence</TabsTrigger><TabsTrigger value="editor" className="rounded-none border-b-2 border-transparent py-3 data-[state=active]:border-[#0b57d0] data-[state=active]:shadow-none">Draft BL</TabsTrigger></TabsList><TabsContent value="comparison" className="mt-0 min-h-0 flex-1 overflow-y-auto"><ComparisonView {...props} /></TabsContent><TabsContent value="evidence" className="mt-0 min-h-0 flex-1 overflow-y-auto"><EvidenceView item={item} field={props.activeField} onField={props.onField} /></TabsContent><TabsContent value="editor" className="mt-0 min-h-0 flex-1 overflow-y-auto"><DraftEditor {...props} /></TabsContent></Tabs>}</aside>;
}

function InboxOverview({ cases, onOpen, notice }: { cases: GmailCase[]; onOpen: (item: GmailCase) => void; notice: string }) {
  const reviewCases = cases.filter((item) => item.workflowStatus === "HUMAN_REVIEW");
  return <div className="flex-1 overflow-y-auto p-5"><p className="text-sm text-slate-500">{notice}</p><h3 className="mt-5 text-xl font-bold">Inbox summary</h3><div className="mt-4 grid grid-cols-2 gap-3"><SummaryTile label="Relevant emails" value={cases.length} tone="blue" /><SummaryTile label="Human Review" value={reviewCases.length} tone="violet" /><SummaryTile label="Document checks" value={cases.filter((item) => item.category === "DOCUMENT_COMPARISON").length} tone="rose" /><SummaryTile label="Verified" value={cases.filter((item) => item.workflowStatus === "VERIFIED").length} tone="green" /></div><h3 className="mt-7 font-bold">Needs attention</h3><div className="mt-3 space-y-2">{reviewCases.map((item) => <button key={item.emailId} onClick={() => onOpen(item)} className="focus-ring flex w-full items-center justify-between rounded-xl border border-violet-100 bg-violet-50 p-3 text-left hover:bg-violet-100"><div className="min-w-0"><p className="truncate font-semibold">{item.subject}</p><p className="truncate text-sm text-violet-700">{friendlyReason(item.reviewReason)}</p></div><ChevronRight className="h-4 w-4 shrink-0 text-violet-600" /></button>)}</div></div>;
}

function ClassifiedView({ item, notice }: { item: GmailCase; notice: string }) {
  const category = categoryPresentation[item.category];
  return <div className="flex-1 overflow-y-auto p-5"><p className="text-sm text-slate-500">{notice}</p><div className={`mt-5 rounded-2xl border p-5 ${category.className}`}><Tag className="h-6 w-6" /><p className="mt-4 text-xs font-bold uppercase tracking-[0.14em]">Email triage</p><h3 className="mt-1 text-xl font-bold">{category.label}</h3><p className="mt-2 text-sm leading-6">Classification confidence: {Math.round(item.categoryConfidence * 100)}%</p></div><h3 className="mt-7 font-bold">Why VeriCargo classified it this way</h3><ul className="mt-3 space-y-3">{item.triageEvidence.map((evidence) => <li key={evidence} className="flex gap-3 text-sm leading-6 text-slate-600"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />{evidence}</li>)}</ul>{item.workflowStatus === "HUMAN_REVIEW" ? <ReviewReasonCard item={item} /> : <div className="mt-7 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">This category does not continue to SI versus Draft BL verification.</div>}</div>;
}

function ComparisonView(props: AssistantProps) {
  const item = props.item!;
  const matched = item.fields.filter((field) => field.comparison === "MATCH").length;
  const progress = item.fields.length ? (matched / item.fields.length) * 100 : 0;
  return <div className="p-5"><p className="text-sm text-slate-500">{props.notice}</p><ResultCard item={item} /><div className="mt-5"><div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">Field agreement</span><span>{matched} / 7 fields</span></div><Progress value={progress} className="h-2" /></div><div className="mt-5 space-y-2">{item.fields.map((field) => <FieldRow key={field.field} field={field} active={props.selectedField === field.field} onClick={() => props.onField(field.field)} />)}</div>{item.workflowStatus === "HUMAN_REVIEW" ? <><ReviewReasonCard item={item} /><Button onClick={props.onRetry} variant="outline" className="mt-3 w-full border-violet-200 text-violet-700">Retry processing</Button></> : <div className="mt-5 grid gap-2 sm:grid-cols-2"><Button onClick={props.onVerify} className="bg-emerald-600 hover:bg-emerald-700"><UserRoundCheck className="h-4 w-4" />Verify result</Button><Button onClick={props.onHumanReview} variant="outline" className="border-violet-200 text-violet-700"><ShieldCheck className="h-4 w-4" />Human Review</Button></div>}</div>;
}

function ResultCard({ item }: { item: GmailCase }) {
  if (item.workflowStatus === "HUMAN_REVIEW") return <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-violet-700" /><div><p className="font-bold text-violet-900">Human Review</p><p className="mt-1 text-sm text-violet-800">Reason: {friendlyReason(item.reviewReason)}</p></div></div></div>;
  if (item.workflowStatus === "VERIFIED") return <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-700" /><div><p className="font-bold text-emerald-900">Reviewer verified {item.reviewerDecision?.toLowerCase()}</p><p className="mt-1 text-sm text-emerald-800">The final record and export are updated.</p></div></div></div>;
  const mismatch = item.suggestedResult === "MISMATCH";
  return <div className={`mt-5 rounded-2xl border p-4 ${mismatch ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}><div className="flex gap-3">{mismatch ? <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" /> : <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />}<div><p className={`font-bold ${mismatch ? "text-rose-900" : "text-emerald-900"}`}>Suggested {item.suggestedResult?.toLowerCase()} — {Math.round((item.decisionConfidence ?? 0) * 100)}%</p><p className={`mt-1 text-sm ${mismatch ? "text-rose-800" : "text-emerald-800"}`}>Review the evidence before confirming the final result.</p></div></div></div>;
}

function FieldRow({ field, active, onClick }: { field: FieldComparison; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`focus-ring flex w-full items-center gap-3 rounded-xl border p-3 text-left ${active ? "border-[#9db9e8] bg-[#eef4ff]" : "border-slate-200 hover:bg-slate-50"}`}><ComparisonIcon comparison={field.comparison} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-semibold">{field.label}</p><span className="text-xs font-bold text-slate-500">{Math.round(field.decisionConfidence * 100)}%</span></div><p className="mt-0.5 truncate text-sm text-slate-500">SI: {field.si.rawValue} · BL: {field.draftBl.rawValue}</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></button>;
}

function EvidenceView({ item, field, onField }: { item: GmailCase; field: FieldComparison | null; onField: (field: OfficialField) => void }) {
  if (!field) return <div className="p-6 text-sm text-slate-500">No field evidence is available for this case.</div>;
  return <div className="p-5"><div className="flex gap-2 overflow-x-auto pb-2">{item.fields.map((entry) => <button key={entry.field} onClick={() => onField(entry.field)} className={`focus-ring whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${entry.field === field.field ? "border-[#0b57d0] bg-[#0b57d0] text-white" : "border-slate-200"}`}>{entry.label}</button>)}</div><h3 className="mt-5 text-lg font-bold">{field.label}</h3><div className="mt-3 space-y-3"><EvidenceCard title="Shipping Instruction" source={field.si} /><EvidenceCard title="Draft Bill of Lading" source={field.draftBl} /></div><div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Decision basis</p><p className="mt-2 text-sm leading-6">{field.reason}</p><p className="mt-2 text-sm text-slate-500">{field.normalizationMethod}</p></div></div>;
}

function DraftEditor(props: AssistantProps) {
  const item = props.item!;
  const suggestions = item.fields.filter((field) => field.comparison !== "MATCH" && !item.ignoredSuggestions.includes(field.field));
  return <div className="p-5"><div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><div className="flex items-center gap-3"><PenLine className="h-5 w-5 text-[#0b57d0]" /><div><p className="font-bold text-[#153c78]">Contextual Draft BL assistant</p><p className="text-sm text-blue-800">Applying an edit reprocesses the document from Phase 5.</p></div></div></div><div className="mt-5 space-y-3">{suggestions.map((field) => <div key={field.field} className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-center justify-between gap-3"><p className="font-bold text-rose-900">{field.label}</p><span className="text-xs font-bold text-rose-700">{Math.round(field.decisionConfidence * 100)}%</span></div><dl className="mt-3 grid grid-cols-[70px_1fr] gap-y-1 text-sm"><dt className="text-slate-500">Current</dt><dd className="font-semibold">{field.draftBl.rawValue}</dd><dt className="text-slate-500">SI</dt><dd className="font-semibold">{field.si.rawValue}</dd></dl><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => props.onApply(field.suggestedValue ?? field.si.rawValue, field.field)} className="bg-[#0b57d0] hover:bg-[#0948ae]"><Check className="h-4 w-4" />Apply</Button><Button size="sm" variant="outline" onClick={() => props.onIgnore(field.field)} className="border-slate-300 bg-white"><X className="h-4 w-4" />Ignore</Button><Button size="sm" variant="ghost" onClick={() => props.onField(field.field)}>View evidence</Button></div></div>)}{suggestions.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700" /><p className="mt-2 font-bold text-emerald-900">No unresolved edit suggestions</p><p className="text-sm text-emerald-800">The latest Draft BL values match the SI.</p></div> : null}</div>{props.activeField ? <div className="mt-5 rounded-xl border border-slate-200 p-4"><label className="text-sm font-bold" htmlFor="manual-edit">Manual edit for {props.activeField.label}</label><div className="mt-2 flex gap-2"><Input id="manual-edit" value={props.manualValue} onChange={(event) => props.onManualValue(event.target.value)} placeholder="Enter verified Draft BL value" /><Button onClick={() => props.onApply(props.manualValue, props.activeField?.field)} disabled={!props.manualValue.trim()} className="bg-[#0b57d0]">Apply</Button></div></div> : null}<div className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><span><strong>Processing runs:</strong> {item.processingRuns}</span><span className="text-slate-500">Latest run uses current Draft BL</span></div></div>;
}

function ReviewReasonCard({ item }: { item: GmailCase }) { return <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-violet-700">Human Review reason</p><p className="mt-1 font-bold text-violet-950">{friendlyReason(item.reviewReason)}</p><p className="mt-2 text-sm leading-6 text-violet-800">{item.reviewDetail}</p></div>; }

function EvidenceCard({ title, source }: { title: string; source: FieldComparison["si"] }) { return <article className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><p className="font-bold">{title}</p><span className="text-xs text-slate-500">{source.page ? `Page ${source.page}` : "No page"}</span></div><p className="mt-2 text-sm text-slate-500">{source.document}</p><div className="mt-3 rounded-lg border-l-4 border-[#24aaa3] bg-[#eaf8f6] px-3 py-2 font-mono text-sm">{source.evidenceText}</div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs font-bold uppercase text-slate-400">Raw</p><p className="mt-1 font-semibold">{source.rawValue}</p></div><div><p className="text-xs font-bold uppercase text-slate-400">Normalized</p><p className="mt-1 font-semibold text-[#0d6d7a]">{source.normalizedValue}</p></div></div></article>; }

function CategoryBadge({ category }: { category: EmailCategory }) { const value = categoryPresentation[category]; return <Badge variant="outline" className={value.className}>VeriCargo/{value.label}</Badge>; }

function ComparisonIcon({ comparison }: { comparison: Comparison }) {
  if (comparison === "MATCH") return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-4 w-4" /></span>;
  if (comparison === "MISMATCH") return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-700"><X className="h-4 w-4" /></span>;
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700"><CircleHelp className="h-4 w-4" /></span>;
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "blue" | "violet" | "rose" | "green" }) { const classes = { blue: "bg-blue-50 text-blue-800", violet: "bg-violet-50 text-violet-800", rose: "bg-rose-50 text-rose-800", green: "bg-emerald-50 text-emerald-800" }[tone]; return <div className={`rounded-xl p-4 ${classes}`}><p className="text-2xl font-bold">{value}</p><p className="text-sm font-semibold">{label}</p></div>; }

function friendlyReason(reason: ReviewReason | null) {
  if (!reason) return "Reviewer requested";
  const labels: Record<ReviewReason, string> = {
    LOW_EMAIL_CLASSIFICATION_CONFIDENCE: "Low Email Classification Confidence", UNABLE_TO_DETERMINE_EMAIL_INTENT: "Unable to Determine Email Intent", LOW_DOCUMENT_TYPE_CONFIDENCE: "Low Document Type Confidence", UNREADABLE_ATTACHMENT: "Unreadable Attachment", MISSING_REQUIRED_DOCUMENT: "Missing Required Document", UNREADABLE_DOCUMENT: "Unreadable Document", PROCESSING_FAILURE: "Processing Failure", REPEATED_PROCESSING_FAILURE: "Repeated Processing Failure", MISSING_REQUIRED_VALUE: "Missing Required Value", LOW_EXTRACTION_CONFIDENCE: "Low Extraction Confidence", CONTRADICTORY_EVIDENCE: "Contradictory Evidence", NORMALIZATION_UNRESOLVED: "Normalization Unresolved", AMBIGUOUS_NORMALIZATION: "Ambiguous Normalization", UNABLE_TO_DETERMINE: "Unable to Determine", LOW_CONFIDENCE: "Low Confidence", CRITICAL_GATE_FAILURE: "Critical Gate Failure",
  };
  return labels[reason];
}
