// 8개 기능을 합친 뒤 검토에서 찾은 문제(서로 부딪히는 곳) 고침 확인
// 실행: node --test test/fix-review.test.js
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

const idOf = (g, kind, date) => { const r = reqRows(g).filter((x) => x[3] === kind && x[4] === date).at(-1); return r && r[0]; };
const stateOf = (g, kind, date) => { const r = reqRows(g).filter((x) => x[3] === kind && x[4] === date).at(-1); return r && r[7]; };
const card = (g, id) => plain(g.gs.adminToday(ADMIN)).requests.find((x) => x.id === id);
const usedOn = (g, name, date) => { g.gs.MEMO_ = {}; return g.gs.subRows_().filter((x) => x.name === name && x.date === date && /사용/.test(x.kind)).reduce((a, x) => a + x.days, 0); };

/* ───── 요청·결재 ───── */

test('퇴사 신청을 마지막 근무일 뒤에 승인해도, 그날까지의 요청은 지우지 않고 사장님이 처리하게 둬요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'quit', { date: '2026-11-18', reason: '이사', to: 'admin' });
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-17', reason: '병원' });
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-20', reason: '병원' }); // 마지막 근무일 뒤
  req(g, '정하나', 'swap', { date: '2026-11-17' });
  g.gs.takeSwap('김민우', PINS.김민우, idOf(g, '대타', '2026-11-17')); // 김민우가 11/17 정하나 대타를 맡았어요(그날 일했어요)
  g.setKst('2026-11-19 10:00');
  const out = plain(g.gs.adminRequest(ADMIN, idOf(g, '퇴사', '2026-11-18'), true));
  assert.match(out.doneNote, /퇴사 처리했어요\(마지막 근무일 11\/18\(수\)\)/, '승인하면 한 일이 사장님 화면에 보여요');
  assert.match(out.doneNote, /마지막 근무일까지의 요청 2건은 그대로 뒀어요/);
  assert.match(out.doneNote, /기다리던 요청 1건을 취소했어요/);
  assert.doesNotMatch(out.doneNote, /다시 구하는 중/);
  assert.equal(stateOf(g, '퇴사', '2026-11-18'), '승인');
  assert.equal(stateOf(g, '휴무', '2026-11-17'), '대기', '쉰 날의 요청은 그대로');
  assert.equal(stateOf(g, '휴무', '2026-11-20'), '취소', '마지막 근무일 뒤 요청은 취소');
  assert.equal(stateOf(g, '대타', '2026-11-17'), '수락', '이미 일한 대타는 다시 구하지 않아요');
  g.gs.adminRequest(ADMIN, idOf(g, '휴무', '2026-11-17'), true);
  assert.equal(mark(g, '김민우', '2026-11-17'), '휴무');
  g.gs.adminRequest(ADMIN, idOf(g, '대타', '2026-11-17'), true);
  assert.equal(mark(g, '정하나', '2026-11-17'), '휴무');
});

test('퇴사 예정이면 마지막 근무일 뒤 날짜로는 요청·대타를 못 하고, 이미 맡은 대타는 미리 알려요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '정하나', 'swap', { date: '2026-11-20' });
  const swapId = idOf(g, '대타', '2026-11-20');
  g.gs.takeSwap('김민우', PINS.김민우, swapId); // 퇴사 예정 전에 맡았어요
  const c = plain(g.gs.adminRetire(ADMIN, '김민우', '2026-11-18', '자진 퇴사'));
  assert.match(JSON.stringify(c), /그 뒤에 맡기로 한 대타가 있어요\(11\/20\(금\) 정하나 님 대신\)/);
  assert.throws(() => req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-19', reason: '병원' }), /마지막 근무일\(2026-11-18\) 뒤 날짜예요/);
  req(g, '김민우', 'off', { offType: '휴가', date: '2026-11-17', dateTo: '2026-11-20', reason: '여행' });
  assert.deepEqual(reqRows(g).filter((x) => x[3] === '휴가').map((x) => x[4]), ['2026-11-17', '2026-11-18'], '여러 날 묶음은 마지막 근무일까지만');
  assert.ok(req(g, '김민우', 'fix', { date: '2026-11-13', type: 'out', time: '20:05', reason: '깜빡' }), '정정은 돼요');
  // 마지막 근무일 뒤 동료 대타는 안 보이고, 받을 수도 없어요
  req(g, '박점장', 'swap', { date: '2026-11-19' });
  const id2 = idOf(g, '대타', '2026-11-19');
  assert.ok(!plain(g.gs.reqsFor_('김민우')).swaps.some((x) => x.id === id2));
  assert.ok(plain(g.gs.reqsFor_('정하나')).swaps.some((x) => x.id === id2), '다른 동료에게는 보여요');
  assert.throws(() => g.gs.takeSwap('김민우', PINS.김민우, id2), /마지막 근무일\(2026-11-18\) 뒤 날짜라서 대타를 할 수 없어요/);
  // 이미 맡은 대타: 카드에 알리고, 승인은 안 돼요
  assert.match(card(g, swapId).note, /김민우 님은 11\/18\(수\)까지 근무해요\(퇴사 예정\)/);
  assert.throws(() => g.gs.adminRequest(ADMIN, swapId, true), /11\/18\(수\)까지 근무해서\(퇴사 예정\) 11\/20\(금\) 대타를 할 수 없어요/);
  assert.equal(stateOf(g, '대타', '2026-11-20'), '수락');
});

test('대타를 맡은 동료가 그날 병가를 받았으면 대타는 승인하지 않아요(병가가 지워지지 않게)', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'swap', { date: '2026-11-18' });
  const swapId = idOf(g, '대타', '2026-11-18');
  g.gs.takeSwap('정하나', PINS.정하나, swapId);
  g.setKst('2026-11-18 08:00');
  off(g, '정하나', '병가', '몸살');
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-18'), true);
  assert.equal(mark(g, '정하나', '2026-11-18'), '병가');
  assert.match(card(g, swapId).note, /정하나 님은 그날 휴무표에 "병가"\(으\)로 쉬는 날이라 승인할 수 없어요/);
  assert.throws(() => g.gs.adminRequest(ADMIN, swapId, true), /정하나 님은 그날 휴무표에 "병가"/);
  assert.equal(mark(g, '정하나', '2026-11-18'), '병가', '병가 그대로');
  assert.equal(mark(g, '김민우', '2026-11-18'), '', '요청한 사람도 그대로');
  g.gs.adminRequest(ADMIN, swapId, false);
  assert.equal(stateOf(g, '대타', '2026-11-18'), '거절');
});

test('아침에 [오늘 못 나가요]를 보내고 출근했으면 그 병가·대타는 승인하지 않아요(일한 날·지각이 지워지지 않게)', () => {
  const g = shop();
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '');
  const sick = idOf(g, '병가', '2026-11-16');
  req(g, '김민우', 'swap', { date: '2026-11-16' }); // 오늘은 병가와 대타를 같이 보낼 수 있어요
  const swapId = idOf(g, '대타', '2026-11-16');
  g.gs.takeSwap('정하나', PINS.정하나, swapId);
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우');
  g.setKst('2026-11-16 12:00');
  assert.match(card(g, sick).note, /그날 10:05에 출근했어요/);
  assert.match(card(g, swapId).note, /그날 10:05에 출근했어요/);
  assert.throws(() => g.gs.adminRequest(ADMIN, sick, true), /11\/16\(월\) 10:05에 이미 출근했어요/);
  assert.throws(() => g.gs.adminRequest(ADMIN, swapId, true), /김민우 님이 11\/16\(월\) 10:05에 이미 출근했어요/);
  assert.equal(stateOf(g, '병가', '2026-11-16'), '대기');
  assert.equal(g.gs.punchedIn_('2026-11-16', '김민우'), '10:05', '출근 기록 그대로');
  assert.notEqual(mark(g, '김민우', '2026-11-16'), '병가');
  // 반차는 출근한 날에도 승인돼요
  req(g, '정하나', 'off', { offType: '반차', date: '2026-11-17', reason: '병원' });
  g.setKst('2026-11-17 10:00');
  punch(g, '정하나');
  g.gs.adminRequest(ADMIN, idOf(g, '반차', '2026-11-17'), true);
  assert.equal(mark(g, '정하나', '2026-11-17'), '반차');
});

test('[근무표]에서 먼저 대체로 바꾼 날의 대체휴무 요청을 승인해도 두 번 빼지 않아요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.addSub_('2026-11-14', '김민우', '적립', 2, '휴무날 출근');
  req(g, '김민우', 'off', { offType: '대체', date: '2026-11-18', reason: '개인 사정' });
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-19', reason: '개인 사정' });
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 18, '대체');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 19, '대체');
  assert.equal(usedOn(g, '김민우', '2026-11-18'), 1);
  g.gs.adminRequest(ADMIN, idOf(g, '대체', '2026-11-18'), true);
  assert.equal(usedOn(g, '김민우', '2026-11-18'), 1, '한 번만 빼요');
  g.gs.adminRequest(ADMIN, idOf(g, '휴무', '2026-11-19'), true); // 대체였던 칸을 휴무로 승인하면 대체 사용을 되돌려요
  assert.equal(mark(g, '김민우', '2026-11-19'), '휴무');
  assert.equal(usedOn(g, '김민우', '2026-11-19'), 0);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.subBalance_('김민우').left, 1);
  // 손으로 대체라고 적어 둔 칸(장부 없음)은 승인하면 1을 빼요
  req(g, '김민우', 'off', { offType: '대체', date: '2026-11-20', reason: '개인 사정' });
  g.gs.setMark_('2026-11-20', '김민우', () => '대체');
  g.gs.adminRequest(ADMIN, idOf(g, '대체', '2026-11-20'), true);
  assert.equal(usedOn(g, '김민우', '2026-11-20'), 1);
});

test('[오늘 못 나가요] 병가와 아무도 안 받은 대타를 같이 보냈다가 병가가 거절되면 결근?이 적혀요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:30');
  off(g, '김민우', '병가', '');
  req(g, '김민우', 'swap', { date: '2026-11-16' });
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '', '밤 마감은 병가 결과를 기다려요');
  g.setKst('2026-11-17 09:00');
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-16'), false);
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?', '아무도 안 받은 대타는 기다리지 않아요');
});

test('관리자에게 바로 보낸 퇴사 신청: 점장 [월별]에도 안 보이고, 카드에 틀린 휴무표 안내가 안 나와요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'quit', { date: '2026-11-16', reason: '이직', to: 'admin' });
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?', '퇴사 신청만 해 두고 안 나온 날');
  g.setKst('2026-11-17 09:00');
  const mi = plain(g.gs.adminIssues({ name: '박점장', pin: PINS.박점장 }, ''));
  const row = mi.absent.find((x) => x.name === '김민우' && x.date === '2026-11-16');
  assert.ok(row, '결근?은 점장도 봐요');
  assert.equal(row.asked, '', '관리자에게 바로 보낸 퇴사 신청은 점장에게 안 알려요');
  const ai = plain(g.gs.adminIssues(ADMIN, ''));
  assert.match(ai.absent.find((x) => x.name === '김민우' && x.date === '2026-11-16').asked, /퇴사/);
  const c = card(g, idOf(g, '퇴사', '2026-11-16'));
  assert.equal(c.mark, '', '퇴사 신청은 휴무표 칸을 바꾸지 않아요');
  assert.equal(c.past, true, '"이미 지난 날짜예요"가 보여요');
});

test('동료가 내 이름으로 비밀번호를 5번 틀려도, 등록된 내 폰으로는 요청·[오늘 못 나가요]를 보낼 수 있어요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:30');
  for (let i = 0; i < 5; i++) {
    assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: '1111', kind: 'off', offType: '휴무', date: '2026-11-20', reason: 'x' }), /비밀번호가 틀렸어요/);
  }
  assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: PINS.김민우, kind: 'off', offType: '휴무', date: '2026-11-20', reason: 'x' }), /잠깐|10분/, '폰을 안 밝히면 이름 잠금');
  off(g, '김민우', '병가', '몸살');
  assert.equal(stateOf(g, '병가', '2026-11-16'), '대기');
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-20', reason: '병원', device: PHONE.김민우 });
  assert.equal(stateOf(g, '휴무', '2026-11-20'), '대기');
  assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: PINS.김민우, kind: 'off', offType: '휴무', date: '2026-11-19', reason: 'x', device: PHONE.정하나 }), /잠깐|10분/, '남의 폰은 이름 잠금 그대로');
});

test('[오늘 못 나가요] 병가가 먼저 승인돼도 오늘 대타를 구할 수 있어요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '');
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-16'), true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가');
  req(g, '김민우', 'swap', { date: '2026-11-16' });
  const row = reqRows(g).find((x) => x[3] === '대타' && x[4] === '2026-11-16');
  assert.equal(row[5], '10:00-20:00', '병가 요청에 적어 둔 근무 시간');
  g.gs.takeSwap('정하나', PINS.정하나, row[0]);
  g.gs.adminRequest(ADMIN, row[0], true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가', '병가 칸 그대로');
  assert.equal(mark(g, '정하나', '2026-11-16'), '대타');
  assert.throws(() => req(g, '김민우', 'swap', { date: '2026-11-21' }), /원래 근무가 없는 날/, '원래 쉬는 날은 그대로 막혀요');
});

/* ───── 알림·출근 ───── */

const ownerMissing = (g) => texts(g, '사장님').filter((t) => /아직 출근 안 찍은 직원/.test(t));
const suspectRows = (g) => { const sh = g.sheet('의심기록'); const out = []; for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r)); return out; };
const hrHole = (g, name) => { g.gs.MEMO_ = {}; g.gs.hrWrite_(g.gs.hrFind_(name).row, { addr: '' }); g.gs.MEMO_ = {}; };
const hrPatch = (g, name) => { g.gs.MEMO_ = {}; g.gs.hrWrite_(g.gs.hrFind_(name).row, { addr: '서울 성동구' }); g.gs.MEMO_ = {}; };

test('점장 미출근 알림이 처음에 못 가면 점장에게만 다시 보내요(사장님·본인에게는 또 안 가요)', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.tg.blocked.push(CHAT.박점장);
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 1);
  assert.equal(missingFor(g, '김민우').length, 1);
  assert.equal(missingFor(g, '박점장').length, 0, '점장에게는 못 갔어요');
  g.tg.blocked.length = 0;
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(missingFor(g, '박점장').length, 1, '점장에게만 다시');
  assert.equal(ownerMissing(g).length, 1, '사장님께는 한 번');
  assert.equal(missingFor(g, '김민우').length, 1, '본인에게도 한 번');
  g.setKst('2026-11-16 10:30');
  g.gs.checkMissing();
  assert.equal(missingFor(g, '박점장').length, 1, '간 뒤에는 끝');
});

test('다른 매장 대타 날: 미출근·[늦어요] 알림은 그날 일하러 가는 매장 점장에게, 매장 이름도 그 매장으로', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '이지은']);
  g.setKst('2026-11-16 09:00');
  req(g, '정하나', 'swap', { date: '2026-11-17' });
  const id = idOf(g, '대타', '2026-11-17');
  g.gs.takeSwap('이지은', PINS.이지은, id); // 가산 직원이 왕십리 대타
  g.gs.adminRequest(ADMIN, id, true);
  assert.equal(mark(g, '이지은', '2026-11-17'), '대타 왕십리');
  g.setKst('2026-11-17 09:30');
  late(g, '이지은', 10, '지하철', 'bbbbbbbbbbbbbbbb');
  assert.match(texts(g, '박점장').at(-1), /\[왕십리\] 이지은 약 10분 늦어요 \(지하철\)/);
  assert.ok(!texts(g, '최유나').some((t) => /이지은/.test(t)), '가산 점장에게는 안 가요');
  g.setKst('2026-11-17 09:58');
  punch(g, '박점장');
  punch(g, '김민우');
  g.setKst('2026-11-17 10:25');
  g.gs.checkMissing();
  assert.ok(missingFor(g, '박점장').some((t) => /\[왕십리\] 이지은 \(출근 예정 10:00\)/.test(t)));
  assert.ok(!texts(g, '최유나').some((t) => /이지은/.test(t)));
  assert.ok(ownerMissing(g).some((t) => /\[왕십리\] 이지은/.test(t)));
});

test('미출근 알림이 간 뒤 [늦어요]를 누르면, 말한 시간 + 10분에 사장님·점장에게 한 번 더 알려요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 1);
  assert.equal(missingFor(g, '박점장').length, 1);
  g.setKst('2026-11-16 10:15');
  late(g, '김민우', 30, '버스');
  for (const at of ['10:20', '10:30']) {
    g.setKst('2026-11-16 ' + at);
    g.gs.checkMissing();
    assert.equal(ownerMissing(g).length, 1, at + ' 말한 시간까지 기다려요');
  }
  g.setKst('2026-11-16 10:40');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 2, '알림 글에 적은 대로 다시 알려요');
  assert.equal(missingFor(g, '박점장').length, 2);
  g.setKst('2026-11-16 10:50');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 2, '한 번만');
});

test('사장님이 [근무표]에서 오늘을 결근으로 정하면 미출근 알림도, 밤 마감 결근? 알림도 안 가요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:00');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 16, '결근');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 0);
  assert.equal(missingFor(g, '김민우').length, 0);
  assert.equal(missingFor(g, '박점장').length, 0);
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근', '결근? 으로 바꾸지 않아요');
  assert.ok(!texts(g, '김민우').some((t) => /결근\?'으로 적혔어요/.test(t)));
  assert.match(texts(g, '사장님').find((t) => /하루 마감 정리/.test(t)), /결근 \(사장님이 정함\)[\s\S]*김민우/);
});

test('매장에서 눌렀는데 인사 정보 때문에 막힌 사람: 출근 전 알림은 빼고, 미출근 알림에 처음 누른 시각을 알려요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  hrHole(g, '김민우');
  g.setKst('2026-11-16 09:41');
  assert.throws(() => punch(g, '김민우'), /인사 정보를 먼저/);
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)), '이미 매장에서 눌렀어요');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.match(missingFor(g, '김민우')[0], /아까 09:41에 누른 출근이 인사 정보 미입력에 막혔어요\. 10:41까지 인사 정보를 다 넣으면 09:41로 출근이 찍혀요\./);
  assert.match(ownerMissing(g)[0], /김민우 \(출근 예정 10:00 · 09:41 매장에서 눌렀는데 인사 정보 미입력에 막힘\)/);
  assert.match(missingFor(g, '박점장')[0], /09:41 매장에서 눌렀는데 인사 정보 미입력에 막힘/);
});

test('사장님이 인사 정보를 대신 채운 뒤 1시간 안에 그 폰으로 다시 누르면 처음 누른 시각으로 찍혀요', () => {
  const g = shop();
  hrHole(g, '김민우');
  g.setKst('2026-11-16 09:55');
  assert.throws(() => punch(g, '김민우'), /09:55\)은 기억해 둘게요/);
  g.setKst('2026-11-16 10:20');
  hrPatch(g, '김민우'); // 사장님이 인사 카드에서 주소를 채움
  g.setKst('2026-11-16 10:25');
  const r = plain(punch(g, '김민우'));
  assert.equal(logRow(g, '김민우', '2026-11-16')[5], '09:55', '처음 누른 시각');
  assert.equal(r.late, 0);
  assert.equal(r.time, '09:55', '화면에도 처음 누른 시각');
  assert.equal(r.first, 1);
  assert.match(logRow(g, '김민우', '2026-11-16')[13], /처음 누른 시각으로 적음\(인사 정보 미입력 · 막힌 게 풀린 뒤 10:25에 다시 누름\)/);
  assert.ok(suspectRows(g).some((x) => x[2] === '처음 누른 시각으로 적음' && /다시 눌러서 출근 09:55로 적음/.test(x[3])));
  assert.equal(prop(g, 'try:2026-11-16:김민우'), null, '쓴 기록은 지워요');
  // 1시간이 지나서 누르면 지금 시각
  hrHole(g, '정하나');
  g.setKst('2026-11-17 09:50');
  assert.throws(() => punch(g, '정하나'), /인사 정보를 먼저/);
  hrPatch(g, '정하나');
  g.setKst('2026-11-17 10:55');
  punch(g, '정하나');
  assert.equal(logRow(g, '정하나', '2026-11-17')[5], '10:55');
});

test('[오늘 못 나가요]: 점장에게 결재 알림이 못 갔으면 사장님께 한 통만 가요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.tg.blocked.push(CHAT.박점장);
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '몸살');
  const owner = texts(g, '사장님');
  assert.equal(owner.length, 1, '결재 알림(점장 확인 전) 한 통');
  assert.match(owner[0], /점장 확인 전/);
  assert.match(owner[0], /박점장 점장에게 텔레그램 알림이 안 가서 사장님께도 보내요/);
});

test('밤에는 자동 작업 실패 알림이 소리 없이 가고, 주민번호 열쇠 알림은 아침 7시 뒤에 가요', () => {
  const g = shop();
  tgOn(g, []);
  g.drive.fail = 'Drive 권한이 없어요';
  g.setKst('2026-11-16 03:10'); // 월요일 새벽 백업
  g.gs.checkMissing();
  const fail = sentTo(g, '사장님').filter((m) => /자동 작업을 못 했어요/.test(m.text));
  assert.equal(fail.length, 1);
  assert.match(fail[0].text, /\[주간 백업\]/);
  assert.equal(fail[0].disable_notification, true, '새벽이라 소리 없이');
  g.gs.PropertiesService.getScriptProperties().deleteProperty('hrKey'); // 주민번호 열쇠가 없어졌어요
  g.setKst('2026-11-17 00:10');
  g.gs.checkMissing();
  assert.ok(!texts(g, '사장님').some((t) => /주민번호 열쇠가 없어요/.test(t)), '자정에는 안 울려요');
  g.setKst('2026-11-17 07:10');
  g.gs.checkMissing();
  assert.equal(texts(g, '사장님').filter((t) => /주민번호 열쇠가 없어요/.test(t)).length, 1, '아침에 한 번');
});

test('앱 시작 전에는 대타·[늦어요] 알림에 "결근?으로 적혀요"·"미출근 알림이 가요"를 안 적어요', () => {
  const g = shop();
  g.gs.setSetting_('앱시작일', '');
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'swap', { date: '2026-11-17' });
  g.setKst('2026-11-16 09:30');
  late(g, '김민우', 20, '');
  assert.doesNotMatch(texts(g, '박점장').at(-1), /미출근 알림/);
  g.setKst('2026-11-16 18:10');
  g.gs.checkMissing();
  const m = texts(g, '김민우').find((t) => /대타를 아직 못 구했어요/.test(t));
  assert.ok(m);
  assert.doesNotMatch(m, /결근\?/);
  assert.match(m, /못 구하면 그날은 원래대로 출근해야 해요\./);
});

/* ───── 시트·인사·백업 ───── */

test('매주 백업은 사장님 것인 [출퇴근 백업] 폴더에만 넣어요(남이 같은 이름으로 공유한 폴더는 안 써요)', () => {
  const g = shop();
  const other = g.gs.DriveApp.createFolder('출퇴근 백업');
  g.drive.folders.find((x) => x.id === other.getId()).owner = 'someone@example.com'; // 다른 사람이 만들어 공유한 폴더
  g.setKst('2026-11-16 03:10');
  g.gs.checkMissing();
  const copy = g.drive.files.find((f) => /^출퇴근 백업 2026-11-16/.test(f.name));
  assert.ok(copy, '백업은 만들어요');
  assert.notEqual(copy.parent, other.getId(), '남의 폴더에는 안 넣어요');
  const mine = g.drive.folders.find((x) => x.id === copy.parent);
  assert.ok(mine && !mine.owner, '사장님 폴더를 새로 만들어요');
});

test('setup은 [인사] 탭에서 사장님이 붙인 칸의 서식을 바꾸지 않아요(앱 칸만 글자 서식)', () => {
  const g = shop();
  const sh = g.sheet('인사');
  const head = sh.rowDisplay(1);
  const v = head.indexOf('퇴사 사유') + 1; // 예전 [인사] 탭: 이 자리에 사장님이 '보건증 만료' 칸을 붙여 뒀어요
  sh.getRange(1, v).setValue('보건증 만료');
  sh.getRange(2, v, 5, 1).setNumberFormat('yyyy-mm-dd');
  g.gs.MEMO_ = {};
  g.gs.setup();
  assert.equal(sh.fmt(2, v), 'yyyy-mm-dd', '사장님 칸 서식 그대로');
  const nh = sh.rowDisplay(1);
  const r = nh.indexOf('퇴사 사유') + 1;
  assert.ok(r > v, '퇴사 사유 칸은 오른쪽에 새로 붙어요');
  assert.equal(sh.fmt(2, r), '@');
  assert.equal(sh.fmt(2, nh.indexOf('휴대폰') + 1), '@', '앱 칸은 글자 서식');
});

test('[근무표]에서 승인된 대타 칸·휴직 칸은 지우기만 할 수 없어요(쉬는 말은 고를 수 있어요)', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '정하나', 'swap', { date: '2026-11-18' });
  const id = idOf(g, '대타', '2026-11-18');
  g.gs.takeSwap('김민우', PINS.김민우, id);
  g.gs.adminRequest(ADMIN, id, true);
  assert.equal(mark(g, '김민우', '2026-11-18'), '대타');
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 18, ''), /승인된 대타 날이에요\(10:00-20:00 근무\)/);
  assert.equal(mark(g, '김민우', '2026-11-18'), '대타');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 18, '휴무');
  assert.equal(mark(g, '김민우', '2026-11-18'), '휴무', '쉬는 말은 돼요');
  g.gs.adminAway(ADMIN, '이지은', '2026-11-23', '2026-11-27', '병가');
  g.gs.MEMO_ = {};
  assert.equal(mark(g, '이지은', '2026-11-24'), '휴직');
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '이지은', 24, ''), /휴직 기간이라 칸을 지워도/);
});

test('근로자 명부: 입사일을 고친 뒤 다시 만들어도 적어 둔 계약 기간이 남아요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminRoster(ADMIN);
  const sh = g.sheet('근로자 명부');
  const find = (n) => { for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === n) return r; return 0; };
  const cT = sh.rowDisplay(2).indexOf('계약 기간') + 1;
  sh.getRange(find('김민우'), cT).setValue('2026-03-02 ~ 2027-03-01');
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { start: '2020-01-02' }); // 입사일 고침
  g.gs.MEMO_ = {};
  const out = plain(g.gs.adminRoster(ADMIN));
  assert.equal(sh.rowDisplay(find('김민우'))[cT - 1], '2026-03-02 ~ 2027-03-01');
  assert.equal(sh.rowDisplay(find('김민우'))[6], '2020-01-02');
  assert.ok(!out.warn.some((w) => /계약 기간을 옮기지 못한/.test(w)));
});

test('지점 이동을 예약해 두면, 그날부터 매장 인원은 새 지점으로 세요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-25');
  g.gs.MEMO_ = {};
  const before = plain(g.gs.staffOn_('가산', '2026-11-24'));
  const after = plain(g.gs.staffOn_('가산', '2026-11-26'));
  assert.ok(!before.work.includes('김민우'), '이동 전날은 왕십리');
  assert.ok(after.work.includes('김민우'), '이동한 뒤에는 가산에서 세요');
  assert.ok(!plain(g.gs.staffOn_('왕십리', '2026-11-26')).work.includes('김민우'));
  assert.ok(!plain(g.gs.staffOn_('왕십리', '2026-11-26')).off.some((x) => x.name === '김민우'), '왕십리 쉬는 사람에도 안 들어가요');
});

/* ───── 마지막 검사 ───── */

test('지점 이동을 예약한 사람: 그날 다른 매장 대타에 "그날 내 근무"가 보여요(새 지점 기준)', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminMove(ADMIN, '이지은', '왕십리', '2026-11-19'); // 가산 → 왕십리(11/19부터)
  req(g, '최유나', 'swap', { date: '2026-11-20' }); // 가산 대타
  const v = plain(g.gs.reqsFor_('이지은')).swaps.find((x) => x.id === idOf(g, '대타', '2026-11-20'));
  assert.ok(v && v.clash, '그날은 왕십리 근무가 있어요');
  assert.equal(v.clash.store, '왕십리');
});

test('예약한 지점 이동: [매장]에 없는 지점이거나 오늘 날짜면 지금 지점으로 세요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-18');
  g.sheet('매장').getRange(3, 1).setValue('가산디지털'); // 가산 이름을 바꿈(옮길 수 없어요)
  g.gs.MEMO_ = {};
  assert.equal(plain(g.gs.workAt_(g.gs.findStaff_('김민우'), '2026-11-19')).at, '왕십리');
  const g2 = shop();
  g2.setKst('2026-11-16 09:00');
  g2.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-17');
  g2.setKst('2026-11-17 09:00'); // 새벽에 옮기기 전(10분 검사가 아직 안 돎)
  g2.gs.MEMO_ = {};
  assert.equal(plain(g2.gs.workAt_(g2.gs.findStaff_('김민우'), '2026-11-17')).at, '왕십리', '오늘은 지금 지점');
  assert.equal(plain(g2.gs.workAt_(g2.gs.findStaff_('김민우'), '2026-11-18')).at, '가산');
});

test('근로자 명부: 다시 입사한 사람에게는 예전 계약 기간을 옮기지 않고 알려요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminRetire(ADMIN, '정하나', '2026-11-10', '계약 만료');
  g.gs.adminRoster(ADMIN);
  const sh = g.sheet('근로자 명부');
  const find = (n) => { for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === n) return r; return 0; };
  const cT = sh.rowDisplay(2).indexOf('계약 기간') + 1;
  sh.getRange(find('정하나'), cT).setValue('2020-01-01 ~ 2026-11-10');
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('정하나').row, { state: '근무', end: '', start: '2026-11-20' }); // 다시 입사
  g.gs.MEMO_ = {};
  const out = plain(g.gs.adminRoster(ADMIN));
  assert.equal(sh.rowDisplay(find('정하나'))[cT - 1], '', '예전 계약 기간은 안 옮겨요');
  assert.ok(out.warn.some((w) => /계약 기간을 옮기지 못한 사람.*정하나/.test(w)));
});

test('사장님이 인사 정보를 이미 채웠으면 미출근 알림이 "다시 누르면 그 시각으로"라고 알려요', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  hrHole(g, '김민우');
  g.setKst('2026-11-16 09:41');
  assert.throws(() => punch(g, '김민우'), /인사 정보를 먼저/);
  g.setKst('2026-11-16 09:50');
  hrPatch(g, '김민우');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.match(missingFor(g, '김민우')[0], /이제 인사 정보가 다 채워졌어요\. 10:41까지 그 폰으로 출근을 다시 누르면 09:41로 찍혀요\./);
});

test('오늘 대타 근무 시간 빌려 오기는 [오늘 못 나가요]만: 미리 받은 휴무 날에는 대타를 못 올려요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-18', reason: '개인 사정' });
  g.gs.adminRequest(ADMIN, idOf(g, '휴무', '2026-11-18'), true);
  g.setKst('2026-11-18 08:00');
  assert.throws(() => req(g, '김민우', 'swap', { date: '2026-11-18' }), /원래 근무가 없는 날/);
});

test('퇴사 예정: 출근하는 날이 마지막 근무일 뒤인 휴무 바꾸기는 승인하지 않아요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'move', { date: '2026-11-18', dateFrom: '2026-11-21', reason: '개인 사정' }); // 수 쉬고 토 출근
  const id = idOf(g, '바꾸기', '2026-11-18');
  g.gs.adminRetire(ADMIN, '김민우', '2026-11-20', '자진 퇴사');
  assert.match(card(g, id).note, /11\/20\(금\)까지 근무해요\(퇴사 예정\)/);
  assert.throws(() => g.gs.adminRequest(ADMIN, id, true), /11\/20\(금\)까지 근무해요\(퇴사 예정\)/);
  assert.equal(mark(g, '김민우', '2026-11-18'), '');
});

test('예전 버전이 기억해 둔 남의 [출퇴근 백업] 폴더는 버리고 사장님 폴더에 백업해요', () => {
  const g = shop();
  const other = g.gs.DriveApp.createFolder('출퇴근 백업');
  g.drive.folders.find((x) => x.id === other.getId()).owner = 'someone@example.com';
  g.gs.PropertiesService.getScriptProperties().setProperty('backup:folder', other.getId());
  g.setKst('2026-11-16 03:10');
  g.gs.checkMissing();
  const copy = g.drive.files.find((f) => /^출퇴근 백업 2026-11-16/.test(f.name));
  assert.ok(copy);
  assert.notEqual(copy.parent, other.getId());
  assert.notEqual(prop(g, 'backup:folder'), other.getId(), '새 폴더를 기억해요');
});

test('동료가 내 이름으로 비밀번호를 5번 틀려도, 내 폰으로는 요청 취소·대타 받기를 할 수 있어요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:30');
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-20', reason: '병원', device: PHONE.김민우 });
  req(g, '정하나', 'swap', { date: '2026-11-19' });
  for (let i = 0; i < 5; i++) assert.throws(() => g.gs.takeSwap('김민우', '1111', idOf(g, '대타', '2026-11-19')), /비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.cancelRequest('김민우', PINS.김민우, idOf(g, '휴무', '2026-11-20')), /잠깐|10분/, '폰을 안 밝히면 이름 잠금');
  g.gs.cancelRequest('김민우', PINS.김민우, idOf(g, '휴무', '2026-11-20'), PHONE.김민우);
  assert.equal(stateOf(g, '휴무', '2026-11-20'), '취소');
  g.gs.takeSwap('김민우', PINS.김민우, idOf(g, '대타', '2026-11-19'), PHONE.김민우);
  assert.equal(stateOf(g, '대타', '2026-11-19'), '수락');
});

test('[오늘 못 나가요]가 아무에게도 안 갔으면(텔레그램·메일 연결 전) 화면에서 전화하라고 알려요', () => {
  const g = shop();
  g.gs.setSetting_('알림이메일', '');
  g.setKst('2026-11-16 08:00');
  assert.equal(plain(off(g, '김민우', '병가', '')).nobody, true);
  const g2 = shop(); // 메일이 연결돼 있으면 사장님께 가요
  g2.setKst('2026-11-16 08:00');
  assert.equal(plain(off(g2, '김민우', '병가', '')).nobody, false);
});

/* ───── 사장님 요청: 퇴근은 안 찍어도 알림 없음, 휴무표 탭 이름은 26.11처럼 짧게 ───── */

test('[설정] 퇴근확인 기본 안함: 퇴근을 안 찍어도 알림·안내·밤 정리 목록·[월별] 확인할 것에 안 나와요', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  assert.equal(g.gs.settings_().outCheck, '안함');
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우');
  for (const at of ['20:15', '20:40']) { g.setKst('2026-11-16 ' + at); g.gs.checkMissing(); }
  assert.ok(!texts(g, '김민우').some((t) => /퇴근을 (아직 )?안 찍었어요/.test(t)), '본인 알림 없음');
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /퇴근을 (아직 )?안 찍었어요/.test(t)), '밤 알림도 없음');
  assert.doesNotMatch(texts(g, '사장님').find((t) => /하루 마감 정리/.test(t)) || '', /퇴근 안 찍음/);
  g.setKst('2026-11-17 09:00');
  assert.equal(plain(g.gs.getHome('김민우', PINS.김민우)).missingOut, null, '직원 화면 "퇴근 누락" 안내 없음');
  assert.deepEqual(plain(g.gs.adminIssues(ADMIN, '')).noOut, [], '[월별] 확인할 것에도 없음');
  // 켜면 예전처럼
  g.gs.setSetting_('퇴근확인', '함');
  g.gs.MEMO_ = {};
  assert.ok(plain(g.gs.getHome('김민우', PINS.김민우)).missingOut);
  assert.equal(plain(g.gs.adminIssues(ADMIN, '')).noOut.length, 1);
});

test('휴무표 탭 이름은 26.11처럼 짧게 만들고, 예전 이름(휴무표 2026-11) 탭은 setup·10분 검사가 바꿔요', () => {
  const g = shop();
  assert.ok(g.sheet('26.11'), '새 이름');
  assert.equal(g.sheet('휴무표 2026-11'), null);
  assert.equal(g.gs.monthName_('2027-01'), '27.01');
  assert.equal(g.gs.tabYm_('26.11'), '2026-11');
  assert.equal(g.gs.tabYm_('휴무표 2026-11'), '2026-11');
  assert.equal(g.gs.tabYm_('26.13'), '');
  assert.equal(g.gs.tabYm_('설정'), '');
  // 예전 버전이 만든 탭: 이름이 바뀌기 전에도 그대로 읽고 써요
  g.sheet('26.11').setName('휴무표 2026-11');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {}; g.gs.RENAMED_ = false;
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 20, '휴무');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-11-20'), '휴무', '예전 이름 탭에 적혀요');
  assert.ok(g.sheet('휴무표 2026-11'), '아직 안 바꿨어요');
  g.setKst('2026-11-16 10:00');
  g.gs.checkMissing(); // 10분 검사가 바꿔요
  assert.ok(g.sheet('26.11'));
  assert.equal(g.sheet('휴무표 2026-11'), null);
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-11-20'), '휴무', '기록은 그대로');
  // setup도 바꿔요
  g.sheet('26.11').setName('휴무표 2026-11');
  g.gs.RENAMED_ = false;
  g.gs.setup();
  assert.ok(g.sheet('26.11'));
  assert.equal(g.book.getSheets().filter((x) => /^휴무표 /.test(x.getName())).length, 0, '예전 이름 탭이 하나도 안 남아요');
});
