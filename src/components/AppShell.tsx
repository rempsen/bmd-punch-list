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
  Wrench,
} from "lucide-react";
import { roleLabel } from "@/lib/roles";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useProject } from "@/lib/data";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof Camera };

export function useNavItems() {
  const { can, role } = useAuth();
  const items: NavItem[] = [];
  const isTrade = role === "trade";
  if (isTrade) items.push({ to: "/my-work", label: "My work", icon: Wrench });
  if (can("decide_client_items") && !can("capture_items"))
    items.push({ to: "/decisions", label: "Decisions", icon: ShieldCheck });
  if (can("capture_items")) items.push({ to: "/capture", label: "Capture", icon: Camera });
  items.push({ to: "/floors", label: "Floors", icon: Grid3x3 });
  if (can("capture_items") || can("edit_any_item"))
    items.push({ to: "/board", label: "Board", icon: KanbanSquare });
  if (can("view_dashboard")) items.push({ to: "/dashboard", label: "Dashboard", icon: BarChart3 });
  items.push({ to: "/list", label: "List", icon: ClipboardList });
  if (can("export_pdf") || can("export_excel"))
    items.push({ to: "/exports", label: "Exports", icon: FileDown });
  if (can("manage_settings") || can("manage_users"))
    items.push({ to: "/settings", label: "Settings", icon: Settings });
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
        <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen">
          <div className="border-b border-sidebar-border px-2 pb-4 mb-4">
            <img src="/bmd-logo.png" alt="BMD Materials" className="w-[120px]" />
            <p className="mt-1 text-xs text-muted-foreground">Deficiency Tracker</p>
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname.startsWith(item.to)
                    ? "border-blush bg-sidebar-accent text-sidebar-accent-foreground"
                    : "border-transparent opacity-80 hover:bg-sidebar-accent/60",
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
            {project?.name ?? "Project"} · {roles.map(roleLabel).join(", ") || "no role"}
          </Link>
        </aside>

        <div className="flex min-h-screen w-full min-w-0 flex-col">
          {/* Mobile header */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-logo-bg px-4 py-2 text-foreground md:hidden">
            <div className="flex items-center gap-3">
              <img src="/bmd-logo.png" alt="BMD Materials" className="w-[90px]" />
              <p className="text-[11px] text-muted-foreground">{project?.name ?? "Deficiency Tracker"}</p>
            </div>
            <Link to="/more" className="rounded-md p-2 hover:bg-muted" aria-label="More">
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
                  pathname.startsWith(item.to) ? "border-t-2 border-blush text-primary" : "text-muted-foreground",
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
                pathname.startsWith("/more") ? "border-t-2 border-blush text-primary" : "text-muted-foreground",
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
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
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
