/**
 * 굳폰 출퇴근 — 한 파일 버전 (자동으로 만든 파일이에요. 고칠 땐 attendance/ 의 원본을 고치고 node attendance/build.js)
 *
 * 쓰는 법: 구글 시트 → 확장 프로그램 → Apps Script → 원래 있던 내용을 지우고 이 파일 전체를 붙여넣기
 *        → 저장 → 위쪽에서 setup 고르고 ▶ 실행(권한 허용) → 배포 → 새 배포 → 웹 앱
 *          (실행: 나 / 액세스: 모든 사용자) → 배포 → 나온 주소가 직원 화면, 주소 뒤에 ?page=admin 이 사장님 화면
 */
/**
 * 굳폰 출퇴근 기록 (구글 시트 + Apps Script)
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 *
 * 시트 6개를 씁니다.
 *  - 설정       : 매장 이름, 관리자 비밀번호, 매장 위치, 지각 기준, 알림(텔레그램·메일)
 *  - 직원       : 이름, 비밀번호, 시급, 요일별 근무시간, 등록된 폰
 *  - 근무변경   : 특정 날짜만 근무시간이 다를 때 (대타, 휴무)
 *  - 출퇴근기록 : 하루 한 줄씩 자동으로 쌓이는 기록
 *  - 의심기록   : 비밀번호 틀림, 매장 밖, 다른 폰 같은 거절된 시도
 *  - 요청       : 직원이 보낸 출퇴근 정정, 휴무, 대타 요청과 처리 결과
 */

/**
 * 시트에 붙인 스크립트(확장 프로그램 → Apps Script)면 비워 두세요.
 * 시트와 따로 만든 스크립트면 시트 주소의 /d/ 와 /edit 사이 글자를 넣어요. (자동 설치가 채워요)
 */
var SHEET_ID = '';

var SHEETS = { set: '설정', staff: '직원', change: '근무변경', log: '출퇴근기록', suspect: '의심기록', req: '요청' };
var DOW = ['일', '월', '화', '수', '목', '금', '토'];

var STAFF_HEAD = ['이름', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청'];
var SC = { dev: 11, req: 12 }; // [직원] 시트에서 등록폰·새폰요청 칸 위치 (0부터)
var SUSPECT_HEAD = ['일시', '이름', '구분', '내용'];
var REQ_HEAD = ['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시'];
var R = { id: 0, at: 1, name: 2, kind: 3, date: 4, what: 5, reason: 6, state: 7, taker: 8, done: 9 };
var CHANGE_HEAD = ['날짜', '이름', '근무시간', '메모'];
var LOG_HEAD = ['날짜', '요일', '이름', '예정출근', '예정퇴근', '출근', '퇴근',
  '지각(분)', '조퇴(분)', '근무(분)', '차감액', '출근거리(m)', '퇴근거리(m)', '메모'];
var LOG_FMT = ['@', '@', '@', '@', '@', '@', '@', '0', '0', '0', '#,##0', '0', '0', '@'];
var C = { date: 0, dow: 1, name: 2, sIn: 3, sOut: 4, tIn: 5, tOut: 6,
  late: 7, early: 8, work: 9, deduct: 10, dIn: 11, dOut: 12, memo: 13 };

var K = {
  store: '매장이름', adminPin: '관리자PIN', lat: '매장위도', lng: '매장경도',
  radius: '허용반경(m)', mode: '위치확인', device: '폰확인', grace: '지각유예(분)',
  email: '알림이메일', alertMin: '알림기준(분)', tgToken: '텔레그램토큰', tgChat: '텔레그램채팅ID',
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
  [K.email, '', '알림 받을 메일 주소. 텔레그램을 연결하면 텔레그램으로 가고, 안 되면 이 메일로 가요'],
  [K.alertMin, '10', '출근 예정 시간에서 몇 분 지나도 안 찍으면 알림을 보낼지'],
  [K.tgToken, '', '텔레그램 봇 토큰. 사장님 화면 [설정] 탭에서 넣으면 돼요. 남에게 보여주지 마세요'],
  [K.tgChat, '', '알림 받을 텔레그램 채팅 번호. 사장님 화면에서 [연결 확인]을 누르면 채워져요'],
];

/* ───────────── 웹 화면 ───────────── */

function doGet(e) {
  var admin = e && e.parameter && e.parameter.page === 'admin';
  var name = admin ? 'Admin' : 'Index';
  // 한 파일 버전(dist/Code.gs)은 화면 HTML을 PAGES 안에 담고 있어요.
  var out = typeof PAGES !== 'undefined' && PAGES[name]
    ? HtmlService.createHtmlOutput(PAGES[name])
    : HtmlService.createHtmlOutputFromFile(name);
  return out.setTitle(admin ? '출퇴근 관리' : '출퇴근')
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
    requests: openReqsForAdmin_(now.date),
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

/* ───────────── 요청: 출퇴근 정정, 휴무, 대타 ───────────── */
/*
 * 정정: 대기 → 승인(출퇴근기록에 반영) / 거절 / 취소
 * 휴무: 대기 → 승인([근무변경]에 '휴무') / 거절 / 취소
 * 대타: 대기(구하는 중) → 수락(동료가 '제가 할게요') → 승인([근무변경]에 두 사람 반영) / 거절 / 취소
 */

/** 직원 화면: 내 요청과, 동료가 올린 대타 구함 목록. */
function getRequests(name, pin) {
  var p = person_(name);
  checkPin_(p, pin);
  return reqsFor_(p.name);
}

/** 직원 화면: 요청 보내기. req = {name, pin, kind: 'fix'|'off'|'swap', date, type: 'in'|'out', time, reason} */
function makeRequest(req) {
  req = req || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var set = settings_();
    var p = person_(req.name);
    checkPin_(p, req.pin);
    var kind = { fix: '정정', off: '휴무', swap: '대타' }[req.kind];
    if (!kind) throw new Error('요청 종류가 이상해요. 화면을 새로고침 해주세요.');
    var now = nowKst_();
    var date = parseDate_(req.date);
    if (!date) throw new Error('날짜를 골라주세요.');
    var reason = String(req.reason == null ? '' : req.reason).replace(/\s+/g, ' ').trim().slice(0, 100);
    var all = readReqs_();
    var what;

    if (kind === '정정') {
      var raw = String(req.time == null ? '' : req.time).trim();
      var t = /^\d{1,2}:\d{2}$/.test(raw) ? parseTime_(raw) : null;
      if (t == null) throw new Error('시간을 넣어주세요.');
      var ago = daysBetween_(date, now.date);
      if (ago < 0 || ago > 14) throw new Error('정정은 오늘부터 14일 전까지의 기록만 요청할 수 있어요.');
      if (ago === 0 && t > now.min) throw new Error('아직 지나지 않은 시간이에요.');
      if (!reason) throw new Error('사유를 적어주세요. (예: 퇴근 찍는 걸 깜빡함)');
      what = (req.type === 'out' ? '퇴근 ' : '출근 ') + fmtTime_(t);
      all.forEach(function (r) {
        if (r.name === p.name && r.kind === '정정' && r.date === date && r.state === '대기' && r.what.slice(0, 2) === what.slice(0, 2)) {
          throw new Error('같은 날 ' + what.slice(0, 2) + ' 정정 요청이 이미 있어요. 먼저 보낸 요청을 취소하고 다시 보내주세요.');
        }
      });
    } else {
      var ahead = daysBetween_(now.date, date);
      if (ahead < 0 || ahead > 60) throw new Error('오늘부터 60일 안의 날짜만 고를 수 있어요.');
      var s = schedFor_(p, date);
      if (!s) throw new Error(mmdd_(date) + '은 원래 근무가 없는 날이에요.');
      if (kind === '휴무' && !reason) throw new Error('사유를 적어주세요.');
      all.forEach(function (r) {
        if (r.name === p.name && r.date === date && (r.kind === '휴무' || r.kind === '대타') && /대기|수락|승인/.test(r.state)) {
          throw new Error(mmdd_(date) + '은 이미 ' + r.kind + ' 요청이 있어요.');
        }
      });
      what = fmtTime_(s.start) + '-' + fmtTime_(s.end);
    }

    var sh = reqSheet_();
    // 번호: 시각 기반, 이미 있는 번호와 겹치면 -2, -3 … 을 붙여요
    var base = 'R' + Date.now().toString(36).toUpperCase(), id = base, n = 2;
    var taken = function (x) { return all.some(function (q) { return q.id === x; }); };
    while (taken(id)) id = base + '-' + n++;
    var r = {
      id: id,
      at: now.date + ' ' + now.time, name: p.name, kind: kind, date: date, what: what, reason: reason, state: '대기',
    };
    putReq_(sh, Math.max(sh.getLastRow(), 1) + 1, r);
    var when = mmdd_(date) + '(' + DOW[dowOf_(date)] + ')';
    if (kind === '대타') {
      notify_(set, p.name + ' · 대타 구하는 중', when + ' ' + what + (reason ? '\n사유: ' + reason : '') +
        '\n동료가 수락하면 다시 알려드려요.');
    } else {
      notify_(set, p.name + ' · ' + kind + ' 요청', when + ' ' + what + (kind === '휴무' ? ' 근무 쉬고 싶어요' : '') +
        '\n사유: ' + reason + '\n사장님 화면에서 승인해주세요.');
    }
    return reqsFor_(p.name);
  } finally {
    lock.releaseLock();
  }
}

/** 직원 화면: 동료의 대타 요청에 '제가 할게요'. */
function takeSwap(name, pin, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var set = settings_();
    var p = person_(name);
    checkPin_(p, pin);
    var r = findReq_(id);
    if (!r || r.kind !== '대타') throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.name === p.name) throw new Error('본인 요청은 수락할 수 없어요.');
    if (r.state !== '대기') throw new Error('이미 다른 사람이 수락했거나 끝난 요청이에요.');
    if (daysBetween_(nowKst_().date, r.date) < 0) throw new Error('지난 날짜예요.');
    r.state = '수락';
    r.taker = p.name;
    putReq_(reqSheet_(), r.row, r);
    var mine = schedFor_(p, r.date);
    notify_(set, '대타 수락 · 승인해주세요',
      mmdd_(r.date) + '(' + DOW[dowOf_(r.date)] + ') ' + r.name + ' ' + r.what + ' → ' + p.name + ' 님이 대신 근무' +
      (mine ? '\n※ ' + p.name + ' 님은 그날 원래 ' + fmtTime_(mine.start) + '-' + fmtTime_(mine.end) + ' 근무라서, 승인하면 두 시간을 합쳐요.' : ''));
    return reqsFor_(p.name);
  } finally {
    lock.releaseLock();
  }
}

/** 직원 화면: 내 요청 취소. 대타를 수락했던 사람이 부르면 수락만 취소돼요. */
function cancelRequest(name, pin, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var p = person_(name);
    checkPin_(p, pin);
    var r = findReq_(id);
    if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.name === p.name && (r.state === '대기' || r.state === '수락')) {
      r.state = '취소';
      r.done = nowKst_().date + ' ' + nowKst_().time;
    } else if (r.taker === p.name && r.state === '수락') {
      r.state = '대기';
      r.taker = '';
    } else {
      throw new Error('이미 처리된 요청이라 취소할 수 없어요.');
    }
    putReq_(reqSheet_(), r.row, r);
    return reqsFor_(p.name);
  } finally {
    lock.releaseLock();
  }
}

/** 사장님 화면: 요청 승인(ok=true) 또는 거절. 승인하면 기록·근무표에 바로 반영돼요. */
function adminRequest(pin, id, ok) {
  var set = adminAuth_(pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var r = findReq_(id);
    if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.state !== '대기' && r.state !== '수락') throw new Error('이미 ' + r.state + '된 요청이에요.');
    if (ok) {
      if (r.kind === '대타' && !r.taker) throw new Error('아직 대타를 해줄 동료가 없어요. 동료가 수락하면 승인할 수 있어요.');
      applyReq_(set, r);
      r.state = '승인';
    } else {
      r.state = '거절';
    }
    r.done = nowKst_().date + ' ' + nowKst_().time;
    putReq_(reqSheet_(), r.row, r);
  } finally {
    lock.releaseLock();
  }
  return adminToday(pin);
}

/* ───────────── 텔레그램 알림 연결 (사장님 화면) ───────────── */

/** 1단계: BotFather에게 받은 토큰 저장. 토큰이 맞는지 텔레그램에 물어보고 저장해요. */
function adminTelegram(pin, token) {
  adminAuth_(pin);
  token = String(token == null ? '' : token).trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new Error('토큰 모양이 이상해요. BotFather가 준 "123456789:ABC…" 모양의 토큰을 통째로 붙여넣어 주세요.');
  }
  var me = tgCall_(token, 'getMe');
  setSetting_(K.tgToken, token);
  setSetting_(K.tgChat, '');
  return { bot: me.username || '', info: info_(settings_()) };
}

/** 2단계: 봇에게 보낸 메시지로 사장님 채팅방을 찾아 저장하고, 시험 메시지를 보내요. */
function adminTelegramLink(pin) {
  var set = adminAuth_(pin);
  if (!set.tgToken) throw new Error('봇 토큰을 먼저 저장해주세요.');
  var chat = null;
  (tgCall_(set.tgToken, 'getUpdates', { limit: 100 }) || []).forEach(function (u) {
    var m = u.message || u.channel_post || u.my_chat_member;
    if (m && m.chat) chat = m.chat;
  });
  if (!chat) throw new Error('봇에게 온 메시지가 없어요. 텔레그램에서 봇에게 아무 말이나 보낸 뒤 다시 눌러주세요.');
  tgCall_(set.tgToken, 'sendMessage', {
    chat_id: chat.id, text: '✅ ' + set.store + ' 출퇴근 알림이 연결됐어요. 앞으로 알림이 여기로 와요.',
  });
  setSetting_(K.tgChat, String(chat.id));
  return info_(settings_());
}

function adminTelegramOff(pin) {
  adminAuth_(pin);
  setSetting_(K.tgToken, '');
  setSetting_(K.tgChat, '');
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

/** 10분마다 자동 실행: 출근 시간이 지났는데 안 찍은 직원이 있으면 알림을 보내요. */
function checkMissing() {
  var set = settings_();
  if (!set.email && !(set.tgToken && set.tgChat)) return;
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
  notify_(set, '아직 출근 안 찍은 직원 ' + missing.length + '명', now.date + ' ' + now.time + ' 기준\n' + missing.join('\n'));
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
  reqSheet_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'checkMissing' || h === 'sheetEdited') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMissing').timeBased().everyMinutes(10).create();
  // 따로 만든 스크립트는 시트의 onEdit이 저절로 안 불려서, 직접 연결해요.
  if (SHEET_ID) ScriptApp.newTrigger('sheetEdited').forSpreadsheet(ss).onEdit().create();

  var msg = '설정 완료! [직원] 시트에 이름·비밀번호·시급·근무시간을 넣고, [설정] 시트에서 관리자PIN을 바꿔주세요.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { console.log(msg); }
  return msg;
}

/* ───────────── 내부 함수 ───────────── */

function book_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

/** 따로 만든 스크립트에서 시트를 고쳤을 때 불려요 (setup이 연결). */
function sheetEdited(e) { onEdit(e); }

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
    tgToken: map[K.tgToken] || '',
    tgChat: map[K.tgChat] || '',
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

/** 거절: [의심기록]에 남기고(필요하면 사장님께 알림), 직원 화면에는 msg를 보여줘요. */
function deny_(set, name, kind, detail, msg, alert) {
  logSuspect_(name, kind, detail);
  if (alert) notify_(set, name + ' · ' + kind, detail + '\n사장님 화면 [오늘] 탭에서 확인하세요.');
  throw new Error(msg);
}

/**
 * 사장님께 알림: 텔레그램이 연결돼 있으면 텔레그램으로, 아니면(또는 실패하면) 메일로 보내요.
 * 보냈으면 true.
 */
function notify_(set, title, body) {
  var now = nowKst_();
  var url = adminUrl_();
  var text = mmdd_(now.date) + ' ' + now.time + '\n' + body + (url ? '\n\n사장님 화면: ' + url : '');
  if (set.tgToken && set.tgChat) {
    try {
      tgCall_(set.tgToken, 'sendMessage', {
        chat_id: set.tgChat, text: '[' + set.store + ' 출퇴근] ' + title + '\n' + text, disable_web_page_preview: true,
      });
      return true;
    } catch (err) { console.error(err); }
  }
  if (set.email) {
    try {
      MailApp.sendEmail(set.email, '[' + set.store + ' 출퇴근] ' + title, text + '\n시트: ' + book_().getUrl());
      return true;
    } catch (err) { console.error(err); }
  }
  return false;
}

function tgCall_(token, method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true,
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (err) { /* 아래에서 처리 */ }
  if (!body.ok) throw new Error('텔레그램 오류: ' + (body.description || ('HTTP ' + res.getResponseCode())));
  return body.result;
}

function adminUrl_() {
  try { var u = ScriptApp.getService().getUrl(); return u ? u + '?page=admin' : ''; } catch (err) { return ''; }
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

/* ───── 요청 시트 ───── */

function reqSheet_() {
  return ensureSheet_(book_(), SHEETS.req, REQ_HEAD, [], REQ_HEAD.map(function () { return '@'; }));
}

function readReqs_() {
  var sh = reqSheet_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, REQ_HEAD.length).getDisplayValues().map(function (v, i) {
    return {
      row: i + 2, id: String(v[R.id]).trim(), at: v[R.at], name: String(v[R.name]).trim(), kind: String(v[R.kind]).trim(),
      date: parseDate_(v[R.date]), what: String(v[R.what]).trim(), reason: v[R.reason], state: String(v[R.state]).trim(),
      taker: String(v[R.taker] == null ? '' : v[R.taker]).trim(), done: v[R.done],
    };
  }).filter(function (r) { return r.id; });
}

function findReq_(id) {
  id = String(id == null ? '' : id).trim();
  var all = readReqs_();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function putReq_(sh, row, r) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var rg = sh.getRange(row, 1, 1, REQ_HEAD.length);
  rg.setNumberFormats([REQ_HEAD.map(function () { return '@'; })]);
  rg.setValues([[r.id, r.at, r.name, r.kind, r.date, r.what, r.reason || '', r.state, r.taker || '', r.done || '']]);
}

function reqView_(r, withReason) {
  return {
    id: r.id, name: r.name, kind: r.kind, date: r.date, dow: DOW[dowOf_(r.date)], what: r.what,
    reason: withReason ? r.reason : '', state: r.state, taker: r.taker, at: r.at,
  };
}

function reqsFor_(name) {
  var today = nowKst_().date;
  var all = readReqs_();
  return {
    mine: all.filter(function (r) { return r.name === name || r.taker === name; })
      .slice(-20).reverse().map(function (r) { return reqView_(r, r.name === name); }),
    swaps: all.filter(function (r) {
      return r.kind === '대타' && r.state === '대기' && r.name !== name && r.date >= today;
    }).map(function (r) { return reqView_(r, false); }),
  };
}

function openReqsForAdmin_(today) {
  var people = staff_();
  return readReqs_().filter(function (r) { return r.state === '대기' || r.state === '수락'; }).map(function (r) {
    var v = reqView_(r, true);
    if (r.kind === '정정') {
      var f = findLog_(sheet_(SHEETS.log), r.date, r.name);
      var col = r.what.indexOf('퇴근') === 0 ? C.tOut : C.tIn;
      v.before = f ? fmtTime_(parseTime_(f.vals[col])) : '';
    }
    if (r.kind === '대타' && r.taker) {
      var b = null;
      people.forEach(function (x) { if (x.name === r.taker) b = x; });
      var s = b ? schedFor_(b, r.date) : null;
      if (s) v.note = r.taker + ' 님은 그날 원래 ' + fmtTime_(s.start) + '-' + fmtTime_(s.end) + ' 근무라서 두 시간을 합쳐요';
    }
    v.past = r.kind !== '정정' && r.date < today;
    return v;
  });
}

/** 승인된 요청을 기록과 근무표에 반영해요. */
function applyReq_(set, r) {
  var people = staff_();
  function find(n) { var p = null; people.forEach(function (x) { if (x.name === n) p = x; }); return p; }

  if (r.kind === '정정') {
    var m = /^(출근|퇴근)\s+(\d{1,2}:\d{2})/.exec(r.what);
    if (!m) throw new Error('요청 내용이 이상해요: ' + r.what);
    var p = find(r.name);
    var sh = sheet_(SHEETS.log);
    var f = findLog_(sh, r.date, r.name);
    var row, v;
    if (f) {
      row = f.row;
      v = f.vals.slice();
    } else {
      var s = p ? schedFor_(p, r.date) : null;
      row = Math.max(sh.getLastRow(), 1) + 1;
      v = [r.date, DOW[dowOf_(r.date)], r.name, s ? fmtTime_(s.start) : '', s ? fmtTime_(s.end) : '',
        '', '', '', '', '', '', '', '', ''];
    }
    var col = m[1] === '출근' ? C.tIn : C.tOut;
    var before = fmtTime_(parseTime_(v[col]));
    v[col] = m[2];
    v[C.memo] = addMemo_(v[C.memo], '정정 승인: ' + m[1] + ' ' + m[2] + (before ? '(이전 ' + before + ')' : '') +
      (r.reason ? ' ' + r.reason : ''));
    applyCalc_(v, p ? p.wage : 0, set.grace);
    writeLog_(sh, row, v);
    return;
  }

  if (r.kind === '휴무') {
    addChange_(set, r.date, r.name, '휴무', '휴무 승인' + (r.reason ? ': ' + r.reason : ''));
    return;
  }

  // 대타: 요청한 사람은 휴무, 대타는 그 시간을 맡아요(원래 근무가 있으면 두 시간을 합쳐요).
  var a = parseSchedule_(r.what);
  var b = find(r.taker);
  if (!a || !b) throw new Error('대타 정보가 이상해요. 시트 [요청] 탭을 확인해주세요.');
  var sb = schedFor_(b, r.date);
  var start = sb ? Math.min(sb.start, a.start) : a.start;
  var end = sb ? Math.max(sb.end, a.end) : a.end;
  addChange_(set, r.date, r.name, '휴무', '대타: ' + r.taker + ' 님이 대신 근무');
  addChange_(set, r.date, r.taker, fmtTime_(start) + '-' + fmtTime_(end),
    r.name + ' 님 대신 대타' + (sb ? ' (원래 ' + fmtTime_(sb.start) + '-' + fmtTime_(sb.end) + ' 근무와 합침)' : ''));
}

/** [근무변경]에 한 줄 추가. 그날 출퇴근기록이 이미 있으면 예정 시간도 바꾸고 다시 계산해요. */
function addChange_(set, date, name, text, memo) {
  var sh = sheet_(SHEETS.change);
  var row = Math.max(sh.getLastRow(), 1) + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var rg = sh.getRange(row, 1, 1, CHANGE_HEAD.length);
  rg.setNumberFormats([['@', '@', '@', '@']]);
  rg.setValues([[date, name, text, memo]]);

  var log = sheet_(SHEETS.log);
  var f = findLog_(log, date, name);
  if (!f) return;
  var s = parseSchedule_(text);
  var v = f.vals.slice();
  v[C.sIn] = s ? fmtTime_(s.start) : '';
  v[C.sOut] = s ? fmtTime_(s.end) : '';
  var p = null;
  staff_().forEach(function (x) { if (x.name === name) p = x; });
  applyCalc_(v, p ? p.wage : 0, set.grace);
  writeLog_(log, f.row, v);
}

function daysBetween_(from, to) {
  var a = from.split('-').map(Number), b = to.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5);
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
    tg: set.tgToken ? (set.tgChat ? '연결됨' : '토큰만') : '',
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

/* ───────────── 화면 HTML (Index.html, Admin.html 를 그대로 담음) ───────────── */
var PAGES = {
  Index: "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>출퇴근</title>\n<style>\n  :root {\n    --bg: #f4f5f7; --card: #ffffff; --text: #15171c; --muted: #6b7280; --line: #e4e7ec;\n    --chip: #eef1f5; --in: #0b8a4c; --in-bg: #e7f6ee; --out: #2557d6; --out-bg: #e9effd;\n    --warn: #b45309; --warn-bg: #fdf3e3; --bad: #c62828; --bad-bg: #fdecec;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --bg: #0f1115; --card: #181b21; --text: #eceef2; --muted: #9aa1ad; --line: #2a2f38;\n      --chip: #22262e; --in: #3ccf86; --in-bg: #14271d; --out: #7aa2ff; --out-bg: #18213a;\n      --warn: #f2b45a; --warn-bg: #2b2215; --bad: #ff7b7b; --bad-bg: #2d1717;\n    }\n  }\n  * { box-sizing: border-box; }\n  body {\n    margin: 0; background: var(--bg); color: var(--text);\n    font: 16px/1.5 -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", \"Noto Sans KR\", \"Malgun Gothic\", sans-serif;\n    -webkit-tap-highlight-color: transparent;\n  }\n  .wrap { max-width: 440px; margin: 0 auto; padding: 20px 16px 40px; }\n  header { text-align: center; padding: 8px 0 20px; }\n  .store { font-size: 15px; font-weight: 600; color: var(--muted); }\n  .clock { font-size: 52px; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; line-height: 1.15; }\n  .date { color: var(--muted); }\n  .card { background: var(--card); border-radius: 18px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04); }\n  h2 { font-size: 17px; margin: 0 0 14px; }\n  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }\n  .name {\n    height: 56px; border: 1px solid var(--line); background: var(--card); color: var(--text);\n    border-radius: 14px; font: inherit; font-size: 18px; font-weight: 600;\n  }\n  .name:active { background: var(--chip); }\n  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n  .who { font-size: 22px; font-weight: 700; }\n  .link { background: none; border: 0; color: var(--out); font: inherit; font-size: 15px; padding: 6px 0; cursor: pointer; }\n  .today { margin: 6px 0 16px; color: var(--muted); }\n  .today b { color: var(--text); font-weight: 600; }\n  label.pin { display: block; font-size: 14px; color: var(--muted); margin-bottom: 6px; }\n  input.pin {\n    width: 100%; height: 52px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg);\n    color: var(--text); font-size: 24px; letter-spacing: 8px; text-align: center; font-family: inherit;\n  }\n  input.pin:focus { outline: 2px solid var(--out); border-color: transparent; }\n  .check { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--muted); margin: 10px 0 0; }\n  .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }\n  .big {\n    height: 96px; border: 0; border-radius: 18px; font: inherit; font-size: 26px; font-weight: 700;\n    color: #fff; cursor: pointer; transition: transform .05s, opacity .2s;\n  }\n  .big:active { transform: scale(.98); }\n  .big.in { background: var(--in); }\n  .big.out { background: var(--out); }\n  .big:disabled { opacity: .3; }\n  .result { margin-top: 16px; border-radius: 14px; padding: 14px 16px; }\n  .result .t { font-size: 20px; font-weight: 700; }\n  .result.ok { background: var(--in-bg); color: var(--in); }\n  .result.warn { background: var(--warn-bg); color: var(--warn); }\n  .result.bad { background: var(--bad-bg); color: var(--bad); }\n  .result.busy { background: var(--chip); color: var(--muted); }\n  .mine-btn { display: block; margin: 18px auto 0; }\n  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }\n  .chip { background: var(--chip); border-radius: 999px; padding: 4px 10px; font-size: 13px; }\n  .chip.red { background: var(--bad-bg); color: var(--bad); }\n  table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }\n  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 6px 4px; border-bottom: 1px solid var(--line); }\n  td { padding: 8px 4px; border-bottom: 1px solid var(--line); }\n  td.late { color: var(--bad); }\n  .memo { font-size: 12px; color: var(--muted); }\n  .note { text-align: center; color: var(--muted); font-size: 14px; margin-top: 16px; }\n  .inapp { background: var(--warn-bg); color: var(--warn); border-radius: 14px; padding: 12px 14px; font-size: 14px; margin-bottom: 14px; }\n  #reqCard { margin-top: 14px; }\n  h3 { font-size: 14px; color: var(--muted); font-weight: 600; margin: 20px 0 6px; }\n  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: var(--chip); border-radius: 12px; padding: 4px; }\n  .seg button { height: 40px; border: 0; background: none; border-radius: 9px; font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); cursor: pointer; }\n  .seg button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.08); }\n  .hint { color: var(--muted); font-size: 13px; margin: 12px 0 0; }\n  .f { margin-top: 12px; }\n  .f > label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }\n  .f input[type=text], .f input[type=date], .f input[type=time], .f select {\n    width: 100%; height: 46px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--text);\n    font: inherit; font-size: 16px; padding: 0 12px; -webkit-appearance: none; appearance: none;\n  }\n  .radios { display: flex; gap: 18px; height: 40px; align-items: center; }\n  .radios label { display: flex; gap: 6px; align-items: center; font-size: 16px; }\n  .send { width: 100%; height: 50px; margin-top: 14px; border: 0; border-radius: 12px; background: var(--out); color: #fff; font: inherit; font-weight: 700; font-size: 16px; cursor: pointer; }\n  .send:disabled { opacity: .5; }\n  .rmsg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; font-size: 14px; background: var(--in-bg); color: var(--in); }\n  .rmsg.bad { background: var(--bad-bg); color: var(--bad); }\n  .item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 15px; }\n  .item:last-child { border-bottom: 0; }\n  .item .what { flex: 1; min-width: 0; }\n  .item .sub { font-size: 12px; color: var(--muted); }\n  .sbtn { height: 36px; padding: 0 12px; border: 0; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }\n  .sbtn.go { background: var(--out); color: #fff; }\n  .sbtn.ghost { background: var(--chip); color: var(--text); }\n  .swapbox { background: var(--out-bg); border-radius: 14px; padding: 4px 14px; margin-bottom: 14px; }\n  .swapbox .t { font-size: 13px; font-weight: 700; color: var(--out); padding-top: 8px; }\n  .badge { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--chip); color: var(--muted); white-space: nowrap; }\n  .badge.wait { background: var(--warn-bg); color: var(--warn); }\n  .badge.ok { background: var(--in-bg); color: var(--in); }\n  .badge.no { background: var(--bad-bg); color: var(--bad); }\n  [hidden] { display: none !important; }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n  <header>\n    <div class=\"store\" id=\"store\">출퇴근</div>\n    <div class=\"clock\" id=\"clock\">--:--:--</div>\n    <div class=\"date\" id=\"date\">&nbsp;</div>\n  </header>\n\n  <div class=\"inapp\" id=\"inapp\" hidden>\n    <b>카톡 안에서 열렸어요.</b> 카톡 안에서 찍으면 나중에 사파리·크롬으로 열었을 때 \"새 폰\"으로 인식될 수 있어요.\n    오른쪽 위(또는 아래) <b>⋯ → 다른 브라우저로 열기</b>를 누른 뒤, 그 브라우저에서 <b>홈 화면에 추가</b>해서 쓰세요.\n  </div>\n\n  <section class=\"card\" id=\"pick\" hidden>\n    <h2>본인 이름을 눌러주세요</h2>\n    <div class=\"grid\" id=\"names\"></div>\n  </section>\n\n  <section class=\"card\" id=\"me\" hidden>\n    <div class=\"row\">\n      <div class=\"who\" id=\"who\"></div>\n      <button class=\"link\" id=\"change\">다른 사람</button>\n    </div>\n    <div class=\"today\" id=\"today\">&nbsp;</div>\n\n    <div id=\"pinBox\">\n      <label class=\"pin\" for=\"pin\">비밀번호</label>\n      <input class=\"pin\" id=\"pin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]*\" maxlength=\"8\" autocomplete=\"off\">\n      <label class=\"check\"><input type=\"checkbox\" id=\"remember\" checked> 이 폰에서 비밀번호 기억하기</label>\n    </div>\n\n    <div class=\"btns\">\n      <button class=\"big in\" id=\"btnIn\">출근</button>\n      <button class=\"big out\" id=\"btnOut\">퇴근</button>\n    </div>\n\n    <div class=\"result\" id=\"result\" hidden><div class=\"t\" id=\"rt\"></div><div id=\"rs\"></div></div>\n\n    <button class=\"link mine-btn\" id=\"mineBtn\">이번 달 내 기록 보기</button>\n    <div id=\"mine\" hidden></div>\n  </section>\n\n  <section class=\"card\" id=\"reqCard\" hidden>\n    <h2>요청 · 대타</h2>\n    <div id=\"swaps\"></div>\n    <div class=\"seg\" id=\"kinds\">\n      <button data-kind=\"fix\">기록 정정</button>\n      <button data-kind=\"off\">휴무 신청</button>\n      <button data-kind=\"swap\">대타 구하기</button>\n    </div>\n    <form id=\"reqForm\" hidden>\n      <p class=\"hint\" id=\"fHint\"></p>\n      <div class=\"f\" id=\"wDateFix\"><label for=\"fDateFix\">날짜</label><select id=\"fDateFix\"></select></div>\n      <div class=\"f\" id=\"wDate\"><label for=\"fDate\">날짜</label><input type=\"date\" id=\"fDate\"></div>\n      <div class=\"f\" id=\"wType\">\n        <label>무엇을</label>\n        <div class=\"radios\">\n          <label><input type=\"radio\" name=\"ftype\" value=\"in\"> 출근</label>\n          <label><input type=\"radio\" name=\"ftype\" value=\"out\" checked> 퇴근</label>\n        </div>\n      </div>\n      <div class=\"f\" id=\"wTime\"><label for=\"fTime\">실제 시간</label><input type=\"time\" id=\"fTime\"></div>\n      <div class=\"f\"><label for=\"fReason\" id=\"fReasonLabel\">사유</label><input type=\"text\" id=\"fReason\" maxlength=\"100\"></div>\n      <button class=\"send\" id=\"fSend\" type=\"submit\">요청 보내기</button>\n    </form>\n    <p class=\"rmsg\" id=\"reqMsg\" hidden></p>\n    <h3>내 요청</h3>\n    <div id=\"myReqs\"><p class=\"hint\">불러오는 중…</p></div>\n  </section>\n\n  <p class=\"note\" id=\"note\" hidden></p>\n</main>\n\n<script>\n  var $ = function (id) { return document.getElementById(id); };\n  var mem = {\n    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },\n    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },\n  };\n  var S = { info: null, me: null, today: null, busy: false };\n\n  function call(fn) {\n    var args = Array.prototype.slice.call(arguments, 1);\n    return new Promise(function (ok, no) {\n      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) {\n        no(new Error((e && e.message) || String(e)));\n      });\n      r[fn].apply(r, args);\n    });\n  }\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n  /* 이 폰의 고유 번호: 처음 열 때 한 번 만들어서 폰에 저장해요. 저장이 안 되는 브라우저면 ''. */\n  function deviceId() {\n    var id = mem.get('att:device');\n    if (id && /^[0-9a-f]{16}$/.test(id)) return id;\n    try {\n      var a = new Uint8Array(8);\n      crypto.getRandomValues(a);\n      id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');\n    } catch (e) { return ''; }\n    mem.set('att:device', id);\n    return mem.get('att:device') === id ? id : '';\n  }\n  function deviceLabel() {\n    var ua = navigator.userAgent;\n    var os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' :\n      /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '기타';\n    var br = /KAKAOTALK/i.test(ua) ? '카톡' : /NAVER/.test(ua) ? '네이버앱' : /SamsungBrowser/.test(ua) ? '삼성인터넷' :\n      /CriOS|Chrome/.test(ua) ? '크롬' : /Safari/.test(ua) ? '사파리' : '브라우저';\n    var standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);\n    return os + ' ' + br + (standalone ? '(홈화면)' : '');\n  }\n  var IN_APP = /KAKAOTALK|NAVER\\(inapp|Instagram|FBAN|FBAV|Line\\//i.test(navigator.userAgent);\n\n  function toMin(t) { var m = /^(\\d{1,2}):(\\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }\n  function nowMin() {\n    var p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date());\n    return toMin(p);\n  }\n  function hm(min) {\n    min = Math.round(min || 0);\n    var h = Math.floor(min / 60), m = min % 60;\n    return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';\n  }\n  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }\n\n  function tick() {\n    var d = new Date();\n    $('clock').textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });\n    $('date').textContent = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' });\n  }\n\n  function show(id) {\n    $('pick').hidden = id !== 'pick';\n    $('me').hidden = id !== 'me';\n    $('reqCard').hidden = id !== 'me';\n  }\n  function note(text) { $('note').hidden = !text; $('note').textContent = text || ''; }\n\n  function result(kind, title, sub) {\n    var box = $('result');\n    box.className = 'result ' + kind;\n    box.hidden = false;\n    $('rt').textContent = title;\n    $('rs').textContent = sub || '';\n  }\n\n  function renderNames() {\n    var list = S.info.staff;\n    $('names').innerHTML = list.length\n      ? list.map(function (p) { return '<button class=\"name\" data-name=\"' + esc(p.name) + '\">' + esc(p.name) + '</button>'; }).join('')\n      : '<p class=\"note\">[직원] 시트에 이름을 먼저 넣어주세요.</p>';\n  }\n\n  function pick(name) {\n    var p = null;\n    S.info.staff.forEach(function (x) { if (x.name === name) p = x; });\n    if (!p) return show('pick');\n    S.me = p;\n    S.today = null;\n    mem.set('att:name', name);\n    $('who').textContent = name;\n    $('pinBox').hidden = !p.pin;\n    $('pin').value = mem.get('att:pin:' + name) || '';\n    $('result').hidden = true;\n    $('mine').hidden = true;\n    show('me');\n    loadToday();\n    closeForm();\n    REQ.data = null;\n    loadReqs();\n  }\n\n  function loadToday() {\n    $('today').textContent = '오늘 기록 불러오는 중…';\n    return call('getToday', S.me.name).then(function (t) {\n      S.today = t;\n      renderToday();\n    }).catch(function (e) { $('today').textContent = e.message; });\n  }\n\n  function renderToday() {\n    var t = S.today;\n    var parts = [t.sIn ? '오늘 근무 <b>' + esc(t.sIn) + ' ~ ' + esc(t.sOut) + '</b>' : '오늘은 근무표에 없는 날이에요'];\n    if (t.tIn) parts.push('출근 <b>' + esc(t.tIn) + '</b>');\n    if (t.tOut) parts.push('퇴근 <b>' + esc(t.tOut) + '</b>');\n    $('today').innerHTML = parts.join(' · ');\n    $('btnIn').disabled = !!t.tIn;\n    $('btnOut').disabled = false;\n  }\n\n  function locate() {\n    return new Promise(function (ok, no) {\n      if (!navigator.geolocation) return no({ code: 0 });\n      navigator.geolocation.getCurrentPosition(function (p) {\n        ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });\n      }, no, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });\n    });\n  }\n  function geoError(e) {\n    if (e && e.code === 1) return ['위치 권한이 꺼져 있어요', '휴대폰 설정에서 이 브라우저의 위치 권한을 \"허용\"으로 바꾼 뒤 다시 눌러주세요.'];\n    if (e && e.code === 3) return ['위치 확인이 오래 걸려요', '창가 쪽에서 잠시 후 다시 눌러주세요.'];\n    return ['위치를 확인하지 못했어요', '휴대폰 위치(GPS)를 켜고 다시 눌러주세요.'];\n  }\n\n  function setBusy(on) {\n    S.busy = on;\n    $('btnIn').disabled = on || !!(S.today && S.today.tIn);\n    $('btnOut').disabled = on;\n  }\n\n  function punch(type) {\n    if (S.busy) return;\n    var pin = $('pin').value.trim();\n    if (S.me.pin && !pin) { result('bad', '비밀번호를 넣어주세요'); $('pin').focus(); return; }\n    var t = S.today;\n    if (type === 'out' && t && t.sOut && !t.tOut) {\n      var end = toMin(t.sOut), now = nowMin();\n      if (end != null && now != null && now < end &&\n          !confirm('퇴근 예정 시간(' + t.sOut + ')보다 일찍이에요.\\n지금 퇴근을 찍을까요?')) return;\n    }\n    if (type === 'out' && t && t.tOut &&\n        !confirm('오늘 ' + t.tOut + '에 이미 퇴근을 찍었어요.\\n지금 시간으로 다시 찍을까요?')) return;\n\n    setBusy(true);\n    var label = type === 'in' ? '출근' : '퇴근';\n    var getPos = S.info.mode === '안함' ? Promise.resolve(null) : (result('busy', '위치 확인 중…'), locate());\n    getPos.then(function (pos) { return pos; }, function (err) {\n      if (S.info.mode === '필수') { var m = geoError(err); throw new Error(m[0] + '\\n' + m[1]); }\n      return null;\n    }).then(function (pos) {\n      result('busy', label + ' 기록 중…');\n      return call('punch', {\n        name: S.me.name, pin: pin, type: type,\n        lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, acc: pos ? pos.acc : null,\n        device: deviceId(), label: deviceLabel(),\n      });\n    }).then(function (r) {\n      mem.set('att:pin:' + S.me.name, $('remember').checked && pin ? pin : null);\n      S.today = r.today;\n      var sub;\n      if (r.type === 'in') {\n        sub = r.late ? r.late + '분 지각으로 기록됐어요.' : '정상 출근으로 기록됐어요.';\n      } else {\n        sub = r.work != null ? '오늘 ' + hm(r.work) + ' 근무했어요.' : '출근 기록이 없어서 사장님께 표시돼요.';\n        if (r.early) sub += ' (예정보다 ' + r.early + '분 일찍 퇴근)';\n      }\n      result(r.late || r.early ? 'warn' : 'ok', label + ' 완료 · ' + r.time, sub);\n      if (!$('mine').hidden) loadMine();\n      if (!REQ.data) loadReqs();\n    }).catch(function (e) {\n      // 첫 문장은 크게, 나머지는 작게\n      var msg = String(e.message);\n      var m = /^(.+?[.!?])[\\s\\n]+([\\s\\S]+)$/.exec(msg) || /^(.+?)\\n([\\s\\S]+)$/.exec(msg);\n      if (!m) return result('bad', msg);\n      result('bad', m[1], m[2].replace(/\\n/g, ' '));\n    }).then(function () {\n      setBusy(false);\n      if (S.today) renderToday();\n    });\n  }\n\n  function loadMine() {\n    var box = $('mine');\n    box.hidden = false;\n    box.innerHTML = '<p class=\"note\">불러오는 중…</p>';\n    call('getMyMonth', S.me.name, $('pin').value.trim(), '').then(function (r) {\n      var t = r.total;\n      var chips = [\n        '근무 ' + t.days + '일', '총 ' + hm(t.work),\n        '<span class=\"chip' + (t.lateCount ? ' red' : '') + '\">지각 ' + t.lateCount + '회' + (t.lateMin ? ' · ' + t.lateMin + '분' : '') + '</span>',\n      ];\n      if (t.deduct) chips.push('<span class=\"chip red\">차감 ' + won(t.deduct) + '</span>');\n      var html = '<div class=\"chips\">' + chips.map(function (c) { return c.indexOf('<span') === 0 ? c : '<span class=\"chip\">' + c + '</span>'; }).join('') + '</div>';\n      if (!r.rows.length) return (box.innerHTML = html + '<p class=\"note\">이번 달 기록이 아직 없어요.</p>');\n      html += '<table><thead><tr><th>날짜</th><th>출근</th><th>퇴근</th><th>지각</th></tr></thead><tbody>';\n      r.rows.slice().reverse().forEach(function (x) {\n        html += '<tr><td>' + esc(x.date.slice(5).replace('-', '/')) + ' ' + esc(x.dow) +\n          (x.memo ? '<div class=\"memo\">' + esc(x.memo) + '</div>' : '') + '</td><td>' + esc(x.tIn || '-') + '</td><td>' +\n          esc(x.tOut || '-') + '</td><td class=\"' + (x.late ? 'late' : '') + '\">' + (x.late ? x.late + '분' : '') + '</td></tr>';\n      });\n      box.innerHTML = html + '</tbody></table>';\n    }).catch(function (e) { box.innerHTML = '<p class=\"note\">' + esc(e.message) + '</p>'; });\n  }\n\n  $('names').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-name]');\n    if (b) pick(b.getAttribute('data-name'));\n  });\n  $('change').addEventListener('click', function () { mem.set('att:name', null); show('pick'); });\n  $('btnIn').addEventListener('click', function () { punch('in'); });\n  $('btnOut').addEventListener('click', function () { punch('out'); });\n  $('mineBtn').addEventListener('click', function () {\n    if ($('mine').hidden) loadMine(); else $('mine').hidden = true;\n  });\n\n  /* ───── 요청 · 대타 ───── */\n  var REQ = { kind: '', data: null };\n  var KIND = { '정정': '기록 정정', '휴무': '휴무', '대타': '대타' };\n\n  function kstDate(plusDays) {\n    return new Date(Date.now() + 9 * 3600e3 + (plusDays || 0) * 864e5).toISOString().slice(0, 10);\n  }\n  function dayLabel(date) {\n    var p = date.split('-').map(Number);\n    var dow = '일월화수목금토'.charAt(new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay());\n    return p[1] + '/' + p[2] + '(' + dow + ')';\n  }\n  function reqMsg(text, bad) {\n    $('reqMsg').hidden = !text;\n    $('reqMsg').className = 'rmsg' + (bad ? ' bad' : '');\n    $('reqMsg').textContent = text || '';\n  }\n\n  function loadReqs() {\n    var pin = $('pin').value.trim();\n    if (S.me.pin && !pin) {\n      $('myReqs').innerHTML = '<p class=\"hint\">비밀번호를 넣으면 내 요청과 대타 구함이 보여요.</p>';\n      $('swaps').innerHTML = '';\n      return;\n    }\n    call('getRequests', S.me.name, pin).then(renderReqs).catch(function (e) {\n      $('myReqs').innerHTML = '<p class=\"hint\">' + esc(e.message) + '</p>';\n    });\n  }\n\n  function stateBadge(r) {\n    var me = S.me.name;\n    if (r.state === '대기') return '<span class=\"badge wait\">' + (r.kind === '대타' ? '대타 구하는 중' : '승인 대기') + '</span>';\n    if (r.state === '수락') return '<span class=\"badge wait\">' + (r.name === me ? esc(r.taker) + ' 수락 · 승인 대기' : '내가 대타 · 승인 대기') + '</span>';\n    if (r.state === '승인') return '<span class=\"badge ok\">승인' + (r.taker === me ? ' · 내가 대타' : '') + '</span>';\n    if (r.state === '거절') return '<span class=\"badge no\">거절</span>';\n    return '<span class=\"badge\">' + esc(r.state) + '</span>';\n  }\n\n  function renderReqs(d) {\n    REQ.data = d;\n    var me = S.me.name;\n    $('swaps').innerHTML = d.swaps.length ? '<div class=\"swapbox\"><div class=\"t\">동료가 대타를 구해요</div>' + d.swaps.map(function (r) {\n      return '<div class=\"item\"><div class=\"what\"><b>' + dayLabel(r.date) + '</b> ' + esc(r.what) +\n        '<div class=\"sub\">' + esc(r.name) + ' 님 대신</div></div>' +\n        '<button class=\"sbtn go\" data-take=\"' + esc(r.id) + '\">제가 할게요</button></div>';\n    }).join('') + '</div>' : '';\n    $('myReqs').innerHTML = d.mine.length ? d.mine.map(function (r) {\n      var what = r.kind === '정정' ? r.what : r.what + (r.kind === '휴무' ? ' 휴무' : ' 대타');\n      var who = r.name === me ? '' : '<div class=\"sub\">' + esc(r.name) + ' 님 대신 근무</div>';\n      var canCancel = (r.name === me && (r.state === '대기' || r.state === '수락')) || (r.taker === me && r.state === '수락');\n      return '<div class=\"item\"><div class=\"what\"><b>' + esc(KIND[r.kind] || r.kind) + '</b> ' + dayLabel(r.date) + ' ' + esc(what) +\n        who + (r.reason ? '<div class=\"sub\">' + esc(r.reason) + '</div>' : '') + '<div style=\"margin-top:4px\">' + stateBadge(r) + '</div></div>' +\n        (canCancel ? '<button class=\"sbtn ghost\" data-cancel=\"' + esc(r.id) + '\">' + (r.name === me ? '취소' : '수락 취소') + '</button>' : '') + '</div>';\n    }).join('') : '<p class=\"hint\">아직 보낸 요청이 없어요.</p>';\n  }\n\n  var HINT = {\n    fix: '출근이나 퇴근을 깜빡했거나 잘못 찍었을 때 실제 시간을 알려주세요. 사장님이 승인하면 기록이 고쳐져요.',\n    off: '쉬고 싶은 날을 골라주세요. 사장님이 승인하면 그날 근무가 휴무로 바뀌어요.',\n    swap: '대신 일해줄 동료를 구해요. 동료가 [제가 할게요]를 누르고 사장님이 승인하면 근무표가 바뀌어요.',\n  };\n  function openForm(kind) {\n    if (REQ.kind === kind) return closeForm();\n    REQ.kind = kind;\n    Array.prototype.forEach.call(document.querySelectorAll('#kinds button'), function (b) {\n      b.classList.toggle('on', b.getAttribute('data-kind') === kind);\n    });\n    var fix = kind === 'fix';\n    $('reqForm').hidden = false;\n    $('fHint').textContent = HINT[kind];\n    $('wDateFix').hidden = !fix;\n    $('wType').hidden = !fix;\n    $('wTime').hidden = !fix;\n    $('wDate').hidden = fix;\n    if (fix) {\n      var opts = '';\n      for (var i = 0; i <= 14; i++) {\n        var d = kstDate(-i);\n        opts += '<option value=\"' + d + '\">' + dayLabel(d) + (i === 0 ? ' 오늘' : i === 1 ? ' 어제' : '') + '</option>';\n      }\n      $('fDateFix').innerHTML = opts;\n      $('fTime').value = '';\n    } else {\n      $('fDate').min = kstDate(0);\n      $('fDate').max = kstDate(60);\n      $('fDate').value = kstDate(1);\n    }\n    $('fReasonLabel').textContent = kind === 'swap' ? '사유 (선택, 사장님만 봐요)' : '사유 (사장님만 봐요)';\n    $('fReason').placeholder = { fix: '예: 퇴근 찍는 걸 깜빡함', off: '예: 병원 예약', swap: '예: 집안 행사' }[kind];\n    $('fReason').value = '';\n    $('fSend').textContent = kind === 'swap' ? '대타 구하기' : '요청 보내기';\n    reqMsg('');\n  }\n  function closeForm() {\n    REQ.kind = '';\n    $('reqForm').hidden = true;\n    Array.prototype.forEach.call(document.querySelectorAll('#kinds button'), function (b) { b.classList.remove('on'); });\n  }\n\n  $('kinds').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-kind]');\n    if (b) openForm(b.getAttribute('data-kind'));\n  });\n  $('reqForm').addEventListener('submit', function (e) {\n    e.preventDefault();\n    var pin = $('pin').value.trim();\n    if (S.me.pin && !pin) { reqMsg('위에 비밀번호를 먼저 넣어주세요.', true); return; }\n    var kind = REQ.kind;\n    var typeEl = document.querySelector('input[name=ftype]:checked');\n    var body = {\n      name: S.me.name, pin: pin, kind: kind,\n      date: kind === 'fix' ? $('fDateFix').value : $('fDate').value,\n      type: typeEl ? typeEl.value : 'out', time: $('fTime').value, reason: $('fReason').value,\n    };\n    $('fSend').disabled = true;\n    call('makeRequest', body).then(function (d) {\n      renderReqs(d);\n      closeForm();\n      reqMsg(kind === 'swap' ? '대타 구함을 올렸어요. 동료가 수락하고 사장님이 승인하면 근무표가 바뀌어요.'\n        : '요청을 보냈어요. 사장님이 승인하면 반영돼요.');\n    }).catch(function (err) { reqMsg(err.message, true); })\n      .then(function () { $('fSend').disabled = false; });\n  });\n  $('reqCard').addEventListener('click', function (e) {\n    var t = e.target.closest('[data-take],[data-cancel]');\n    if (!t) return;\n    var pin = $('pin').value.trim();\n    var take = t.hasAttribute('data-take');\n    var id = t.getAttribute(take ? 'data-take' : 'data-cancel');\n    if (!confirm(take ? '이 날 대신 근무할까요? 사장님이 승인하면 근무표가 바뀌어요.' : '이 요청을 취소할까요?')) return;\n    t.disabled = true;\n    call(take ? 'takeSwap' : 'cancelRequest', S.me.name, pin, id).then(function (d) {\n      renderReqs(d);\n      reqMsg(take ? '대타를 수락했어요. 사장님이 승인하면 근무표가 바뀌어요.' : '취소했어요.');\n    }).catch(function (err) { t.disabled = false; reqMsg(err.message, true); });\n  });\n  $('pin').addEventListener('change', function () { if (!REQ.data) loadReqs(); });\n\n  tick();\n  setInterval(tick, 1000);\n  $('inapp').hidden = !IN_APP;\n  call('getStaffList').then(function (info) {\n    S.info = info;\n    $('store').textContent = info.store;\n    document.title = info.store + ' 출퇴근';\n    renderNames();\n    var saved = mem.get('att:name');\n    if (saved && info.staff.some(function (p) { return p.name === saved; })) pick(saved);\n    else show('pick');\n  }).catch(function (e) { note(e.message); });\n</script>\n</body>\n</html>\n",
  Admin: "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>출퇴근 관리</title>\n<style>\n  :root {\n    --bg: #f4f5f7; --card: #ffffff; --text: #15171c; --muted: #6b7280; --line: #e4e7ec;\n    --chip: #eef1f5; --accent: #2557d6; --accent-bg: #e9effd; --ok: #0b8a4c; --ok-bg: #e7f6ee;\n    --warn: #b45309; --warn-bg: #fdf3e3; --bad: #c62828; --bad-bg: #fdecec;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --bg: #0f1115; --card: #181b21; --text: #eceef2; --muted: #9aa1ad; --line: #2a2f38;\n      --chip: #22262e; --accent: #7aa2ff; --accent-bg: #18213a; --ok: #3ccf86; --ok-bg: #14271d;\n      --warn: #f2b45a; --warn-bg: #2b2215; --bad: #ff7b7b; --bad-bg: #2d1717;\n    }\n  }\n  * { box-sizing: border-box; }\n  body {\n    margin: 0; background: var(--bg); color: var(--text);\n    font: 15px/1.5 -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", \"Noto Sans KR\", \"Malgun Gothic\", sans-serif;\n    -webkit-tap-highlight-color: transparent;\n  }\n  .wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; }\n  h1 { font-size: 22px; margin: 0; }\n  .sub { color: var(--muted); font-size: 14px; }\n  .card { background: var(--card); border-radius: 16px; padding: 18px; margin-top: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04); }\n  .card h2 { font-size: 16px; margin: 0 0 10px; }\n  .tabs { display: flex; background: var(--chip); border-radius: 12px; padding: 4px; margin-top: 16px; }\n  .tabs button { flex: 1; height: 40px; border: 0; background: none; border-radius: 9px; font: inherit; font-weight: 600; color: var(--muted); cursor: pointer; }\n  .tabs button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.08); }\n  .btn { height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }\n  .btn.ghost { background: var(--chip); color: var(--text); }\n  .btn:disabled { opacity: .5; }\n  .btn.wide { width: 100%; }\n  input.field { width: 100%; height: 48px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--text); font: inherit; font-size: 18px; padding: 0 14px; }\n  input.field:focus { outline: 2px solid var(--accent); border-color: transparent; }\n  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }\n  .stat { background: var(--chip); border-radius: 12px; padding: 10px; text-align: center; }\n  .stat b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }\n  .stat span { font-size: 12px; color: var(--muted); }\n  .person { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }\n  .person:last-child { border-bottom: 0; }\n  .person .n { font-weight: 700; min-width: 64px; }\n  .person .d { flex: 1; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }\n  .person .d b { color: var(--text); font-weight: 600; }\n  .badge { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; background: var(--chip); color: var(--muted); }\n  .badge.ok { background: var(--ok-bg); color: var(--ok); }\n  .badge.accent { background: var(--accent-bg); color: var(--accent); }\n  .badge.warn { background: var(--warn-bg); color: var(--warn); }\n  .badge.bad { background: var(--bad-bg); color: var(--bad); }\n  .red { color: var(--bad); }\n  .monthnav { display: flex; align-items: center; justify-content: space-between; }\n  .monthnav b { font-size: 18px; }\n  .monthnav button { width: 44px; height: 44px; border: 0; border-radius: 12px; background: var(--chip); color: var(--text); font-size: 20px; cursor: pointer; }\n  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }\n  table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }\n  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 8px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }\n  td { padding: 10px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }\n  tr.pick { cursor: pointer; }\n  tr.pick.on td { background: var(--accent-bg); }\n  td.num, th.num { text-align: right; }\n  .memo { font-size: 12px; color: var(--muted); white-space: normal; }\n  .small { font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 2px; }\n  .small.red, .red .small { color: var(--bad); }\n  td { vertical-align: top; }\n  .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; font-size: 14px; }\n  .kv dt { color: var(--muted); }\n  .kv dd { margin: 0; }\n  .alert { background: var(--warn-bg); color: var(--warn); border-radius: 12px; padding: 12px 14px; font-size: 14px; margin-top: 14px; }\n  .msg { margin-top: 10px; font-size: 14px; color: var(--muted); }\n  .msg.bad { color: var(--bad); }\n  .row { display: flex; gap: 8px; align-items: center; }\n  .row .field { flex: 1; font-size: 13px; height: 44px; }\n  .center { text-align: center; }\n  .card.pending { outline: 2px solid var(--warn); }\n  .req { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line); }\n  .req:last-child { border-bottom: 0; }\n  .req .who { flex: 1; min-width: 0; }\n  .req .btn { height: 38px; padding: 0 12px; font-size: 14px; }\n  .sus { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; }\n  .sus:last-child { border-bottom: 0; }\n  .sus .t { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 42px; }\n  .sus .k { font-weight: 600; }\n  .dev { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; }\n  .dev:last-child { border-bottom: 0; }\n  .rq { padding: 12px 0; border-bottom: 1px solid var(--line); }\n  .rq:last-child { border-bottom: 0; }\n  .rq .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n  .rq .acts { display: flex; gap: 8px; margin-top: 10px; }\n  .rq .acts .btn { height: 38px; flex: 1; font-size: 14px; }\n  .steps { margin: 0 0 12px; padding-left: 20px; font-size: 14px; color: var(--muted); }\n  .steps li { margin-bottom: 4px; }\n  a { color: var(--accent); }\n  [hidden] { display: none !important; }\n  @media (max-width: 420px) { .stat b { font-size: 19px; } .person .n { min-width: 52px; } }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n\n  <section id=\"login\" class=\"card\" style=\"max-width:380px;margin:12vh auto 0\">\n    <h2>출퇴근 관리</h2>\n    <p class=\"sub\" style=\"margin:0 0 14px\">[설정] 시트의 관리자PIN을 넣어주세요.</p>\n    <form id=\"loginForm\">\n      <input class=\"field\" id=\"apin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"off\" placeholder=\"관리자 비밀번호\">\n      <button class=\"btn wide\" style=\"margin-top:10px\">들어가기</button>\n    </form>\n    <p class=\"msg\" id=\"loginMsg\"></p>\n  </section>\n\n  <div id=\"app\" hidden>\n    <div class=\"row\" style=\"justify-content:space-between\">\n      <div><h1 id=\"store\">출퇴근 관리</h1><div class=\"sub\" id=\"now\"></div></div>\n      <button class=\"btn ghost\" id=\"refresh\">새로고침</button>\n    </div>\n    <div class=\"alert\" id=\"weak\" hidden>관리자 비밀번호가 아직 0000이에요. [설정] 시트에서 바꿔주세요.</div>\n    <div class=\"alert\" id=\"noPlace\" hidden>매장 위치가 아직 등록되지 않았어요. 매장 안에서 [설정] 탭 → [지금 위치를 매장으로 등록]을 눌러주세요.</div>\n\n    <nav class=\"tabs\">\n      <button data-tab=\"today\" class=\"on\">오늘</button>\n      <button data-tab=\"month\">월별</button>\n      <button data-tab=\"set\">설정</button>\n    </nav>\n\n    <section id=\"tab-today\">\n      <div class=\"card pending\" id=\"pendingCard\" hidden>\n        <h2>새 폰 승인 요청</h2>\n        <p class=\"sub\" style=\"margin:0 0 6px\">직원이 등록 안 된 폰으로 찍으려고 했어요. 본인이 폰을 바꾼 게 맞으면 승인하세요. 승인하면 예전 폰으로는 안 찍혀요.</p>\n        <div id=\"pending\"></div>\n      </div>\n      <p class=\"msg\" id=\"pendingMsg\" style=\"margin:14px 4px 0\"></p>\n      <div class=\"card pending\" id=\"reqCard\" hidden>\n        <h2>직원 요청 <span class=\"badge warn\" id=\"reqCount\"></span></h2>\n        <div id=\"reqs\"></div>\n      </div>\n      <p class=\"msg\" id=\"reqMsg\" style=\"margin:14px 4px 0\"></p>\n      <div class=\"card\"><div class=\"stats\" id=\"stats\"></div></div>\n      <div class=\"card\" id=\"people\"></div>\n      <div class=\"card\" id=\"suspectCard\" hidden>\n        <h2>오늘 의심 기록 <span class=\"badge bad\" id=\"suspectCount\"></span></h2>\n        <div id=\"suspects\"></div>\n        <p class=\"sub\" style=\"margin:10px 0 0\">지난 기록은 시트의 [의심기록] 탭에 모두 남아 있어요.</p>\n      </div>\n    </section>\n\n    <section id=\"tab-month\" hidden>\n      <div class=\"card\">\n        <div class=\"monthnav\">\n          <button id=\"prev\" aria-label=\"이전 달\">‹</button>\n          <b id=\"ymLabel\"></b>\n          <button id=\"next\" aria-label=\"다음 달\">›</button>\n        </div>\n      </div>\n      <div class=\"card\">\n        <h2>직원별 합계</h2>\n        <div class=\"scroll\"><table id=\"sumTable\"></table></div>\n        <button class=\"btn ghost wide\" id=\"export\" style=\"margin-top:14px\">정산 시트로 만들기</button>\n        <p class=\"msg\" id=\"exportMsg\"></p>\n      </div>\n      <div class=\"card\">\n        <h2 id=\"detailTitle\">날짜별 기록</h2>\n        <div class=\"scroll\"><table id=\"detailTable\"></table></div>\n      </div>\n    </section>\n\n    <section id=\"tab-set\" hidden>\n      <div class=\"card\">\n        <h2>매장 위치</h2>\n        <p class=\"sub\" id=\"placeText\" style=\"margin:0 0 12px\"></p>\n        <button class=\"btn wide\" id=\"setPlace\">지금 위치를 매장으로 등록</button>\n        <p class=\"msg\" id=\"placeMsg\"></p>\n      </div>\n      <div class=\"card\">\n        <h2>직원 화면 주소</h2>\n        <p class=\"sub\" style=\"margin:0 0 10px\">이 주소를 직원 단톡방에 올려주세요. 직원은 열어서 홈 화면에 추가하면 앱처럼 쓸 수 있어요.</p>\n        <div class=\"row\"><input class=\"field\" id=\"appUrl\" readonly><button class=\"btn ghost\" id=\"copy\">복사</button></div>\n      </div>\n      <div class=\"card\">\n        <h2>텔레그램 알림</h2>\n        <p class=\"sub\" id=\"tgStatus\" style=\"margin:0 0 10px\"></p>\n        <div id=\"tgSetup\">\n          <ol class=\"steps\">\n            <li>텔레그램에서 <b>@BotFather</b>를 찾아 <b>/newbot</b>을 보내세요. 봇 이름과 아이디를 정하면 <b>토큰</b>을 줘요.</li>\n            <li>그 토큰을 아래에 붙여넣고 <b>[저장]</b>을 누르세요.</li>\n            <li>텔레그램에서 방금 만든 봇을 열어 <b>아무 말이나</b> 보낸 뒤 <b>[연결 확인]</b>을 누르세요.</li>\n          </ol>\n          <div class=\"row\"><input class=\"field\" id=\"tgToken\" placeholder=\"123456789:ABC…\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"btn\" id=\"tgSave\">저장</button></div>\n          <button class=\"btn wide\" id=\"tgLink\" style=\"margin-top:10px\">연결 확인</button>\n        </div>\n        <button class=\"btn ghost wide\" id=\"tgOff\" hidden>텔레그램 연결 끊기</button>\n        <p class=\"msg\" id=\"tgMsg\"></p>\n      </div>\n      <div class=\"card\">\n        <h2>직원 폰 등록 현황</h2>\n        <p class=\"sub\" style=\"margin:0 0 6px\">직원마다 처음 출근을 찍은 폰이 자동으로 등록돼요. 처음 1주일은 엉뚱한 폰이 등록되지 않았는지 한 번 봐주세요.\n          잘못 등록됐으면 시트 [직원] 탭의 <b>등록폰</b> 칸을 지우면 다음에 찍는 폰으로 다시 등록돼요.</p>\n        <div id=\"devices\"></div>\n      </div>\n      <div class=\"card\">\n        <h2>현재 설정</h2>\n        <dl class=\"kv\" id=\"kv\"></dl>\n        <p class=\"sub\" style=\"margin:14px 0 0\">바꾸려면 <a id=\"sheetLink\" href=\"#\" target=\"_blank\">구글 시트</a>의 [설정] 탭에서 값을 고치세요.</p>\n      </div>\n    </section>\n  </div>\n</main>\n\n<script>\n  var $ = function (id) { return document.getElementById(id); };\n  var A = { pin: '', ym: '', month: null, info: null, who: '' };\n\n  function call(fn) {\n    var args = Array.prototype.slice.call(arguments, 1);\n    return new Promise(function (ok, no) {\n      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) {\n        no(new Error((e && e.message) || String(e)));\n      });\n      r[fn].apply(r, args);\n    });\n  }\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n  function hm(min) {\n    min = Math.round(min || 0);\n    var h = Math.floor(min / 60), m = min % 60;\n    return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';\n  }\n  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }\n  function ymLabel(ym) { return ym.slice(0, 4) + '년 ' + Number(ym.slice(5)) + '월'; }\n  function shiftYm(ym, d) {\n    var y = +ym.slice(0, 4), m = +ym.slice(5) - 1 + d;\n    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;\n    return y + '-' + (m < 9 ? '0' : '') + (m + 1);\n  }\n  function ss(k, v) {\n    try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; }\n  }\n\n  /* 로그인 */\n  $('loginForm').addEventListener('submit', function (e) {\n    e.preventDefault();\n    login($('apin').value.trim());\n  });\n  function login(pin) {\n    if (!pin) return;\n    $('loginMsg').className = 'msg';\n    $('loginMsg').textContent = '확인 중…';\n    call('adminToday', pin).then(function (r) {\n      A.pin = pin;\n      ss('att:admin', pin);\n      $('login').hidden = true;\n      $('app').hidden = false;\n      A.ym = r.date.slice(0, 7);\n      renderToday(r);\n    }).catch(function (e) {\n      ss('att:admin', null);\n      $('loginMsg').className = 'msg bad';\n      $('loginMsg').textContent = e.message;\n    });\n  }\n\n  /* 탭 */\n  var current = 'today';\n  document.querySelector('.tabs').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-tab]');\n    if (b) openTab(b.getAttribute('data-tab'));\n  });\n  function openTab(t) {\n    current = t;\n    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {\n      b.classList.toggle('on', b.getAttribute('data-tab') === t);\n    });\n    ['today', 'month', 'set'].forEach(function (x) { $('tab-' + x).hidden = x !== t; });\n    if (t === 'month' && !A.month) loadMonth(A.ym);\n  }\n  $('refresh').addEventListener('click', function () {\n    loadToday();\n    if (current === 'month') loadMonth(A.ym);\n  });\n\n  /* 오늘 */\n  function loadToday() {\n    return call('adminToday', A.pin).then(renderToday).catch(function (e) { alert(e.message); });\n  }\n  var BADGE = { '근무중': 'ok', '퇴근': 'accent', '미출근': 'bad', '출근 전': '', '휴무': '' };\n  function renderToday(r) {\n    A.info = r.info;\n    $('store').textContent = r.info.store + ' 출퇴근';\n    $('now').textContent = r.date.replace(/-/g, '.') + ' (' + r.dow + ') ' + r.time + ' 기준';\n    $('weak').hidden = !r.info.weakPin;\n    $('noPlace').hidden = r.info.hasPlace || r.info.mode !== '필수';\n    var count = { '근무중': 0, '미출근': 0, '퇴근': 0, '휴무': 0 };\n    r.list.forEach(function (p) { if (p.status in count) count[p.status]++; });\n    $('stats').innerHTML = Object.keys(count).map(function (k) {\n      return '<div class=\"stat\"><b class=\"' + (k === '미출근' && count[k] ? 'red' : '') + '\">' + count[k] + '</b><span>' + k + '</span></div>';\n    }).join('');\n    $('people').innerHTML = r.list.length ? r.list.map(function (p) {\n      var d = [];\n      if (p.sIn) d.push('예정 ' + esc(p.sIn) + '~' + esc(p.sOut));\n      if (p.tIn) d.push('출근 <b>' + esc(p.tIn) + '</b>' + (p.late ? ' <span class=\"red\">(' + p.late + '분 지각)</span>' : ''));\n      if (p.tOut) d.push('퇴근 <b>' + esc(p.tOut) + '</b>' + (p.early ? ' <span class=\"red\">(' + p.early + '분 조퇴)</span>' : ''));\n      var badge = p.status === '근무중' && p.late ? 'warn' : BADGE[p.status];\n      return '<div class=\"person\"><div class=\"n\">' + esc(p.name) + '</div><div class=\"d\">' + (d.join(' · ') || '근무 없음') +\n        '</div><span class=\"badge ' + (badge || '') + '\">' + esc(p.status === '근무중' && p.late ? '지각' : p.status) + '</span></div>';\n    }).join('') : '<p class=\"sub center\">[직원] 시트에 직원을 먼저 넣어주세요.</p>';\n\n    var pend = r.pending || [];\n    $('pendingCard').hidden = !pend.length;\n    $('pending').innerHTML = pend.map(function (p) {\n      return '<div class=\"req\"><div class=\"who\"><b>' + esc(p.name) + '</b><div class=\"small\">' + esc(p.label) + '</div></div>' +\n        '<button class=\"btn\" data-approve=\"' + esc(p.name) + '\">승인</button>' +\n        '<button class=\"btn ghost\" data-reject=\"' + esc(p.name) + '\">거절</button></div>';\n    }).join('');\n\n    var sus = r.suspects || [];\n    $('suspectCard').hidden = !sus.length;\n    $('suspectCount').textContent = sus.length + '건';\n    $('suspects').innerHTML = sus.map(function (s) {\n      return '<div class=\"sus\"><span class=\"t\">' + esc(s.time) + '</span><span><span class=\"k\">' + esc(s.name) + ' · ' + esc(s.kind) +\n        '</span><div class=\"small\">' + esc(s.detail) + '</div></span></div>';\n    }).join('');\n\n    $('devices').innerHTML = (r.devices || []).map(function (d) {\n      return '<div class=\"dev\"><b>' + esc(d.name) + '</b><span class=\"' + (d.label ? '' : 'sub') + '\">' +\n        esc(d.label || '아직 등록 안 됨 (처음 찍을 때 등록돼요)') + '</span></div>';\n    }).join('') || '<p class=\"sub\">직원이 없어요.</p>';\n\n    var reqs = r.requests || [];\n    $('reqCard').hidden = !reqs.length;\n    $('reqCount').textContent = reqs.length + '건';\n    $('reqs').innerHTML = reqs.map(function (q) {\n      var when = q.date.slice(5).replace('-', '/').replace(/^0/, '') + '(' + esc(q.dow) + ')';\n      var line;\n      if (q.kind === '정정') line = when + ' <b>' + esc(q.what) + '</b>로 고쳐주세요' + (q.before ? ' <span class=\"small\">(지금 기록 ' + esc(q.before) + ')</span>' : ' <span class=\"small\">(지금 기록 없음)</span>');\n      else if (q.kind === '휴무') line = when + ' ' + esc(q.what) + ' 근무 <b>쉬고 싶어요</b>';\n      else line = when + ' ' + esc(q.what) + ' → ' + (q.taker ? '<b>' + esc(q.taker) + '</b> 님이 대신 근무' : '<span class=\"small\">대타 구하는 중 (동료 수락 전)</span>');\n      var waiting = q.kind === '대타' && !q.taker;\n      return '<div class=\"rq\"><div class=\"top\"><span class=\"badge ' + (q.kind === '정정' ? 'accent' : 'warn') + '\">' + esc(q.kind) + '</span><b>' + esc(q.name) + '</b></div>' +\n        '<div style=\"margin-top:4px\">' + line + '</div>' +\n        (q.reason ? '<div class=\"small\">사유: ' + esc(q.reason) + '</div>' : '') +\n        (q.note ? '<div class=\"small red\">※ ' + esc(q.note) + '</div>' : '') +\n        (q.past ? '<div class=\"small red\">※ 이미 지난 날짜예요</div>' : '') +\n        '<div class=\"acts\">' + (waiting ? '' : '<button class=\"btn\" data-rq-ok=\"' + esc(q.id) + '\">승인</button>') +\n        '<button class=\"btn ghost\" data-rq-no=\"' + esc(q.id) + '\">' + (waiting ? '대타 요청 닫기' : '거절') + '</button></div></div>';\n    }).join('');\n\n    renderSettings(r.info);\n  }\n  $('reqs').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-rq-ok],[data-rq-no]');\n    if (!b) return;\n    var ok = b.hasAttribute('data-rq-ok');\n    var id = b.getAttribute(ok ? 'data-rq-ok' : 'data-rq-no');\n    if (!confirm(ok ? '승인할까요? 바로 기록·근무표에 반영돼요.' : '거절할까요?')) return;\n    b.disabled = true;\n    $('reqMsg').className = 'msg';\n    $('reqMsg').textContent = '처리 중…';\n    call('adminRequest', A.pin, id, ok).then(function (r) {\n      renderToday(r);\n      $('reqMsg').textContent = ok ? '승인했어요. 기록과 근무표에 반영됐어요.' : '거절했어요.';\n      A.month = null;\n    }).catch(function (err) {\n      b.disabled = false;\n      $('reqMsg').className = 'msg bad';\n      $('reqMsg').textContent = err.message;\n    });\n  });\n  $('pending').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-approve],[data-reject]');\n    if (!b) return;\n    var ok = b.hasAttribute('data-approve');\n    var name = b.getAttribute(ok ? 'data-approve' : 'data-reject');\n    if (!confirm(name + ' 님의 새 폰을 ' + (ok ? '승인' : '거절') + '할까요?')) return;\n    b.disabled = true;\n    $('pendingMsg').className = 'msg';\n    $('pendingMsg').textContent = '처리 중…';\n    call('adminDevice', A.pin, name, ok).then(function (r) {\n      renderToday(r);\n      $('pendingMsg').textContent = name + ' 님 새 폰을 ' + (ok ? '승인했어요. 이제 그 폰으로 찍을 수 있어요.' : '거절했어요.');\n    }).catch(function (err) {\n      b.disabled = false;\n      $('pendingMsg').className = 'msg bad';\n      $('pendingMsg').textContent = err.message;\n    });\n  });\n\n  /* 월별 */\n  $('prev').addEventListener('click', function () { loadMonth(shiftYm(A.ym, -1)); });\n  $('next').addEventListener('click', function () { loadMonth(shiftYm(A.ym, 1)); });\n  function loadMonth(ym) {\n    A.ym = ym;\n    A.who = '';\n    $('ymLabel').textContent = ymLabel(ym);\n    $('exportMsg').textContent = '';\n    $('sumTable').innerHTML = '<tr><td class=\"sub\">불러오는 중…</td></tr>';\n    $('detailTable').innerHTML = '';\n    return call('adminMonth', A.pin, ym).then(function (m) {\n      if (m.ym !== A.ym) return;\n      A.month = m;\n      renderMonth();\n    }).catch(function (e) { $('sumTable').innerHTML = '<tr><td class=\"red\">' + esc(e.message) + '</td></tr>'; });\n  }\n  function renderMonth() {\n    var m = A.month;\n    var html = '<thead><tr><th>이름</th><th class=\"num\">근무</th><th class=\"num\">지각</th><th class=\"num\">차감액</th></tr></thead><tbody>';\n    if (!m.staff.length) html += '<tr><td colspan=\"4\" class=\"sub\">기록이 없어요.</td></tr>';\n    m.staff.forEach(function (s) {\n      var extra = [];\n      if (s.earlyMin) extra.push('조퇴 ' + s.earlyMin + '분');\n      if (s.noOut) extra.push('퇴근 누락 ' + s.noOut + '건');\n      if (s.noIn) extra.push('출근 누락 ' + s.noIn + '건');\n      html += '<tr class=\"pick' + (A.who === s.name ? ' on' : '') + '\" data-who=\"' + esc(s.name) + '\">' +\n        '<td><b>' + esc(s.name) + '</b>' + (extra.length ? '<div class=\"small red\">' + extra.join(' · ') + '</div>' : '') + '</td>' +\n        '<td class=\"num\">' + hm(s.work) + '<div class=\"small\">' + s.days + '일</div></td>' +\n        '<td class=\"num' + (s.lateCount ? ' red' : '') + '\">' + (s.lateCount ? s.lateCount + '회<div class=\"small\">' + s.lateMin + '분</div>' : '-') + '</td>' +\n        '<td class=\"num' + (s.deduct ? ' red' : '') + '\">' + (s.deduct ? won(s.deduct) : '-') + '</td></tr>';\n    });\n    $('sumTable').innerHTML = html + '</tbody>';\n\n    var rows = m.rows.filter(function (r) { return !A.who || r.name === A.who; });\n    $('detailTitle').textContent = A.who ? A.who + ' 날짜별 기록' : '날짜별 기록 (위에서 이름을 누르면 그 사람만 보여요)';\n    var cols = A.who ? 4 : 5;\n    var d = '<thead><tr><th>날짜</th>' + (A.who ? '' : '<th>이름</th>') + '<th>출근</th><th>퇴근</th><th class=\"num\">지각</th></tr></thead><tbody>';\n    if (!rows.length) d += '<tr><td colspan=\"' + cols + '\" class=\"sub\">기록이 없어요.</td></tr>';\n    rows.forEach(function (r) {\n      d += '<tr><td>' + esc(r.date.slice(5).replace('-', '/')) + ' ' + esc(r.dow) +\n        '<div class=\"small\">' + (r.sIn ? '예정 ' + esc(r.sIn) + '~' + esc(r.sOut) : '근무표 없음') + '</div></td>' +\n        (A.who ? '' : '<td>' + esc(r.name) + '</td>') +\n        '<td>' + esc(r.tIn || '-') + '</td><td>' + esc(r.tOut || '-') + '</td>' +\n        '<td class=\"num' + (r.late ? ' red' : '') + '\">' + (r.late ? r.late + '분' : '') +\n        (r.deduct ? '<div class=\"small\">' + won(r.deduct) + '</div>' : '') + '</td></tr>' +\n        (r.memo ? '<tr><td colspan=\"' + cols + '\" class=\"memo\" style=\"padding-top:0\">' + esc(r.memo) + '</td></tr>' : '');\n    });\n    $('detailTable').innerHTML = d + '</tbody>';\n  }\n  $('sumTable').addEventListener('click', function (e) {\n    var tr = e.target.closest('[data-who]');\n    if (!tr) return;\n    var w = tr.getAttribute('data-who');\n    A.who = A.who === w ? '' : w;\n    renderMonth();\n  });\n  $('export').addEventListener('click', function () {\n    var b = $('export');\n    b.disabled = true;\n    $('exportMsg').className = 'msg';\n    $('exportMsg').textContent = '만드는 중…';\n    call('adminExport', A.pin, A.ym).then(function (r) {\n      $('exportMsg').innerHTML = \"'\" + esc(r.name) + \"' 시트를 만들었어요. <a href=\\\"\" + esc(r.url) + '\" target=\"_blank\">열기</a>';\n    }).catch(function (e) {\n      $('exportMsg').className = 'msg bad';\n      $('exportMsg').textContent = e.message;\n    }).then(function () { b.disabled = false; });\n  });\n\n  /* 설정 */\n  function renderSettings(i) {\n    renderTg(i);\n    $('placeText').textContent = i.hasPlace\n      ? '등록됨 (' + Number(i.lat).toFixed(5) + ', ' + Number(i.lng).toFixed(5) + ') · 반경 ' + i.radius + 'm'\n      : '아직 등록 안 됨. 매장 안에서 아래 버튼을 눌러주세요.';\n    $('setPlace').textContent = i.hasPlace ? '지금 위치로 다시 등록' : '지금 위치를 매장으로 등록';\n    $('appUrl').value = i.appUrl || '(웹 앱으로 배포한 뒤에 보여요)';\n    $('sheetLink').href = i.sheetUrl;\n    var kv = [\n      ['위치 확인', i.mode + (i.mode === '필수' ? ' (매장 ' + i.radius + 'm 안에서만)' : '')],\n      ['폰 확인', i.device === '필수' ? '필수 (직원마다 등록된 폰 1대에서만)' : '안함'],\n      ['지각 기준', i.grace ? '예정 시간 + ' + i.grace + '분 넘으면 지각' : '예정 시간을 1분이라도 넘으면 지각'],\n      ['지각·조퇴 차감', '시급 × 일 안 한 시간만큼 (분 단위)'],\n      ['알림 받는 곳', i.tg === '연결됨' ? '텔레그램' + (i.email ? ' (안 되면 ' + esc(i.email) + ')' : '') : i.email ? esc(i.email) + ' (메일)' : '꺼짐 (텔레그램·메일 모두 없음)'],\n      ['미출근 알림', '출근 예정 ' + i.alertMin + '분 뒤에도 안 찍으면'],\n    ];\n    $('kv').innerHTML = kv.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join('');\n  }\n  $('setPlace').addEventListener('click', function () {\n    var msg = $('placeMsg');\n    msg.className = 'msg';\n    msg.textContent = '위치 확인 중… (10초 정도 걸릴 수 있어요)';\n    if (!navigator.geolocation) { msg.className = 'msg bad'; msg.textContent = '이 브라우저는 위치를 지원하지 않아요.'; return; }\n    navigator.geolocation.getCurrentPosition(function (p) {\n      var acc = Math.round(p.coords.accuracy);\n      if (!confirm('지금 위치(오차 약 ' + acc + 'm)를 매장 위치로 등록할까요?\\n매장 안에 있을 때만 눌러주세요.')) { msg.textContent = ''; return; }\n      call('adminSetPlace', A.pin, p.coords.latitude, p.coords.longitude).then(function (info) {\n        renderSettings(info);\n        A.info = info;\n        $('noPlace').hidden = true;\n        msg.textContent = '등록했어요. 오차 ' + acc + 'm' + (acc > 50 ? ' — 오차가 커요. 창가에서 한 번 더 등록하면 더 정확해요.' : '');\n      }).catch(function (e) { msg.className = 'msg bad'; msg.textContent = e.message; });\n    }, function (e) {\n      msg.className = 'msg bad';\n      msg.textContent = e.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 위치 권한을 허용해주세요.' : '위치를 확인하지 못했어요. 다시 눌러주세요.';\n    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });\n  });\n  $('copy').addEventListener('click', function () {\n    var el = $('appUrl');\n    el.select();\n    var done = function () { $('copy').textContent = '복사됨'; setTimeout(function () { $('copy').textContent = '복사'; }, 1500); };\n    if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done, function () { document.execCommand('copy'); done(); });\n    else { document.execCommand('copy'); done(); }\n  });\n\n  /* 텔레그램 */\n  function renderTg(i) {\n    var on = i.tg === '연결됨';\n    $('tgStatus').innerHTML = on ? '<b style=\"color:var(--ok)\">연결됨</b> · 직원 요청, 미출근, 의심 기록 알림이 텔레그램으로 바로 와요.'\n      : i.tg === '토큰만' ? '봇 토큰은 저장됐어요. 텔레그램에서 봇에게 아무 말이나 보낸 뒤 <b>[연결 확인]</b>을 누르세요.'\n      : '연결 안 됨. 연결하면 알림이 메일 대신 텔레그램으로 바로 와요. (무료)';\n    $('tgSetup').hidden = on;\n    $('tgOff').hidden = !i.tg;\n  }\n  function tgRun(fn, args, okText) {\n    $('tgMsg').className = 'msg';\n    $('tgMsg').textContent = '확인 중…';\n    return call.apply(null, [fn, A.pin].concat(args)).then(function (r) {\n      var info = r.info || r;\n      A.info = info;\n      renderSettings(info);\n      $('tgMsg').textContent = typeof okText === 'function' ? okText(r) : okText;\n    }).catch(function (e) {\n      $('tgMsg').className = 'msg bad';\n      $('tgMsg').textContent = e.message;\n    });\n  }\n  $('tgSave').addEventListener('click', function () {\n    var t = $('tgToken').value.trim();\n    if (!t) { $('tgMsg').className = 'msg bad'; $('tgMsg').textContent = '토큰을 붙여넣어 주세요.'; return; }\n    tgRun('adminTelegram', [t], function (r) {\n      $('tgToken').value = '';\n      return '저장했어요' + (r.bot ? ' (@' + r.bot + ')' : '') + '. 이제 텔레그램에서 그 봇에게 아무 말이나 보낸 뒤 [연결 확인]을 누르세요.';\n    });\n  });\n  $('tgLink').addEventListener('click', function () {\n    tgRun('adminTelegramLink', [], '연결됐어요! 텔레그램에 시험 메시지를 보냈어요.');\n  });\n  $('tgOff').addEventListener('click', function () {\n    if (!confirm('텔레그램 알림을 끌까요? 메일 주소가 있으면 메일로 알림이 가요.')) return;\n    tgRun('adminTelegramOff', [], '텔레그램 연결을 끊었어요.');\n  });\n\n  var saved = ss('att:admin');\n  if (saved) login(saved);\n</script>\n</body>\n</html>\n",
};
