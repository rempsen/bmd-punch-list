import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { dayLong } from "@/lib/scheduling/assignments";
import { getAssignment, respondAssignment, type AssignmentView } from "@/lib/scheduling/assignments.functions";

/**
 * A crew's assignment page, opened from the email. No sign-in: the link's secret is the key. One tap confirms or declines.
 * Shows only the job name, address, date, and where and when to report. Search engines are told to stay away.
 * The answer is only ever saved by a tap on this page, so a mail scanner that opens the link changes nothing.
 */
export const Route = createFileRoute("/confirm/$token")({
  validateSearch: (s: Record<string, unknown>): { a?: "yes" | "no" } => (s["a"] === "yes" || s["a"] === "no" ? { a: s["a"] } : {}),
  loader: async ({ params }) => {
    const view = /^[A-Za-z0-9_-]{43}$/.test(params.token) ? await getAssignment({ data: { token: params.token } }) : null;
    if (!view) throw notFound();
    return view;
  },
  headers: () => ({ "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" }),
  head: () => ({ meta: [{ title: "Your assignment" }, { name: "robots", content: "noindex, nofollow, noarchive" }, { name: "referrer", content: "no-referrer" }] }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">This link is not available</h1>
      <p className="mt-2 text-muted-foreground">It may have been replaced by a newer message. Check your latest email, or call the office.</p>
    </main>
  ),
  component: Page,
});

function Page() {
  const first = Route.useLoaderData();
  const { token } = Route.useParams();
  const { a } = Route.useSearch();
  const respond = useServerFn(respondAssignment);
  const [view, setView] = useState<AssignmentView>(first);
  const [mode, setMode] = useState<"choose" | "decline">(a === "no" && first.state === "open" ? "decline" : "choose");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (which: "confirmed" | "declined") => {
    setBusy(true);
    setError(null);
    try {
      const next = await respond({ data: { token, answer: which, ...(which === "declined" && reason.trim() ? { reason: reason.trim() } : {}) } });
      if (next) setView(next);
      setMode("choose");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save that. Please try again, or call the office.");
    } finally {
      setBusy(false);
    }
  };

  const gone = view.state === "expired" || view.state === "replaced";
  const big = "flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border px-4 text-lg font-semibold disabled:opacity-60";
  return (
    <main className="mx-auto min-h-screen max-w-md space-y-5 bg-background p-5 text-foreground">
      <header>
        {view.company && <p className="text-sm font-medium text-muted-foreground">{view.company}</p>}
        <h1 className="text-2xl font-semibold">{dayLong(view.day)}</h1>
        <p className="text-muted-foreground">Hi {view.crewName}</p>
      </header>

      {gone ? (
        <p className="rounded-lg border border-border bg-muted/50 p-4">
          {view.state === "expired" ? "This day has passed, so this link no longer works." : "This assignment has changed. Check your latest email, or call the office."}
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {view.visits.map((v, i) => (
              <li key={i} className="rounded-lg border border-border bg-card p-4">
                <p className="text-lg font-semibold">{v.job}</p>
                {v.address && <p className="text-muted-foreground">{v.address}</p>}
                <p className="mt-2">
                  Report to <span className="font-semibold">{v.reportTo}</span> for <span className="font-semibold">{v.reportAt}</span>
                </p>
              </li>
            ))}
          </ul>

          {view.state === "confirmed" && mode === "choose" && (
            <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-lg font-semibold text-emerald-900">
              <Check className="h-6 w-6" aria-hidden /> Confirmed. Thank you.
            </p>
          )}
          {view.state === "declined" && mode === "choose" && (
            <p role="status" className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950">
              <span className="flex items-center gap-2 text-lg font-semibold">
                <X className="h-6 w-6" aria-hidden /> You said you can't make it.
              </span>
              {view.declineReason && <span className="mt-1 block">“{view.declineReason}”</span>}
              <span className="mt-1 block text-sm">The office has been told.</span>
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">
              {error}
            </p>
          )}

          {mode === "decline" ? (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm font-medium">
                Reason (optional)
                <input
                  className="h-12 w-full rounded-lg border border-input bg-background px-3 text-base"
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. truck is in the shop"
                />
              </label>
              <button type="button" disabled={busy} onClick={() => void answer("declined")} className={`${big} border-amber-500 bg-amber-500 text-black`}>
                <X className="h-5 w-5" aria-hidden /> {busy ? "Saving…" : "Can't make it"}
              </button>
              <button type="button" disabled={busy} onClick={() => setMode("choose")} className="min-h-11 w-full text-sm underline">
                Back
              </button>
            </div>
          ) : view.state === "open" ? (
            <div className="space-y-3">
              <button type="button" disabled={busy} onClick={() => void answer("confirmed")} className={`${big} border-primary bg-primary text-primary-foreground`}>
                <Check className="h-5 w-5" aria-hidden /> {busy ? "Saving…" : "Confirm"}
              </button>
              <button type="button" disabled={busy} onClick={() => setMode("decline")} className={`${big} border-border bg-background`}>
                Can't make it
              </button>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => (view.state === "confirmed" ? setMode("decline") : void answer("confirmed"))} className="min-h-11 w-full text-sm underline">
              {view.state === "confirmed" ? "Something changed? Tell us you can't make it" : "I can make it after all — confirm"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
