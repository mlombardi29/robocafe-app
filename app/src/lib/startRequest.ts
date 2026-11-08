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
