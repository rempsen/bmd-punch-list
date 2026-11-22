import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Input = { quoteId: string; pdfBase64: string; fingerprint: string; email: { to: string[]; cc: string[]; subject: string; message: string } | null };

/**
 * Sends a quote from the signed-in person's own mailbox (or records a download-only issue when email is null),
 * files the PDF under Quotes sent, and marks the quote sent. Nothing is filed or marked unless the email went.
 */
export const issueQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d || !UUID.test(d.quoteId) || typeof d.pdfBase64 !== "string" || d.pdfBase64.length < 100 || d.pdfBase64.length > 4_200_000 || typeof d.fingerprint !== "string") throw new Error("Invalid request");
    if (d.email) {
      const { to, cc, subject, message } = d.email;
      if (!Array.isArray(to) || !Array.isArray(cc) || to.length === 0 || to.length + cc.length > 20) throw new Error("Add at least one recipient.");
      for (const a of [...to, ...cc]) if (typeof a !== "string" || !EMAIL.test(a)) throw new Error(`"${String(a)}" is not an email address.`);
      if (typeof subject !== "string" || subject.trim() === "" || subject.length > 300 || typeof message !== "string" || message.length > 10_000) throw new Error("Check the subject and message.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { issueQuoteFlow } = await import("./logic");
    const { loadQuoteContext, snapshotFingerprint } = await import("./load");
    const { connectionFor, sendMailAs } = await import("@/lib/ms/graph.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { BUCKET, storagePath } = await import("@/lib/documents/logic");
    const sb = context.supabase;
    const fail = (message: string) => ({ ok: false as const, reason: "error" as const, message });

    const pdf = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
    if (String.fromCharCode(...pdf.slice(0, 5)) !== "%PDF-") return fail("The quote PDF could not be read. Preview it again.");

    const mine = await connectionFor(context.userId);
    if (data.email && !mine) return { ok: false as const, reason: "reconnect" as const, message: "Connect Outlook in Settings before sending, or use Download and mark as sent." };
    const { data: profile } = await sb.from("profiles").select("full_name,email").eq("id", context.userId).maybeSingle();
    const preparedBy = { name: profile?.full_name || profile?.email || "BMD Materials", email: mine?.account_email ?? profile?.email ?? "" };

    let ctx: Awaited<ReturnType<typeof loadQuoteContext>>;
    try {
      ctx = await loadQuoteContext(sb as never, data.quoteId, preparedBy);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not load the quote");
    }
    if (ctx.unknown.length > 0) return fail(`This quote cannot be sent yet: ${ctx.unknown.slice(0, 3).join("; ")}${ctx.unknown.length > 3 ? ` and ${ctx.unknown.length - 3} more` : ""}.`);
    if (snapshotFingerprint(ctx.snapshot) !== data.fingerprint) return fail("The estimate changed since this preview. Preview the quote again before sending.");

    return issueQuoteFlow(
      {
        check: async (quoteId) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: why, error } = await (sb as any).rpc("quote_issue_block", { _id: quoteId });
          return error ? error.message : ((why as string | null) ?? null);
        },
        sendMail: (email, attachment) => sendMailAs(context.userId, { to: email.to, cc: email.cc, subject: email.subject, html: email.html, attachments: [{ name: attachment.name, contentType: "application/pdf", bytes: attachment.bytes }] }),
        fileDocument: async (_quoteId, fileName, bytes) => {
          const id = crypto.randomUUID();
          const path = storagePath(ctx.quote.project_id, "quotes_sent", id, fileName);
          const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
          if (up.error) throw new Error(up.error.message);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabaseAdmin as any).from("project_documents").insert({ id, project_id: ctx.quote.project_id, section: "quotes_sent", file_name: fileName, storage_path: path, size_bytes: bytes.length, mime: "application/pdf", uploaded_by: context.userId, note: data.email ? `Sent to ${data.email.to.join(", ")}` : "Issued without email" });
          if (error) throw new Error(error.message);
          return id;
        },
        issue: async (quoteId, snapshot, recipients, documentId) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (sb as any).rpc("issue_quote", { _id: quoteId, _snapshot: snapshot, _rollup: ctx.rollup, _recipients: recipients, _document_id: documentId });
          if (error) throw new Error(error.message);
        },
      },
      {
        quoteId: data.quoteId,
        pdf,
        fileName: ctx.fileName,
        snapshot: ctx.snapshot,
        email: data.email && {
          to: data.email.to,
          cc: data.email.cc,
          subject: data.email.subject.trim(),
          html: data.email.message.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""),
        },
      },
    );
  });
