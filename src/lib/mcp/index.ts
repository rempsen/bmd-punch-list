import { auth, defineMcp } from "@lovable.dev/mcp-js";
import {
  addComment,
  getDeficiency,
  listDeficiencies,
  updateStatus,
} from "./tools/deficiencies";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "bmd-punch",
  title: "BMD Punch",
  version: "0.1.0",
  instructions:
    "Tools for the BMD Materials deficiency (punch list) tracker. Items are identified like D-0012. Use list_deficiencies to find items, get_deficiency for details and history, update_deficiency_status to move items through the workflow, and add_deficiency_comment to comment.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listDeficiencies, getDeficiency, updateStatus, addComment],
});
