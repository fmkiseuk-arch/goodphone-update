/**
 * 굳폰 출퇴근 기록 (구글 시트 + Apps Script)
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 *
 * 시트 5개를 씁니다.
 *  - 설정       : 매장 이름, 관리자 비밀번호, 매장 위치, 지각 기준, 알림 메일
 *  - 직원       : 이름, 비밀번호, 시급, 요일별 근무시간, 등록된 폰
 *  - 근무변경   : 특정 날짜만 근무시간이 다를 때 (대타, 휴무)
 *  - 출퇴근기록 : 하루 한 줄씩 자동으로 쌓이는 기록
 *  - 의심기록   : 비밀번호 틀림, 매장 밖, 다른 폰 같은 거절된 시도
 */

var SHEETS = { set: '설정', staff: '직원', change: '근무변경', log: '출퇴근기록', suspect: '의심기록' };
var DOW = ['일', '월', '화', '수', '목', '금', '토'];

var STAFF_HEAD = ['이름', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청'];
var SC = { dev: 11, req: 12 }; // [직원] 시트에서 등록폰·새폰요청 칸 위치 (0부터)
var SUSPECT_HEAD = ['일시', '이름', '구분', '내용'];
var CHANGE_HEAD = ['날짜', '이름', '근무시간', '메모'];
var LOG_HEAD = ['날짜', '요일', '이름', '예정출근', '예정퇴근', '출근', '퇴근',
  '지각(분)', '조퇴(분)', '근무(분)', '차감액', '출근거리(m)', '퇴근거리(m)', '메모'];
var LOG_FMT = ['@', '@', '@', '@', '@', '@', '@', '0', '0', '0', '#,##0', '0', '0', '@'];
var C = { date: 0, dow: 1, name: 2, sIn: 3, sOut: 4, tIn: 5, tOut: 6,
  late: 7, early: 8, work: 9, deduct: 10, dIn: 11, dOut: 12, memo: 13 };

var K = {
  store: '매장이름', adminPin: '관리자PIN', lat: '매장위도', lng: '매장경도',
  radius: '허용반경(m)', mode: '위치확인', device: '폰확인', grace: '지각유예(분)',
  email: '알림이메일', alertMin: '알림기준(분)',
};
var SETTINGS = [
  [K.store, '굳폰', '직원 화면 맨 위에 보이는 이름'],
  [K.adminPin, '0000', '사장님 화면 비밀번호. 꼭 바꾸세요'],
  [K.lat, '', '사장님 화면 [설정]에서 [지금 위치를 매장으로 등록]을 누르면 채워져요'],
  [K.lng, '', ''],
  [K.radius, '100', '매장에서 이 거리(m) 안에서만 찍혀요. 실내 GPS 오차는 최대 100m까지 봐줘요'],
  [K.mode, '필수', '필수: 매장 근처에서만 찍힘 / 기록만: 위치는 남기고 어디서든 찍힘 / 안함'],
  [K.device, '필수', '필수: 직원마다 처음 찍은 폰에서만 찍힘. 폰을 바꾸면 사장님 승인 필요 / 안함'],
  [K.grace, '0', '이 시간(분)까지 늦은 건 지각으로 안 봐요. 넘으면 늦은 시간 전체가 지각'],
  [K.email, '', '출근 시간이 지났는데 안 찍으면 이 주소로 메일이 가요 (비워두면 안 보냄)'],
  [K.alertMin, '10', '출근 예정 시간에서 몇 분 지나면 메일을 보낼지'],
];

/* ───────────── 웹 화면 ───────────── */

function doGet(e) {
  var admin = e && e.parameter && e.parameter.page === 'admin';
  return HtmlService.createHtmlOutputFromFile(admin ? 'Admin' : 'Index')
    .setTitle(admin ? '출퇴근 관리' : '출퇴근')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ───────────── 직원 화면에서 부르는 함수 ───────────── */

function getStaffList() {
  var set = settings_();
  return {
    store: set.store,
    mode: set.mode,
    staff: staff_().filter(function (p) { return p.active; })
      .map(function (p) { return { name: p.name, pin: !!p.pin }; }),
  };
}

function getToday(name) {
  var p = person_(name);
  var now = nowKst_();
  var found = findLog_(sheet_(SHEETS.log), now.date, p.name);
  if (found) return todayOf_(found.vals);
  var s = schedFor_(p, now.date);
  return { sIn: s ? fmtTime_(s.start) : '', sOut: s ? fmtTime_(s.end) : '', tIn: '', tOut: '' };
}

function punch(req) {
  req = req || {};
  var type = req.type === 'out' ? 'out' : 'in';
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var set = settings_();
    var people = staff_();
    var p = person_(req.name, people);
    checkPin_(p, req.pin);
    checkDevice_(set, p, req, people);
    var dist = checkPlace_(set, req, p.name);
    var now = nowKst_();
    var sh = sheet_(SHEETS.log);
    var found = findLog_(sh, now.date, p.name);
    var row, v;
    if (found) {
      row = found.row;
      v = found.vals.slice();
    } else {
      var s = schedFor_(p, now.date);
      row = Math.max(sh.getLastRow(), 1) + 1;
      v = [now.date, DOW[now.dow], p.name, s ? fmtTime_(s.start) : '', s ? fmtTime_(s.end) : '',
        '', '', '', '', '', '', '', '', ''];
    }
    if (type === 'in') {
      if (v[C.tIn]) throw new Error('오늘은 이미 ' + v[C.tIn] + '에 출근을 찍었어요.');
      v[C.tIn] = now.time;
      v[C.dIn] = dist;
    } else {
      if (v[C.tOut]) v[C.memo] = addMemo_(v[C.memo], '퇴근 다시 찍음(이전 ' + v[C.tOut] + ')');
      if (!v[C.tIn]) v[C.memo] = addMemo_(v[C.memo], '출근 기록 없음');
      v[C.tOut] = now.time;
      v[C.dOut] = dist;
    }
    applyCalc_(v, p.wage, set.grace);
    writeLog_(sh, row, v);
    return {
      type: type, time: now.time,
      late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: v[C.work] === '' ? null : toNum_(v[C.work]),
      today: todayOf_(v),
    };
  } finally {
    lock.releaseLock();
  }
}

function getMyMonth(name, pin, ym) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  ym = validYm_(ym) || now.ym;
  var rows = monthRows_(ym).filter(function (r) { return r.name === p.name; });
  return { ym: ym, rows: rows, total: total_(rows, now.date) };
}

/* ───────────── 사장님 화면에서 부르는 함수 ───────────── */

function adminToday(pin) {
  var set = adminAuth_(pin);
  var now = nowKst_();
  var logs = monthRows_(now.ym).filter(function (r) { return r.date === now.date; });
  var changes = rows_(SHEETS.change);
  var active = staff_().filter(function (p) { return p.active; });
  var list = active.map(function (p) {
    var r = null;
    logs.forEach(function (x) { if (x.name === p.name) r = x; });
    var s = schedFor_(p, now.date, changes);
    var sIn = r ? r.sIn : (s ? fmtTime_(s.start) : '');
    var sOut = r ? r.sOut : (s ? fmtTime_(s.end) : '');
    var status;
    if (r && r.tOut) status = '퇴근';
    else if (r && r.tIn) status = '근무중';
    else if (!sIn) status = '휴무';
    else if (now.min > parseTime_(sIn) + set.grace) status = '미출근';
    else status = '출근 전';
    return {
      name: p.name, sIn: sIn, sOut: sOut,
      tIn: r ? r.tIn : '', tOut: r ? r.tOut : '',
      late: r ? r.late : 0, early: r ? r.early : 0, status: status,
    };
  });
  return {
    date: now.date, dow: DOW[now.dow], time: now.time, list: list, info: info_(set),
    pending: active.filter(function (p) { return devId_(p.request); }).map(function (p) {
      return { name: p.name, label: devText_(p.request) };
    }),
    devices: active.map(function (p) {
      return { name: p.name, label: p.deviceId ? devText_(p.device) : '' };
    }),
    suspects: suspectsOn_(now.date),
  };
}

/** 새 폰 승인(ok=true) 또는 거절. 승인하면 예전 폰으로는 더 이상 안 찍혀요. */
function adminDevice(pin, name, ok) {
  adminAuth_(pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var people = staff_();
    var p = null;
    people.forEach(function (x) { if (x.name === String(name == null ? '' : name).trim()) p = x; });
    if (!p) throw new Error('직원을 찾을 수 없어요.');
    var id = devId_(p.request);
    if (!id) throw new Error('승인 대기 중인 폰이 없어요. 새로고침 해주세요.');
    if (ok) {
      people.forEach(function (x) {
        if (x.name !== p.name && x.deviceId === id) throw new Error('이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어서 승인할 수 없어요.');
      });
      setStaffCell_(p.row, SC.dev, devCell_(id, devLabel_(p.request), mmdd_(nowKst_().date) + ' 승인'));
    }
    setStaffCell_(p.row, SC.req, '');
  } finally {
    lock.releaseLock();
  }
  return adminToday(pin);
}

function adminMonth(pin, ym) {
  adminAuth_(pin);
  return monthData_(validYm_(ym) || nowKst_().ym);
}

function adminExport(pin, ym) {
  adminAuth_(pin);
  return exportMonth_(validYm_(ym) || nowKst_().ym);
}

function adminSetPlace(pin, lat, lng) {
  adminAuth_(pin);
  lat = Number(lat);
  lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('위치 값이 이상해요. 다시 시도해주세요.');
  }
  setSetting_(K.lat, lat.toFixed(6));
  setSetting_(K.lng, lng.toFixed(6));
  return info_(settings_());
}

/* ───────────── 시트 메뉴, 자동 실행 ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('출퇴근')
    .addItem('처음 설정 (한 번만)', 'setup')
    .addItem('이번 달 정산 시트 만들기', 'menuExportThis')
    .addItem('지난 달 정산 시트 만들기', 'menuExportPrev')
    .addToUi();
}

function menuExportThis() { exportFromMenu_(nowKst_().ym); }
function menuExportPrev() { exportFromMenu_(prevYm_(nowKst_().ym)); }

function exportFromMenu_(ym) {
  SpreadsheetApp.getUi(); // 시트 메뉴에서만 돌게: 웹 화면에서 몰래 부르면 여기서 멈춰요
  var r = exportMonth_(ym);
  book_().setActiveSheet(book_().getSheetByName(r.name));
  book_().toast("'" + r.name + "' 시트를 만들었어요.");
}

/** 시트에서 출근·퇴근·예정 시간을 손으로 고치면 지각·근무시간·차감액을 다시 계산해요. */
function onEdit(e) {
  try {
    var rg = e.range;
    var sh = rg.getSheet();
    if (sh.getName() !== SHEETS.log) return;
    var c0 = rg.getColumn();
    var c1 = c0 + rg.getNumColumns() - 1;
    if (c1 < C.name + 1 || c0 > C.tOut + 1) return;
    var r1 = Math.max(rg.getRow(), 2);
    var n = rg.getRow() + rg.getNumRows() - r1;
    if (n <= 0) return;
    var set = settings_();
    var people = staff_();
    var vals = sh.getRange(r1, 1, n, LOG_HEAD.length).getDisplayValues();
    var out = vals.map(function (v) {
      var p = null;
      people.forEach(function (x) { if (x.name === String(v[C.name]).trim()) p = x; });
      applyCalc_(v, p ? p.wage : 0, set.grace);
      return [v[C.late], v[C.early], v[C.work], v[C.deduct]];
    });
    sh.getRange(r1, C.late + 1, n, 4).setValues(out);
  } catch (err) {
    console.error(err);
  }
}

/** 10분마다 자동 실행: 출근 시간이 지났는데 안 찍은 직원이 있으면 메일을 보내요. */
function checkMissing() {
  var set = settings_();
  if (!set.email) return;
  var now = nowKst_();
  var props = PropertiesService.getScriptProperties();
  var sent = props.getProperties();
  Object.keys(sent).forEach(function (k) {
    if (k.indexOf('alert:') === 0 && k.indexOf('alert:' + now.date) !== 0) props.deleteProperty(k);
  });
  var logs = monthRows_(now.ym).filter(function (r) { return r.date === now.date; });
  var changes = rows_(SHEETS.change);
  var missing = [];
  staff_().filter(function (p) { return p.active; }).forEach(function (p) {
    var s = schedFor_(p, now.date, changes);
    if (!s) return;
    if (now.min < s.start + set.alertMin || now.min > s.start + 180) return;
    if (logs.some(function (r) { return r.name === p.name && r.tIn; })) return;
    var key = 'alert:' + now.date + ':' + p.name;
    if (sent[key]) return;
    props.setProperty(key, '1');
    missing.push(p.name + ' (출근 예정 ' + fmtTime_(s.start) + ')');
  });
  if (!missing.length) return;
  MailApp.sendEmail(set.email,
    '[' + set.store + ' 출퇴근] 아직 출근 안 찍은 직원 ' + missing.length + '명',
    now.date + ' ' + now.time + ' 기준\n\n' + missing.join('\n') + '\n\n시트 열기: ' + book_().getUrl());
}

/** 처음 한 번 실행: 시트를 만들고 10분마다 도는 알림을 켭니다. 다시 실행해도 기존 기록은 안 지워져요. */
function setup() {
  var ss = book_();
  ss.setSpreadsheetTimeZone('Asia/Seoul');

  var set = ensureSheet_(ss, SHEETS.set, ['항목', '값', '설명'], SETTINGS, ['@', '@', '@']);
  var have = rows_(SHEETS.set).map(function (r) { return String(r[0]).trim(); });
  SETTINGS.forEach(function (row) {
    if (have.indexOf(row[0]) < 0) set.appendRow(row);
  });
  set.setColumnWidth(1, 120);
  set.setColumnWidth(2, 160);
  set.setColumnWidth(3, 520);

  var staff = ensureSheet_(ss, SHEETS.staff, STAFF_HEAD,
    [['예시직원', '1234', 10320, '10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00',
      '10:00-20:00', '10:00-20:00', '휴무', '', '', '']],
    ['@', '@', '#,##0', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@']);
  // 예전 버전으로 만든 [직원] 시트에도 등록폰·새폰요청 칸을 붙여요
  staff.getRange(1, SC.dev + 1, 1, 2).setValues([[STAFF_HEAD[SC.dev], STAFF_HEAD[SC.req]]])
    .setFontWeight('bold').setBackground('#eef2f7');
  staff.getRange(2, SC.dev + 1, staff.getMaxRows() - 1, 2).setNumberFormat('@');
  ensureSheet_(ss, SHEETS.change, CHANGE_HEAD, [], ['@', '@', '@', '@']);
  ensureSheet_(ss, SHEETS.log, LOG_HEAD, [], LOG_FMT);
  ensureSheet_(ss, SHEETS.suspect, SUSPECT_HEAD, [], ['@', '@', '@', '@']);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkMissing') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMissing').timeBased().everyMinutes(10).create();

  var msg = '설정 완료! [직원] 시트에 이름·비밀번호·시급·근무시간을 넣고, [설정] 시트에서 관리자PIN을 바꿔주세요.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { console.log(msg); }
  return msg;
}

/* ───────────── 내부 함수 ───────────── */

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh) throw new Error("'" + name + "' 시트가 없어요. 사장님이 [처음 설정]을 먼저 실행해야 해요.");
  return sh;
}

/** 머리글을 뺀 모든 줄을 화면에 보이는 글자 그대로 읽어요. */
function rows_(name) {
  var sh = sheet_(name);
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues();
}

function ensureSheet_(ss, name, head, sample, fmts) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#eef2f7');
  sh.setFrozenRows(1);
  for (var c = 0; c < fmts.length; c++) {
    sh.getRange(2, c + 1, sh.getMaxRows() - 1, 1).setNumberFormat(fmts[c]);
  }
  if (sample.length) sh.getRange(2, 1, sample.length, sample[0].length).setValues(sample);
  return sh;
}

function settings_() {
  var map = {};
  rows_(SHEETS.set).forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) map[k] = String(r[1] == null ? '' : r[1]).trim();
  });
  function num(k, d) {
    var s = map[k];
    if (s === undefined || s === '') return d;
    var n = Number(s.replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? d : n;
  }
  var mode = map[K.mode] || '필수';
  mode = /안/.test(mode) ? '안함' : /기록/.test(mode) ? '기록만' : '필수';
  return {
    store: map[K.store] || '출퇴근',
    adminPin: map[K.adminPin] || '',
    lat: num(K.lat, null),
    lng: num(K.lng, null),
    radius: num(K.radius, 100),
    mode: mode,
    device: /안/.test(map[K.device] || '') ? '안함' : '필수',
    grace: num(K.grace, 0),
    email: map[K.email] || '',
    alertMin: num(K.alertMin, 10),
  };
}

function setSetting_(key, value) {
  var sh = sheet_(SHEETS.set);
  var rows = rows_(SHEETS.set);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(value));
      return;
    }
  }
  sh.appendRow([key, String(value), '']);
}

function staff_() {
  var out = [];
  rows_(SHEETS.staff).forEach(function (r, i) {
    if (!String(r[0]).trim()) return;
    out.push({
      row: i + 2,
      name: String(r[0]).trim(),
      pin: String(r[1] == null ? '' : r[1]).trim(),
      wage: toNum_(r[2]),
      week: [r[9], r[3], r[4], r[5], r[6], r[7], r[8]], // 일(0) 월(1) … 토(6)
      active: !/^\s*(x|×|퇴사|아니오?|n)\s*$/i.test(String(r[10] == null ? '' : r[10])),
      device: String(r[SC.dev] == null ? '' : r[SC.dev]),
      deviceId: devId_(r[SC.dev]),
      request: String(r[SC.req] == null ? '' : r[SC.req]),
    });
  });
  return out;
}

function setStaffCell_(row, idx, value) {
  sheet_(SHEETS.staff).getRange(row, idx + 1).setNumberFormat('@').setValue(value);
}

function person_(name, list) {
  name = String(name == null ? '' : name).trim();
  list = list || staff_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name && list[i].active) return list[i];
  }
  throw new Error('직원 명단에 없는 이름이에요. 화면을 새로고침 해주세요.');
}

/** 그날 근무시간: [근무변경] 시트가 있으면 그걸, 없으면 [직원] 시트의 요일별 시간을 써요. */
function schedFor_(p, date, changes) {
  changes = changes || rows_(SHEETS.change);
  var txt = null;
  changes.forEach(function (r) {
    if (parseDate_(r[0]) === date && String(r[1]).trim() === p.name) txt = r[2];
  });
  if (txt === null) txt = p.week[dowOf_(date)];
  return parseSchedule_(txt);
}

function findLog_(sh, date, name) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var first = Math.max(2, last - 499);
  var vals = sh.getRange(first, 1, last - first + 1, LOG_HEAD.length).getDisplayValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (parseDate_(vals[i][C.date]) === date && String(vals[i][C.name]).trim() === name) {
      return { row: first + i, vals: vals[i] };
    }
  }
  return null;
}

function writeLog_(sh, row, v) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var out = v.slice();
  [C.dIn, C.dOut].forEach(function (c) { out[c] = out[c] === '' ? '' : toNum_(out[c]); });
  var rg = sh.getRange(row, 1, 1, LOG_HEAD.length);
  rg.setNumberFormats([LOG_FMT]);
  rg.setValues([out]);
}

function todayOf_(v) {
  return {
    sIn: fmtTime_(parseTime_(v[C.sIn])), sOut: fmtTime_(parseTime_(v[C.sOut])),
    tIn: fmtTime_(parseTime_(v[C.tIn])), tOut: fmtTime_(parseTime_(v[C.tOut])),
  };
}

/** 기록 한 줄의 지각·조퇴·근무시간·차감액을 계산해서 그 줄에 채워요. */
function applyCalc_(v, wage, grace) {
  var r = calc_(v[C.sIn], v[C.sOut], v[C.tIn], v[C.tOut], wage, grace);
  v[C.late] = r.late || '';
  v[C.early] = r.early || '';
  v[C.work] = r.work;
  v[C.deduct] = r.deduct || '';
  return v;
}

/**
 * 지각: 예정 출근보다 (유예 시간을 넘겨) 늦게 온 분.
 * 조퇴: 예정 퇴근보다 일찍 간 분.
 * 차감액: 시급 × (지각 + 조퇴)분 ÷ 60, 원 단위 버림. 일 안 한 시간만큼만 빼요.
 */
function calc_(sIn, sOut, tIn, tOut, wage, grace) {
  var a = parseTime_(sIn), b = parseTime_(sOut), i = parseTime_(tIn), o = parseTime_(tOut);
  var late = 0, early = 0, work = '';
  if (a != null && i != null && i - a > (grace || 0)) late = i - a;
  if (b != null && o != null && b > o) early = b - o;
  if (i != null && o != null) work = o >= i ? o - i : o + 1440 - i;
  var deduct = Math.floor((Number(wage) || 0) * (late + early) / 60);
  return { late: late, early: early, work: work, deduct: deduct };
}

function checkPin_(p, pin) {
  if (!p.pin) return;
  guard_('pin:' + p.name, String(pin == null ? '' : pin).trim() === p.pin, '비밀번호가 틀렸어요.', function (n) {
    logSuspect_(p.name, '비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
  });
}

function adminAuth_(pin) {
  var set = settings_();
  if (!set.adminPin) throw new Error('[설정] 시트에 관리자PIN을 먼저 넣어주세요.');
  guard_('admin', String(pin == null ? '' : pin).trim() === set.adminPin, '관리자 비밀번호가 틀렸어요.', function (n) {
    logSuspect_('(사장님 화면)', '관리자 비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
  });
  return set;
}

/** 비밀번호를 5번 틀리면 10분 동안 막아요. 틀릴 때마다 onFail(몇 번째)을 불러요. */
function guard_(key, ok, msg, onFail) {
  var cache = CacheService.getScriptCache();
  var k = 'fail:' + key;
  var n = Number(cache.get(k) || 0);
  if (n >= 5) throw new Error('비밀번호를 5번 틀려서 잠겼어요. 10분 뒤에 다시 해주세요.');
  if (!ok) {
    cache.put(k, String(n + 1), 600);
    if (onFail) onFail(n + 1);
    throw new Error(msg + (n + 1 >= 3 ? ' (' + (n + 1) + '/5)' : ''));
  }
  if (n) cache.remove(k);
}

/**
 * 폰 확인: 직원마다 처음 찍은 폰 1대만 등록돼요.
 *  - 등록된 폰이 없으면 지금 폰을 등록하고 통과
 *  - 다른 직원의 폰이면 거절 (동료가 대신 찍기 방지)
 *  - 등록 안 된 새 폰이면 거절하고 사장님께 승인 요청
 */
function checkDevice_(set, p, req, people) {
  if (set.device === '안함') return;
  var id = cleanDevId_(req.device);
  var label = String(req.label || '알 수 없는 폰').replace(/[#·\n]/g, ' ').slice(0, 30).trim();
  if (!id) {
    deny_(set, p.name, '폰 확인 안 됨', label,
      '이 브라우저에서는 폰 확인이 안 돼요. 시크릿(사생활 보호) 모드를 끄고 다시 열어주세요.');
  }
  people.forEach(function (x) {
    if (x.name !== p.name && x.deviceId === id) {
      deny_(set, p.name, '다른 직원 폰', x.name + ' 님 폰으로 찍으려 함 (' + label + ')',
        '이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어요. 본인 폰으로 찍어주세요.', true);
    }
  });
  var now = nowKst_();
  if (!p.deviceId) {
    setStaffCell_(p.row, SC.dev, devCell_(id, label, mmdd_(now.date) + ' 등록'));
    p.deviceId = id;
    return;
  }
  if (p.deviceId === id) return;
  var first = devId_(p.request) !== id; // 같은 폰으로 다시 눌러도 메일은 처음 한 번만
  if (first) setStaffCell_(p.row, SC.req, devCell_(id, label, mmdd_(now.date) + ' ' + now.time + ' 요청'));
  deny_(set, p.name, '새 폰 승인 요청', label + ' (등록된 폰: ' + devLabel_(p.device) + ')',
    '등록된 폰이 아니에요. 사장님께 새 폰 승인을 요청했어요. 승인되면 다시 눌러주세요.\n' +
    '지금 시간(' + now.time + ')은 기록에 남아서 사장님이 출퇴근 시간을 맞춰줄 수 있어요.', first);
}

/** 매장 근처인지 확인하고, 매장까지 거리(m)를 돌려줘요. 확인 안 하면 ''. */
function checkPlace_(set, req, name) {
  if (set.mode === '안함') return '';
  var has = typeof req.lat === 'number' && typeof req.lng === 'number' && isFinite(req.lat) && isFinite(req.lng);
  if (set.lat == null || set.lng == null) {
    if (set.mode === '필수') throw new Error('사장님이 아직 매장 위치를 등록하지 않았어요. 사장님께 말씀해주세요.');
    return '';
  }
  if (!has) {
    if (set.mode === '필수') {
      deny_(set, name, '위치 없음', '위치 권한이 꺼져 있거나 GPS를 못 잡음',
        '위치를 확인하지 못했어요. 휴대폰 위치(GPS)를 켜고 다시 눌러주세요.');
    }
    return '';
  }
  var d = distance_(set.lat, set.lng, req.lat, req.lng);
  var acc = Math.max(Number(req.acc) || 0, 0);
  if (d - Math.min(acc, 100) > set.radius) {
    var where = '매장에서 ' + fmtDist_(d) + ' (GPS 오차 ' + Math.round(acc) + 'm)';
    if (set.mode === '필수') {
      deny_(set, name, '매장 밖', where, '매장에서 약 ' + fmtDist_(d) + ' 떨어져 있어요. 매장 안에서 다시 눌러주세요.');
    }
    logSuspect_(name, '매장 밖에서 찍음', where + ', 기록만 모드라 통과');
  }
  return d;
}

/** 거절: [의심기록]에 남기고(필요하면 사장님께 메일), 직원 화면에는 msg를 보여줘요. */
function deny_(set, name, kind, detail, msg, mail) {
  logSuspect_(name, kind, detail);
  if (mail && set.email) {
    try {
      MailApp.sendEmail(set.email, '[' + set.store + ' 출퇴근] ' + name + ' · ' + kind,
        nowKst_().date + ' ' + nowKst_().time + '\n' + name + ' · ' + kind + '\n' + detail +
        '\n\n사장님 화면의 [오늘] 탭에서 확인하세요.\n시트: ' + book_().getUrl());
    } catch (err) { console.error(err); }
  }
  throw new Error(msg);
}

function logSuspect_(name, kind, detail) {
  try {
    var sh = book_().getSheetByName(SHEETS.suspect);
    if (!sh) return;
    var row = Math.max(sh.getLastRow(), 1) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
    var now = nowKst_();
    var rg = sh.getRange(row, 1, 1, SUSPECT_HEAD.length);
    rg.setNumberFormats([['@', '@', '@', '@']]);
    rg.setValues([[now.date + ' ' + now.time, name || '', kind, detail || '']]);
    SpreadsheetApp.flush();
  } catch (err) {
    console.error(err);
  }
}

function suspectsOn_(date) {
  if (!book_().getSheetByName(SHEETS.suspect)) return [];
  return rows_(SHEETS.suspect).filter(function (r) {
    return parseDate_(r[0]) === date;
  }).map(function (r) {
    return { time: fmtTime_(parseTime_(String(r[0]).slice(10))), name: r[1], kind: r[2], detail: r[3] };
  }).reverse().slice(0, 50);
}

/* 폰 칸 모양: '#a1b2c3d4e5f60718 iPhone 사파리 · 11/18 등록' */
function devCell_(id, label, note) { return '#' + id + ' ' + label + ' · ' + note; }
function devId_(s) { var m = String(s == null ? '' : s).match(/#([A-Za-z0-9_-]{8,64})/); return m ? m[1] : ''; }
function devLabel_(s) { return String(s == null ? '' : s).replace(/^\s*#\S+\s*/, '').split(' · ')[0].trim(); }
function devText_(s) { return String(s == null ? '' : s).replace(/^\s*#\S+\s*/, '').trim(); }
function cleanDevId_(s) { s = String(s == null ? '' : s); return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : ''; }
function mmdd_(date) { return date.slice(5, 7) + '/' + date.slice(8, 10); }

function info_(set) {
  var appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl() || ''; } catch (err) { /* 배포 전 */ }
  return {
    store: set.store, hasPlace: set.lat != null && set.lng != null, lat: set.lat, lng: set.lng,
    radius: set.radius, mode: set.mode, device: set.device, grace: set.grace, email: set.email, alertMin: set.alertMin,
    weakPin: set.adminPin === '0000', sheetUrl: book_().getUrl(), appUrl: appUrl,
  };
}

function monthRows_(ym) {
  return rows_(SHEETS.log).map(function (v) {
    return {
      date: parseDate_(v[C.date]), dow: String(v[C.dow] || ''), name: String(v[C.name]).trim(),
      sIn: fmtTime_(parseTime_(v[C.sIn])), sOut: fmtTime_(parseTime_(v[C.sOut])),
      tIn: fmtTime_(parseTime_(v[C.tIn])), tOut: fmtTime_(parseTime_(v[C.tOut])),
      late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: toNum_(v[C.work]),
      deduct: toNum_(v[C.deduct]), memo: String(v[C.memo] || ''),
    };
  }).filter(function (r) {
    return r.date && r.date.indexOf(ym) === 0 && r.name;
  }).sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function total_(rows, today) {
  var t = { days: 0, work: 0, lateCount: 0, lateMin: 0, earlyMin: 0, deduct: 0, noOut: 0, noIn: 0 };
  rows.forEach(function (r) {
    if (r.tIn || r.tOut) t.days++;
    t.work += r.work;
    if (r.late > 0) { t.lateCount++; t.lateMin += r.late; }
    t.earlyMin += r.early;
    t.deduct += r.deduct;
    if (r.tIn && !r.tOut && r.date !== today) t.noOut++;
    if (!r.tIn && r.tOut) t.noIn++;
  });
  return t;
}

function monthData_(ym) {
  var rows = monthRows_(ym);
  var today = nowKst_().date;
  var people = staff_();
  var names = people.map(function (p) { return p.name; });
  rows.forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
  var staff = names.map(function (n) {
    var mine = rows.filter(function (r) { return r.name === n; });
    var t = total_(mine, today);
    t.name = n;
    return t;
  }).filter(function (t) {
    return t.days || t.noIn || people.some(function (p) { return p.name === t.name && p.active; });
  });
  return { ym: ym, staff: staff, rows: rows };
}

function exportMonth_(ym) {
  var ss = book_();
  var name = '정산 ' + ym;
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  var data = monthData_(ym);

  var head = ['이름', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감액', '퇴근 누락', '출근 누락'];
  var sum = data.staff.map(function (s) {
    return [s.name, s.days, hm_(s.work), s.lateCount, s.lateMin, s.earlyMin, s.deduct, s.noOut, s.noIn];
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  if (sum.length) {
    sh.getRange(2, 1, sum.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, sum.length, head.length).setValues(sum);
    sh.getRange(2, 7, sum.length, 1).setNumberFormat('#,##0');
  }

  var top = sum.length + 3;
  sh.getRange(top, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold').setBackground('#eef2f7');
  if (data.rows.length) {
    var detail = data.rows.map(function (r) {
      return [r.date, r.dow, r.name, r.sIn, r.sOut, r.tIn, r.tOut,
        r.late || '', r.early || '', r.work || '', r.deduct || '', '', '', r.memo];
    });
    var rg = sh.getRange(top + 1, 1, detail.length, LOG_HEAD.length);
    rg.setNumberFormats(detail.map(function () { return LOG_FMT; }));
    rg.setValues(detail);
  }
  sh.setFrozenRows(1);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

/* ───────────── 시간·날짜·거리 계산 (순수 함수) ───────────── */

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** 한국 시간 기준 지금. */
function nowKst_() {
  var d = new Date(Date.now() + 9 * 3600 * 1000);
  var date = d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
  var min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { date: date, min: min, time: fmtTime_(min), ym: date.slice(0, 7), dow: d.getUTCDay() };
}

/** '10:05', '10시 5분', '오후 6:30:00', '6:30 PM' → 분. 못 읽으면 null. */
function parseTime_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/(\d{1,2})(?:\s*[:시]\s*(\d{1,2}))?/);
  if (!m) return null;
  var h = Number(m[1]);
  var mi = Number(m[2] || 0);
  if (/오후|pm/i.test(s) && h < 12) h += 12;
  if (/오전|am/i.test(s) && h === 12) h = 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

function fmtTime_(min) {
  if (min == null || min === '') return '';
  return pad2_(Math.floor(min / 60) % 24) + ':' + pad2_(min % 60);
}

/** '10:00-20:00', '10:00~20:00', '10-20' → {start, end}. 빈칸·휴무·휴가 → null. */
function parseSchedule_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || /휴|쉼|off/i.test(s)) return null;
  var parts = s.split(/\s*[-~–—]\s*/);
  if (parts.length !== 2) return null;
  var a = parseTime_(parts[0]), b = parseTime_(parts[1]);
  if (a == null || b == null) return null;
  return { start: a, end: b };
}

/** '2026-11-18', '2026. 11. 18', '2026/11/18' → '2026-11-18'. */
function parseDate_(v) {
  var m = String(v == null ? '' : v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? m[1] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[3])) : '';
}

function dowOf_(date) {
  var p = date.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function validYm_(ym) {
  return /^\d{4}-\d{2}$/.test(String(ym || '')) ? String(ym) : '';
}

function prevYm_(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1;
  if (m === 0) { y--; m = 12; }
  return y + '-' + pad2_(m);
}

function toNum_(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  var n = Number(s.replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function hm_(min) {
  min = Math.round(min || 0);
  var h = Math.floor(min / 60), m = min % 60;
  return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';
}

function addMemo_(memo, text) {
  memo = String(memo || '');
  if (memo.indexOf(text) >= 0) return memo;
  return memo ? memo + ', ' + text : text;
}

function distance_(lat1, lng1, lat2, lng2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function fmtDist_(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
}
