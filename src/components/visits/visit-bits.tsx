import { ExternalLink } from "lucide-react";
import { apWorkOrderUrl } from "@/lib/arriveping/core";

/** The visit's own status, as a small grey tag. */
export function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{label}</span>
  );
}

/** What ArrivePing says about the visit, as an outlined pill. */
export function ArrivePingPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

/** Link to the work order in ArrivePing, opening in a new tab. */
export function OpenInArrivePing({ jobId }: { jobId: string }) {
  return (
    <a
      href={apWorkOrderUrl(jobId)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      Open in ArrivePing
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Where the crew's acceptance of the work order stands: green once accepted, amber while ArrivePing has it, grey until sent. */
export function AcceptancePill({ badge }: { badge: { tone: "green" | "orange" | "amber" | "grey"; label: string } | null }) {
  if (!badge) return null;
  const tone =
    badge.tone === "green"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : badge.tone === "orange"
        ? "border-orange-300 bg-orange-50 text-orange-700"
      : badge.tone === "amber"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-border text-muted-foreground";
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>{badge.label}</span>;
}
