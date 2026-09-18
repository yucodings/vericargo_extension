"use client";

import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shared/AppShell";
import { CaseFlagBadge } from "@/components/shared/CaseFlagBadge";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReviewStatusBadge } from "@/components/shared/ReviewStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cases } from "@/data/fixtures";

const filters = ["All", "Comparison", "Suggested mismatch", "Human review", "Completed"] as const;
type Filter = typeof filters[number];

export function InboxPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const filtered = useMemo(() => cases.filter((item) => {
    const textMatch = `${item.id} ${item.sender} ${item.subject}`.toLowerCase().includes(query.toLowerCase());
    const filterMatch = filter === "All" || (filter === "Comparison" && item.category === "DOCUMENT_COMPARISON") || (filter === "Suggested mismatch" && item.suggestion === "SUGGESTED_MISMATCH") || (filter === "Human review" && item.reviewStatus !== "CONFIRMED") || (filter === "Completed" && item.reviewStatus === "CONFIRMED");
    return textMatch && filterMatch;
  }), [filter, query]);

  return <AppShell><div className="mx-auto max-w-[1500px]">
    <PageHeader eyebrow="Inbox" title="Cases and routing" description="Review email classification, verification status and the next action for each case." />
    <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex gap-2 overflow-x-auto pb-1">{filters.map((item) => <Button key={item} variant={filter === item ? "default" : "outline"} onClick={() => setFilter(item)} className={filter === item ? "bg-[var(--navy)] hover:bg-[var(--navy)]" : "border-[var(--line)] bg-white"}>{item}</Button>)}</div>
      <div className="flex gap-2"><label className="relative block min-w-0 flex-1 xl:w-80"><span className="sr-only">Search cases</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case, sender or subject" className="h-10 bg-white pl-9" /></label><Button variant="outline" aria-label="More filters" className="border-[var(--line)] bg-white"><SlidersHorizontal /></Button></div>
    </div>
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-white">
      <div className="divide-y divide-[var(--line)] md:hidden">{filtered.map((item) => <article key={item.id} className="p-4"><div className="mb-3 flex items-center justify-between gap-3"><Link href={item.category === "DOCUMENT_COMPARISON" ? `/cases/${item.id}` : "/inbox"} className="focus-ring rounded font-bold text-[var(--ocean)]">{item.id}</Link><span className="text-xs text-[var(--muted)]">{item.receivedAt}</span></div><p className="truncate font-semibold">{item.sender}</p><p className="mb-3 mt-0.5 text-sm text-[var(--muted)]">{item.subject}</p><div className="flex flex-wrap gap-2"><CaseFlagBadge suggestion={item.suggestion} /><ReviewStatusBadge status={item.reviewStatus} /></div></article>)}</div>
      <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow className="bg-[#f8fafb]"><TableHead className="pl-6">Case</TableHead><TableHead>Sender and subject</TableHead><TableHead>Category</TableHead><TableHead>System suggestion</TableHead><TableHead>Review status</TableHead><TableHead className="pr-6 text-right">Received</TableHead></TableRow></TableHeader><TableBody>{filtered.map((item) => <TableRow key={item.id}><TableCell className="pl-6"><Link href={item.category === "DOCUMENT_COMPARISON" ? `/cases/${item.id}` : "/inbox"} className="focus-ring rounded font-bold text-[var(--ocean)] hover:underline">{item.id}</Link></TableCell><TableCell><p className="font-medium">{item.sender}</p><p className="mt-0.5 max-w-[320px] truncate text-sm text-[var(--muted)]">{item.subject}</p></TableCell><TableCell><span className="text-sm font-medium">{item.category.replaceAll("_", " ")}</span></TableCell><TableCell><CaseFlagBadge suggestion={item.suggestion} /></TableCell><TableCell><ReviewStatusBadge status={item.reviewStatus} /></TableCell><TableCell className="pr-6 text-right text-sm text-[var(--muted)]">{item.receivedAt}</TableCell></TableRow>)}</TableBody></Table></div>
      {filtered.length === 0 && <div className="px-6 py-16 text-center"><p className="font-semibold">No cases found</p><p className="mt-1 text-sm text-[var(--muted)]">Try a different search or filter.</p></div>}
    </div>
  </div></AppShell>;
}
