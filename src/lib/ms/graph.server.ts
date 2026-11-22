import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createGraph, type MailMessage, type MsEnv, type MsStore, type SendResult } from "./core";

/** ms_connections has no browser access; the service-role client is the only way in. */
const table = () => (supabaseAdmin as unknown as { from: (t: string) => any }).from("ms_connections"); // eslint-disable-line @typescript-eslint/no-explicit-any

export function msEnv(): MsEnv | null {
  const tenant = process.env["MS_TENANT_ID"];
  const clientId = process.env["MS_CLIENT_ID"];
  const clientSecret = process.env["MS_CLIENT_SECRET"];
  return tenant && clientId && clientSecret ? { tenant, clientId, clientSecret } : null;
}

/** Key for encrypting refresh tokens and signing the sign-in state. Never leaves the server. */
export function msKeyMaterial(): string {
  const k = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!k) throw new Error("Server is missing its service key");
  return `bmd-ms-v1|${k}`;
}

export const msStore: MsStore = {
  get: async (userId) => {
    const { data } = await table().select("refresh_token_enc,account_email").eq("user_id", userId).maybeSingle();
    return data ?? null;
  },
  saveToken: async (userId, refreshTokenEnc) => {
    await table().update({ refresh_token_enc: refreshTokenEnc }).eq("user_id", userId);
  },
  setError: async (userId, message) => {
    await table().update({ last_error: message }).eq("user_id", userId);
  },
};

export function msGraph() {
  const env = msEnv();
  if (!env) throw new Error("Microsoft 365 is not set up yet.");
  // The host's fetch must be called bare; handing it over as a property makes it throw "Illegal invocation".
  return createGraph({ fetch: (input, init) => fetch(input, init), env, store: msStore, keyMaterial: msKeyMaterial() });
}

export const getAccessToken = (userId: string): Promise<string> => msGraph().getAccessToken(userId);

export async function sendMailAs(userId: string, msg: MailMessage): Promise<SendResult> {
  if (!msEnv()) return { ok: false, reason: "error", message: "Microsoft 365 is not set up yet." };
  return msGraph().sendMailAs(userId, msg);
}

export type MsConnectionInfo = {
  account_email: string;
  connected_at: string;
  last_error: string | null;
  is_library_connection: boolean;
  onedrive_root_path: string | null;
};
const INFO = "account_email,connected_at,last_error,is_library_connection,onedrive_root_path";

export async function connectionFor(userId: string): Promise<MsConnectionInfo | null> {
  const { data } = await table().select(INFO).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

export async function libraryConnection(): Promise<(MsConnectionInfo & { user_id: string; onedrive_root_item_id: string | null }) | null> {
  const { data } = await table().select(`user_id,onedrive_root_item_id,${INFO}`).eq("is_library_connection", true).maybeSingle();
  return data ?? null;
}

export async function saveConnection(row: { user_id: string; account_email: string; refresh_token_enc: string; scopes: string; library: boolean }) {
  if (row.library) await table().update({ is_library_connection: false }).eq("is_library_connection", true).neq("user_id", row.user_id);
  const existing = await connectionFor(row.user_id);
  const { error } = await table().upsert({
    user_id: row.user_id,
    account_email: row.account_email,
    refresh_token_enc: row.refresh_token_enc,
    scopes: row.scopes,
    is_library_connection: row.library || !!existing?.is_library_connection,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  if (error) throw new Error(error.message);
}

export async function removeConnection(userId: string) {
  await table().delete().eq("user_id", userId);
}
