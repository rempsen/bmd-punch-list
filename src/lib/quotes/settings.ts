/** Reading and saving the company's quote settings (Settings → Quotes), and the logo that goes on every quote. */
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { brandingFrom, checkLogo, LOGO_MAX_CHARS, SETTINGS_COLS, type Branding, type Logo, type SettingsRow } from "./branding";

const measure = (dataUrl: string) =>
  new Promise<Logo | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? { dataUrl, width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
const builtInLogo = () =>
  fetch("/bmd-logo.png")
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b ? new Promise<string | null>((res) => Object.assign(new FileReader(), { onload: (e: ProgressEvent<FileReader>) => res(String(e.target?.result)), onerror: () => res(null) }).readAsDataURL(b)) : null))
    .then((url) => (url ? measure(url) : null))
    .catch(() => null);

/** The logo for a quote: the one uploaded under Settings → Quotes, else the built-in BMD logo. Browser only. */
export async function loadLogo(): Promise<Logo | null> {
  try {
    const { data } = await db.from("quote_settings").select("logo_data_url,logo_width,logo_height").eq("id", 1).maybeSingle();
    const row = data as { logo_data_url: string | null; logo_width: number | null; logo_height: number | null } | null;
    if (row?.logo_data_url && !checkLogo(row.logo_data_url)) {
      if (row.logo_width && row.logo_height) return { dataUrl: row.logo_data_url, width: row.logo_width, height: row.logo_height };
      const measured = await measure(row.logo_data_url);
      if (measured) return measured;
    }
  } catch {
    /* fall through to the built-in logo */
  }
  return builtInLogo();
}

export type QuoteSettings = { branding: Branding; logo: Logo | null };
export function useQuoteSettings(enabled = true) {
  return useQuery({
    queryKey: ["quote-settings"],
    enabled,
    queryFn: async (): Promise<QuoteSettings> => {
      const { data, error } = await db.from("quote_settings").select(`${SETTINGS_COLS},logo_data_url,logo_width,logo_height`).eq("id", 1).maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as (SettingsRow & { logo_data_url: string | null; logo_width: number | null; logo_height: number | null }) | null;
      return { branding: brandingFrom(row), logo: row?.logo_data_url ? { dataUrl: row.logo_data_url, width: row.logo_width ?? 0, height: row.logo_height ?? 0 } : null };
    },
  });
}

export async function saveBranding(b: Branding) {
  const { data, error } = await db
    .from("quote_settings")
    .update({
      company_name: b.companyName.trim(),
      office_address: b.officeAddress.trim(),
      mailing_address: b.mailingAddress.trim(),
      phone: b.phone.trim(),
      email: b.email.trim(),
      website: b.website.trim(),
      gst_number: b.gstNumber.trim(),
      footer_text: b.footer.trim(),
      default_notes: b.defaultNotes.trim(),
      short_terms: b.shortTerms.map((t) => t.trim()).filter(Boolean),
      terms_title: b.termsTitle.trim(),
      terms_text: b.termsText.trim(),
    })
    .eq("id", 1)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("These settings could not be saved. You may not have permission to change them.");
}

export async function saveLogo(logo: Logo | null) {
  const { data, error } = await db.from("quote_settings").update({ logo_data_url: logo?.dataUrl ?? null, logo_width: logo?.width ?? null, logo_height: logo?.height ?? null }).eq("id", 1).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("The logo could not be saved. You may not have permission to change it.");
}

/**
 * Turns a chosen image file into a logo small enough to store: scaled down to at most 600 px wide and kept as a PNG
 * (so a transparent background survives), or as a JPEG on white when the PNG would be too large. Browser only.
 */
export async function prepareLogo(file: File): Promise<Logo> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Choose a PNG or JPEG image.");
  if (file.size > 10_000_000) throw new Error("That image is over 10 MB. Choose a smaller one.");
  const source = await new Promise<string>((res, rej) => Object.assign(new FileReader(), { onload: (e: ProgressEvent<FileReader>) => res(String(e.target?.result)), onerror: () => rej(new Error("The image could not be read.")) }).readAsDataURL(file));
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = () => rej(new Error("The image could not be opened. Try a PNG or JPEG."));
    el.src = source;
  });
  for (const maxWidth of [600, 400, 280]) {
    const k = Math.min(1, maxWidth / img.naturalWidth, 300 / img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * k));
    const height = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const g = canvas.getContext("2d");
    if (!g) throw new Error("This browser could not prepare the image.");
    g.drawImage(img, 0, 0, width, height);
    const png = canvas.toDataURL("image/png");
    if (png.length <= LOGO_MAX_CHARS) return { dataUrl: png, width, height };
    g.globalCompositeOperation = "destination-over";
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, width, height);
    const jpeg = canvas.toDataURL("image/jpeg", 0.9);
    if (jpeg.length <= LOGO_MAX_CHARS) return { dataUrl: jpeg, width, height };
  }
  throw new Error("That image is too detailed to use as a logo. Try a simpler or smaller one.");
}
