/** The addresses BMD Projects is served from. Links in emails and addresses given to other systems only ever use one of these. */
const OURS = ["https://projects.bmdmaterials.com", "https://bmd-punch-list.lovable.app"];
const FALLBACK = "https://bmd-punch-list.lovable.app";

const origin = (url: string | undefined | null): string | null => {
  try {
    const o = new URL(String(url ?? "")).origin;
    return OURS.includes(o) ? o : null;
  } catch {
    return null;
  }
};

/**
 * The site address to put in an email or hand to another system.
 * A primary address set on the server (APP_URL) wins. Otherwise it is the address the person is using, if that is one of
 * ours, so nothing breaks while the site is reachable at both. A preview or unknown address is never given out.
 */
export function appOrigin(requestUrl?: string | null, primary: string | undefined = typeof process !== "undefined" ? process.env["APP_URL"] : undefined): string {
  return origin(primary) ?? origin(requestUrl) ?? FALLBACK;
}
