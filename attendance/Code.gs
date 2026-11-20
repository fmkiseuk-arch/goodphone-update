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
// 매장 = 그 직원의 소속 매장(매장별로 거르기 쉽게). 찍은매장 = 실제로 찍은 곳(다른 매장 지원 근무면 달라요)
var LOG_HEAD = ['날짜', '요일', '이름', '예정출근', '예정퇴근', '출근', '퇴근',
  '지각(분)', '조퇴(분)', '근무(분)', '차감액', '출근거리(m)', '퇴근거리(m)', '메모', '찍은매장', '매장'];
var LOG_FMT = ['@', '@', '@', '@', '@', '@', '@', '0', '0', '0', '#,##0', '0', '0', '@', '@', '@'];
var C = { date: 0, dow: 1, name: 2, sIn: 3, sOut: 4, tIn: 5, tOut: 6,
  late: 7, early: 8, work: 9, deduct: 10, dIn: 11, dOut: 12, memo: 13, place: 14, store: 15 };

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
    if (!v[C.store]) v[C.store] = p.store || '';
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

/* ───────────── 1년 보기 (휴무표 탭 12개를 열지 않고 한 사람의 1년을 한 번에) ───────────── */

/**
 * 사장님 화면: 직원 한 명의 1년을 달마다(근무·지각·휴무·월차·대체휴무·결근?).
 * [출퇴근기록]·그 해 휴무표 탭들·[대체휴무]를 모아서 보여줘요. 점장은 자기 매장 직원만, 차감액은 빼고.
 */
function adminYear(cred, name, year) {
  var a = auth_(cred);
  var p = findStaff_(String(name == null ? '' : name).trim());
  if (!p) throw new Error('직원을 찾을 수 없어요.');
  if (!canSee_(a, p)) throw new Error('점장님 매장 직원만 볼 수 있어요.');
  year = validYear_(year) || nowKst_().date.slice(0, 4);
  var d = yearData_(year, [p.name])[p.name];
  if (a.role !== 'admin') {
    d.months.forEach(function (m) { m.deduct = 0; });
    d.total.deduct = 0;
    d.noMoney = true;
  }
  d.name = p.name;
  d.store = p.store;
  d.year = year;
  return d;
}

/** 관리자: 1년 요약 시트('연간 2026')를 만들어요. 한 사람 한 달이 한 줄이라, 이름으로 거르면 그 사람 1년이 한눈에 보여요. */
function adminExportYear(cred, year) {
  adminAuth_(cred);
  return exportYear_(validYear_(year) || nowKst_().date.slice(0, 4));
}

/** 시트 메뉴: 올해 1년 요약 시트. */
function menuExportYear() {
  SpreadsheetApp.getUi();
  var r = exportYear_(nowKst_().date.slice(0, 4));
  book_().setActiveSheet(book_().getSheetByName(r.name));
  book_().toast("'" + r.name + "' 시트를 만들었어요. 이름 칸 필터로 한 사람만 볼 수 있어요.");
}

function validYear_(y) { return /^\d{4}$/.test(String(y == null ? '' : y)) ? String(y) : ''; }

/**
 * 그 해 이름별 12달 요약. names를 안 주면 재직자 + 그 해 기록이 있는 사람 모두(테스트 직원 빼고).
 * 달마다: 근무일·근무시간·지각·조퇴·차감액·퇴근/출근 누락(출퇴근기록), 휴무·월차·잔여 월차·결근?(휴무표), 대체휴무 적립·사용(장부)
 */
function yearData_(year, names) {
  var today = nowKst_().date;
  var logs = logRows_(year);
  var people = staff_();
  var list = names ? names.slice() : people.filter(function (p) { return p.active; }).map(function (p) { return p.name; });
  if (!names) logs.forEach(function (r) { if (list.indexOf(r.name) < 0) list.push(r.name); });
  list = list.filter(function (n) { return n !== TEST_NAME; });
  var byKey = {};
  logs.forEach(function (r) {
    var k = r.name + '|' + r.date.slice(0, 7);
    (byKey[k] = byKey[k] || []).push(r);
  });
  var subs = subRows_();
  var out = {};
  list.forEach(function (n) { out[n] = { months: [] }; });
  for (var mi = 1; mi <= 12; mi++) {
    var ym = year + '-' + pad2_(mi);
    var g = monthGrid_(ym);
    list.forEach(function (n) {
      var t = total_(byKey[n + '|' + ym] || [], today);
      var row = g && g.rows[n];
      var off = 0, monthly = 0, absent = 0, left = null, marks = 0;
      if (row) {
        for (var d = 1; d <= daysIn_(ym); d++) {
          var m = String(row.vals[g.cols.day1 + d - 1] || '');
          if (m) marks++;
          // 휴무표 수식과 같게: 휴무 + 휴가 + 반차×0.5
          if (/휴무/.test(m)) off++;
          if (/휴가/.test(m)) off++;
          if (/반차/.test(m)) off += 0.5;
          if (/월차/.test(m)) monthly++;
          if (/결근/.test(m)) absent++;
        }
        var lv = String(row.vals[g.cols.left] || '').trim();
        if (/^-?\d+(\.\d+)?$/.test(lv)) left = Number(lv);
      }
      var got = 0, used = 0;
      subs.forEach(function (sr) {
        if (sr.name !== n || sr.date.indexOf(ym) !== 0) return;
        if (/적립/.test(sr.kind)) got += sr.days; else if (/사용/.test(sr.kind)) used += sr.days;
      });
      out[n].months.push({
        ym: ym, m: mi, days: t.days, work: t.work, lateCount: t.lateCount, lateMin: t.lateMin, earlyMin: t.earlyMin,
        deduct: t.deduct, noOut: t.noOut, noIn: t.noIn, off: off, monthly: monthly, monthlyLeft: left, absent: absent,
        subGot: got, subUsed: used, any: !!(t.days || t.noIn || marks || got || used),
      });
    });
  }
  list.forEach(function (n) {
    var tot = { days: 0, work: 0, lateCount: 0, lateMin: 0, earlyMin: 0, deduct: 0, noOut: 0, noIn: 0, off: 0, monthly: 0, absent: 0, subGot: 0, subUsed: 0, monthlyLeft: null };
    out[n].months.forEach(function (m) {
      Object.keys(tot).forEach(function (k) { if (k !== 'monthlyLeft') tot[k] += m[k]; });
      if (m.monthlyLeft != null) tot.monthlyLeft = m.monthlyLeft; // 가장 최근 달의 잔여
    });
    out[n].total = tot;
  });
  return out;
}

function exportYear_(year) {
  var ss = book_();
  var name = '연간 ' + year;
  var sh = ss.getSheetByName(name);
  if (sh) {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
  } else {
    sh = ss.insertSheet(name);
  }
  var data = yearData_(year, null);
  var storeOf = {}, order = {};
  sortByStore_(staff_()).forEach(function (p, i) { storeOf[p.name] = p.store; order[p.name] = i; });
  var names = Object.keys(data).sort(function (a, b) {
    return (order[a] == null ? 9999 : order[a]) - (order[b] == null ? 9999 : order[b]);
  });
  var head = ['이름', '매장', '월', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감액', '휴무', '월차 사용', '월차 잔여',
    '대체휴무 적립', '대체휴무 사용', '결근?', '퇴근 누락', '출근 누락'];
  var line = function (n, label, m) {
    return [n, storeOf[n] || '', label, m.days, hm_(m.work), m.lateCount, m.lateMin, m.earlyMin, m.deduct, m.off, m.monthly,
      m.monthlyLeft == null ? '' : m.monthlyLeft, m.subGot, m.subUsed, m.absent, m.noOut, m.noIn];
  };
  var rows = [], totals = [];
  names.forEach(function (n) {
    var months = data[n].months.filter(function (m) { return m.any; });
    if (!months.length) return;
    months.forEach(function (m) { rows.push(line(n, m.m + '월', m)); });
    rows.push(line(n, '합계', data[n].total));
    totals.push(rows.length + 1); // 합계 줄 번호(머리글이 1줄)
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 3).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    sh.getRange(2, 9, rows.length, 1).setNumberFormat('#,##0');
    totals.forEach(function (r) { sh.getRange(r, 1, 1, head.length).setFontWeight('bold').setBackground('#f1f5f9'); });
    // 사람마다(합계 줄 아래) 선을 그어 구분
    storeLines_(sh, 2, rows.map(function (r) { return r[0]; }), head.length);
    sh.getRange(1, 1, rows.length + 1, head.length).createFilter();
  }
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), rows: rows.length, people: totals.length };
}

/* ───────────── 시트에서 보는 1년 (PC용): '직원 1년'·'매장 1년' 탭 ───────────── */
/*
 * 3행에서 고르면 바로 채워져요: B3 직원(또는 매장), D3 연도, F3 새로고침(체크하면 최신 기록으로 다시).
 * 탭 내용은 앱이 그때그때 다시 그려요. 손으로 고친 건 다음에 고를 때 지워지니, 기록은 원래 탭에서 고치세요.
 */
var YEAR_TABS = { staff: '직원 1년', store: '매장 1년' };

/** 시트 메뉴: '직원 1년' 탭 열기(없으면 만들어요). */
function menuStaffYear() {
  SpreadsheetApp.getUi();
  book_().setActiveSheet(renderYearTab_(YEAR_TABS.staff));
}

/** 시트 메뉴: '매장 1년' 탭 열기(없으면 만들어요). */
function menuStoreYear() {
  SpreadsheetApp.getUi();
  book_().setActiveSheet(renderYearTab_(YEAR_TABS.store));
}

/** '직원 1년'·'매장 1년' 탭을 3행에서 고른 값으로 다시 그려요. 처음이면 탭을 만들어요. */
function renderYearTab_(tab) {
  var ss = book_();
  var sh = ss.getSheetByName(tab);
  if (!sh) {
    // 휴무표 탭들 바로 뒤에 둬요
    var at = 0;
    ss.getSheets().forEach(function (x, i) { if (x.getName().indexOf(MONTH_PREFIX) === 0) at = i + 1; });
    sh = ss.insertSheet(tab, at);
  }
  if (sh.getMaxColumns() < 33) sh.insertColumnsAfter(sh.getMaxColumns(), 33 - sh.getMaxColumns());
  var isStaff = tab === YEAR_TABS.staff;
  var now = nowKst_();
  var thisYear = now.date.slice(0, 4);
  var people = sortByStore_(staff_().filter(function (p) { return p.name !== TEST_NAME; }));
  var options = isStaff
    ? people.filter(function (p) { return p.active; }).concat(people.filter(function (p) { return !p.active; })).map(function (p) { return p.name; })
    : stores_().map(function (st) { return st.name; });
  var cur = String(sh.getRange(3, 2).getDisplayValue()).trim();
  var pick = options.indexOf(cur) >= 0 ? cur : options[0] || '';
  var year = validYear_(String(sh.getRange(3, 4).getDisplayValue()).trim()) || thisYear;
  var years = [String(Number(thisYear) - 1), thisYear];
  if (years.indexOf(year) < 0) years.push(year);

  // 위: 제목·안내·고르는 칸
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clear();
  sh.getRange(1, 1, 3, 7).setNumberFormat('@');
  sh.getRange(1, 1).setValue(isStaff ? '직원 1년 보기' : '매장 1년 보기').setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1).setValue((isStaff ? 'B3에서 직원' : 'B3에서 매장') + ', D3에서 연도를 고르면 바로 채워져요. 그 사이 기록이 바뀌었으면 F3을 체크하세요. (이 탭은 보기용이라, 고칠 건 원래 탭에서 고치세요)')
    .setFontColor('#6b7280');
  sh.getRange(3, 1, 1, 7).setValues([[isStaff ? '직원' : '매장', pick, '연도', year, '새로고침', '', '기준 ' + now.date + ' ' + now.time]]);
  sh.getRange(3, 1).setFontWeight('bold');
  sh.getRange(3, 3).setFontWeight('bold');
  sh.getRange(3, 5).setFontWeight('bold');
  sh.getRange(3, 7).setFontColor('#6b7280');
  if (options.length) sh.getRange(3, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build());
  sh.getRange(3, 4).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(years, true).setAllowInvalid(false).build());
  sh.getRange(3, 6).insertCheckboxes();
  sh.getRange(3, 2, 1, 3).setBackground('#fef9c3');
  sh.setFrozenRows(3);
  sh.setColumnWidth(1, 90);
  sh.setColumnWidth(2, 110);
  if (!pick) {
    sh.getRange(5, 1).setValue(isStaff ? '[직원] 탭에 직원을 먼저 넣어주세요.' : '[매장] 탭에 매장을 먼저 넣어주세요.');
    return sh;
  }
  if (isStaff) drawStaffYear_(sh, pick, year); else drawStoreYear_(sh, pick, year, people);
  return sh;
}

/** 표 하나: 제목 줄, 머리글 줄, 내용 줄들. 다음 표를 시작할 줄 번호를 돌려줘요. */
function yearTable_(sh, row, title, head, rows, opts) {
  opts = opts || {};
  sh.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(12);
  sh.getRange(row + 1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  if (rows.length) {
    sh.getRange(row + 2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(row + 2, 1, rows.length, head.length).setValues(rows);
    (opts.money || []).forEach(function (c) { sh.getRange(row + 2, c, rows.length, 1).setNumberFormat('#,##0'); });
    if (opts.total) sh.getRange(row + 1 + rows.length, 1, 1, head.length).setFontWeight('bold').setBackground('#f1f5f9');
  }
  return row + 2 + rows.length + 1;
}

/** '직원 1년': 달마다 합계 + 1년 달력(휴무표 칸 그대로, 12달 × 31일). */
function drawStaffYear_(sh, name, year) {
  var d = yearData_(year, [name])[name];
  var p = findStaff_(name);
  var line = function (label, m) {
    return [label, m.days, hm_(m.work), m.lateCount, m.lateMin, m.earlyMin, m.deduct, m.off, m.monthly,
      m.monthlyLeft == null ? '' : m.monthlyLeft, m.subGot, m.subUsed, m.absent, m.noOut, m.noIn];
  };
  var rows = d.months.map(function (m) { return line(m.m + '월', m); });
  rows.push(line('합계', d.total));
  var next = yearTable_(sh, 5, '달마다 합계 · ' + name + (p && p.store ? ' (' + p.store + ')' : '') + ' · ' + year + '년',
    ['월', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감액', '휴무', '월차 사용', '월차 잔여', '대체 적립', '대체 사용', '결근?', '퇴근 누락', '출근 누락'],
    rows, { money: [7], total: true });

  // 1년 달력
  var top = next + 1;
  sh.getRange(top, 1).setValue('1년 달력 · 휴무표 칸 그대로 (휴무·월차·반차·지각 시간·대타·결근?)').setFontWeight('bold').setFontSize(12);
  var head = ['월'];
  for (var d1 = 1; d1 <= 31; d1++) head.push(String(d1));
  sh.getRange(top + 1, 1, 1, 32).setNumberFormat('@').setValues([head]).setFontWeight('bold').setBackground('#eef2f7').setHorizontalAlignment('center');
  var hol = holidays_();
  var cal = [], bgs = [];
  for (var mi = 1; mi <= 12; mi++) {
    var ym = year + '-' + pad2_(mi), n = daysIn_(ym), g = monthGrid_(ym), r = g && g.rows[name];
    var line2 = [mi + '월'], bg = [];
    for (var day = 1; day <= 31; day++) {
      var date = ym + '-' + pad2_(day), dow = day <= n ? dowOf_(date) : -1;
      line2.push(day <= n && r ? String(r.vals[g.cols.day1 + day - 1] || '').trim() : '');
      bg.push(day > n ? '#e5e7eb' : hol[date] || dow === 0 ? '#fef2f2' : dow === 6 ? '#eff6ff' : '#ffffff');
    }
    cal.push(line2);
    bgs.push(bg);
  }
  var body = sh.getRange(top + 2, 2, 12, 31);
  sh.getRange(top + 2, 1, 12, 32).setNumberFormat('@').setValues(cal);
  body.setBackgrounds(bgs).setHorizontalAlignment('center');
  for (var c = 2; c <= 32; c++) sh.setColumnWidth(c, 52);
  markRules_(sh, body, colA1_(2) + (top + 2));
}

/** '매장 1년': 직원별 1년 합계, 달마다 매장 합계, 달마다 지각·휴무 (직원 × 달). */
function drawStoreYear_(sh, store, year, people) {
  var all = people.filter(function (p) { return p.store === store; }).map(function (p) { return p.name; });
  var data = yearData_(year, all);
  var mates = people.filter(function (p) {
    return p.store === store && (p.active || data[p.name].months.some(function (m) { return m.any; }));
  });
  var sum = function (list, k) { return list.reduce(function (s, x) { return s + (x[k] || 0); }, 0); };
  var totals = mates.map(function (p) { return data[p.name].total; });
  var rows = mates.map(function (p) {
    var t = data[p.name].total;
    return [p.name + (p.active ? '' : ' (퇴사)'), t.days, hm_(t.work), t.lateCount, t.lateMin, t.earlyMin, t.deduct, t.off, t.monthly,
      t.monthlyLeft == null ? '' : t.monthlyLeft, t.subGot, t.subUsed, t.absent, t.noOut];
  });
  rows.push(['매장 합계', sum(totals, 'days'), hm_(sum(totals, 'work')), sum(totals, 'lateCount'), sum(totals, 'lateMin'), sum(totals, 'earlyMin'),
    sum(totals, 'deduct'), sum(totals, 'off'), sum(totals, 'monthly'), '', sum(totals, 'subGot'), sum(totals, 'subUsed'), sum(totals, 'absent'), sum(totals, 'noOut')]);
  var next = yearTable_(sh, 5, '직원별 1년 합계 · ' + store + ' · ' + year + '년',
    ['이름', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감액', '휴무', '월차 사용', '월차 잔여', '대체 적립', '대체 사용', '결근?', '퇴근 누락'],
    rows, { money: [7], total: true });

  var monthRows = [];
  for (var i = 0; i < 12; i++) {
    var ms = mates.map(function (p) { return data[p.name].months[i]; });
    monthRows.push([(i + 1) + '월', sum(ms, 'days'), hm_(sum(ms, 'work')), sum(ms, 'lateCount'), sum(ms, 'lateMin'), sum(ms, 'off'),
      sum(ms, 'monthly'), sum(ms, 'absent'), sum(ms, 'noOut')]);
  }
  next = yearTable_(sh, next + 1, '달마다 매장 합계', ['월', '근무일(연인원)', '근무시간', '지각(회)', '지각(분)', '휴무', '월차', '결근?', '퇴근 누락'], monthRows);

  var grid = function (k) {
    return mates.map(function (p) {
      var ms = data[p.name].months;
      return [p.name].concat(ms.map(function (m) { return m[k]; })).concat([data[p.name].total[k]]);
    });
  };
  var mh = ['이름'];
  for (var j = 1; j <= 12; j++) mh.push(j + '월');
  mh.push('합계');
  next = yearTable_(sh, next + 1, '달마다 지각(회)', mh, grid('lateCount'));
  yearTable_(sh, next + 1, '달마다 휴무(일)', mh, grid('off'));
}

/** 휴무표 칸 색칠 규칙(휴무표 탭과 같은 색). first = 범위 맨 위 왼쪽 칸('J3' 같은). */
function markRules_(sh, days, first, extra) {
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
  ].concat(extra || []));
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
    paintMonth_(g.sh, ym, g.cols);
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
    .addItem('올해 1년 요약 시트 만들기', 'menuExportYear')
    .addItem('직원 1년 보기 탭', 'menuStaffYear')
    .addItem('매장 1년 보기 탭', 'menuStoreYear')
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
    var tab = sh.getName();
    if (tab === YEAR_TABS.staff || tab === YEAR_TABS.store) {
      // 3행(직원·매장, 연도, 새로고침)을 고르면 그 1년으로 다시 그려요
      if (rg.getRow() === 3 && rg.getColumn() <= 6) renderYearTab_(tab);
      return;
    }
    if (tab !== SHEETS.log) return;
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
  var ml = LockService.getScriptLock();
  if (ml.tryLock(5000)) {
    try {
      ensureMonth_(now.ym);
      if (Number(now.date.slice(8)) >= 20) ensureMonth_(nextYm_(now.ym));
    } finally {
      ml.releaseLock();
    }
  }
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
  addTailCols_(rq, REQ_HEAD, R.route); // 예전 [요청] 탭: 보낼곳·점장확인
  addTailCols_(sheet_(SHEETS.log), LOG_HEAD, C.store); // 예전 [출퇴근기록] 탭: 매장
  var sub = ensureSheet_(ss, SHEETS.sub, SUB_HEAD, [], SUB_FMT);
  // 보기 쉽게 색칠: 출퇴근기록(주말·지각·퇴근 누락), 요청(상태), 대체휴무(적립·사용)
  logRules_(sheet_(SHEETS.log));
  statusRules_(rq, R.state + 1, [['대기', '#fef3c7'], ['수락', '#fef3c7'], ['승인', '#dcfce7'], ['거절', '#fee2e2'], ['돌려보냄', '#fee2e2'], ['취소', '#f1f5f9']]);
  statusRules_(sub, 3, [['적립', '#dcfce7'], ['사용', '#ffedd5']]);
  var now = nowKst_();
  [now.ym, nextYm_(now.ym)].forEach(function (ym) {
    ensureMonth_(ym);
    // 예전에 만든 탭도 공휴일 표시·색칠 규칙(결근?, 휴무?, 대체)을 새로 맞춰요
    var g = monthGrid_(ym, true);
    if (!g) return;
    paintMonth_(g.sh, ym, g.cols);
    monthRules_(g.sh, g.cols.day1);
  });

  // PC에서 보는 1년 탭(고르면 바로 채워져요)
  renderYearTab_(YEAR_TABS.staff);
  renderYearTab_(YEAR_TABS.store);

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

/**
 * 칸 순서가 정해진 탭([요청], [출퇴근기록])에 새 버전 칸(from번째부터)을 맞춰요.
 * 그 자리에 사장님이 따로 쓰던 칸(다른 머리글이나, 머리글 없이 적힌 값)이 있으면
 * 그 칸들을 오른쪽으로 밀고 새 칸을 끼워 넣어요. 빈 머리글은 채워요.
 */
function addTailCols_(sh, head, from) {
  var extra = head.length - from;
  var rh = sh.getRange(1, 1, 1, head.length).getDisplayValues()[0];
  var clash = rh.slice(from).some(function (h, i) { h = String(h).trim(); return h && h !== head[from + i]; });
  if (!clash && !String(rh[from]).trim() && sh.getLastRow() > 1) {
    clash = sh.getRange(2, from + 1, sh.getLastRow() - 1, extra).getDisplayValues().some(function (row) {
      return row.some(function (x) { return String(x).trim(); });
    });
  }
  if (clash) {
    sh.insertColumnsBefore(from + 1, extra);
    sh.getRange(2, from + 1, sh.getMaxRows() - 1, extra).setNumberFormat('@');
    rh = sh.getRange(1, 1, 1, head.length).getDisplayValues()[0];
  }
  if (rh.some(function (h) { return !String(h).trim(); })) {
    sh.getRange(1, 1, 1, head.length).setValues([head.map(function (h, i) { return String(rh[i]).trim() || h; })])
      .setFontWeight('bold').setBackground('#eef2f7');
  }
}

/** [출퇴근기록] 색칠: 토요일 줄 파랑·일요일 줄 빨강, 지각 칸 빨간 글씨, 퇴근 안 찍은 칸 노랑. */
function logRules_(sh) {
  var n = Math.max(sh.getMaxRows() - 1, 1), w = LOG_HEAD.length;
  var all = sh.getRange(2, 1, n, w);
  var rule = function (rg) { return SpreadsheetApp.newConditionalFormatRule().setRanges([rg]); };
  sh.setConditionalFormatRules([
    rule(sh.getRange(2, C.late + 1, n, 1)).whenFormulaSatisfied('=N($H2)>0').setFontColor('#c62828').setBold(true).build(),
    rule(sh.getRange(2, C.tOut + 1, n, 1)).whenFormulaSatisfied('=AND($F2<>"",$G2="",$A2<>"",$A2<TEXT(TODAY(),"yyyy-mm-dd"))').setBackground('#fef08a').build(),
    rule(all).whenFormulaSatisfied('=$B2="토"').setBackground('#eff6ff').build(),
    rule(all).whenFormulaSatisfied('=$B2="일"').setBackground('#fef2f2').build(),
  ]);
  sh.setColumnWidth(C.memo + 1, 260);
}

/** 상태 칸(col, 1부터) 글자에 따라 칸 배경을 칠해요. pairs = [[글자, 색], …] */
function statusRules_(sh, col, pairs) {
  var rg = sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1);
  sh.setConditionalFormatRules(pairs.map(function (x) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(x[0]).setBackground(x[1]).setRanges([rg]).build();
  }));
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
  v[C.store] = p.store || '';
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

function monthRows_(ym) { return logRows_(ym); }

/** [출퇴근기록]에서 날짜가 prefix('2026-11' 또는 '2026')로 시작하는 줄. */
function logRows_(prefix) {
  var ym = prefix;
  return rows_(SHEETS.log).map(function (v) {
    return {
      date: parseDate_(v[C.date]), dow: String(v[C.dow] || ''), name: String(v[C.name]).trim(),
      sIn: fmtTime_(parseTime_(v[C.sIn])), sOut: fmtTime_(parseTime_(v[C.sOut])),
      tIn: fmtTime_(parseTime_(v[C.tIn])), tOut: fmtTime_(parseTime_(v[C.tOut])),
      late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: toNum_(v[C.work]),
      deduct: toNum_(v[C.deduct]), memo: String(v[C.memo] || ''), place: String(v[C.place] || ''),
      store: String(v[C.store] || '').trim(),
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

  var head = ['이름', '매장', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감액', '퇴근 누락', '출근 누락'];
  var sum = data.staff.map(function (s) {
    return [s.name, s.store, s.days, hm_(s.work), s.lateCount, s.lateMin, s.earlyMin, s.deduct, s.noOut, s.noIn];
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  if (sum.length) {
    sh.getRange(2, 1, sum.length, 2).setNumberFormat('@');
    sh.getRange(2, 1, sum.length, head.length).setValues(sum);
    sh.getRange(2, 8, sum.length, 1).setNumberFormat('#,##0');
    storeLines_(sh, 2, sum.map(function (r) { return r[1]; }), head.length);
  }

  var top = sum.length + 3;
  sh.getRange(top, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold').setBackground('#eef2f7');
  if (data.rows.length) {
    var storeOf = {};
    staff_().forEach(function (p) { storeOf[p.name] = p.store; });
    var detail = data.rows.map(function (r) {
      return [r.date, r.dow, r.name, r.sIn, r.sOut, r.tIn, r.tOut,
        r.late || '', r.early || '', r.work || '', r.deduct || '', '', '', r.memo, r.place, r.store || storeOf[r.name] || ''];
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
  var created = !sh;
  if (created) {
    sh = ss.insertSheet(monthName_(ym), 0);
    buildMonth_(sh, ym);
  }
  var g = monthGrid_(ym, true);
  var people = sortByStore_(staff_().filter(function (p) { return p.active && !g.rows[p.name]; }));
  if (people.length) {
    var prev = ss.getSheetByName(monthName_(prevYm_(ym))) ? monthName_(prevYm_(ym)) : '';
    var have = Object.keys(g.rows).map(function (n) {
      return { row: g.rows[n].row, store: String(g.rows[n].vals[g.cols.store] || '').trim() };
    });
    if (!have.length) {
      // 새 탭: 매장 순서대로 한 번에
      var start = Math.max(sh.getLastRow(), 2) + 1;
      if (start + people.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), people.length + 50);
      var rows = people.map(function (p, i) { return monthRow_(start + i, p, prev, g.cols); });
      sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    } else {
      // 이미 쓰던 탭: 새 직원은 같은 매장(없으면 앞 순서 매장) 마지막 줄 바로 아래에 끼워 넣어요
      var order = {};
      stores_().forEach(function (st, i) { order[st.name] = i; });
      var idx = function (st) { return order[st] == null ? 999 : order[st]; };
      people.forEach(function (p) {
        var after = 2;
        have.forEach(function (h) { if (idx(h.store) <= idx(p.store) && h.row > after) after = h.row; });
        sh.insertRowsAfter(after, 1);
        have.forEach(function (h) { if (h.row > after) h.row++; });
        // 끼워 넣은 줄은 위 줄(머리글일 수도 있어요) 서식을 따라와서, 직원 줄 서식으로 맞춰요
        var w = g.cols.day1 + 32;
        sh.getRange(after + 1, 1, 1, w).setFontWeight('normal').setBackground(null);
        sh.getRange(after + 1, g.cols.store + 1, 1, 2).setNumberFormat('@');
        sh.getRange(after + 1, g.cols.day1 + 1, 1, 32).setNumberFormat('@');
        var row = monthRow_(after + 1, p, prev, g.cols);
        sh.getRange(after + 1, 1, 1, row.length).setValues([row]);
        have.push({ row: after + 1, store: p.store });
      });
    }
  }
  delete GRID_[ym];
  if (created || people.length) {
    var g2 = monthGrid_(ym, true);
    paintMonth_(sh, ym, g2.cols);
    if (created) monthRules_(sh, g2.cols.day1);
  }
  return sh;
}

/**
 * 휴무표 보기 좋게 칠해요(새 탭·새 직원·setup·휴무표 만들기 때).
 *  - 날짜 머리글: 일요일·공휴일 빨강, 토요일 파랑, 공휴일 이름은 요일 칸 메모
 *  - 날짜 칸: 일요일·공휴일 옅은 빨강, 토요일 옅은 파랑 음영(맨 아래까지)
 *  - 집계 칸(휴무~지각) 옅은 회색, 매장이 바뀌는 줄 아래 굵은 선, 매장 이름은 묶음 첫 줄만 진하게
 */
function paintMonth_(sh, ym, cols) {
  var day1 = cols.day1, n = daysIn_(ym), hol = holidaysIn_(ym);
  markHolidays_(sh, ym, day1);
  var rows = Math.max(sh.getMaxRows() - 2, 1);
  for (var d = 1; d <= n; d++) {
    var date = ym + '-' + pad2_(d), dow = dowOf_(date);
    sh.getRange(3, day1 + d, rows, 1).setBackground(hol[date] || dow === 0 ? '#fef2f2' : dow === 6 ? '#eff6ff' : null);
  }
  if (day1 > cols.name + 1) sh.getRange(3, cols.name + 2, rows, day1 - cols.name - 1).setBackground('#f8fafc');
  var last = sh.getLastRow();
  if (last < 3) return;
  var width = Math.max(sh.getLastColumn(), day1 + 32);
  // No 칸(머리글이 'No'일 때만)은 줄 번호 수식으로: 줄을 끼워 넣어도 번호가 맞아요
  if (String(sh.getRange(1, 1).getDisplayValue()).trim() === 'No') sh.getRange(3, 1, last - 2, 1).setFormula('=ROW()-2');
  var stores = sh.getRange(3, cols.store + 1, last - 2, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
  sh.getRange(3, 1, last - 2, width).setBorder(false, false, false, false, false, false);
  storeLines_(sh, 3, stores, width);
  var colors = [], weights = [];
  stores.forEach(function (st, i) {
    var first = i === 0 || stores[i - 1] !== st;
    colors.push([first ? '#111827' : '#cbd5e1']);
    weights.push([first ? 'bold' : 'normal']);
  });
  sh.getRange(3, cols.store + 1, stores.length, 1).setFontColors(colors).setFontWeights(weights);
}

/** 매장이 바뀌는 줄 아래에 굵은 선을 그어요(같은 매장끼리 묶여 보이게). stores[i] = row+i 줄의 매장. */
function storeLines_(sh, row, stores, width) {
  stores.forEach(function (st, i) {
    if (i === stores.length - 1 || stores[i + 1] !== st) {
      sh.getRange(row + i, 1, 1, width).setBorder(null, null, true, null, null, null, '#475569', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
  });
}

/** 직원 한 줄: No, 매장, 이름, 그리고 집계 수식(휴무·월차·이월·부여·잔여·지각). cols = 그 탭의 날짜 칸 위치. */
function monthRow_(r, p, prev, cols) {
  var d1 = (cols || MT).day1;
  var days = colA1_(d1 + 1) + r + ':' + colA1_(d1 + 31) + r;
  var q = "'" + prev + "'";
  return [
    '=ROW()-2', p.store, p.name,
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
  markRules_(sh, days, colA1_(day1 + 1) + '3', [
    // 오늘 날짜 머리글을 노랗게
    SpreadsheetApp.newConditionalFormatRule().setRanges([sh.getRange(1, day1 + 1, 2, 31)])
      .whenFormulaSatisfied('=TEXT(' + colA1_(day1 + 1) + '$1,"M/D")=TEXT(TODAY(),"M/D")').setBackground('#fde68a').setBold(true).build(),
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
      store: head.indexOf('매장') >= 0 ? head.indexOf('매장') : MT.store,
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
  if (String(g.sh.getRange(r.row, g.cols.name + 1).getDisplayValue()).trim() !== name) {
    // 읽은 뒤에 줄이 바뀌었어요(새 직원 줄 끼워 넣기 등). 다시 읽어요
    g = monthGrid_(ym, true);
    r = g && g.rows[name];
    if (!r) return;
  }
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
