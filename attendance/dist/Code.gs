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
 * 시트(탭)
 *  - 설정          : 상호, 관리자 비밀번호, 위치·폰 확인 방식, 지각 기준, 알림(텔레그램·메일), 휴무 고르기 규칙, 공휴일
 *  - 매장          : 매장마다 기본 출근·퇴근 시간, 위치, 점장, 휴무 규칙(하루 최대·한 달 최대)
 *  - 직원          : 이름, 매장, 비밀번호, 시급, 요일별 근무시간(사무실 등), 등록된 폰, 텔레그램
 *  - 휴무표 YYYY-MM: 달마다 한 장. 휴무·월차·반차를 적고, 지각 시간은 앱이 자동으로 적어요
 *  - 근무변경      : 특정 날짜만 근무시간이 다를 때 (대타 등)
 *  - 출퇴근기록 : 하루 한 줄씩 자동으로 쌓이는 기록
 *  - 의심기록   : 비밀번호 틀림, 매장 밖, 다른 폰 같은 거절된 시도
 *  - 요청       : 직원이 보낸 출퇴근 정정, 휴무, 대타 요청과 처리 결과 (직원 → 점장 → 관리자)
 *  - 대체휴무   : 쉬는 날·공휴일에 일해서 쌓인 대체휴무와 쓴 날
 */

/**
 * 시트에 붙인 스크립트(확장 프로그램 → Apps Script)면 비워 두세요.
 * 시트와 따로 만든 스크립트면 시트 주소의 /d/ 와 /edit 사이 글자를 넣어요. (자동 설치가 채워요)
 */
var SHEET_ID = '';

// 사장님이 앱을 시험해 볼 때 쓰는 직원 이름. 폰 등록·위치 확인을 안 하고, 월별·정산에서 빠지고,
// 사장님 화면 [설정] → 테스트 → [테스트 지우기]로 이 이름의 기록을 통째로 지워요
var TEST_NAME = '테스트';
var SHEETS = { set: '설정', store: '매장', staff: '직원', change: '근무변경', log: '출퇴근기록', suspect: '의심기록', req: '요청', sub: '대체휴무' };
var MONTH_PREFIX = '휴무표 ';
var DOW = ['일', '월', '화', '수', '목', '금', '토'];

// [직원] 칸은 머리글 이름으로 찾아요. 칸 순서를 바꾸거나 칸을 더해도 돼요.
var STAFF_HEAD = ['이름', '매장', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청', '동의', '텔레그램'];
// 너무 쉬워서 바꾸라고 알려줄 비밀번호
var EASY_PINS = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '1212', '1004', '2580'];
var STAFF_FMT = { '시급': '#,##0' }; // 나머지는 모두 글자(@)
// [매장] 칸도 머리글 이름으로 찾아요. 점장: 그 매장 점장 이름(여러 명이면 쉼표) · 최대휴무: 하루에 쉴 수 있는 사람 수(비우면 1, 0이면 제한 없음) · 월휴무: 한 달에 고를 수 있는 휴무 일수(비우면 제한 없음)
var STORE_HEAD = ['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모', '점장', '최대휴무', '월휴무'];
// 휴무표 한 달 탭(새로 만들 때): A No · B 매장 · C 이름 · D 휴무 · E 월차 · F 이월 · G 부여 · H 잔여 · I 지각 · J~AN 1~31일 · AO 메모
// 읽고 쓸 때는 1행 머리글('이름', '11/1', '메모')로 칸을 찾아서, 칸을 더하거나 지워도 괜찮아요.
var MT = { no: 0, store: 1, name: 2, off: 3, used: 4, carry: 5, grant: 6, left: 7, late: 8, day1: 9, memo: 40 };
// 휴무표 칸에 이런 말이 있으면 그날은 쉬는 날(지각·미출근 안 봄)
// '대체'는 칸 전체가 '대체'일 때만(대체휴무 쓰는 날). '대체근무 12-21' 같은 건 근무로 봐요
var OFF_RE = /휴|쉼|월차|반차|무급|명절|추석|설날|여름|동원|예비군|출산|무단|퇴사|병가|경조|^\s*대체\s*$/;
// 직원이 신청할 수 있는 쉬는 날 종류. 대체 = 쌓아 둔 대체휴무를 쓰는 날
var OFF_KINDS = ['휴무', '월차', '반차', '대체'];
var KIND_NAME = { '정정': '기록 정정', '휴무': '휴무', '월차': '월차', '반차': '반차', '대체': '대체휴무', '대타': '대타' };
var SUSPECT_HEAD = ['일시', '이름', '구분', '내용'];
// 보낼곳: 점장(점장이 먼저 보고 관리자에게 올리거나 돌려보냄) / 관리자 · 점장확인: 점장이 올리거나 돌려보낸 기록
var REQ_HEAD = ['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시', '보낼곳', '점장확인'];
var R = { id: 0, at: 1, name: 2, kind: 3, date: 4, what: 5, reason: 6, state: 7, taker: 8, done: 9, route: 10, mgr: 11 };
// 대체휴무 장부: 적립(쉬는 날·공휴일에 일함) / 사용(대체휴무 신청 승인). 사장님이 손으로 줄을 더하거나 지워도 돼요
var SUB_HEAD = ['날짜', '이름', '구분', '일수', '사유', '기록일시'];
var SUB_FMT = ['@', '@', '@', '0.0', '@', '@'];
var CHANGE_HEAD = ['날짜', '이름', '근무시간', '메모'];
var LOG_HEAD = ['날짜', '요일', '이름', '예정출근', '예정퇴근', '출근', '퇴근',
  '지각(분)', '조퇴(분)', '근무(분)', '차감액', '출근거리(m)', '퇴근거리(m)', '메모', '찍은매장'];
var LOG_FMT = ['@', '@', '@', '@', '@', '@', '@', '0', '0', '0', '#,##0', '0', '0', '@', '@'];
var C = { date: 0, dow: 1, name: 2, sIn: 3, sOut: 4, tIn: 5, tOut: 6,
  late: 7, early: 8, work: 9, deduct: 10, dIn: 11, dOut: 12, memo: 13, place: 14 };

var K = {
  store: '상호', adminPin: '관리자PIN',
  radius: '허용반경(m)', mode: '위치확인', device: '폰확인', grace: '지각유예(분)',
  email: '알림이메일', alertMin: '알림기준(분)', tgToken: '텔레그램토큰', tgChat: '텔레그램채팅ID', tgBot: '텔레그램봇',
  remind: '출근전알림(분)', wishWin: '휴무신청기간', wishBlock: '휴무금지일',
  holAdd: '공휴일추가', holDel: '공휴일제외', subMode: '대체휴무적립',
};
var SETTINGS = [
  [K.store, '굳폰', '직원 화면 맨 위에 보이는 이름'],
  [K.adminPin, '0000', '사장님 화면 비밀번호. 꼭 바꾸세요'],
  [K.radius, '100', '매장에서 이 거리(m) 안에서만 찍혀요([매장] 탭에 매장별로 따로 정해도 돼요). 실내 GPS 오차는 최대 100m까지 봐줘요'],
  [K.mode, '필수', '필수: 등록된 매장 근처에서만 찍힘(어느 매장이든) / 기록만: 위치는 남기고 어디서든 찍힘 / 안함'],
  [K.device, '필수', '필수: 직원마다 처음 찍은 폰에서만 찍힘. 폰을 바꾸면 사장님 승인 필요 / 안함'],
  [K.grace, '0', '이 시간(분)까지 늦은 건 지각으로 안 봐요. 넘으면 늦은 시간 전체가 지각'],
  [K.email, '', '알림 받을 메일 주소. 텔레그램을 연결하면 텔레그램으로 가고, 안 되면 이 메일로 가요'],
  [K.alertMin, '10', '출근 예정 시간에서 몇 분 지나도 안 찍으면 알림을 보낼지'],
  [K.tgToken, '', '텔레그램 봇 토큰. 사장님 화면 [설정] 탭에서 넣으면 돼요. 남에게 보여주지 마세요'],
  [K.tgChat, '', '알림 받을 텔레그램 채팅 번호. 사장님 화면에서 [연결 확인]을 누르면 채워져요'],
  [K.tgBot, '', '텔레그램 봇 아이디. 토큰을 저장하면 저절로 채워져요. 직원이 앱에서 알림을 켤 때 써요'],
  [K.remind, '20', '텔레그램 알림을 켠 직원에게 출근 몇 분 전에 알려줄지. 0이면 안 보내요'],
  [K.wishWin, '20-25', '직원이 앱에서 다음 달 휴무를 고를 수 있는 날짜(매달 20~25일). 비우면 언제든 고를 수 있어요'],
  [K.wishBlock, '', '휴무를 고를 수 없는 날. 예: 12/24, 12/31 (해마다) 또는 2026-12-24'],
  [K.holAdd, '', '앱에 없는 공휴일·회사 쉬는 날 더하기. 예: 2027-05-03 대체공휴일, 2026-12-31 회사휴무'],
  [K.holDel, '', '앱에 들어 있는 공휴일 빼기. 예: 2026-05-01'],
  [K.subMode, '휴무날만', '대체휴무 쌓기. 휴무날만: 쉬는 날 출근하면 / 휴무날·공휴일: 공휴일에 출근해도 / 안함'],
];

/*
 * 공휴일(대체공휴일·선거일 포함). 휴무표 머리글을 빨갛게 칠하고, 직원 근무표에 이름이 보여요.
 * 정부 발표가 바뀌면 [설정]의 공휴일추가·공휴일제외로 고치면 돼요.
 */
var HOLIDAYS = {
  '2026-01-01': '신정', '2026-02-16': '설 연휴', '2026-02-17': '설날', '2026-02-18': '설 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-01': '노동절', '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-06': '설 연휴', '2027-02-07': '설날', '2027-02-08': '설 연휴', '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절', '2027-05-01': '노동절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일', '2027-07-17': '제헌절', '2027-08-15': '광복절', '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일',
};

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
  var stores = stores_();
  var active = staff_().filter(function (p) { return p.active; });
  // 매장마다 점장(직원 명단에 있는 사람만). 직원 화면의 '점장에게 보내기', 사장님 화면의 점장 로그인에 써요
  var mgr = {}, managers = [];
  stores.forEach(function (st) {
    var m = managersOf_(st.name);
    if (m.length) mgr[st.name] = m.join(', ');
    m.forEach(function (n) { if (managers.indexOf(n) < 0) managers.push(n); });
  });
  return {
    store: set.store,
    mode: set.mode,
    stores: stores.map(function (st) { return st.name; }),
    mgr: mgr,
    managers: managers,
    staff: sortByStore_(active, stores)
      .map(function (p) { return { name: p.name, store: p.store, pin: !!p.pin, agreed: p.agreed, test: p.name === TEST_NAME }; }),
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
  // 시간은 '누른 순간'으로 기록해요. 사람이 몰려 줄을 서도 그만큼 늦게 찍히지 않아요.
  var now = nowKst_();
  // 비밀번호·폰·위치 확인은 줄 서기 전에 해요(동시에 여러 명 처리돼서 빨라요)
  var set = settings_();
  var people = staff_();
  var p = person_(req.name, people);
  checkPin_(p, req.pin, true);
  checkAgree_(p, req);
  checkDevice_(set, p, req, people);
  var place = checkPlace_(set, req, p, now);
  var sched = schedFor_(p, now.date); // 오늘 근무시간도 미리 읽어 둬요
  // 기록을 쓰는 부분만 한 명씩
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('지금 찍는 사람이 많아서 잠깐 밀렸어요. 다시 한 번 눌러주세요.');
  try {
    var sh = sheet_(SHEETS.log);
    var found = findLog_(sh, now.date, p.name);
    var row, v;
    if (found) {
      row = found.row;
      v = found.vals.slice();
    } else {
      row = Math.max(sh.getLastRow(), 1) + 1;
      v = newLogRow_(now.date, p, sched);
    }
    if (type === 'in') {
      if (v[C.tIn]) throw new Error('오늘은 이미 ' + v[C.tIn] + '에 출근을 찍었어요.');
      v[C.tIn] = now.time;
      v[C.dIn] = place.dist;
    } else {
      if (v[C.tOut]) v[C.memo] = addMemo_(v[C.memo], '퇴근 다시 찍음(이전 ' + v[C.tOut] + ')');
      if (!v[C.tIn]) v[C.memo] = addMemo_(v[C.memo], '출근 기록 없음');
      v[C.tOut] = now.time;
      v[C.dOut] = place.dist;
    }
    if (place.store && !v[C.place]) v[C.place] = place.store;
    if (place.memo) v[C.memo] = addMemo_(v[C.memo], place.memo);
    applyCalc_(v, p.wage, set.grace);
    writeLog_(sh, row, v);
    if (type === 'in') syncLateMark_(now.date, p.name, v);
  } finally {
    lock.releaseLock();
  }
  // 처음 정한 비밀번호·동의는 줄 밖에서 저장해요(기록이 성공한 뒤에만)
  if (p.newPin) setStaffCell_(p.row, 'PIN', p.newPin);
  if (p.newAgree) setStaffCell_(p.row, '동의', now.date + ' ' + now.time);
  return {
    type: type, time: now.time,
    late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: v[C.work] === '' ? null : toNum_(v[C.work]),
    today: todayOf_(v), weakPin: weakPin_(p, people), place: place.memo || '',
  };
}

function getMyMonth(name, pin, ym) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  ym = validYm_(ym) || now.ym;
  var rows = monthRows_(ym).filter(function (r) { return r.name === p.name; });
  return { ym: ym, rows: rows, total: total_(rows, now.date) };
}

/**
 * 직원 화면을 열 때 한 번에: 오늘 근무, 요청·대타, 퇴근 누락, 쉬운 비밀번호 여부.
 * (예전에는 3번 나눠 불러서 느렸어요)
 */
function getHome(name, pin) {
  var p = person_(name);
  var now = nowKst_();
  var out = { today: getToday(name), requests: null, missingOut: null, weakPin: false, pinError: '' };
  if (!p.pin || !String(pin == null ? '' : pin).trim()) return out;
  try {
    checkPin_(p, pin);
  } catch (err) {
    out.pinError = err.message;
    return out;
  }
  out.requests = reqsFor_(p.name);
  out.weakPin = weakPin_(p, staff_());
  out.missingOut = missingOut_(p.name, now.date);
  // 텔레그램 알림: 사장님이 봇을 연결했을 때만 직원이 켤 수 있어요 ('' = 못 씀, 'off' = 꺼짐, 'on' = 켜짐)
  var set = settings_();
  out.tg = set.tgToken ? (p.tg ? 'on' : 'off') : '';
  // 다음 달 휴무를 고를 수 있는 기간이면 화면 위에 알려줘요
  var w = wishOpen_(set, now);
  out.wish = { open: w.open, ym: w.ym, text: w.text };
  return out;
}

/** 지난 7일 중 출근만 찍고 퇴근을 안 찍은 가장 최근 날 (정정 요청을 이미 보냈으면 빼요). */
function missingOut_(name, today) {
  var sh = sheet_(SHEETS.log);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var first = Math.max(2, last - 499);
  var vals = sh.getRange(first, 1, last - first + 1, LOG_HEAD.length).getDisplayValues();
  var asked = {};
  readReqs_().forEach(function (r) {
    if (r.name === name && r.kind === '정정' && r.state === '대기' && r.what.indexOf('퇴근') === 0) asked[r.date] = true;
  });
  for (var i = vals.length - 1; i >= 0; i--) {
    var v = vals[i];
    var d = parseDate_(v[C.date]);
    if (String(v[C.name]).trim() !== name || !d || d >= today) continue;
    var ago = daysBetween_(d, today);
    if (ago > 7) continue;
    if (fmtTime_(parseTime_(v[C.tIn])) && !fmtTime_(parseTime_(v[C.tOut])) && !asked[d]) {
      return { date: d, dow: DOW[dowOf_(d)], tIn: fmtTime_(parseTime_(v[C.tIn])) };
    }
  }
  return null;
}

/** 직원이 직접 비밀번호 바꾸기. */
function changePin(name, pin, newPin) {
  var p = person_(name);
  if (!p.pin) throw new Error('아직 비밀번호가 없어요. 출근을 찍을 때 정하면 돼요.');
  checkPin_(p, pin);
  newPin = String(newPin == null ? '' : newPin).trim();
  if (!/^\d{4,6}$/.test(newPin)) throw new Error('새 비밀번호는 숫자 4~6자리로 정해주세요.');
  if (newPin === p.pin) throw new Error('지금 비밀번호와 같아요. 다른 번호로 정해주세요.');
  if (EASY_PINS.indexOf(newPin) >= 0) throw new Error('너무 쉬운 번호예요(1234, 0000 같은). 다른 번호로 정해주세요.');
  setStaffCell_(p.row, 'PIN', newPin);
  return { ok: true };
}

/* ───────────── 직원 화면: 근무표 보기, 다음 달 휴무 고르기 ───────────── */

/**
 * 우리 매장 한 달 근무표(누가 언제 쉬는지), 공휴일, 내 휴무·월차·대체휴무.
 * 동료 칸은 쉬는 날·대타만 보여줘요(지각 시간·결근 표시는 본인만).
 */
function getSchedule(name, pin, ym) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  ym = validYm_(ym) || now.ym;
  if ([prevYm_(now.ym), now.ym, nextYm_(now.ym)].indexOf(ym) < 0) throw new Error('지난달·이번 달·다음 달만 볼 수 있어요.');
  return schedule_(p, ym, now);
}

/**
 * 다음 달 휴무 고르기(on=true) / 빼기(on=false). 휴무표에 '휴무?'로 적고, 사장님이 확정하면 '휴무'가 돼요.
 * 규칙: 신청 기간, 휴무금지일, 하루 최대 인원(매장 최대휴무), 한 달 최대 일수(매장 월휴무).
 */
function wishDay(name, pin, date, on) {
  var p = person_(name);
  checkPin_(p, pin);
  var set = settings_();
  var now = nowKst_();
  var ym = nextYm_(now.ym);
  date = parseDate_(date);
  if (!date || date.slice(0, 7) !== ym) throw new Error('다음 달(' + Number(ym.slice(5)) + '월) 날짜만 고를 수 있어요.');
  var w = wishOpen_(set, now);
  if (!w.open) throw new Error(w.msg);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('지금 고르는 사람이 많아요. 잠깐 뒤에 다시 눌러주세요.');
  try {
    var g = monthGrid_(ym, true);
    if (!g || !g.rows[p.name]) { ensureMonth_(ym); g = monthGrid_(ym, true); }
    if (!g || !g.rows[p.name]) throw new Error(ym + ' 휴무표에 이름이 없어요. 사장님께 말씀해주세요.');
    var cur = dayMark_(p.name, date);
    var day = mmdd_(date) + '(' + DOW[dowOf_(date)] + ')';
    if (on) {
      if (cur !== '휴무?') {
        if (cur) throw new Error(day + '은 이미 "' + cur + '"(이)라고 적혀 있어요.');
        var base = String(p.week[dowOf_(date)] || '').trim();
        if (base && !parseSchedule_(base)) throw new Error(day + '은 원래 쉬는 날이에요.');
        if (blockedDay_(set, date)) throw new Error(day + '은 휴무를 고를 수 없는 날이에요. (사장님이 막아 둔 날)');
        var st = storeOf_(p.store);
        var offs = offNames_(p.store, date, p.name);
        if (st && st.maxOff > 0 && offs.length >= st.maxOff) {
          throw new Error(day + '은 이미 ' + offs.join(', ') + ' 님이 쉬어요. (' + p.store + ' 하루 최대 ' + st.maxOff + '명)');
        }
        var mine = monthOffCount_(p.name, ym);
        if (st && st.monthOff > 0 && mine >= st.monthOff) {
          throw new Error('한 달에 휴무는 ' + st.monthOff + '일까지 고를 수 있어요. 고른 날을 하나 빼고 다시 골라주세요.');
        }
        setMark_(date, p.name, function () { return '휴무?'; });
      }
    } else if (cur === '휴무?') {
      setMark_(date, p.name, function () { return ''; });
    } else if (cur) {
      throw new Error(day + '의 "' + cur + '"는 확정된 거라 앱에서 못 빼요. 사장님께 말씀해주세요.');
    }
  } finally {
    lock.releaseLock();
  }
  return schedule_(p, ym, now);
}

/** 직원 텔레그램 알림 켜기 1단계: 봇 링크를 만들어요. 직원이 링크를 열고 [시작]을 누르면 2단계(staffTgCheck). */
function staffTgStart(name, pin) {
  var set = settings_();
  var p = person_(name);
  checkPin_(p, pin);
  if (!set.tgToken) throw new Error('사장님이 아직 텔레그램 알림을 연결하지 않았어요.');
  var bot = set.tgBot;
  if (!bot) {
    bot = String(tgCall_(set.tgToken, 'getMe').username || '');
    if (bot) setSetting_(K.tgBot, bot);
  }
  if (!bot) throw new Error('텔레그램 봇 정보를 읽지 못했어요. 사장님께 말씀해주세요.');
  var code = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 15);
  CacheService.getScriptCache().put('tglink:' + p.name, code, 1800);
  return { bot: bot, url: 'https://t.me/' + bot + '?start=' + code };
}

/** 2단계: 봇이 받은 '/start 코드' 메시지로 직원 채팅방을 찾아 [직원] 텔레그램 칸에 저장해요. */
function staffTgCheck(name, pin) {
  var set = settings_();
  var p = person_(name);
  checkPin_(p, pin);
  if (!set.tgToken) throw new Error('사장님이 아직 텔레그램 알림을 연결하지 않았어요.');
  var code = CacheService.getScriptCache().get('tglink:' + p.name);
  if (!code) throw new Error('연결 시간(30분)이 지났어요. [텔레그램 알림 켜기]를 다시 눌러주세요.');
  var u = tgFind_(set.tgToken, function (x) {
    return x.message && x.message.chat && String(x.message.text || '').trim() === '/start ' + code;
  });
  if (!u) throw new Error('아직 연결 전이에요. 텔레그램 봇 화면에서 [시작]을 누른 뒤 다시 눌러주세요.');
  setStaffCell_(p.row, '텔레그램', String(u.message.chat.id));
  CacheService.getScriptCache().remove('tglink:' + p.name);
  p.tg = String(u.message.chat.id);
  notifyStaff_(set, p, '알림 연결 완료', p.name + ' 님, 앞으로 요청 결과·대타 구함·출근 알림이 여기로 와요. 끄려면 출퇴근 앱에서 [알림 끄기]를 누르세요.');
  return { tg: 'on' };
}

function staffTgOff(name, pin) {
  var p = person_(name);
  checkPin_(p, pin);
  setStaffCell_(p.row, '텔레그램', '');
  return { tg: settings_().tgToken ? 'off' : '' };
}

/* ───────────── 사장님 화면에서 부르는 함수 ───────────── */

/**
 * 사장님 화면 [오늘]. cred = 관리자 비밀번호(글자) 또는 점장 {name, pin}.
 * 점장은 자기 매장 직원만 보고, 폰 승인·비밀번호·텔레그램·정산은 안 보여요.
 */
function adminToday(cred) {
  var a = auth_(cred);
  var set = a.set;
  var admin = a.role === 'admin';
  var now = nowKst_();
  var logs = monthRows_(now.ym).filter(function (r) { return r.date === now.date; });
  var stores = stores_();
  var ctx = { changes: changes_(), stores: stores };
  var active = sortByStore_(staff_().filter(function (p) { return p.active && canSee_(a, p); }), stores);
  var names = active.map(function (p) { return p.name; });
  var list = active.map(function (p) {
    var r = null;
    logs.forEach(function (x) { if (x.name === p.name) r = x; });
    var s = schedFor_(p, now.date, ctx);
    var mark = dayMark_(p.name, now.date);
    var sIn = r ? r.sIn : (s ? fmtTime_(s.start) : '');
    var sOut = r ? r.sOut : (s ? fmtTime_(s.end) : '');
    var changed = null;
    ctx.changes.forEach(function (c) { if (parseDate_(c[0]) === now.date && String(c[1]).trim() === p.name) changed = String(c[2]); });
    var offDay = OFF_RE.test(mark) || OFF_RE.test(String(p.week[now.dow] || '')) || (changed !== null && !parseSchedule_(changed));
    var status;
    if (r && r.tOut) status = '퇴근';
    else if (r && r.tIn) status = '근무중';
    else if (!sIn) status = offDay ? '휴무' : '시간 미정';
    else if (now.min > parseTime_(sIn) + set.grace) status = '미출근';
    else status = '출근 전';
    return {
      name: p.name, store: p.store, sIn: sIn, sOut: sOut,
      tIn: r ? r.tIn : '', tOut: r ? r.tOut : '',
      late: r ? r.late : 0, early: r ? r.early : 0, status: status,
      mark: OFF_RE.test(mark) ? mark : '',
      place: r && r.place && r.place !== p.store ? r.place : '',
    };
  });
  var subs = admin ? subTotals_() : {};
  return {
    role: a.role, me: a.name, myStores: a.stores || [],
    date: now.date, dow: DOW[now.dow], time: now.time, list: list, info: info_(set, a),
    holiday: holidays_()[now.date] || '',
    pending: !admin ? [] : active.filter(function (p) { return devId_(p.request); }).map(function (p) {
      return { name: p.name, label: devText_(p.request) };
    }),
    devices: !admin ? [] : active.map(function (p) {
      return {
        name: p.name, store: p.store, label: p.deviceId ? devText_(p.device) : '',
        pin: !p.pin ? '미정' : weakPin_(p, active) ? '쉬움' : '정함', agreed: p.agreed,
        tg: !!p.tg, sub: subs[p.name] || 0,
      };
    }),
    suspects: suspectsOn_(now.date).filter(function (s) { return admin || names.indexOf(s.name) >= 0; }),
    requests: openReqsForAdmin_(now.date, a),
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
      setStaffCell_(p.row, '등록폰', devCell_(id, devLabel_(p.request), mmdd_(nowKst_().date) + ' 승인'));
    }
    setStaffCell_(p.row, '새폰요청', '');
  } finally {
    lock.releaseLock();
  }
  return adminToday(pin);
}

/** 사장님이 직원 비밀번호를 미리 정하거나 바꿔줘요(잊어버렸을 때). 빈칸이면 지워서 첫 출근 때 직원이 정해요. */
function adminSetPin(pin, name, newPin) {
  adminAuth_(pin);
  var p = null;
  staff_().forEach(function (x) { if (x.name === String(name == null ? '' : name).trim()) p = x; });
  if (!p) throw new Error('직원을 찾을 수 없어요.');
  newPin = String(newPin == null ? '' : newPin).trim();
  if (newPin && !/^\d{4,6}$/.test(newPin)) throw new Error('비밀번호는 숫자 4~6자리로 정해주세요.');
  setStaffCell_(p.row, 'PIN', newPin);
  CacheService.getScriptCache().remove('fail:pin:' + p.name); // 잠김도 풀어줘요
  return adminToday(pin);
}

/** 사장님이 직원 폰 등록을 지워요. 다음에 찍는 폰이 새로 등록돼요. */
function adminResetDevice(pin, name) {
  adminAuth_(pin);
  var p = null;
  staff_().forEach(function (x) { if (x.name === String(name == null ? '' : name).trim()) p = x; });
  if (!p) throw new Error('직원을 찾을 수 없어요.');
  setStaffCell_(p.row, '등록폰', '');
  setStaffCell_(p.row, '새폰요청', '');
  return adminToday(pin);
}

/** 월별 합계·기록. 점장은 자기 매장 직원만, 차감액은 빼고 봐요. */
function adminMonth(cred, ym) {
  var a = auth_(cred);
  ym = validYm_(ym) || nowKst_().ym;
  if (a.role === 'admin') return monthData_(ym);
  var names = staff_().filter(function (p) { return canSee_(a, p); }).map(function (p) { return p.name; });
  var d = monthData_(ym, names);
  d.staff.forEach(function (s) { s.deduct = 0; });
  d.rows.forEach(function (r) { r.deduct = 0; });
  d.noMoney = true;
  return d;
}

function adminExport(pin, ym) {
  adminAuth_(pin);
  return exportMonth_(validYm_(ym) || nowKst_().ym);
}

/** 지금 위치를 그 매장의 위치로 등록해요. 점장은 자기 매장만 (등록하면 사장님께 알려요). */
function adminSetPlace(cred, store, lat, lng) {
  var a = auth_(cred);
  lat = Number(lat);
  lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('위치 값이 이상해요. 다시 시도해주세요.');
  }
  var st = storeOf_(String(store == null ? '' : store).trim());
  if (!st) throw new Error('[매장] 탭에 없는 매장이에요: ' + store);
  if (a.role !== 'admin' && a.stores.indexOf(st.name) < 0) throw new Error('점장님 매장만 등록할 수 있어요.');
  var sh = sheet_(SHEETS.store);
  sh.getRange(st.row, st.cLat + 1).setNumberFormat('@').setValue(lat.toFixed(6));
  sh.getRange(st.row, st.cLng + 1).setNumberFormat('@').setValue(lng.toFixed(6));
  forget_('stores');
  if (a.role !== 'admin') notify_(a.set, '[' + st.name + '] 매장 위치 등록', a.name + ' 점장이 매장 위치를 ' + (st.lat != null ? '다시 ' : '') + '등록했어요.');
  return info_(settings_(), a);
}

/**
 * 다음 달 휴무: 매장마다 직원이 고른 날('휴무?'), 확정된 날('휴무'), 하루 최대 인원을 넘는 날.
 * 점장은 자기 매장만 보고, 확정은 관리자만 해요.
 */
function adminWishes(cred) {
  var a = auth_(cred);
  var now = nowKst_();
  var ym = nextYm_(now.ym);
  var w = wishOpen_(a.set, now);
  var g = monthGrid_(ym);
  var n = daysIn_(ym);
  var people = staff_().filter(function (p) { return p.active; });
  var out = [];
  stores_().forEach(function (st) {
    if (a.role !== 'admin' && a.stores.indexOf(st.name) < 0) return;
    var mates = people.filter(function (p) { return p.store === st.name; });
    if (!mates.length) return;
    var rows = mates.map(function (p) {
      var r = g && g.rows[p.name];
      var wish = [], fixed = [], other = [];
      for (var d = 1; d <= n; d++) {
        var m = r ? String(r.vals[g.cols.day1 + d - 1] || '').trim() : '';
        if (m === '휴무?') wish.push(d);
        else if (/휴무/.test(m)) fixed.push(d);
        else if (m && OFF_RE.test(m)) other.push(d + ' ' + m);
      }
      return { name: p.name, wish: wish, fixed: fixed, other: other, count: wish.length + fixed.length };
    });
    var over = [];
    for (var d = 1; d <= n; d++) {
      var date = ym + '-' + pad2_(d);
      var offs = offNames_(st.name, date, '');
      if (st.maxOff > 0 && offs.length > st.maxOff) over.push({ day: d, dow: DOW[dowOf_(date)], names: offs });
    }
    out.push({
      name: st.name, maxOff: st.maxOff, monthOff: st.monthOff, rows: rows, over: over,
      wishes: rows.reduce(function (s, r) { return s + r.wish.length; }, 0),
    });
  });
  return {
    ym: ym, role: a.role, open: w.open, forced: !!w.forced, window: w.text, hasTab: !!g, stores: out,
    blocked: blockedList_(a.set, ym), holidays: holidaysIn_(ym),
  };
}

/** 관리자: 그 매장(비우면 전체)의 '휴무?'를 '휴무'로 확정해요. */
function adminConfirmWishes(cred, store) {
  adminAuth_(cred);
  store = String(store == null ? '' : store).trim();
  var ym = nextYm_(nowKst_().ym);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var done = 0;
  try {
    var g = monthGrid_(ym, true);
    if (!g) throw new Error(ym + ' 휴무표가 아직 없어요.');
    var n = daysIn_(ym);
    staff_().forEach(function (p) {
      if (!p.active || (store && p.store !== store)) return;
      var r = g.rows[p.name];
      if (!r) return;
      var vals = [], changed = false;
      for (var d = 1; d <= n; d++) {
        var m = String(r.vals[g.cols.day1 + d - 1] || '').trim();
        if (m === '휴무?') { m = '휴무'; changed = true; done++; }
        vals.push(m);
      }
      if (!changed) return;
      g.sh.getRange(r.row, g.cols.day1 + 1, 1, n).setNumberFormat('@').setValues([vals]);
      vals.forEach(function (v, i) { r.vals[g.cols.day1 + i] = v; });
    });
  } finally {
    lock.releaseLock();
  }
  var res = adminWishes(cred);
  res.confirmed = done;
  return res;
}

/* ───────────── 사장님 화면: 휴무표 만들기, 테스트 도구 ───────────── */

/** 휴무표 만들기: 그 달 탭이 없으면 만들고, 있으면 빠진 직원 줄만 넣어요. 공휴일 표시·색칠도 맞춰요. */
function adminMakeMonth(cred, ym) {
  adminAuth_(cred);
  return makeMonth_(ym);
}

/**
 * 앞으로 올 달을 만들 때는 사이에 빠진 달도 차례로 만들어요(지난달 잔여 월차를 이어 받는 수식이 끊기지 않게).
 * 앞뒤 12달 안에서만 돼요.
 */
function makeMonth_(ym) {
  ym = normYm_(ym);
  if (!ym) throw new Error('달을 골라주세요. (예: 2026-12)');
  var now = nowKst_();
  var ahead = monthsBetween_(now.ym, ym);
  if (ahead < -12 || ahead > 12) throw new Error('이번 달 앞뒤 12달 안에서만 만들 수 있어요.');
  var existed = !!book_().getSheetByName(monthName_(ym));
  var before = existed ? Object.keys(monthGrid_(ym, true).rows).length : 0;
  var made = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var g;
  try {
    var list = [];
    if (ahead > 1) for (var m = nextYm_(now.ym); m !== ym; m = nextYm_(m)) list.push(m);
    list.push(ym);
    list.forEach(function (x) {
      if (!book_().getSheetByName(monthName_(x))) made.push(monthName_(x));
      ensureMonth_(x);
    });
    g = monthGrid_(ym, true);
    markHolidays_(g.sh, ym, g.cols.day1);
    monthRules_(g.sh, g.cols.day1);
  } finally {
    lock.releaseLock();
  }
  return {
    ym: ym, name: monthName_(ym), created: !existed, made: made, added: Object.keys(g.rows).length - before,
    staff: staff_().filter(function (p) { return p.active && g.rows[p.name]; }).length,
    holidays: Object.keys(holidaysIn_(ym)).length, url: book_().getUrl() + '#gid=' + g.sh.getSheetId(),
  };
}

/** 테스트: 하루 마감 정리를 미리 봐요. 휴무표·장부를 안 바꾸고 직원에게도 안 보내요. send면 사장님 알림으로도 보내요. */
function adminClosePreview(cred, day, send) {
  var set = adminAuth_(cred);
  var now = nowKst_();
  var date = day === 'yesterday' ? addDays_(now.date, -1) : now.date;
  var res = dailyClose_(set, date, { dry: true });
  var via = send ? notify_(set, '[미리 보기] 하루 마감 정리', res.text + '\n\n※ 미리 보기라 휴무표·장부는 그대로예요.') : '';
  if (send && !via) throw new Error('알림 받을 곳이 없어요. 텔레그램을 연결하거나 [설정] 탭 알림이메일을 넣어주세요.');
  return {
    date: date, text: res.text, via: via,
    done: !!PropertiesService.getScriptProperties().getProperty('close:' + date), // 진짜 마감 정리가 이미 돌았는지
  };
}

/** 테스트: 사장님께 시험 알림. 어디로 갔는지('텔레그램'/'메일') 돌려줘요. */
function adminNotifyTest(cred) {
  var set = adminAuth_(cred);
  var via = notify_(set, '시험 알림', '알림이 잘 와요. 사장님 화면 [설정] → 테스트에서 보낸 메시지예요.');
  if (via) return { via: via };
  if (set.tgToken && set.tgChat) throw new Error('텔레그램으로 못 보냈어요. [설정] 탭 텔레그램 연결을 다시 확인해주세요.');
  throw new Error('알림 받을 곳이 없어요. 텔레그램을 연결하거나 [설정] 탭 알림이메일을 넣어주세요.');
}

/** 테스트: 다음 달 휴무 고르기를 오늘만 열어요(on=false면 닫아요). [설정] 휴무신청기간은 그대로예요. */
function adminWishOpen(cred, on) {
  adminAuth_(cred);
  var key = 'wishOpen:' + nowKst_().date;
  var props = PropertiesService.getScriptProperties();
  if (on) props.setProperty(key, '1'); else props.deleteProperty(key);
  var ym = nextYm_(nowKst_().ym);
  if (on && !book_().getSheetByName(monthName_(ym))) makeMonth_(ym); // 고를 휴무표가 없으면 만들어 둬요
  return adminWishes(cred);
}

/**
 * 테스트 직원 만들기: [직원]에 '테스트' 줄을 그 매장으로 넣어요(이미 있으면 매장만 바꿔요).
 * 비밀번호는 비워 둬서 처음 찍을 때 정해요. 이번 달·다음 달 휴무표에도 줄을 넣어요.
 */
function adminTestStaff(cred, store) {
  adminAuth_(cred);
  var st = storeOf_(String(store == null ? '' : store).trim()) || stores_()[0];
  if (!st) throw new Error('[매장] 탭에 매장을 먼저 넣어주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var p = findStaff_(TEST_NAME);
    var sh = sheet_(SHEETS.staff);
    var row = p ? p.row : Math.max(sh.getLastRow(), 1) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 10);
    if (!p) setStaffCell_(row, '이름', TEST_NAME);
    setStaffCell_(row, '매장', st.name);
    setStaffCell_(row, '재직', '');
    var now = nowKst_();
    [now.ym, nextYm_(now.ym)].forEach(function (ym) { if (book_().getSheetByName(monthName_(ym))) ensureMonth_(ym); });
  } finally {
    lock.releaseLock();
  }
  return adminToday(cred);
}

/**
 * 테스트 지우기: '테스트' 직원과 그 사람 기록을 통째로 지워요.
 * [출퇴근기록]·[요청]·[근무변경]·[의심기록]·[대체휴무]에서 이름이 정확히 '테스트'인 줄, 휴무표마다 그 줄, [직원] 그 줄.
 */
function adminTestClear(cred) {
  adminAuth_(cred);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var n = 0;
  try {
    var ss = book_();
    [[SHEETS.log, C.name + 1], [SHEETS.req, R.name + 1], [SHEETS.change, 2], [SHEETS.suspect, 2], [SHEETS.sub, 2]].forEach(function (x) {
      n += deleteRowsNamed_(ss.getSheetByName(x[0]), x[1], 2);
    });
    ss.getSheets().forEach(function (sh) {
      if (sh.getName().indexOf(MONTH_PREFIX) !== 0) return;
      var g = monthGrid_(sh.getName().slice(MONTH_PREFIX.length), true);
      if (g) n += deleteRowsNamed_(sh, g.cols.name + 1, 3);
    });
    var col = staffCols_()['이름'];
    n += deleteRowsNamed_(sheet_(SHEETS.staff), (col == null ? 0 : col) + 1, 2);
    MEMO_ = {};
    GRID_ = {};
    var cache = CacheService.getScriptCache();
    cache.remove('fail:pin:' + TEST_NAME);
    cache.remove('tglink:' + TEST_NAME);
  } finally {
    lock.releaseLock();
  }
  var t = adminToday(cred);
  t.removed = n;
  return t;
}

/** 그 칸(col, 1부터)이 정확히 '테스트'인 줄을 아래에서부터 지워요. 지운 줄 수를 돌려줘요. */
function deleteRowsNamed_(sh, col, first) {
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < first) return 0;
  var vals = sh.getRange(first, col, last - first + 1, 1).getDisplayValues();
  var n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() === TEST_NAME) {
      sh.deleteRow(first + i);
      n++;
    }
  }
  return n;
}

/* ───────────── 요청: 출퇴근 정정, 휴무, 대타 ───────────── */
/*
 * 정정: 대기 → 승인(출퇴근기록에 반영) / 거절 / 취소
 * 휴무·월차·반차·대체: 대기 → 승인(휴무표에 적음) / 거절 / 취소
 * 대타: 대기(구하는 중) → 수락(동료가 '제가 할게요') → 승인([근무변경]에 두 사람 반영) / 거절 / 취소
 *
 * 누가 먼저 보나([요청] 보낼곳 칸):
 *  - 점장: 그 매장 점장이 먼저 보고 [관리자에게 올리기](보낼곳 → 관리자) 또는 [돌려보내기](상태 → 돌려보냄)
 *  - 관리자: 관리자에게 바로. 점장이 없는 매장, 점장 본인 요청도 관리자에게 가요
 * 승인·거절은 관리자만 해요. 점장 확인 전이라도 관리자는 바로 처리할 수 있어요.
 */

/** 직원 화면: 내 요청과, 동료가 올린 대타 구함 목록. */
function getRequests(name, pin) {
  var p = person_(name);
  checkPin_(p, pin);
  return reqsFor_(p.name);
}

/**
 * 직원 화면: 요청 보내기.
 * req = {name, pin, kind: 'fix'|'off'|'swap', offType: '휴무'|'월차'|'반차'|'대체', date, type: 'in'|'out', time, reason,
 *        to: 'mgr'(점장에게, 기본) | 'admin'(관리자에게 바로)}
 */
function makeRequest(req) {
  req = req || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var set, p, r;
  try {
    set = settings_();
    p = person_(req.name);
    checkPin_(p, req.pin);
    var kind = { fix: '정정', off: '휴무', swap: '대타' }[req.kind];
    if (kind === '휴무' && OFF_KINDS.indexOf(req.offType) >= 0) kind = req.offType;
    if (!kind) throw new Error('요청 종류가 이상해요. 화면을 새로고침 해주세요.');
    var now = nowKst_();
    var date = parseDate_(req.date);
    if (!date) throw new Error('날짜를 골라주세요.');
    var reason = clean_(req.reason, 100);
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
      if (kind !== '대타' && !reason) throw new Error('사유를 적어주세요.');
      all.forEach(function (r) {
        if (r.name === p.name && r.date === date && isDayOffKind_(r.kind) && /대기|수락|승인/.test(r.state)) {
          throw new Error(mmdd_(date) + '은 이미 ' + KIND_NAME[r.kind] + ' 요청이 있어요.');
        }
      });
      if (kind === '대체') {
        var bal = subBalance_(p.name);
        if (bal.left - bal.pending < 1) {
          throw new Error('쓸 수 있는 대체휴무가 없어요. (남은 대체휴무 ' + fmtDays_(bal.left) + '일' +
            (bal.pending ? ', 이미 신청한 ' + bal.pending + '일' : '') + ')');
        }
      }
      what = fmtSched_(s);
    }

    // 점장이 있으면 점장에게(직원이 '관리자에게 바로'를 고르면 관리자에게)
    var route = req.to === 'admin' || !managersOf_(p.store, p.name).length ? '관리자' : '점장';
    var sh = reqSheet_();
    // 번호: 시각 기반, 이미 있는 번호와 겹치면 -2, -3 … 을 붙여요
    var base = 'R' + Date.now().toString(36).toUpperCase(), id = base, n = 2;
    var taken = function (x) { return all.some(function (q) { return q.id === x; }); };
    while (taken(id)) id = base + '-' + n++;
    r = {
      id: id,
      at: now.date + ' ' + now.time, name: p.name, kind: kind, date: date, what: what, reason: reason, state: '대기',
      route: route,
    };
    putReq_(sh, Math.max(sh.getLastRow(), 1) + 1, r);
  } finally {
    lock.releaseLock();
  }
  // 알림은 줄(잠금) 밖에서 보내요. 텔레그램이 느려도 다른 직원 출근이 밀리지 않게
  var when = whenOf_(r.date);
  if (r.kind === '대타') {
    // 같은 매장 동료 중 텔레그램 알림을 켠 사람에게
    staff_().forEach(function (q) {
      if (q.active && q.name !== p.name && q.store === p.store) {
        notifyStaff_(set, q, '동료가 대타를 구해요', when + ' ' + r.what + ' · ' + p.name + ' 님 대신\n할 수 있으면 출퇴근 앱에서 [제가 할게요]를 눌러주세요.');
      }
    });
    toApprover_(set, r, p, p.name + ' · 대타 구하는 중', when + ' ' + r.what + (r.reason ? '\n사유: ' + r.reason : '') +
      '\n동료가 수락하면 다시 알려드려요.', true);
  } else {
    toApprover_(set, r, p, p.name + ' · ' + KIND_NAME[r.kind] + ' 요청', when + ' ' + reqLine_(r) + '\n사유: ' + r.reason);
  }
  return reqsFor_(p.name);
}

/** 직원 화면: 동료의 대타 요청에 '제가 할게요'. */
function takeSwap(name, pin, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var set, p, r;
  try {
    set = settings_();
    p = person_(name);
    checkPin_(p, pin);
    r = findReq_(id);
    if (!r || r.kind !== '대타') throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.name === p.name) throw new Error('본인 요청은 수락할 수 없어요.');
    if (r.state !== '대기') throw new Error('이미 다른 사람이 수락했거나 끝난 요청이에요.');
    if (daysBetween_(nowKst_().date, r.date) < 0) throw new Error('지난 날짜예요.');
    r.state = '수락';
    r.taker = p.name;
    putReq_(reqSheet_(), r.row, r);
  } finally {
    lock.releaseLock();
  }
  var mine = schedFor_(p, r.date);
  var asker = findStaff_(r.name) || { name: r.name, store: '' };
  var when = whenOf_(r.date);
  toApprover_(set, r, asker, '대타 수락 · ' + (r.route === '점장' ? '확인해주세요' : '승인해주세요'),
    when + ' ' + r.name + ' ' + r.what + ' → ' + p.name + ' 님이 대신 근무' +
    (mine ? '\n※ ' + p.name + ' 님은 그날 원래 ' + fmtSched_(mine) + ' 근무라서, 승인하면 두 시간을 합쳐요.' : ''));
  notifyStaff_(set, asker, '대타를 구했어요', when + ' ' + r.what + ' → ' + p.name + ' 님이 해주기로 했어요. 승인되면 근무표가 바뀌어요.');
  return reqsFor_(p.name);
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
      // 점장이 이미 관리자에게 올렸던 거면, 새 대타가 정해졌을 때 점장이 다시 봐요
      if (/^올림/.test(r.mgr || '')) {
        var asker = findStaff_(r.name);
        r.route = asker && managersOf_(asker.store, asker.name).length ? '점장' : '관리자';
        r.mgr = '';
      }
    } else {
      throw new Error('이미 처리된 요청이라 취소할 수 없어요.');
    }
    putReq_(reqSheet_(), r.row, r);
    return reqsFor_(p.name);
  } finally {
    lock.releaseLock();
  }
}

/** 관리자: 요청 승인(ok=true) 또는 거절. 승인하면 기록·근무표에 바로 반영되고, 직원에게 결과를 알려요. */
function adminRequest(cred, id, ok) {
  var set = adminAuth_(cred);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var r;
  try {
    r = findReq_(id);
    if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.state !== '대기' && r.state !== '수락') throw new Error('이미 ' + doneText_(r.state) + ' 요청이에요.');
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
  tellResult_(set, r);
  return adminToday(cred);
}

/** 점장: 직원 요청을 확인하고 관리자에게 올려요. 한마디(note)를 붙일 수 있어요. */
function mgrForward(cred, id, note) {
  var a = auth_(cred);
  if (a.role !== 'manager') throw new Error('점장 화면에서만 쓰는 기능이에요.');
  note = clean_(note, 100);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var r;
  try {
    r = findReq_(id);
    mgrCheck_(a, r);
    if (r.kind === '대타' && !r.taker) throw new Error('아직 대타를 해줄 동료가 없어요. 동료가 수락하면 올릴 수 있어요.');
    var now = nowKst_();
    r.route = '관리자';
    r.mgr = '올림 ' + mmdd_(now.date) + ' ' + now.time + ' ' + a.name + (note ? ' · ' + note : '');
    putReq_(reqSheet_(), r.row, r);
  } finally {
    lock.releaseLock();
  }
  var p = findStaff_(r.name) || { name: r.name, store: '' };
  toApprover_(a.set, r, p, r.name + ' · ' + KIND_NAME[r.kind] + ' 요청 (점장 확인)',
    whenOf_(r.date) + ' ' + reqLine_(r) + (r.reason ? '\n사유: ' + r.reason : '') + '\n점장 ' + a.name + ': ' + (note || '확인했어요'));
  return adminToday(cred);
}

/** 점장: 요청을 직원에게 돌려보내요(사유 필수). 직원은 고쳐서 다시 보낼 수 있어요. */
function mgrReturn(cred, id, reason) {
  var a = auth_(cred);
  if (a.role !== 'manager') throw new Error('점장 화면에서만 쓰는 기능이에요.');
  reason = clean_(reason, 100);
  if (!reason) throw new Error('돌려보내는 이유를 적어주세요. 직원에게 그대로 보여요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var r;
  try {
    r = findReq_(id);
    mgrCheck_(a, r);
    var now = nowKst_();
    r.state = '돌려보냄';
    r.done = now.date + ' ' + now.time;
    r.mgr = '돌려보냄 ' + mmdd_(now.date) + ' ' + now.time + ' ' + a.name + ' · ' + reason;
    putReq_(reqSheet_(), r.row, r);
  } finally {
    lock.releaseLock();
  }
  tellResult_(a.set, r);
  return adminToday(cred);
}

/** 점장이 이 요청을 처리할 수 있는지: 아직 열려 있고, 점장 차례이고, 점장 매장 직원의 요청. */
function mgrCheck_(a, r) {
  if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
  if (r.state !== '대기' && r.state !== '수락') throw new Error('이미 ' + doneText_(r.state) + ' 요청이에요. 새로고침 해주세요.');
  if (r.route !== '점장') throw new Error('이미 관리자에게 올라간 요청이에요.');
  var p = findStaff_(r.name);
  if (!p || a.stores.indexOf(p.store) < 0) throw new Error('점장님 매장 직원의 요청만 처리할 수 있어요.');
  if (r.name === a.name) throw new Error('본인 요청은 다른 점장이나 관리자가 처리해요.');
  if (r.taker === a.name) throw new Error('본인이 대타를 맡은 요청은 다른 점장이나 관리자가 처리해요.');
}

function doneText_(state) {
  return { '승인': '승인된', '거절': '거절된', '취소': '취소된', '돌려보냄': '점장이 돌려보낸' }[state] || state + ' 상태인';
}

/**
 * 요청을 처리할 사람에게 알려요.
 *  - 보낼곳이 점장: 점장 텔레그램으로. 점장이 알림을 안 켰으면 사장님께 보내요(요청이 묻히지 않게)
 *  - 관리자: 사장님 알림(텔레그램·메일)
 * infoOnly: 아직 처리할 게 없는 알림(대타 구하는 중)
 */
function toApprover_(set, r, p, title, body, infoOnly) {
  var where = p && p.store ? '[' + p.store + '] ' : '';
  if (r.route === '점장') {
    var mgrs = managersOf_(p.store, p.name).filter(function (n) { return n !== r.taker; });
    var sent = 0;
    mgrs.forEach(function (n) {
      var url = adminUrl_();
      if (notifyStaff_(set, findStaff_(n), where + title, body +
        (infoOnly ? '' : '\n출퇴근 관리 화면에서 [관리자에게 올리기] 또는 [돌려보내기]를 눌러주세요.') + (url ? '\n관리 화면: ' + url : ''))) sent++;
    });
    if (sent) return true;
    return notify_(set, where + title + ' (점장 확인 전)', body + (mgrs.length ? '\n※ ' + mgrs.join(', ') + ' 점장이 텔레그램 알림을 안 켜서 사장님께도 보내요.' : ''));
  }
  return notify_(set, where + title, body + (infoOnly ? '' : '\n사장님 화면에서 승인해주세요.'));
}

/** 승인·거절·돌려보냄 결과를 직원(대타면 대신 일할 사람도)에게 알려요. 텔레그램을 켠 사람만. */
function tellResult_(set, r) {
  var msg = { '승인': '승인됐어요', '거절': '거절됐어요', '돌려보냄': '점장이 돌려보냈어요' }[r.state];
  if (!msg) return;
  var when = whenOf_(r.date);
  var why = r.state === '돌려보냄' ? '\n이유: ' + String(r.mgr).replace(/^.*?·\s*/, '') + '\n고쳐서 다시 보낼 수 있어요.' : '';
  notifyStaff_(set, findStaff_(r.name), KIND_NAME[r.kind] + ' 요청' + (r.state === '돌려보냄' ? '을 ' : '이 ') + msg, when + ' ' + reqLine_(r) + why);
  if (r.kind === '대타' && r.taker && r.state !== '돌려보냄') {
    notifyStaff_(set, findStaff_(r.taker), '대타가 ' + msg, when + ' ' + r.name + ' 님 대신 ' + r.what +
      (r.state === '승인' ? ' 근무가 확정됐어요.' : ' 근무는 없던 일이 됐어요.'));
  } else if (r.kind === '대타' && r.taker) {
    notifyStaff_(set, findStaff_(r.taker), '대타가 취소됐어요', when + ' ' + r.name + ' 님 대신 ' + r.what + ' 근무는 없던 일이 됐어요.');
  }
}

/** '10:00-20:00 근무 → 휴무', '퇴근 21:00', '10:00-20:00 → 박준호 님이 대신 근무' */
function reqLine_(r) {
  if (r.kind === '정정') return r.what;
  if (r.kind === '대타') return r.what + (r.taker ? ' → ' + r.taker + ' 님이 대신 근무' : ' 대타');
  return r.what + ' 근무 → ' + KIND_NAME[r.kind];
}

function whenOf_(date) { return mmdd_(date) + '(' + DOW[dowOf_(date)] + ')'; }

function clean_(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

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
  setSetting_(K.tgBot, me.username || '');
  return { bot: me.username || '', code: ownerTgCode_(true), info: info_(settings_()) };
}

/** 사장님 채팅방을 찾을 연결 코드(숫자 6자리, 30분). fresh면 새로 만들어요. */
function ownerTgCode_(fresh) {
  var cache = CacheService.getScriptCache();
  var code = fresh ? '' : cache.get('tgowner');
  if (!code) code = String(100000 + Math.floor(Math.random() * 900000));
  cache.put('tgowner', code, 1800);
  return code;
}

/** 사장님 화면: 봇 토큰만 저장된 상태에서 보여줄 연결 코드. */
function adminTelegramCode(pin) {
  var set = adminAuth_(pin);
  if (!set.tgToken) throw new Error('봇 토큰을 먼저 저장해주세요.');
  return { bot: set.tgBot, code: ownerTgCode_(false) };
}

/**
 * 2단계: 사장님이 봇(또는 봇을 초대한 단톡방)에 보낸 '/start 연결코드'로 채팅방을 찾아 저장하고, 시험 메시지를 보내요.
 * 연결 코드가 맞는 메시지만 봐서, 같은 때 직원이 봇에게 말을 걸어도 직원 채팅방이 잘못 연결되지 않아요.
 */
function adminTelegramLink(pin) {
  var set = adminAuth_(pin);
  if (!set.tgToken) throw new Error('봇 토큰을 먼저 저장해주세요.');
  var code = CacheService.getScriptCache().get('tgowner');
  if (!code) throw new Error('연결 코드 시간(30분)이 지났어요. 화면을 새로고침하면 새 코드가 나와요.');
  var re = new RegExp('^/start(@\\w+)?\\s+(own)?' + code + '$');
  var u = tgFind_(set.tgToken, function (x) {
    var m = x.message || x.channel_post;
    return !!(m && m.chat && re.test(String(m.text || '').trim()));
  });
  if (!u) throw new Error('봇에게 온 연결 코드가 없어요. 텔레그램에서 봇에게 "/start ' + code + '"를 보낸 뒤 다시 눌러주세요.');
  var chat = (u.message || u.channel_post).chat;
  CacheService.getScriptCache().remove('tgowner');
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
  setSetting_(K.tgBot, '');
  return info_(settings_());
}

/**
 * 봇이 받은 메시지(getUpdates) 중 pred에 맞는 가장 최근 것. 100개가 넘게 쌓였으면 다음 묶음도 봐요.
 * (텔레그램은 안 읽은 메시지를 24시간 보관해요)
 */
function tgFind_(token, pred) {
  var found = null, offset = 0;
  for (var i = 0; i < 5; i++) {
    var list = tgCall_(token, 'getUpdates', offset ? { limit: 100, offset: offset } : { limit: 100 }) || [];
    list.forEach(function (u) { if (pred(u)) found = u; });
    if (list.length < 100) break;
    offset = list[list.length - 1].update_id + 1;
  }
  return found;
}

/* ───────────── 시트 메뉴, 자동 실행 ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('출퇴근')
    .addItem('처음 설정 (한 번만)', 'setup')
    .addItem('휴무표 만들기 (원하는 달)…', 'menuMakeMonth')
    .addItem('휴무표에 새 직원 넣기 (이번 달·다음 달)', 'menuMonths')
    .addItem('하루 마감 정리 미리 보기 (오늘)', 'menuClosePreview')
    .addItem('이번 달 정산 시트 만들기', 'menuExportThis')
    .addItem('지난 달 정산 시트 만들기', 'menuExportPrev')
    .addToUi();
}

function menuExportThis() { exportFromMenu_(nowKst_().ym); }

function menuMonths() {
  SpreadsheetApp.getUi(); // 시트 메뉴에서만
  var ym = nowKst_().ym;
  ensureMonth_(ym);
  ensureMonth_(nextYm_(ym));
  book_().toast('휴무표에 빠진 직원을 넣었어요.');
}
function menuExportPrev() { exportFromMenu_(prevYm_(nowKst_().ym)); }

/** 시트 메뉴: 원하는 달 휴무표 만들기. */
function menuMakeMonth() {
  var ui = SpreadsheetApp.getUi();
  var next = nextYm_(nowKst_().ym);
  var r = ui.prompt('휴무표 만들기', '만들 달을 적어주세요. 비워두면 ' + next + '\n(이미 있으면 빠진 직원만 넣고 공휴일 표시를 맞춰요)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var res = makeMonth_(String(r.getResponseText() || '').trim() || next);
  book_().setActiveSheet(book_().getSheetByName(res.name));
  book_().toast("'" + res.name + "' " + (res.created ? '탭을 만들었어요.' : '탭에 빠진 직원 ' + res.added + '명을 넣었어요.'));
}

/** 시트 메뉴: 오늘 마감 정리 미리 보기(아무것도 안 바꿔요). */
function menuClosePreview() {
  var ui = SpreadsheetApp.getUi();
  var res = dailyClose_(settings_(), nowKst_().date, { dry: true });
  ui.alert('하루 마감 정리 미리 보기', res.text + '\n\n※ 미리 보기라 휴무표·장부는 그대로이고, 아무에게도 안 보내요.', ui.ButtonSet.OK);
}

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
    vals.forEach(function (v) {
      var d = parseDate_(v[C.date]);
      if (d) syncLateMark_(d, String(v[C.name]).trim(), v);
    });
  } catch (err) {
    console.error(err);
  }
}

/**
 * 10분마다 자동 실행.
 *  - 이번 달 휴무표(새 직원 줄 포함)를 챙기고, 20일부터는 다음 달 휴무표도 미리 만들어요
 *  - 텔레그램을 켠 직원: 출근 몇 분 전 알림, 출근 시간이 지났는데 안 찍었으면 본인에게 알림
 *  - 사장님: 출근 시간이 지났는데 안 찍은 직원 알림
 *  - 밤 11시 30분이 지나면 하루 마감 정리(dailyClose_)를 한 번
 */
function checkMissing() {
  var set = settings_();
  var now = nowKst_();
  ensureMonth_(now.ym);
  if (Number(now.date.slice(8)) >= 20) ensureMonth_(nextYm_(now.ym));
  var props = PropertiesService.getScriptProperties();
  var sent = props.getProperties();
  Object.keys(sent).forEach(function (k) {
    var m = /^(alert|pre|close|dm|wishOpen):(\d{4}-\d{2}-\d{2})/.exec(k);
    if (m && daysBetween_(m[2], now.date) > (m[1] === 'close' || m[1] === 'dm' ? 3 : 0)) props.deleteProperty(k);
  });

  // 하루 마감 정리: 23:30 이후 한 번. 그 시간에 못 돌았으면 새벽(6시 전)에 어제 것을 해요
  var closeDay = now.min >= 23 * 60 + 30 ? now.date : now.min < 6 * 60 ? addDays_(now.date, -1) : '';
  if (closeDay && !sent['close:' + closeDay]) {
    // 두 번 겹쳐 돌지 않게 줄을 서고, 줄 안에서 이미 끝났는지 한 번 더 봐요.
    // 중간에 오류가 나면 표시를 안 해서 10분 뒤 다시 해요(결근?·대체휴무·직원 알림은 두 번 안 들어가요)
    var lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      try {
        if (!props.getProperty('close:' + closeDay)) {
          dailyClose_(set, closeDay);
          props.setProperty('close:' + closeDay, '1');
        }
      } finally {
        lock.releaseLock();
      }
    }
  }

  if (now.min < 7 * 60 || now.min >= 23 * 60) return; // 밤에는 출근 알림 검사 안 해요
  var owner = !!(set.email || (set.tgToken && set.tgChat));
  if (!owner && !set.tgToken) return;
  var logs = monthRows_(now.ym).filter(function (r) { return r.date === now.date; });
  // 공휴일에는 그 매장에 누가 출근해야 연 날로 봐요(설·추석처럼 매장이 쉬는 날 알림이 쏟아지지 않게)
  var hol = holidays_()[now.date] || '';
  var opened = openedStores_(logs);
  var ctx = { changes: changes_(), stores: stores_() };
  var missing = [];
  staff_().filter(function (p) { return p.active; }).forEach(function (p) {
    var s = schedFor_(p, now.date, ctx);
    if (!s) return;
    if (logs.some(function (r) { return r.name === p.name && r.tIn; })) return;
    if (hol && !opened[p.store]) return;
    // 출근 전 알림 (텔레그램을 켠 직원만)
    if (p.tg && set.tgToken && set.remind > 0 && now.min >= s.start - set.remind && now.min < s.start) {
      var pre = 'pre:' + now.date + ':' + p.name;
      if (!sent[pre]) {
        props.setProperty(pre, '1');
        notifyStaff_(set, p, '곧 출근이에요', '오늘 ' + fmtTime_(s.start) + ' 출근' + (p.store ? ' (' + p.store + ')' : '') + '. 도착하면 출근을 찍어주세요.');
      }
    }
    if (now.min < s.start + set.alertMin || now.min > s.start + 180) return;
    var key = 'alert:' + now.date + ':' + p.name;
    if (sent[key]) return;
    props.setProperty(key, '1');
    missing.push((p.store ? '[' + p.store + '] ' : '') + p.name + ' (출근 예정 ' + fmtTime_(s.start) + ')');
    notifyStaff_(set, p, '아직 출근을 안 찍었어요', '오늘 ' + fmtTime_(s.start) + ' 출근이에요. 출근했다면 지금 찍어주세요.');
  });
  if (!missing.length || !owner) return;
  notify_(set, '아직 출근 안 찍은 직원 ' + missing.length + '명', now.date + ' ' + now.time + ' 기준\n' + missing.join('\n'));
}

/**
 * 하루 마감 정리 (밤 11시 30분 이후 한 번).
 *  - 근무하는 날인데 기록이 하나도 없으면 휴무표에 '결근?' (그날 요청을 보낸 사람은 빼요.
 *    공휴일에 그 매장에 출근한 사람이 아무도 없으면 매장이 쉰 날일 수 있어서 적지 않고 요약에만 넣어요)
 *  - 퇴근을 안 찍은 사람: 목록에 넣고 본인에게 알림
 *  - 쉬는 날·공휴일에 출근한 사람: [대체휴무]에 적립(설정 '대체휴무적립'에 따라. 4시간 이상 1일, 미만 0.5일)
 *    '쉬는 날'은 근무변경·휴무표·[직원] 요일 칸에 쉰다고 적힌 날만이에요(근무시간이 아직 안 정해진 사람은 아니에요)
 *  - 사장님께 하루 요약(조용히 보내요)
 */
function dailyClose_(set, date, opts) {
  var dry = !!(opts && opts.dry); // 미리 보기: 휴무표·장부를 안 바꾸고, 아무에게도 안 보내요
  var props = PropertiesService.getScriptProperties();
  var ym = date.slice(0, 7);
  var logs = monthRows_(ym).filter(function (r) { return r.date === date; });
  var opened = openedStores_(logs);
  var ctx = { changes: changes_(), stores: stores_() };
  var reqs = readReqs_();
  var hol = holidays_()[date] || '';
  var res = { absent: [], holNone: [], noOut: [], noIn: [], offWork: [], holWork: [], came: 0, late: 0, credit: 0 };
  sortByStore_(staff_().filter(function (p) { return p.active; }), ctx.stores).forEach(function (p) {
    var s = schedFor_(p, date, ctx);
    var r = null;
    logs.forEach(function (x) { if (x.name === p.name) r = x; });
    var tag = (p.store ? '[' + p.store + '] ' : '') + p.name;
    if (r && r.tIn) { res.came++; if (r.late) res.late++; }
    if (s && !(r && (r.tIn || r.tOut))) {
      var asked = reqs.some(function (q) { return q.name === p.name && q.date === date && (q.state === '대기' || q.state === '수락'); });
      if (asked) {
        // 그날 요청(정정·휴무 등)을 보낸 사람은 처리 결과를 기다려요
      } else if (hol && !opened[p.store]) {
        res.holNone.push(tag);
      } else {
        if (!dry) setMark_(date, p.name, function (old) { return old || '결근?'; });
        res.absent.push(tag + ' (예정 ' + fmtTime_(s.start) + ')');
      }
    }
    if (r && r.tIn && !r.tOut) {
      res.noOut.push(tag + ' (출근 ' + r.tIn + ')');
      var dm = 'dm:' + date + ':' + p.name;
      if (!dry && !props.getProperty(dm) && notifyStaff_(set, p, '퇴근을 안 찍었어요', whenOf_(date) + ' 출근 ' + r.tIn + '. 실제 퇴근 시간을 출퇴근 앱 [기록 정정]으로 알려주세요.', { silent: true })) {
        props.setProperty(dm, '1');
      }
    }
    if (r && !r.tIn && r.tOut) res.noIn.push(tag + ' (퇴근 ' + r.tOut + ')');
    if (!(r && r.tIn)) return;
    var offDay = !s && offDayKnown_(p, date, ctx.changes);
    if (!offDay && !hol) return;
    var why = offDay ? '휴무날 출근' : '공휴일(' + hol + ') 출근';
    (offDay ? res.offWork : res.holWork).push(tag + (r.tOut ? ' ' + hm_(r.work) : ' (퇴근 안 찍음)'));
    var credit = set.subMode === '휴무날·공휴일' || (offDay && set.subMode === '휴무날만');
    if (!credit) return;
    var days = !r.tOut || r.work >= 240 ? 1 : 0.5;
    if (dry) { if (!subCredited_(date, p.name)) res.credit += days; return; }
    if (addSubOnce_(date, p.name, days, why + (r.tOut ? ' ' + hm_(r.work) : ' · 퇴근을 안 찍어서 1일로 적음(확인 필요)'))) res.credit += days;
  });

  var lines = [whenOf_(date) + (hol ? ' ' + hol : '') + ' · 출근 ' + res.came + '명' + (res.late ? ', 지각 ' + res.late + '명' : '')];
  var add = function (title, list, tail) { if (list.length) lines.push('', title + ' ' + list.length + '명' + (tail || ''), list.join('\n')); };
  // 미리 보기는 아직 안 한 일이라 '적어요·쌓아요'로 말해요
  add('결근? (기록 없음)', res.absent, ' → 휴무표에 "결근?"으로 ' + (dry ? '적어요' : '적었어요'));
  add('공휴일에 아무도 출근 안 한 매장이라 결근?으로 안 적음', res.holNone);
  add('퇴근 안 찍음', res.noOut);
  add('출근 안 찍음', res.noIn);
  var piled = dry ? ' → 대체휴무로 쌓아요' : ' → 대체휴무로 쌓았어요';
  add('쉬는 날 출근', res.offWork, set.subMode !== '안함' ? piled : '');
  add('공휴일 출근', res.holWork, set.subMode === '휴무날·공휴일' ? piled : '');
  if (lines.length === 1) lines.push('빠진 기록 없이 모두 정상이에요.');
  res.text = lines.join('\n');
  if (!dry) notify_(set, '하루 마감 정리', res.text, { silent: true });
  return res;
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

  var store = ensureSheet_(ss, SHEETS.store, STORE_HEAD, [['본점', '11:00', '', '', '', '', '', '', '1', '']], STORE_HEAD.map(function () { return '@'; }));
  // 예전 [매장] 탭에 없는 칸(점장, 최대휴무, 월휴무)은 오른쪽 끝에 붙여요
  var sc = addHeads_(store, STORE_HEAD);
  var notes = {
    '점장': '그 매장 점장 이름([직원] 탭과 똑같이). 여러 명이면 쉼표로. 점장은 직원 요청을 먼저 보고 관리자에게 올리거나 돌려보내요',
    '최대휴무': '하루에 쉴 수 있는 사람 수. 비우면 1명, 0이면 제한 없음. 직원이 다음 달 휴무를 고를 때 확인해요',
    '월휴무': '직원 한 명이 한 달에 고를 수 있는 휴무 일수. 비우면 제한 없음',
  };
  Object.keys(notes).forEach(function (h) { store.getRange(1, sc[h] + 1).setNote(notes[h]); });
  forget_('stores');
  var staff = ensureSheet_(ss, SHEETS.staff, STAFF_HEAD,
    [['예시직원', '본점', '', 10320, '', '', '', '', '', '', '', '', '', '']],
    STAFF_HEAD.map(function (h) { return STAFF_FMT[h] || '@'; }));
  // 예전에 만든 [직원] 시트에 없는 칸(매장, 등록폰 등)은 오른쪽 끝에 붙이고 서식을 맞춰요
  var have2 = staffCols_();
  STAFF_HEAD.forEach(function (h) {
    if (have2[h] != null) return;
    var c = Math.max(staff.getLastColumn(), 1) + 1;
    staff.getRange(1, c).setValue(h).setFontWeight('bold').setBackground('#eef2f7');
    have2[h] = c - 1;
  });
  Object.keys(have2).forEach(function (h) {
    if (STAFF_HEAD.indexOf(h) >= 0) staff.getRange(2, have2[h] + 1, staff.getMaxRows() - 1, 1).setNumberFormat(STAFF_FMT[h] || '@');
  });
  ensureSheet_(ss, SHEETS.change, CHANGE_HEAD, [], ['@', '@', '@', '@']);
  ensureSheet_(ss, SHEETS.log, LOG_HEAD, [], LOG_FMT);
  ensureSheet_(ss, SHEETS.suspect, SUSPECT_HEAD, [], ['@', '@', '@', '@']);
  var rq = ensureSheet_(ss, SHEETS.req, REQ_HEAD, [], REQ_HEAD.map(function () { return '@'; }));
  // 예전 [요청] 탭: 새 칸(보낼곳, 점장확인)의 머리글을 채워요 (칸 순서는 그대로)
  var rh = rq.getRange(1, 1, 1, REQ_HEAD.length).getDisplayValues()[0];
  var extra = REQ_HEAD.length - R.route;
  var clash = rh.slice(R.route).some(function (h, i) { h = String(h).trim(); return h && h !== REQ_HEAD[R.route + i]; });
  if (!clash && !String(rh[R.route]).trim() && rq.getLastRow() > 1) {
    // 머리글 없이 그 칸에 뭔가 적어 둔 경우도 사장님 칸으로 봐요
    clash = rq.getRange(2, R.route + 1, rq.getLastRow() - 1, extra).getDisplayValues().some(function (row) { return row.some(function (x) { return String(x).trim(); }); });
  }
  if (clash) {
    // 사장님이 K칸부터 쓰던 칸은 오른쪽으로 밀고, 앱 칸 두 개를 그 자리에 끼워 넣어요
    rq.insertColumnsBefore(R.route + 1, extra);
    rq.getRange(2, R.route + 1, rq.getMaxRows() - 1, extra).setNumberFormat('@');
    rh = rq.getRange(1, 1, 1, REQ_HEAD.length).getDisplayValues()[0];
  }
  if (rh.some(function (h) { return !String(h).trim(); })) {
    rq.getRange(1, 1, 1, REQ_HEAD.length).setValues([REQ_HEAD.map(function (h, i) { return String(rh[i]).trim() || h; })])
      .setFontWeight('bold').setBackground('#eef2f7');
  }
  ensureSheet_(ss, SHEETS.sub, SUB_HEAD, [], SUB_FMT);
  var now = nowKst_();
  [now.ym, nextYm_(now.ym)].forEach(function (ym) {
    ensureMonth_(ym);
    // 예전에 만든 탭도 공휴일 표시·색칠 규칙(결근?, 휴무?, 대체)을 새로 맞춰요
    var g = monthGrid_(ym, true);
    if (!g) return;
    markHolidays_(g.sh, ym, g.cols.day1);
    monthRules_(g.sh, g.cols.day1);
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'checkMissing' || h === 'sheetEdited') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMissing').timeBased().everyMinutes(10).create();
  // 따로 만든 스크립트는 시트의 onEdit이 저절로 안 불려서, 직접 연결해요.
  if (SHEET_ID) ScriptApp.newTrigger('sheetEdited').forSpreadsheet(ss).onEdit().create();

  var msg = '설정 완료! [설정] 탭에서 관리자PIN을 바꾸고, [매장]·[직원] 탭을 확인한 뒤 웹 앱으로 배포하세요.';
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
  if (sh) {
    // 미리 만들어 둔 탭이면 머리글이 비었을 때만 채우고, 칸 서식을 맞춰요(기존 값은 그대로)
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
    if (name !== SHEETS.staff) {
      for (var k = 0; k < fmts.length; k++) sh.getRange(2, k + 1, sh.getMaxRows() - 1, 1).setNumberFormat(fmts[k]);
    }
    return sh;
  }
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

function settings_() { return memo_('set', readSettings_); }

function readSettings_() {
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
    radius: num(K.radius, 100),
    mode: mode,
    device: /안/.test(map[K.device] || '') ? '안함' : '필수',
    grace: num(K.grace, 0),
    email: map[K.email] || '',
    alertMin: num(K.alertMin, 10),
    tgToken: map[K.tgToken] || '',
    tgChat: map[K.tgChat] || '',
    tgBot: String(map[K.tgBot] || '').replace(/^@/, ''),
    remind: num(K.remind, 20),
    wishWin: map[K.wishWin] === undefined ? '20-25' : map[K.wishWin],
    wishBlock: map[K.wishBlock] || '',
    holAdd: map[K.holAdd] || '',
    holDel: map[K.holDel] || '',
    subMode: /안/.test(map[K.subMode] || '') ? '안함' : /공휴/.test(map[K.subMode] || '') ? '휴무날·공휴일' : '휴무날만',
  };
}

function setSetting_(key, value) {
  var sh = sheet_(SHEETS.set);
  var rows = rows_(SHEETS.set);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(value));
      forget_('set');
      forget_('hol');
      return;
    }
  }
  sh.appendRow([key, String(value), '']);
  forget_('set');
  forget_('hol');
}

/** 머리글로 칸을 찾는 탭에서, 없는 머리글을 오른쪽 끝에 붙여요. 머리글 → 칸 번호(0부터)를 돌려줘요. */
function addHeads_(sh, heads) {
  var width = Math.max(sh.getLastColumn(), 1);
  var col = {};
  sh.getRange(1, 1, 1, width).getDisplayValues()[0].forEach(function (h, i) {
    h = String(h).trim();
    if (h && col[h] == null) col[h] = i;
  });
  heads.forEach(function (h) {
    if (col[h] != null) return;
    var c = Math.max(sh.getLastColumn(), 1) + 1;
    if (c > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, c).setValue(h).setFontWeight('bold').setBackground('#eef2f7');
    sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    col[h] = c - 1;
  });
  return col;
}

/** [직원] 머리글 → 칸 번호(0부터). */
function staffCols_() { return memo_('staffCols', readStaffCols_); }

function readStaffCols_() {
  var sh = sheet_(SHEETS.staff);
  var col = {};
  if (sh.getLastRow() < 1) return col;
  sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].forEach(function (h, i) {
    h = String(h).trim();
    if (h && col[h] == null) col[h] = i;
  });
  return col;
}

function staff_() { return memo_('staff', readStaff_); }

function readStaff_() {
  var col = staffCols_();
  function get(r, k) { var i = col[k]; return i == null || r[i] == null ? '' : String(r[i]).trim(); }
  var out = [];
  rows_(SHEETS.staff).forEach(function (r, i) {
    var name = get(r, '이름');
    if (!name) return;
    out.push({
      row: i + 2,
      name: name,
      store: get(r, '매장'),
      pin: get(r, 'PIN'),
      wage: toNum_(get(r, '시급')),
      week: DOW.map(function (d) { return get(r, d); }), // 일(0) 월(1) … 토(6)
      active: !/^\s*(x|×|퇴사|아니오?|n)\s*$/i.test(get(r, '재직')),
      device: get(r, '등록폰'),
      deviceId: devId_(get(r, '등록폰')),
      request: get(r, '새폰요청'),
      agreed: !!get(r, '동의'),
      tg: get(r, '텔레그램'), // 텔레그램 채팅 번호(직원이 앱에서 알림을 켜면 채워져요)
    });
  });
  return out;
}

function setStaffCell_(row, key, value) {
  var sh = sheet_(SHEETS.staff);
  var i = staffCols_()[key];
  if (i == null) {
    // 새 버전에서 늘어난 칸(예: 동의)은 오른쪽 끝에 알아서 붙여요
    i = Math.max(sh.getLastColumn(), 1);
    if (i + 1 > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, i + 1).setValue(key).setFontWeight('bold').setBackground('#eef2f7');
    forget_('staffCols');
  }
  sh.getRange(row, i + 1).setNumberFormat('@').setValue(value);
  forget_('staff');
}

/** [매장] 탭: 이름, 기본 출근·퇴근, 위치, 점장, 휴무 규칙. 칸은 머리글 이름으로 찾아요(없으면 원래 순서). */
function stores_() { return memo_('stores', readStores_); }

function readStores_() {
  var sh = book_().getSheetByName(SHEETS.store);
  if (!sh) return [];
  var n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(1, 1, n, Math.max(sh.getLastColumn(), 1)).getDisplayValues();
  var col = {};
  vals[0].forEach(function (h, i) { h = String(h).trim(); if (h && col[h] == null) col[h] = i; });
  var at = function (k, d) { return col[k] != null ? col[k] : d; };
  var get = function (r, k, d) { var i = at(k, d); return i == null || r[i] == null ? '' : String(r[i]).trim(); };
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var name = get(r, '매장', 0);
    if (!name) continue;
    var lat = get(r, '위도', 3), lng = get(r, '경도', 4), max = get(r, '최대휴무');
    out.push({
      row: i + 1, name: name, open: parseTime_(get(r, '출근', 1)), close: parseTime_(get(r, '퇴근', 2)),
      lat: lat && isFinite(Number(lat)) ? Number(lat) : null,
      lng: lng && isFinite(Number(lng)) ? Number(lng) : null,
      radius: toNum_(get(r, '반경(m)', 5)) || null,
      managers: splitNames_(get(r, '점장')),
      maxOff: max === '' ? 1 : Math.max(0, Math.floor(toNum_(max))), // 0 = 제한 없음
      monthOff: Math.max(0, Math.floor(toNum_(get(r, '월휴무')))), // 0 = 제한 없음
      cLat: at('위도', 3), cLng: at('경도', 4),
    });
  }
  return out;
}

function storeOf_(name) {
  var st = null;
  stores_().forEach(function (x) { if (x.name === name) st = x; });
  return st;
}

/** 그 매장 점장 이름들(재직 중인 직원만). except 는 빼요(점장 본인 요청은 관리자에게). */
function managersOf_(store, except) {
  var st = storeOf_(store);
  if (!st) return [];
  var active = {};
  staff_().forEach(function (p) { if (p.active) active[p.name] = true; });
  return st.managers.filter(function (n) { return active[n] && n !== except; });
}

function splitNames_(s) {
  return String(s == null ? '' : s).split(/[\s,\/·]+/).map(function (x) { return x.trim(); }).filter(String);
}

/** 이름으로 직원 찾기(퇴사자 포함). 없으면 null. */
function findStaff_(name) {
  var p = null;
  staff_().forEach(function (x) { if (x.name === name) p = x; });
  return p;
}

/** 매장 순서([매장] 탭 순서), 같은 매장은 [직원] 탭 순서. */
function sortByStore_(people, stores) {
  var order = {};
  (stores || stores_()).forEach(function (st, i) { order[st.name] = i; });
  return people.slice().sort(function (a, b) {
    var x = order[a.store] == null ? 999 : order[a.store], y = order[b.store] == null ? 999 : order[b.store];
    return x - y || a.row - b.row;
  });
}

function person_(name, list) {
  name = String(name == null ? '' : name).trim();
  list = list || staff_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name && list[i].active) return list[i];
  }
  throw new Error('직원 명단에 없는 이름이에요. 화면을 새로고침 해주세요.');
}

/**
 * 그날 근무시간 {start, end|null}, 쉬는 날이면 null. 정하는 순서:
 *  1) [근무변경]에 그날 줄이 있으면 그것  2) 휴무표 그날 칸에 휴무·월차·반차 등이 있으면 쉼
 *  3) [직원]의 그 요일 칸(사무실처럼 사람마다 다를 때)  4) [매장]의 기본 출근·퇴근 시간
 */
function schedFor_(p, date, ctx) {
  if (Array.isArray(ctx)) ctx = { changes: ctx };
  ctx = ctx || {};
  var changes = ctx.changes || changes_();
  var txt = null;
  changes.forEach(function (r) {
    if (parseDate_(r[0]) === date && String(r[1]).trim() === p.name) txt = r[2];
  });
  if (txt !== null) return parseSchedule_(txt);
  if (OFF_RE.test(dayMark_(p.name, date))) return null;
  var w = String((p.week && p.week[dowOf_(date)]) || '').trim();
  if (w) return parseSchedule_(w);
  var st = null;
  (ctx.stores || stores_()).forEach(function (x) { if (x.name === p.store) st = x; });
  return st && st.open != null ? { start: st.open, end: st.close } : null;
}

function newLogRow_(date, p, s) {
  var v = LOG_HEAD.map(function () { return ''; });
  v[C.date] = date;
  v[C.dow] = DOW[dowOf_(date)];
  v[C.name] = p.name;
  v[C.sIn] = s ? fmtTime_(s.start) : '';
  v[C.sOut] = s ? fmtTime_(s.end) : '';
  return v;
}

function fmtSched_(s) {
  return s ? fmtTime_(s.start) + '-' + (s.end != null ? fmtTime_(s.end) : '') : '';
}

function isDayOffKind_(k) { return k === '대타' || OFF_KINDS.indexOf(k) >= 0; }

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

/**
 * 비밀번호 확인. 비밀번호가 아직 없는 직원은 출근·퇴근을 찍을 때(allowFirst) 넣은 번호가 비밀번호가 돼요.
 * 저장은 찍기가 성공한 뒤에 해요(p.newPin → punch 끝에서 저장).
 */
function checkPin_(p, pin, allowFirst) {
  if (!p.pin) {
    if (!allowFirst) throw new Error('먼저 출근을 한 번 찍어서 비밀번호를 정해주세요.');
    var first = String(pin == null ? '' : pin).trim();
    if (!/^\d{4,6}$/.test(first)) throw new Error('처음 쓰시는군요! 앞으로 쓸 비밀번호 4자리를 정해서 넣어주세요.');
    p.newPin = first;
    return;
  }
  guard_('pin:' + p.name, String(pin == null ? '' : pin).trim() === p.pin, '비밀번호가 틀렸어요.', function (n) {
    logSuspect_(p.name, '비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
  });
}

/**
 * 사장님 화면 로그인 확인. cred:
 *  - 관리자 비밀번호(글자): 관리자. 모든 매장, 모든 기능
 *  - {name, pin}: 점장. [매장] 점장 칸에 이름이 있는 매장만, 본인 직원 비밀번호로 들어와요
 * 돌려주는 값: {set, role: 'admin'|'manager', name, stores}
 */
function auth_(cred) {
  var set = settings_();
  if (cred && typeof cred === 'object' && String(cred.name == null ? '' : cred.name).trim()) {
    var p = person_(cred.name);
    var stores = stores_().filter(function (st) { return st.managers.indexOf(p.name) >= 0; }).map(function (st) { return st.name; });
    if (!stores.length) throw new Error(p.name + ' 님은 점장으로 등록돼 있지 않아요. 시트 [매장] 탭 점장 칸을 확인해주세요.');
    if (!p.pin) throw new Error('아직 비밀번호가 없어요. 직원 화면에서 출근을 한 번 찍어 비밀번호를 정해주세요.');
    guard_('pin:' + p.name, String(cred.pin == null ? '' : cred.pin).trim() === p.pin, '비밀번호가 틀렸어요.', function (n) {
      logSuspect_(p.name, '점장 화면 비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
    });
    return { set: set, role: 'manager', name: p.name, stores: stores };
  }
  var pin = cred && typeof cred === 'object' ? cred.pin : cred;
  if (!set.adminPin) throw new Error('[설정] 시트에 관리자PIN을 먼저 넣어주세요.');
  guard_('admin', String(pin == null ? '' : pin).trim() === set.adminPin, '관리자 비밀번호가 틀렸어요.', function (n) {
    logSuspect_('(사장님 화면)', '관리자 비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
  });
  return { set: set, role: 'admin', name: '', stores: null };
}

/** 관리자만 쓰는 기능(최종 승인, 폰·비밀번호, 텔레그램, 정산, 휴무 확정). */
function adminAuth_(cred) {
  var a = auth_(cred);
  if (a.role !== 'admin') throw new Error('이 기능은 관리자(사장님)만 쓸 수 있어요.');
  return a.set;
}

/** 이 직원이 로그인한 사람 화면에 보이는지: 관리자는 전부, 점장은 자기 매장 직원만. */
function canSee_(a, p) { return a.role === 'admin' || a.stores.indexOf(p.store) >= 0; }

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
  if (set.device === '안함' || p.name === TEST_NAME) return; // 테스트 직원은 폰을 등록하지 않아요(사장님 폰이 묶이지 않게)
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
    setStaffCell_(p.row, '등록폰', devCell_(id, label, mmdd_(now.date) + ' 등록'));
    p.deviceId = id;
    return;
  }
  if (p.deviceId === id) return;
  var first = devId_(p.request) !== id; // 같은 폰으로 다시 눌러도 메일은 처음 한 번만
  if (first) setStaffCell_(p.row, '새폰요청', devCell_(id, label, mmdd_(now.date) + ' ' + now.time + ' 요청'));
  deny_(set, p.name, '새 폰 승인 요청', label + ' (등록된 폰: ' + devLabel_(p.device) + ')',
    '등록된 폰이 아니에요. 사장님께 새 폰 승인을 요청했어요. 승인되면 다시 눌러주세요.\n' +
    '지금 시간(' + now.time + ')은 기록에 남아서 사장님이 출퇴근 시간을 맞춰줄 수 있어요.', first);
}

/** 매장 근처인지 확인하고, 매장까지 거리(m)를 돌려줘요. 확인 안 하면 ''. */
/**
 * 등록된 매장 중 가장 가까운 곳을 찾아요. 돌려주는 값: {dist: 거리(m) 또는 '', store: 찍은 매장, memo: 기록에 남길 말}
 *  - 내 매장 위치가 아직 등록 전이면: 막지 않고 '매장 위치 미등록'으로 남겨요(11개 매장을 하나씩 등록하는 동안 출근이 막히지 않게)
 *  - 다른 매장 근처에서 찍으면: 통과는 되지만(지원 근무) [의심기록]에 '다른 매장에서 찍음'을 남겨요
 *    (그날 휴무표에 '대타'가 있거나 근무변경이 잡혀 있으면 계획된 근무라 안 남겨요)
 */
function checkPlace_(set, req, p, now) {
  var none = { dist: '', store: '', memo: '' };
  if (set.mode === '안함') return none;
  if (p.name === TEST_NAME) return { dist: '', store: '', memo: '테스트(위치 확인 안 함)' };
  var name = p.name;
  var stores = stores_();
  var own = null;
  stores.forEach(function (st) { if (st.name === p.store) own = st; });
  if (own && (own.lat == null || own.lng == null)) return { dist: '', store: '', memo: '매장 위치 미등록' };
  var has = typeof req.lat === 'number' && typeof req.lng === 'number' && isFinite(req.lat) && isFinite(req.lng);
  var places = stores.filter(function (st) { return st.lat != null && st.lng != null; });
  if (!places.length) {
    if (set.mode === '필수') throw new Error('사장님이 아직 매장 위치를 등록하지 않았어요. 사장님께 말씀해주세요.');
    return none;
  }
  if (!has) {
    if (set.mode === '필수') {
      deny_(set, name, '위치 없음', '위치 권한이 꺼져 있거나 GPS를 못 잡음',
        '위치를 확인하지 못했어요. 휴대폰 위치(GPS)를 켜고 다시 눌러주세요.');
    }
    return none;
  }
  var best = null;
  places.forEach(function (st) {
    var d = distance_(st.lat, st.lng, req.lat, req.lng);
    if (!best || d < best.d) best = { d: d, st: st };
  });
  var acc = Math.max(Number(req.acc) || 0, 0);
  var radius = best.st.radius || set.radius;
  if (best.d - Math.min(acc, 100) > radius) {
    var where = '가장 가까운 매장(' + best.st.name + ')에서 ' + fmtDist_(best.d) + ' (GPS 오차 ' + Math.round(acc) + 'm)';
    if (set.mode === '필수') {
      deny_(set, name, '매장 밖', where, best.st.name + '에서 약 ' + fmtDist_(best.d) + ' 떨어져 있어요. 매장 안에서 다시 눌러주세요.');
    }
    logSuspect_(name, '매장 밖에서 찍음', where + ', 기록만 모드라 통과');
    return { dist: best.d, store: '', memo: '' };
  }
  var memo = '';
  if (own && best.st.name !== own.name) {
    memo = '다른 매장(' + best.st.name + ')';
    var planned = /^대타/.test(dayMark_(name, now.date)) ||
      changes_().some(function (r) { return parseDate_(r[0]) === now.date && String(r[1]).trim() === name; });
    if (!planned) logSuspect_(name, '다른 매장에서 찍음', own.name + ' 소속인데 ' + best.st.name + '에서 찍음 (지원 근무면 괜찮아요)');
  }
  return { dist: best.d, store: best.st.name, memo: memo };
}

/** 처음 한 번: 출퇴근 확인을 위해 시간·매장까지 거리·폰 종류를 기록하는 데 동의해야 찍혀요. */
function checkAgree_(p, req) {
  if (p.agreed) return;
  if (req.agree !== true) throw new Error('처음 한 번만 동의가 필요해요. 화면의 동의 칸에 체크하고 다시 눌러주세요.');
  p.newAgree = true;
}

/** 비밀번호가 1234처럼 쉽거나, 3명 이상이 같은 번호를 쓰면 true. */
function weakPin_(p, people) {
  var pin = p.newPin || p.pin;
  if (!pin) return false;
  if (EASY_PINS.indexOf(pin) >= 0) return true;
  var same = (people || []).filter(function (x) { return x.name !== p.name && x.pin === pin; }).length;
  return same >= 2;
}

/** 거절: [의심기록]에 남기고(필요하면 사장님께 알림), 직원 화면에는 msg를 보여줘요. */
function deny_(set, name, kind, detail, msg, alert) {
  logSuspect_(name, kind, detail);
  if (alert) notify_(set, name + ' · ' + kind, detail + '\n사장님 화면 [오늘] 탭에서 확인하세요.');
  throw new Error(msg);
}

/**
 * 사장님께 알림: 텔레그램이 연결돼 있으면 텔레그램으로, 아니면(또는 실패하면) 메일로 보내요.
 * 보낸 곳('텔레그램' 또는 '메일')을 돌려줘요. 못 보냈으면 ''.
 */
function notify_(set, title, body, opts) {
  var now = nowKst_();
  var url = adminUrl_();
  var text = mmdd_(now.date) + ' ' + now.time + '\n' + body + (url ? '\n\n사장님 화면: ' + url : '');
  if (set.tgToken && set.tgChat) {
    try {
      tgCall_(set.tgToken, 'sendMessage', {
        chat_id: set.tgChat, text: '[' + set.store + ' 출퇴근] ' + title + '\n' + text, disable_web_page_preview: true,
        disable_notification: !!(opts && opts.silent),
      });
      return '텔레그램';
    } catch (err) { console.error(err); }
  }
  if (set.email) {
    try {
      MailApp.sendEmail(set.email, '[' + set.store + ' 출퇴근] ' + title, text + '\n시트: ' + book_().getUrl());
      return '메일';
    } catch (err) { console.error(err); }
  }
  return '';
}

/**
 * 직원 한 명에게 텔레그램 알림(직원이 앱에서 알림을 켰을 때만). 보냈으면 true.
 * 직원이 봇을 차단했거나 텔레그램이 안 되면 조용히 넘어가요.
 */
function notifyStaff_(set, p, title, body, opts) {
  if (!set.tgToken || !p || !p.tg) return false;
  try {
    tgCall_(set.tgToken, 'sendMessage', {
      chat_id: p.tg, text: '[' + set.store + '] ' + title + '\n' + body, disable_web_page_preview: true,
      disable_notification: !!(opts && opts.silent),
    });
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
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
    var now = nowKst_();
    // appendRow 는 여러 명이 동시에 써도 줄이 겹치지 않아요(칸 서식은 처음 설정 때 글자로 맞춰 둠)
    sh.appendRow([now.date + ' ' + now.time, name || '', kind, detail || '']);
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
  // 있으면 그대로(서식 맞추기는 setup 때만 해서 빨라요), 없으면 만들어요
  return book_().getSheetByName(SHEETS.req) || ensureSheet_(book_(), SHEETS.req, REQ_HEAD, [], REQ_HEAD.map(function () { return '@'; }));
}

function readReqs_() { return memo_('reqs', readReqsNow_); }

function readReqsNow_() {
  var sh = reqSheet_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, REQ_HEAD.length).getDisplayValues().map(function (v, i) {
    return {
      row: i + 2, id: String(v[R.id]).trim(), at: v[R.at], name: String(v[R.name]).trim(), kind: String(v[R.kind]).trim(),
      date: parseDate_(v[R.date]), what: String(v[R.what]).trim(), reason: v[R.reason], state: String(v[R.state]).trim(),
      taker: String(v[R.taker] == null ? '' : v[R.taker]).trim(), done: v[R.done],
      route: String(v[R.route] == null ? '' : v[R.route]).trim() === '점장' ? '점장' : '관리자', // 예전 줄(빈칸)은 관리자
      mgr: String(v[R.mgr] == null ? '' : v[R.mgr]).trim(),
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
  forget_('reqs');
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var rg = sh.getRange(row, 1, 1, REQ_HEAD.length);
  rg.setNumberFormats([REQ_HEAD.map(function () { return '@'; })]);
  rg.setValues([[r.id, r.at, r.name, r.kind, r.date, r.what, r.reason || '', r.state, r.taker || '', r.done || '',
    r.route || '관리자', r.mgr || '']]);
}

function reqView_(r, withReason) {
  var p = findStaff_(r.name);
  return {
    id: r.id, name: r.name, kind: r.kind, date: r.date, dow: DOW[dowOf_(r.date)], what: r.what,
    reason: withReason ? r.reason : '', state: r.state, taker: r.taker, at: r.at,
    store: p ? p.store : '', route: r.route, mgr: withReason ? r.mgr : '',
    managers: r.route === '점장' && p ? managersOf_(p.store, p.name) : [],
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

/** 아직 끝나지 않은 요청. 점장(a.role 'manager')에게는 자기 매장 직원 것만. */
function openReqsForAdmin_(today, a) {
  var people = staff_();
  return readReqs_().filter(function (r) {
    if (r.state !== '대기' && r.state !== '수락') return false;
    if (!a || a.role === 'admin') return true;
    var p = findStaff_(r.name);
    return !!p && a.stores.indexOf(p.store) >= 0;
  }).map(function (r) {
    var v = reqView_(r, true);
    if (OFF_KINDS.indexOf(r.kind) >= 0 && r.kind !== '반차' && v.store) {
      // 그날 같은 매장에 이미 쉬는 사람
      var offs = offNames_(v.store, r.date, r.name);
      var st = storeOf_(v.store);
      if (offs.length) {
        v.note = '그날 ' + v.store + '는 이미 ' + offs.join(', ') + ' 님이 쉬어요' +
          (st && st.maxOff > 0 && offs.length >= st.maxOff ? ' (하루 최대 ' + st.maxOff + '명을 넘어요)' : '');
      }
    }
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
      row = Math.max(sh.getLastRow(), 1) + 1;
      v = newLogRow_(r.date, p || { name: r.name }, p ? schedFor_(p, r.date) : null);
    }
    var col = m[1] === '출근' ? C.tIn : C.tOut;
    var before = fmtTime_(parseTime_(v[col]));
    v[col] = m[2];
    v[C.memo] = addMemo_(v[C.memo], '정정 승인: ' + m[1] + ' ' + m[2] + (before ? '(이전 ' + before + ')' : '') +
      (r.reason ? ' ' + r.reason : ''));
    applyCalc_(v, p ? p.wage : 0, set.grace);
    writeLog_(sh, row, v);
    if (col === C.tIn) syncLateMark_(r.date, r.name, v);
    return;
  }

  if (OFF_KINDS.indexOf(r.kind) >= 0) {
    // 휴무·월차·반차·대체: 휴무표 그날 칸에 그대로 적어요. 대체는 [대체휴무]에 '사용'도 적어요
    setMark_(r.date, r.name, function () { return r.kind; });
    if (r.kind === '대체') addSub_(r.date, r.name, '사용', 1, '대체휴무 신청 승인 (' + r.id + ')');
    resyncLog_(set, r.date, r.name);
    return;
  }

  // 대타: 요청한 사람은 휴무, 대타는 그 시간을 맡아요(원래 근무가 있으면 두 시간을 합쳐요).
  var a = parseSchedule_(r.what);
  var b = find(r.taker);
  if (!a || !b) throw new Error('대타 정보가 이상해요. 시트 [요청] 탭을 확인해주세요.');
  var sb = schedFor_(b, r.date);
  var start = sb ? Math.min(sb.start, a.start) : a.start;
  var end = sb && sb.end != null && a.end != null ? Math.max(sb.end, a.end) : (a.end != null ? a.end : sb ? sb.end : null);
  setMark_(r.date, r.name, function () { return '휴무'; });
  setMark_(r.date, r.taker, function (old) { return !old || OFF_RE.test(old) ? '대타' : old; });
  addChange_(r.date, r.taker, fmtSched_({ start: start, end: end }),
    r.name + ' 님 대신 대타' + (sb ? ' (원래 ' + fmtSched_(sb) + ' 근무와 합침)' : ''));
  resyncLog_(set, r.date, r.name);
  resyncLog_(set, r.date, r.taker);
}

function changes_() { return memo_('change', function () { return rows_(SHEETS.change); }); }

/** [근무변경]에 한 줄 추가. */
function addChange_(date, name, text, memo) {
  forget_('change');
  var sh = sheet_(SHEETS.change);
  var row = Math.max(sh.getLastRow(), 1) + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var rg = sh.getRange(row, 1, 1, CHANGE_HEAD.length);
  rg.setNumberFormats([['@', '@', '@', '@']]);
  rg.setValues([[date, name, text, memo]]);
}

/** 그날 근무 계획이 바뀌었으면, 이미 있는 출퇴근기록의 예정 시간·지각을 다시 계산해요. */
function resyncLog_(set, date, name) {
  var log = sheet_(SHEETS.log);
  var f = findLog_(log, date, name);
  if (!f) return;
  var p = null;
  staff_().forEach(function (x) { if (x.name === name) p = x; });
  var s = p ? schedFor_(p, date) : null;
  var v = f.vals.slice();
  v[C.sIn] = s ? fmtTime_(s.start) : '';
  v[C.sOut] = s ? fmtTime_(s.end) : '';
  applyCalc_(v, p ? p.wage : 0, set.grace);
  writeLog_(log, f.row, v);
  syncLateMark_(date, name, v);
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

/** 사장님 화면 [설정] 탭 정보. 점장(a.role 'manager')에게는 자기 매장만, 시트 주소·텔레그램 상태는 빼요. */
function info_(set, a) {
  var appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl() || ''; } catch (err) { /* 배포 전 */ }
  var admin = !a || a.role === 'admin';
  var used = {}, names = {};
  staff_().forEach(function (p) {
    if (!p.active) return;
    used[p.store] = (used[p.store] || 0) + 1;
    names[p.name] = true;
  });
  return {
    store: set.store,
    role: admin ? 'admin' : 'manager',
    stores: stores_().filter(function (st) { return admin || a.stores.indexOf(st.name) >= 0; }).map(function (st) {
      return {
        name: st.name, hasPlace: st.lat != null && st.lng != null, lat: st.lat, lng: st.lng,
        radius: st.radius || set.radius, open: fmtTime_(st.open), close: fmtTime_(st.close), staff: used[st.name] || 0,
        managers: st.managers.filter(function (n) { return names[n]; }),
        badManagers: st.managers.filter(function (n) { return !names[n]; }), // [직원]에 없는 이름(오타 등)
        maxOff: st.maxOff, monthOff: st.monthOff,
      };
    }),
    radius: set.radius, mode: set.mode, device: set.device, grace: set.grace, email: set.email, alertMin: set.alertMin,
    weakPin: admin && (set.adminPin === '0000' || set.adminPin.length < 6), sheetUrl: admin ? book_().getUrl() : '', appUrl: appUrl,
    tg: !admin ? '' : set.tgToken ? (set.tgChat ? '연결됨' : '토큰만') : '',
    tgBot: admin ? set.tgBot : '', remind: set.remind, wishWin: set.wishWin, subMode: set.subMode,
  };
}

function monthRows_(ym) {
  return rows_(SHEETS.log).map(function (v) {
    return {
      date: parseDate_(v[C.date]), dow: String(v[C.dow] || ''), name: String(v[C.name]).trim(),
      sIn: fmtTime_(parseTime_(v[C.sIn])), sOut: fmtTime_(parseTime_(v[C.sOut])),
      tIn: fmtTime_(parseTime_(v[C.tIn])), tOut: fmtTime_(parseTime_(v[C.tOut])),
      late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: toNum_(v[C.work]),
      deduct: toNum_(v[C.deduct]), memo: String(v[C.memo] || ''), place: String(v[C.place] || ''),
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

/** 월별 합계·기록. only = 이 이름들만(점장 화면). */
function monthData_(ym, only) {
  var keep = function (n) { return n !== TEST_NAME && (!only || only.indexOf(n) >= 0); }; // 테스트 직원은 월별·정산에서 빼요
  var rows = monthRows_(ym).filter(function (r) { return keep(r.name); });
  var today = nowKst_().date;
  var people = staff_().filter(function (p) { return keep(p.name); });
  var names = people.map(function (p) { return p.name; });
  rows.forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
  var storeOf = {};
  sortByStore_(people).forEach(function (p, i) { storeOf[p.name] = { store: p.store, i: i }; });
  names.sort(function (a, b) {
    return (storeOf[a] ? storeOf[a].i : 9999) - (storeOf[b] ? storeOf[b].i : 9999);
  });
  var staff = names.map(function (n) {
    var mine = rows.filter(function (r) { return r.name === n; });
    var t = total_(mine, today);
    t.name = n;
    t.store = storeOf[n] ? storeOf[n].store : '';
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
        r.late || '', r.early || '', r.work || '', r.deduct || '', '', '', r.memo, r.place];
    });
    var rg = sh.getRange(top + 1, 1, detail.length, LOG_HEAD.length);
    rg.setNumberFormats(detail.map(function () { return LOG_FMT; }));
    rg.setValues(detail);
  }
  sh.setFrozenRows(1);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

/* ───────────── 휴무표 (달마다 한 장: '휴무표 2026-11') ───────────── */

var GRID_ = {}; // 한 번 실행하는 동안 읽은 휴무표를 기억해요
var MEMO_ = {}; // 한 번 실행하는 동안 읽은 설정·직원·매장·근무변경을 기억해요(시트 읽기 횟수를 줄여서 빨라져요)

function memo_(key, fn) {
  if (!Object.prototype.hasOwnProperty.call(MEMO_, key)) MEMO_[key] = fn();
  return MEMO_[key];
}
function forget_(key) { delete MEMO_[key]; }

function monthName_(ym) { return MONTH_PREFIX + ym; }

function nextYm_(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) { y++; m = 1; }
  return y + '-' + pad2_(m);
}

function daysIn_(ym) {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

function colA1_(c) { // 1 → A, 27 → AA
  var s = '';
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
}

/**
 * 그 달 휴무표 탭을 만들고(없으면), 탭에 없는 재직 직원 줄을 아래에 더해요.
 * onlyIfMissing 이면 탭이 이미 있을 땐 아무것도 안 해요.
 */
function ensureMonth_(ym, onlyIfMissing) {
  var ss = book_();
  var sh = ss.getSheetByName(monthName_(ym));
  if (sh && onlyIfMissing) return sh;
  if (!sh) {
    sh = ss.insertSheet(monthName_(ym), 0);
    buildMonth_(sh, ym);
  }
  var g = monthGrid_(ym, true);
  var people = sortByStore_(staff_().filter(function (p) { return p.active && !g.rows[p.name]; }));
  if (people.length) {
    var start = Math.max(sh.getLastRow(), 2) + 1;
    if (start + people.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), people.length + 50);
    var prev = ss.getSheetByName(monthName_(prevYm_(ym))) ? monthName_(prevYm_(ym)) : '';
    var rows = people.map(function (p, i) { return monthRow_(start + i, p, prev, g.cols); });
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  }
  delete GRID_[ym];
  return sh;
}

/** 직원 한 줄: No, 매장, 이름, 그리고 집계 수식(휴무·월차·이월·부여·잔여·지각). cols = 그 탭의 날짜 칸 위치. */
function monthRow_(r, p, prev, cols) {
  var d1 = (cols || MT).day1;
  var days = colA1_(d1 + 1) + r + ':' + colA1_(d1 + 31) + r;
  var q = "'" + prev + "'";
  return [
    r - 2, p.store, p.name,
    '=COUNTIF(' + days + ',"*휴무*")+COUNTIF(' + days + ',"*휴가*")+0.5*COUNTIF(' + days + ',"*반차*")',
    '=COUNTIF(' + days + ',"*월차*")',
    prev ? '=IFERROR(VLOOKUP($C' + r + ',' + q + '!$C:$H,6,FALSE),0)' : 0,
    1,
    '=F' + r + '+G' + r + '-E' + r,
    '=SUMPRODUCT(--ISNUMBER(SEARCH(":",' + days + ')))',
  ];
}

/** 새 달 탭의 머리글·서식·색칠 규칙. */
function buildMonth_(sh, ym) {
  var n = daysIn_(ym), m = Number(ym.slice(5, 7));
  var head1 = ['No', '매장', '이름', '휴무', '월차', '이월', '부여', '잔여', '지각'];
  var head2 = ['', '', '', '반차 0.5', '사용', '지난달', '이번달', '남은 월차', '회'];
  for (var d = 1; d <= 31; d++) {
    head1.push(d <= n ? m + '/' + d : '');
    head2.push(d <= n ? DOW[dowOf_(ym + '-' + pad2_(d))] : '');
  }
  head1.push('메모');
  head2.push('');
  var width = head1.length; // 41 (새 탭은 26칸뿐이라 늘려요)
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  var rows = sh.getMaxRows();
  sh.getRange(1, 1, 2, width).setValues([head1, head2]).setFontWeight('bold').setBackground('#eef2f7').setHorizontalAlignment('center');
  sh.setFrozenRows(2);
  sh.setFrozenColumns(3);
  sh.getRange(3, 2, rows - 2, 2).setNumberFormat('@');
  sh.getRange(3, MT.day1 + 1, rows - 2, 31).setNumberFormat('@').setHorizontalAlignment('center');
  sh.getRange(3, MT.memo + 1, rows - 2, 1).setNumberFormat('@');
  sh.setColumnWidth(1, 36);
  sh.setColumnWidth(2, 80);
  sh.setColumnWidth(3, 70);
  for (var c = 4; c <= MT.day1; c++) sh.setColumnWidth(c, 52);
  for (var c2 = MT.day1 + 1; c2 <= MT.day1 + 31; c2++) sh.setColumnWidth(c2, 46);
  sh.setColumnWidth(MT.memo + 1, 220);
  for (var d2 = n + 1; d2 <= 31; d2++) sh.getRange(1, MT.day1 + d2, rows, 1).setBackground('#e5e7eb');
  sh.getRange(1, MT.day1 + 1).setNote(
    '칸에 쓰는 말: 휴무, 월차, 반차, 휴가, 무급, 명절(추석·설날), 대체(대체휴무 쓰는 날)\n' +
    '지각은 앱이 출근 시간을 11:08 처럼 자동으로 적어요(빨간 글씨).\n' +
    '대타는 앱이 "대타"라고 적어요.\n' +
    '휴무? = 직원이 앱에서 고른 다음 달 휴무(사장님 화면에서 확정하면 휴무)\n' +
    '결근? = 근무하는 날인데 출퇴근 기록이 없어서 밤에 앱이 적은 것. 확인하고 고쳐주세요\n' +
    '빨간 날짜 = 일요일·공휴일(요일 칸에 메모로 이름)\n' +
    '휴무 = 휴무 + 휴가 + 반차×0.5 / 월차 잔여 = 이월 + 부여 − 사용 / 지각 = 시간이 적힌 칸 수');
  markHolidays_(sh, ym, MT.day1);
  monthRules_(sh, MT.day1);
}

/** 휴무표 날짜 머리글 색: 일요일·공휴일 빨강, 토요일 파랑. 공휴일은 요일 칸(2행)에 메모로 이름을 달아요. */
function markHolidays_(sh, ym, day1) {
  var n = daysIn_(ym);
  var hol = holidaysIn_(ym);
  var colors = [[], []], notes = [[]];
  for (var d = 1; d <= n; d++) {
    var date = ym + '-' + pad2_(d);
    var dow = dowOf_(date);
    var c = hol[date] || dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#000000';
    colors[0].push(c);
    colors[1].push(c);
    notes[0].push(hol[date] ? whenOf_(date) + ' ' + hol[date] : '');
  }
  sh.getRange(1, day1 + 1, 2, n).setFontColors(colors);
  sh.getRange(2, day1 + 1, 1, n).setNotes(notes);
}

/** 휴무표 날짜 칸 색칠 규칙. 먼저 맞는 규칙 색이 칠해져요. */
function monthRules_(sh, day1) {
  var days = sh.getRange(3, day1 + 1, Math.max(sh.getMaxRows() - 2, 1), 31);
  var first = colA1_(day1 + 1) + '3';
  var rule = function () { return SpreadsheetApp.newConditionalFormatRule().setRanges([days]); };
  sh.setConditionalFormatRules([
    rule().whenFormulaSatisfied('=ISNUMBER(SEARCH(":",' + first + '))').setFontColor('#c62828').setBold(true).build(),
    rule().whenTextContains('결근').setBackground('#fecaca').setBold(true).build(),
    rule().whenTextContains('대타').setBackground('#fef3c7').build(),
    rule().whenTextContains('반차').setBackground('#ede9fe').build(),
    rule().whenTextContains('월차').setBackground('#dcfce7').build(),
    rule().whenTextContains('대체').setBackground('#cffafe').build(),
    rule().whenTextContains('휴무?').setBackground('#f1f5f9').setItalic(true).build(),
    rule().whenTextContains('휴').setBackground('#dbeafe').build(),
  ]);
}

/**
 * 그 달 휴무표를 읽어서 이름 → {row, vals} 로 정리해요. 탭이 없으면 null.
 * 칸 위치는 1행 머리글에서 찾아요: '이름', 첫 날짜('11/1'), '메모'. (예전 탭처럼 '아웃' 칸이 있어도 돼요)
 */
function monthGrid_(ym, fresh) {
  if (!fresh && GRID_[ym] !== undefined) return GRID_[ym];
  var sh = book_().getSheetByName(monthName_(ym));
  var g = null;
  if (sh) {
    var width = Math.max(sh.getLastColumn(), MT.memo + 1);
    var head = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    var day1 = -1;
    head.forEach(function (h, i) { if (day1 < 0 && /^\d{1,2}\/1$/.test(h)) day1 = i; });
    var cols = {
      name: head.indexOf('이름') >= 0 ? head.indexOf('이름') : MT.name,
      day1: day1 >= 0 ? day1 : MT.day1,
      left: head.indexOf('잔여') >= 0 ? head.indexOf('잔여') : MT.left,
    };
    g = { sh: sh, rows: {}, cols: cols };
    var last = sh.getLastRow();
    if (last >= 3) {
      sh.getRange(3, 1, last - 2, Math.max(width, cols.day1 + 31)).getDisplayValues().forEach(function (v, i) {
        var n = String(v[cols.name]).trim();
        if (n && !g.rows[n]) g.rows[n] = { row: i + 3, vals: v };
      });
    }
  }
  GRID_[ym] = g;
  return g;
}

/** 'YYYY-MM-DD'의 일이 그 달 안(1~말일)인지. */
function inMonth_(date) {
  var d = Number(String(date || '').slice(8, 10));
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) && d >= 1 && d <= daysIn_(date.slice(0, 7));
}

/** 휴무표 그날 칸에 적힌 말. */
function dayMark_(name, date) {
  if (!inMonth_(date)) return '';
  var g = monthGrid_(date.slice(0, 7));
  var r = g && g.rows[name];
  return r ? String(r.vals[g.cols.day1 + Number(date.slice(8)) - 1] || '').trim() : '';
}

/** 휴무표 그날 칸을 fn(지금 값) 으로 바꿔요. 탭이나 줄이 없으면 만들어요. */
function setMark_(date, name, fn) {
  if (!inMonth_(date)) return; // 날짜 칸 밖(메모 칸 등)은 절대 안 건드려요
  var ym = date.slice(0, 7);
  var g = monthGrid_(ym);
  if (!g || !g.rows[name]) {
    ensureMonth_(ym);
    g = monthGrid_(ym, true);
  }
  var r = g && g.rows[name];
  if (!r) return; // 퇴사자 등
  var idx = g.cols.day1 + Number(date.slice(8)) - 1;
  var old = String(r.vals[idx] || '').trim();
  var res = fn(old);
  var nv = String(res == null ? '' : res).trim();
  if (nv === old) return;
  g.sh.getRange(r.row, idx + 1).setNumberFormat('@').setValue(nv);
  r.vals[idx] = nv;
}

/**
 * 출퇴근기록 한 줄을 보고, 지각이면 휴무표에 출근 시간(11:08)을 적고 아니면 지워요. 다른 말은 안 건드려요.
 * 밤에 적힌 '결근?'도 출근 기록이 생기면(정정 승인 등) 시간으로 바뀌거나 지워져요.
 */
function syncLateMark_(date, name, v) {
  var late = toNum_(v[C.late]);
  var tIn = fmtTime_(parseTime_(v[C.tIn]));
  setMark_(date, name, function (old) {
    var isTime = /^\d{1,2}:\d{2}$/.test(old) || (old === '결근?' && !!tIn), isSwap = /^대타/.test(old);
    if (late > 0 && tIn) return !old || isTime ? tIn : isSwap ? '대타 ' + tIn : old;
    return isTime ? '' : isSwap ? '대타' : old;
  });
}

/**
 * 그날이 '쉬는 날'이라고 적혀 있는지: [근무변경] → 휴무표 칸 → [직원] 요일 칸 순서로 봐요(schedFor_와 같은 순서).
 * 반차(반나절 근무), 고른 휴무(휴무?, 확정 전), 근무시간이 아직 안 정해진 날은 쉬는 날이 아니에요.
 */
function offDayKnown_(p, date, changes) {
  var chg = null;
  (changes || changes_()).forEach(function (r) {
    if (parseDate_(r[0]) === date && String(r[1]).trim() === p.name) chg = String(r[2] == null ? '' : r[2]).trim();
  });
  if (chg !== null) return !parseSchedule_(chg) && (OFF_RE.test(chg) || /off/i.test(chg));
  var mark = dayMark_(p.name, date);
  if (mark) return OFF_RE.test(mark) && !/반차|휴무\?/.test(mark);
  var w = String(p.week[dowOf_(date)] || '').trim();
  return !!w && (OFF_RE.test(w) || /off/i.test(w));
}

/* ───────────── 공휴일 ───────────── */

/** 날짜 → 공휴일 이름. 앱에 든 목록 + [설정] 공휴일추가 − 공휴일제외. */
function holidays_() {
  return memo_('hol', function () {
    var set = settings_();
    var out = {};
    Object.keys(HOLIDAYS).forEach(function (d) { out[d] = HOLIDAYS[d]; });
    String(set.holAdd || '').split(/[,\n;]+/).forEach(function (t) {
      var d = parseDate_(t);
      if (!d) return;
      out[d] = String(t).replace(/^\s*\d{4}\D+\d{1,2}\D+\d{1,2}\.?\s*/, '').trim() || '휴일';
    });
    String(set.holDel || '').split(/[,\n;]+/).forEach(function (t) {
      var d = parseDate_(t);
      if (d) delete out[d];
    });
    return out;
  });
}

function holidaysIn_(ym) {
  var all = holidays_(), out = {};
  Object.keys(all).forEach(function (d) { if (d.indexOf(ym) === 0) out[d] = all[d]; });
  return out;
}

/* ───────────── 다음 달 휴무 고르기 규칙 ───────────── */

/** 지금 다음 달 휴무를 고를 수 있는지. [설정] 휴무신청기간 '20-25'(매달 20~25일), 비우면 언제든. */
function wishOpen_(set, now) {
  var ym = nextYm_(now.ym);
  if (PropertiesService.getScriptProperties().getProperty('wishOpen:' + now.date)) {
    return { open: true, ym: ym, text: '오늘만(사장님이 열어 둠)', msg: '', forced: true };
  }
  var nums = String(set.wishWin || '').match(/\d{1,2}/g); // '20-25', '20일~25일', '20일부터 25일까지'
  if (!nums) return { open: true, ym: ym, text: '언제든', msg: '' };
  var from = Number(nums[0]), to = nums[1] ? Number(nums[1]) : daysIn_(now.ym);
  var day = Number(now.date.slice(8));
  var text = Number(now.ym.slice(5)) + '/' + from + '~' + Number(now.ym.slice(5)) + '/' + to;
  return {
    open: day >= from && day <= to, ym: ym, from: from, to: to, text: text,
    msg: Number(ym.slice(5)) + '월 휴무는 ' + text + '에만 고를 수 있어요.' + (day > to ? ' 고를 기간이 지났어요. 사장님께 말씀해주세요.' : ''),
  };
}

/** [설정] 휴무금지일: '12/24'(해마다) 또는 '2026-12-24'. */
function blockedDay_(set, date) {
  return String(set.wishBlock || '').split(/[,\n;\s]+/).some(function (t) {
    t = t.trim();
    if (!t) return false;
    var full = /^\d{4}\D/.test(t) ? parseDate_(t) : '';
    if (full) return full === date;
    var m = /^(\d{1,2})\D(\d{1,2})$/.exec(t);
    return !!m && Number(m[1]) === Number(date.slice(5, 7)) && Number(m[2]) === Number(date.slice(8));
  });
}

function blockedList_(set, ym) {
  var out = [];
  for (var d = 1; d <= daysIn_(ym); d++) if (blockedDay_(set, ym + '-' + pad2_(d))) out.push(d);
  return out;
}

/**
 * 그날 그 매장에서 하루 종일 쉬는 사람(except 빼고): 휴무표에 쉬는 말(반차 빼고, '휴무?' 포함)이 있거나,
 * 휴무표 칸이 비어 있고 [직원] 그 요일 칸이 쉬는 날인 사람.
 */
function offNames_(store, date, except) {
  var out = [];
  staff_().forEach(function (q) {
    if (!q.active || q.store !== store || q.name === except) return;
    var m = dayMark_(q.name, date);
    var w = String(q.week[dowOf_(date)] || '').trim();
    var off = m ? OFF_RE.test(m) && !/반차/.test(m) : !!w && OFF_RE.test(w);
    if (off) out.push(q.name);
  });
  return out;
}

/** 그 달 휴무표에서 '휴무'(고른 '휴무?' 포함)가 적힌 날 수. */
function monthOffCount_(name, ym) {
  var g = monthGrid_(ym);
  var r = g && g.rows[name];
  var n = 0;
  if (!r) return 0;
  for (var d = 1; d <= daysIn_(ym); d++) if (/휴무/.test(String(r.vals[g.cols.day1 + d - 1] || ''))) n++;
  return n;
}

/* ───────────── 직원 근무표 ───────────── */

/** 직원 화면 근무표 한 달치(getSchedule·wishDay가 돌려줘요). */
function schedule_(p, ym, now) {
  var set = settings_();
  var g = monthGrid_(ym);
  var n = daysIn_(ym);
  var st = storeOf_(p.store);
  var cells = function (q) {
    var r = g && g.rows[q.name], out = [];
    for (var d = 1; d <= n; d++) {
      var m = r ? String(r.vals[g.cols.day1 + d - 1] || '').trim() : '';
      // 휴무표가 비어 있으면 [직원] 요일 칸의 정기 휴무(사무실 등)
      if (!m && OFF_RE.test(String(q.week[dowOf_(ym + '-' + pad2_(d))] || ''))) m = '쉼';
      out.push(m);
    }
    return out;
  };
  var mineRaw = cells(p);
  var me = mineRaw.map(function (m) {
    if (/^\d{1,2}:\d{2}$/.test(m)) return '지각';
    if (/^대타/.test(m)) return '대타';
    return m;
  });
  var mates = staff_().filter(function (q) { return q.active && q.store === p.store && q.name !== p.name; });
  var others = mates.map(function (q) {
    return {
      name: q.name,
      days: cells(q).map(function (m) {
        if (/^대타/.test(m)) return '대타';
        return m && OFF_RE.test(m) ? m : ''; // 지각 시간·결근? 같은 건 본인만 봐요
      }),
    };
  });
  var count = [];
  for (var d = 0; d < n; d++) {
    var c = 0;
    [me].concat(others.map(function (o) { return o.days; })).forEach(function (days) {
      if (days[d] && OFF_RE.test(days[d]) && !/반차/.test(days[d])) c++;
    });
    count.push(c);
  }
  var offDays = 0, used = 0, wishes = 0;
  mineRaw.forEach(function (m) {
    if (/휴무|휴가/.test(m)) offDays++;
    else if (/반차/.test(m)) offDays += 0.5;
    if (/월차/.test(m)) used++;
    if (m === '휴무?') wishes++;
  });
  var left = g && g.rows[p.name] ? String(g.rows[p.name].vals[g.cols.left] || '').trim() : '';
  var sub = subBalance_(p.name);
  var w = wishOpen_(set, now);
  return {
    ym: ym, today: now.date, store: p.store, days: n, firstDow: dowOf_(ym + '-01'), hasTab: !!g,
    holidays: holidaysIn_(ym), me: me, others: others, count: count,
    sum: {
      off: offDays, monthly: used, monthlyLeft: /^-?\d+(\.\d+)?$/.test(left) ? Number(left) : null, wishes: wishes,
      sub: sub.left, subPending: sub.pending,
    },
    wish: ym === w.ym ? {
      open: w.open, text: w.text, msg: w.msg, maxOff: st ? st.maxOff : 1, monthOff: st ? st.monthOff : 0,
      blocked: blockedList_(set, ym),
    } : null,
  };
}

/* ───────────── 대체휴무 장부 ───────────── */

function subRows_() {
  return memo_('sub', function () {
    var sh = book_().getSheetByName(SHEETS.sub);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, SUB_HEAD.length).getDisplayValues().map(function (v) {
      return { date: parseDate_(v[0]), name: String(v[1]).trim(), kind: String(v[2]).trim(), days: toNum_(v[3]) };
    }).filter(function (r) { return r.name; });
  });
}

/** 대체휴무: 적립 − 사용 = 남은 일수(left), 아직 승인 전인 대체휴무 신청(pending). */
function subBalance_(name) {
  var got = 0, used = 0;
  subRows_().forEach(function (r) {
    if (r.name !== name) return;
    if (/적립/.test(r.kind)) got += r.days;
    else if (/사용/.test(r.kind)) used += r.days;
  });
  var pending = readReqs_().filter(function (q) {
    return q.name === name && q.kind === '대체' && (q.state === '대기' || q.state === '수락');
  }).length;
  return { got: got, used: used, left: Math.round((got - used) * 10) / 10, pending: pending };
}

/** 이름 → 남은 대체휴무 (사장님 화면 직원 관리). */
function subTotals_() {
  var out = {};
  subRows_().forEach(function (r) {
    var k = /적립/.test(r.kind) ? 1 : /사용/.test(r.kind) ? -1 : 0;
    out[r.name] = Math.round(((out[r.name] || 0) + k * r.days) * 10) / 10;
  });
  return out;
}

function addSub_(date, name, kind, days, why) {
  var sh = book_().getSheetByName(SHEETS.sub) || ensureSheet_(book_(), SHEETS.sub, SUB_HEAD, [], SUB_FMT);
  var now = nowKst_();
  sh.appendRow([date, name, kind, days, why, now.date + ' ' + now.time]);
  forget_('sub');
}

/** 그날 출근이 찍힌 매장(찍은 매장, 없으면 소속 매장) → true. */
function openedStores_(logs) {
  var out = {};
  logs.forEach(function (r) {
    if (!r.tIn) return;
    var q = findStaff_(r.name);
    out[r.place || (q ? q.store : '')] = true;
    if (q) out[q.store] = true;
  });
  return out;
}

function subCredited_(date, name) {
  return subRows_().some(function (r) { return r.date === date && r.name === name && /적립/.test(r.kind); });
}

/** 그날 그 사람 적립이 아직 없을 때만 적어요(마감 정리가 두 번 돌아도 한 번만). 적었으면 true. */
function addSubOnce_(date, name, days, why) {
  if (subCredited_(date, name)) return false;
  addSub_(date, name, '적립', days, why);
  return true;
}

function fmtDays_(n) { return String(Math.round(n * 10) / 10); }

function addDays_(date, n) {
  var p = date.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
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

/** '10:00-20:00', '10:00~20:00', '10-20', '11:00'(퇴근 미정) → {start, end|null}. 빈칸·휴무·휴가 → null. */
function parseSchedule_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || OFF_RE.test(s) || /off/i.test(s)) return null;
  var parts = s.split(/\s*[-~–—]\s*/);
  var a = parseTime_(parts[0]);
  if (a == null || parts.length > 2) return null;
  var b = parts.length === 2 && parts[1] !== '' ? parseTime_(parts[1]) : null;
  if (parts.length === 2 && parts[1] !== '' && b == null) return null;
  return { start: a, end: b };
}

/** '2026-11-18', '2026. 11. 18', '2026/11/18' → '2026-11-18'. */
function parseDate_(v) {
  var m = String(v == null ? '' : v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // 없는 날짜(12/32, 2/30 등)는 날짜로 안 봐요
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return '';
  return m[1] + '-' + pad2_(mo) + '-' + pad2_(d);
}

function dowOf_(date) {
  var p = date.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function validYm_(ym) {
  return /^\d{4}-\d{2}$/.test(String(ym || '')) ? String(ym) : '';
}

/** '2026-12', '2026.12', '2026/12', '202612' → '2026-12'. 못 읽으면 ''. */
function normYm_(v) {
  var m = /^\s*(\d{4})\s*[-.\/년]?\s*(\d{1,2})\s*월?\s*$/.exec(String(v == null ? '' : v));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return '';
  return m[1] + '-' + pad2_(Number(m[2]));
}

/** a 달에서 b 달까지 몇 달인지(b가 앞이면 음수). */
function monthsBetween_(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
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
  Index: "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>출퇴근</title>\n<style>\n  :root {\n    --bg: #f4f5f7; --card: #ffffff; --text: #15171c; --muted: #6b7280; --line: #e4e7ec;\n    --chip: #eef1f5; --in: #0b8a4c; --in-bg: #e7f6ee; --out: #2557d6; --out-bg: #e9effd;\n    --warn: #b45309; --warn-bg: #fdf3e3; --bad: #c62828; --bad-bg: #fdecec;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --bg: #0f1115; --card: #181b21; --text: #eceef2; --muted: #9aa1ad; --line: #2a2f38;\n      --chip: #22262e; --in: #3ccf86; --in-bg: #14271d; --out: #7aa2ff; --out-bg: #18213a;\n      --warn: #f2b45a; --warn-bg: #2b2215; --bad: #ff7b7b; --bad-bg: #2d1717;\n    }\n  }\n  * { box-sizing: border-box; }\n  body {\n    margin: 0; background: var(--bg); color: var(--text);\n    font: 16px/1.5 -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", \"Noto Sans KR\", \"Malgun Gothic\", sans-serif;\n    -webkit-tap-highlight-color: transparent;\n  }\n  .wrap { max-width: 440px; margin: 0 auto; padding: 20px 16px 40px; }\n  header { text-align: center; padding: 8px 0 20px; }\n  .store { font-size: 15px; font-weight: 600; color: var(--muted); }\n  .clock { font-size: 52px; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; line-height: 1.15; }\n  .date { color: var(--muted); }\n  .card { background: var(--card); border-radius: 18px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04); }\n  h2 { font-size: 17px; margin: 0 0 14px; }\n  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }\n  .group { font-size: 13px; font-weight: 700; color: var(--muted); margin: 16px 0 8px; }\n  .group:first-child { margin-top: 0; }\n  .pinhint { font-size: 13px; color: var(--warn); background: var(--warn-bg); border-radius: 10px; padding: 8px 10px; margin: 0 0 8px; }\n  .notice { background: var(--warn-bg); color: var(--warn); border-radius: 12px; padding: 10px 12px; font-size: 14px; margin: 0 0 12px; }\n  .notice .sbtn { margin-top: 8px; display: block; }\n  .row2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n  .row2 .check { margin-top: 10px; }\n  .link.small { font-size: 13px; padding-top: 10px; }\n  .pinchange { background: var(--chip); border-radius: 12px; padding: 12px; margin-top: 10px; }\n  .agree { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--text); background: var(--out-bg); border-radius: 12px; padding: 10px 12px; margin-top: 12px; line-height: 1.45; }\n  .agree input { margin-top: 3px; width: 18px; height: 18px; flex: none; }\n  .storetag { font-size: 14px; font-weight: 500; color: var(--muted); margin-left: 6px; }\n  .name {\n    height: 56px; border: 1px solid var(--line); background: var(--card); color: var(--text);\n    border-radius: 14px; font: inherit; font-size: 18px; font-weight: 600;\n  }\n  .name:active { background: var(--chip); }\n  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n  .who { font-size: 22px; font-weight: 700; }\n  .link { background: none; border: 0; color: var(--out); font: inherit; font-size: 15px; padding: 6px 0; cursor: pointer; }\n  .today { margin: 6px 0 16px; color: var(--muted); }\n  .today b { color: var(--text); font-weight: 600; }\n  label.pin { display: block; font-size: 14px; color: var(--muted); margin-bottom: 6px; }\n  input.pin {\n    width: 100%; height: 52px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg);\n    color: var(--text); font-size: 24px; letter-spacing: 8px; text-align: center; font-family: inherit;\n  }\n  input.pin:focus { outline: 2px solid var(--out); border-color: transparent; }\n  .check { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--muted); margin: 10px 0 0; }\n  .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }\n  .big {\n    height: 96px; border: 0; border-radius: 18px; font: inherit; font-size: 26px; font-weight: 700;\n    color: #fff; cursor: pointer; transition: transform .05s, opacity .2s;\n  }\n  .big:active { transform: scale(.98); }\n  .big.in { background: var(--in); }\n  .big.out { background: var(--out); }\n  .big:disabled { opacity: .3; }\n  .result { margin-top: 16px; border-radius: 14px; padding: 14px 16px; }\n  .result .t { font-size: 20px; font-weight: 700; }\n  .result.ok { background: var(--in-bg); color: var(--in); }\n  .result.warn { background: var(--warn-bg); color: var(--warn); }\n  .result.bad { background: var(--bad-bg); color: var(--bad); }\n  .result.busy { background: var(--chip); color: var(--muted); }\n  .mine-btn { display: block; margin: 18px auto 0; }\n  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }\n  .chip { background: var(--chip); border-radius: 999px; padding: 4px 10px; font-size: 13px; }\n  .chip.red { background: var(--bad-bg); color: var(--bad); }\n  table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }\n  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 6px 4px; border-bottom: 1px solid var(--line); }\n  td { padding: 8px 4px; border-bottom: 1px solid var(--line); }\n  td.late { color: var(--bad); }\n  .memo { font-size: 12px; color: var(--muted); }\n  .note { text-align: center; color: var(--muted); font-size: 14px; margin-top: 16px; }\n  .inapp { background: var(--warn-bg); color: var(--warn); border-radius: 14px; padding: 12px 14px; font-size: 14px; margin-bottom: 14px; }\n  #reqCard { margin-top: 14px; }\n  h3 { font-size: 14px; color: var(--muted); font-weight: 600; margin: 20px 0 6px; }\n  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: var(--chip); border-radius: 12px; padding: 4px; }\n  .seg button { height: 40px; border: 0; background: none; border-radius: 9px; font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); cursor: pointer; }\n  .seg button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.08); }\n  .hint { color: var(--muted); font-size: 13px; margin: 12px 0 0; }\n  .f { margin-top: 12px; }\n  .f > label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }\n  .f input[type=text], .f input[type=date], .f input[type=time], .f select {\n    width: 100%; height: 46px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--text);\n    font: inherit; font-size: 16px; padding: 0 12px; -webkit-appearance: none; appearance: none;\n  }\n  .radios { display: flex; flex-wrap: wrap; gap: 4px 16px; min-height: 40px; align-items: center; }\n  .radios label { display: flex; gap: 6px; align-items: center; font-size: 16px; }\n  .send { width: 100%; height: 50px; margin-top: 14px; border: 0; border-radius: 12px; background: var(--out); color: #fff; font: inherit; font-weight: 700; font-size: 16px; cursor: pointer; }\n  .send:disabled { opacity: .5; }\n  .rmsg { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; font-size: 14px; background: var(--in-bg); color: var(--in); }\n  .rmsg.bad { background: var(--bad-bg); color: var(--bad); }\n  .item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 15px; }\n  .item:last-child { border-bottom: 0; }\n  .item .what { flex: 1; min-width: 0; }\n  .item .sub { font-size: 12px; color: var(--muted); }\n  .sbtn { height: 36px; padding: 0 12px; border: 0; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }\n  .sbtn.go { background: var(--out); color: #fff; }\n  .sbtn.ghost { background: var(--chip); color: var(--text); }\n  .swapbox { background: var(--out-bg); border-radius: 14px; padding: 4px 14px; margin-bottom: 14px; }\n  .swapbox .t { font-size: 13px; font-weight: 700; color: var(--out); padding-top: 8px; }\n  .badge { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--chip); color: var(--muted); white-space: nowrap; }\n  .badge.wait { background: var(--warn-bg); color: var(--warn); }\n  .badge.ok { background: var(--in-bg); color: var(--in); }\n  .badge.no { background: var(--bad-bg); color: var(--bad); }\n  .two { display: flex; justify-content: center; gap: 20px; margin-top: 14px; }\n  .two .link { padding: 6px 0; }\n  .ymseg { display: inline-grid; grid-template-columns: 1fr 1fr; gap: 4px; background: var(--chip); border-radius: 10px; padding: 3px; flex: none; }\n  .ymseg button { height: 32px; padding: 0 12px; border: 0; background: none; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); cursor: pointer; }\n  .ymseg button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.08); }\n  #schedCard, #tgCard { margin-top: 14px; }\n  .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; margin-top: 12px; align-items: start; }\n  .cal .h { text-align: center; font-size: 12px; color: var(--muted); padding: 2px 0; }\n  .cal .h.sun { color: var(--bad); }\n  .cal .h.sat { color: var(--out); }\n  .cal .d { height: 58px; min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); padding: 4px 1px 3px; font: inherit; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; }\n  .cal .d .n { font-size: 13px; font-weight: 700; line-height: 1.2; }\n  .cal .d.sun .n, .cal .d.hol .n { color: var(--bad); }\n  .cal .d.sat .n { color: var(--out); }\n  .cal .d .m { font-size: 10px; font-weight: 700; line-height: 1.5; border-radius: 5px; padding: 0 3px; max-width: 100%; overflow: hidden; white-space: nowrap; }\n  .cal .d .o { font-size: 10px; color: var(--muted); line-height: 1.2; }\n  .cal .d.full .o { color: var(--bad); font-weight: 700; }\n  .cal .d.now { border-color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }\n  .cal .d.sel { background: var(--chip); }\n  .cal .d.block { opacity: .4; }\n  .cal .gap { height: 58px; }\n  .m.off { background: var(--out-bg); color: var(--out); }\n  .m.wish { background: var(--warn-bg); color: var(--warn); }\n  .m.late, .m.absent { background: var(--bad-bg); color: var(--bad); }\n  .m.swap { background: var(--in-bg); color: var(--in); }\n  .dayinfo { font-size: 14px; margin-top: 10px; background: var(--chip); border-radius: 10px; padding: 8px 10px; }\n  .dayinfo .red { color: var(--bad); }\n  .legend { font-size: 12px; color: var(--muted); margin: 8px 0 0; }\n  a.send { display: flex; align-items: center; justify-content: center; text-decoration: none; }\n  [hidden] { display: none !important; }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n  <header>\n    <div class=\"store\" id=\"store\">출퇴근</div>\n    <div class=\"clock\" id=\"clock\">--:--:--</div>\n    <div class=\"date\" id=\"date\">&nbsp;</div>\n  </header>\n\n  <div class=\"inapp\" id=\"inapp\" hidden>\n    <b>카톡 안에서 열렸어요.</b> 카톡 안에서 찍으면 나중에 사파리·크롬으로 열었을 때 \"새 폰\"으로 인식될 수 있어요.\n    오른쪽 위(또는 아래) <b>⋯ → 다른 브라우저로 열기</b>를 누른 뒤, 그 브라우저에서 <b>홈 화면에 추가</b>해서 쓰세요.\n  </div>\n\n  <section class=\"card\" id=\"pick\" hidden>\n    <h2>본인 이름을 눌러주세요</h2>\n    <div id=\"names\"></div>\n  </section>\n\n  <section class=\"card\" id=\"me\" hidden>\n    <div class=\"row\">\n      <div class=\"who\" id=\"who\"></div>\n      <button class=\"link\" id=\"change\">다른 사람</button>\n    </div>\n    <div class=\"today\" id=\"today\">&nbsp;</div>\n    <div class=\"notice\" id=\"missOut\" hidden></div>\n    <div class=\"notice\" id=\"testNote\" hidden><b>테스트 직원이에요.</b> 어디서든 찍히고 폰 등록·위치 확인을 안 해요. 월별·정산에서 빠지고, 사장님이 [테스트 지우기]로 기록을 지울 수 있어요.</div>\n    <div class=\"notice\" id=\"wishBar\" hidden></div>\n    <div class=\"notice\" id=\"weakPin\" hidden>비밀번호가 <b>1234처럼 쉽거나 다른 직원과 같아요.</b> 남이 대신 찍을 수 있으니 바꿔주세요.\n      <button class=\"sbtn ghost\" id=\"weakGo\" type=\"button\">비밀번호 바꾸기</button></div>\n\n    <div id=\"pinBox\">\n      <p class=\"pinhint\" id=\"pinHint\" hidden>처음이에요! 앞으로 쓸 <b>비밀번호 4자리</b>를 정해서 넣고 출근을 누르세요. 다음부터는 이 번호로 찍어요.</p>\n      <label class=\"pin\" for=\"pin\" id=\"pinLabel\">비밀번호</label>\n      <input class=\"pin\" id=\"pin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]*\" maxlength=\"8\" autocomplete=\"off\">\n      <div class=\"row2\">\n        <label class=\"check\"><input type=\"checkbox\" id=\"remember\" checked> 이 폰에서 비밀번호 기억하기</label>\n        <button class=\"link small\" id=\"pinChangeBtn\" type=\"button\" hidden>비밀번호 바꾸기</button>\n      </div>\n      <form class=\"pinchange\" id=\"pinChange\" hidden>\n        <label class=\"pin\" for=\"newPin\">새 비밀번호 (숫자 4~6자리)</label>\n        <input class=\"pin\" id=\"newPin\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]*\" maxlength=\"6\" autocomplete=\"off\">\n        <label class=\"pin\" for=\"newPin2\" style=\"margin-top:8px\">한 번 더</label>\n        <input class=\"pin\" id=\"newPin2\" type=\"password\" inputmode=\"numeric\" pattern=\"[0-9]*\" maxlength=\"6\" autocomplete=\"off\">\n        <button class=\"send\" type=\"submit\" id=\"pinChangeSend\">바꾸기</button>\n        <p class=\"rmsg\" id=\"pinChangeMsg\" hidden></p>\n      </form>\n      <label class=\"agree\" id=\"agreeBox\" hidden><input type=\"checkbox\" id=\"agree\">\n        <span><b>처음 한 번 동의가 필요해요.</b> 출퇴근을 확인하려고 <b>찍은 시간, 매장까지 거리, 폰 종류</b>를 회사 시트에 기록하는 데 동의해요. (정확한 위치 좌표는 저장하지 않아요)</span></label>\n    </div>\n\n    <div class=\"btns\">\n      <button class=\"big in\" id=\"btnIn\">출근</button>\n      <button class=\"big out\" id=\"btnOut\">퇴근</button>\n    </div>\n\n    <div class=\"result\" id=\"result\" hidden><div class=\"t\" id=\"rt\"></div><div id=\"rs\"></div></div>\n\n    <div class=\"two\">\n      <button class=\"link\" id=\"mineBtn\">이번 달 내 기록</button>\n      <button class=\"link\" id=\"schedBtn\">근무표 · 휴무</button>\n    </div>\n    <div id=\"mine\" hidden></div>\n  </section>\n\n  <section class=\"card\" id=\"schedCard\" hidden>\n    <div class=\"row\">\n      <h2 style=\"margin:0\">근무표<span class=\"storetag\" id=\"schedStore\"></span></h2>\n      <div class=\"ymseg\" id=\"ymSeg\"><button data-off=\"0\" class=\"on\">이번 달</button><button data-off=\"1\">다음 달</button></div>\n    </div>\n    <div class=\"chips\" id=\"schedSum\"></div>\n    <div class=\"notice\" id=\"wishInfo\" hidden></div>\n    <div class=\"cal\" id=\"cal\"></div>\n    <div class=\"dayinfo\" id=\"dayInfo\" hidden></div>\n    <p class=\"rmsg\" id=\"schedMsg\" hidden></p>\n    <p class=\"legend\">날짜 아래 숫자 = 그날 쉬는 동료 수 · <b>휴무?</b> = 고른 휴무(사장님 확정 전) · 날짜를 누르면 누가 쉬는지 보여요</p>\n  </section>\n\n  <section class=\"card\" id=\"reqCard\" hidden>\n    <h2>요청 · 대타</h2>\n    <div id=\"swaps\"></div>\n    <div class=\"seg\" id=\"kinds\">\n      <button data-kind=\"fix\">기록 정정</button>\n      <button data-kind=\"off\">휴무 신청</button>\n      <button data-kind=\"swap\">대타 구하기</button>\n    </div>\n    <form id=\"reqForm\" hidden>\n      <p class=\"hint\" id=\"fHint\"></p>\n      <div class=\"f\" id=\"wDateFix\"><label for=\"fDateFix\">날짜</label><select id=\"fDateFix\"></select></div>\n      <div class=\"f\" id=\"wDate\"><label for=\"fDate\">날짜</label><input type=\"date\" id=\"fDate\"></div>\n      <div class=\"f\" id=\"wOff\">\n        <label>무엇으로</label>\n        <div class=\"radios\">\n          <label><input type=\"radio\" name=\"foff\" value=\"휴무\" checked> 휴무</label>\n          <label><input type=\"radio\" name=\"foff\" value=\"월차\"> 월차</label>\n          <label><input type=\"radio\" name=\"foff\" value=\"반차\"> 반차</label>\n          <label><input type=\"radio\" name=\"foff\" value=\"대체\"> 대체휴무</label>\n        </div>\n      </div>\n      <div class=\"f\" id=\"wType\">\n        <label>무엇을</label>\n        <div class=\"radios\">\n          <label><input type=\"radio\" name=\"ftype\" value=\"in\"> 출근</label>\n          <label><input type=\"radio\" name=\"ftype\" value=\"out\" checked> 퇴근</label>\n        </div>\n      </div>\n      <div class=\"f\" id=\"wTime\"><label for=\"fTime\">실제 시간</label><input type=\"time\" id=\"fTime\"></div>\n      <div class=\"f\"><label for=\"fReason\" id=\"fReasonLabel\">사유</label><input type=\"text\" id=\"fReason\" maxlength=\"100\"></div>\n      <div class=\"f\" id=\"wTo\" hidden>\n        <label>누구에게 보낼까요</label>\n        <div class=\"radios\">\n          <label><input type=\"radio\" name=\"fto\" value=\"mgr\" checked> <span id=\"toMgr\">점장에게</span></label>\n          <label><input type=\"radio\" name=\"fto\" value=\"admin\"> 관리자에게 바로</label>\n        </div>\n      </div>\n      <button class=\"send\" id=\"fSend\" type=\"submit\">요청 보내기</button>\n    </form>\n    <p class=\"rmsg\" id=\"reqMsg\" hidden></p>\n    <h3>내 요청</h3>\n    <div id=\"myReqs\"><p class=\"hint\">불러오는 중…</p></div>\n  </section>\n\n  <section class=\"card\" id=\"tgCard\" hidden>\n    <div class=\"row\"><h2 style=\"margin:0\">텔레그램 알림</h2><span class=\"badge\" id=\"tgState\"></span></div>\n    <p class=\"hint\" id=\"tgHint\"></p>\n    <button class=\"send\" id=\"tgStart\" type=\"button\">텔레그램 알림 켜기</button>\n    <div id=\"tgStep\" hidden>\n      <a class=\"send\" id=\"tgOpen\" href=\"#\" target=\"_blank\" rel=\"noopener\">① 텔레그램 열고 [시작] 누르기</a>\n      <button class=\"send\" id=\"tgCheck\" type=\"button\" style=\"background:var(--in)\">② 돌아와서 연결 확인</button>\n    </div>\n    <button class=\"sbtn ghost\" id=\"tgOff\" type=\"button\" style=\"margin-top:12px\" hidden>알림 끄기</button>\n    <p class=\"rmsg\" id=\"tgMsg\" hidden></p>\n  </section>\n\n  <p class=\"note\" id=\"note\" hidden></p>\n</main>\n\n<script>\n  var $ = function (id) { return document.getElementById(id); };\n  var mem = {\n    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },\n    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },\n  };\n  var S = { info: null, me: null, today: null, busy: false };\n\n  function call(fn) {\n    var args = Array.prototype.slice.call(arguments, 1);\n    return new Promise(function (ok, no) {\n      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) {\n        no(new Error((e && e.message) || String(e)));\n      });\n      r[fn].apply(r, args);\n    });\n  }\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n  /* 이 폰의 고유 번호: 처음 열 때 한 번 만들어서 폰에 저장해요. 저장이 안 되는 브라우저면 ''. */\n  function deviceId() {\n    var id = mem.get('att:device');\n    if (id && /^[0-9a-f]{16}$/.test(id)) return id;\n    try {\n      var a = new Uint8Array(8);\n      crypto.getRandomValues(a);\n      id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');\n    } catch (e) { return ''; }\n    mem.set('att:device', id);\n    return mem.get('att:device') === id ? id : '';\n  }\n  function deviceLabel() {\n    var ua = navigator.userAgent;\n    var os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' :\n      /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '기타';\n    var br = /KAKAOTALK/i.test(ua) ? '카톡' : /NAVER/.test(ua) ? '네이버앱' : /SamsungBrowser/.test(ua) ? '삼성인터넷' :\n      /CriOS|Chrome/.test(ua) ? '크롬' : /Safari/.test(ua) ? '사파리' : '브라우저';\n    var standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);\n    return os + ' ' + br + (standalone ? '(홈화면)' : '');\n  }\n  var IN_APP = /KAKAOTALK|NAVER\\(inapp|Instagram|FBAN|FBAV|Line\\//i.test(navigator.userAgent);\n\n  function toMin(t) { var m = /^(\\d{1,2}):(\\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }\n  function nowMin() {\n    var p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date());\n    return toMin(p);\n  }\n  function hm(min) {\n    min = Math.round(min || 0);\n    var h = Math.floor(min / 60), m = min % 60;\n    return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';\n  }\n  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }\n\n  function tick() {\n    var d = new Date();\n    $('clock').textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });\n    $('date').textContent = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' });\n  }\n\n  function show(id) {\n    $('pick').hidden = id !== 'pick';\n    $('me').hidden = id !== 'me';\n    $('reqCard').hidden = id !== 'me';\n    if (id !== 'me') { $('schedCard').hidden = true; $('tgCard').hidden = true; }\n  }\n  function note(text) { $('note').hidden = !text; $('note').textContent = text || ''; }\n\n  function result(kind, title, sub) {\n    var box = $('result');\n    box.className = 'result ' + kind;\n    box.hidden = false;\n    $('rt').textContent = title;\n    $('rs').textContent = sub || '';\n  }\n\n  function renderNames() {\n    var list = S.info.staff;\n    if (!list.length) return ($('names').innerHTML = '<p class=\"note\">[직원] 시트에 이름을 먼저 넣어주세요.</p>');\n    var groups = [], by = {};\n    list.forEach(function (p) {\n      var k = p.store || '기타';\n      if (!by[k]) { by[k] = []; groups.push(k); }\n      by[k].push(p);\n    });\n    $('names').innerHTML = groups.map(function (g) {\n      return (groups.length > 1 ? '<div class=\"group\">' + esc(g) + '</div>' : '') + '<div class=\"grid\">' +\n        by[g].map(function (p) { return '<button class=\"name\" data-name=\"' + esc(p.name) + '\">' + esc(p.name) + '</button>'; }).join('') +\n        '</div>';\n    }).join('');\n  }\n\n  function renderPinBox() {\n    var first = !S.me.pin;\n    $('pinHint').hidden = !first;\n    $('pinLabel').textContent = first ? '새 비밀번호 (숫자 4자리)' : '비밀번호';\n    $('pinChangeBtn').hidden = first;\n    $('agreeBox').hidden = !!S.me.agreed;\n  }\n\n  function pick(name) {\n    var p = null;\n    S.info.staff.forEach(function (x) { if (x.name === name) p = x; });\n    if (!p) return show('pick');\n    S.me = p;\n    S.today = null;\n    mem.set('att:name', name);\n    $('who').innerHTML = esc(name) + (p.store ? '<span class=\"storetag\">' + esc(p.store) + '</span>' : '');\n    $('pin').value = mem.get('att:pin:' + name) || '';\n    renderPinBox();\n    $('result').hidden = true;\n    $('mine').hidden = true;\n    $('missOut').hidden = true;\n    $('weakPin').hidden = true;\n    $('wishBar').hidden = true;\n    $('testNote').hidden = !p.test;\n    $('pinChange').hidden = true;\n    $('schedCard').hidden = true;\n    $('tgCard').hidden = true;\n    SCH.data = null;\n    show('me');\n    closeForm();\n    REQ.data = null;\n    loadHome();\n  }\n\n  /* 오늘 근무·요청·퇴근 누락·쉬운 비밀번호를 한 번에 불러와요 */\n  function loadHome() {\n    $('today').textContent = '오늘 기록 불러오는 중…';\n    var pin = $('pin').value.trim();\n    return call('getHome', S.me.name, S.me.pin ? pin : '').then(function (h) {\n      S.today = h.today;\n      renderToday();\n      $('weakPin').hidden = !h.weakPin;\n      renderMissOut(h.missingOut);\n      renderWishBar(h.wish);\n      renderTg(h.tg);\n      if (h.requests) renderReqs(h.requests);\n      else if (h.pinError) {\n        $('myReqs').innerHTML = '<p class=\"hint\">' + esc(h.pinError) + '</p>';\n        $('swaps').innerHTML = '';\n      } else loadReqs();\n    }).catch(function (e) { $('today').textContent = e.message; });\n  }\n  function loadToday() { return loadHome(); }\n\n  function renderMissOut(m) {\n    var box = $('missOut');\n    box.hidden = !m;\n    if (!m) return;\n    box.innerHTML = '<b>' + esc(m.date.slice(5).replace('-', '/')) + '(' + esc(m.dow) + ') 퇴근을 안 찍었어요.</b> 출근 ' + esc(m.tIn) +\n      '. 실제 퇴근 시간을 사장님께 알려주세요.<button class=\"sbtn go\" type=\"button\" id=\"missGo\">퇴근 시간 알려주기</button>';\n    $('missGo').onclick = function () {\n      openForm('fix');\n      $('fDateFix').value = m.date;\n      var out = document.querySelector('input[name=ftype][value=out]');\n      if (out) out.checked = true;\n      $('fReason').value = '퇴근 찍는 걸 깜빡함';\n      $('fTime').focus();\n      $('reqCard').scrollIntoView({ behavior: 'smooth', block: 'start' });\n    };\n  }\n\n  function renderToday() {\n    var t = S.today;\n    var parts = [t.sIn ? '오늘 근무 <b>' + esc(t.sIn) + (t.sOut ? ' ~ ' + esc(t.sOut) : ' 출근') + '</b>' : '오늘은 쉬는 날이에요'];\n    if (t.tIn) parts.push('출근 <b>' + esc(t.tIn) + '</b>');\n    if (t.tOut) parts.push('퇴근 <b>' + esc(t.tOut) + '</b>');\n    $('today').innerHTML = parts.join(' · ');\n    $('btnIn').disabled = !!t.tIn;\n    $('btnOut').disabled = false;\n  }\n\n  /* 위치: 1분 안에 잡은 위치가 있으면 바로 쓰고, 정밀 GPS가 8초 안에 안 잡히면 대략 위치(와이파이·기지국)로 한 번 더 */\n  function getPos(opts) {\n    return new Promise(function (ok, no) {\n      if (!navigator.geolocation) return no({ code: 0 });\n      navigator.geolocation.getCurrentPosition(function (p) {\n        ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });\n      }, no, opts);\n    });\n  }\n  function locate() {\n    return getPos({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }).catch(function (e) {\n      if (e && e.code === 1) throw e; // 권한 거부는 다시 물어도 소용없어요\n      return getPos({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });\n    });\n  }\n  var IOS = /iPhone|iPad/.test(navigator.userAgent);\n  function geoError(e) {\n    if (e && e.code === 1) {\n      return ['위치 권한이 꺼져 있어요', IOS\n        ? '아이폰 설정 → 앱 → Safari → 위치 → \"허용\"으로 바꾼 뒤 다시 눌러주세요. (홈 화면 아이콘으로 쓰면 설정 → 개인정보 보호 → 위치 서비스가 켜져 있는지도 봐주세요)'\n        : '주소창 왼쪽 아이콘 → 권한 → 위치 \"허용\"으로 바꾼 뒤 다시 눌러주세요.'];\n    }\n    if (e && e.code === 3) return ['위치 확인이 오래 걸려요', '창가 쪽이나 문 근처에서 다시 눌러주세요.'];\n    return ['위치를 확인하지 못했어요', '휴대폰 위치(GPS)를 켜고 다시 눌러주세요.'];\n  }\n\n  function setBusy(on) {\n    S.busy = on;\n    $('btnIn').disabled = on || !!(S.today && S.today.tIn);\n    $('btnOut').disabled = on;\n  }\n\n  function punch(type) {\n    if (S.busy) return;\n    var pin = $('pin').value.trim();\n    if (!pin) { result('bad', S.me.pin ? '비밀번호를 넣어주세요' : '앞으로 쓸 비밀번호 4자리를 정해서 넣어주세요'); $('pin').focus(); return; }\n    if (!S.me.agreed && !$('agree').checked) { result('bad', '아래 동의 칸에 체크해주세요', '처음 한 번만 하면 돼요.'); $('agreeBox').scrollIntoView({ block: 'center' }); return; }\n    if (!S.me.pin && !confirm(S.me.name + ' 님 맞아요?\\n지금 정한 비밀번호로 이 이름이 내 것으로 등록돼요. 다른 사람 이름이면 [취소]를 누르세요.')) return;\n    var t = S.today;\n    if (type === 'out' && t && t.sOut && !t.tOut) {\n      var end = toMin(t.sOut), now = nowMin();\n      if (end != null && now != null && now < end &&\n          !confirm('퇴근 예정 시간(' + t.sOut + ')보다 일찍이에요.\\n지금 퇴근을 찍을까요?')) return;\n    }\n    if (type === 'out' && t && t.tOut &&\n        !confirm('오늘 ' + t.tOut + '에 이미 퇴근을 찍었어요.\\n지금 시간으로 다시 찍을까요?')) return;\n\n    setBusy(true);\n    var label = type === 'in' ? '출근' : '퇴근';\n    // 테스트 직원은 위치를 안 봐요(사장님이 어디서든 시험해 볼 수 있게)\n    var getPos = S.info.mode === '안함' || S.me.test ? Promise.resolve(null) : (result('busy', '위치 확인 중…'), locate());\n    getPos.then(function (pos) { return pos; }, function (err) {\n      if (S.info.mode === '필수') { var m = geoError(err); throw new Error(m[0] + '\\n' + m[1]); }\n      return null;\n    }).then(function (pos) {\n      result('busy', label + ' 기록 중…');\n      var body = {\n        name: S.me.name, pin: pin, type: type,\n        lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, acc: pos ? pos.acc : null,\n        device: deviceId(), label: deviceLabel(), agree: S.me.agreed || $('agree').checked,\n      };\n      // 11시처럼 사람이 몰려서 밀리면 1초 뒤 한 번 더 자동으로 보내요\n      return call('punch', body).catch(function (err) {\n        if (!/잠깐 밀렸어요/.test(err.message)) throw err;\n        result('busy', '사람이 많아서 다시 보내는 중…');\n        return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return call('punch', body); });\n      });\n    }).then(function (r) {\n      mem.set('att:pin:' + S.me.name, $('remember').checked && pin ? pin : null);\n      var firstTime = !S.me.pin;\n      if (!S.me.pin || !S.me.agreed) { S.me.pin = true; S.me.agreed = true; renderPinBox(); }\n      $('weakPin').hidden = !r.weakPin;\n      S.today = r.today;\n      var sub;\n      if (r.type === 'in') {\n        sub = r.late ? r.late + '분 지각으로 기록됐어요.' : '정상 출근으로 기록됐어요.';\n      } else {\n        sub = r.work != null ? '오늘 ' + hm(r.work) + ' 근무했어요.' : '출근 기록이 없어서 사장님께 표시돼요.';\n        if (r.early) sub += ' (예정보다 ' + r.early + '분 일찍 퇴근)';\n      }\n      if (S.me.test) sub += ' 테스트라 위치는 안 봤어요.';\n      else if (r.place) sub += ' ' + r.place + '에서 찍었어요.';\n      if (firstTime) sub += ' 비밀번호가 등록됐어요.';\n      result(r.late || r.early ? 'warn' : 'ok', label + ' 완료 · ' + r.time, sub);\n      if (!$('mine').hidden) loadMine();\n      if (!REQ.data || firstTime) loadReqs();\n    }).catch(function (e) {\n      // 첫 문장은 크게, 나머지는 작게\n      var msg = String(e.message);\n      var m = /^(.+?[.!?])[\\s\\n]+([\\s\\S]+)$/.exec(msg) || /^(.+?)\\n([\\s\\S]+)$/.exec(msg);\n      if (!m) return result('bad', msg);\n      result('bad', m[1], m[2].replace(/\\n/g, ' '));\n    }).then(function () {\n      setBusy(false);\n      if (S.today) renderToday();\n    });\n  }\n\n  function loadMine() {\n    var box = $('mine');\n    box.hidden = false;\n    box.innerHTML = '<p class=\"note\">불러오는 중…</p>';\n    call('getMyMonth', S.me.name, $('pin').value.trim(), '').then(function (r) {\n      var t = r.total;\n      var chips = [\n        '근무 ' + t.days + '일', '총 ' + hm(t.work),\n        '<span class=\"chip' + (t.lateCount ? ' red' : '') + '\">지각 ' + t.lateCount + '회' + (t.lateMin ? ' · ' + t.lateMin + '분' : '') + '</span>',\n      ];\n      if (t.deduct) chips.push('<span class=\"chip red\">차감 ' + won(t.deduct) + '</span>');\n      var html = '<div class=\"chips\">' + chips.map(function (c) { return c.indexOf('<span') === 0 ? c : '<span class=\"chip\">' + c + '</span>'; }).join('') + '</div>';\n      if (!r.rows.length) return (box.innerHTML = html + '<p class=\"note\">이번 달 기록이 아직 없어요.</p>');\n      html += '<table><thead><tr><th>날짜</th><th>출근</th><th>퇴근</th><th>지각</th></tr></thead><tbody>';\n      r.rows.slice().reverse().forEach(function (x) {\n        html += '<tr><td>' + esc(x.date.slice(5).replace('-', '/')) + ' ' + esc(x.dow) +\n          (x.memo ? '<div class=\"memo\">' + esc(x.memo) + '</div>' : '') + '</td><td>' + esc(x.tIn || '-') + '</td><td>' +\n          esc(x.tOut || '-') + '</td><td class=\"' + (x.late ? 'late' : '') + '\">' + (x.late ? x.late + '분' : '') + '</td></tr>';\n      });\n      box.innerHTML = html + '</tbody></table>';\n    }).catch(function (e) { box.innerHTML = '<p class=\"note\">' + esc(e.message) + '</p>'; });\n  }\n\n  $('names').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-name]');\n    if (b) pick(b.getAttribute('data-name'));\n  });\n  $('change').addEventListener('click', function () { mem.set('att:name', null); show('pick'); });\n  $('btnIn').addEventListener('click', function () { punch('in'); });\n  $('btnOut').addEventListener('click', function () { punch('out'); });\n  $('mineBtn').addEventListener('click', function () {\n    if ($('mine').hidden) loadMine(); else $('mine').hidden = true;\n  });\n  $('schedBtn').addEventListener('click', function () {\n    if ($('schedCard').hidden) openSched(0); else $('schedCard').hidden = true;\n  });\n\n  /* ───── 근무표 · 다음 달 휴무 고르기 ───── */\n  var SCH = { off: 0, data: null, sel: 0, busy: false };\n  function pad(n) { return (n < 10 ? '0' : '') + n; }\n  function ymOf(off) {\n    var d = new Date(Date.now() + 9 * 3600e3);\n    var y = d.getUTCFullYear(), m = d.getUTCMonth() + off;\n    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;\n    return y + '-' + pad(m + 1);\n  }\n  function schedMsg(text, bad) {\n    $('schedMsg').hidden = !text;\n    $('schedMsg').className = 'rmsg' + (bad ? ' bad' : '');\n    $('schedMsg').textContent = text || '';\n  }\n  function renderWishBar(w) {\n    var box = $('wishBar');\n    box.hidden = !(w && w.open);\n    if (box.hidden) return;\n    var m = Number(w.ym.slice(5));\n    box.innerHTML = '<b>' + m + '월 휴무 고르는 기간이에요</b> (' + esc(w.text) + '). 근무표에서 쉬고 싶은 날을 눌러 골라주세요.' +\n      '<button class=\"sbtn go\" type=\"button\" id=\"wishGo\">' + m + '월 휴무 고르기</button>';\n    $('wishGo').onclick = function () { openSched(1); };\n  }\n  function openSched(off) {\n    $('schedCard').hidden = false;\n    loadSched(off);\n    $('schedCard').scrollIntoView({ behavior: 'smooth', block: 'start' });\n  }\n  function loadSched(off) {\n    SCH.off = off;\n    SCH.sel = 0;\n    Array.prototype.forEach.call(document.querySelectorAll('#ymSeg button'), function (b) {\n      b.classList.toggle('on', +b.getAttribute('data-off') === off);\n      b.textContent = Number(ymOf(+b.getAttribute('data-off')).slice(5)) + '월';\n    });\n    schedMsg('');\n    $('dayInfo').hidden = true;\n    var pin = $('pin').value.trim();\n    if (!S.me.pin) { $('cal').innerHTML = ''; $('schedSum').innerHTML = ''; $('wishInfo').hidden = true; return schedMsg('처음 출근을 찍어서 비밀번호를 정하면 근무표를 볼 수 있어요.', true); }\n    if (!pin) { $('cal').innerHTML = ''; $('schedSum').innerHTML = ''; $('wishInfo').hidden = true; return schedMsg('위에 비밀번호를 먼저 넣어주세요.', true); }\n    $('cal').innerHTML = '<p class=\"hint\" style=\"grid-column:1/-1\">불러오는 중…</p>';\n    call('getSchedule', S.me.name, pin, ymOf(off)).then(renderSched).catch(function (e) {\n      $('cal').innerHTML = '';\n      schedMsg(e.message, true);\n    });\n  }\n  function isOff(m) { return !!m && m !== '대타' && m !== '지각' && m !== '결근?' && !/반차/.test(m); }\n  function markClass(m) {\n    if (!m) return '';\n    if (m === '휴무?') return 'wish';\n    if (m === '지각') return 'late';\n    if (m === '결근?') return 'absent';\n    if (m === '대타') return 'swap';\n    return 'off';\n  }\n  function renderSched(sd) {\n    SCH.data = sd;\n    $('schedStore').textContent = sd.store || '';\n    var u = sd.sum, chips = [];\n    chips.push('휴무 ' + u.off + '일');\n    if (u.monthlyLeft != null) chips.push('월차 남음 ' + u.monthlyLeft + '일');\n    else if (u.monthly) chips.push('월차 ' + u.monthly + '일');\n    if (u.sub || u.subPending) chips.push('대체휴무 ' + u.sub + '일' + (u.subPending ? ' (신청 중 ' + u.subPending + ')' : ''));\n    if (u.wishes) chips.push('<b>고른 휴무 ' + u.wishes + '일</b>');\n    $('schedSum').innerHTML = chips.map(function (c) { return '<span class=\"chip\">' + c + '</span>'; }).join('');\n    var w = sd.wish;\n    var info = $('wishInfo');\n    info.hidden = !w;\n    if (w) {\n      var m = Number(sd.ym.slice(5));\n      var rules = [w.maxOff ? '하루 최대 ' + w.maxOff + '명' : '', w.monthOff ? '한 달 최대 ' + w.monthOff + '일' : ''].filter(String).join(' · ');\n      info.innerHTML = w.open\n        ? '<b>' + m + '월 휴무 고르기</b> (' + esc(w.text) + '): 쉬고 싶은 날을 누르면 <b>휴무?</b>가 들어가고, 한 번 더 누르면 빠져요.' +\n          (rules ? ' ' + rules + '.' : '') + ' 사장님이 확정하면 휴무가 돼요.'\n        : esc(w.msg);\n    }\n    var hol = sd.holidays || {};\n    var html = '일월화수목금토'.split('').map(function (d, i) {\n      return '<div class=\"h' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '\">' + d + '</div>';\n    }).join('');\n    for (var g = 0; g < sd.firstDow; g++) html += '<div class=\"gap\"></div>';\n    for (var d = 1; d <= sd.days; d++) {\n      var date = sd.ym + '-' + pad(d);\n      var dow = (sd.firstDow + d - 1) % 7;\n      var mine = sd.me[d - 1];\n      var others = sd.others.filter(function (o) { return isOff(o.days[d - 1]); }).length;\n      var full = w && w.open && w.maxOff && sd.count[d - 1] >= w.maxOff && !isOff(mine);\n      var cls = ['d', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', hol[date] ? 'hol' : '', date === sd.today ? 'now' : '',\n        SCH.sel === d ? 'sel' : '', full ? 'full' : '', w && w.blocked.indexOf(d) >= 0 ? 'block' : ''].filter(String).join(' ');\n      html += '<button type=\"button\" class=\"' + cls + '\" data-d=\"' + d + '\"><span class=\"n\">' + d + '</span>' +\n        (mine ? '<span class=\"m ' + markClass(mine) + '\">' + esc(mine) + '</span>' : '') +\n        (others ? '<span class=\"o\">' + others + '명</span>' : '') + '</button>';\n    }\n    $('cal').innerHTML = html;\n    if (SCH.sel) showDay(SCH.sel);\n  }\n  function showDay(d) {\n    var sd = SCH.data;\n    var date = sd.ym + '-' + pad(d);\n    var parts = ['<b>' + dayLabel(date) + '</b>'];\n    if (sd.holidays[date]) parts.push('<span class=\"red\">' + esc(sd.holidays[date]) + '</span>');\n    if (sd.me[d - 1]) parts.push('나: ' + esc(sd.me[d - 1]));\n    var offs = sd.others.filter(function (o) { return o.days[d - 1]; }).map(function (o) { return esc(o.name) + '(' + esc(o.days[d - 1]) + ')'; });\n    parts.push(offs.length ? offs.join(', ') : '쉬는 동료 없음');\n    $('dayInfo').innerHTML = parts.join(' · ');\n    $('dayInfo').hidden = false;\n  }\n  $('ymSeg').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-off]');\n    if (b) loadSched(+b.getAttribute('data-off'));\n  });\n  $('cal').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-d]');\n    var sd = SCH.data;\n    if (!b || !sd || SCH.busy) return;\n    var d = +b.getAttribute('data-d');\n    SCH.sel = d;\n    var mine = sd.me[d - 1];\n    if (sd.wish && sd.wish.open && (!mine || mine === '휴무?')) {\n      var on = !mine;\n      SCH.busy = true;\n      schedMsg(on ? '고르는 중…' : '빼는 중…');\n      call('wishDay', S.me.name, $('pin').value.trim(), sd.ym + '-' + pad(d), on).then(function (r) {\n        renderSched(r);\n        schedMsg(dayLabel(sd.ym + '-' + pad(d)) + (on ? ' 휴무?를 넣었어요. 사장님이 확정하면 휴무가 돼요.' : ' 휴무?를 뺐어요.'));\n      }).catch(function (err) {\n        renderSched(sd);\n        schedMsg(err.message, true);\n      }).then(function () { SCH.busy = false; });\n      return;\n    }\n    renderSched(sd);\n  });\n\n  /* ───── 텔레그램 알림 (직원) ───── */\n  function tgMsg(text, bad) {\n    $('tgMsg').hidden = !text;\n    $('tgMsg').className = 'rmsg' + (bad ? ' bad' : '');\n    $('tgMsg').textContent = text || '';\n  }\n  function renderTg(state) {\n    $('tgCard').hidden = !state;\n    if (!state) return;\n    var on = state === 'on';\n    $('tgState').className = 'badge' + (on ? ' ok' : '');\n    $('tgState').textContent = on ? '켜짐' : '꺼짐';\n    $('tgHint').textContent = on\n      ? '요청 결과, 동료 대타 구함, 출근 전 알림, 퇴근 안 찍음 알림이 텔레그램으로 와요.'\n      : '텔레그램 앱이 있으면 켜보세요. 요청 결과, 동료 대타 구함, 출근 전 알림을 받을 수 있어요. (무료)';\n    $('tgStart').hidden = on;\n    $('tgStep').hidden = true;\n    $('tgOff').hidden = !on;\n  }\n  $('tgStart').addEventListener('click', function () {\n    var pin = $('pin').value.trim();\n    if (!pin) return tgMsg('위에 비밀번호를 먼저 넣어주세요.', true);\n    $('tgStart').disabled = true;\n    tgMsg('');\n    call('staffTgStart', S.me.name, pin).then(function (r) {\n      $('tgOpen').href = r.url;\n      $('tgStep').hidden = false;\n      $('tgStart').hidden = true;\n      tgMsg('①을 눌러 텔레그램에서 @' + r.bot + ' 봇의 [시작]을 누른 뒤, 이 화면으로 돌아와 ②를 눌러주세요.');\n    }).catch(function (e) { tgMsg(e.message, true); }).then(function () { $('tgStart').disabled = false; });\n  });\n  $('tgCheck').addEventListener('click', function () {\n    $('tgCheck').disabled = true;\n    call('staffTgCheck', S.me.name, $('pin').value.trim()).then(function (r) {\n      renderTg(r.tg);\n      tgMsg('연결됐어요! 텔레그램에 시험 메시지를 보냈어요.');\n    }).catch(function (e) { tgMsg(e.message, true); }).then(function () { $('tgCheck').disabled = false; });\n  });\n  $('tgOff').addEventListener('click', function () {\n    if (!confirm('텔레그램 알림을 끌까요?')) return;\n    call('staffTgOff', S.me.name, $('pin').value.trim()).then(function (r) {\n      renderTg(r.tg);\n      tgMsg('알림을 껐어요.');\n    }).catch(function (e) { tgMsg(e.message, true); });\n  });\n\n  /* ───── 요청 · 대타 ───── */\n  var REQ = { kind: '', data: null };\n  var KIND = { '정정': '기록 정정', '휴무': '휴무', '월차': '월차', '반차': '반차', '대체': '대체휴무', '대타': '대타' };\n  // '올림 11/16 15:00 박점장 · 한마디' → {who: '박점장', note: '한마디'}\n  function mgrNote(t) {\n    var parts = String(t || '').split(' · ');\n    return { who: (parts[0].split(' ')[3] || '점장'), note: parts.slice(1).join(' · ') };\n  }\n\n  function kstDate(plusDays) {\n    return new Date(Date.now() + 9 * 3600e3 + (plusDays || 0) * 864e5).toISOString().slice(0, 10);\n  }\n  function dayLabel(date) {\n    var p = date.split('-').map(Number);\n    var dow = '일월화수목금토'.charAt(new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay());\n    return p[1] + '/' + p[2] + '(' + dow + ')';\n  }\n  function reqMsg(text, bad) {\n    $('reqMsg').hidden = !text;\n    $('reqMsg').className = 'rmsg' + (bad ? ' bad' : '');\n    $('reqMsg').textContent = text || '';\n  }\n\n  function loadReqs() {\n    var pin = $('pin').value.trim();\n    if (!S.me.pin) {\n      $('myReqs').innerHTML = '<p class=\"hint\">처음 출근을 찍어서 비밀번호를 정하면 요청 기능을 쓸 수 있어요.</p>';\n      $('swaps').innerHTML = '';\n      return;\n    }\n    if (!pin) {\n      $('myReqs').innerHTML = '<p class=\"hint\">비밀번호를 넣으면 내 요청과 대타 구함이 보여요.</p>';\n      $('swaps').innerHTML = '';\n      return;\n    }\n    call('getRequests', S.me.name, pin).then(renderReqs).catch(function (e) {\n      $('myReqs').innerHTML = '<p class=\"hint\">' + esc(e.message) + '</p>';\n    });\n  }\n\n  function stateBadge(r) {\n    var me = S.me.name;\n    var step = r.route === '점장' ? '점장 확인 중' : /^올림/.test(r.mgr || '') ? '점장 확인 · 관리자 승인 대기' : '관리자 승인 대기';\n    if (r.state === '대기') return '<span class=\"badge wait\">' + (r.kind === '대타' ? '대타 구하는 중' : step) + '</span>';\n    if (r.state === '수락') return '<span class=\"badge wait\">' + (r.name === me ? esc(r.taker) + ' 수락 · ' + step : '내가 대타 · 승인 대기') + '</span>';\n    if (r.state === '승인') return '<span class=\"badge ok\">승인' + (r.taker === me ? ' · 내가 대타' : '') + '</span>';\n    if (r.state === '거절') return '<span class=\"badge no\">거절</span>';\n    if (r.state === '돌려보냄') return '<span class=\"badge no\">점장이 돌려보냄</span>';\n    return '<span class=\"badge\">' + esc(r.state) + '</span>';\n  }\n\n  function renderReqs(d) {\n    REQ.data = d;\n    var me = S.me.name;\n    $('swaps').innerHTML = d.swaps.length ? '<div class=\"swapbox\"><div class=\"t\">동료가 대타를 구해요</div>' + d.swaps.map(function (r) {\n      return '<div class=\"item\"><div class=\"what\"><b>' + dayLabel(r.date) + '</b> ' + esc(r.what) +\n        '<div class=\"sub\">' + esc(r.name) + ' 님 대신</div></div>' +\n        '<button class=\"sbtn go\" data-take=\"' + esc(r.id) + '\">제가 할게요</button></div>';\n    }).join('') + '</div>' : '';\n    $('myReqs').innerHTML = d.mine.length ? d.mine.map(function (r) {\n      var what = r.kind === '정정' ? r.what : r.what + ' ' + r.kind;\n      var who = r.name === me ? '' : '<div class=\"sub\">' + esc(r.name) + ' 님 대신 근무</div>';\n      var canCancel = (r.name === me && (r.state === '대기' || r.state === '수락')) || (r.taker === me && r.state === '수락');\n      var mn = r.mgr ? mgrNote(r.mgr) : null;\n      var mgrLine = !mn ? '' : r.state === '돌려보냄'\n        ? '<div class=\"sub\" style=\"color:var(--bad)\">' + esc(mn.who) + ' 점장: ' + esc(mn.note) + ' · 고쳐서 다시 보낼 수 있어요</div>'\n        : '<div class=\"sub\">' + esc(mn.who) + ' 점장 확인' + (mn.note ? ': ' + esc(mn.note) : '') + '</div>';\n      return '<div class=\"item\"><div class=\"what\"><b>' + esc(KIND[r.kind] || r.kind) + '</b> ' + dayLabel(r.date) + ' ' + esc(what) +\n        who + (r.reason ? '<div class=\"sub\">' + esc(r.reason) + '</div>' : '') + mgrLine + '<div style=\"margin-top:4px\">' + stateBadge(r) + '</div></div>' +\n        (canCancel ? '<button class=\"sbtn ghost\" data-cancel=\"' + esc(r.id) + '\">' + (r.name === me ? '취소' : '수락 취소') + '</button>' : '') + '</div>';\n    }).join('') : '<p class=\"hint\">아직 보낸 요청이 없어요.</p>';\n  }\n\n  var HINT = {\n    fix: '출근이나 퇴근을 깜빡했거나 잘못 찍었을 때 실제 시간을 알려주세요. 승인되면 기록이 고쳐져요.',\n    off: '쉬고 싶은 날과 종류를 골라주세요. 승인되면 휴무표에 그대로 적혀요. 대체휴무는 쉬는 날 일해서 쌓인 걸 쓰는 거예요(근무표에서 남은 일수를 볼 수 있어요).',\n    swap: '대신 일해줄 동료를 구해요. 동료가 [제가 할게요]를 누르고 승인되면 근무표가 바뀌어요.',\n  };\n  /* 우리 매장 점장이 있고 내가 점장이 아니면 '누구에게'를 보여줘요 */\n  function myManager() {\n    var m = (S.info.mgr || {})[S.me.store] || '';\n    return m && m.split(', ').indexOf(S.me.name) < 0 ? m : '';\n  }\n  function openForm(kind) {\n    if (REQ.kind === kind) return closeForm();\n    REQ.kind = kind;\n    Array.prototype.forEach.call(document.querySelectorAll('#kinds button'), function (b) {\n      b.classList.toggle('on', b.getAttribute('data-kind') === kind);\n    });\n    var fix = kind === 'fix';\n    $('reqForm').hidden = false;\n    $('fHint').textContent = HINT[kind];\n    $('wDateFix').hidden = !fix;\n    $('wType').hidden = !fix;\n    $('wTime').hidden = !fix;\n    $('wDate').hidden = fix;\n    $('wOff').hidden = kind !== 'off';\n    if (fix) {\n      var opts = '';\n      for (var i = 0; i <= 14; i++) {\n        var d = kstDate(-i);\n        opts += '<option value=\"' + d + '\">' + dayLabel(d) + (i === 0 ? ' 오늘' : i === 1 ? ' 어제' : '') + '</option>';\n      }\n      $('fDateFix').innerHTML = opts;\n      $('fTime').value = '';\n    } else {\n      $('fDate').min = kstDate(0);\n      $('fDate').max = kstDate(60);\n      $('fDate').value = kstDate(1);\n    }\n    var mg = myManager();\n    $('wTo').hidden = !mg;\n    $('toMgr').textContent = mg ? mg + ' 점장에게' : '점장에게';\n    var toMgr = document.querySelector('input[name=fto][value=mgr]');\n    if (toMgr) toMgr.checked = true;\n    $('fReasonLabel').textContent = kind === 'swap' ? '사유 (선택, 점장·관리자만 봐요)' : '사유 (점장·관리자만 봐요)';\n    $('fReason').placeholder = { fix: '예: 퇴근 찍는 걸 깜빡함', off: '예: 병원 예약', swap: '예: 집안 행사' }[kind];\n    $('fReason').value = '';\n    $('fSend').textContent = kind === 'swap' ? '대타 구하기' : '요청 보내기';\n    reqMsg('');\n  }\n  function closeForm() {\n    REQ.kind = '';\n    $('reqForm').hidden = true;\n    Array.prototype.forEach.call(document.querySelectorAll('#kinds button'), function (b) { b.classList.remove('on'); });\n  }\n\n  $('kinds').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-kind]');\n    if (b) openForm(b.getAttribute('data-kind'));\n  });\n  $('reqForm').addEventListener('submit', function (e) {\n    e.preventDefault();\n    var pin = $('pin').value.trim();\n    if (!S.me.pin) { reqMsg('먼저 출근을 한 번 찍어서 비밀번호를 정해주세요.', true); return; }\n    if (!pin) { reqMsg('위에 비밀번호를 먼저 넣어주세요.', true); return; }\n    var kind = REQ.kind;\n    var typeEl = document.querySelector('input[name=ftype]:checked');\n    var offEl = document.querySelector('input[name=foff]:checked');\n    var toEl = document.querySelector('input[name=fto]:checked');\n    var viaMgr = !!myManager() && (!toEl || toEl.value === 'mgr');\n    var body = {\n      name: S.me.name, pin: pin, kind: kind,\n      date: kind === 'fix' ? $('fDateFix').value : $('fDate').value,\n      type: typeEl ? typeEl.value : 'out', time: $('fTime').value, reason: $('fReason').value,\n      offType: offEl ? offEl.value : '휴무', to: viaMgr ? 'mgr' : 'admin',\n    };\n    $('fSend').disabled = true;\n    call('makeRequest', body).then(function (d) {\n      renderReqs(d);\n      closeForm();\n      var path = viaMgr ? '점장이 확인하고 관리자에게 올리면' : '관리자가';\n      reqMsg(kind === 'swap' ? '대타 구함을 올렸어요. 동료가 수락하면 ' + (viaMgr ? '점장 확인 뒤 ' : '') + '관리자가 승인해요.'\n        : '요청을 보냈어요. ' + path + ' 승인해요.');\n    }).catch(function (err) { reqMsg(err.message, true); })\n      .then(function () { $('fSend').disabled = false; });\n  });\n  $('reqCard').addEventListener('click', function (e) {\n    var t = e.target.closest('[data-take],[data-cancel]');\n    if (!t) return;\n    var pin = $('pin').value.trim();\n    var take = t.hasAttribute('data-take');\n    var id = t.getAttribute(take ? 'data-take' : 'data-cancel');\n    if (!confirm(take ? '이 날 대신 근무할까요? 승인되면 근무표가 바뀌어요.' : '이 요청을 취소할까요?')) return;\n    t.disabled = true;\n    call(take ? 'takeSwap' : 'cancelRequest', S.me.name, pin, id).then(function (d) {\n      renderReqs(d);\n      reqMsg(take ? '대타를 수락했어요. 승인되면 근무표가 바뀌어요.' : '취소했어요.');\n    }).catch(function (err) { t.disabled = false; reqMsg(err.message, true); });\n  });\n  $('pin').addEventListener('change', function () { if (!REQ.data) loadReqs(); });\n\n  /* 비밀번호 바꾸기 */\n  function openPinChange() {\n    $('pinChange').hidden = !$('pinChange').hidden;\n    $('pinChangeMsg').hidden = true;\n    $('newPin').value = '';\n    $('newPin2').value = '';\n    if (!$('pinChange').hidden) $('newPin').focus();\n  }\n  $('pinChangeBtn').addEventListener('click', openPinChange);\n  $('weakGo').addEventListener('click', function () { $('pinChange').hidden = true; openPinChange(); });\n  $('pinChange').addEventListener('submit', function (e) {\n    e.preventDefault();\n    var msg = $('pinChangeMsg');\n    var cur = $('pin').value.trim(), a = $('newPin').value.trim(), b = $('newPin2').value.trim();\n    var bad = function (t) { msg.hidden = false; msg.className = 'rmsg bad'; msg.textContent = t; };\n    if (!cur) return bad('위의 비밀번호 칸에 지금 비밀번호를 먼저 넣어주세요.');\n    if (a !== b) return bad('새 비밀번호 두 개가 달라요.');\n    $('pinChangeSend').disabled = true;\n    call('changePin', S.me.name, cur, a).then(function () {\n      $('pin').value = a;\n      if ($('remember').checked) mem.set('att:pin:' + S.me.name, a);\n      $('weakPin').hidden = true;\n      msg.hidden = false;\n      msg.className = 'rmsg';\n      msg.textContent = '바꿨어요. 다음부터 새 비밀번호로 찍어요.';\n      setTimeout(function () { $('pinChange').hidden = true; }, 1500);\n    }).catch(function (err) { bad(err.message); })\n      .then(function () { $('pinChangeSend').disabled = false; });\n  });\n\n  tick();\n  setInterval(tick, 1000);\n  $('inapp').hidden = !IN_APP;\n  call('getStaffList').then(function (info) {\n    S.info = info;\n    $('store').textContent = info.store;\n    document.title = info.store + ' 출퇴근';\n    renderNames();\n    var saved = mem.get('att:name');\n    if (saved && info.staff.some(function (p) { return p.name === saved; })) pick(saved);\n    else show('pick');\n  }).catch(function (e) { note(e.message); });\n</script>\n</body>\n</html>\n",
  Admin: "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>출퇴근 관리</title>\n<style>\n  :root {\n    --bg: #f4f5f7; --card: #ffffff; --text: #15171c; --muted: #6b7280; --line: #e4e7ec;\n    --chip: #eef1f5; --accent: #2557d6; --accent-bg: #e9effd; --ok: #0b8a4c; --ok-bg: #e7f6ee;\n    --warn: #b45309; --warn-bg: #fdf3e3; --bad: #c62828; --bad-bg: #fdecec;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --bg: #0f1115; --card: #181b21; --text: #eceef2; --muted: #9aa1ad; --line: #2a2f38;\n      --chip: #22262e; --accent: #7aa2ff; --accent-bg: #18213a; --ok: #3ccf86; --ok-bg: #14271d;\n      --warn: #f2b45a; --warn-bg: #2b2215; --bad: #ff7b7b; --bad-bg: #2d1717;\n    }\n  }\n  * { box-sizing: border-box; }\n  body {\n    margin: 0; background: var(--bg); color: var(--text);\n    font: 15px/1.5 -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", \"Noto Sans KR\", \"Malgun Gothic\", sans-serif;\n    -webkit-tap-highlight-color: transparent;\n  }\n  .wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; }\n  h1 { font-size: 22px; margin: 0; }\n  .sub { color: var(--muted); font-size: 14px; }\n  .card { background: var(--card); border-radius: 16px; padding: 18px; margin-top: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04); }\n  .card h2 { font-size: 16px; margin: 0 0 10px; }\n  .tabs { display: flex; background: var(--chip); border-radius: 12px; padding: 4px; margin-top: 16px; }\n  .tabs button { flex: 1; height: 40px; border: 0; background: none; border-radius: 9px; font: inherit; font-weight: 600; color: var(--muted); cursor: pointer; }\n  .tabs button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.08); }\n  .btn { height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }\n  .btn.ghost { background: var(--chip); color: var(--text); }\n  .btn:disabled { opacity: .5; }\n  .btn.wide { width: 100%; }\n  input.field, select.field { width: 100%; height: 48px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--text); font: inherit; font-size: 18px; padding: 0 14px; }\n  input.field:focus, select.field:focus { outline: 2px solid var(--accent); border-color: transparent; }\n  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }\n  .stat { background: var(--chip); border-radius: 12px; padding: 10px; text-align: center; }\n  .stat b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }\n  .stat span { font-size: 12px; color: var(--muted); }\n  .person { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }\n  .person:last-child { border-bottom: 0; }\n  .person .n { font-weight: 700; min-width: 64px; }\n  .person .d { flex: 1; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }\n  .person .d b { color: var(--text); font-weight: 600; }\n  .badge { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; background: var(--chip); color: var(--muted); }\n  .badge.ok { background: var(--ok-bg); color: var(--ok); }\n  .badge.accent { background: var(--accent-bg); color: var(--accent); }\n  .badge.warn { background: var(--warn-bg); color: var(--warn); }\n  .badge.bad { background: var(--bad-bg); color: var(--bad); }\n  .red { color: var(--bad); }\n  .monthnav { display: flex; align-items: center; justify-content: space-between; }\n  .monthnav b { font-size: 18px; }\n  .monthnav button { width: 44px; height: 44px; border: 0; border-radius: 12px; background: var(--chip); color: var(--text); font-size: 20px; cursor: pointer; }\n  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }\n  table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }\n  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 8px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }\n  td { padding: 10px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }\n  tr.pick { cursor: pointer; }\n  tr.pick.on td { background: var(--accent-bg); }\n  td.num, th.num { text-align: right; }\n  .memo { font-size: 12px; color: var(--muted); white-space: normal; }\n  .small { font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 2px; }\n  .small.red, .red .small { color: var(--bad); }\n  td { vertical-align: top; }\n  .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; font-size: 14px; }\n  .kv dt { color: var(--muted); }\n  .kv dd { margin: 0; }\n  .alert { background: var(--warn-bg); color: var(--warn); border-radius: 12px; padding: 12px 14px; font-size: 14px; margin-top: 14px; }\n  .msg { margin-top: 10px; font-size: 14px; color: var(--muted); }\n  .msg.bad { color: var(--bad); }\n  .row { display: flex; gap: 8px; align-items: center; }\n  .row .field { flex: 1; font-size: 13px; height: 44px; }\n  .center { text-align: center; }\n  .card.pending { outline: 2px solid var(--warn); }\n  .req { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line); }\n  .req:last-child { border-bottom: 0; }\n  .req .who { flex: 1; min-width: 0; }\n  .req .btn { height: 38px; padding: 0 12px; font-size: 14px; }\n  .sus { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; }\n  .sus:last-child { border-bottom: 0; }\n  .sus .t { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 42px; }\n  .sus .k { font-weight: 600; }\n  .dev { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; }\n  .dev:last-child { border-bottom: 0; }\n  .st { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }\n  .st:last-child { border-bottom: 0; }\n  .st .w { flex: 1; min-width: 0; }\n  .st .btn { height: 36px; padding: 0 12px; font-size: 13px; }\n  .chips { display: flex; gap: 6px; overflow-x: auto; padding: 12px 2px 0; -webkit-overflow-scrolling: touch; }\n  .chips button { flex: none; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }\n  .chips button.on { background: var(--text); color: var(--card); border-color: var(--text); }\n  .mem { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line); }\n  .mem:last-child { border-bottom: 0; }\n  .mem .w { flex: 1; min-width: 0; }\n  .mem .btn { height: 34px; padding: 0 10px; font-size: 13px; }\n  .grp { font-size: 13px; font-weight: 700; color: var(--muted); padding: 14px 0 2px; }\n  .grp:first-child { padding-top: 0; }\n  .rq { padding: 12px 0; border-bottom: 1px solid var(--line); }\n  .rq:last-child { border-bottom: 0; }\n  .rq .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n  .rq .acts { display: flex; gap: 8px; margin-top: 10px; }\n  .rq .acts .btn { height: 38px; flex: 1; font-size: 14px; }\n  .steps { margin: 0 0 12px; padding-left: 20px; font-size: 14px; color: var(--muted); }\n  .steps li { margin-bottom: 4px; }\n  a { color: var(--accent); }\n  #refresh { flex: none; white-space: nowrap; }\n  h3.mini { font-size: 14px; margin: 18px 0 6px; }\n  h3.mini:first-of-type { margin-top: 4px; }\n  .preview { white-space: pre-wrap; background: var(--chip); border-radius: 12px; padding: 12px; font: inherit; font-size: 13px; margin: 10px 0 0; }\n  .row.btnrow { flex-wrap: wrap; }\n  .row .btn { flex: none; }\n  input.field[type=month] { font-size: 16px; }\n  .linkbtn { background: none; border: 0; color: var(--accent); font: inherit; font-size: 14px; padding: 10px 0 0; cursor: pointer; }\n  select.field { font-size: 16px; -webkit-appearance: none; appearance: none; }\n  .route { margin-top: 6px; font-size: 13px; }\n  .mgr .adminOnly { display: none !important; }\n  .offrow { padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }\n  .offrow:last-child { border-bottom: 0; }\n  .offrow .days { color: var(--muted); font-size: 13px; margin-top: 2px; }\n  .offrow .days b { color: var(--warn); }\n  .grp .btn { height: 32px; padding: 0 12px; font-size: 13px; margin-left: 8px; }\n  [hidden] { display: none !important; }\n  @media (max-width: 420px) { .stat b { font-size: 19px; } .person .n { min-width: 52px; } }\n</style>\n</head>\n<body>\n<main class=\"wrap\">\n\n  <section id=\"login\" class=\"card\" style=\"max-width:380px;margin:12vh auto 0\">\n    <h2>출퇴근 관리</h2>\n    <p class=\"sub\" style=\"margin:0 0 14px\" id=\"loginHint\">사장님(관리자)은 [설정] 시트의 관리자PIN을 넣어주세요.</p>\n    <form id=\"loginForm\">\n      <div id=\"mgrRow\" hidden style=\"margin-bottom:8px\"><select class=\"field\" id=\"mgrName\" aria-label=\"점장 이름\"></select></div>\n      <input class=\"field\" id=\"apin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"off\" placeholder=\"관리자 비밀번호\">\n      <label class=\"sub\" style=\"display:flex;gap:6px;align-items:center;margin-top:10px\"><input type=\"checkbox\" id=\"aremember\"> 이 폰에서 기억하기 (사장님 폰에서만)</label>\n      <button class=\"btn wide\" style=\"margin-top:10px\">들어가기</button>\n    </form>\n    <p class=\"msg\" id=\"loginMsg\"></p>\n    <button class=\"linkbtn\" id=\"loginMode\" type=\"button\">점장이에요 (이름 + 내 비밀번호로 들어가기)</button>\n  </section>\n\n  <div id=\"app\" hidden>\n    <div class=\"row\" style=\"justify-content:space-between\">\n      <div><h1 id=\"store\">출퇴근 관리</h1><div class=\"sub\" id=\"now\"></div><div class=\"sub\" id=\"roleTag\" hidden></div></div>\n      <button class=\"btn ghost\" id=\"refresh\">새로고침</button>\n    </div>\n    <div class=\"alert\" id=\"weak\" hidden>관리자 비밀번호가 0000이거나 6자리보다 짧아요. 시트 [설정] 탭에서 6자리 이상으로 바꿔주세요.</div>\n    <div class=\"alert\" id=\"noPlace\" hidden></div>\n\n    <nav class=\"tabs\">\n      <button data-tab=\"today\" class=\"on\">오늘</button>\n      <button data-tab=\"month\">월별</button>\n      <button data-tab=\"off\">휴무</button>\n      <button data-tab=\"set\">설정</button>\n    </nav>\n\n    <section id=\"tab-today\">\n      <div class=\"card pending\" id=\"pendingCard\" hidden>\n        <h2>새 폰 승인 요청</h2>\n        <p class=\"sub\" style=\"margin:0 0 6px\">직원이 등록 안 된 폰으로 찍으려고 했어요. 본인이 폰을 바꾼 게 맞으면 승인하세요. 승인하면 예전 폰으로는 안 찍혀요.</p>\n        <div id=\"pending\"></div>\n      </div>\n      <p class=\"msg\" id=\"pendingMsg\" style=\"margin:14px 4px 0\"></p>\n      <div class=\"card pending\" id=\"reqCard\" hidden>\n        <h2>직원 요청 <span class=\"badge warn\" id=\"reqCount\"></span></h2>\n        <div id=\"reqs\"></div>\n      </div>\n      <p class=\"msg\" id=\"reqMsg\" style=\"margin:14px 4px 0\"></p>\n      <div class=\"card\"><div class=\"stats\" id=\"stats\"></div></div>\n      <div class=\"chips\" id=\"storeChips\"></div>\n      <div class=\"card\" id=\"people\"></div>\n      <div class=\"card\" id=\"suspectCard\" hidden>\n        <h2>오늘 의심 기록 <span class=\"badge bad\" id=\"suspectCount\"></span></h2>\n        <div id=\"suspects\"></div>\n        <p class=\"sub\" style=\"margin:10px 0 0\">지난 기록은 시트의 [의심기록] 탭에 모두 남아 있어요.</p>\n      </div>\n    </section>\n\n    <section id=\"tab-month\" hidden>\n      <div class=\"card\">\n        <div class=\"monthnav\">\n          <button id=\"prev\" aria-label=\"이전 달\">‹</button>\n          <b id=\"ymLabel\"></b>\n          <button id=\"next\" aria-label=\"다음 달\">›</button>\n        </div>\n      </div>\n      <div class=\"card\">\n        <h2>직원별 합계</h2>\n        <div class=\"scroll\"><table id=\"sumTable\"></table></div>\n        <button class=\"btn ghost wide adminOnly\" id=\"export\" style=\"margin-top:14px\">정산 시트로 만들기</button>\n        <p class=\"msg\" id=\"exportMsg\"></p>\n      </div>\n      <div class=\"card\">\n        <h2 id=\"detailTitle\">날짜별 기록</h2>\n        <div class=\"scroll\"><table id=\"detailTable\"></table></div>\n      </div>\n    </section>\n\n    <section id=\"tab-off\" hidden>\n      <div class=\"card\">\n        <h2 id=\"offTitle\">다음 달 휴무</h2>\n        <p class=\"sub\" id=\"offSub\" style=\"margin:0 0 6px\"></p>\n        <button class=\"btn ghost adminOnly\" id=\"wishToday\" style=\"margin:4px 0 6px\" hidden></button>\n        <div id=\"offStores\"><p class=\"sub\">불러오는 중…</p></div>\n        <p class=\"msg\" id=\"offMsg\"></p>\n      </div>\n      <div class=\"card adminOnly\">\n        <h2>휴무표 만들기</h2>\n        <p class=\"sub\" style=\"margin:0 0 10px\">원하는 달의 휴무표 탭을 바로 만들어요. 이미 있으면 빠진 직원만 넣고 공휴일 표시·색칠을 다시 맞춰요.\n          (보통은 매달 20일에 다음 달 것이 저절로 생겨요)</p>\n        <div class=\"row\"><input class=\"field\" type=\"month\" id=\"mkYm\" aria-label=\"만들 달\"><button class=\"btn\" id=\"mkMonth\">만들기</button></div>\n        <p class=\"msg\" id=\"mkMsg\"></p>\n      </div>\n    </section>\n\n    <section id=\"tab-set\" hidden>\n      <div class=\"card\">\n        <h2>매장 위치</h2>\n        <p class=\"sub\" style=\"margin:0 0 6px\">각 매장 <b>안에서</b> 그 매장의 [여기로 등록]을 눌러주세요. 직원은 등록된 매장 중 아무 곳 근처에서나 찍을 수 있어요(지원 근무 포함).\n          출근 시간·반경·점장·휴무 규칙은 시트 [매장] 탭에서 바꿔요.</p>\n        <div id=\"stores\"></div>\n        <p class=\"msg\" id=\"placeMsg\"></p>\n      </div>\n      <div class=\"card\">\n        <h2>직원 화면 주소</h2>\n        <p class=\"sub\" style=\"margin:0 0 10px\">이 주소를 직원 단톡방에 올려주세요. 직원은 열어서 홈 화면에 추가하면 앱처럼 쓸 수 있어요.</p>\n        <div class=\"row\"><input class=\"field\" id=\"appUrl\" readonly><button class=\"btn ghost\" id=\"copy\">복사</button></div>\n      </div>\n      <div class=\"card adminOnly\">\n        <h2>텔레그램 알림</h2>\n        <p class=\"sub\" id=\"tgStatus\" style=\"margin:0 0 10px\"></p>\n        <div id=\"tgSetup\">\n          <ol class=\"steps\">\n            <li>텔레그램에서 <b>@BotFather</b>를 찾아 <b>/newbot</b>을 보내세요. 봇 이름과 아이디를 정하면 <b>토큰</b>을 줘요.</li>\n            <li>그 토큰을 아래에 붙여넣고 <b>[저장]</b>을 누르세요.</li>\n            <li>저장하면 나오는 <b>[텔레그램 열기]</b>로 봇을 열어 <b>[시작]</b>을 누르세요. (또는 봇에게 연결 코드를 그대로 보내도 돼요)</li>\n            <li><b>[연결 확인]</b>을 누르면 시험 메시지가 와요.</li>\n          </ol>\n          <div class=\"row\"><input class=\"field\" id=\"tgToken\" placeholder=\"123456789:ABC…\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"btn\" id=\"tgSave\">저장</button></div>\n          <div class=\"alert\" id=\"tgCodeBox\" hidden style=\"margin-top:10px\">연결 코드: <b id=\"tgCode\"></b>\n            <a class=\"btn ghost wide\" id=\"tgOwnerOpen\" href=\"#\" target=\"_blank\" rel=\"noopener\" style=\"display:flex;align-items:center;justify-content:center;margin-top:8px;text-decoration:none\">텔레그램 열기</a></div>\n          <button class=\"btn wide\" id=\"tgLink\" style=\"margin-top:10px\">연결 확인</button>\n          <p class=\"sub\" style=\"margin:10px 0 0\">관리자 여러 명이 같이 받으려면 텔레그램 <b>그룹</b>을 만들어 봇을 초대하고, 그 그룹에 위의 <b>연결 코드</b>(/start 숫자)를 보낸 뒤 [연결 확인]을 누르세요.</p>\n        </div>\n        <button class=\"btn ghost wide\" id=\"tgOff\" hidden>텔레그램 연결 끊기</button>\n        <p class=\"msg\" id=\"tgMsg\"></p>\n      </div>\n      <div class=\"card adminOnly\">\n        <h2>직원 관리 (비밀번호·폰)</h2>\n        <p class=\"sub\" style=\"margin:0 0 6px\"><b>[비번]</b>으로 직원 비밀번호를 미리 정하거나, 잊어버린 직원의 비밀번호를 다시 정해줘요(잠김도 풀려요).\n          비밀번호를 비워두면 직원이 첫 출근 때 직접 정해요. <b>[폰 초기화]</b>를 누르면 다음에 찍는 폰이 새로 등록돼요.</p>\n        <div id=\"devices\"></div>\n        <p class=\"msg\" id=\"memMsg\"></p>\n      </div>\n      <div class=\"card adminOnly\">\n        <h2>현재 설정</h2>\n        <dl class=\"kv\" id=\"kv\"></dl>\n        <p class=\"sub\" style=\"margin:14px 0 0\">바꾸려면 <a id=\"sheetLink\" href=\"#\" target=\"_blank\">구글 시트</a>의 [설정] 탭에서 값을 고치세요.</p>\n      </div>\n      <div class=\"card adminOnly\" id=\"testCard\">\n        <h2>테스트</h2>\n        <p class=\"sub\" style=\"margin:0\">실제 직원 기록을 건드리지 않고 앱을 시험해 봐요.</p>\n        <h3 class=\"mini\">테스트 직원</h3>\n        <p class=\"sub\" style=\"margin:0 0 8px\"><b>테스트</b>라는 직원을 만들어요. 직원 화면에서 <b>테스트</b>를 누르면 사장님 폰으로 어디서든 출근·퇴근·요청·근무표를 눌러볼 수 있어요.\n          폰 등록·위치 확인을 안 하고, 월별·정산에서 빠져요. 다 해봤으면 <b>[테스트 지우기]</b>로 기록까지 통째로 지워요.</p>\n        <div class=\"row\"><select class=\"field\" id=\"testStore\" aria-label=\"테스트 직원 매장\"></select><button class=\"btn\" id=\"testMake\">만들기</button></div>\n        <button class=\"btn ghost wide\" id=\"testClear\" style=\"margin-top:8px\">테스트 지우기</button>\n        <h3 class=\"mini\">알림 시험</h3>\n        <button class=\"btn ghost wide\" id=\"notifyTest\">사장님께 시험 알림 보내기</button>\n        <h3 class=\"mini\">하루 마감 정리 미리 보기</h3>\n        <p class=\"sub\" style=\"margin:0 0 8px\">밤 11시 30분에 할 정리(결근?, 퇴근 안 찍음, 대체휴무)를 지금 미리 봐요. 휴무표·장부는 안 바뀌고 직원에게도 안 보내요.</p>\n        <div class=\"row btnrow\">\n          <button class=\"btn ghost\" data-close=\"today\">오늘</button>\n          <button class=\"btn ghost\" data-close=\"yesterday\">어제</button>\n          <label class=\"sub\" style=\"display:flex;gap:6px;align-items:center\"><input type=\"checkbox\" id=\"closeSend\"> 사장님 알림으로도 받기</label>\n        </div>\n        <pre class=\"preview\" id=\"closeOut\" hidden></pre>\n        <p class=\"msg\" id=\"testMsg\"></p>\n      </div>\n      <button class=\"btn ghost wide\" id=\"logout\" style=\"margin-top:14px\">이 폰에서 로그아웃</button>\n    </section>\n  </div>\n</main>\n\n<script>\n  var $ = function (id) { return document.getElementById(id); };\n  // cred: 관리자 비밀번호(글자) 또는 점장 {name, pin}. role: 'admin' | 'manager'\n  var A = { cred: null, role: 'admin', ym: '', month: null, info: null, who: '' };\n\n  function call(fn) {\n    var args = Array.prototype.slice.call(arguments, 1);\n    return new Promise(function (ok, no) {\n      var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) {\n        no(new Error((e && e.message) || String(e)));\n      });\n      r[fn].apply(r, args);\n    });\n  }\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  }\n  function hm(min) {\n    min = Math.round(min || 0);\n    var h = Math.floor(min / 60), m = min % 60;\n    return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';\n  }\n  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }\n  function ymLabel(ym) { return ym.slice(0, 4) + '년 ' + Number(ym.slice(5)) + '월'; }\n  function shiftYm(ym, d) {\n    var y = +ym.slice(0, 4), m = +ym.slice(5) - 1 + d;\n    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;\n    return y + '-' + (m < 9 ? '0' : '') + (m + 1);\n  }\n  function ss(k, v) {\n    try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; }\n  }\n  function ls(k, v) {\n    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; }\n  }\n\n  /* 로그인: 사장님(관리자 비밀번호) 또는 점장(이름 + 직원 비밀번호) */\n  var MODE = 'admin';\n  function setMode(m) {\n    MODE = m;\n    var mgr = m === 'mgr';\n    $('mgrRow').hidden = !mgr;\n    $('apin').placeholder = mgr ? '내 비밀번호 (출근 찍을 때 쓰는 번호)' : '관리자 비밀번호';\n    $('loginHint').textContent = mgr ? '점장은 이름을 고르고, 출근 찍을 때 쓰는 내 비밀번호를 넣어주세요.' : '사장님(관리자)은 [설정] 시트의 관리자PIN을 넣어주세요.';\n    $('loginMode').textContent = mgr ? '사장님(관리자)이에요' : '점장이에요 (이름 + 내 비밀번호로 들어가기)';\n    $('loginMsg').textContent = '';\n    if (mgr && !$('mgrName').options.length) {\n      call('getStaffList').then(function (info) {\n        $('mgrName').innerHTML = (info.managers || []).map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');\n        if (!(info.managers || []).length) {\n          $('loginMsg').className = 'msg bad';\n          $('loginMsg').textContent = '아직 점장이 없어요. 사장님이 시트 [매장] 탭 점장 칸에 이름을 적어야 해요.';\n        }\n      }).catch(function (e) { $('loginMsg').className = 'msg bad'; $('loginMsg').textContent = e.message; });\n    }\n  }\n  $('loginMode').addEventListener('click', function () { setMode(MODE === 'mgr' ? 'admin' : 'mgr'); });\n  $('loginForm').addEventListener('submit', function (e) {\n    e.preventDefault();\n    var pin = $('apin').value.trim();\n    if (!pin) return;\n    login(MODE === 'mgr' ? { name: $('mgrName').value, pin: pin } : pin);\n  });\n  function login(cred) {\n    if (!cred) return;\n    $('loginMsg').className = 'msg';\n    $('loginMsg').textContent = '확인 중…';\n    call('adminToday', cred).then(function (r) {\n      A.cred = cred;\n      var keep = typeof cred === 'string' ? cred : JSON.stringify(cred);\n      ss('att:admin', keep);\n      if ($('aremember').checked) ls('att:admin', keep);\n      $('login').hidden = true;\n      $('app').hidden = false;\n      A.ym = r.date.slice(0, 7);\n      renderToday(r);\n    }).catch(function (e) {\n      ss('att:admin', null);\n      ls('att:admin', null);\n      $('loginMsg').className = 'msg bad';\n      $('loginMsg').textContent = e.message;\n    });\n  }\n\n  /* 탭 */\n  var current = 'today';\n  document.querySelector('.tabs').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-tab]');\n    if (b) openTab(b.getAttribute('data-tab'));\n  });\n  function openTab(t) {\n    current = t;\n    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {\n      b.classList.toggle('on', b.getAttribute('data-tab') === t);\n    });\n    ['today', 'month', 'off', 'set'].forEach(function (x) { $('tab-' + x).hidden = x !== t; });\n    if (t === 'month' && !A.month) loadMonth(A.ym);\n    if (t === 'off') loadWishes();\n  }\n  $('refresh').addEventListener('click', function () {\n    loadToday();\n    if (current === 'month') loadMonth(A.ym);\n    if (current === 'off') loadWishes();\n  });\n\n  /* 오늘 */\n  function loadToday() {\n    return call('adminToday', A.cred).then(renderToday).catch(function (e) { alert(e.message); });\n  }\n  var BADGE = { '근무중': 'ok', '퇴근': 'accent', '미출근': 'bad', '출근 전': '', '휴무': '' };\n  $('storeChips').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-store]');\n    if (!b || !A.today) return;\n    A.filter = b.getAttribute('data-store');\n    renderToday(A.today);\n  });\n  function renderToday(r) {\n    A.info = r.info;\n    A.role = r.role || 'admin';\n    A.me = r.me || '';\n    var mgr = A.role === 'manager';\n    document.body.classList.toggle('mgr', mgr);\n    $('roleTag').hidden = !mgr;\n    $('roleTag').textContent = mgr ? (r.myStores || []).join(', ') + ' 점장 · ' + r.me : '';\n    $('store').textContent = r.info.store + ' 출퇴근';\n    $('now').textContent = r.date.replace(/-/g, '.') + ' (' + r.dow + ') ' + r.time + ' 기준' + (r.holiday ? ' · ' + r.holiday : '');\n    $('weak').hidden = !r.info.weakPin;\n    var count = { '근무중': 0, '미출근': 0, '퇴근': 0, '휴무': 0 };\n    r.list.forEach(function (p) { if (p.status in count) count[p.status]++; });\n    $('stats').innerHTML = Object.keys(count).map(function (k) {\n      return '<div class=\"stat\"><b class=\"' + (k === '미출근' && count[k] ? 'red' : '') + '\">' + count[k] + '</b><span>' + k + '</span></div>';\n    }).join('');\n    A.today = r;\n    var storesInList = [];\n    r.list.forEach(function (p) { if (storesInList.indexOf(p.store) < 0) storesInList.push(p.store); });\n    if (A.filter && storesInList.indexOf(A.filter) < 0) A.filter = '';\n    $('storeChips').innerHTML = storesInList.length > 1 ? ['<button data-store=\"\" class=\"' + (A.filter ? '' : 'on') + '\">전체</button>'].concat(storesInList.map(function (st) {\n      var bad = r.list.filter(function (p) { return p.store === st && p.status === '미출근'; }).length;\n      return '<button data-store=\"' + esc(st) + '\" class=\"' + (A.filter === st ? 'on' : '') + '\">' + esc(st || '매장 없음') + (bad ? ' <b class=\"red\">' + bad + '</b>' : '') + '</button>';\n    })).join('') : '';\n    var lastStore = null;\n    var shown = r.list.filter(function (p) { return !A.filter || p.store === A.filter; });\n    $('people').innerHTML = shown.length ? shown.map(function (p) {\n      var head = '';\n      if (p.store !== lastStore) { lastStore = p.store; head = '<div class=\"grp\">' + esc(p.store || '매장 없음') + '</div>'; }\n      var d = [];\n      if (p.sIn) d.push('예정 ' + esc(p.sIn) + (p.sOut ? '~' + esc(p.sOut) : ''));\n      if (p.tIn) d.push('출근 <b>' + esc(p.tIn) + '</b>' + (p.late ? ' <span class=\"red\">(' + p.late + '분 지각)</span>' : '') + (p.place ? ' <span class=\"red\">· ' + esc(p.place) + '에서</span>' : ''));\n      if (p.tOut) d.push('퇴근 <b>' + esc(p.tOut) + '</b>' + (p.early ? ' <span class=\"red\">(' + p.early + '분 조퇴)</span>' : ''));\n      var badge = p.status === '근무중' && p.late ? 'warn' : BADGE[p.status];\n      var label = p.status === '근무중' && p.late ? '지각' : p.status === '휴무' && p.mark ? p.mark : p.status;\n      return head + '<div class=\"person\"><div class=\"n\">' + esc(p.name) + '</div><div class=\"d\">' + (d.join(' · ') || '근무 없음') +\n        '</div><span class=\"badge ' + (badge || '') + '\">' + esc(label) + '</span></div>';\n    }).join('') : '<p class=\"sub center\">[직원] 시트에 직원을 먼저 넣어주세요.</p>';\n\n    var pend = r.pending || [];\n    $('pendingCard').hidden = !pend.length;\n    $('pending').innerHTML = pend.map(function (p) {\n      return '<div class=\"req\"><div class=\"who\"><b>' + esc(p.name) + '</b><div class=\"small\">' + esc(p.label) + '</div></div>' +\n        '<button class=\"btn\" data-approve=\"' + esc(p.name) + '\">승인</button>' +\n        '<button class=\"btn ghost\" data-reject=\"' + esc(p.name) + '\">거절</button></div>';\n    }).join('');\n\n    var sus = r.suspects || [];\n    $('suspectCard').hidden = !sus.length;\n    $('suspectCount').textContent = sus.length + '건';\n    $('suspects').innerHTML = sus.map(function (s) {\n      return '<div class=\"sus\"><span class=\"t\">' + esc(s.time) + '</span><span><span class=\"k\">' + esc(s.name) + ' · ' + esc(s.kind) +\n        '</span><div class=\"small\">' + esc(s.detail) + '</div></span></div>';\n    }).join('');\n\n    var PINB = { '미정': ['', '비번 미정'], '정함': ['ok', '비번 있음'], '쉬움': ['warn', '비번 쉬움'] };\n    $('devices').innerHTML = (r.devices || []).map(function (d) {\n      var pb = PINB[d.pin] || ['', d.pin];\n      return '<div class=\"mem\"><div class=\"w\"><b>' + esc(d.name) + '</b> <span class=\"small\">' + esc(d.store || '') + '</span>' +\n        '<div style=\"margin-top:3px\"><span class=\"badge ' + pb[0] + '\">' + pb[1] + '</span> ' +\n        (d.agreed ? '' : '<span class=\"badge\">동의 전</span> ') +\n        (d.tg ? '<span class=\"badge accent\">알림 켬</span> ' : '') +\n        (d.sub ? '<span class=\"badge warn\">대체휴무 ' + d.sub + '일</span> ' : '') +\n        '<span class=\"small\">' + esc(d.label || '폰 등록 전') + '</span></div></div>' +\n        '<button class=\"btn ghost\" data-setpin=\"' + esc(d.name) + '\">비번</button>' +\n        (d.label ? '<button class=\"btn ghost\" data-resetdev=\"' + esc(d.name) + '\">폰 초기화</button>' : '') + '</div>';\n    }).join('') || '<p class=\"sub\">직원이 없어요.</p>';\n\n    var reqs = r.requests || [];\n    $('reqCard').hidden = !reqs.length;\n    $('reqCount').textContent = reqs.length + '건';\n    var KN = { '정정': '기록 정정', '휴무': '휴무', '월차': '월차', '반차': '반차', '대체': '대체휴무', '대타': '대타' };\n    $('reqs').innerHTML = reqs.map(function (q) {\n      var when = q.date.slice(5).replace('-', '/').replace(/^0/, '') + '(' + esc(q.dow) + ')';\n      var line;\n      if (q.kind === '정정') line = when + ' <b>' + esc(q.what) + '</b>로 고쳐주세요' + (q.before ? ' <span class=\"small\">(지금 기록 ' + esc(q.before) + ')</span>' : ' <span class=\"small\">(지금 기록 없음)</span>');\n      else if (q.kind === '대타') line = when + ' ' + esc(q.what) + ' → ' + (q.taker ? '<b>' + esc(q.taker) + '</b> 님이 대신 근무' : '<span class=\"small\">대타 구하는 중 (동료 수락 전)</span>');\n      else line = when + ' ' + esc(q.what) + ' 근무 → <b>' + esc(KN[q.kind] || q.kind) + '</b>로 쉬고 싶어요';\n      var waiting = q.kind === '대타' && !q.taker;\n      // 결재 단계: 점장 확인 전 / 점장이 올림 / 관리자에게 바로\n      var parts = String(q.mgr || '').split(' · ');\n      var mgrWho = (parts[0].split(' ')[3] || '');\n      var step = q.route === '점장'\n        ? '<span class=\"badge\">점장 확인 전' + (q.managers && q.managers.length ? ' · ' + esc(q.managers.join(', ')) : '') + '</span>'\n        : /^올림/.test(q.mgr || '') ? '<span class=\"badge ok\">점장 ' + esc(mgrWho) + ' 확인</span>' + (parts[1] ? ' <span class=\"small\">' + esc(parts.slice(1).join(' · ')) + '</span>' : '')\n        : '<span class=\"badge\">관리자에게 바로</span>';\n      var acts;\n      if (!mgr) {\n        acts = (waiting ? '' : '<button class=\"btn\" data-rq-ok=\"' + esc(q.id) + '\">승인</button>') +\n          '<button class=\"btn ghost\" data-rq-no=\"' + esc(q.id) + '\">' + (waiting ? '대타 요청 닫기' : '거절') + '</button>';\n      } else if (q.route === '점장' && (q.name === A.me || q.taker === A.me)) {\n        acts = '<span class=\"small\">본인 ' + (q.name === A.me ? '요청' : '대타') + '이라 다른 점장이나 관리자가 처리해요.</span>';\n      } else if (q.route === '점장') {\n        acts = (waiting ? '' : '<button class=\"btn\" data-fwd=\"' + esc(q.id) + '\">관리자에게 올리기</button>') +\n          '<button class=\"btn ghost\" data-ret=\"' + esc(q.id) + '\">돌려보내기</button>';\n      } else {\n        acts = '<span class=\"small\">관리자 승인을 기다리는 중이에요.</span>';\n      }\n      return '<div class=\"rq\"><div class=\"top\"><span class=\"badge ' + (q.kind === '정정' ? 'accent' : 'warn') + '\">' + esc(KN[q.kind] || q.kind) + '</span><b>' + esc(q.name) + '</b>' +\n        (q.store ? ' <span class=\"small\">' + esc(q.store) + '</span>' : '') + '</div>' +\n        '<div style=\"margin-top:4px\">' + line + '</div>' +\n        (q.reason ? '<div class=\"small\">사유: ' + esc(q.reason) + '</div>' : '') +\n        (q.note ? '<div class=\"small red\">※ ' + esc(q.note) + '</div>' : '') +\n        (q.past ? '<div class=\"small red\">※ 이미 지난 날짜예요</div>' : '') +\n        '<div class=\"route\">' + step + '</div>' +\n        '<div class=\"acts\">' + acts + '</div></div>';\n    }).join('');\n\n    renderSettings(r.info);\n  }\n  $('devices').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-setpin],[data-resetdev]');\n    if (!b) return;\n    var msg = $('memMsg');\n    var name = b.getAttribute('data-setpin') || b.getAttribute('data-resetdev');\n    var job;\n    if (b.hasAttribute('data-setpin')) {\n      var np = prompt(name + ' 님 비밀번호를 정해주세요 (숫자 4~6자리).\\n비워두고 확인을 누르면 지워져서, 첫 출근 때 직원이 직접 정해요.', '');\n      if (np === null) return;\n      job = call('adminSetPin', A.cred, name, np.trim()).then(function (r) {\n        renderToday(r);\n        msg.className = 'msg';\n        msg.textContent = np.trim() ? name + ' 님 비밀번호를 정했어요. 직원에게 따로 알려주세요.' : name + ' 님 비밀번호를 지웠어요. 첫 출근 때 직접 정해요.';\n      });\n    } else {\n      if (!confirm(name + ' 님 폰 등록을 지울까요?\\n다음에 출근을 찍는 폰이 새로 등록돼요.')) return;\n      job = call('adminResetDevice', A.cred, name).then(function (r) {\n        renderToday(r);\n        msg.className = 'msg';\n        msg.textContent = name + ' 님 폰 등록을 지웠어요.';\n      });\n    }\n    b.disabled = true;\n    job.catch(function (err) { msg.className = 'msg bad'; msg.textContent = err.message; })\n      .then(function () { b.disabled = false; });\n  });\n  $('reqs').addEventListener('click', function (e) {\n    var f = e.target.closest('[data-fwd],[data-ret]');\n    if (f) return mgrAct(f);\n    var b = e.target.closest('[data-rq-ok],[data-rq-no]');\n    if (!b) return;\n    var ok = b.hasAttribute('data-rq-ok');\n    var id = b.getAttribute(ok ? 'data-rq-ok' : 'data-rq-no');\n    if (!confirm(ok ? '승인할까요? 바로 기록·근무표에 반영돼요.' : '거절할까요?')) return;\n    b.disabled = true;\n    $('reqMsg').className = 'msg';\n    $('reqMsg').textContent = '처리 중…';\n    call('adminRequest', A.cred, id, ok).then(function (r) {\n      renderToday(r);\n      $('reqMsg').textContent = ok ? '승인했어요. 기록과 근무표에 반영됐어요.' : '거절했어요.';\n      A.month = null;\n    }).catch(function (err) {\n      b.disabled = false;\n      $('reqMsg').className = 'msg bad';\n      $('reqMsg').textContent = err.message;\n    });\n  });\n  /* 점장: 관리자에게 올리기(한마디 선택) / 돌려보내기(이유 필수) */\n  function mgrAct(b) {\n    var fwd = b.hasAttribute('data-fwd');\n    var id = b.getAttribute(fwd ? 'data-fwd' : 'data-ret');\n    var text = prompt(fwd ? '관리자에게 올릴게요. 한마디 남길 게 있으면 적어주세요 (안 적어도 돼요).' : '돌려보내는 이유를 적어주세요. 직원에게 그대로 보여요.', '');\n    if (text === null) return;\n    if (!fwd && !text.trim()) { $('reqMsg').className = 'msg bad'; $('reqMsg').textContent = '돌려보내는 이유를 적어주세요.'; return; }\n    b.disabled = true;\n    $('reqMsg').className = 'msg';\n    $('reqMsg').textContent = '처리 중…';\n    call(fwd ? 'mgrForward' : 'mgrReturn', A.cred, id, text.trim()).then(function (r) {\n      renderToday(r);\n      $('reqMsg').textContent = fwd ? '관리자에게 올렸어요. 관리자가 승인하면 반영돼요.' : '직원에게 돌려보냈어요.';\n    }).catch(function (err) {\n      b.disabled = false;\n      $('reqMsg').className = 'msg bad';\n      $('reqMsg').textContent = err.message;\n    });\n  }\n\n  $('pending').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-approve],[data-reject]');\n    if (!b) return;\n    var ok = b.hasAttribute('data-approve');\n    var name = b.getAttribute(ok ? 'data-approve' : 'data-reject');\n    if (!confirm(name + ' 님의 새 폰을 ' + (ok ? '승인' : '거절') + '할까요?')) return;\n    b.disabled = true;\n    $('pendingMsg').className = 'msg';\n    $('pendingMsg').textContent = '처리 중…';\n    call('adminDevice', A.cred, name, ok).then(function (r) {\n      renderToday(r);\n      $('pendingMsg').textContent = name + ' 님 새 폰을 ' + (ok ? '승인했어요. 이제 그 폰으로 찍을 수 있어요.' : '거절했어요.');\n    }).catch(function (err) {\n      b.disabled = false;\n      $('pendingMsg').className = 'msg bad';\n      $('pendingMsg').textContent = err.message;\n    });\n  });\n\n  /* 월별 */\n  $('prev').addEventListener('click', function () { loadMonth(shiftYm(A.ym, -1)); });\n  $('next').addEventListener('click', function () { loadMonth(shiftYm(A.ym, 1)); });\n  function loadMonth(ym) {\n    A.ym = ym;\n    A.who = '';\n    $('ymLabel').textContent = ymLabel(ym);\n    $('exportMsg').textContent = '';\n    $('sumTable').innerHTML = '<tr><td class=\"sub\">불러오는 중…</td></tr>';\n    $('detailTable').innerHTML = '';\n    return call('adminMonth', A.cred, ym).then(function (m) {\n      if (m.ym !== A.ym) return;\n      A.month = m;\n      renderMonth();\n    }).catch(function (e) { $('sumTable').innerHTML = '<tr><td class=\"red\">' + esc(e.message) + '</td></tr>'; });\n  }\n  function renderMonth() {\n    var m = A.month;\n    var money = !m.noMoney;\n    var html = '<thead><tr><th>이름</th><th class=\"num\">근무</th><th class=\"num\">지각</th>' + (money ? '<th class=\"num\">차감액</th>' : '') + '</tr></thead><tbody>';\n    if (!m.staff.length) html += '<tr><td colspan=\"4\" class=\"sub\">기록이 없어요.</td></tr>';\n    m.staff.forEach(function (s) {\n      var extra = [];\n      if (s.earlyMin) extra.push('조퇴 ' + s.earlyMin + '분');\n      if (s.noOut) extra.push('퇴근 누락 ' + s.noOut + '건');\n      if (s.noIn) extra.push('출근 누락 ' + s.noIn + '건');\n      html += '<tr class=\"pick' + (A.who === s.name ? ' on' : '') + '\" data-who=\"' + esc(s.name) + '\">' +\n        '<td><b>' + esc(s.name) + '</b>' + (s.store ? '<div class=\"small\">' + esc(s.store) + '</div>' : '') + (extra.length ? '<div class=\"small red\">' + extra.join(' · ') + '</div>' : '') + '</td>' +\n        '<td class=\"num\">' + hm(s.work) + '<div class=\"small\">' + s.days + '일</div></td>' +\n        '<td class=\"num' + (s.lateCount ? ' red' : '') + '\">' + (s.lateCount ? s.lateCount + '회<div class=\"small\">' + s.lateMin + '분</div>' : '-') + '</td>' +\n        (money ? '<td class=\"num' + (s.deduct ? ' red' : '') + '\">' + (s.deduct ? won(s.deduct) : '-') + '</td>' : '') + '</tr>';\n    });\n    $('sumTable').innerHTML = html + '</tbody>';\n\n    var rows = m.rows.filter(function (r) { return !A.who || r.name === A.who; });\n    $('detailTitle').textContent = A.who ? A.who + ' 날짜별 기록' : '날짜별 기록 (위에서 이름을 누르면 그 사람만 보여요)';\n    var cols = A.who ? 4 : 5;\n    var d = '<thead><tr><th>날짜</th>' + (A.who ? '' : '<th>이름</th>') + '<th>출근</th><th>퇴근</th><th class=\"num\">지각</th></tr></thead><tbody>';\n    if (!rows.length) d += '<tr><td colspan=\"' + cols + '\" class=\"sub\">기록이 없어요.</td></tr>';\n    rows.forEach(function (r) {\n      d += '<tr><td>' + esc(r.date.slice(5).replace('-', '/')) + ' ' + esc(r.dow) +\n        '<div class=\"small\">' + (r.sIn ? '예정 ' + esc(r.sIn) + '~' + esc(r.sOut) : '근무표 없음') + '</div></td>' +\n        (A.who ? '' : '<td>' + esc(r.name) + '</td>') +\n        '<td>' + esc(r.tIn || '-') + '</td><td>' + esc(r.tOut || '-') + '</td>' +\n        '<td class=\"num' + (r.late ? ' red' : '') + '\">' + (r.late ? r.late + '분' : '') +\n        (r.deduct ? '<div class=\"small\">' + won(r.deduct) + '</div>' : '') + '</td></tr>' +\n        (r.memo ? '<tr><td colspan=\"' + cols + '\" class=\"memo\" style=\"padding-top:0\">' + esc(r.memo) + '</td></tr>' : '');\n    });\n    $('detailTable').innerHTML = d + '</tbody>';\n  }\n  $('sumTable').addEventListener('click', function (e) {\n    var tr = e.target.closest('[data-who]');\n    if (!tr) return;\n    var w = tr.getAttribute('data-who');\n    A.who = A.who === w ? '' : w;\n    renderMonth();\n  });\n  $('export').addEventListener('click', function () {\n    var b = $('export');\n    b.disabled = true;\n    $('exportMsg').className = 'msg';\n    $('exportMsg').textContent = '만드는 중…';\n    call('adminExport', A.cred, A.ym).then(function (r) {\n      $('exportMsg').innerHTML = \"'\" + esc(r.name) + \"' 시트를 만들었어요. <a href=\\\"\" + esc(r.url) + '\" target=\"_blank\">열기</a>';\n    }).catch(function (e) {\n      $('exportMsg').className = 'msg bad';\n      $('exportMsg').textContent = e.message;\n    }).then(function () { b.disabled = false; });\n  });\n\n  /* 다음 달 휴무 */\n  function loadWishes() {\n    $('offMsg').textContent = '';\n    return call('adminWishes', A.cred).then(renderWishes).catch(function (e) {\n      $('offStores').innerHTML = '<p class=\"sub red\">' + esc(e.message) + '</p>';\n    });\n  }\n  function renderWishes(w) {\n    var m = Number(w.ym.slice(5));\n    var admin = w.role === 'admin';\n    A.wish = w;\n    $('wishToday').hidden = !admin || (w.open && !w.forced);\n    $('wishToday').textContent = w.forced ? '오늘만 연 것 닫기' : '휴무 고르기 오늘만 열기 (테스트)';\n    if (!$('mkYm').value) $('mkYm').value = w.ym;\n    $('offTitle').textContent = m + '월 휴무 (다음 달)';\n    $('offSub').innerHTML = '직원이 앱에서 고른 날은 <b>휴무?</b>로 적혀 있어요. ' +\n      (admin ? '확인하고 <b>[확정]</b>을 누르면 휴무표에 <b>휴무</b>로 바뀌어요. ' : '확정은 관리자가 해요. ') +\n      '고르는 기간: ' + esc(w.window) + (w.open ? ' (지금 고르는 중)' : '') +\n      (w.blocked.length ? ' · 못 고르는 날: ' + w.blocked.map(function (d) { return m + '/' + d; }).join(', ') : '') +\n      (w.hasTab ? '' : '<br><span class=\"red\">' + m + '월 휴무표 탭이 아직 없어요. 20일이 되면 자동으로 생겨요.</span>');\n    var holi = Object.keys(w.holidays || {}).map(function (d) { return Number(d.slice(8)) + '일 ' + w.holidays[d]; });\n    if (holi.length) $('offSub').innerHTML += '<br>공휴일: ' + esc(holi.join(', '));\n    $('offStores').innerHTML = w.stores.map(function (st) {\n      var rules = [st.maxOff ? '하루 최대 ' + st.maxOff + '명' : '하루 제한 없음', st.monthOff ? '한 달 ' + st.monthOff + '일' : ''].filter(String).join(' · ');\n      return '<div class=\"grp\">' + esc(st.name) + ' <span class=\"small\">' + rules + '</span>' +\n        (admin && st.wishes ? '<button class=\"btn\" data-confirm=\"' + esc(st.name) + '\">' + st.wishes + '건 확정</button>' : '') + '</div>' +\n        st.over.map(function (o) {\n          return '<div class=\"small red\">※ ' + m + '/' + o.day + '(' + esc(o.dow) + ') ' + o.names.length + '명이 쉬어요: ' + esc(o.names.join(', ')) + '</div>';\n        }).join('') +\n        st.rows.map(function (r) {\n          var d = [];\n          if (r.wish.length) d.push('고름 <b>' + r.wish.join(', ') + '</b>');\n          if (r.fixed.length) d.push('확정 ' + r.fixed.join(', '));\n          if (r.other.length) d.push(esc(r.other.join(', ')));\n          return '<div class=\"offrow\"><b>' + esc(r.name) + '</b> <span class=\"small\">휴무 ' + r.count + '일' +\n            (st.monthOff && r.count > st.monthOff ? ' <span class=\"red\">(한 달 ' + st.monthOff + '일 넘음)</span>' : '') + '</span>' +\n            '<div class=\"days\">' + (d.join(' · ') || '아직 안 골랐어요') + '</div></div>';\n        }).join('');\n    }).join('') || '<p class=\"sub\">직원이 없어요.</p>';\n  }\n  $('offStores').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-confirm]');\n    if (!b) return;\n    var st = b.getAttribute('data-confirm');\n    if (!confirm(st + '에서 고른 휴무?를 모두 휴무로 확정할까요?\\n휴무표에 바로 적혀요.')) return;\n    b.disabled = true;\n    call('adminConfirmWishes', A.cred, st).then(function (w) {\n      renderWishes(w);\n      $('offMsg').className = 'msg';\n      $('offMsg').textContent = st + ' 휴무 ' + w.confirmed + '건을 확정했어요.';\n    }).catch(function (err) {\n      b.disabled = false;\n      $('offMsg').className = 'msg bad';\n      $('offMsg').textContent = err.message;\n    });\n  });\n\n  $('wishToday').addEventListener('click', function () {\n    var on = !(A.wish && A.wish.forced);\n    if (on && !confirm('오늘 하루만 직원들이 다음 달 휴무를 고를 수 있게 열까요?\\n직원 화면에도 \"휴무 고르는 기간\"이 떠요. 내일이면 저절로 닫혀요.')) return;\n    $('wishToday').disabled = true;\n    call('adminWishOpen', A.cred, on).then(function (w) {\n      renderWishes(w);\n      $('offMsg').className = 'msg';\n      $('offMsg').textContent = on ? '오늘만 열었어요. 직원 화면 근무표 → 다음 달에서 날짜를 눌러 고를 수 있어요.' : '닫았어요.';\n    }).catch(function (e) { $('offMsg').className = 'msg bad'; $('offMsg').textContent = e.message; })\n      .then(function () { $('wishToday').disabled = false; });\n  });\n  $('mkMonth').addEventListener('click', function () {\n    var ym = $('mkYm').value;\n    var msg = $('mkMsg');\n    if (!ym) { msg.className = 'msg bad'; msg.textContent = '만들 달을 골라주세요.'; return; }\n    $('mkMonth').disabled = true;\n    msg.className = 'msg';\n    msg.textContent = '만드는 중… (처음 만들 때는 10초쯤 걸려요)';\n    call('adminMakeMonth', A.cred, ym).then(function (r) {\n      var made = r.made && r.made.length > 1 ? ' (사이 달 ' + r.made.slice(0, -1).join(', ') + '도 같이 만들었어요)' : '';\n      msg.innerHTML = \"'\" + esc(r.name) + \"' \" + (r.created ? '탭을 만들었어요' + esc(made) : '탭이 이미 있어서 빠진 직원 ' + r.added + '명을 넣었어요') +\n        '. 직원 ' + r.staff + '명' + (r.holidays ? ' · 공휴일 ' + r.holidays + '일' : '') + ' <a href=\"' + esc(r.url) + '\" target=\"_blank\">열기</a>';\n      if (current === 'off') loadWishes();\n    }).catch(function (e) { msg.className = 'msg bad'; msg.textContent = e.message; })\n      .then(function () { $('mkMonth').disabled = false; });\n  });\n\n  /* 테스트 도구 (관리자) */\n  function testMsg(text, bad) { $('testMsg').className = 'msg' + (bad ? ' bad' : ''); $('testMsg').textContent = text; }\n  $('testMake').addEventListener('click', function () {\n    var st = $('testStore').value;\n    $('testMake').disabled = true;\n    call('adminTestStaff', A.cred, st).then(function (r) {\n      renderToday(r);\n      testMsg('테스트 직원을 ' + st + '에 만들었어요. 직원 화면에서 [테스트]를 누르고, 처음 찍을 때 비밀번호를 정하세요.');\n    }).catch(function (e) { testMsg(e.message, true); }).then(function () { $('testMake').disabled = false; });\n  });\n  $('testClear').addEventListener('click', function () {\n    if (!confirm('테스트 직원과 그 기록(출퇴근·요청·휴무표 줄·대체휴무 등)을 모두 지울까요?\\n다른 직원 기록은 그대로예요.')) return;\n    $('testClear').disabled = true;\n    call('adminTestClear', A.cred).then(function (r) {\n      renderToday(r);\n      A.month = null;\n      testMsg(r.removed ? '테스트 기록 ' + r.removed + '줄을 지웠어요.' : '지울 테스트 기록이 없어요.');\n    }).catch(function (e) { testMsg(e.message, true); }).then(function () { $('testClear').disabled = false; });\n  });\n  $('notifyTest').addEventListener('click', function () {\n    $('notifyTest').disabled = true;\n    call('adminNotifyTest', A.cred).then(function (r) {\n      testMsg(r.via + '(으)로 시험 알림을 보냈어요. 왔는지 확인해보세요.');\n    }).catch(function (e) { testMsg(e.message, true); }).then(function () { $('notifyTest').disabled = false; });\n  });\n  $('testCard').addEventListener('click', function (e) {\n    var b = e.target.closest('[data-close]');\n    if (!b) return;\n    var day = b.getAttribute('data-close');\n    b.disabled = true;\n    testMsg('정리해보는 중…');\n    call('adminClosePreview', A.cred, day, $('closeSend').checked).then(function (r) {\n      $('closeOut').hidden = false;\n      $('closeOut').textContent = r.text;\n      testMsg((r.done ? '이날은 진짜 마감 정리가 이미 돌았어요. ' : '') + '미리 보기라 휴무표·장부는 그대로예요.' +\n        (r.via ? ' ' + r.via + '(으)로도 보냈어요.' : ''));\n    }).catch(function (err) { testMsg(err.message, true); }).then(function () { b.disabled = false; });\n  });\n\n  /* 설정 */\n  function renderSettings(i) {\n    renderTg(i);\n    var miss = (i.stores || []).filter(function (st) { return st.staff && !st.hasPlace; }).map(function (st) { return st.name; });\n    $('noPlace').hidden = !miss.length || i.mode !== '필수';\n    $('noPlace').textContent = '위치를 아직 등록하지 않은 매장: ' + miss.join(', ') + '. 그 매장 안에서 [설정] 탭 → [여기로 등록]을 눌러주세요. 등록 전에는 그 매장 직원이 출근을 못 찍어요.';\n    $('stores').innerHTML = (i.stores || []).map(function (st) {\n      var hours = st.open ? st.open + (st.close ? '~' + st.close : ' 출근') : '직원별 시간';\n      var mg = (st.managers || []).length ? '점장 ' + st.managers.join(', ') : '점장 없음(요청은 관리자에게 바로)';\n      var bad = (st.badManagers || []).length ? '<div class=\"small red\">[매장] 점장 칸의 ' + esc(st.badManagers.join(', ')) + ' 님이 [직원] 명단에 없어요(이름 확인)</div>' : '';\n      return '<div class=\"st\"><div class=\"w\"><b>' + esc(st.name) + '</b> <span class=\"small\">직원 ' + st.staff + '명 · ' + esc(hours) + '</span>' +\n        '<div class=\"small' + (st.hasPlace ? '' : ' red') + '\">' + (st.hasPlace ? '위치 등록됨 · 반경 ' + st.radius + 'm' : '위치 미등록') + '</div>' +\n        '<div class=\"small\">' + esc(mg) + ' · 하루 최대 휴무 ' + (st.maxOff ? st.maxOff + '명' : '제한 없음') + (st.monthOff ? ' · 한 달 ' + st.monthOff + '일' : '') + '</div>' + bad + '</div>' +\n        '<button class=\"btn' + (st.hasPlace ? ' ghost' : '') + '\" data-place=\"' + esc(st.name) + '\">' + (st.hasPlace ? '다시 등록' : '여기로 등록') + '</button></div>';\n    }).join('') || '<p class=\"sub\">시트 [매장] 탭에 매장을 먼저 넣어주세요.</p>';\n    var keep = $('testStore').value;\n    $('testStore').innerHTML = (i.stores || []).map(function (st) { return '<option>' + esc(st.name) + '</option>'; }).join('');\n    if (keep) $('testStore').value = keep;\n    $('appUrl').value = i.appUrl || '(웹 앱으로 배포한 뒤에 보여요)';\n    $('sheetLink').href = i.sheetUrl;\n    var kv = [\n      ['위치 확인', i.mode + (i.mode === '필수' ? ' (등록된 매장 근처에서만, 기본 ' + i.radius + 'm)' : '')],\n      ['폰 확인', i.device === '필수' ? '필수 (직원마다 등록된 폰 1대에서만)' : '안함'],\n      ['지각 기준', i.grace ? '예정 시간 + ' + i.grace + '분 넘으면 지각' : '예정 시간을 1분이라도 넘으면 지각'],\n      ['지각·조퇴 차감', '시급 × 일 안 한 시간만큼 (분 단위)'],\n      ['알림 받는 곳', i.tg === '연결됨' ? '텔레그램' + (i.email ? ' (안 되면 ' + esc(i.email) + ')' : '') : i.email ? esc(i.email) + ' (메일)' : '꺼짐 (텔레그램·메일 모두 없음)'],\n      ['미출근 알림', '출근 예정 ' + i.alertMin + '분 뒤에도 안 찍으면'],\n      ['직원 알림', '텔레그램을 켠 직원에게 출근 ' + (i.remind ? i.remind + '분 전, ' : '') + '요청 결과, 대타 구함, 퇴근 안 찍음'],\n      ['휴무 고르기', i.wishWin ? '매달 ' + esc(i.wishWin) + '일에 다음 달 휴무' : '언제든 다음 달 휴무'],\n      ['대체휴무', i.subMode === '안함' ? '안 쌓음' : i.subMode === '휴무날·공휴일' ? '쉬는 날·공휴일에 출근하면 쌓임' : '쉬는 날 출근하면 쌓임'],\n      ['하루 마감', '밤 11시 30분에 결근?·퇴근 안 찍음 정리, 요약 알림'],\n    ];\n    $('kv').innerHTML = kv.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join('');\n  }\n  $('stores').addEventListener('click', function (ev) {\n    var b = ev.target.closest('[data-place]');\n    if (!b) return;\n    var storeName = b.getAttribute('data-place');\n    var msg = $('placeMsg');\n    msg.className = 'msg';\n    msg.textContent = '위치 확인 중… (10초 정도 걸릴 수 있어요)';\n    if (!navigator.geolocation) { msg.className = 'msg bad'; msg.textContent = '이 브라우저는 위치를 지원하지 않아요.'; return; }\n    navigator.geolocation.getCurrentPosition(function (p) {\n      var acc = Math.round(p.coords.accuracy);\n      if (!confirm('지금 위치(오차 약 ' + acc + 'm)를 [' + storeName + '] 위치로 등록할까요?\\n그 매장 안에 있을 때만 눌러주세요.')) { msg.textContent = ''; return; }\n      call('adminSetPlace', A.cred, storeName, p.coords.latitude, p.coords.longitude).then(function (info) {\n        renderSettings(info);\n        A.info = info;\n        msg.textContent = storeName + ' 위치를 등록했어요. 오차 ' + acc + 'm' + (acc > 50 ? ' — 오차가 커요. 창가에서 한 번 더 등록하면 더 정확해요.' : '');\n      }).catch(function (e) { msg.className = 'msg bad'; msg.textContent = e.message; });\n    }, function (e) {\n      msg.className = 'msg bad';\n      msg.textContent = e.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 위치 권한을 허용해주세요.' : '위치를 확인하지 못했어요. 다시 눌러주세요.';\n    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });\n  });\n  $('copy').addEventListener('click', function () {\n    var el = $('appUrl');\n    el.select();\n    var done = function () { $('copy').textContent = '복사됨'; setTimeout(function () { $('copy').textContent = '복사'; }, 1500); };\n    if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done, function () { document.execCommand('copy'); done(); });\n    else { document.execCommand('copy'); done(); }\n  });\n\n  /* 텔레그램 */\n  function renderTg(i) {\n    var on = i.tg === '연결됨';\n    $('tgStatus').innerHTML = on ? '<b style=\"color:var(--ok)\">연결됨</b> · 직원 요청, 미출근, 의심 기록 알림이 텔레그램으로 바로 와요.'\n      : i.tg === '토큰만' ? '봇 토큰은 저장됐어요. 텔레그램에서 봇에게 아무 말이나 보낸 뒤 <b>[연결 확인]</b>을 누르세요.'\n      : '연결 안 됨. 연결하면 알림이 메일 대신 텔레그램으로 바로 와요. (무료)';\n    $('tgSetup').hidden = on;\n    $('tgOff').hidden = !i.tg;\n    // 토큰만 저장된 상태면 연결 코드를 보여줘요(한 번만 불러와요)\n    if (i.tg === '토큰만' && !A.tgCode && !A.tgCodeBusy) {\n      A.tgCodeBusy = true;\n      call('adminTelegramCode', A.cred).then(showTgCode).catch(function () {}).then(function () { A.tgCodeBusy = false; });\n    }\n    if (i.tg !== '토큰만') { A.tgCode = null; $('tgCodeBox').hidden = true; }\n  }\n  function showTgCode(r) {\n    if (!r || !r.code) return;\n    A.tgCode = r;\n    $('tgCode').textContent = '/start ' + r.code;\n    $('tgOwnerOpen').href = r.bot ? 'https://t.me/' + r.bot + '?start=own' + r.code : '#';\n    $('tgOwnerOpen').hidden = !r.bot;\n    $('tgCodeBox').hidden = false;\n  }\n  function tgRun(fn, args, okText) {\n    $('tgMsg').className = 'msg';\n    $('tgMsg').textContent = '확인 중…';\n    return call.apply(null, [fn, A.cred].concat(args)).then(function (r) {\n      var info = r.info || r;\n      A.info = info;\n      renderSettings(info);\n      $('tgMsg').textContent = typeof okText === 'function' ? okText(r) : okText;\n    }).catch(function (e) {\n      $('tgMsg').className = 'msg bad';\n      $('tgMsg').textContent = e.message;\n    });\n  }\n  $('tgSave').addEventListener('click', function () {\n    var t = $('tgToken').value.trim();\n    if (!t) { $('tgMsg').className = 'msg bad'; $('tgMsg').textContent = '토큰을 붙여넣어 주세요.'; return; }\n    tgRun('adminTelegram', [t], function (r) {\n      $('tgToken').value = '';\n      showTgCode(r);\n      return '저장했어요' + (r.bot ? ' (@' + r.bot + ')' : '') + '. [텔레그램 열기]로 봇을 열어 [시작]을 누른 뒤 [연결 확인]을 누르세요.';\n    });\n  });\n  $('tgLink').addEventListener('click', function () {\n    tgRun('adminTelegramLink', [], function () {\n      A.tgCode = null;\n      $('tgCodeBox').hidden = true;\n      return '연결됐어요! 텔레그램에 시험 메시지를 보냈어요.';\n    });\n  });\n  $('tgOff').addEventListener('click', function () {\n    if (!confirm('텔레그램 알림을 끌까요? 메일 주소가 있으면 메일로 알림이 가요.')) return;\n    tgRun('adminTelegramOff', [], '텔레그램 연결을 끊었어요.');\n  });\n\n  $('logout').addEventListener('click', function () {\n    if (!confirm('이 폰에서 로그아웃할까요? 다음에 들어올 때 비밀번호를 다시 넣어야 해요.')) return;\n    ss('att:admin', null);\n    ls('att:admin', null);\n    location.reload();\n  });\n\n  var saved = ss('att:admin') || ls('att:admin');\n  if (saved) {\n    var cred = saved;\n    if (saved.charAt(0) === '{') { try { cred = JSON.parse(saved); } catch (e) { cred = null; } }\n    if (cred && typeof cred === 'object') setMode('mgr');\n    login(cred);\n  }\n\n  /* 오늘 탭을 보고 있으면 1분마다 저절로 새로고침 */\n  setInterval(function () {\n    if (A.cred && current === 'today' && document.visibilityState === 'visible') loadToday();\n  }, 60000);\n</script>\n</body>\n</html>\n",
};
