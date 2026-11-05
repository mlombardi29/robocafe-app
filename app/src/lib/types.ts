import type { CadenceType } from "./due";

export type Role = "admin" | "tech" | "trainee" | "visitor";
export type Mode = "live" | "practice";

export type Profile = {
  id: string;
  full_name: string;
  goes_by: string;
  email: string | null;
  phone: string | null;
  role: Role;
  mode: Mode;
  active: boolean;
  must_change_pin: boolean;
};

export type SnapItem = {
  id: string;
  key: string;
  title: string;
  details: string | null;
  required: boolean;
  cadence_type: CadenceType;
  cadence_days: number | null;
  threshold_label: string | null;
  locked_during_clean: boolean;
  blocks_clean_start: boolean;
  status: "active" | "pending_validation";
  position: number;
};

export type SnapSection = {
  id: string;
  title: string;
  phase: string;
  position: number;
  items: SnapItem[];
};

export type Snapshot = {
  version: number;
  template_id: string;
  model_code: string;
  milk_clean_minutes: number;
  sections: SnapSection[];
};

export type SiteRow = {
  id: string;
  name: string;
  short_name: string;
  model_id: string;
  serial: string | null;
  cadence: "daily" | "mwf" | "show_days";
  opening_time: string | null;
  active: boolean;
  is_sandbox: boolean;
  models: { code: string; name: string; milk_clean_minutes: number } | null;
};

export type SessionRow = {
  id: string;
  site_id: string;
  person_id: string;
  template_version: number | null;
  checklist_snapshot: Snapshot | null;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  start_estimated: boolean;
  status: "open" | "completed" | "voided";
  current_step_key: string | null;
  milk_clean_started_at: string | null;
  milk_clean_done_at: string | null;
  notes: string | null;
  submitted_at: string | null;
};
