import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { OneDriveMirrorPanel } from "@/components/settings/OneDriveMirrorPanel";
import { Button } from "@/components/ui/button";
import { msConnectStart, msDisconnect, msSendTest, msStatus } from "@/lib/ms/ms.functions";
import { errText } from "@/lib/platform/db";
import { shortDate } from "@/lib/projects/data";

/** Settings → Microsoft 365: each person's own Outlook for sending, and the one shared OneDrive library connection. */
export function Microsoft365Panel({ result, message }: { result?: string | undefined; message?: string | undefined }) {
  const statusFn = useServerFn(msStatus);
  const startFn = useServerFn(msConnectStart);
  const disconnectFn = useServerFn(msDisconnect);
  const testFn = useServerFn(msSendTest);
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery({ queryKey: ["ms-status"], queryFn: () => statusFn() });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (result === "connected") toast.success("Microsoft 365 connected");
    if (result === "error") toast.error(message || "Could not connect Microsoft 365");
  }, [result, message]);

  const connect = async (kind: "mail" | "library") => {
    setBusy(kind);
    try {
      const { url } = await startFn({ data: { kind } });
      window.location.assign(url);
    } catch (e) {
      toast.error(errText(e));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect your Outlook? Quotes can't be sent from your mailbox until you connect again.")) return;
    setBusy("disconnect");
    try {
      await disconnectFn();
      await qc.invalidateQueries({ queryKey: ["ms-status"] });
      toast.success("Disconnected");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const res = await testFn();
      if (res.ok) toast.success("Test sent. Check your inbox and your Sent Items.");
      else toast.error(res.message);
      await qc.invalidateQueries({ queryKey: ["ms-status"] });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !s) return <p className="text-sm text-destructive">Could not load Microsoft 365 status: {errText(error)}</p>;

  return (
    <div className="space-y-4">
      {!s.configured && (
        <Box>
          <h3 className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4 text-amber-600" /> Microsoft 365 isn't set up yet
          </h3>
          {s.canManage ? (
            <div className="mt-2 space-y-2 text-sm text-muted-foreground">
              <p>
                An app registration is needed in your Microsoft Entra admin centre, with this redirect address and three values saved as
                server secrets (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).
              </p>
              <p>
                Redirect address: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{window.location.origin}/api/ms/callback</code>
              </p>
              <p>Delegated permissions: Mail.Send, Files.ReadWrite.All, offline_access, User.Read, with admin consent.</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Ask a BMD admin to finish the Microsoft 365 set-up.</p>
          )}
        </Box>
      )}

      {(s.canSend || s.canManage) && (
        <Box>
          <h3 className="flex items-center gap-2 font-semibold">
            <Mail className="h-4 w-4" /> My Outlook
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Quotes you send go out from your own mailbox, land in your Sent Items, and replies come back to you.
          </p>
          {s.mine ? (
            <>
              <Status email={s.mine.account_email} since={s.mine.connected_at} problem={s.mine.last_error} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button className="h-11" variant="outline" disabled={!!busy} onClick={() => void test()}>
                  {busy === "test" ? "Sending…" : "Send me a test"}
                </Button>
                <Button className="h-11" variant="outline" disabled={!!busy || !s.configured} onClick={() => void connect("mail")}>
                  Reconnect
                </Button>
                <Button className="h-11" variant="ghost" disabled={!!busy} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <Button className="mt-3 h-11" disabled={!!busy || !s.configured} onClick={() => void connect("mail")}>
              {busy === "mail" ? "Opening Microsoft…" : "Connect Outlook"}
            </Button>
          )}
        </Box>
      )}

      {s.canManage && (
        <Box>
          <h3 className="font-semibold">OneDrive library connection</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            One account whose OneDrive holds the Customer › Project folders. Project documents are copied there; nothing in OneDrive is
            ever renamed, moved or deleted by this app.
          </p>
          {s.library ? (
            <>
              <Status email={s.library.account_email} since={s.library.connected_at} problem={s.library.last_error} />
            </>
          ) : (
            <p className="mt-2 text-sm">Not connected.</p>
          )}
          <Button className="mt-3 h-11" variant={s.library ? "outline" : "default"} disabled={!!busy || !s.configured} onClick={() => void connect("library")}>
            {busy === "library" ? "Opening Microsoft…" : s.library ? (s.library.isMe ? "Reconnect the library account" : "Use my account instead") : "Connect my OneDrive as the library"}
          </Button>
          {s.library && <OneDriveMirrorPanel rootPath={s.library.onedrive_root_path} />}
        </Box>
      )}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-4 md:p-5">{children}</section>;
}

function Status({ email, since, problem }: { email: string; since: string; problem: string | null }) {
  return problem ? (
    <p className="mt-2 flex items-start gap-2 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {email} needs to be reconnected. <span className="text-muted-foreground">({problem})</span>
      </span>
    </p>
  ) : (
    <p className="mt-2 flex items-center gap-2 text-sm">
      <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Connected as <strong>{email}</strong>
      <span className="text-muted-foreground">since {shortDate(since)}</span>
    </p>
  );
}
