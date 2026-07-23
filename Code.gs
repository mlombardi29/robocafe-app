/**
 * Robo Café — Warehouse Inventory
 * Google Apps Script backend (container-bound to the Google Sheet).
 *
 * ARCHITECTURE (since the GitHub Pages move):
 *   - The app's page (index.html) is hosted on GitHub Pages and talks to this
 *     backend over the web: it POSTs JSON to the deployed /exec URL, and
 *     doPost() below routes each request to the right function.
 *   - Visiting the /exec URL directly just shows a "we've moved" notice
 *     pointing at the GitHub Pages link (doGet below).
 *   - Every request (except sign-in itself) must carry a session token issued
 *     at PIN sign-in. Wrong-PIN attempts are rate limited; after too many the
 *     PIN locks until a manager resets it from Settings.
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet (this becomes the database).
 *   2. Extensions > Apps Script. Paste this file as Code.gs.
 *   3. Run the function `setup` once (authorize when prompted). This creates all
 *      tabs and seeds your SKUs, kiosks, people and config.
 *   4. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: Anyone        <-- required for the app page to reach it
 *   5. Put that /exec URL into SCRIPT_URL near the top of index.html.
 *   6. (Optional) In the Config tab, add a row: key `backupEmails`, value a
 *      comma-separated list of addresses for the 60-day snapshot email.
 */

// ---- Tab names ----------------------------------------------------------
var SHEETS = {
  SKUS: 'SKUs',
  TX: 'Transactions',
  LOCATIONS: 'Locations',
  LOC_SKUS: 'LocationSKUs',
  FLAGS: 'KioskFlags',
  PEOPLE: 'People',
  CONFIG: 'Config',
  SERVICE: 'ServiceSessions',
  SCHED: 'ScheduleOverrides',
  PAY: 'Payments',
  CHG: 'Charges'
};

var HEADERS = {
  SKUs: ['id','name','active','baseUnit','baseUnitNote',
         'opt1Name','opt1PerBase','opt1Supplier','opt1LeadDays',
         'opt2Name','opt2PerBase','opt2Supplier','opt2LeadDays',
         'reorderThreshold','notes'],
  Transactions: ['id','timestamp','type','skuId','skuName','delta','rawQty','rawUnit','byName','byRole','locationId','note'],
  Locations: ['id','name','series','active'],
  LocationSKUs: ['locationId','skuId','active'],
  KioskFlags: ['id','timestamp','locationId','locationName','skuId','skuName','status','byName','note','resolved','resolvedBy','resolvedAt'],
  People: ['name','role','active','pin'],
  Config: ['key','value'],
  ServiceSessions: ['id','kioskId','locationName','model','checklistVersion','technicianName','startedAt','completedAt','status','percentComplete','requiredIncomplete','incompleteReason','overallNotes','completionsJson','serviceDate','startTime','endTime','milkBagChanged'],
  ScheduleOverrides: ['date','kioskId','coverageRequested','requestedBy','claimedBy','originalAssignee','note','updatedAt'],
  Payments: ['id','personName','periodStart','periodEnd','paidDate','notes','voided','createdAt'],
  Charges: ['id','personName','type','date','description','amount','startTime','endTime','hours','receiptLink','paid','paidDate','paidNote','voided','createdAt']
};

// ---- Web app entry points -----------------------------------------------
// The app itself now lives on GitHub Pages. Anyone landing on the old Apps
// Script URL just gets a pointer to the new permanent home.
var APP_HOME_URL = 'https://mlombardi29.github.io/robocafe-app/';

function doGet() {
  var html =
    '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:system-ui,sans-serif;background:#f1ece1;color:#191c12;display:grid;place-items:center;min-height:96vh;margin:0;padding:20px;text-align:center}' +
    '.c{background:#fbf8f1;border:1px solid #e6dfce;border-radius:16px;padding:32px 24px;max-width:420px;box-shadow:0 8px 22px #1c1f1412}' +
    'h1{font-size:22px;margin:10px 0 8px}p{color:#6f745f;line-height:1.5;margin:0}' +
    'a.b{display:inline-block;margin-top:18px;background:#6ecf98;color:#191c12;font-weight:700;padding:14px 26px;border-radius:12px;text-decoration:none;font-size:16px}' +
    '.u{font-size:12px;color:#6f745f;margin-top:16px;word-break:break-all}</style></head><body>' +
    '<div class="c"><div style="font-size:34px">☕</div><h1>Robo Café has moved</h1>' +
    '<p>This page isn’t used anymore. The app now lives at its new permanent home — tap below and update your saved link.</p>' +
    '<a class="b" href="' + APP_HOME_URL + '">Open the Robo Café app →</a>' +
    '<div class="u">' + APP_HOME_URL + '</div></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Robo Café has moved')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---- Sheet helpers ------------------------------------------------------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

var _hdrChecked = {};
function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) {
    s = ss_().insertSheet(name);
    s.appendRow(HEADERS[name]);
    s.setFrozenRows(1);
    _hdrChecked[name] = true;
    return s;
  }
  if (!_hdrChecked[name]) { ensureHeaders_(s, name); _hdrChecked[name] = true; }
  return s;
}
function ensureHeaders_(s, name) {
  var want = HEADERS[name]; if (!want) return;
  var lastCol = s.getLastColumn();
  var have = lastCol > 0 ? s.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var missing = want.filter(function(h){ return have.indexOf(h) < 0; });
  if (missing.length) s.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
}

function readObjects_(name) {
  var s = sheet_(name);
  var rng = s.getDataRange().getValues();
  if (rng.length < 2) return [];
  var head = rng[0];
  var out = [];
  for (var r = 1; r < rng.length; r++) {
    var row = rng[r];
    if (row.join('') === '') continue;
    var o = { _row: r + 1 };
    for (var c = 0; c < head.length; c++) o[head[c]] = row[c];
    out.push(o);
  }
  return out;
}

function appendObject_(name, obj) {
  var s = sheet_(name);
  var head = HEADERS[name];
  var row = head.map(function(h){ return (obj[h] === undefined || obj[h] === null) ? '' : obj[h]; });
  s.appendRow(row);
}

function updateCell_(name, rowNum, field, value) {
  var s = sheet_(name);
  var col = HEADERS[name].indexOf(field) + 1;
  if (col > 0) s.getRange(rowNum, col).setValue(value);
}

function newId_(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random()*1296).toString(36);
}

function configMap_() {
  var m = {};
  readObjects_(SHEETS.CONFIG).forEach(function(r){ m[r.key] = r.value; });
  return m;
}

function num_(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
// --- value coercion: Sheets stores dates/times as typed cells, which come back as Date
//     objects. Raw Dates serialize inconsistently on their way to the browser and break
//     downstream string logic, so every service reader funnels these fields through the
//     helpers below. Keep doing this for any new function that returns Sheet date/times. ---
function svcTz_(){ try { return ss_().getSpreadsheetTimeZone(); } catch(e){ try { return Session.getScriptTimeZone(); } catch(e2){ return 'America/Toronto'; } } }
function dStr_(v){ if (v instanceof Date) return Utilities.formatDate(v, svcTz_(), 'yyyy-MM-dd'); return v==null ? '' : String(v); }
function tStr_(v){ if (v instanceof Date) return Utilities.formatDate(v, svcTz_(), 'HH:mm'); return v==null ? '' : String(v); }
function isoS_(v){ if (v instanceof Date) return v.toISOString(); return v==null ? '' : String(v); }

// =========================================================================
//  SETUP / SEED
// =========================================================================
function setup() {
  Object.keys(SHEETS).forEach(function(k){ sheet_(SHEETS[k]); });

  // --- Config ---
  if (readObjects_(SHEETS.CONFIG).length === 0) {
    appendObject_(SHEETS.CONFIG, { key: 'appTitle', value: 'Robo Café Inventory' });
    appendObject_(SHEETS.CONFIG, { key: 'lowDaysThreshold', value: '3' });
  }

  // --- People ---
  if (readObjects_(SHEETS.PEOPLE).length === 0) {
    [['Michael','manager'],['Kajsa','manager'],['Peter','technician'],['Rob','technician']]
      .forEach(function(p){ appendObject_(SHEETS.PEOPLE, { name:p[0], role:p[1], active:true }); });
  }

  // --- Locations ---
  if (readObjects_(SHEETS.LOCATIONS).length === 0) {
    [['RBC Amphitheatre','Series 5'],
     ['University of Toronto (Sid\'s Cafe)','Series 2.2'],
     ['Mount Sinai Hospital','Series 3.5']]
      .forEach(function(l){ appendObject_(SHEETS.LOCATIONS, { id:newId_('L'), name:l[0], series:l[1], active:true }); });
  }

  // --- SKUs ---  [name, baseUnit, baseNote, o1Name,o1Per,o1Sup,o1Lead, o2Name,o2Per,o2Sup,o2Lead]
  if (readObjects_(SHEETS.SKUS).length === 0) {
    var seed = [
      ['Oat Milk','box','946 ml','pack',6,'Instacart',0, '',0,'',''],
      ['2% Milk','jug','4 L','jug',1,'Instacart',0, '',0,'',''],
      ['Espresso beans','bag','5 lb','bag',1,'Propeller',2, 'container',3,'Propeller',2],
      ['Decaf espresso beans','bag','5 lb','bag',1,'Propeller',2, 'container',3,'Propeller',2],
      ['Hot Chocolate Powder','tin','1.7 kg','tin',1,'Amazon',1, '',0,'',''],
      ['Matcha powder','tin','250 g','tin',1,'Amazon',1, '',0,'',''],
      ['Sugar','bag','2 kg','bag',1,'Instacart',0, '',0,'',''],
      ['Vanilla Syrup','bottle','1 L','pack',6,'8 Ounce',5, '',0,'',''],
      ['Caramel Syrup','bottle','1 L','pack',6,'8 Ounce',5, '',0,'',''],
      ['Iced Tea Lemon Syrup','bottle','1 L','pack',6,'8 Ounce',5, '',0,'',''],
      ['Peach Syrup','bottle','1 L','pack',6,'8 Ounce',5, '',0,'',''],
      ['Coffee Concentrate','bottle','1 L','pack',6,'Hatch',5, '',0,'',''],
      ['Blueberry Pomegranate Concentrate','bottle','4 L','pack',2,'Kiosoft',5, '',0,'',''],
      ['Strawberry Watermelon Concentrate','bottle','4 L','pack',2,'Kiosoft',5, '',0,'',''],
      ['Lemon Lime Concentrate','bottle','4 L','pack',2,'Kiosoft',5, '',0,'',''],
      ['Everclean Solution','bottle','1 L','bottle',1,'Kiosoft',10, '',0,'',''],
      ['Eversys Cleaning Balls','bottle','62 balls','bottle',1,'Kiosoft',10, '',0,'',''],
      ['10L Milk Bags','bag','10 L','batch',10,'Kiosoft',5, '',0,'',''],
      ['20L Milk Bags','bag','20 L','batch',10,'Kiosoft',5, '',0,'',''],
      ['12 oz Hot Cup','sleeve','50 cups','case',20,'Amazon',2, '',0,'',''],
      ['12 oz Cold Cup','sleeve','50 cups','case',20,'Amazon',2, '',0,'',''],
      ['16 oz Cold Cup','sleeve','50 cups','case',20,'Amazon',2, '',0,'',''],
      ['Lids','sleeve','100 lids','case',10,'Amazon',2, '',0,'',''],
      ['Rinza Cleaning Solution','bottle','1 L','bottle',1,'Amazon',1, '',0,'','']
    ];
    seed.forEach(function(x){
      appendObject_(SHEETS.SKUS, {
        id:newId_('S'), name:x[0], active:true, baseUnit:x[1], baseUnitNote:x[2],
        opt1Name:x[3], opt1PerBase:x[4], opt1Supplier:x[5], opt1LeadDays:x[6],
        opt2Name:x[7], opt2PerBase:x[8], opt2Supplier:x[9], opt2LeadDays:x[10],
        reorderThreshold:'', notes:''
      });
    });
  }
  // Idempotent top-up: make sure standard items exist even on already-seeded sheets.
  ensureCoreSkus_();
  return 'Setup complete. Deploy as a web app next.';
}

// Standard items every deployment should have. To add a new standard consumable,
// add a row here, then either re-run setup() OR tap "Sync standard items" in Settings.
var CORE_SKUS_ = [
  ['2% Milk','jug','4 L','jug',1,'Instacart',0, '',0,'',''],
  ['12 oz Hot Cup','sleeve','50 cups','case',20,'Amazon',2, '',0,'',''],
  ['12 oz Cold Cup','sleeve','50 cups','case',20,'Amazon',2, '',0,'',''],
  ['16 oz Cold Cup','sleeve','50 cups','case',20,'Amazon',2, '',0,'',''],
  ['Lids','sleeve','100 lids','case',10,'Amazon',2, '',0,'','']
];
// Adds any missing standard items (by name, case-insensitive). Returns names added.
function ensureCoreSkus_(){
  var have={}; readObjects_(SHEETS.SKUS).forEach(function(s){ have[String(s.name).trim().toLowerCase()]=true; });
  var added=[];
  CORE_SKUS_.forEach(function(x){
    if(have[String(x[0]).toLowerCase()]) return;
    appendObject_(SHEETS.SKUS, { id:newId_('S'), name:x[0], active:true, baseUnit:x[1], baseUnitNote:x[2],
      opt1Name:x[3], opt1PerBase:x[4], opt1Supplier:x[5], opt1LeadDays:x[6],
      opt2Name:x[7], opt2PerBase:x[8], opt2Supplier:x[9], opt2LeadDays:x[10], reorderThreshold:'', notes:'' });
    added.push(x[0]);
  });
  return added;
}
// Client-callable from Manager - Settings: add any missing standard items on demand.
function syncStandardItems(){
  return { ok:true, added: ensureCoreSkus_() };
}

// =========================================================================
//  READ APIs (client)
// =========================================================================
function getBootstrap() {
  var cfg = configMap_();
  return {
    appTitle: cfg.appTitle || 'Robo Café Inventory',
    locations: readObjects_(SHEETS.LOCATIONS).filter(function(l){ return l.active !== false && l.active !== 'FALSE'; })
                 .map(function(l){ return { id:l.id, name:l.name, series:l.series }; }),
    skus: activeSkus_().map(function(s){ return skuPublic_(s); }),
    people: readObjects_(SHEETS.PEOPLE).filter(function(p){ return p.active !== false && p.active !== 'FALSE'; })
              .map(function(p){ return { name:p.name, role:p.role }; })
  };
}

function activeSkus_() {
  return readObjects_(SHEETS.SKUS).filter(function(s){ return s.active !== false && s.active !== 'FALSE'; });
}

function skuPublic_(s) {
  var opts = [];
  if (s.opt1Name) opts.push({ name:s.opt1Name, perBase:num_(s.opt1PerBase)||1, supplier:s.opt1Supplier, leadDays:num_(s.opt1LeadDays) });
  if (s.opt2Name) opts.push({ name:s.opt2Name, perBase:num_(s.opt2PerBase)||1, supplier:s.opt2Supplier, leadDays:num_(s.opt2LeadDays) });
  return {
    id:s.id, name:s.name, baseUnit:s.baseUnit, baseUnitNote:s.baseUnitNote,
    options:opts, reorderThreshold:s.reorderThreshold, notes:s.notes
  };
}

function leadDaysFor_(s) {
  var leads = [];
  if (s.opt1Name) leads.push(num_(s.opt1LeadDays));
  if (s.opt2Name) leads.push(num_(s.opt2LeadDays));
  return leads.length ? Math.min.apply(null, leads) : 0;
}

/** Core stats engine: current qty + usage/replenishment frequency per SKU. */
function computeInventory_() {
  var cfg = configMap_();
  var buffer = num_(cfg.lowDaysThreshold) || 3;
  var skus = readObjects_(SHEETS.SKUS);
  var tx = readObjects_(SHEETS.TX);
  var now = new Date();
  var DAY = 86400000;

  var byId = {};
  skus.forEach(function(s){
    byId[s.id] = {
      sku:s, qty:0,
      withdraw7:0, withdraw30:0, receive30:0, receiveCount30:0,
      firstWithdraw:null, lastTx:null
    };
  });

  tx.forEach(function(t){
    var b = byId[t.skuId];
    if (!b) return;
    var d = num_(t.delta);
    b.qty += d;
    var ts = t.timestamp ? new Date(t.timestamp) : null;
    if (!ts) return;
    var ageDays = (now - ts) / DAY;
    if (!b.lastTx || ts > b.lastTx) b.lastTx = ts;
    if (t.type === 'withdraw') {
      if (!b.firstWithdraw || ts < b.firstWithdraw) b.firstWithdraw = ts;
      if (ageDays <= 7)  b.withdraw7  += -d;
      if (ageDays <= 30) b.withdraw30 += -d;
    } else if (t.type === 'receive') {
      if (ageDays <= 30) { b.receive30 += d; b.receiveCount30 += 1; }
    }
  });

  return skus.filter(function(s){ return s.active !== false && s.active !== 'FALSE'; }).map(function(s){
    var b = byId[s.id];
    // Average daily usage over up to 30 days of available history.
    var spanDays = 30;
    if (b.firstWithdraw) spanDays = Math.max(1, Math.min(30, (now - b.firstWithdraw) / DAY));
    var avgDaily = b.withdraw30 > 0 ? (b.withdraw30 / spanDays) : null;
    var daysLeft = (avgDaily && avgDaily > 0) ? (b.qty / avgDaily) : null;
    var lead = leadDaysFor_(s);
    var threshold = s.reorderThreshold === '' ? null : num_(s.reorderThreshold);

    var status = 'OK';
    if (b.qty <= 0) status = 'OUT';
    else if (threshold !== null && b.qty <= threshold) status = 'LOW';
    else if (daysLeft !== null && daysLeft <= (lead + buffer)) status = 'REORDER';

    return {
      id:s.id, name:s.name, baseUnit:s.baseUnit, baseUnitNote:s.baseUnitNote,
      qty: Math.round(b.qty * 100) / 100,
      withdraw7: Math.round(b.withdraw7*100)/100,
      withdraw30: Math.round(b.withdraw30*100)/100,
      receive30: Math.round(b.receive30*100)/100,
      receiveCount30: b.receiveCount30,
      avgDaily: avgDaily === null ? null : Math.round(avgDaily*100)/100,
      daysLeft: daysLeft === null ? null : Math.round(daysLeft*10)/10,
      leadDays: lead,
      threshold: threshold,
      status: status,
      lastTx: b.lastTx ? b.lastTx.toISOString() : null,
      hasUsageData: avgDaily !== null
    };
  });
}

function getInventory() { return computeInventory_(); }

function getDashboard() {
  var inv = computeInventory_();
  var order = { OUT:0, REORDER:1, LOW:2, OK:3 };
  inv.sort(function(a,b){ return (order[a.status]-order[b.status]) || a.name.localeCompare(b.name); });
  var flags = readObjects_(SHEETS.FLAGS)
    .filter(function(f){ return f.resolved !== true && f.resolved !== 'TRUE'; })
    .map(function(f){
      return { id:f.id, timestamp:f.timestamp ? new Date(f.timestamp).toISOString() : '',
               locationName:f.locationName, skuName:f.skuName, status:f.status, byName:f.byName, note:f.note };
    })
    .sort(function(a,b){ return b.timestamp.localeCompare(a.timestamp); });
  return {
    inventory: inv,
    openFlags: flags,
    counts: {
      out: inv.filter(function(i){return i.status==='OUT';}).length,
      reorder: inv.filter(function(i){return i.status==='REORDER'||i.status==='LOW';}).length,
      flags: flags.length
    }
  };
}

// =========================================================================
//  WRITE APIs (client)
// =========================================================================
/** Technician: pull items out of the warehouse. items = [{skuId, qty}] in base units. */
function recordWithdrawal(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var skus = readObjects_(SHEETS.SKUS);
    var name = {}; skus.forEach(function(s){ name[s.id]=s.name; });
    var ts = new Date();
    (payload.items || []).forEach(function(it){
      var q = num_(it.qty);
      if (!it.skuId || q <= 0) return;
      appendObject_(SHEETS.TX, {
        id:newId_('TX'), timestamp:ts, type:'withdraw', skuId:it.skuId, skuName:name[it.skuId]||'',
        delta:-q, rawQty:q, rawUnit:'base', byName:payload.byName||'', byRole:payload.byRole||'technician',
        locationId:'', note:payload.note||''
      });
    });
    return { ok:true };
  } finally { lock.releaseLock(); }
}

/** Manager: log a delivery into the warehouse. */
function recordReceipt(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var s = readObjects_(SHEETS.SKUS).filter(function(x){ return x.id === payload.skuId; })[0];
    if (!s) throw new Error('Unknown item.');
    var perBase = 1, rawUnit = s.baseUnit;
    if (payload.optionIndex === 0 && s.opt1Name) { perBase = num_(s.opt1PerBase)||1; rawUnit = s.opt1Name; }
    else if (payload.optionIndex === 1 && s.opt2Name) { perBase = num_(s.opt2PerBase)||1; rawUnit = s.opt2Name; }
    var rawQty = num_(payload.qty);
    if (rawQty <= 0) throw new Error('Quantity must be greater than zero.');
    var delta = rawQty * perBase;
    appendObject_(SHEETS.TX, {
      id:newId_('TX'), timestamp:new Date(), type:'receive', skuId:s.id, skuName:s.name,
      delta:delta, rawQty:rawQty, rawUnit:rawUnit, byName:payload.byName||'', byRole:'manager',
      locationId:'', note:payload.note||''
    });
    return { ok:true, addedBase:delta };
  } finally { lock.releaseLock(); }
}

/** Manager: set an item's warehouse count to a true number (recount). */
function recordAdjustment(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var inv = computeInventory_();
    var cur = 0, found = false;
    inv.forEach(function(i){ if (i.id === payload.skuId) { cur = i.qty; found = true; } });
    if (!found) throw new Error('Unknown item.');
    var target = num_(payload.newQty);
    var delta = target - cur;
    var s = readObjects_(SHEETS.SKUS).filter(function(x){ return x.id === payload.skuId; })[0];
    appendObject_(SHEETS.TX, {
      id:newId_('TX'), timestamp:new Date(), type:'adjust', skuId:payload.skuId, skuName:s?s.name:'',
      delta:delta, rawQty:target, rawUnit:'count', byName:payload.byName||'', byRole:'manager',
      locationId:'', note:payload.note||'Recount'
    });
    return { ok:true, from:cur, to:target };
  } finally { lock.releaseLock(); }
}

/** Technician: flag low/out items at a kiosk. items = [{skuId, status}] status in {low,out}. */
function recordKioskFlags(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var loc = readObjects_(SHEETS.LOCATIONS).filter(function(l){ return l.id === payload.locationId; })[0];
    var skuName = {}; readObjects_(SHEETS.SKUS).forEach(function(s){ skuName[s.id]=s.name; });
    var ts = new Date();
    var by = payload.byName || '';
    // This submission replaces the kiosk's current state: resolve every still-open flag
    // here (auto-clearing stale low/out warnings), then record what's marked low/out now.
    var open = readObjects_(SHEETS.FLAGS).filter(function(r){
      return r.locationId===payload.locationId && !flagResolved_(r);
    });
    open.forEach(function(r){
      updateCell_(SHEETS.FLAGS, r._row, 'resolved', true);
      updateCell_(SHEETS.FLAGS, r._row, 'resolvedBy', by);
      updateCell_(SHEETS.FLAGS, r._row, 'resolvedAt', ts);
    });
    var added = 0;
    (payload.items || []).forEach(function(it){
      if (!it.skuId || !it.status) return;
      appendObject_(SHEETS.FLAGS, {
        id:newId_('F'), timestamp:ts, locationId:payload.locationId, locationName:loc?loc.name:'',
        skuId:it.skuId, skuName:skuName[it.skuId]||'', status:it.status, byName:by,
        note:payload.note||'', resolved:false, resolvedBy:'', resolvedAt:''
      });
      added++;
    });
    return { ok:true, cleared:open.length, added:added };
  } finally { lock.releaseLock(); }
}
function flagResolved_(r){ return r.resolved===true || r.resolved==='TRUE' || r.resolved==='true'; }

function resolveFlag(flagId, byName) {
  var rows = readObjects_(SHEETS.FLAGS);
  for (var i=0;i<rows.length;i++) {
    if (rows[i].id === flagId) {
      updateCell_(SHEETS.FLAGS, rows[i]._row, 'resolved', true);
      updateCell_(SHEETS.FLAGS, rows[i]._row, 'resolvedBy', byName||'');
      updateCell_(SHEETS.FLAGS, rows[i]._row, 'resolvedAt', new Date());
      return { ok:true };
    }
  }
  throw new Error('Flag not found.');
}

// ---- SKU management (manager) ------------------------------------------
function saveSku(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var fields = {
      name:payload.name, active:true, baseUnit:payload.baseUnit, baseUnitNote:payload.baseUnitNote||'',
      opt1Name:payload.opt1Name||'', opt1PerBase:payload.opt1PerBase||'', opt1Supplier:payload.opt1Supplier||'', opt1LeadDays:payload.opt1LeadDays||'',
      opt2Name:payload.opt2Name||'', opt2PerBase:payload.opt2PerBase||'', opt2Supplier:payload.opt2Supplier||'', opt2LeadDays:payload.opt2LeadDays||'',
      reorderThreshold:(payload.reorderThreshold===undefined?'':payload.reorderThreshold), notes:payload.notes||''
    };
    if (payload.id) {
      var rows = readObjects_(SHEETS.SKUS);
      for (var i=0;i<rows.length;i++) if (rows[i].id===payload.id) {
        Object.keys(fields).forEach(function(f){ updateCell_(SHEETS.SKUS, rows[i]._row, f, fields[f]); });
        return { ok:true, id:payload.id };
      }
      throw new Error('Item not found.');
    } else {
      fields.id = newId_('S');
      appendObject_(SHEETS.SKUS, fields);
      return { ok:true, id:fields.id };
    }
  } finally { lock.releaseLock(); }
}

function setSkuActive(skuId, active) {
  var rows = readObjects_(SHEETS.SKUS);
  for (var i=0;i<rows.length;i++) if (rows[i].id===skuId) {
    updateCell_(SHEETS.SKUS, rows[i]._row, 'active', !!active);
    return { ok:true };
  }
  throw new Error('Item not found.');
}

function getAllSkusForManager() {
  return readObjects_(SHEETS.SKUS).map(function(s){
    var pub = skuPublic_(s);
    pub.active = !(s.active === false || s.active === 'FALSE');
    pub.opt1Name=s.opt1Name; pub.opt1PerBase=s.opt1PerBase; pub.opt1Supplier=s.opt1Supplier; pub.opt1LeadDays=s.opt1LeadDays;
    pub.opt2Name=s.opt2Name; pub.opt2PerBase=s.opt2PerBase; pub.opt2Supplier=s.opt2Supplier; pub.opt2LeadDays=s.opt2LeadDays;
    return pub;
  });
}

// ---- Location management (manager) -------------------------------------
function saveLocation(payload) {
  if (payload.id) {
    var rows = readObjects_(SHEETS.LOCATIONS);
    for (var i=0;i<rows.length;i++) if (rows[i].id===payload.id) {
      updateCell_(SHEETS.LOCATIONS, rows[i]._row, 'name', payload.name);
      updateCell_(SHEETS.LOCATIONS, rows[i]._row, 'series', payload.series||'');
      return { ok:true, id:payload.id };
    }
    throw new Error('Location not found.');
  }
  var id = newId_('L');
  appendObject_(SHEETS.LOCATIONS, { id:id, name:payload.name, series:payload.series||'', active:true });
  return { ok:true, id:id };
}

function setLocationActive(locId, active) {
  var rows = readObjects_(SHEETS.LOCATIONS);
  for (var i=0;i<rows.length;i++) if (rows[i].id===locId) {
    updateCell_(SHEETS.LOCATIONS, rows[i]._row, 'active', !!active);
    return { ok:true };
  }
  throw new Error('Location not found.');
}

// ---- People management (manager) ---------------------------------------
function savePerson(payload) {
  appendObject_(SHEETS.PEOPLE, { name:payload.name, role:payload.role||'technician', active:true });
  return { ok:true };
}

function setPersonActive(name, active) {
  var rows = readObjects_(SHEETS.PEOPLE);
  for (var i=0;i<rows.length;i++) if (rows[i].name===name) {
    updateCell_(SHEETS.PEOPLE, rows[i]._row, 'active', !!active);
    return { ok:true };
  }
  throw new Error('Person not found.');
}

function getPeopleForManager() {
  return readObjects_(SHEETS.PEOPLE).map(function(p){
    return { name:p.name, role:p.role, active:!(p.active===false||p.active==='FALSE'),
             hasPin:!!(p.pin && String(p.pin).length>0), locked:pinLocked_(p.name) };
  });
}

// ---- Config (manager) ---------------------------------------------------
function setLowDaysThreshold(days) {
  var rows = readObjects_(SHEETS.CONFIG);
  for (var i=0;i<rows.length;i++) if (rows[i].key==='lowDaysThreshold') {
    updateCell_(SHEETS.CONFIG, rows[i]._row, 'value', String(num_(days)||3));
    return { ok:true };
  }
  appendObject_(SHEETS.CONFIG, { key:'lowDaysThreshold', value:String(num_(days)||3) });
  return { ok:true };
}

// =========================================================================
//  KIOSK BOARD: per-location in-use state + frequency ordering
// =========================================================================
/** Open to any user. Mark an item in/out of use at a specific location. */
function setLocationSkuInUse(locationId, skuId, inUse) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = readObjects_(SHEETS.LOC_SKUS);
    for (var i=0;i<rows.length;i++) {
      if (rows[i].locationId===locationId && rows[i].skuId===skuId) {
        updateCell_(SHEETS.LOC_SKUS, rows[i]._row, 'active', !!inUse);
        return { ok:true };
      }
    }
    appendObject_(SHEETS.LOC_SKUS, { locationId:locationId, skuId:skuId, active:!!inUse });
    return { ok:true };
  } finally { lock.releaseLock(); }
}

/** Open to any user. Items for a location split into in-use / not-in-use,
 *  in-use ordered by how often they've been flagged low/out (last 90 days). */
function getKioskBoard(locationId) {
  var since = Date.now() - 90*86400000;
  var off = {};
  readObjects_(SHEETS.LOC_SKUS).forEach(function(r){
    if (r.locationId===locationId && (r.active===false || r.active==='FALSE')) off[r.skuId]=true;
  });
  var score = {}, current = {}, curTs = {};
  readObjects_(SHEETS.FLAGS).forEach(function(f){
    if (f.locationId!==locationId) return;
    if (f.status!=='low' && f.status!=='out') return;
    var ts = f.timestamp ? new Date(f.timestamp).getTime() : 0;
    if (ts >= since) score[f.skuId] = (score[f.skuId]||0) + (f.status==='out'?2:1);
    // current open status = latest unresolved low/out flag for the sku
    if (!flagResolved_(f) && (!(f.skuId in curTs) || ts >= curTs[f.skuId])) { current[f.skuId]=f.status; curTs[f.skuId]=ts; }
  });
  var inUse=[], notInUse=[];
  activeSkus_().forEach(function(s){
    var item = { skuId:s.id, name:s.name, baseUnit:s.baseUnit, baseUnitNote:s.baseUnitNote, score:score[s.id]||0, current:current[s.id]||'' };
    if (off[s.id]) notInUse.push(item); else inUse.push(item);
  });
  inUse.sort(function(a,b){ return (b.score-a.score) || a.name.localeCompare(b.name); });
  notInUse.sort(function(a,b){ return a.name.localeCompare(b.name); });
  return { inUse:inUse, notInUse:notInUse };
}

// =========================================================================
//  HISTORY: all submissions (manager)
// =========================================================================
function getHistory() {
  var out = [];
  readObjects_(SHEETS.TX).forEach(function(t){
    out.push({
      kind:'tx', type:t.type,
      when: t.timestamp ? new Date(t.timestamp).toISOString() : '',
      skuName:t.skuName,
      qty: (t.rawQty===''||t.rawQty===undefined) ? Math.abs(num_(t.delta)) : num_(t.rawQty),
      unit: t.rawUnit || (t.type==='adjust'?'count':'base'),
      delta:num_(t.delta), by:t.byName, note:t.note, location:''
    });
  });
  var locName={}; readObjects_(SHEETS.LOCATIONS).forEach(function(l){ locName[l.id]=l.name; });
  readObjects_(SHEETS.FLAGS).forEach(function(f){
    out.push({
      kind:'flag', type:f.status,
      when: f.timestamp ? new Date(f.timestamp).toISOString() : '',
      skuName:f.skuName, by:f.byName, note:f.note,
      location:f.locationName || locName[f.locationId] || ''
    });
  });
  out.sort(function(a,b){ return String(b.when).localeCompare(String(a.when)); });
  return out.slice(0,200);
}

// =========================================================================
//  SERVICING MODULE
//  Checklist definitions live in the front end (Index.html) so they are
//  easy to edit and version. The server stores sessions (completions are
//  denormalized into JSON so history & reports survive future checklist
//  changes) and computes reports. Inventory functions above are untouched.
// =========================================================================
function serviceParse_(s){ try { return s ? JSON.parse(s) : []; } catch (e) { return []; } }

function serviceStats_(completions){
  var total=0, done=0, reqInc=0;
  (completions||[]).forEach(function(c){
    total++;
    if (c.completed) done++;
    if (c.required && !c.completed) reqInc++;
  });
  return { percent: total ? Math.round(done/total*100) : 0, requiredIncomplete: reqInc };
}

/** Create or update a service session (progress save or final submit). */
function saveServiceSession(payload){
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var completions = payload.completions || [];
    var stats = serviceStats_(completions);
    var status = payload.status || 'in_progress';
    var nowIso = new Date().toISOString();
    var rows = readObjects_(SHEETS.SERVICE);
    var existingRow = null, existing = null;
    if (payload.id) {
      for (var i=0;i<rows.length;i++) if (rows[i].id===payload.id) { existing=rows[i]; existingRow=rows[i]._row; break; }
    }
    var sd = payload.serviceDate||'', stt = payload.startTime||'', ett = payload.endTime||'';
    function iso_(d,t){ if(!d) return ''; try{ return new Date(d+'T'+(t||'00:00')+':00').toISOString(); }catch(e){ return ''; } }
    var record = {
      id: payload.id || newId_('SS'),
      kioskId: payload.kioskId, locationName: payload.locationName||'', model: payload.model||'',
      checklistVersion: payload.checklistVersion||'', technicianName: payload.technicianName||'',
      startedAt: iso_(sd,stt) || payload.startedAt || (existing ? existing.startedAt : nowIso),
      completedAt: (status==='completed'||status==='incomplete') ? (iso_(sd,ett)||nowIso) : '',
      status: status,
      percentComplete: stats.percent, requiredIncomplete: stats.requiredIncomplete,
      incompleteReason: payload.incompleteReason||'', overallNotes: payload.overallNotes||'',
      completionsJson: JSON.stringify(completions),
      serviceDate: sd, startTime: stt, endTime: ett,
      milkBagChanged: (payload.milkBagChanged===true||payload.milkBagChanged==='true') ? true : false
    };
    if (existingRow) {
      HEADERS.ServiceSessions.forEach(function(h){ updateCell_(SHEETS.SERVICE, existingRow, h, record[h]); });
    } else {
      appendObject_(SHEETS.SERVICE, record);
    }
    return { ok:true, id:record.id, status:status, percent:stats.percent, requiredIncomplete:stats.requiredIncomplete };
  } finally { lock.releaseLock(); }
}

/** Most recent in-progress session for a kiosk (to resume), or null. */
function getOpenServiceSession(kioskId){
  var rows = readObjects_(SHEETS.SERVICE).filter(function(r){ return r.kioskId===kioskId && r.status==='in_progress'; });
  if (!rows.length) return null;
  rows.sort(function(a,b){ return String(b.startedAt).localeCompare(String(a.startedAt)); });
  var r = rows[0];
  return { id:r.id, kioskId:r.kioskId, technicianName:r.technicianName, startedAt:isoS_(r.startedAt),
           overallNotes:r.overallNotes, completions: serviceParse_(r.completionsJson),
           serviceDate:dStr_(r.serviceDate), startTime:tStr_(r.startTime), endTime:tStr_(r.endTime),
           milkBagChanged: milkChanged_(r) };
}

/** Per-kiosk summary for the servicing landing page. */
function getServiceSummary(){
  var by = {};
  readObjects_(SHEETS.SERVICE).forEach(function(r){
    var k = r.kioskId; if (!by[k]) by[k] = { lastCompletedAt:'', lastStatus:'', inProgressSessionId:'', lastTechnicianName:'', lastServiceDate:'' };
    if (r.status==='in_progress') by[k].inProgressSessionId = r.id;
    if ((r.status==='completed'||r.status==='incomplete') && r.completedAt) {
      var ca=isoS_(r.completedAt);
      if (ca > String(by[k].lastCompletedAt)) { by[k].lastCompletedAt=ca; by[k].lastStatus=r.status; by[k].lastTechnicianName=r.technicianName||''; by[k].lastServiceDate=dStr_(r.serviceDate); }
    }
  });
  return by;
}

function milkChanged_(r){ return r.milkBagChanged===true || r.milkBagChanged==='TRUE' || r.milkBagChanged==='true'; }
function rowDate_(r){ var d=dStr_(r.serviceDate); if(d) return d; var ca=isoS_(r.completedAt); return ca?ca.slice(0,10):''; }
// Last milk-bag change date per kiosk, plus days-since and overdue (good for 4 days; 5th day = overdue).
function getKioskMilkStatus(kioskId){
  var last='';
  readObjects_(SHEETS.SERVICE).forEach(function(r){
    if(r.kioskId!==kioskId || !milkChanged_(r)) return;
    var d=rowDate_(r); if(d && d>last) last=d;
  });
  var daysSince=null, overdue=true;
  if(last){
    var lastD=new Date(last+'T00:00:00'); var today=new Date(); today.setHours(0,0,0,0);
    daysSince=Math.round((today-lastD)/86400000); overdue = daysSince>4;
  }
  return { lastChange:last, daysSince:daysSince, overdue:overdue };
}
// Map of kioskId -> [dates] where a milk-bag change was logged (for schedule markers).
function getMilkBagLog(){
  var by={};
  readObjects_(SHEETS.SERVICE).forEach(function(r){
    if(!milkChanged_(r)) return; var d=rowDate_(r); if(!d) return;
    if(!by[r.kioskId]) by[r.kioskId]=[];
    if(by[r.kioskId].indexOf(d)<0) by[r.kioskId].push(d);
  });
  return by;
}
function getServiceSessions(){
  return readObjects_(SHEETS.SERVICE).map(function(r){
    return { id:r.id, kioskId:r.kioskId, locationName:r.locationName, model:r.model, checklistVersion:r.checklistVersion,
      technicianName:r.technicianName, startedAt:isoS_(r.startedAt), completedAt:isoS_(r.completedAt), status:r.status,
      percentComplete:num_(r.percentComplete), requiredIncomplete:num_(r.requiredIncomplete),
      serviceDate:dStr_(r.serviceDate), startTime:tStr_(r.startTime), endTime:tStr_(r.endTime) };
  }).sort(function(a,b){ return String(b.completedAt||b.startedAt).localeCompare(String(a.completedAt||a.startedAt)); }).slice(0,300);
}

function getServiceSession(id){
  var rows = readObjects_(SHEETS.SERVICE).filter(function(r){ return r.id===id; });
  if (!rows.length) throw new Error('Session not found.');
  var r = rows[0];
  return { id:r.id, kioskId:r.kioskId, locationName:r.locationName, model:r.model, checklistVersion:r.checklistVersion,
    technicianName:r.technicianName, startedAt:isoS_(r.startedAt), completedAt:isoS_(r.completedAt), status:r.status,
    percentComplete:num_(r.percentComplete), requiredIncomplete:num_(r.requiredIncomplete),
    incompleteReason:r.incompleteReason, overallNotes:r.overallNotes, completions: serviceParse_(r.completionsJson),
    serviceDate:dStr_(r.serviceDate), startTime:tStr_(r.startTime), endTime:tStr_(r.endTime) };
}

function getServiceReport(){
  var rows = readObjects_(SHEETS.SERVICE);
  var completedByKiosk={}, recentByKiosk={}, inc={}, flg={}, cal=0, sen=0, gw=[], notes=[];
  rows.forEach(function(r){
    var loc = r.locationName || r.kioskId;
    var ca=isoS_(r.completedAt), sa=isoS_(r.startedAt);
    if (r.status==='completed') completedByKiosk[loc]=(completedByKiosk[loc]||0)+1;
    if ((r.status==='completed'||r.status==='incomplete') && ca && ca > String(recentByKiosk[loc]||'')) recentByKiosk[loc]=ca;
    serviceParse_(r.completionsJson).forEach(function(c){
      if (c.required && !c.completed) inc[c.label]=(inc[c.label]||0)+1;
      if (c.flagged){
        flg[c.label]=(flg[c.label]||0)+1;
        if (c.itemType==='calibration') cal++;
        if (/sensor|green light|refractive|reflective/i.test((c.label||'')+' '+(c.section||''))) sen++;
      }
      if (c.itemType==='waste_disposal' && /gray water|grey water/i.test(c.label||'')) gw.push({ loc:loc, when:ca||sa, label:c.label, completed:!!c.completed });
      if (c.notes) notes.push({ when:ca||sa, loc:loc, label:c.label, note:c.notes });
    });
  });
  function top(o){ return Object.keys(o).map(function(k){ return { label:k, count:o[k] }; }).sort(function(a,b){ return b.count-a.count; }).slice(0,10); }
  notes.sort(function(a,b){ return String(b.when).localeCompare(String(a.when)); });
  gw.sort(function(a,b){ return String(b.when).localeCompare(String(a.when)); });
  return { completedByKiosk:completedByKiosk, recentByKiosk:recentByKiosk, incompleteItems:top(inc), flaggedItems:top(flg),
           calibrationIssues:cal, sensorIssues:sen, grayWaterHistory:gw.slice(0,20), recentNotes:notes.slice(0,20) };
}

// =========================================================================
//  MASTER SCHEDULE (coverage requests / claims) + DASHBOARD SERVICE FLAGS
// =========================================================================
function getScheduleOverrides(){
  return readObjects_(SHEETS.SCHED).map(function(r){
    return { date:String(r.date), kioskId:r.kioskId,
      coverageRequested:(r.coverageRequested===true||r.coverageRequested==='TRUE'),
      requestedBy:r.requestedBy||'', claimedBy:r.claimedBy||'', originalAssignee:r.originalAssignee||'', note:r.note||'' };
  });
}
function upsertSched_(date,kioskId,fields){
  var rows=readObjects_(SHEETS.SCHED);
  for(var i=0;i<rows.length;i++){
    if(String(rows[i].date)===String(date) && rows[i].kioskId===kioskId){
      Object.keys(fields).forEach(function(f){ updateCell_(SHEETS.SCHED, rows[i]._row, f, fields[f]); });
      updateCell_(SHEETS.SCHED, rows[i]._row, 'updatedAt', new Date().toISOString());
      return;
    }
  }
  var rec={date:String(date),kioskId:kioskId,coverageRequested:false,requestedBy:'',claimedBy:'',originalAssignee:'',note:'',updatedAt:new Date().toISOString()};
  Object.keys(fields).forEach(function(f){ rec[f]=fields[f]; });
  appendObject_(SHEETS.SCHED, rec);
}
function requestCoverage(payload){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{ upsertSched_(payload.date,payload.kioskId,{coverageRequested:true,requestedBy:payload.requestedBy||'',originalAssignee:payload.originalAssignee||'',claimedBy:''}); return {ok:true}; }
  finally{ lock.releaseLock(); }
}
function claimCoverage(payload){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{ upsertSched_(payload.date,payload.kioskId,{coverageRequested:false,claimedBy:payload.claimedBy||''}); return {ok:true}; }
  finally{ lock.releaseLock(); }
}
function cancelCoverage(payload){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{ upsertSched_(payload.date,payload.kioskId,{coverageRequested:false,requestedBy:''}); return {ok:true}; }
  finally{ lock.releaseLock(); }
}
/** Recent flagged servicing items, for the manager dashboard. */
function getServiceFlags(){
  var out=[];
  readObjects_(SHEETS.SERVICE).forEach(function(r){
    serviceParse_(r.completionsJson).forEach(function(c){
      if(c.flagged) out.push({ sessionId:r.id, itemId:c.itemId, when:r.completedAt||r.startedAt, serviceDate:r.serviceDate||'',
        location:r.locationName||r.kioskId, technician:r.technicianName||'', label:c.label, section:c.section||'', note:c.notes||'' });
    });
  });
  out.sort(function(a,b){ return String(b.when).localeCompare(String(a.when)); });
  return out.slice(0,30);
}

// =========================================================================
//  IDENTITY + PINS
// =========================================================================
function getMembers(){
  return readObjects_(SHEETS.PEOPLE).filter(function(p){ return !(p.active===false||p.active==='FALSE'); })
    .map(function(p){ return { name:p.name, role:p.role, hasPin: !!(p.pin && String(p.pin).length>0) }; });
}
// ---- session tokens + wrong-PIN rate limiting ---------------------------
// A token is issued at sign-in and must accompany every API request (doPost
// checks it). Wrong-PIN attempts are counted; after PIN_MAX_ATTEMPTS the PIN
// locks and only a manager reset (Settings -> Reset PIN) unlocks it.
var PIN_MAX_ATTEMPTS = 5;
var TOKEN_TTL_MS = 30 * 86400000; // sessions stay signed in for 30 days

function props_(){ return PropertiesService.getScriptProperties(); }
function failKey_(name){ return 'pinfail_' + String(name); }
function pinFails_(name){ return num_(props_().getProperty(failKey_(name))); }
function pinLocked_(name){ return pinFails_(name) >= PIN_MAX_ATTEMPTS; }
function clearPinFails_(name){ props_().deleteProperty(failKey_(name)); }
function lockedMsg_(){
  var mgrs = readObjects_(SHEETS.PEOPLE)
    .filter(function(p){ return p.role==='manager' && !(p.active===false||p.active==='FALSE'); })
    .map(function(p){ return p.name; });
  return 'Too many incorrect attempts — this PIN is now locked. Message ' +
         (mgrs.length ? mgrs.join(' or ') : 'a manager') +
         ' directly and they can reset your PIN from Settings.';
}

function issueToken_(name, role){
  var tok = Utilities.getUuid().replace(/-/g, '');
  props_().setProperty('tok_' + tok, JSON.stringify({ name:name, role:role, exp: Date.now() + TOKEN_TTL_MS }));
  return tok;
}
function tokenInfo_(tok){
  if (!tok) return null;
  var raw = props_().getProperty('tok_' + String(tok));
  if (!raw) return null;
  var o = null; try { o = JSON.parse(raw); } catch(e){ return null; }
  if (!o || !o.exp || Date.now() > o.exp){ props_().deleteProperty('tok_' + String(tok)); return null; }
  return o;
}
function pruneTokens_(){
  var all = props_().getProperties();
  Object.keys(all).forEach(function(k){
    if (k.indexOf('tok_') !== 0) return;
    try { var o = JSON.parse(all[k]); if (!o.exp || Date.now() > o.exp) props_().deleteProperty(k); }
    catch(e){ props_().deleteProperty(k); }
  });
}

function verifyIdentity(name, pin){
  var rows = readObjects_(SHEETS.PEOPLE), p=null;
  for (var i=0;i<rows.length;i++) if (rows[i].name===name){ p=rows[i]; break; }
  if (!p) return { ok:false, error:'Unknown member.' };
  if (pinLocked_(name)) return { ok:false, locked:true, error:lockedMsg_() };
  var has = p.pin && String(p.pin).length>0;
  if (!has) return { needsPin:true, role:p.role };
  if (String(p.pin)===String(pin)){
    clearPinFails_(name);
    pruneTokens_();
    return { ok:true, role:p.role, token:issueToken_(name, p.role) };
  }
  var fails = pinFails_(name) + 1;
  props_().setProperty(failKey_(name), String(fails));
  if (fails >= PIN_MAX_ATTEMPTS) return { ok:false, locked:true, error:lockedMsg_() };
  return { ok:false, attemptsLeft: PIN_MAX_ATTEMPTS - fails };
}
function setPin(name, pin){
  pin=String(pin||''); if(!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.');
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rows=readObjects_(SHEETS.PEOPLE);
    for(var i=0;i<rows.length;i++) if(rows[i].name===name){
      if(rows[i].pin && String(rows[i].pin).length>0) throw new Error('A PIN already exists. Use Change PIN.');
      updateCell_(SHEETS.PEOPLE, rows[i]._row, 'pin', pin);
      clearPinFails_(name);
      return { ok:true, role:rows[i].role, token:issueToken_(name, rows[i].role) };
    }
    throw new Error('Unknown member.');
  } finally { lock.releaseLock(); }
}
function changePin(name, oldPin, newPin){
  newPin=String(newPin||''); if(!/^\d{4}$/.test(newPin)) throw new Error('New PIN must be exactly 4 digits.');
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    if (pinLocked_(name)) throw new Error(lockedMsg_());
    var rows=readObjects_(SHEETS.PEOPLE);
    for(var i=0;i<rows.length;i++) if(rows[i].name===name){
      var cur=String(rows[i].pin||'');
      if(cur && cur!==String(oldPin)){
        var fails = pinFails_(name) + 1;
        props_().setProperty(failKey_(name), String(fails));
        throw new Error(fails >= PIN_MAX_ATTEMPTS ? lockedMsg_() : 'Current PIN is incorrect.');
      }
      updateCell_(SHEETS.PEOPLE, rows[i]._row, 'pin', newPin);
      clearPinFails_(name);
      return { ok:true };
    }
    throw new Error('Unknown member.');
  } finally { lock.releaseLock(); }
}
/** Manager only (enforced by the API router): wipe someone's PIN and unlock
 *  their sign-in. They'll create a fresh PIN the next time they tap their name. */
function managerResetPin(name){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rows=readObjects_(SHEETS.PEOPLE);
    for(var i=0;i<rows.length;i++) if(rows[i].name===name){
      updateCell_(SHEETS.PEOPLE, rows[i]._row, 'pin', '');
      clearPinFails_(name);
      return { ok:true };
    }
    throw new Error('Person not found.');
  } finally { lock.releaseLock(); }
}

// =========================================================================
//  CLEAR A SERVICING FLAG (one-click from manager dashboard)
// =========================================================================
function clearServiceFlag(sessionId, itemId){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rows=readObjects_(SHEETS.SERVICE);
    for(var i=0;i<rows.length;i++) if(rows[i].id===sessionId){
      var comps=serviceParse_(rows[i].completionsJson), changed=false;
      comps.forEach(function(c){ if(c.itemId===itemId && c.flagged){ c.flagged=false; changed=true; } });
      if(changed) updateCell_(SHEETS.SERVICE, rows[i]._row, 'completionsJson', JSON.stringify(comps));
      return { ok:true };
    }
    return { ok:false };
  } finally { lock.releaseLock(); }
}

// =========================================================================
//  LABOUR PAYMENTS
// =========================================================================
function getPayments(){
  return readObjects_(SHEETS.PAY).filter(function(r){ return !(r.voided===true||r.voided==='TRUE'); })
    .map(function(r){ return { id:r.id, personName:r.personName, periodStart:String(r.periodStart), periodEnd:String(r.periodEnd), paidDate:String(r.paidDate), notes:r.notes||'' }; });
}
function savePayment(p){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rec={ id:newId_('PAY'), personName:p.personName||'', periodStart:String(p.periodStart||''), periodEnd:String(p.periodEnd||''),
      paidDate:String(p.paidDate||''), notes:p.notes||'', voided:false, createdAt:new Date().toISOString() };
    appendObject_(SHEETS.PAY, rec); return { ok:true, id:rec.id };
  } finally { lock.releaseLock(); }
}
function voidPayment(id){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rows=readObjects_(SHEETS.PAY);
    for(var i=0;i<rows.length;i++) if(rows[i].id===id){ updateCell_(SHEETS.PAY, rows[i]._row, 'voided', true); return { ok:true }; }
    return { ok:false };
  } finally { lock.releaseLock(); }
}

// =========================================================================
//  CHARGES — item reimbursements + non-servicing (misc) time
//  (servicing time stays in ServiceSessions; this covers the other two)
// =========================================================================
function getCharges(){
  return readObjects_(SHEETS.CHG).filter(function(r){ return !(r.voided===true||r.voided==='TRUE'); })
    .map(function(r){ return {
      id:r.id, personName:r.personName||'', type:r.type||'', date:String(r.date||''),
      description:r.description||'', amount:num_(r.amount),
      startTime:String(r.startTime||''), endTime:String(r.endTime||''), hours:num_(r.hours),
      receiptLink:r.receiptLink||'', paid:(r.paid===true||r.paid==='TRUE'),
      paidDate:String(r.paidDate||''), paidNote:r.paidNote||'', createdAt:r.createdAt||'' };
    }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
}
function addCharge(p){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var type = (p.type==='misc_time') ? 'misc_time' : 'reimbursement';
    var hours='';
    if(type==='misc_time'){
      if(!p.startTime || !p.endTime) throw new Error('Enter a start and end time.');
      var a=String(p.startTime).split(':'), b=String(p.endTime).split(':');
      var m=(parseInt(b[0],10)*60+parseInt(b[1],10))-(parseInt(a[0],10)*60+parseInt(a[1],10)); if(m<0) m+=1440;
      hours=Math.round(m/60*100)/100;
    } else {
      if(!(num_(p.amount)>0)) throw new Error('Enter an amount greater than 0.');
    }
    if(!String(p.description||'').trim()) throw new Error('Add a short description.');
    var rec={ id:newId_('CHG'), personName:p.personName||'', type:type, date:String(p.date||''),
      description:String(p.description||'').trim(),
      amount:type==='reimbursement'?num_(p.amount):'', startTime:type==='misc_time'?String(p.startTime||''):'',
      endTime:type==='misc_time'?String(p.endTime||''):'', hours:hours, receiptLink:p.receiptLink||'',
      paid:false, paidDate:'', paidNote:'', voided:false, createdAt:new Date().toISOString() };
    appendObject_(SHEETS.CHG, rec);
    return { ok:true, id:rec.id };
  } finally { lock.releaseLock(); }
}
function setChargePaid(id, paid, paidDate, paidNote){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rows=readObjects_(SHEETS.CHG);
    for(var i=0;i<rows.length;i++) if(rows[i].id===id){
      updateCell_(SHEETS.CHG, rows[i]._row, 'paid', !!paid);
      updateCell_(SHEETS.CHG, rows[i]._row, 'paidDate', paid?String(paidDate||''):'');
      updateCell_(SHEETS.CHG, rows[i]._row, 'paidNote', paid?(paidNote||''):'');
      return { ok:true };
    }
    return { ok:false };
  } finally { lock.releaseLock(); }
}
function voidCharge(id){
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var rows=readObjects_(SHEETS.CHG);
    for(var i=0;i<rows.length;i++) if(rows[i].id===id){ updateCell_(SHEETS.CHG, rows[i]._row, 'voided', true); return { ok:true }; }
    return { ok:false };
  } finally { lock.releaseLock(); }
}

// =========================================================================
//  PICK-UP LIST — items flagged low/out at a kiosk that are in stock to grab
// =========================================================================
function getPickupList(){
  var inv = computeInventory_();
  var qtyByName = {}; inv.forEach(function(i){ qtyByName[i.name]=i.qty; });
  var flags = readObjects_(SHEETS.FLAGS).filter(function(f){ return f.resolved!==true && f.resolved!=='TRUE'; });
  var idx = {}; var out = [];
  flags.forEach(function(f){
    var key=(f.locationName||'')+'|'+(f.skuName||'');
    if(idx[key]!==undefined){ if(f.status==='out') out[idx[key]].status='out'; return; }
    var wQty = qtyByName[f.skuName]; if(wQty===undefined) wQty=0;
    idx[key]=out.length;
    out.push({ locationName:f.locationName||'', skuName:f.skuName||'', status:f.status||'low',
               warehouseQty: wQty, available: wQty>0 });
  });
  // available first, then by location
  out.sort(function(a,b){ return (a.available===b.available) ? a.locationName.localeCompare(b.locationName) : (a.available?-1:1); });
  return out;
}


// ============================================================================
//  BACKUP & DISASTER RECOVERY
//  - daily automatic full copy of the whole spreadsheet (timestamped) to Drive
//  - one-tap "Back up now" from manager Settings
//  - keeps the most recent BACKUP_KEEP copies (auto-prune)
//  - every BACKUP_EMAIL_DAYS, also emails an off-Drive .xlsx snapshot to the team
// ============================================================================
var BACKUP_FOLDER_NAME = 'Robo Caf\u00e9 \u2014 DB backups';
var BACKUP_KEEP        = 2;   // keep only the 2 most recent copies
var BACKUP_EMAIL_DAYS  = 60;

// Snapshot recipients live in the PRIVATE database, not in this (public) code:
// Config tab row with key `backupEmails`, value = comma-separated addresses.
// If that row is missing, the snapshot goes to the spreadsheet owner.
function backupEmails_(){
  var v = String(getConfig_('backupEmails') || '').trim();
  if (v) return v.split(',').map(function(s){ return s.trim(); }).filter(String);
  try { var o = ss_().getOwner(); if (o && o.getEmail()) return [o.getEmail()]; } catch(e){}
  try { var me = Session.getEffectiveUser().getEmail(); if (me) return [me]; } catch(e){}
  return [];
}

// ---- tiny key/value config helpers (Config tab is [key,value]) ----
function getConfig_(key){ var m = configMap_(); return (key in m) ? m[key] : ''; }
function setConfig_(key, value){
  var rows = readObjects_(SHEETS.CONFIG);
  for (var i=0;i<rows.length;i++) if (rows[i].key===key){ updateCell_(SHEETS.CONFIG, rows[i]._row, 'value', value); return; }
  appendObject_(SHEETS.CONFIG, { key:key, value:value });
}

function backupFolder_(){
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  while (it.hasNext()){ var f=it.next(); if (!f.isTrashed()) return f; }
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}
function backupFolderExisting_(){
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  while (it.hasNext()){ var f=it.next(); if (!f.isTrashed()) return f; }
  return null;
}

// Full, timestamped Drive copy of the entire spreadsheet (every tab, as-is).
function backupNow(){
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch(e){}
  try {
    var ss = ss_(), tz = svcTz_();
    var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm');
    var name  = ss.getName() + ' \u2014 backup ' + stamp;
    var copy  = DriveApp.getFileById(ss.getId()).makeCopy(name, backupFolder_());
    var kept  = pruneBackups_();
    setConfig_('lastBackupAt', new Date().toISOString());
    var emailed = false;
    try { emailed = maybeEmailBackup_(); } catch(e){ /* never fail a backup because the email failed */ }
    return { ok:true, name:name, url:copy.getUrl(), kept:kept, emailed:emailed,
             when: Utilities.formatDate(new Date(), tz, 'MMM d, yyyy h:mm a') };
  } finally { try { lock.releaseLock(); } catch(e){} }
}

// Keep only the newest BACKUP_KEEP copies in the folder.
function pruneBackups_(){
  var folder = backupFolder_(), files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function(a,b){ return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  for (var i=BACKUP_KEEP; i<files.length; i++){ try { files[i].setTrashed(true); } catch(e){} }
  return Math.min(files.length, BACKUP_KEEP);
}

// ---- 60-day off-Drive email layer ----
function maybeEmailBackup_(){
  var last = getConfig_('lastEmailBackupAt');
  if (last){ var days = (Date.now() - new Date(last).getTime()) / 86400000; if (days < BACKUP_EMAIL_DAYS) return false; }
  emailBackupSnapshot_();
  setConfig_('lastEmailBackupAt', new Date().toISOString());
  return true;
}

function exportXlsxBlob_(){
  var ss = ss_(), tz = svcTz_();
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  var resp = UrlFetchApp.fetch(url, { headers:{ Authorization:'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions:true });
  var fname = ss.getName().replace(/[^\w \-]/g,'').trim() + ' ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + '.xlsx';
  return resp.getBlob().setName(fname);
}

function emailBackupSnapshot_(){
  var to = backupEmails_();
  if (!to.length) return;
  var tz = svcTz_();
  var vol = lifetimeVolume_();
  var dateLbl = Utilities.formatDate(new Date(), tz, 'MMMM d, yyyy');
  var rows = vol.lines.map(function(l){
    return '<tr><td style="padding:5px 18px 5px 0;color:#444">' + l[0] + '</td>' +
           '<td style="padding:5px 0;font-weight:600;text-align:right">' + l[1] + '</td></tr>';
  }).join('');
  var body =
    '<div style="font-family:system-ui,Arial,sans-serif;color:#1b1b1b;max-width:540px">' +
      '<h2 style="margin:0 0 4px">Robo Caf\u00e9 \u2014 database backup</h2>' +
      '<p style="color:#555;margin:0 0 18px">' + dateLbl + '. Attached is a complete .xlsx snapshot of every tab, kept off Google Drive for safekeeping.</p>' +
      '<h3 style="margin:16px 0 6px">Lifetime totals</h3>' +
      '<table style="border-collapse:collapse;font-size:14px">' + rows + '</table>' +
      '<p style="color:#888;font-size:12px;margin-top:22px">Sent automatically every ' + BACKUP_EMAIL_DAYS +
        ' days. Daily timestamped copies also live in your \u201c' + BACKUP_FOLDER_NAME + '\u201d Google Drive folder (most recent ' + BACKUP_KEEP + ' kept).</p>' +
    '</div>';
  MailApp.sendEmail({
    to: to.join(','),
    subject: 'Robo Caf\u00e9 \u2014 database backup (' + dateLbl + ')',
    htmlBody: body,
    attachments: [ exportXlsxBlob_() ]
  });
}

// Lifetime totals computed from the live sheet (what the backup is protecting).
// NOTE: cups-served / sales volume is not stored in this database (that lives in
// Kiosoft/Nayax); these are the lifetime totals of the operational data held here.
function lifetimeVolume_(){
  function cnt(key){ return readObjects_(SHEETS[key]).length; }
  var svc = readObjects_(SHEETS.SERVICE);
  var completed = svc.filter(function(s){ return s.status==='completed'; }).length;
  var chg = readObjects_(SHEETS.CHG);
  var reimbursed = chg.filter(function(x){ return x.type==='reimbursement'; })
                      .reduce(function(a,b){ return a + (num_(b.amount)||0); }, 0);
  var tx = cnt('TX'), flags = cnt('FLAGS'), pays = cnt('PAY'), sched = cnt('SCHED');
  var totalRecords = svc.length + chg.length + tx + flags + pays + sched + cnt('LOC_SKUS') + cnt('SKUS') + cnt('PEOPLE') + cnt('LOCATIONS');
  return { lines: [
    ['Service sessions logged',         String(svc.length) + ' (' + completed + ' completed)'],
    ['Inventory transactions',          String(tx)],
    ['Kiosk stock reports',             String(flags)],
    ['Reimbursement / time charges',    String(chg.length)],
    ['Total reimbursed',                '$' + reimbursed.toFixed(2)],
    ['Total records in database',       String(totalRecords)]
  ]};
}

// ---- automatic daily trigger control ----
function dailyBackup_(){ backupNow(); }
function autoBackupOn_(){
  return ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==='dailyBackup_'; });
}
function setAutoBackup(on){
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction()==='dailyBackup_') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('dailyBackup_').timeBased().everyDays(1).atHour(2).create();
  setConfig_('autoBackup', on ? 'on' : 'off');
  return { ok:true, on: autoBackupOn_() };
}

// One-time editor convenience: grants permissions, turns on daily backups, takes the first backup.
function enableBackups(){ setAutoBackup(true); return backupNow(); }

function getBackupStatus(){
  var tz = svcTz_();
  function fmt(iso){ return iso ? Utilities.formatDate(new Date(iso), tz, 'MMM d, yyyy h:mm a') : ''; }
  var count = 0, folderUrl = '';
  try { var fo = backupFolderExisting_(); if (fo){ folderUrl = fo.getUrl(); var it = fo.getFiles(); while (it.hasNext()){ it.next(); count++; } } } catch(e){}
  return {
    autoOn: autoBackupOn_(),
    lastBackupAt: fmt(getConfig_('lastBackupAt')),
    lastEmailAt:  fmt(getConfig_('lastEmailBackupAt')),
    count: count, keep: BACKUP_KEEP, emailDays: BACKUP_EMAIL_DAYS,
    emails: backupEmails_(), folderName: BACKUP_FOLDER_NAME, folderUrl: folderUrl
  };
}

// ---- one-time maintenance: run these from the Apps Script editor ----

// Shows every scheduled trigger (handler + how often it runs). Use this to spot a runaway backup.
function listTriggers(){
  return ScriptApp.getProjectTriggers().map(function(t){
    return { handler: t.getHandlerFunction(), source: String(t.getTriggerSource()), event: String(t.getEventType()) };
  });
}

// Removes ANY backup-related trigger (catches leftovers/duplicates from earlier versions),
// then installs exactly one clean daily backup at ~2am. Run once.
function resetBackupSchedule(){
  var removed = [];
  ScriptApp.getProjectTriggers().forEach(function(t){
    var h = t.getHandlerFunction() || '';
    if (/backup|snapshot|copy/i.test(h)) { removed.push(h); ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('dailyBackup_').timeBased().everyDays(1).atHour(2).create();
  setConfig_('autoBackup','on');
  return { removedTriggers: removed, installed: 'dailyBackup_ (once daily ~2am)' };
}

// Trashes all but the newest `keepN` backup copies (default 2). Reversible — files go to Drive Trash,
// not permanently deleted. Scans the backups folder AND any stray backup sheets left loose in Drive.
function cleanupBackups(keepN){
  keepN = keepN || BACKUP_KEEP;
  var liveId = ss_().getId();
  var base = ss_().getName().toLowerCase();
  var seen = {}, files = [];
  function consider(f){
    if (!f || f.getId() === liveId || seen[f.getId()]) return;
    seen[f.getId()] = 1; files.push(f);
  }
  // 1) everything inside the backups folder
  var fo = backupFolderExisting_();
  if (fo){ var it = fo.getFiles(); while (it.hasNext()) consider(it.next()); }
  // 2) stray backup spreadsheets anywhere in Drive that reference this database
  var it2 = DriveApp.searchFiles("mimeType='application/vnd.google-apps.spreadsheet' and title contains 'backup' and trashed=false");
  while (it2.hasNext()){
    var f = it2.next(), nm = f.getName().toLowerCase();
    if (nm.indexOf('backup') < 0) continue;
    if (nm.indexOf(base) < 0 && nm.indexOf('cv app') < 0 && nm.indexOf('cv_app') < 0) continue;
    consider(f);
  }
  files.sort(function(a,b){ return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  var kept = [], trashed = 0;
  for (var i = 0; i < files.length; i++){
    if (i < keepN) kept.push(files[i].getName());
    else { try { files[i].setTrashed(true); trashed++; } catch(e){} }
  }
  return { totalFound: files.length, kept: kept, trashedCount: trashed };
}

// ============================================================================
//  API ROUTER — the bridge between the GitHub Pages app and this backend
//  The page POSTs JSON: { token, calls:[{fn, args:[...]}, ...] }
//  and gets back:       { ok:true, results:[{ok,result}|{ok:false,error,code}] }
//  Several calls ride in one request (the client batches them), which is what
//  keeps screens fast. Only functions listed below are reachable; everything
//  else (setup, backups maintenance, etc.) stays editor-only.
// ============================================================================
function apiRegistry_(){
  return {
    // no token needed — just enough to draw the sign-in screen
    'public': {
      getMembers: getMembers,
      verifyIdentity: verifyIdentity,
      setPin: setPin
    },
    // any signed-in team member
    'user': {
      getBootstrap: getBootstrap,
      getInventory: getInventory,
      getKioskBoard: getKioskBoard,
      setLocationSkuInUse: setLocationSkuInUse,
      recordWithdrawal: recordWithdrawal,
      recordKioskFlags: recordKioskFlags,
      getPickupList: getPickupList,
      getServiceSummary: getServiceSummary,
      getOpenServiceSession: getOpenServiceSession,
      saveServiceSession: saveServiceSession,
      getServiceSessions: getServiceSessions,
      getServiceSession: getServiceSession,
      getKioskMilkStatus: getKioskMilkStatus,
      getMilkBagLog: getMilkBagLog,
      getScheduleOverrides: getScheduleOverrides,
      requestCoverage: requestCoverage,
      claimCoverage: claimCoverage,
      cancelCoverage: cancelCoverage,
      addCharge: addCharge,
      getCharges: getCharges,
      changePin: changePin
    },
    // managers only
    'manager': {
      getDashboard: getDashboard,
      getHistory: getHistory,
      recordReceipt: recordReceipt,
      recordAdjustment: recordAdjustment,
      resolveFlag: resolveFlag,
      saveSku: saveSku,
      setSkuActive: setSkuActive,
      getAllSkusForManager: getAllSkusForManager,
      saveLocation: saveLocation,
      setLocationActive: setLocationActive,
      savePerson: savePerson,
      setPersonActive: setPersonActive,
      getPeopleForManager: getPeopleForManager,
      setLowDaysThreshold: setLowDaysThreshold,
      syncStandardItems: syncStandardItems,
      getServiceFlags: getServiceFlags,
      clearServiceFlag: clearServiceFlag,
      getServiceReport: getServiceReport,
      getPayments: getPayments,
      savePayment: savePayment,
      voidPayment: voidPayment,
      setChargePaid: setChargePaid,
      voidCharge: voidCharge,
      backupNow: backupNow,
      setAutoBackup: setAutoBackup,
      getBackupStatus: getBackupStatus,
      managerResetPin: managerResetPin
    }
  };
}

function doPost(e){
  var out;
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch(pe){ throw new Error('Bad request.'); }
    var calls = body.calls || [];
    if (!calls.length) throw new Error('No calls in request.');
    if (calls.length > 25) throw new Error('Too many calls in one request.');
    var reg = apiRegistry_();
    var auth = tokenInfo_(body.token);
    var results = [];
    for (var i = 0; i < calls.length; i++){
      var c = calls[i] || {};
      var fn = String(c.fn || '');
      try {
        var level = reg['public'][fn] ? 'public' : reg['user'][fn] ? 'user' : reg['manager'][fn] ? 'manager' : null;
        if (!level) throw new Error('Unknown function: ' + fn);
        if (level !== 'public'){
          if (!auth){ results.push({ ok:false, code:'auth', error:'Your session expired — please sign in again.' }); continue; }
          if (level === 'manager' && auth.role !== 'manager'){ results.push({ ok:false, code:'forbidden', error:'Managers only.' }); continue; }
        }
        var target = reg[level][fn];
        var r = target.apply(null, c.args || []);
        results.push({ ok:true, result: (r === undefined ? null : r) });
      } catch(fe){
        results.push({ ok:false, error: (fe && fe.message) || String(fe) });
      }
    }
    out = { ok:true, results: results };
  } catch(err){
    out = { ok:false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
