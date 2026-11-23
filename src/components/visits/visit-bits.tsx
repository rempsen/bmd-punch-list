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
