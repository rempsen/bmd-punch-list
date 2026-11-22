/** The client's private link: what it shows, what the client may choose, and when an acceptance stands. */
import type { ClientChoice } from "@/lib/estimating/worksheet";
import { snapshotTotals, type QuoteSnapshot, type SnapLine } from "./logic";

export type Choices = Record<string, ClientChoice>;
type QuoteForLink = { number: string; status: "draft" | "sent" | "accepted" | "declined" | "superseded"; revision: number; snapshot: QuoteSnapshot | null };
type Acceptance = { name: string; accepted_at: string; version_id: string; total_cents: number };

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PublicView =
  | { state: "replaced" | "closed"; number: string }
  | { state: "open" | "accepted"; number: string; revision: number; snapshot: QuoteSnapshot; choices: Choices; expired: boolean; accepted: { name: string; at: string; versionId: string; totalCents: number } | null };

/** Everything the client's browser is given. Built from the frozen client-safe snapshot and nothing else. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Winnipeg" });
/** The last day a quote can be accepted (its date plus its validity), as YYYY-MM-DD. */
export function lastValidDay(snap: QuoteSnapshot): string {
  const d = new Date(`${snap.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + snap.validityDays);
  return d.toISOString().slice(0, 10);
}

export function publicView(quote: QuoteForLink, link: { choices: Record<string, unknown> | null }, acceptance: Acceptance | null, now: string = today()): PublicView {
  if (quote.status === "superseded") return { state: "replaced", number: quote.number };
  if (!quote.snapshot || (quote.status !== "sent" && quote.status !== "accepted")) return { state: "closed", number: quote.number };
  return {
    state: quote.status === "accepted" ? "accepted" : "open",
    number: quote.number,
    revision: quote.revision,
    snapshot: quote.snapshot,
    choices: cleanChoices(quote.snapshot, link.choices ?? {}),
    expired: quote.status === "sent" && now > lastValidDay(quote.snapshot),
    accepted: quote.status === "accepted" && acceptance ? { name: acceptance.name, at: acceptance.accepted_at, versionId: acceptance.version_id, totalCents: acceptance.total_cents } : null,
  };
}

const linesOf = (snap: QuoteSnapshot, versionId?: string): SnapLine[] => snap.versions.filter((v) => !versionId || v.id === versionId).flatMap((v) => v.sections.flatMap((s) => s.lines));

/** Drops anything that is not a yes, no or maybe for a line the client is allowed to decide. */
export function cleanChoices(snap: QuoteSnapshot, raw: Record<string, unknown>): Choices {
  const open = new Set(linesOf(snap).filter((l) => l.selection !== "required").map((l) => l.id));
  const out: Choices = {};
  for (const [id, c] of Object.entries(raw ?? {})) if (open.has(id) && (c === "yes" || c === "no" || c === "maybe")) out[id] = c;
  return out;
}

export type AcceptInput = { versionId: string; choices: Record<string, unknown>; revision: number; expectedTotalCents: number; name: string; email: string };
export type AcceptCheck = { ok: true; versionId: string; valueCents: number; totalCents: number; choices: Choices } | { ok: false; message: string; reload?: true };

/** Decides whether an acceptance stands, from the stored quote alone. The browser's figures are only compared, never used. */
export function checkAcceptance(quote: QuoteForLink, input: AcceptInput, now: string = today()): AcceptCheck {
  const stale: AcceptCheck = { ok: false, reload: true, message: "This quotation has changed since you opened it. Reload the page to see the current one." };
  if (quote.status !== "sent" || !quote.snapshot || input.revision !== quote.revision) return stale;
  const snap = quote.snapshot;
  if (now > lastValidDay(snap)) return { ok: false, message: `This quotation expired on ${new Date(`${lastValidDay(snap)}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}. Please contact us for a current price.` };
  const version = snap.versions.find((v) => v.id === input.versionId);
  if (!version) return { ok: false, message: "Choose which option you are accepting." };
  if (input.name.trim().length < 2) return { ok: false, message: "Type your full name to accept." };
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(input.email.trim())) return { ok: false, message: "Enter your email address." };

  const lines = linesOf(snap, version.id);
  const all = cleanChoices(snap, input.choices);
  const choices: Choices = Object.fromEntries(lines.filter((l) => all[l.id]).map((l) => [l.id, all[l.id]!]));
  const undecided = lines.filter((l) => l.selection === "optional" && choices[l.id] !== "yes" && choices[l.id] !== "no");
  if (undecided.length) return { ok: false, message: `Please choose Yes or No for: ${undecided.map((l) => l.description).join(", ")}.` };
  const groups = new Map<string, SnapLine[]>();
  for (const l of lines) if (l.selection === "choose_one") groups.set(l.group ?? l.id, [...(groups.get(l.group ?? l.id) ?? []), l]);
  const open = [...groups].filter(([, members]) => members.filter((m) => choices[m.id] === "yes").length !== 1).map(([name]) => name);
  if (open.length) return { ok: false, message: `Please choose one option for: ${open.join(", ")}.` };

  const totals = snapshotTotals(version, choices, { gstPct: snap.gstPct, hstPct: snap.hstPct });
  if (totals.totalCents !== input.expectedTotalCents) return { ok: false, reload: true, message: "The price on this page is out of date. Reload the page and review it again." };
  return { ok: true, versionId: version.id, valueCents: totals.subtotalCents, totalCents: totals.totalCents, choices };
}
