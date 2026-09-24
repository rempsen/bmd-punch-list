import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { FileText, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { summarisePunchList } from "@/lib/summary.functions";

export function AiSummary() {
  const run = useServerFn(summarisePunchList);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const r = await run();
      setText(r.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the summary.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Punch list summary</h2>
          <p className="text-xs text-muted-foreground">AI-written overview of all items — check before sending.</p>
        </div>
        <div className="flex gap-2">
          {text && (
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}>
              <Copy className="mr-1 h-4 w-4" /> Copy
            </Button>
          )}
          <Button size="sm" onClick={go} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
            {busy ? "Writing…" : text ? "Refresh" : "Summarise"}
          </Button>
        </div>
      </div>
      {text && (
        <div className="prose prose-sm mt-3 max-w-none text-foreground [&_li]:my-0.5 [&_ul]:pl-5 [&_ul]:list-disc [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_p]:my-2">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
