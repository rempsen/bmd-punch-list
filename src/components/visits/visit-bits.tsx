import type React from "react";
import { ExternalLink } from "lucide-react";
import { apWorkOrderUrl } from "@/lib/arriveping/core";
import { Button } from "@/components/ui/button";

/** A pill that, once the visit is in ArrivePing, opens the job there ("See job in ArrivePing"). */
function PillLink({ jobId, className, children }: { jobId?: string | null | undefined; className: string; children: React.ReactNode }) {
  if (!jobId) return <span className={className}>{children}</span>;
  return (
    <a href={apWorkOrderUrl(jobId)} target="_blank" rel="noreferrer" title="See job in ArrivePing" className={`${className} cursor-pointer underline-offset-2 hover:underline hover:brightness-95`}>
      {children}
      <span className="sr-only"> (see job in ArrivePing, opens in a new tab)</span>
    </a>
  );
}

/** The visit's own status, as a small grey tag; a link to the job when it is in ArrivePing. */
export function StatusPill({ label, jobId }: { label: string; jobId?: string | null | undefined }) {
  return <PillLink jobId={jobId} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{label}</PillLink>;
}

/** What ArrivePing says about the visit, as an outlined pill. */
export function ArrivePingPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

/** The work order in ArrivePing, as a button opening it in a new tab (the same size as "Create purchase order" beside it). */
export function OpenInArrivePing({ jobId }: { jobId: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs">
      <a href={apWorkOrderUrl(jobId)} target="_blank" rel="noreferrer">
        Open this job in ArrivePing
        <ExternalLink className="h-3 w-3" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Button>
  );
}

/** Where the crew's acceptance of the work order stands: green once accepted, amber while ArrivePing has it, grey until sent. */
export function AcceptancePill({ badge, jobId }: { badge: { tone: "green" | "orange" | "amber" | "grey"; label: string } | null; jobId?: string | null | undefined }) {
  if (!badge) return null;
  const tone =
    badge.tone === "green"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : badge.tone === "orange"
        ? "border-orange-300 bg-orange-50 text-orange-700"
      : badge.tone === "amber"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-border text-muted-foreground";
  return <PillLink jobId={jobId} className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>{badge.label}</PillLink>;
}
