import { Link, Navigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Camera,
  ClipboardList,
  FileDown,
  Grid3x3,
  KanbanSquare,
  MoreHorizontal,
  Settings,
  Mail,
  ShieldCheck,
  Wrench,
  ArrowLeftRight,
  Plus,
  Building2,
  FolderKanban,
  BookOpen,
  FolderOpen,
  Columns3,
  Briefcase,
  Images,
  Sparkles,
  ChevronRight,
  Workflow,
} from "lucide-react";
import { roleLabel } from "@/lib/roles";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { JOB_MENU_KEY, jobMenuOpen } from "@/lib/nav";
import { needsJob, settingsGroup } from "@/lib/settings-tabs";
import { UpdateNotice } from "@/components/UpdateNotice";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; short?: string; icon: typeof Camera; group?: "company"; /** Where a job item sits in the desktop sidebar. */ section?: "top" | "open-items" | "bottom"; /** For the two Settings entries: which tab to open. */ search?: { tab: string } };
/** The two Settings entries share one page, so each is lit only when its own kind of settings is open. */
const isActive = (item: NavItem, pathname: string, tab: string | undefined) => pathname.startsWith(item.to) && (!item.search || settingsGroup(tab) === settingsGroup(item.search.tab));

export function useNavItems() {
  const { can, canAny, role, isSuperAdmin } = useAuth();
  const items: NavItem[] = [];
  // Company-wide areas for BMD staff. Trades, clients and viewers never see these.
  if (canAny("view_pipeline")) {
    items.push({ to: "/pipeline", label: "Pipeline", icon: Columns3, group: "company" });
    items.push({ to: "/projects", label: "Projects", icon: FolderKanban, group: "company" });
    items.push({ to: "/clients", label: "Clients", icon: Building2, group: "company" });
    if (canAny("view_pricing")) items.push({ to: "/catalogue", label: "Catalogue", icon: BookOpen, group: "company" });
  }
  const isTrade = role === "trade";
  if (isTrade) items.push({ to: "/my-work", label: "My work", icon: Wrench });
  if (isTrade) items.push({ to: "/trade-portal", label: "Trade portal", short: "Portal", icon: Briefcase });
  if (role === "bmd_field") items.push({ to: "/trade-portal", label: "My items", short: "Mine", icon: Wrench });
  if (can("decide_client_items") && !can("capture_items"))
    items.push({ to: "/decisions", label: "Decisions", icon: ShieldCheck });
  if (role === "client") items.push({ to: "/client-portal", label: "Client portal", short: "Portal", icon: Briefcase });
  if (can("view_dashboard")) items.push({ to: "/dashboard", label: "Dashboard", icon: BarChart3, section: "top" });
  if (can("capture_items") || can("edit_any_item"))
    items.push({ to: "/board", label: "Board", icon: KanbanSquare, section: "open-items" });
  items.push({ to: "/floors", label: "Floors", icon: Grid3x3, section: "open-items" });
  items.push({ to: "/list", label: "List", icon: ClipboardList, section: "open-items" });
  if (can("view_dashboard")) items.push({ to: "/summary", label: "Summary", icon: Sparkles, section: "open-items" });
  if (can("capture_items")) items.push({ to: "/capture", label: "Add a deficiency", short: "Add", icon: Camera, section: "open-items" });
  if (can("export_pdf") || can("export_excel"))
    items.push({ to: "/exports", label: "Exports", icon: FileDown, section: "open-items" });
  if (can("view_documents")) {
    items.push({ to: "/documents", label: "Documents", short: "Docs", icon: FolderOpen, section: "bottom" });
    items.push({ to: "/job-flow", label: "Job Flow", short: "Flow", icon: Workflow, section: "bottom" });
  }
  if (can("manage_settings")) items.push({ to: "/email-intake", label: "Email intake", short: "Email", icon: Mail, section: "bottom" });
  if (role !== "trade" && role !== "viewer") items.push({ to: "/company-work", label: "Company items", short: "Ours", icon: Building2, section: "bottom" });
  if (role !== "trade" && role !== "viewer") items.push({ to: "/photos", label: "Job photos", short: "Photos", icon: Images, section: "bottom" });
  // Settings come in two kinds. Company settings sit with the company-wide areas; job settings sit with the current job.
  const companyTab = canAny("send_quotes") ? "quotes" : canAny("manage_integrations") ? "integrations" : isSuperAdmin ? "allusers" : can("manage_settings") ? "projects" : null;
  if (companyTab) items.push({ to: "/settings", search: { tab: companyTab }, label: "Company settings", short: "Company", icon: Settings, group: "company" });
  if (can("manage_settings") || can("manage_users"))
    items.push({ to: "/settings", search: { tab: can("manage_settings") ? "project" : "users" }, label: "Job settings", short: "Job", icon: Settings, section: "bottom" });
  return items;
}

export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavItems();
  const company = nav.filter((i) => i.group === "company");
  const jobNav = nav.filter((i) => i.group !== "company");
  // Role portals (My work, Decisions…) have no section and stay at the very top.
  const topNav = jobNav.filter((i) => !i.section || i.section === "top");
  const openItemsNav = jobNav.filter((i) => i.section === "open-items");
  const bottomNav = jobNav.filter((i) => i.section === "bottom");
  const jobLink = (item: NavItem) => (
    <Link
      key={item.label}
      to={item.to}
      {...(item.search ? { search: item.search } : {})}
      className={cn(
        item.to === "/settings" && "mt-auto",
        "flex items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium transition-colors",
        isActive(item, pathname, tabNow)
          ? "border-blush bg-sidebar-accent text-sidebar-accent-foreground"
          : "border-transparent opacity-80 hover:bg-sidebar-accent/60",
      )}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
  const { roles, currentJob, jobsLoaded, loading, canCreateJobs } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabNow = useRouterState({ select: (s) => (s.location.search as { tab?: string }).tab });
  // The job menu starts hidden and stays the way this person left it, in this browser.
  const [jobMenu, setJobMenu] = useState(false);
  useEffect(() => {
    try {
      setJobMenu(jobMenuOpen(window.localStorage.getItem(JOB_MENU_KEY)));
    } catch {
      /* storage blocked: the menu just starts hidden */
    }
  }, []);
  const toggleJobMenu = () => {
    const next = !jobMenu;
    setJobMenu(next);
    try {
      window.localStorage.setItem(JOB_MENU_KEY, next ? "open" : "closed");
    } catch {
      /* not remembered */
    }
  };
  // Company-wide screens, company settings included, open without a job chosen.
  const activeJobItem = openItemsNav.find((i) => isActive(i, pathname, tabNow));
  if (!loading && jobsLoaded && !currentJob && needsJob(pathname, tabNow)) return <Navigate to="/jobs" replace />;


  return (
    <div className="min-h-screen bg-surface">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen">
          <div className="mb-4 border-b border-sidebar-border px-2 pb-4">
            <img src="/bmd-logo.png" alt="BMD Materials" className="mx-auto mb-4 w-[130px]" />
            {company.length > 0 && (
              <nav aria-label="BMD Projects" className="mb-3 flex flex-col gap-1">
                {company.map((item) => (
                  <Link
                    key={item.label}
                    to={item.to}
                    {...(item.search ? { search: item.search } : {})}
                    className={cn(
                      "flex items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive(item, pathname, tabNow)
                        ? "border-blush bg-sidebar-accent text-sidebar-accent-foreground"
                        : "border-transparent opacity-80 hover:bg-sidebar-accent/60",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
            <JobBadge />
          </div>
          <nav aria-label="Current job" className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {topNav.map(jobLink)}
            {openItemsNav.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={toggleJobMenu}
                  aria-expanded={jobMenu}
                  aria-controls="job-menu"
                  className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide opacity-80 hover:bg-sidebar-accent/60"
                >
                  <ChevronRight className={cn("h-4 w-4 transition-transform", jobMenu && "rotate-90")} aria-hidden />
                  <span className="min-w-0 flex-1">Job Site Open Items</span>
                  {!jobMenu && activeJobItem && <span className="truncate text-[11px] font-medium normal-case tracking-normal opacity-80">{activeJobItem.label}</span>}
                </button>
                <div id="job-menu" className="flex flex-col gap-1">
                  {jobMenu && openItemsNav.map(jobLink)}
                </div>
              </>
            )}
            {bottomNav.map(jobLink)}
            {canCreateJobs && (
              <Link
                to="/new-job"
                className={cn(
                  !jobNav.some((i) => i.to === "/settings") && "mt-auto",
                  "order-last flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2.5 text-sm font-medium opacity-80 transition-colors hover:bg-sidebar-accent/60",
                )}
              >
                <Plus className="h-4 w-4" /> New job
              </Link>
            )}
          </nav>
          <Link
            to="/more"
            className="mt-2 rounded-md px-3 py-2 text-xs opacity-70 hover:bg-sidebar-accent/60"
          >
            {currentJob?.name ?? "No job selected"} · {roles.map(roleLabel).join(", ") || "no role"}
          </Link>
        </aside>

        <div className="flex min-h-screen w-full min-w-0 flex-col">
          <UpdateNotice />
          {/* Mobile header */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-logo-bg px-4 py-2 text-foreground md:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/bmd-logo.png" alt="BMD Materials" className="w-[90px] shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">{currentJob?.name ?? "Choose a job"}</p>
                {currentJob?.address && (
                  <p className="truncate text-[11px] text-muted-foreground">{currentJob.address}</p>
                )}
              </div>
              <Link
                to="/jobs"
                className="shrink-0 rounded-md border border-border p-2 hover:bg-muted"
                aria-label="Switch job"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Link>
            </div>
            <Link to="/more" className="rounded-md p-2 hover:bg-muted" aria-label="More">
              <MoreHorizontal className="h-5 w-5" />
            </Link>
          </header>

          <main className="flex-1 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-8">{children}</main>

          <MobileTabBar pathname={pathname} />
        </div>
      </div>
    </div>
  );
}

function MobileTabBar({ pathname }: { pathname: string }) {
  const { can, role } = useAuth();
  const canAdd = can("capture_items");
  const left: NavItem[] = [];
  if (can("view_dashboard")) left.push({ to: "/dashboard", label: "Dashboard", icon: BarChart3 });
  left.push({ to: "/floors", label: "Floors", icon: Grid3x3 });
  if (left.length < 2) left.unshift({ to: "/list", label: "List", icon: ClipboardList });
  const right: NavItem =
    can("capture_items") || can("edit_any_item")
      ? { to: "/board", label: "Board", icon: KanbanSquare }
      : { to: "/list", label: "List", icon: ClipboardList };
  const centre: NavItem | null = canAdd
    ? { to: "/capture", label: "Add", icon: Plus }
    : role === "trade"
      ? { to: "/my-work", label: "My work", icon: Wrench }
      : role === "client" || can("decide_client_items")
        ? { to: "/decisions", label: "Decisions", icon: ShieldCheck }
        : null;
  const tab = (item: NavItem) => (
    <Link
      key={item.to}
      to={item.to}
      className={cn(
        "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
        pathname.startsWith(item.to) ? "border-t-2 border-blush text-primary" : "text-muted-foreground",
      )}
    >
      <item.icon className="h-5 w-5" />
      {item.short ?? item.label}
    </Link>
  );
  const active = centre ? pathname.startsWith(centre.to) : false;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-5">
        {left.slice(0, 2).map(tab)}
        <div className="relative flex justify-center">
          {centre && (
            <Link
              to={centre.to}
              aria-label={centre.label === "Add" ? "Add a deficiency" : centre.label}
              data-testid="mobile-fab"
              className="absolute -top-7 flex flex-col items-center gap-0.5"
            >
              <span
                className={cn(
                  "grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-card transition-transform active:scale-95",
                  active && "ring-blush",
                )}
              >
                <centre.icon className="h-8 w-8" strokeWidth={centre.label === "Add" ? 3 : 2.25} />
              </span>
              <span className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-foreground")}>
                {centre.label}
              </span>
            </Link>
          )}
        </div>
        {tab(right)}
        {tab({ to: "/more", label: "More", icon: MoreHorizontal })}
      </div>
    </nav>
  );
}

function JobBadge() {
  const { currentJob } = useAuth();
  return (
    <div className="mt-3 rounded-md border border-sidebar-border bg-card px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current job</p>
      <p className="text-sm font-semibold leading-tight">{currentJob?.name ?? "None selected"}</p>
      {currentJob?.address && <p className="text-xs text-muted-foreground">{currentJob.address}</p>}
      <Link to="/jobs" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <ArrowLeftRight className="h-3 w-3" /> Switch job
      </Link>
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
