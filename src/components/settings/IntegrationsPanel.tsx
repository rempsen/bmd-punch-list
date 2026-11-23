import { ArrivePingCard } from "@/components/settings/ArrivePingCard";
import { CompanyCamCard } from "@/components/settings/CompanyCamCard";
import { Microsoft365Panel } from "@/components/settings/Microsoft365Panel";
import { QuickBooksPanel } from "@/components/settings/QuickBooksPanel";

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

      <CompanyCamCard />

      <QuickBooksPanel result={qboResult} message={message} />
    </div>
  );
}
