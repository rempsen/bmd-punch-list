import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { checkMailboxNow } from "@/lib/intake.functions";
import { cn } from "@/lib/utils";

type Row = { id: string; subject: string | null; from_name: string | null; from_email: string | null; received_at: string | null; deficiency_id: string | null; status: string; error: string | null };

const STATUS: Record<string, { l: string; c: string }> = {
  needs_review: { l: "Needs review", c: "bg-amber-100 text-amber-900" },
  error: { l: "Couldn't read", c: "bg-destructive/15 text-destructive" },
  parsed: { l: "Added", c: "bg-muted text-muted-foreground" },
  reviewed: { l: "Reviewed", c: "bg-muted text-muted-foreground" },
};

function ago(s: string | null) {
  if (!s) return "";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(s).toLocaleDateString();
}

export function EmailInbox() {
  const qc = useQueryClient();
  const sync = useServerFn(checkMailboxNow);
  const [busy, setBusy] = useState(false);
  const { data: rows = [] } = useQuery({
    queryKey: ["email-intake", "inbox"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_intake")
        .select("id,subject,from_name,from_email,received_at,deficiency_id,status,error")
        .order("received_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data as Row[];
    },
  });
  const pending = rows.filter((r) => r.status === "needs_review" || r.status === "error").length;

  const run = async () => {
    setBusy(true);
    try {
      const r = await sync();
      toast.success(r.created ? `${r.created} new item${r.created === 1 ? "" : "s"} from email` : "No new emails");
      void qc.invalidateQueries({ queryKey: ["email-intake"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-4 mt-4 rounded-lg border border-border bg-card md:mx-6">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Email inbox</h2>
          {pending > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{pending} to review</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={run} disabled={busy}>
            <RefreshCw className={cn("mr-1 h-4 w-4", busy && "animate-spin")} />
            {busy ? "Syncing…" : "Sync now"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/email-intake">Open intake</Link>
          </Button>
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No emails yet. Forward issues to dan+ingest@bmdmaterials.com.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const s = STATUS[r.status] ?? { l: "Added", c: "bg-muted text-muted-foreground" };
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.subject || "(no subject)"}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.from_name || r.from_email} · {ago(r.received_at)}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", s.c)}>{s.l}</span>
              </>
            );
            return (
              <li key={r.id}>
                {r.deficiency_id ? (
                  <Link to="/item/$id" params={{ id: r.deficiency_id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted">{body}</Link>
                ) : (
                  <Link to="/email-intake" className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted">{body}</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
