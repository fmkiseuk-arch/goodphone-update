// [늦어요] · [오늘 못 나가요]: 출근 전에 점장·사장님께 미리 알리기
// 실행: node --test test/f6-late-absent-buttons.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const TOKEN = '123456789:' + 'A'.repeat(35);
const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 };
const PHONE = {
  김민우: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박점장: 'eeeeeeeeeeeeeeee', 최유나: 'ffffffffffffffff', 정하나: 'gggggggggggggggg', 테스트: 'hhhhhhhhhhhhhhhh',
};
const PINS = { 김민우: '0123', 이지은: '5678', 박점장: '246813', 최유나: '135790', 정하나: '864200', 테스트: '4826' };
const ROW = { 김민우: 2, 이지은: 3, 박점장: 4, 최유나: 5, 정하나: 6 };
// 텔레그램 채팅 번호: 사장님 555, 직원은 아래
const CHAT = { 사장님: '555', 김민우: '9002', 이지은: '9003', 박점장: '9005', 최유나: '9006', 정하나: '9007' };

// 인사 정보를 다 넣은 상태로(출근 전에 인사 정보가 꼭 있어야 해서)
let hrSeq = 0;
function hrFill(g) {
  const list = g.gs.staff_().filter((p) => p.active).map((p) => p.name);
  for (const n of list) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(n)) g.gs.syncHr_();
    const h = g.gs.hrFind_(n);
    if (!h) continue;
    hrSeq++;
    const rrn = '8001' + String(10 + (hrSeq % 18)).padStart(2, '0') + '1' + String(100000 + hrSeq).slice(-6);
    g.gs.hrWrite_(h.row, {
      rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: '010-1000-' + String(1000 + hrSeq), addr: '서울 성동구', bank: '국민',
      account: '123456-78-' + String(900000 + hrSeq), emergency: '010-9999-8888 가족', start: '2020-01-01',
    });
  }
  g.gs.MEMO_ = {};
}

// 2026-11-16 은 월요일
// 매장: 왕십리(10:00-20:00, 점장 박점장) · 가산(12:00-21:00, 점장 최유나)
// 김민우(왕십리, 토·일 휴무) · 이지은(가산, 수·일 휴무) · 박점장(왕십리) · 최유나(가산) · 정하나(왕십리) · 박퇴사(퇴사)
function shop() {
  const g = createGas({ now: Date.parse('2026-11-16T08:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 8).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', '', '박점장'],
    ['가산', '12:00', '21:00', '', '', '', '', '최유나'],
  ]);
  //            이름      매장      PIN       시급   월  화  수      목  금  토      일      재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 6, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '135790', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['정하나', '왕십리', '864200', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  g.gs.adminSetPlace(ADMIN, '왕십리', STORE.lat, STORE.lng);
  g.gs.setup(); // 새 직원 줄을 휴무표에
  hrFill(g);
  // 김민우·정하나는 폰이 이미 등록돼 있어요(전에 출근을 찍은 폰)
  for (const n of ['김민우', '정하나']) g.gs.setStaffCell_(ROW[n], '등록폰', g.gs.devCell_(PHONE[n], 'iPhone 사파리', '11/13 등록'));
  g.gs.MEMO_ = {};
  return g;
}
// 텔레그램을 연결하고(사장님 555), names 직원은 앱에서 알림을 켠 상태로
const tgOn = (g, names = []) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', CHAT.사장님);
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const n of names) g.gs.setStaffCell_(ROW[n], '텔레그램', CHAT[n]);
};
const sentTo = (g, who) => g.tg.sent.filter((m) => String(m.chat_id) === String(CHAT[who] || who));
const texts = (g, who) => sentTo(g, who).map((m) => m.text);
const missingFor = (g, who) => texts(g, who).filter((t) => /아직 출근 안 찍은 직원|아직 출근을 안 찍었어요/.test(t));
const late = (g, name, min, why = '', device = PHONE[name], pin = PINS[name]) => g.gs.lateNotice(name, pin, min, why, device);
const off = (g, name, kind, why = '', device = PHONE[name], pin = PINS[name]) => g.gs.offToday(name, pin, kind, why, device);
const punch = (g, name, type = 'in') =>
  g.gs.punch({ name, pin: PINS[name], type, lat: NEAR.lat, lng: NEAR.lng, acc: NEAR.acc, device: PHONE[name], label: 'iPhone 사파리', agree: true });
const req = (g, name, kind, extra = {}) => g.gs.makeRequest({ name, pin: PINS[name], kind, ...extra });
const mark = (g, name, date) => { g.gs.GRID_ = {}; g.gs.MEMO_ = {}; return g.gs.dayMark_(name, date); };
const reqRows = (g) => {
  const sh = g.sheet('요청');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r));
  return out;
};
const logRow = (g, name, date) => {
  const sh = g.sheet('출퇴근기록');
  for (let r = 2; r <= sh.getLastRow(); r++) { const v = sh.rowDisplay(r); if (v[0] === date && v[2] === name) return v; }
  return null;
};
const prop = (g, k) => g.gs.PropertiesService.getScriptProperties().getProperty(k);

test('[늦어요]: 그 매장 점장과 사장님께 소리 없이 알리고, 말한 시간 + 10분까지 미출근 알림을 기다려요', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '김민우', '정하나']);
  g.setKst('2026-11-16 09:30');
  const r = plain(late(g, '김민우', 20, '지하철 지연'));
  assert.deepEqual(r.late, { min: 20, until: '10:20', why: '지하철 지연' });
  assert.equal(r.again, false);
  assert.equal(r.mgr, 1, '왕십리 점장 한 명');
  assert.equal(r.owner, '텔레그램');

  const m = sentTo(g, '박점장');
  assert.equal(m.length, 1);
  assert.equal(m[0].text, '[굳폰] [왕십리] 김민우 약 20분 늦어요 (지하철 지연)\n오늘 10:00 출근 → 10:20쯤 와요.\n10:30까지 출근을 안 찍으면 그때 미출근 알림이 가요.');
  assert.equal(m[0].disable_notification, true, '소리 없이');
  const o = sentTo(g, '사장님');
  assert.equal(o.length, 1);
  assert.match(o[0].text, /^\[굳폰 출퇴근\] \[왕십리\] 김민우 약 20분 늦어요 \(지하철 지연\)\n11\/16 09:30\n오늘 10:00 출근 → 10:20쯤 와요\./);
  assert.equal(o[0].disable_notification, true);
  assert.equal(sentTo(g, '최유나').length, 0, '다른 매장 점장에게는 안 가요');
  assert.equal(sentTo(g, '김민우').length, 0, '본인에게는 안 가요');
  // 오늘 기록: 스크립트 속성에(3일 뒤 저절로 지워지는 dm: 이름), 다시 열어도 화면에 보여요
  assert.deepEqual(JSON.parse(prop(g, 'dm:2026-11-16:late:김민우')), { min: 20, until: 620, why: '지하철 지연', at: '09:30', n: 1 });
  assert.deepEqual(plain(g.gs.getHome('김민우', PINS.김민우).late), { min: 20, until: '10:20', why: '지하철 지연' });
  assert.equal(g.gs.getHome('김민우', '').late, undefined, '비밀번호 없이는 안 보여요');
  assert.equal(g.gs.getHome('정하나', PINS.정하나).late, null);

  // 출근 전 알림(20분 전): 늦는다고 한 사람에게는 안 가요. 정하나에게는 가요
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)));
  assert.ok(texts(g, '정하나').some((t) => /곧 출근이에요/.test(t)));
  g.setKst('2026-11-16 09:58');
  punch(g, '정하나');
  punch(g, '박점장');
  // 10:15·10:25: 평소면 미출근 알림이 갔을 시간이지만 기다려요
  for (const at of ['10:15', '10:25']) {
    g.setKst('2026-11-16 ' + at);
    g.gs.checkMissing();
    assert.deepEqual(missingFor(g, '사장님'), [], at);
    assert.deepEqual(missingFor(g, '박점장'), [], at);
    assert.deepEqual(missingFor(g, '김민우'), [], at);
  }
  // 10:30(말한 10:20 + 알림기준 10분): 그래도 안 찍었으면 평소처럼 알려요
  g.setKst('2026-11-16 10:30');
  g.gs.checkMissing();
  assert.match(missingFor(g, '사장님').at(-1), /아직 출근 안 찍은 직원 1명[\s\S]*\[왕십리\] 김민우 \(출근 예정 10:00\)/);
  assert.match(missingFor(g, '박점장').at(-1), /\[왕십리\] 김민우 \(출근 예정 10:00\)/);
  assert.match(missingFor(g, '김민우').at(-1), /아직 출근을 안 찍었어요/);
});

test('[늦어요] 뒤 출근: 지각은 평소처럼 적히고, 기록 메모에 "미리 알림"이 남아요', () => {
  const g = shop();
  tgOn(g, ['박점장']);
  g.setKst('2026-11-16 09:40');
  late(g, '김민우', 20, '지하철, 지연'); // 쉼표는 띄어쓰기로(기록 메모가 쉼표로 이어져서)
  assert.match(sentTo(g, '박점장')[0].text, /약 20분 늦어요 \(지하철 지연\)/);
  g.setKst('2026-11-16 10:24');
  const r = punch(g, '김민우');
  assert.equal(r.late, 24, '지각 24분은 그대로');
  const v = logRow(g, '김민우', '2026-11-16');
  assert.equal(v[7], '24');
  assert.match(v[13], /미리 알림: 20분\(지하철 지연\)/);
  assert.throws(() => late(g, '김민우', 30), /오늘은 이미 10:24에 출근을 찍었어요/);
  // 이유 없이 1시간이면 '미리 알림: 1시간'
  g.setKst('2026-11-17 09:50');
  late(g, '김민우', 60);
  assert.match(sentTo(g, '박점장').at(-1).text, /김민우 약 1시간 늦어요\n오늘 10:00 출근 → 11:00쯤 와요\./);
  g.setKst('2026-11-17 10:40');
  punch(g, '김민우');
  assert.match(logRow(g, '김민우', '2026-11-17')[13], /미리 알림: 1시간/);
  assert.equal(logRow(g, '김민우', '2026-11-17')[7], '40');
});

test('[늦어요] 다시 누르기: 같은 시간은 한 번만, 바꾸면 다시 알리고(미출근 알림도 새 시간 기준), 하루 3번까지', () => {
  const g = shop();
  tgOn(g, ['박점장']);
  g.setKst('2026-11-16 09:30');
  late(g, '김민우', 10);
  g.setKst('2026-11-16 09:31');
  assert.equal(late(g, '김민우', 10).again, true, '두 번 눌러도');
  assert.equal(sentTo(g, '사장님').length, 1, '한 번만 알려요');
  g.setKst('2026-11-16 09:32');
  late(g, '김민우', 30, '버스 놓침');
  assert.match(sentTo(g, '사장님').at(-1).text, /약 30분 늦어요 \(버스 놓침\)\n11\/16 09:32\n오늘 10:00 출근 → 10:30쯤 와요\. \(아까 10분이라고 했다가 바꿨어요\)/);
  assert.match(sentTo(g, '박점장').at(-1).text, /아까 10분이라고 했다가 바꿨어요/);
  g.setKst('2026-11-16 09:33');
  late(g, '김민우', 60, '버스 놓침');
  assert.equal(sentTo(g, '사장님').length, 3);
  assert.match(sentTo(g, '사장님').at(-1).text, /아까 30분이라고 했다가 바꿨어요/);
  g.setKst('2026-11-16 09:34');
  assert.throws(() => late(g, '김민우', 20), /오늘은 벌써 3번 알렸어요/);
  // 이유만 고치면 '이유를 고쳐서 다시 보내요'(다른 날)
  g.setKst('2026-11-17 09:30');
  late(g, '이지은', 20, '', '');
  late(g, '이지은', 20, '병원 들렀다 가요', '');
  assert.match(sentTo(g, '사장님').at(-1).text, /이지은 약 20분 늦어요 \(병원 들렀다 가요\)\n11\/17 09:30\n오늘 12:00 출근 → 12:20쯤 와요\. \(이유를 고쳐서 다시 보내요\)/);
  g.setKst('2026-11-16 09:34');
  assert.equal(JSON.parse(prop(g, 'dm:2026-11-16:late:김민우')).until, 660, '마지막으로 알린 11:00 그대로');
  // 다른 사람은 10:10에 미출근 알림, 김민우는 11:10에
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.match(missingFor(g, '사장님').at(-1), /정하나/);
  assert.doesNotMatch(missingFor(g, '사장님').at(-1), /김민우/);
  g.setKst('2026-11-16 11:05');
  g.gs.checkMissing();
  assert.equal(missingFor(g, '사장님').filter((t) => /김민우/.test(t)).length, 0);
  g.setKst('2026-11-16 11:10');
  g.gs.checkMissing();
  assert.match(missingFor(g, '사장님').at(-1), /김민우 \(출근 예정 10:00\)/);
});

test('[늦어요] 막는 경우: 비밀번호·남의 폰·테스트 직원·쉬는 날·지난 시간·인사 정보', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나']);
  g.sheet('직원').getRange(8, 1, 1, 14).setValues([['테스트', '왕십리', '4826', 0, '', '', '', '', '', '', '', '', '', '']]);
  g.gs.MEMO_ = {};
  g.setKst('2026-11-16 09:30');
  assert.throws(() => late(g, '김민우', 20, '', PHONE.김민우, ''), /비밀번호를 넣어주세요/);
  assert.throws(() => late(g, '김민우', 20, '', PHONE.김민우, '9999'), /비밀번호가 틀렸어요/);
  assert.throws(() => late(g, '없는사람', 20), /직원 명단에 없는 이름/);
  assert.throws(() => late(g, '김민우', 20, '', PHONE.정하나), /등록된 폰\)에서만 보낼 수 있어요/, '동료 폰으로는 안 돼요');
  assert.throws(() => late(g, '김민우', 20, '', ''), /등록된 폰/);
  assert.throws(() => late(g, '김민우', 15), /몇 분 늦는지 골라주세요/);
  assert.throws(() => late(g, '김민우', '20분'), /몇 분 늦는지/);
  assert.throws(() => late(g, '테스트', 20), /테스트 직원은 이 버튼을 쓸 수 없어요/);
  assert.equal(g.tg.sent.length, 0, '막힌 시도는 아무에게도 안 가요');
  // 폰이 아직 등록 안 된 직원(이지은)은 폰 확인 없이 돼요. 가산 점장에게 가요
  assert.equal(late(g, '이지은', 30, '', '').mgr, 1);
  // 폰 확인 '안함'인 가게는 폰을 안 봐요
  g.gs.setSetting_('폰확인', '안함');
  assert.equal(late(g, '김민우', 10, '', '').ok, true);
  g.gs.setSetting_('폰확인', '필수');
  // 쉬는 날(토요일)
  g.setKst('2026-11-21 09:30');
  assert.throws(() => late(g, '김민우', 20), /오늘은 근무 예정이 없어요/);
  // 이미 지난 시간은 못 골라요(10:25에 20분 = 10:20)
  g.setKst('2026-11-17 10:25');
  assert.throws(() => late(g, '김민우', 20), /10:20이 벌써 지났어요/);
  assert.equal(late(g, '김민우', 30).late.until, '10:30');
  // 인사 정보가 빠져서 출근이 막힌 직원은 [늦어요]도 막혀요([오늘 못 나가요]는 돼요)
  const h = g.gs.hrFind_('정하나');
  g.gs.hrWrite_(h.row, { addr: '' });
  g.gs.MEMO_ = {};
  assert.throws(() => late(g, '정하나', 30), /인사 정보를 먼저 다 넣어야 출근이 찍혀요\. 아직 안 넣은 것: 주소/);
  assert.equal(off(g, '정하나', '병가').kind, '병가');
  // 비밀번호를 아직 안 정한 직원
  g.gs.setStaffCell_(ROW.이지은, 'PIN', '');
  assert.throws(() => late(g, '이지은', 30, '', ''), /아직 비밀번호가 없어요/);
  assert.throws(() => off(g, '이지은', '병가', '', ''), /아직 비밀번호가 없어요/);
});

test('[오늘 못 나가요]: 휴무 신청과 같은 길로 오늘 요청, 사장님께 바로(결재 알림을 받은 점장에게는 또 안 보내요)', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:20');
  const r = plain(off(g, '김민우', '병가', '몸살'));
  assert.equal(r.kind, '병가');
  assert.equal(r.route, '점장');
  assert.equal(r.reqs.mine[0].kind, '병가');
  assert.equal(r.reqs.mine[0].date, '2026-11-16');
  const rows = reqRows(g);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(2, 8), ['김민우', '병가', '2026-11-16', '10:00-20:00', '몸살', '대기']);
  assert.equal(rows[0][10], '점장', '[휴무 신청]처럼 점장에게 먼저');
  // 점장: 결재 알림 한 통(같은 소식을 또 보내지 않아요)
  const m = texts(g, '박점장');
  assert.equal(m.length, 1);
  assert.match(m[0], /\[왕십리\] 김민우 · 병가 요청\n11\/16\(월\) 10:00-20:00 근무 → 병가\n사유: 몸살/);
  // 사장님: 오늘 못 나온다는 알림(소리 나게)
  const o = sentTo(g, '사장님');
  assert.equal(o.length, 1);
  assert.match(o[0].text, /^\[굳폰 출퇴근\] \[왕십리\] 김민우 오늘 못 나와요 \(병가\)\n11\/16 09:20\n11\/16\(월\) 10:00-20:00 근무\n사유: 몸살\n대신 일할 사람을 챙겨 주세요\.\n병가 요청은 박점장 점장이 먼저 봐요\(사장님이 바로 승인해도 돼요\)\./);
  assert.equal(o[0].disable_notification, false, '오늘 일이라 소리 나게');
  // 요청을 기다리는 동안: 출근 전·미출근 알림 없음
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)));
  g.setKst('2026-11-16 09:58');
  punch(g, '정하나');
  punch(g, '박점장');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.deepEqual(missingFor(g, '사장님'), []);
  assert.deepEqual(missingFor(g, '박점장'), []);
  assert.deepEqual(missingFor(g, '김민우'), []);
  // 밤 마감: 처리 안 된 요청이 있는 날은 '결근?'을 안 적어요(지금도 그래요)
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '');
  assert.match(texts(g, '사장님').find((t) => /하루 마감 정리/.test(t)), /처리 안 된 요청 1건[\s\S]*김민우 11\/16 병가/);
  // 다음 날 승인하면 휴무표에 '병가'
  g.setKst('2026-11-17 09:00');
  g.gs.adminRequest(ADMIN, rows[0][0], true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가');
});

test('[오늘 못 나가요]: 승인돼도 그날 미출근 알림이 없고, 사유를 안 적으면 "(안 적음)"', () => {
  const g = shop();
  tgOn(g, ['박점장']);
  g.setKst('2026-11-16 08:30');
  off(g, '김민우', '무급');
  assert.equal(reqRows(g)[0][6], '(안 적음)');
  assert.doesNotMatch(texts(g, '사장님')[0], /사유:/, '사장님 알림에는 사유 줄이 없어요');
  g.gs.adminRequest(ADMIN, reqRows(g)[0][0], true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '무급');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.ok(!missingFor(g, '사장님').some((t) => /김민우/.test(t)));
});

test('[오늘 못 나가요]: 점장이 텔레그램을 안 켰거나 본인이 점장이면 결재 알림 한 통만 가요', () => {
  // 점장이 텔레그램을 안 켬 → 결재 알림이 사장님께 가요(사장님께 두 통이 가지 않게)
  const g = shop();
  tgOn(g, []);
  g.setKst('2026-11-16 09:00');
  const r = off(g, '김민우', '월차');
  assert.equal(r.route, '점장');
  const o = texts(g, '사장님');
  assert.equal(o.length, 1);
  assert.match(o[0], /김민우 · 월차 요청 \(점장 확인 전\)/);
  assert.match(o[0], /사유: \(안 적음\)/);
  assert.deepEqual(plain(r.told), { mgr: 0, owner: '' });

  // 점장 본인(왕십리 점장은 한 명) → 관리자에게 바로, 다른 점장이 없어서 결재 알림 한 통
  const g2 = shop();
  tgOn(g2, ['박점장', '최유나']);
  g2.setKst('2026-11-16 09:00');
  const r2 = off(g2, '박점장', '병가', '열이 나요', '');
  assert.equal(r2.route, '관리자');
  assert.equal(texts(g2, '사장님').length, 1);
  assert.match(texts(g2, '사장님')[0], /\[왕십리\] 박점장 · 병가 요청/);
  assert.equal(sentTo(g2, '박점장').length, 0);
  assert.equal(sentTo(g2, '최유나').length, 0, '다른 매장 점장에게는 안 가요');

  // 점장이 두 명인 매장에서 점장 본인이 보내면: 다른 점장이 결재 알림을 받고, 사장님께는 '오늘 못 나와요'
  const g3 = shop();
  g3.sheet('매장').getRange(2, 8).setValue('박점장, 정하나');
  tgOn(g3, ['박점장', '정하나']);
  g3.setKst('2026-11-16 09:00');
  const r3 = off(g3, '박점장', '병가', '', '');
  assert.equal(r3.route, '점장');
  assert.equal(texts(g3, '정하나').length, 1);
  assert.match(texts(g3, '정하나')[0], /박점장 · 병가 요청/);
  assert.match(texts(g3, '사장님')[0], /박점장 오늘 못 나와요 \(병가\)[\s\S]*정하나 점장이 먼저 봐요/);
  assert.equal(sentTo(g3, '박점장').length, 0, '본인에게는 안 가요');
});

test('[오늘 못 나가요] 막는 경우, [늦어요]와 함께 쓸 때', () => {
  const g = shop();
  tgOn(g, ['박점장']);
  g.setKst('2026-11-16 09:00');
  assert.throws(() => off(g, '김민우', '휴무'), /병가·월차·무급·기타 가운데 골라주세요/);
  assert.throws(() => off(g, '김민우', '반차'), /병가·월차·무급/);
  assert.throws(() => off(g, '김민우', '병가', '', PHONE.정하나), /등록된 폰/);
  assert.throws(() => off(g, '김민우', '병가', '', PHONE.김민우, '1111'), /비밀번호가 틀렸어요/);
  assert.equal(reqRows(g).length, 0);
  // 출근을 찍은 뒤에는 안 돼요
  g.setKst('2026-11-16 09:58');
  punch(g, '정하나');
  assert.throws(() => off(g, '정하나', '병가'), /오늘은 이미 09:58에 출근을 찍었어요\. 일찍 가야 하면 점장님께 말씀해 주세요\./);
  // 쉬는 날
  g.setKst('2026-11-22 09:00');
  assert.throws(() => off(g, '김민우', '병가'), /오늘은 근무 예정이 없어요/);
  // 같은 날 두 번은 [휴무 신청]처럼 막혀요
  g.setKst('2026-11-17 09:00');
  off(g, '김민우', '병가');
  assert.throws(() => off(g, '김민우', '월차'), /11\/17은 이미 병가 요청이 있어요/);
  // 쉰다고 보낸 날은 [늦어요]를 안 받아요
  assert.throws(() => late(g, '김민우', 20), /오늘 쉬겠다는 요청을 이미 보냈어요/);
  // 늦는다고 했다가 못 나오게 되면 [오늘 못 나가요]는 돼요(그 뒤로는 미출근 알림 없음)
  late(g, '정하나', 10, '병원');
  off(g, '정하나', '병가', '병원 진료가 길어져요');
  g.setKst('2026-11-17 10:30');
  g.gs.checkMissing();
  assert.ok(!missingFor(g, '사장님').some((t) => /정하나|김민우/.test(t)));
});

test('대타도 구할까요?: 오늘은 병가와 대타를 같이 보낼 수 있고, 어느 쪽을 먼저 승인해도 휴무표에는 병가가 남아요', () => {
  const g = shop();
  tgOn(g, ['정하나']);
  g.setKst('2026-11-16 08:30');
  off(g, '김민우', '병가', '몸살');
  const sw = req(g, '김민우', 'swap', { date: '2026-11-16', reason: '병가' }); // 화면이 [대타 구하기]를 오늘 날짜로 열어요
  assert.ok(sw.mine.some((x) => x.kind === '대타' && x.date === '2026-11-16'));
  assert.match(texts(g, '정하나').at(-1), /동료가 대타를 구해요/);
  const rows = reqRows(g);
  const sick = rows.find((x) => x[3] === '병가')[0], swap = rows.find((x) => x[3] === '대타')[0];
  g.gs.takeSwap('정하나', PINS.정하나, swap);
  g.gs.adminRequest(ADMIN, sick, true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가');
  g.gs.adminRequest(ADMIN, swap, true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가', '대타가 승인돼도 병가 칸은 그대로');
  assert.match(mark(g, '정하나', '2026-11-16'), /^대타/);

  // 대타를 먼저 승인해도 병가를 승인하면 병가
  const g2 = shop();
  g2.setKst('2026-11-16 08:30');
  off(g2, '김민우', '병가');
  req(g2, '김민우', 'swap', { date: '2026-11-16' });
  const rows2 = reqRows(g2);
  const swap2 = rows2.find((x) => x[3] === '대타')[0];
  g2.gs.takeSwap('정하나', PINS.정하나, swap2);
  g2.gs.adminRequest(ADMIN, swap2, true);
  assert.equal(mark(g2, '김민우', '2026-11-16'), '휴무');
  g2.gs.adminRequest(ADMIN, rows2.find((x) => x[3] === '병가')[0], true);
  assert.equal(mark(g2, '김민우', '2026-11-16'), '병가');

  // 대타를 먼저 올렸다가 아파서 [오늘 못 나가요]도 돼요
  const g3 = shop();
  g3.setKst('2026-11-16 08:30');
  req(g3, '정하나', 'swap', { date: '2026-11-16' });
  assert.equal(off(g3, '정하나', '월차').kind, '월차');
  // 반차, 오늘이 아닌 날은 예전처럼 같이 못 보내요
  req(g3, '김민우', 'swap', { date: '2026-11-16' });
  assert.throws(() => req(g3, '김민우', 'off', { offType: '반차', date: '2026-11-16', reason: 'x' }), /11\/16은 이미 대타 요청이 있어요/);
  req(g3, '김민우', 'off', { offType: '병가', date: '2026-11-18', reason: '병원' });
  assert.throws(() => req(g3, '김민우', 'swap', { date: '2026-11-18' }), /11\/18은 이미 병가 요청이 있어요/);
});

test('대타를 못 구했을 때: [오늘 못 나가요]도 보낸 사람에게는 "원래대로 출근" 안내를 빼요', () => {
  const g = shop();
  tgOn(g, ['김민우', '정하나']);
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '몸살');
  req(g, '김민우', 'swap', { date: '2026-11-16' });
  req(g, '정하나', 'swap', { date: '2026-11-16' });
  g.setKst('2026-11-16 09:05');
  g.gs.checkMissing();
  const mine = texts(g, '김민우').find((t) => /대타를 아직 못 구했어요/.test(t));
  assert.ok(mine);
  assert.doesNotMatch(mine, /원래대로 출근/);
  assert.match(mine, /점장님이나 동료에게 직접 부탁해 보세요/);
  assert.match(texts(g, '정하나').find((t) => /대타를 아직 못 구했어요/.test(t)), /못 구하면 그날은 원래대로 출근해야 해요/, '쉰다는 요청이 없는 사람은 그대로');
});

test('대신 찍기에도 "미리 알림"이 남고, [늦어요] 기록은 3일 뒤 지워지고, 안 오면 밤 마감은 평소처럼 결근?', () => {
  const g = shop();
  tgOn(g, ['박점장']);
  g.setKst('2026-11-16 09:30');
  late(g, '김민우', 20);
  late(g, '정하나', 30, '병원');
  g.setKst('2026-11-16 10:25');
  g.gs.proxyPunch({ name: '박점장', pin: PINS.박점장 }, '김민우', 'in', '폰 방전');
  assert.match(logRow(g, '김민우', '2026-11-16')[13], /미리 알림: 20분/);
  assert.match(logRow(g, '김민우', '2026-11-16')[13], /박점장 점장이 대신 찍음: 폰 방전/);
  // 정하나는 늦는다고 하고 끝내 안 옴 → 밤 마감이 평소처럼 '결근?'
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '정하나', '2026-11-16'), '결근?');
  assert.ok(prop(g, 'dm:2026-11-16:late:김민우'));
  g.setKst('2026-11-20 10:00');
  g.gs.checkMissing();
  assert.equal(prop(g, 'dm:2026-11-16:late:김민우'), null, '날짜가 지나고 3일 뒤 지워져요');
  assert.equal(prop(g, 'dm:2026-11-16:late:정하나'), null);
});
