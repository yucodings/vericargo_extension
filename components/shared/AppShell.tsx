"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ClipboardCheck, FileSearch, Inbox, LayoutDashboard, Menu, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/review", label: "Human review", icon: ClipboardCheck },
  { href: "/audit", label: "Audit trail", icon: FileSearch },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[var(--paper)] lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className={`fixed inset-y-0 left-0 z-40 w-[250px] bg-[var(--navy)] text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
          <Link href="/" className="focus-ring flex items-center gap-3 rounded-md" onClick={() => setOpen(false)}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lg font-extrabold text-[var(--navy)]">B</span>
            <span><strong className="block text-xl tracking-[0.12em]">BLiNK</strong><small className="block text-xs text-slate-300">Shipping verification</small></span>
          </Link>
          <button className="focus-ring rounded-md p-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <nav className="px-3 py-6" aria-label="Primary navigation">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
          <ul className="space-y-1">{navigation.map((item) => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <li key={item.href}><Link href={item.href} onClick={() => setOpen(false)} className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium ${active ? "bg-white text-[var(--navy)]" : "text-slate-200 hover:bg-white/10"}`}><item.icon className="h-5 w-5" />{item.label}</Link></li>; })}</ul>
        </nav>
        <div className="absolute inset-x-4 bottom-5 border-t border-white/10 pt-5"><div className="flex items-start gap-3 rounded-lg bg-white/8 p-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#55d8c8]" /><div><p className="text-sm font-semibold">Human-controlled</p><p className="mt-0.5 text-xs leading-5 text-slate-300">Every verification requires reviewer confirmation.</p></div></div></div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation overlay" />}
      <div className="min-w-0 lg:col-start-2">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-[var(--line)] bg-white/95 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3"><button className="focus-ring rounded-lg border border-[var(--line)] p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button><div><p className="text-sm text-[var(--muted)]">Operations workspace</p><p className="font-semibold text-[var(--ink)]">Document verification</p></div></div>
          <div className="flex items-center gap-3"><button className="focus-ring relative rounded-lg border border-[var(--line)] p-2.5 text-[var(--navy)]" aria-label="Notifications"><Bell className="h-5 w-5" /><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#e15c4f] ring-2 ring-white" /></button><div className="hidden h-9 w-px bg-[var(--line)] sm:block" /><div className="hidden text-right sm:block"><p className="text-sm font-semibold">Aina Rahman</p><p className="text-xs text-[var(--muted)]">Senior reviewer</p></div><span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--sky)] text-sm font-bold text-[var(--ocean)]">AR</span></div>
        </header>
        <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
