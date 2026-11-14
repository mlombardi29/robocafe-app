export type StartJob = {
  id: string;
  siteId: string;
  start: string;
  estimated: boolean;
  photoAudit?: boolean;
};

export function startRequest(job: StartJob) {
  const args: {
    p_id: string;
    p_site: string;
    p_start: string;
    p_estimated: boolean;
    p_photo_audit?: true;
  } = {
    p_id: job.id,
    p_site: job.siteId,
    p_start: job.start,
    p_estimated: job.estimated,
  };
  if (job.photoAudit) args.p_photo_audit = true;
  return args;
}

/** True only when this server does not have the photo-audit argument on start_session. */
export function photoAuditArgMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/start_session/i.test(message) || !/p_photo_audit/i.test(message)) return false;
  if (error.code === "PGRST202") return true;
  return /could not find the function|schema cache|does not exist/i.test(message);
}

export function withoutPhotoArg<T extends { p_photo_audit?: true }>(args: T): Omit<T, "p_photo_audit"> {
  const next = { ...args };
  delete next.p_photo_audit;
  return next;
}

export function acceptStartResult(
  askedForPhotoAudit: boolean,
  row: { checklist_snapshot?: { photo_audit?: { required?: boolean } } | null } | null,
): boolean {
  const snapshot = row?.checklist_snapshot;
  if (!snapshot) return false;
  if (!askedForPhotoAudit) return true;
  if (!snapshot.photo_audit) return true;
  return typeof snapshot.photo_audit.required === "boolean";
}
