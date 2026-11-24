/** The company-wide Estimates & Quotes list: pure rules, no data access. */
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "superseded";
export const QUOTE_STATUSES: { value: QuoteStatus; label: string; cls: string }[] = [
  { value: "draft", label: "Draft", cls: "bg-muted text-muted-foreground" },
  { value: "sent", label: "Sent", cls: "bg-blue-100 text-blue-900" },
  { value: "accepted", label: "Accepted", cls: "bg-emerald-100 text-emerald-900" },
  { value: "declined", label: "Declined", cls: "bg-red-100 text-red-900" },
  { value: "superseded", label: "Superseded", cls: "bg-muted text-muted-foreground" },
];

export type ListQuote = { id: string; project_id: string; number: string; status: QuoteStatus; value_cents: number | null; accepted_value_cents: number | null; sent_at: string | null; accepted_at: string | null; created_at: string };

/** The quote to show for a project: the newest one still in play, else the newest. */
export function latestQuote(quotes: ListQuote[]): ListQuote | null {
  const byNew = [...quotes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return byNew.find((q) => q.status !== "superseded") ?? byNew[0] ?? null;
}

export const quoteTotal = (q: ListQuote | null): number | null => (!q ? null : q.status === "accepted" ? (q.accepted_value_cents ?? q.value_cents) : q.value_cents);

export type ListRow = { projectId: string; hasEstimate: boolean; quote: ListQuote | null };

/** Summary strip: estimates with no quote, quotes out (sent) with their total, and quotes won this calendar month. */
export function listSummary(rows: ListRow[], now: Date) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let noQuote = 0, outCount = 0, outCents = 0, wonCents = 0;
  for (const r of rows) {
    if (r.hasEstimate && !r.quote) noQuote += 1;
    if (r.quote?.status === "sent") {
      outCount += 1;
      outCents += r.quote.value_cents ?? 0;
    }
    if (r.quote?.status === "accepted" && r.quote.accepted_at?.slice(0, 7) === month) wonCents += quoteTotal(r.quote) ?? 0;
  }
  return { noQuote, outCount, outCents, wonCents };
}
