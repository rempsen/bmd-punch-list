/** Where the sidebar remembers, in this browser, whether each accordion is open. */
export const NAV_GROUP_KEYS = {
  resources: "bmd:nav:resources",
  deficiencies: "bmd:nav:deficiencies",
  records: "bmd:nav:records",
} as const;

/** Kept for older code: the Deficiencies accordion key. */
export const JOB_MENU_KEY = NAV_GROUP_KEYS.deficiencies;

/** An accordion stays the way the person left it; otherwise it starts at its default. */
export const navGroupOpen = (stored: string | null, defaultOpen: boolean): boolean =>
  stored === "open" ? true : stored === "closed" ? false : defaultOpen;

/** The Deficiencies accordion starts closed. */
export const jobMenuOpen = (stored: string | null): boolean => navGroupOpen(stored, false);

/** A supplier price list is an Excel or CSV file. */
export const isPriceListFile = (name: string): boolean => /.\.(xlsx|xls|csv)$/i.test(name);
