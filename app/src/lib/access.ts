export type Role = "admin" | "tech" | "trainee" | "visitor";
export type Mode = "live" | "practice";

export function inPractice(role: Role, mode: Mode): boolean {
  return role === "trainee" || mode === "practice";
}

export function canReadRow(args: {
  active: boolean;
  role: Role;
  mode: Mode;
  rowSandbox: boolean;
  assigned: boolean;
  contentTable?: boolean;
}): boolean {
  if (!args.active) return false;
  if (args.contentTable) return true;
  if (args.role === "admin") return true;
  if (args.rowSandbox !== inPractice(args.role, args.mode)) return false;
  if (args.rowSandbox) return true;
  return args.assigned;
}

export function canWriteSession(args: {
  active: boolean;
  role: Role;
  mode: Mode;
  siteSandbox: boolean;
  assigned: boolean;
  self: boolean;
}): boolean {
  if (!args.active || !args.self) return false;
  if (args.role === "visitor") return false;
  if (args.siteSandbox !== inPractice(args.role, args.mode)) return false;
  if (args.role === "admin") return true;
  if (args.siteSandbox) return true;
  return args.assigned;
}

/** Submitted times stay put unless an admin is applying a correction. */
export function canChangeSubmittedTimes(role: Role, submitted: boolean): boolean {
  if (!submitted) return true;
  return role === "admin";
}
