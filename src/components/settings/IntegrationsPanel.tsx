import { Link } from "@tanstack/react-router";
import { Camera } from "lucide-react";
import { ArrivePingCard } from "@/components/settings/ArrivePingCard";
import { Microsoft365Panel } from "@/components/settings/Microsoft365Panel";
import { QuickBooksPanel } from "@/components/settings/QuickBooksPanel";
import { SettingsBox } from "@/components/settings/SettingsBox";

/** Settings → Integrations: every outside system BMD connects to, on one page. */
export function IntegrationsPanel({
  result,
  qboResult,
  message,
}: {
  result?: string | undefined;
  qboResult?: string | undefined;
  message?: string | undefined;
}) {
  return (
    <div className="space-y-4">
      <ArrivePingCard />
      <Microsoft365Panel result={result} message={message} />

      <SettingsBox aria-labelledby="companycam-heading">
        <h3 id="companycam-heading" className="flex items-center gap-2 font-semibold">
          <Camera className="h-4 w-4" aria-hidden /> CompanyCam
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Connection, job linking, photo inbox, sync log and sync options for this job.
        </p>
        <Link
          to="/companycam"
          className="mt-3 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Open CompanyCam settings
        </Link>
      </SettingsBox>

      <QuickBooksPanel result={qboResult} message={message} />
    </div>
  );
}
