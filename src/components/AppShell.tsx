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
  Receipt,
  History,
  Boxes,
  Home,
  FileText,
} from "lucide-react";
import { roleLabel } from "@/lib/roles";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { NAV_GROUP_KEYS, navGroupOpen } from "@/lib/nav";
import { needsJob, settingsGroup } from "@/lib/settings-tabs";
import { UpdateNotice } from "@/components/UpdateNotice";
import { cn } from "@/lib/utils";

type NavGroup = "company" | "resources" | "job" | "deficiencies" | "post" | "records" | "bottom";
type NavItem = {
  to: string;
  label: string;
  short?: string;
  icon: typeof Camera;
  /** Where the item sits in the desktop sidebar. */
  group?: NavGroup;
  /** Settings tab, or a project tab for Billing / Activity. */
  search?: { tab: string };
  params?: { id: string };
};
/** Settings entries share one page, and so do project tabs, so each is lit only when its own tab is open. */
const isActive = (item: NavItem, pathname: string, tab: string | undefined) => {
  if (item.params) return pathname === `/projects/${item.params.id}` && tab === item.search?.tab;
  return pathname.startsWith(item.to) && (!item.search || settingsGroup(tab) === settingsGroup(item.search.tab));
};

export function useNavItems() {
  const { can, canAny, role, isSuperAdmin, currentJob } = useAuth();
  const items: NavItem[] = [];
  // Company-wide areas for BMD staff. Trades, clients and viewers never see these.
  if (canAny("view_pipeline")) {
    items.push({ to: "/overview", label: "Overview", icon: Home, group: "company" });
    items.push({ to: "/pipeline", label: "Pipeline", icon: Columns3, group: "company" });
    if (canAny("view_pricing")) items.push({ to: "/estimates", label: "Estimates & Quotes", short: "Quotes", icon: FileText, group: "company" });
    items.push({ to: "/projects", label: "Projects", icon: FolderKanban, group: "company" });
    if (canAny("view_pricing")) items.push({ to: "/catalogue", label: "Catalogue", icon: BookOpen, group: "resources" });
    items.push({ to: "/clients", label: "Clients", icon: Building2, group: "resources" });
  }
  // Current job: role-specific entries, then job settings.
  const isTrade = role === "trade";
  if (isTrade) items.push({ to: "/my-work", label: "My work", icon: Wrench, group: "job" });
  if (isTrade) items.push({ to: "/trade-portal", label: "Trade portal", short: "Portal", icon: Briefcase, group: "job" });
  if (role === "bmd_field") items.push({ to: "/trade-portal", label: "My items", short: "Mine", icon: Wrench, group: "job" });
  if (can("decide_client_items") && !can("capture_items"))
    items.push({ to: "/decisions", label: "Decisions", icon: ShieldCheck, group: "job" });
  if (role === "client") items.push({ to: "/client-portal", label: "Client portal", short: "Portal", icon: Briefcase, group: "job" });
  if (can("manage_settings") || can("manage_users"))
    items.push({ to: "/settings", search: { tab: can("manage_settings") ? "project" : "users" }, label: "Job settings", short: "Job", icon: Settings, group: "job" });
  // Post-installation.
  if (can("view_dashboard")) items.push({ to: "/dashboard", label: "Closeout Overview", short: "Overview", icon: BarChart3, group: "post" });
  if (can("capture_items") || can("edit_any_item"))
    items.push({ to: "/board", label: "Board", icon: KanbanSquare, group: "deficiencies" });
  items.push({ to: "/floors", label: "Floors", icon: Grid3x3, group: "deficiencies" });
  items.push({ to: "/list", label: "List", icon: ClipboardList, group: "deficiencies" });
  if (can("view_dashboard")) items.push({ to: "/summary", label: "Summary", icon: Sparkles, group: "deficiencies" });
  if (can("capture_items")) items.push({ to: "/capture", label: "Add a deficiency", short: "Add", icon: Camera, group: "deficiencies" });
  if (can("export_pdf") || can("export_excel"))
    items.push({ to: "/exports", label: "Exports", icon: FileDown, group: "deficiencies" });
  if (role !== "trade" && role !== "viewer") items.push({ to: "/company-work", label: "Remedial Work", short: "Remedial", icon: Wrench, group: "post" });
  if (currentJob && canAny("view_pricing"))
    items.push({ to: "/projects/$id", params: { id: currentJob.id }, search: { tab: "billing" }, label: "Billing", icon: Receipt, group: "post" });
  // Job records.
  if (can("view_documents")) items.push({ to: "/documents", label: "Documents", short: "Docs", icon: FolderOpen, group: "records" });
  if (role !== "trade" && role !== "viewer") items.push({ to: "/photos", label: "Job photos", short: "Photos", icon: Images, group: "records" });
  if (can("manage_settings")) items.push({ to: "/email-intake", label: "Email intake", short: "Email", icon: Mail, group: "records" });
  if (currentJob && canAny("view_pipeline"))
    items.push({ to: "/projects/$id", params: { id: currentJob.id }, search: { tab: "activity" }, label: "Activity", icon: History, group: "records" });
  // Company settings.
  const companyTab = canAny("send_quotes") ? "quotes" : canAny("manage_integrations") ? "integrations" : isSuperAdmin ? "allusers" : can("manage_settings") ? "projects" : null;
  if (companyTab) items.push({ to: "/settings", search: { tab: companyTab }, label: "Settings", short: "Company", icon: Settings, group: "bottom" });
  return items;
}

const linkCls = (active: boolean, indent = false) =>
  cn(
    "flex items-center gap-3 rounded-md border-l-2 py-2.5 text-sm font-medium transition-colors",
    indent ? "pl-9 pr-3" : "px-3",
    active ? "border-blush bg-sidebar-accent text-sidebar-accent-foreground" : "border-transparent opacity-80 hover:bg-sidebar-accent/60",
  );

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide opacity-70">{children}</p>
);

/** An accordion in the sidebar. Remembers open/closed in this browser and opens itself when one of its pages is showing. */
function SidebarGroup({ id, label, icon: Icon, storageKey, items, renderItem, activeItem }: {
  id: string;
  label: string;
  icon: typeof Camera;
  storageKey: string;
  items: NavItem[];
  renderItem: (item: NavItem, indent: boolean) => ReactNode;
  activeItem: NavItem | undefined;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      /* storage blocked */
    }
    setOpen(navGroupOpen(stored, false) || !!activeItem);
    // Only on mount: a deep link is never hidden, but later clicks are the person's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  if (items.length === 0) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      /* not remembered */
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2.5 text-left text-sm font-medium opacity-80 transition-colors hover:bg-sidebar-accent/60"
      >
        <Icon className="h-4 w-4" />
        <span className="min-w-0 flex-1">{label}</span>
        {!open && activeItem && <span className="truncate text-[11px] font-medium opacity-80">{activeItem.label}</span>}
        <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      <div id={id}>
        {open && <div className="ml-5 flex flex-col gap-1 border-l border-sidebar-border pl-1">{items.map((i) => renderItem(i, true))}</div>}
      </div>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavItems();
  const { roles, currentJob, jobsLoaded, loading, canCreateJobs } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabNow = useRouterState({ select: (s) => (s.location.search as { tab?: string }).tab });
  const of = (g: NavGroup) => nav.filter((i) => i.group === g);
  const company = of("company");
  const resources = of("resources");
  const jobItems = of("job");
  const post = of("post");
  const deficiencies = of("deficiencies");
  const records = of("records");
  const bottom = of("bottom");
  const activeIn = (list: NavItem[]) => list.find((i) => isActive(i, pathname, tabNow));
  const navLink = (item: NavItem, indent = false) => (
    <Link
      key={item.label}
      to={item.to}
      {...(item.search ? { search: item.search } : {})}
      {...(item.params ? { params: item.params } : {})}
      className={linkCls(isActive(item, pathname, tabNow), indent)}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
  // Company-wide screens, company settings included, open without a job chosen.
  if (!loading && jobsLoaded && !currentJob && needsJob(pathname, tabNow)) return <Navigate to="/jobs" replace />;
  const closeout = post.find((i) => i.to === "/dashboard");
  const postRest = post.filter((i) => i !== closeout);
  const showPost = !!currentJob || post.length + deficiencies.length > 0;

  return (
    <div className="min-h-screen bg-surface">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen">
          <img src="/bmd-logo.png" alt="BMD Materials" className="mx-auto mb-2 w-[130px]" />
          <nav aria-label="Sidebar" className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {company.length + resources.length > 0 && (
              <>
                <SectionLabel>Workspace · All jobs</SectionLabel>
                {company.map((i) => navLink(i))}
                <SidebarGroup id="nav-resources" label="Resources" icon={Boxes} storageKey={NAV_GROUP_KEYS.resources} items={resources} renderItem={navLink} activeItem={activeIn(resources)} />
              </>
            )}
            <SectionLabel>Current job</SectionLabel>
            <div className="px-0.5 pb-1">
              <JobBadge />
            </div>
            {jobItems.map((i) => navLink(i))}
            {showPost && (
              <>
                <SectionLabel>Post-installation</SectionLabel>
                {closeout && navLink(closeout)}
                <SidebarGroup id="nav-deficiencies" label="Deficiencies" icon={ClipboardList} storageKey={NAV_GROUP_KEYS.deficiencies} items={deficiencies} renderItem={navLink} activeItem={activeIn(deficiencies)} />
                {postRest.map((i) => navLink(i))}
              </>
            )}
            <SidebarGroup id="nav-records" label="Job Records" icon={FolderOpen} storageKey={NAV_GROUP_KEYS.records} items={records} renderItem={navLink} activeItem={activeIn(records)} />
            <div className="mt-auto flex flex-col gap-1 pt-3">
              {canCreateJobs && (
                <Link to="/new-job" className={linkCls(pathname.startsWith("/new-job"))}>
                  <Plus className="h-4 w-4" /> New job
                </Link>
              )}
              {bottom.map((i) => navLink(i))}
            </div>
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
    <div className="rounded-md border border-sidebar-border bg-card px-2.5 py-2">
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
