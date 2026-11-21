// 점장 알림: 우리 매장 미출근·인사 소식을 그 매장 점장 텔레그램으로
// 실행: node --test test/f1-manager-alerts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const PIN = '582941';
const TOKEN = '123456789:' + 'A'.repeat(35);
const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 };
const PHONE = {
  김민우: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박점장: 'eeeeeeeeeeeeeeee', 최유나: 'ffffffffffffffff', 오사무: 'gggggggggggggggg',
};
const PINS = { 김민우: '0123', 이지은: '5678', 박점장: '246813', 최유나: '135790', 오사무: '864200' };
const ROW = { 김민우: 2, 이지은: 3, 박점장: 4, 최유나: 5, 오사무: 6 };
// 텔레그램 채팅 번호: 사장님 555, 직원은 아래
const CHAT = { 사장님: '555', 김민우: '9002', 이지은: '9003', 박점장: '9005', 최유나: '9006', 오사무: '9007' };

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
// 매장: 왕십리(10:00-20:00, 점장 박점장) · 가산(12:00-21:00, 점장 최유나) · 사무실(09:00-18:00, 점장 오사무)
// 김민우(왕십리, 토·일 휴무) · 이지은(가산, 수·일 휴무) · 박퇴사(왕십리, 퇴사)
function shop() {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 3, 8).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', '', '박점장'],
    ['가산', '12:00', '21:00', '', '', '', '', '최유나'],
    ['사무실', '09:00', '18:00', '', '', '', '', '오사무'],
  ]);
  //            이름      매장      PIN       시급   월  화  수      목  금  토      일      재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 6, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '135790', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['오사무', '사무실', '864200', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  g.gs.setSetting_('관리자PIN', PIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  g.gs.adminSetPlace(PIN, '왕십리', STORE.lat, STORE.lng);
  g.gs.setup(); // 새 직원 줄을 휴무표에
  hrFill(g);
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
// 점장이 받은 미출근 알림만(본인에게 가는 '아직 출근을 안 찍었어요'는 빼요)
const lateFor = (g, who) => texts(g, who).filter((t) => /아직 출근 안 찍은 직원/.test(t));
const punch = (g, name, type = 'in') =>
  g.gs.punch({ name, pin: PINS[name], type, lat: NEAR.lat, lng: NEAR.lng, acc: NEAR.acc, device: PHONE[name], label: 'iPhone 사파리', agree: true });
const setting = (g, key) => {
  const sh = g.sheet('설정');
  for (let r = 2; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === key) return { row: r, value: sh.rowDisplay(r)[1] };
  return null;
};
const NEWPHONE = '1111222233334444';
const joinForm = (over = {}) => ({
  name: '한신입', rrn: '950101-1928374', phone: '01012345678', addr: '서울 성동구 왕십리로 1', bank: '국민',
  account: '123456-78-901234', holder: '', emergency: '010-9999-8888 어머니', store: '왕십리', start: '2026-11-16',
  pin: '4826', device: NEWPHONE, label: 'Galaxy 크롬', agree: true, agreeLoc: true, ...over,
});

test('미출근: 그 매장 점장에게 그 매장 사람만(이름·출근 예정 시간), 다음 10분 검사에서 또 보내지 않아요', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '오사무']);
  g.setKst('2026-11-16 08:58');
  punch(g, '오사무');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  const m = sentTo(g, '박점장');
  assert.equal(m.length, 1);
  assert.equal(m[0].text, '[굳폰] 아직 출근 안 찍은 직원 1명\n11/16(월) 10:15 기준\n[왕십리] 김민우 (출근 예정 10:00)\n출근했는지 확인해 주세요.');
  assert.equal(m[0].disable_notification, false, '미출근은 바로 확인할 일이라 소리 나게');
  assert.equal(sentTo(g, '최유나').length, 0, '가산 점장은 왕십리 사람을 안 받아요');
  assert.equal(sentTo(g, '오사무').length, 0, '사무실 점장도 안 받아요');
  assert.match(texts(g, '사장님').at(-1), /아직 출근 안 찍은 직원 1명[\s\S]*\[왕십리\] 김민우 \(출근 예정 10:00\)/, '사장님 알림은 그대로');
  g.setKst('2026-11-16 10:25');
  g.gs.checkMissing();
  g.setKst('2026-11-16 10:35');
  g.gs.checkMissing();
  assert.equal(sentTo(g, '박점장').length, 1, '같은 사람은 하루 한 번(사장님 알림처럼)');
  // 가산(12:00): 이지은만. 최유나는 제때 출근
  g.setKst('2026-11-16 11:58');
  punch(g, '최유나');
  g.setKst('2026-11-16 12:15');
  g.gs.checkMissing();
  assert.equal(lateFor(g, '최유나').length, 1);
  assert.match(lateFor(g, '최유나')[0], /직원 1명\n11\/16\(월\) 12:15 기준\n\[가산\] 이지은 \(출근 예정 12:00\)/);
  assert.doesNotMatch(texts(g, '최유나').join('\n'), /김민우|박점장|오사무/, '다른 매장 사람은 안 보여요');
  assert.equal(sentTo(g, '박점장').length, 1, '왕십리 점장은 가산 사람을 안 받아요');
  assert.equal(sentTo(g, '오사무').length, 0);
  g.setKst('2026-11-16 12:25');
  g.gs.checkMissing();
  assert.equal(lateFor(g, '최유나').length, 1, '다음 10분 검사에서도 그대로');
  // 다음 날에는 다시(하루 한 번). 박점장도 안 찍었지만 왕십리 점장은 박점장 혼자라 본인 이름은 안 와요
  g.setKst('2026-11-17 10:15');
  g.gs.checkMissing();
  assert.equal(lateFor(g, '박점장').length, 2);
  assert.equal(lateFor(g, '박점장').at(-1), '[굳폰] 아직 출근 안 찍은 직원 1명\n11/17(화) 10:15 기준\n[왕십리] 김민우 (출근 예정 10:00)\n출근했는지 확인해 주세요.');
});

test('미출근: 늦은 사람이 점장이면 그 매장의 다른 점장에게만 가요(본인 이름은 본인에게 안 가요)', () => {
  const g = shop();
  g.sheet('매장').getRange(2, 8).setValue('박점장, 김민우'); // 왕십리 점장 두 명
  tgOn(g, ['박점장', '김민우', '최유나', '오사무']);
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(lateFor(g, '박점장').length, 1);
  assert.match(lateFor(g, '박점장')[0], /직원 1명[\s\S]*\[왕십리\] 김민우 \(출근 예정 10:00\)/);
  assert.doesNotMatch(lateFor(g, '박점장')[0], /\] 박점장/);
  assert.equal(lateFor(g, '김민우').length, 1);
  assert.match(lateFor(g, '김민우')[0], /직원 1명[\s\S]*\[왕십리\] 박점장 \(출근 예정 10:00\)/);
  assert.doesNotMatch(lateFor(g, '김민우')[0], /\] 김민우/);
  assert.ok(texts(g, '박점장').some((t) => /아직 출근을 안 찍었어요/.test(t)), '본인에게는 원래 가던 알림');
  // 사무실은 점장 혼자(오사무): 오사무가 늦으면 점장 알림은 아무에게도 안 가요
  assert.equal(lateFor(g, '오사무').length, 0);
  assert.ok(texts(g, '오사무').some((t) => /아직 출근을 안 찍었어요/.test(t)));
  assert.equal(lateFor(g, '최유나').length, 0);
  // 가산: 이지은·최유나(점장) 둘 다 늦음 → 최유나에게는 이지은만
  g.setKst('2026-11-16 12:15');
  g.gs.checkMissing();
  assert.equal(lateFor(g, '최유나').length, 1);
  assert.match(lateFor(g, '최유나')[0], /직원 1명[\s\S]*\[가산\] 이지은 \(출근 예정 12:00\)/);
  assert.doesNotMatch(lateFor(g, '최유나')[0], /최유나 \(/);
  assert.equal(lateFor(g, '박점장').length, 1, '가산 사람은 왕십리 점장에게 안 가요');
  assert.match(texts(g, '사장님').at(-1), /아직 출근 안 찍은 직원 2명/, '사장님은 모두');
});

test('미출근: 두 매장을 맡은 점장에게는 두 매장 사람을 한 번에 보내요(맡지 않은 매장 사람은 빼요)', () => {
  const g = shop();
  g.sheet('매장').getRange(3, 8).setValue('박점장'); // 가산 점장도 박점장
  g.sheet('직원').getRange(ROW.오사무, 5).setValue('11:00-18:00'); // 오사무: 월요일 11시 출근
  tgOn(g, ['박점장']);
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  g.setKst('2026-11-16 12:15');
  g.gs.checkMissing();
  const m = texts(g, '박점장');
  assert.equal(m.length, 1);
  assert.equal(m[0], '[굳폰] 아직 출근 안 찍은 직원 3명\n11/16(월) 12:15 기준\n[왕십리] 김민우 (출근 예정 10:00)\n[가산] 이지은 (출근 예정 12:00)\n[가산] 최유나 (출근 예정 12:00)\n출근했는지 확인해 주세요.');
  assert.match(texts(g, '사장님').at(-1), /직원 4명[\s\S]*\[사무실\] 오사무/, '사장님에게는 사무실도');
});

test('미출근: 점장이 텔레그램 알림을 안 켰으면 조용히 넘어가요. 테스트 직원은 점장에게 안 가요', () => {
  const g = shop();
  tgOn(g, ['최유나']); // 박점장은 알림을 안 켰어요
  g.gs.adminTestStaff(PIN, '가산');
  g.setKst('2026-11-16 10:15');
  assert.doesNotThrow(() => g.gs.checkMissing());
  assert.match(texts(g, '사장님').at(-1), /\[왕십리\] 김민우/);
  g.setKst('2026-11-16 11:58');
  punch(g, '최유나');
  punch(g, '이지은');
  g.setKst('2026-11-16 12:15');
  g.gs.checkMissing();
  assert.match(texts(g, '사장님').at(-1), /\[가산\] 테스트/, '사장님에게는 원래대로');
  assert.equal(sentTo(g, '최유나').length, 0, '테스트 직원(시험용)은 점장에게 안 알려요');
});

test('미출근: 사장님 알림(텔레그램 연결·메일)을 아직 안 정했어도 봇만 있으면 점장에게는 가요', () => {
  const g = shop();
  g.gs.setSetting_('알림이메일', '');
  g.gs.setSetting_('텔레그램토큰', TOKEN); // 사장님 채팅은 아직 연결 전
  g.gs.setStaffCell_(ROW.박점장, '텔레그램', CHAT.박점장);
  g.setKst('2026-11-16 08:58');
  punch(g, '오사무');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(lateFor(g, '박점장').length, 1);
  assert.match(lateFor(g, '박점장')[0], /\[왕십리\] 김민우 \(출근 예정 10:00\)/);
  assert.equal(g.mails.length, 0);
  assert.equal(sentTo(g, '사장님').length, 0);
});

test('[설정] 점장알림: setup이 줄을 만들고(기본 켬), 끔이면 점장에게 아무것도 안 가요(사장님·본인 알림은 그대로)', () => {
  const g = shop();
  assert.equal(setting(g, '점장알림').value, '켬');
  // 줄이 없는 예전 시트(새 버전을 붙여넣고 setup 전)도 켬, setup하면 줄이 생겨요
  g.sheet('설정').deleteRow(setting(g, '점장알림').row);
  g.gs.MEMO_ = {};
  assert.equal(setting(g, '점장알림'), null);
  assert.equal(g.gs.settings_().mgrAlert, '켬');
  g.gs.setup();
  assert.equal(setting(g, '점장알림').value, '켬');
  for (const [v, want] of [['끔', '끔'], ['꺼짐', '끔'], ['안함', '끔'], ['OFF', '끔'], ['x', '끔'], ['켬', '켬'], ['켜짐', '켬'], ['on', '켬'], ['', '켬']]) {
    g.gs.setSetting_('점장알림', v);
    assert.equal(g.gs.settings_().mgrAlert, want, JSON.stringify(v));
  }
  g.gs.setSetting_('점장알림', '끔');
  tgOn(g, ['박점장', '최유나', '오사무', '김민우']);
  g.setKst('2026-11-16 08:58');
  punch(g, '오사무');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.match(texts(g, '사장님').at(-1), /아직 출근 안 찍은 직원 1명/);
  assert.match(texts(g, '김민우').at(-1), /아직 출근을 안 찍었어요/, '본인 알림은 그대로');
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm());
  g.gs.adminJoin(PIN, '한신입', true);
  g.gs.adminMove(PIN, '이지은', '왕십리', '2026-11-16');
  g.gs.adminRetire(PIN, '김민우', '2026-11-30');
  g.gs.adminRetire(PIN, '오사무', '2026-11-15');
  assert.equal(sentTo(g, '박점장').length, 0);
  assert.equal(sentTo(g, '최유나').length, 0);
  assert.match(texts(g, '김민우').at(-1), /아직 출근을 안 찍었어요/);
  // 다시 켜면 보내요
  g.gs.setSetting_('점장알림', '켬');
  g.gs.adminUnretire(PIN, '김민우');
  assert.equal(texts(g, '박점장').at(-1), '[굳폰] 퇴사 예정 취소\n[왕십리] 김민우 님의 11/30(월) 퇴사 예정이 취소됐어요. 계속 일해요.');
});

test('입사 승인: 그 지점 점장에게 소리 없이(이름·지점·입사일만). 다른 지점·반려는 안 가요', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나']); // 오사무(사무실)는 알림을 안 켰어요
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm());
  assert.equal(sentTo(g, '박점장').length, 0, '등록만 했을 때는 안 가요(승인은 사장님)');
  g.gs.adminJoin(PIN, '한신입', true);
  assert.equal(sentTo(g, '박점장').length, 1);
  assert.equal(sentTo(g, '박점장')[0].text, '[굳폰] 새 직원 입사\n[왕십리] 한신입 님이 11/16(월)부터 일해요.');
  assert.equal(sentTo(g, '박점장')[0].disable_notification, true, '인사 소식은 소리 없이');
  assert.equal(sentTo(g, '최유나').length, 0, '다른 지점 점장에게는 안 가요');
  // 승인할 때 지점·입사일을 고치면 고친 지점 점장에게
  g.gs.joinSubmit(joinForm({ name: '두신입', rrn: '960202-2345678', device: 'hhhhhhhhhhhhhhhh', start: '2026-11-20' }));
  g.gs.adminJoin(PIN, '두신입', true, { store: '가산', start: '2026-11-23' });
  assert.deepEqual(texts(g, '최유나'), ['[굳폰] 새 직원 입사\n[가산] 두신입 님이 11/23(월)부터 일해요.']);
  assert.equal(sentTo(g, '박점장').length, 1);
  // 반려는 안 알려요
  g.gs.joinSubmit(joinForm({ name: '세신입', rrn: '970303-1456789', device: 'iiiiiiiiiiiiiiii' }));
  g.gs.adminJoin(PIN, '세신입', false, { reason: '이름을 확인해 주세요' });
  assert.equal(sentTo(g, '박점장').length, 1);
  // 텔레그램을 안 켠 점장(사무실)은 넘어가고 승인은 그대로 돼요
  g.gs.joinSubmit(joinForm({ name: '네신입', rrn: '980404-2567890', device: 'jjjjjjjjjjjjjjjj', store: '사무실' }));
  assert.doesNotThrow(() => g.gs.adminJoin(PIN, '네신입', true));
  assert.equal(g.gs.findStaff_('네신입').store, '사무실');
  // 휴대폰·주민번호·계좌·주소는 점장 알림에 안 적어요
  const all = [...texts(g, '박점장'), ...texts(g, '최유나')].join('\n');
  assert.doesNotMatch(all, /010|1234|950101|960202|9283|901234|왕십리로|국민/);
});

test('지점 이동(바로): 예전·새 지점 점장 모두에게 소리 없이. 상관없는 지점 점장·본인에게는 안 가고, 되돌리면 바로잡아요', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '오사무', '김민우']);
  g.setKst('2026-11-16 14:00');
  g.gs.adminMove(PIN, '김민우', '가산', '2026-11-16');
  const moved = '[굳폰] 지점 이동\n김민우 님이 11/16(월)부터 가산에서 일해요. (왕십리 → 가산)';
  assert.deepEqual(texts(g, '박점장'), [moved], '예전 지점 점장');
  assert.deepEqual(texts(g, '최유나'), [moved], '새 지점 점장');
  assert.equal(sentTo(g, '최유나')[0].disable_notification, true);
  assert.equal(sentTo(g, '오사무').length, 0, '상관없는 지점 점장');
  assert.match(texts(g, '김민우').at(-1), /지점이 바뀌었어요/, '본인에게는 원래 알림만');
  // 잘못 옮겨서 되돌리면 두 지점 점장에게 바로잡아요
  g.gs.adminMoveUndo(PIN, '김민우');
  const undo = '[굳폰] 지점 이동 취소\n김민우 님의 왕십리 → 가산 이동이 취소됐어요. 다시 왕십리에서 일해요.';
  assert.equal(texts(g, '박점장').at(-1), undo);
  assert.equal(texts(g, '최유나').at(-1), undo);
  assert.equal(sentTo(g, '오사무').length, 0);
  // 지난 날짜로 옮긴 것도 그날부터로
  g.gs.adminMove(PIN, '이지은', '사무실', '2026-11-14');
  const back = '[굳폰] 지점 이동\n이지은 님이 11/14(토)부터 사무실에서 일해요. (가산 → 사무실)';
  assert.equal(texts(g, '최유나').at(-1), back);
  assert.deepEqual(texts(g, '오사무'), [back]);
  assert.equal(texts(g, '박점장').at(-1), undo, '왕십리 점장에게는 안 가요');
  // 점장이 옮기면: 본인 소식은 본인에게 안 가고, 남은 지점 점장·새 지점 점장에게
  const n = sentTo(g, '박점장').length;
  g.gs.adminMove(PIN, '박점장', '가산', '2026-11-16');
  assert.equal(texts(g, '최유나').at(-1), '[굳폰] 지점 이동\n박점장 님이 11/16(월)부터 가산에서 일해요. (왕십리 → 가산)');
  assert.ok(texts(g, '박점장').slice(n).every((t) => !/지점 이동\n박점장/.test(t)), '본인에게는 점장 알림이 안 가요');
  // 텔레그램이 안 돼도 이동은 그대로 돼요
  g.tg.down = true;
  assert.doesNotThrow(() => g.gs.adminMove(PIN, '김민우', '사무실', '2026-11-16'));
  assert.equal(g.gs.findStaff_('김민우').store, '사무실');
});

test('지점 이동(예약): 예약할 때는 점장에게 안 가고, 옮기는 날 새벽(5시 뒤)에 예전·새 지점 점장에게 한 번', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '오사무']);
  g.setKst('2026-11-16 14:00');
  g.gs.adminMove(PIN, '김민우', '가산', '2026-11-20');
  assert.equal(sentTo(g, '박점장').length, 0, '예약만 한 때는 안 가요(옮기는 날 알려요)');
  assert.equal(sentTo(g, '최유나').length, 0);
  g.setKst('2026-11-20 05:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('김민우').store, '가산');
  const want = '[굳폰] 지점 이동\n김민우 님이 11/20(금)부터 가산에서 일해요. (왕십리 → 가산)';
  assert.equal(texts(g, '박점장').filter((t) => t === want).length, 1);
  assert.equal(texts(g, '최유나').filter((t) => t === want).length, 1);
  assert.equal(sentTo(g, '최유나').find((m) => m.text === want).disable_notification, true);
  assert.ok(!texts(g, '오사무').some((t) => /김민우/.test(t)), '상관없는 지점 점장');
  g.setKst('2026-11-20 05:20');
  g.gs.checkMissing();
  assert.equal(texts(g, '박점장').filter((t) => t === want).length, 1, '한 번만');
});

test('퇴사: 날짜를 정할 때(퇴사 예정)·자동 퇴사 처리·바로 퇴사·취소를 그 지점 점장에게만, 소리 없이', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '오사무']);
  g.setKst('2026-11-16 14:00');
  g.gs.adminRetire(PIN, '김민우', '2026-11-20');
  assert.equal(texts(g, '박점장').at(-1), '[굳폰] 퇴사 예정\n[왕십리] 김민우 님이 11/20(금)까지 일하고 퇴사해요.');
  assert.equal(sentTo(g, '박점장').at(-1).disable_notification, true);
  g.gs.adminUnretire(PIN, '김민우');
  assert.equal(texts(g, '박점장').at(-1), '[굳폰] 퇴사 예정 취소\n[왕십리] 김민우 님의 11/20(금) 퇴사 예정이 취소됐어요. 계속 일해요.');
  // 마지막 근무일 다음 날 새벽 5시 뒤 10분 검사가 퇴사 처리하면
  g.gs.adminRetire(PIN, '김민우', '2026-11-17');
  g.setKst('2026-11-18 05:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('김민우').active, false);
  const done = '[굳폰] 퇴사\n[왕십리] 김민우 님이 11/17(화)까지 일하고 퇴사했어요.';
  assert.equal(texts(g, '박점장').filter((t) => t === done).length, 1);
  g.setKst('2026-11-18 05:20');
  g.gs.checkMissing();
  assert.equal(texts(g, '박점장').filter((t) => t === done).length, 1, '한 번만');
  // 퇴사 취소(다시 근무)
  g.setKst('2026-11-18 14:00');
  g.gs.adminUnretire(PIN, '김민우');
  assert.equal(texts(g, '박점장').at(-1), '[굳폰] 퇴사 취소\n[왕십리] 김민우 님의 퇴사가 취소됐어요. 다시 일해요.');
  // 지난 날짜로 바로 퇴사
  g.gs.adminRetire(PIN, '이지은', '2026-11-17');
  assert.equal(texts(g, '최유나').at(-1), '[굳폰] 퇴사\n[가산] 이지은 님이 11/17(화)까지 일하고 퇴사했어요.');
  // 다른 지점 점장은 안 받아요
  assert.ok(!texts(g, '최유나').some((t) => /김민우/.test(t)));
  assert.ok(!texts(g, '박점장').some((t) => /이지은/.test(t)));
  assert.ok(!texts(g, '오사무').some((t) => /김민우|이지은/.test(t)));
  // 이미 퇴사한 사람의 마지막 근무일 고치기는 안 알려요
  const n = sentTo(g, '최유나').length;
  g.gs.adminRetire(PIN, '이지은', '2026-11-16');
  assert.equal(sentTo(g, '최유나').length, n);
});

test('퇴사: 점장이 그만두면 그 매장의 다른 점장에게만(본인에게는 점장 알림이 안 가요)', () => {
  const g = shop();
  g.sheet('매장').getRange(2, 8).setValue('박점장, 김민우');
  tgOn(g, ['박점장', '김민우', '최유나']);
  g.setKst('2026-11-16 14:00');
  g.gs.adminRetire(PIN, '박점장', '2026-11-15');
  assert.deepEqual(texts(g, '김민우'), ['[굳폰] 퇴사\n[왕십리] 박점장 님이 11/15(일)까지 일하고 퇴사했어요.']);
  assert.equal(sentTo(g, '박점장').length, 0);
  assert.equal(sentTo(g, '최유나').length, 0);
  assert.deepEqual(plain(g.gs.stores_().find((st) => st.name === '왕십리').managers), ['김민우'], '점장 칸에서는 빠져요(원래 동작)');
});

test('사장님 화면 [설정] 현재 설정: 점장 알림 켬/끔과 텔레그램 알림을 안 켠 점장(점장 화면에는 안 보내요)', () => {
  const g = shop();
  assert.deepEqual(plain(g.gs.adminToday(PIN).info.mgrAlert), { on: true, tg: false, managers: 3, noTg: ['박점장', '최유나', '오사무'] });
  tgOn(g, ['박점장']);
  assert.deepEqual(plain(g.gs.adminToday(PIN).info.mgrAlert), { on: true, tg: true, managers: 3, noTg: ['최유나', '오사무'] });
  g.gs.setSetting_('점장알림', '끔');
  assert.equal(g.gs.adminToday(PIN).info.mgrAlert.on, false);
  assert.equal(g.gs.adminToday({ name: '박점장', pin: '246813' }).info.mgrAlert, null, '점장 화면에는 안 보내요');
});

test('점장 알림 글을 못 만들거나 텔레그램이 안 돼도 오류를 내지 않아요(사장님이 하던 일은 그대로 끝나요)', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나']);
  const set = g.gs.settings_();
  assert.equal(g.gs.mgrRetire_(set, 'plan', '김민우', '왕십리', undefined), 0, '날짜가 없으면 글을 못 만들어도 넘어가요');
  assert.equal(g.gs.mgrMove_(set, 'now', '김민우', '왕십리', '가산', null), 0);
  assert.equal(g.gs.mgrJoin_(set, '한신입', '없는매장', '2026-11-16'), 0, '[매장] 탭에 없는 지점은 받을 점장이 없어요');
  assert.equal(g.tg.sent.length, 0);
  g.tg.down = true;
  g.setKst('2026-11-16 14:00');
  assert.doesNotThrow(() => g.gs.adminRetire(PIN, '이지은', '2026-11-15'));
  assert.equal(g.gs.findStaff_('이지은').active, false, '퇴사 처리는 그대로 돼요');
  g.tg.down = false;
  assert.equal(g.gs.mgrRetire_(set, 'done', '이지은', '가산', '2026-11-15'), 1, '다시 되면 보낸 점장 수(최유나)');
});
