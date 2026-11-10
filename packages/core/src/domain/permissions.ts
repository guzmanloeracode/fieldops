import type { Role } from "@fieldops/shared";
import { ForbiddenError } from "./errors";

/** The signed-in member acting inside one organization. Always built on the server from the session. */
export interface Actor {
  userId: string;
  memberId: string;
  organizationId: string;
  role: Role;
  name: string;
}

export type Action =
  | "org.update"
  | "org.billing"
  | "org.delete"
  | "apiKeys.manage"
  | "members.view"
  | "members.invite"
  | "members.update"
  | "members.remove"
  | "customers.view"
  | "customers.create"
  | "customers.update"
  | "customers.delete"
  | "jobs.view"
  | "jobs.create"
  | "jobs.update"
  | "jobs.assign"
  | "jobs.delete"
  | "jobs.work"
  | "jobs.reopen"
  | "serviceTypes.view"
  | "serviceTypes.manage"
  | "expenses.approve"
  | "billing.manage"
  | "dashboard.operational"
  | "dashboard.financial"
  | "audit.view"
  | "ai.use"
  | "demoOutbox.view";

/**
 * Optional facts about the resource being accessed.
 * - `assigned`: the actor is assigned to the job (or the customer/site belongs to one of their jobs).
 * - `belowDispatcherThreshold`: an expense is under the organization's dispatcher approval threshold.
 */
export interface Scope {
  assigned?: boolean;
  belowDispatcherThreshold?: boolean;
}

type Rule = readonly Role[] | ((role: Role, scope: Scope) => boolean);

const MANAGERS = ["owner", "admin"] as const;
const OFFICE = ["owner", "admin", "dispatcher"] as const;
const officeOrAssigned = (role: Role, scope: Scope) =>
  (OFFICE as readonly Role[]).includes(role) || (role === "technician" && scope.assigned === true);

/** The permission matrix from PRD §5.2. One table, one function, enforced on the server. */
const RULES: Record<Action, Rule> = {
  "org.update": MANAGERS,
  "org.billing": ["owner"],
  "org.delete": ["owner"],
  "apiKeys.manage": MANAGERS,
  "members.view": OFFICE,
  "members.invite": MANAGERS,
  "members.update": MANAGERS,
  "members.remove": MANAGERS,
  "customers.view": officeOrAssigned,
  "customers.create": OFFICE,
  "customers.update": OFFICE,
  "customers.delete": MANAGERS,
  "jobs.view": officeOrAssigned,
  "jobs.create": OFFICE,
  "jobs.update": OFFICE,
  "jobs.assign": OFFICE,
  "jobs.delete": MANAGERS,
  "jobs.work": officeOrAssigned,
  "jobs.reopen": OFFICE,
  "serviceTypes.view": ["owner", "admin", "dispatcher", "technician"],
  "serviceTypes.manage": MANAGERS,
  "expenses.approve": (role, scope) =>
    (MANAGERS as readonly Role[]).includes(role) ||
    (role === "dispatcher" && scope.belowDispatcherThreshold === true),
  "billing.manage": OFFICE,
  "dashboard.operational": OFFICE,
  "dashboard.financial": MANAGERS,
  "audit.view": MANAGERS,
  "ai.use": officeOrAssigned,
  "demoOutbox.view": MANAGERS,
};

export function can(actor: Pick<Actor, "role">, action: Action, scope: Scope = {}): boolean {
  const rule = RULES[action];
  return typeof rule === "function" ? rule(actor.role, scope) : rule.includes(actor.role);
}

export function assertCan(actor: Pick<Actor, "role">, action: Action, scope: Scope = {}): void {
  if (!can(actor, action, scope)) throw new ForbiddenError();
}

/** Technicians only ever see their own assigned work (TEC-05). */
export function seesOnlyAssigned(actor: Pick<Actor, "role">): boolean {
  return actor.role === "technician";
}

/** Role changes: only an owner may grant or revoke the owner role. */
export function canChangeRole(actor: Pick<Actor, "role">, fromRole: Role, toRole: Role): boolean {
  if (!can(actor, "members.update")) return false;
  if (fromRole === "owner" || toRole === "owner") return actor.role === "owner";
  return true;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  dispatcher: "Dispatcher",
  technician: "Technician",
};
