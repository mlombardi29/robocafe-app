/**
 * KioskOps Drive relay. SOURCE ONLY.
 * Do not create a Google project, authorize this script, deploy it, or create Drive folders
 * until Michael approves that separate step.
 * The script does not contain a token. At deploy time the token belongs in Script Properties
 * as DRIVE_RELAY_TOKEN. It must never be pasted into the phone app or this repo.
 *
 * doPost does not receive HTTP headers. The token is read from postData.contents.
 *
 * Allowed folders, created only after that approval, not by this repository:
 *   KioskOps/Photo audits/<person>/<date>-<site>/
 *   KioskOps/Receipts/<person>/<date>-<site>/
 *   KioskOps/Backups/<date>/
 * This source refuses to create those folders. If a folder is missing it returns folder_missing.
 */
function doPost(e) {
  var token = PropertiesService.getScriptProperties().getProperty("DRIVE_RELAY_TOKEN");
  var body = body_(e);
  if (!body) return json_({ ok: false, error: "Missing details." });
  var presented = String(body.relayToken || "");
  if (!token || presented !== token) return json_({ ok: false, error: "Not allowed." });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, error: "busy" });
  }
  try {
    return handleLocked_(body);
  } finally {
    lock.releaseLock();
  }
}

function handleLocked_(body) {
  var folder = String(body.folder || "");
  if (!folderAllowed_(folder)) return json_({ ok: false, error: "That folder is not allowed." });
  var key = String(body.idempotencyKey || "");
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(key)) return json_({ ok: false, error: "Missing save id." });
  var parent = findFolder_(folder);
  if (!parent) return json_({ ok: false, error: "folder_missing" });
  var existing = findInFolder_(parent, key);
  if (existing) return json_({ ok: true, fileId: existing.getId(), replayed: true, key: key });
  var bytes = Utilities.base64Decode(String(body.base64 || ""));
  if (!bytes || bytes.length < 3 || bytes.length > 2000000) return json_({ ok: false, error: "That file is not allowed." });
  var file = parent.createFile(Utilities.newBlob(bytes, "application/octet-stream", safeName_(body.name)));
  file.setDescription("kioskops:" + key);
  return json_({ ok: true, fileId: file.getId(), replayed: false, key: key });
}

function body_(e) {
  try {
    var parsed = JSON.parse((e && e.postData && e.postData.contents) || "");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function folderAllowed_(folder) {
  if (!folder || folder.indexOf("..") >= 0 || folder.indexOf("\\") >= 0) return false;
  var roots = ["KioskOps/Photo audits/", "KioskOps/Receipts/", "KioskOps/Backups/"];
  for (var i = 0; i < roots.length; i += 1) {
    if (folder.indexOf(roots[i]) === 0 && folder.length > roots[i].length) return true;
  }
  return false;
}

function findFolder_(path) {
  var names = path.split("/");
  var current = DriveApp.getRootFolder();
  for (var i = 0; i < names.length; i += 1) {
    if (!names[i] || names[i] === "." || names[i] === "..") return null;
    var next = current.getFoldersByName(names[i]);
    if (!next.hasNext()) return null;
    current = next.next();
  }
  return current;
}

function findInFolder_(folder, key) {
  var found = folder.searchFiles("fullText contains '" + "kioskops:" + key + "'");
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

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
