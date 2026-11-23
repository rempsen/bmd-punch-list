/** Where the sidebar remembers whether the job menu is open, in this browser. */
export const JOB_MENU_KEY = "bmd.jobMenu";

/** The job menu (Dashboard, Board, Floors and the rest) starts hidden and then stays the way the person left it. */
export const jobMenuOpen = (stored: string | null): boolean => stored === "open";

/** A supplier price list is an Excel or CSV file. */
export const isPriceListFile = (name: string): boolean => /.\.(xlsx|xls|csv)$/i.test(name);
