import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AcceptInput, PublicView } from "./public";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const checkToken = <T extends { token: string }>(d: T): T => {
  if (!d || typeof d.token !== "string" || !TOKEN.test(d.token)) throw new Error("Invalid link");
  return d;
};

/** Finds the live link for a token, with its quote. Unknown and revoked links look exactly the same: nothing. */
async function open(token: string) {
  const { hashToken } = await import("./public");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = supabaseAdmin as any;
  const { data: link } = await admin.from("quote_share_links").select("id,quote_id,choices").eq("token_hash", await hashToken(token)).is("revoked_at", null).maybeSingle();
  if (!link) return null;
  const { data: quote } = await admin.from("quotes").select("id,number,status,revision,snapshot").eq("id", link.quote_id).maybeSingle();
  if (!quote) return null;
  return { admin, link: link as { id: string; quote_id: string; choices: Record<string, unknown> }, quote: quote as { id: string; number: string; status: "draft" | "sent" | "accepted" | "declined" | "superseded"; revision: number; snapshot: never } };
}

/** The client's view of a quote. Returns null for an unknown or revoked link. */
export const getPublicQuote = createServerFn({ method: "GET" })
  .inputValidator(checkToken<{ token: string }>)
  .handler(async ({ data }): Promise<PublicView | null> => {
    const { publicView } = await import("./public");
    const found = await open(data.token);
    if (!found) return null;
    const { data: acc } = await found.admin.from("quote_acceptances").select("name,accepted_at,version_id,total_cents").eq("quote_id", found.quote.id).order("accepted_at", { ascending: false }).limit(1).maybeSingle();
    await found.admin.from("quote_share_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", found.link.id);
    return publicView(found.quote, found.link, acc ?? null);
  });

/** Remembers the client's yes, no and maybe answers while the quote is still open. */
export const savePublicSelections = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; choices: Record<string, unknown> }) => {
    checkToken(d);
    if (!d.choices || typeof d.choices !== "object" || Object.keys(d.choices).length > 2000) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data }) => {
    const { cleanChoices } = await import("./public");
    const found = await open(data.token);
    if (!found || found.quote.status !== "sent" || !found.quote.snapshot) return { ok: false as const };
    await found.admin.from("quote_share_links").update({ choices: cleanChoices(found.quote.snapshot, data.choices) }).eq("id", found.link.id);
    return { ok: true as const };
  });

/** Accepts the quote from the client link. The price is worked out here from the stored quote; the browser's figure is only compared. */
export const acceptPublicQuote = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string } & AcceptInput) => {
    checkToken(d);
    if (typeof d.name !== "string" || d.name.length > 200 || typeof d.email !== "string" || d.email.length > 320 || typeof d.versionId !== "string" || !Number.isInteger(d.revision) || !Number.isInteger(d.expectedTotalCents) || !d.choices || typeof d.choices !== "object" || Object.keys(d.choices).length > 2000) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data }) => {
    const { checkAcceptance } = await import("./public");
    const found = await open(data.token);
    if (!found) return { ok: false as const, reload: true as const, message: "This link is no longer active." };
    const check = checkAcceptance(found.quote, data);
    if (!check.ok) return check;
    const { error } = await found.admin.rpc("accept_quote_public", { _link: found.link.id, _version: check.versionId, _name: data.name, _email: data.email, _choices: check.choices, _value: check.valueCents, _total: check.totalCents, _revision: data.revision });
    if (error) return { ok: false as const, reload: true as const, message: /RELOAD/.test(error.message) ? "This quotation has changed since you opened it. Reload the page to see the current one." : "Your acceptance could not be recorded. Please try again or contact us." };
    return { ok: true as const };
  });

/** Creates the private link for a sent quote and returns its secret once. Any earlier link for the quote stops working. */
export const createQuoteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { quoteId: string }) => {
    if (!d || !/^[0-9a-f-]{36}$/i.test(d.quoteId)) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { hashToken, newToken } = await import("./public");
    const token = newToken();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("create_quote_link", { _quote: data.quoteId, _token_hash: await hashToken(token) });
    if (error) throw new Error(error.message);
    return { token };
  });
