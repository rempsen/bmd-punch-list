import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { FileText, History, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { askAssistant, type AskResult } from "@/lib/assistant/assistant.functions";
import { deleteConversation, useConversations, useMessages } from "@/lib/assistant/data";
import type { Source } from "@/lib/assistant/prompt";
import { cn } from "@/lib/utils";

/** Whether this person is offered the assistant: BMD staff (anyone who sees the pipeline), never trades, clients or viewers. */
export function useAssistantAllowed(): boolean {
  const { isSuperAdmin, canAny } = useAuth();
  return isSuperAdmin || canAny("view_pipeline");
}

type Shown = { id: string; role: "user" | "assistant"; content: string; sources?: Source[]; pending?: boolean };

/** The "Ask BMD" side window: a question box, the answers with their sources, and the person's earlier conversations. */
export function AssistantPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { currentJob, canAny, isSuperAdmin } = useAuth();
  const canRemember = isSuperAdmin || canAny("manage_settings");
  const ask = useServerFn(askAssistant);
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown[]>([]);
  const { data: conversations = [] } = useConversations(open && showHistory);
  const { data: stored } = useMessages(conversationId);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // Opening an earlier conversation shows its stored messages (sources are not stored; the lookups are, for tracing).
  useEffect(() => {
    if (stored && conversationId) setShown((cur) => (cur.some((m) => m.pending) ? cur : stored.map((m) => ({ id: m.id, role: m.role, content: m.content }))));
  }, [stored, conversationId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [shown]);
  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 50);
  }, [open]);

  const startNew = () => {
    setConversationId(null);
    setShown([]);
    setShowHistory(false);
    setDraft("");
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    const tempId = crypto.randomUUID();
    setShown((cur) => [...cur, { id: `${tempId}-q`, role: "user", content: message }, { id: tempId, role: "assistant", content: "", pending: true }]);
    try {
      const r: AskResult = await ask({ data: { conversationId, projectId: conversationId ? null : (currentJob?.id ?? null), message } });
      setConversationId(r.conversationId);
      setShown((cur) => cur.map((m) => (m.id === tempId ? { id: tempId, role: "assistant", content: r.answer, sources: r.sources } : m)));
      void qc.invalidateQueries({ queryKey: ["assistant-conversations"] });
      if (r.remembered) void qc.invalidateQueries({ queryKey: ["knowledge"] });
    } catch (e) {
      setShown((cur) => cur.map((m) => (m.id === tempId ? { id: tempId, role: "assistant", content: `Sorry — ${errText(e)}` } : m)));
    } finally {
      setBusy(false);
      setTimeout(() => box.current?.focus(), 0);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" aria-describedby="ask-bmd-description">
        <SheetHeader className="border-b border-border px-4 py-3 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Ask BMD
          </SheetTitle>
          <SheetDescription id="ask-bmd-description" className="text-xs">
            {currentJob ? `Answers from the company's records and from job "${currentJob.name}". ` : "Answers from the company's records. "}
            It only reads; it never changes or sends anything.
          </SheetDescription>
          <div className="mt-1 flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={startNew}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New
            </Button>
            <Button size="sm" variant={showHistory ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setShowHistory((v) => !v)}>
              <History className="mr-1 h-3.5 w-3.5" /> Earlier
            </Button>
          </div>
        </SheetHeader>

        {showHistory ? (
          <ul className="flex-1 overflow-y-auto px-2 py-2 text-sm">
            {conversations.length === 0 && <li className="px-2 py-6 text-center text-muted-foreground">No earlier conversations.</li>}
            {conversations.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn("flex-1 truncate rounded-md px-2 py-1.5 text-left hover:bg-muted", c.id === conversationId && "bg-muted")}
                  onClick={() => {
                    setConversationId(c.id);
                    setShown([]);
                    setShowHistory(false);
                  }}
                >
                  <MessageSquare className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
                  {c.title || "Conversation"}
                  <span className="ml-2 text-xs text-muted-foreground">{new Date(c.updated_at).toLocaleDateString("en-CA", { day: "numeric", month: "short" })}</span>
                </button>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={() => {
                    void deleteConversation(c.id)
                      .then(() => {
                        if (c.id === conversationId) startNew();
                        void qc.invalidateQueries({ queryKey: ["assistant-conversations"] });
                      })
                      .catch((e) => toast.error(errText(e)));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {shown.length === 0 && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Ask about a client, a project, what a spec calls for, what a vendor quoted, the catalogue, or the company's details.</p>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  <li>What is our GST number?</li>
                  <li>Who is the contact at ABC Developments?</li>
                  {currentJob && <li>What does the spec say about floor prep on this job?</li>}
                  {canRemember && <li>Remember that Ceratech lead time is six weeks.</li>}
                </ul>
                <p className="text-xs">Every answer names its source. If nothing is found, it says so rather than guess.</p>
              </div>
            )}
            {shown.map((m) => (
              <div key={m.id} className={cn("mb-3 flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[92%] rounded-lg px-3 py-2 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.pending ? (
                    <span className="text-muted-foreground">Looking…</span>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.sources && m.sources.length > 0 && <SourceChips sources={m.sources} />}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}

        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={box}
            rows={2}
            maxLength={4000}
            placeholder={canRemember ? 'Ask a question, or "remember that …"' : "Ask a question"}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
              {busy ? "Asking…" : "Ask"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SourceChips({ sources }: { sources: Source[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1" aria-label="Sources">
      {sources.map((s, i) => {
        const cls = "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground";
        if (s.kind === "document")
          return (
            <li key={i}>
              <Link to="/documents" className={cn(cls, "hover:bg-accent")} title="Open Documents">
                <FileText className="h-3 w-3" /> {s.label}
              </Link>
            </li>
          );
        if (s.kind === "knowledge")
          return (
            <li key={i}>
              <Link to="/settings" search={{ tab: "knowledge" }} className={cn(cls, "hover:bg-accent")} title="Open Knowledge">
                <Sparkles className="h-3 w-3" /> {s.label}
              </Link>
            </li>
          );
        return (
          <li key={i} className={cls}>
            {s.label}
          </li>
        );
      })}
    </ul>
  );
}

/** The header button that opens the side window. Rendered only for staff. */
export function AskBmdButton({ className, compact }: { className?: string; compact?: boolean }) {
  const allowed = useAssistantAllowed();
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label="Ask BMD">
        <Sparkles className="h-4 w-4" />
        {!compact && "Ask BMD"}
      </button>
      <AssistantPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
