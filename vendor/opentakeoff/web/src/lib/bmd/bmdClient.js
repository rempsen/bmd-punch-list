// BMD change (new file): the BMD Projects session for the takeoff workspace. The workspace is served from the BMD
// Projects site, so it uses the sign-in already in this browser. No key or token is ever placed in a URL.
import { createClient } from "@supabase/supabase-js";

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let client = null;
export function bmdClient() {
  if (!URL_ || !KEY) throw new Error("This build of the takeoff workspace is not connected to BMD Projects.");
  client ??= createClient(URL_, KEY, {
    global: {
      // The publishable key is an opaque string, not a bearer token: it goes in `apikey` only.
      fetch: (input, init) => {
        const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
        if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
        if (KEY.startsWith("sb_") && headers.get("Authorization") === `Bearer ${KEY}`) headers.delete("Authorization");
        headers.set("apikey", KEY);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}
