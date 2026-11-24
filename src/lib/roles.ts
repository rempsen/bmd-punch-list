export type AppRole = "super_admin" | "bmd_manager" | "bmd_field" | "trade" | "client" | "viewer";

export const ROLES: { value: AppRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super admin", description: "Full control, including users, roles and project setup." },
  { value: "bmd_manager", label: "BMD manager", description: "Runs all items, rooms, pick lists and non-admin users." },
  { value: "bmd_field", label: "BMD field", description: "Captures items and photos; moves work to in progress / fixed." },
  { value: "trade", label: "Tradesperson", description: "Sees open must-fix work only; adds after-photos and marks fixed." },
  { value: "client", label: "Client", description: "Decides items, verifies fixes, comments and exports PDF." },
  { value: "viewer", label: "Viewer", description: "Read-only access with PDF export." },
];

export const roleLabel = (r: string | null | undefined) =>
  r === "bmd_admin" ? "Super admin" : (ROLES.find((x) => x.value === r)?.label ?? "No access");

export type Capability =
  | "capture_items"
  | "edit_any_item"
  | "edit_own_item"
  | "delete_item"
  | "change_assessment"
  | "decide_client_items"
  | "verify_items"
  | "assign_items"
  | "add_photos"
  | "comment"
  | "view_dashboard"
  | "view_acceptable_items"
  | "view_client_notes"
  | "export_pdf"
  | "export_excel"
  | "manage_users"
  | "manage_settings"
  | "create_jobs"
  | "view_pipeline"
  | "manage_projects"
  | "view_documents"
  | "manage_documents"
  | "view_pricing"
  | "manage_estimates"
  | "send_quotes"
  | "manage_catalogue"
  | "manage_integrations"
  | "manage_materials"
  | "use_assistant";

export const CAPABILITIES: { value: Capability; label: string }[] = [
  { value: "capture_items", label: "Add deficiencies" },
  { value: "edit_any_item", label: "Edit any item" },
  { value: "edit_own_item", label: "Edit own items" },
  { value: "delete_item", label: "Delete items" },
  { value: "change_assessment", label: "Change assessment" },
  { value: "decide_client_items", label: "Make client decisions" },
  { value: "verify_items", label: "Verify fixed items" },
  { value: "assign_items", label: "Assign items" },
  { value: "add_photos", label: "Add photos / progress work" },
  { value: "comment", label: "Comment" },
  { value: "view_dashboard", label: "View dashboard" },
  { value: "view_acceptable_items", label: "See all items (incl. acceptable)" },
  { value: "view_client_notes", label: "See client decision notes" },
  { value: "export_pdf", label: "Export PDF" },
  { value: "export_excel", label: "Export Excel / CSV" },
  { value: "manage_users", label: "Manage users" },
  { value: "manage_settings", label: "Manage settings (rooms, lists, project)" },
  { value: "create_jobs", label: "Create new jobs" },
  { value: "view_pipeline", label: "See pipeline and clients" },
  { value: "manage_projects", label: "Create and move projects; edit clients" },
  { value: "view_documents", label: "See project documents" },
  { value: "manage_documents", label: "Upload and manage documents" },
  { value: "view_pricing", label: "See costs, markup and pricing" },
  { value: "manage_estimates", label: "Build estimates" },
  { value: "send_quotes", label: "Send quotes and change orders" },
  { value: "manage_catalogue", label: "Manage materials catalogue" },
  { value: "manage_integrations", label: "Manage integrations" },
  { value: "manage_materials", label: "Manage materials (order, receive, deliver)" },
  { value: "use_assistant", label: "Use Ask BMD (the assistant)" },
];
