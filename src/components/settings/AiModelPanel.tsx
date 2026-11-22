import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { aiModelStatus } from "@/lib/ai/scope.functions";
import { MINIMUM_LABEL } from "@/lib/ai/model";

/** Shows which AI model the reading and matching features use, and proves it answers. */
export function AiModelPanel() {
  const check = useServerFn(aiModelStatus);
  const [state, setState] = useState<Awaited<ReturnType<typeof check>> | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">AI model</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reading specs and suggesting finishes uses the strongest Claude model the app's AI connection offers, and never one below {MINIMUM_LABEL}. If nothing at that level is available, the feature is switched off rather than use a weaker model.
      </p>
      <Button
        className="mt-3"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void check()
            .then(setState, (e) => setState({ ok: false, message: e instanceof Error ? e.message : String(e), tried: [] }))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Checking…" : "Check the AI model"}
      </Button>
      {state && (
        <p role="status" className={`mt-3 text-sm ${state.ok ? "text-emerald-800" : "text-amber-800"}`}>
          {state.ok ? `Using ${state.model}. It answered "${state.reply}".` : state.message}
          {!state.ok && "claude" in state && state.claude?.length ? ` Claude models on offer: ${state.claude.join(", ")}.` : ""}
          {state.ok && state.skipped.length > 0 ? ` (${state.skipped.length} other way${state.skipped.length === 1 ? "" : "s"} of asking were refused first; that is handled automatically.)` : ""}
        </p>
      )}
      {state && !state.ok && "tried" in state && state.tried && state.tried.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground" open>
          <summary className="cursor-pointer">What was tried</summary>
          <ul className="mt-1 list-disc pl-5">
            {state.tried.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
