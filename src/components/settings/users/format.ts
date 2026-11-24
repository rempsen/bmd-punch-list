import type { UserStatus } from "@/lib/users/logic";

export const STATUS: Record<UserStatus, { label: string; dot: string }> = {
  active: { label: "Active", dot: "bg-emerald-500" },
  invited: { label: "Invited", dot: "bg-sky-500" },
  expired: { label: "Invite expired", dot: "bg-amber-500" },
  deactivated: { label: "Deactivated", dot: "bg-muted-foreground" },
};

/** "today", "yesterday", "Sep 29", or "Sep 29, 2025" when not this year. */
export function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `today, ${d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`;
  if (diff === 1) return "yesterday";
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

