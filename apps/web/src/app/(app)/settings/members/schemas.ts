import { ValidationError } from "@fieldops/core";
import { ROLES, type Role } from "@fieldops/shared";

export { inviteSchema } from "@fieldops/shared";

type InvitableRole = Exclude<Role, "owner">;

export function parseRole(value: string, allowOwner: true): Role;
export function parseRole(value: string, allowOwner?: false): InvitableRole;
export function parseRole(value: string, allowOwner = false): Role {
  const ok = (ROLES as readonly string[]).includes(value) && (allowOwner || value !== "owner");
  if (!ok) throw new ValidationError("Choose a valid role", [{ path: "role", message: "Choose a valid role" }]);
  return value as Role;
}
