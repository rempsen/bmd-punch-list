import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Camera, CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { SettingsBox } from "@/components/settings/SettingsBox";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ccCompanyStatus, ccWebhook } from "@/lib/companycam.functions";
import { errText } from "@/lib/platform/db";

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "";

/**
 * Settings → Integrations → CompanyCam. The company-wide parts live here and need no job: whether BMD can reach
 * CompanyCam, and the webhook that brings jobsite photos in as they are taken. Linking a job and its photo inbox stay
 * on the job's own CompanyCam page.
 */
export function CompanyCamCard() {
  const { currentJob } = useAuth();
  const statusFn = useServerFn(ccCompanyStatus);
  const hookFn = useServerFn(ccWebhook);
  const qc = useQueryClient();
  const {
    data: s,
    isLoading,
    error,
  } = useQuery({ queryKey: ["cc-company-status"], queryFn: () => statusFn() });
  const [busy, setBusy] = useState<"register" | "remove" | null>(null);

  const webhook = async (action: "register" | "remove") => {
    setBusy(action);
    try {
      await hookFn({ data: { action } });
      toast.success(
        action === "register"
          ? "Webhook registered — new photos will come in as they're taken"
          : "Webhook removed",
      );
    } catch (e) {
      toast.error(errText(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ["cc-company-status"] });
      await qc.invalidateQueries({ queryKey: ["cc-status"] });
      setBusy(null);
    }
  };

  return (
    <SettingsBox aria-labelledby="companycam-heading">
      <h3 id="companycam-heading" className="flex items-center gap-2 font-semibold">
        <Camera className="h-4 w-4" aria-hidden /> CompanyCam
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Jobsite photos from CompanyCam come into the job they belong to. Link each job on its own
        CompanyCam page.
      </p>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : error || !s ? (
        <p className="mt-3 text-sm text-destructive">Could not load CompanyCam: {errText(error)}</p>
      ) : (
        <>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
            <div className="grid gap-1 sm:contents">
              <dt className="text-muted-foreground">Connection</dt>
              <dd>
                {s.connected ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Connected to{" "}
                    {s.company}
                  </span>
                ) : (
                  <span className="inline-flex items-start gap-1.5">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <span>
                      {s.error
                        ? `CompanyCam refused the connection: ${s.error}`
                        : "Not connected — add server secret "}
                      {!s.error && (
                        <code className="rounded bg-muted px-1.5 py-0.5">COMPANYCAM_API_TOKEN</code>
                      )}
                    </span>
                  </span>
                )}
              </dd>
            </div>
            <div className="grid gap-1 sm:contents">
              <dt className="text-muted-foreground">Live photos</dt>
              <dd>
                {s.webhook?.webhook_id ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Webhook
                    registered {when(s.webhook.created_at)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Not registered — photos arrive on Sync now or the 3-hour check
                  </span>
                )}
              </dd>
            </div>
            <div className="grid gap-1 sm:contents">
              <dt className="text-muted-foreground">Linked jobs</dt>
              <dd>{s.linkedJobs}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className="h-11"
              disabled={!s.connected || busy !== null}
              onClick={() => void webhook("register")}
            >
              {busy === "register"
                ? "Registering…"
                : s.webhook?.webhook_id
                  ? "Re-register webhook"
                  : "Register webhook"}
            </Button>
            {s.webhook?.webhook_id && (
              <Button
                className="h-11"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void webhook("remove")}
              >
                {busy === "remove" ? "Removing…" : "Remove webhook"}
              </Button>
            )}
            {currentJob ? (
              <Link
                to="/companycam"
                className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-medium"
              >
                {currentJob.name}: link and photo inbox
              </Link>
            ) : (
              <Link
                to="/jobs"
                className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-medium"
              >
                Choose a job to link it
              </Link>
            )}
          </div>
        </>
      )}
    </SettingsBox>
  );
}
