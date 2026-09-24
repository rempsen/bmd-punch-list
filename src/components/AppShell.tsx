import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Camera,
  ClipboardList,
  FileDown,
  Grid3x3,
  KanbanSquare,
  MoreHorizontal,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useProject } from "@/lib/data";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof Camera };

export function useNavItems() {
  const { canCapture, isClient, isAdmin } = useAuth();
  const items: NavItem[] = [];
  if (isClient) items.push({ to: "/decisions", label: "Decisions", icon: ShieldCheck });
  if (canCapture) items.push({ to: "/capture", label: "Capture", icon: Camera });
  items.push({ to: "/floors", label: "Floors", icon: Grid3x3 });
  if (canCapture) items.push({ to: "/board", label: "Board", icon: KanbanSquare });
  items.push({ to: "/dashboard", label: "Dashboard", icon: BarChart3 });
  items.push({ to: "/list", label: "List", icon: ClipboardList });
  items.push({ to: "/exports", label: "Exports", icon: FileDown });
  if (isAdmin) items.push({ to: "/settings", label: "Settings", icon: Settings });
  return items;
}

export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavItems();
  const { data: project } = useProject();
  const { roles } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const mobileTabs = nav.slice(0, 3);

  return (
    <div className="min-h-screen bg-surface">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col bg-sidebar px-3 py-5 text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen">
          <div className="px-2 pb-6">
            <p className="text-sm font-bold tracking-[0.18em] uppercase">BMD Materials</p>
            <p className="mt-1 text-xs opacity-70">Deficiency Tracker</p>
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname.startsWith(item.to)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "opacity-80 hover:bg-sidebar-accent/60",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            to="/more"
            className="mt-2 rounded-md px-3 py-2 text-xs opacity-70 hover:bg-sidebar-accent/60"
          >
            {project?.name ?? "Project"} · {roles.join(", ") || "no role"}
          </Link>
        </aside>

        <div className="flex min-h-screen w-full min-w-0 flex-col">
          {/* Mobile header */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-primary px-4 py-3 text-primary-foreground md:hidden">
            <div>
              <p className="text-xs font-bold tracking-[0.18em] uppercase">BMD Materials</p>
              <p className="text-[11px] opacity-75">{project?.name ?? "Deficiency Tracker"}</p>
            </div>
            <Link to="/more" className="rounded-md p-2 hover:bg-white/10" aria-label="More">
              <MoreHorizontal className="h-5 w-5" />
            </Link>
          </header>

          <main className="flex-1 pb-24 md:pb-8">{children}</main>

          {/* Mobile bottom tabs */}
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card md:hidden">
            {mobileTabs.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  pathname.startsWith(item.to) ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
            <Link
              to="/more"
              className={cn(
                "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
                pathname.startsWith("/more") ? "text-primary" : "text-muted-foreground",
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              More
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-card px-4 py-4 md:px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
