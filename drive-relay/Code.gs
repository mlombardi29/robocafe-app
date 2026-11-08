/**
 * KioskOps Drive relay. SOURCE ONLY.
 * Do not create a Google project, authorize this script, deploy it, or create Drive folders
 * until Michael approves that separate step.
 * The script does not contain a token. At deploy time the token belongs in Script Properties
 * as DRIVE_RELAY_TOKEN. It must never be pasted into the phone app or this repo.
 *
 * Allowed folders, created only after that approval, not by this repository:
 *   KioskOps/Photo audits/<person>/<date>-<site>/
 *   KioskOps/Receipts/<person>/<date>-<site>/
 *   KioskOps/Backups/<date>/
 * This source refuses to create those folders. If a folder is missing it returns folder_missing.
 */
function doPost(e) {
  var token = PropertiesService.getScriptProperties().getProperty("DRIVE_RELAY_TOKEN");
  var presented = header_(e, "x-relay-token");
  if (!token || presented !== token) {
    return json_({ ok: false, error: "Not allowed." });
  }
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "Missing details." });
  }
  var kind = body.kind;
  var parts = body.parts || [];
  var folder = folderFor_(kind, parts);
  if (!folder) return json_({ ok: false, error: "That folder is not allowed." });
  var key = String(body.idempotencyKey || "");
  if (!/^[A-Za-z0-9-]{16,80}$/.test(key)) return json_({ ok: false, error: "Missing save id." });
  var parent = findFolder_(folder);
  if (!parent) return json_({ ok: false, error: "folder_missing" });
  var existing = findInFolder_(parent, key);
  if (existing) return json_({ ok: true, fileId: existing.getId(), replayed: true });
  var bytes = Utilities.base64Decode(String(body.base64 || ""));
  var file = parent.createFile(Utilities.newBlob(bytes, body.mime || "application/octet-stream", safeName_(body.name)));
  file.setDescription("kioskops:" + key);
  return json_({ ok: true, fileId: file.getId(), replayed: false });
}

function folderFor_(kind, parts) {
  var clean = (parts || []).map(function (part) { return String(part).replace(/^\s+|\s+$/g, ""); }).filter(Boolean);
  if (clean.some(function (part) { return part === "." || part === ".." || part.indexOf("/") >= 0 || part.indexOf("\\") >= 0; })) {
    return null;
  }
  if (kind === "photo_audit" && clean.length === 2) return "KioskOps/Photo audits/" + clean[0] + "/" + clean[1];
  if (kind === "receipt" && clean.length === 2) return "KioskOps/Receipts/" + clean[0] + "/" + clean[1];
  if (kind === "backup" && clean.length === 1) return "KioskOps/Backups/" + clean[0];
  return null;
}

function findFolder_(path) {
  var names = path.split("/");
  var current = DriveApp.getRootFolder();
  for (var i = 0; i < names.length; i += 1) {
    var next = current.getFoldersByName(names[i]);
    if (!next.hasNext()) return null;
    current = next.next();
  }
  return current;
}

function findInFolder_(folder, key) {
  var found = folder.searchFiles("fullText contains 'kioskops:" + key + "'");
  while (found.hasNext()) {
    var file = found.next();
    if (file.getDescription() === "kioskops:" + key) return file;
  }
  return null;
}

function safeName_(name) {
  var cleaned = String(name || "file").replace(/[\\/]/g, "-");
  return cleaned.slice(0, 120);
}

function header_(e, name) {
  var headers = (e && e.headers) || {};
  return headers[name] || headers[name.toLowerCase()] || "";
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
