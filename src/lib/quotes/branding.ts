/**
 * The company's own details on a quote: name, addresses, contact, footer wording, short terms and the standard
 * terms and conditions. Set once under Company settings → Quotes and frozen into each quote when it is sent.
 */
export type Branding = {
  companyName: string;
  officeAddress: string;
  mailingAddress: string;
  phone: string;
  email: string;
  website: string;
  gstNumber: string;
  /** Business number and opening hours: kept for the assistant and the company record; not printed on quotes. */
  businessNumber: string;
  hours: string;
  /** Printed at the foot of every page. */
  footer: string;
  /** Starting text for the notes on a new quote. */
  defaultNotes: string;
  /** Short terms listed under the price, after the validity and deposit lines. */
  shortTerms: string[];
  termsTitle: string;
  /** The standard terms and conditions. Blank means no conditions page is printed. */
  termsText: string;
};
export type Company = { name: string; office: string; mailing: string; phone: string; email: string; website: string; gstNumber: string };
export type Logo = { dataUrl: string; width: number; height: number };

export const DEFAULT_BRANDING: Branding = {
  companyName: "BMD Materials",
  officeAddress: "",
  mailingAddress: "PO Box 69031, Winnipeg RPO Tuxedo Park, MB R3P 2G9",
  phone: "",
  email: "office@bmdmaterials.com",
  website: "",
  gstNumber: "",
  businessNumber: "",
  hours: "",
  footer: "",
  defaultNotes: "",
  shortTerms: ["Overdue accounts are charged interest at 2% per month.", "Workmanship is warranted for one year from completion. Materials carry their manufacturer's warranty.", "Prices are in Canadian dollars. GST is shown separately."],
  termsTitle: "Terms and Conditions",
  termsText: "",
};

export type SettingsRow = Partial<{
  company_name: string | null;
  office_address: string | null;
  mailing_address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  gst_number: string | null;
  business_number: string | null;
  hours: string | null;
  footer_text: string | null;
  default_notes: string | null;
  short_terms: string[] | null;
  terms_title: string | null;
  terms_text: string | null;
}>;
export const SETTINGS_COLS = "company_name,office_address,mailing_address,phone,email,website,gst_number,business_number,hours,footer_text,default_notes,short_terms,terms_title,terms_text";

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");

/** The saved settings as the quote uses them. The company name and the conditions title can never be blank. */
export function brandingFrom(row: SettingsRow | null | undefined): Branding {
  if (!row) return { ...DEFAULT_BRANDING, shortTerms: [...DEFAULT_BRANDING.shortTerms] };
  const has = (k: keyof SettingsRow) => row[k] !== undefined && row[k] !== null;
  return {
    companyName: clean(row.company_name) || DEFAULT_BRANDING.companyName,
    officeAddress: has("office_address") ? clean(row.office_address) : DEFAULT_BRANDING.officeAddress,
    mailingAddress: has("mailing_address") ? clean(row.mailing_address) : DEFAULT_BRANDING.mailingAddress,
    phone: clean(row.phone),
    email: has("email") ? clean(row.email) : DEFAULT_BRANDING.email,
    website: clean(row.website),
    gstNumber: clean(row.gst_number),
    businessNumber: clean(row.business_number),
    hours: clean(row.hours),
    footer: clean(row.footer_text),
    defaultNotes: clean(row.default_notes),
    shortTerms: Array.isArray(row.short_terms) ? row.short_terms.map(clean).filter(Boolean) : [...DEFAULT_BRANDING.shortTerms],
    termsTitle: clean(row.terms_title) || DEFAULT_BRANDING.termsTitle,
    termsText: clean(row.terms_text),
  };
}

export const companyOf = (b: Branding): Company => ({ name: b.companyName, office: b.officeAddress, mailing: b.mailingAddress, phone: b.phone, email: b.email, website: b.website, gstNumber: b.gstNumber });
export const DEFAULT_COMPANY = companyOf(DEFAULT_BRANDING);

/** The lines printed under the logo: addresses (labelled when there are two), then contact details, then the GST number. */
export function companyLines(c: Company): string[] {
  const both = !!c.office && !!c.mailing;
  const contact = [c.phone, c.email, c.website].filter(Boolean).join(" · ");
  return [c.office && (both ? `Office: ${c.office}` : c.office), c.mailing && (both ? `Mailing: ${c.mailing}` : c.mailing), contact, c.gstNumber && `GST No. ${c.gstNumber}`].filter(Boolean) as string[];
}

/** The size to draw a logo at so it keeps its shape inside the space allowed. */
export function fitLogo(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 110, height: 40 };
  const k = Math.min(maxWidth / width, maxHeight / height);
  return { width: Math.round(width * k * 10) / 10, height: Math.round(height * k * 10) / 10 };
}

export const LOGO_MAX_CHARS = 300_000;
/** Why a logo cannot be used, or null when it can. */
export function checkLogo(dataUrl: string): string | null {
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return "The logo must be a PNG or JPEG image.";
  if (dataUrl.length > LOGO_MAX_CHARS) return "That logo is too large. Use a smaller image (about 200 KB at most).";
  return null;
}

/** In the conditions text, a short line in capitals (numbered or not) prints as a heading. */
export function isHeadingLine(line: string): boolean {
  const s = line.trim();
  return s.length >= 2 && s.length <= 80 && /[A-Z]/.test(s) && !/[a-z]/.test(s) && /^(\d+[.)]\s*)?[A-Z0-9 &,/'().:-]+$/.test(s);
}
