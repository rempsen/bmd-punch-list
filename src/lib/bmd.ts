export type Assessment = "acceptable" | "client_review" | "must_fix";
export type Status =
  | "open"
  | "awaiting_client"
  | "accepted_as_is"
  | "fix_required"
  | "in_progress"
  | "fixed"
  | "verified";

export const ASSESSMENTS: { value: Assessment; label: string; className: string; dot: string }[] = [
  {
    value: "must_fix",
    label: "Must fix",
    className: "bg-mustfix text-mustfix-foreground",
    dot: "bg-mustfix",
  },
  {
    value: "client_review",
    label: "Needs client review",
    className: "bg-review text-review-foreground",
    dot: "bg-review",
  },
  {
    value: "acceptable",
    label: "Acceptable",
    className: "bg-acceptable text-acceptable-foreground",
    dot: "bg-acceptable",
  },
];

export const assessmentMeta = (a: Assessment) =>
  ASSESSMENTS.find((x) => x.value === a) ?? {
    value: "must_fix" as Assessment,
    label: "Must fix",
    className: "bg-mustfix text-mustfix-foreground",
    dot: "bg-mustfix",
  };

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  awaiting_client: "Awaiting client",
  accepted_as_is: "Accepted as-is",
  fix_required: "Fix required",
  in_progress: "In progress",
  fixed: "Fixed",
  verified: "Verified",
};

export const BOARD_COLUMNS: { key: string; label: string; statuses: Status[] }[] = [
  { key: "open", label: "Open", statuses: ["open"] },
  { key: "awaiting_client", label: "Awaiting client", statuses: ["awaiting_client"] },
  { key: "fix_required", label: "Fix required", statuses: ["fix_required"] },
  { key: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { key: "fixed", label: "Fixed", statuses: ["fixed"] },
  { key: "closed", label: "Closed", statuses: ["accepted_as_is", "verified"] },
];

export const CLOSED_STATUSES: Status[] = ["accepted_as_is", "verified"];

export const isClosed = (s: Status) => CLOSED_STATUSES.includes(s);

export const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  open: ["awaiting_client", "fix_required", "in_progress", "verified", "accepted_as_is"],
  awaiting_client: ["accepted_as_is", "fix_required", "open"],
  fix_required: ["in_progress", "fixed", "open", "awaiting_client"],
  in_progress: ["fixed", "fix_required", "awaiting_client"],
  fixed: ["verified", "fix_required", "awaiting_client"],
  verified: ["fix_required", "open", "awaiting_client"],
  accepted_as_is: ["fix_required", "open", "awaiting_client"],
};

export const itemNo = (n: number) => `D-${String(n).padStart(4, "0")}`;

export const statusBadgeClass = (s: Status) => {
  switch (s) {
    case "awaiting_client":
      return "bg-review/20 text-review-foreground border-review/40";
    case "fix_required":
    case "open":
      return "bg-mustfix/10 text-mustfix border-mustfix/30";
    case "in_progress":
      return "bg-primary/10 text-primary border-primary/30";
    case "fixed":
      return "bg-acceptable/15 text-acceptable border-acceptable/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};
