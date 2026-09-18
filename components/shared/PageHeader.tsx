export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-1 text-sm font-semibold uppercase tracking-[0.13em] text-[var(--ocean)]">{eyebrow}</p><h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-[2.2rem]">{title}</h1><p className="mt-2 max-w-3xl text-[var(--muted)]">{description}</p></div>{actions}</div>;
}
