/** Where the sidebar remembers whether the Job Site Open Items section is open, in this browser. */
export const JOB_MENU_KEY = "bmd.jobMenu";

/** The Job Site Open Items section (Board, Floors, List and the rest) starts hidden and then stays the way the person left it. */
export const jobMenuOpen = (stored: string | null): boolean => stored === "open";

/** A supplier price list is an Excel or CSV file. */
export const isPriceListFile = (name: string): boolean => /.\.(xlsx|xls|csv)$/i.test(name);
