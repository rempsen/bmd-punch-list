import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { SignaturePad } from "@/components/signoff/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, errText } from "@/lib/platform/db";
import { KIND_LABEL, linkState, OUTCOME_LABEL, type InspectionKind, type Outcome } from "@/lib/signoff/logic";

export const Route = createFileRoute("/_authenticated/sign/$token")({
  head: () => ({
    meta: [
      { title: "Sign off your installation · BMD Materials" },
      { name: "description", content: "Review the inspection summary and sign off the installation." },
      { property: "og:title", content: "Sign off your installation · BMD Materials" },
      { property: "og:description", content: "Review and sign off the installation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SignPage,
});

type Row = {
  id: string; signed_by_name: string; signed_at: string | null; link_expires_at: string | null;
  project: { name: string; address: string | null } | null;
  inspection: { kind: InspectionKind; held_at: string | null; outcome: Outcome; inspection_items: { result: string }[] } | null;
};

function SignPage() {
  const { token } = Route.useParams();
  const q = useQuery({
    queryKey: ["sign-link", token],
    queryFn: async () => {
      if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
      const { data, error } = await db.from("signoffs").select("id,signed_by_name,signed_at,link_expires_at,project:projects(name,address),inspection:inspections(kind,held_at,outcome,inspection_items(result))").eq("id", token).maybeSingle();
      if (error) throw error;
      return data as Row | null;
    },
  });
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (q.isLoading) return <main className="mx-auto max-w-xl p-6 text-sm text-muted-foreground">Loading…</main>;
  const row = q.data;
  if (!row) return <main className="mx-auto max-w-xl p-6"><h1 className="text-xl font-semibold">This link is not available</h1><p className="mt-2 text-sm text-muted-foreground">It may be for another account. Sign in with the email the link was sent to, or contact BMD at office@bmdmaterials.com.</p></main>;
  const state = done ? "signed" : linkState(row);
  const items = row.inspection?.inspection_items ?? [];
  const sign = async () => {
    setBusy(true);
    const { error } = await db.rpc("sign_signoff", { _id: row.id, _name: name || row.signed_by_name, _signature: sig });
    setBusy(false);
    if (error) return void toast.error(errText(error));
    setDone(true);
    toast.success("Thank you — sign-off recorded.");
  };
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <img src="/bmd-logo.png" alt="BMD Materials" className="w-32" />
      <h1 className="text-2xl font-semibold">Installation sign-off</h1>
      <section className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">{row.project?.name}</p>
        {row.project?.address && <p className="text-muted-foreground">{row.project.address}</p>}
        {row.inspection && (
          <p className="mt-2">{KIND_LABEL[row.inspection.kind]} on {row.inspection.held_at?.slice(0, 10)} — <b>{OUTCOME_LABEL[row.inspection.outcome]}</b>. {items.filter((i) => i.result === "ok").length} of {items.length} areas OK{items.some((i) => i.result === "deficient") ? `, ${items.filter((i) => i.result === "deficient").length} recorded as deficiencies to fix` : ""}.</p>
        )}
      </section>
      {state === "signed" ? (
        <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" />Signed. Thank you.</p>
      ) : state === "expired" ? (
        <p className="text-sm text-destructive">This link has expired. Ask BMD for a new one.</p>
      ) : (
        <section className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <p>By signing you confirm the installation is complete and accepted{row.inspection?.outcome === "passed_with_items" ? ", subject to the recorded deficiencies being fixed" : ""}.</p>
          <label className="block">Your name<Input value={name} placeholder={row.signed_by_name} onChange={(e) => setName(e.target.value)} /></label>
          <SignaturePad onChange={setSig} />
          <Button className="w-full" disabled={busy || !sig} onClick={() => void sign()}>Sign off</Button>
        </section>
      )}
      <Link to="/" className="text-sm text-primary underline">Go to the app</Link>
    </main>
  );
}
