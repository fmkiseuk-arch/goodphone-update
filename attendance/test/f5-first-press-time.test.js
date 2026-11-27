// 막힌 출근(새 폰 승인 대기·인사 정보 미입력)을 처음 누른 시각으로 넣기
// 실행: node --test attendance/test/f5-first-press-time.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

/* ───── 작은 준비물(code.test.js 에서 가져온 것) ───── */
const plain = (x) => JSON.parse(JSON.stringify(x));
let hrSeq = 0;
function hrFill(g, names, over = {}) {
  const list = names || g.gs.staff_().filter((p) => p.active).map((p) => p.name);
  for (const n of list) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(n)) g.gs.syncHr_();
    const h = g.gs.hrFind_(n);
    if (!h) continue;
    hrSeq++;
    const rrn = '8001' + String(10 + (hrSeq % 18)).padStart(2, '0') + '1' + String(100000 + hrSeq).slice(-6);
    g.gs.hrWrite_(h.row, {
      rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: h.phone || '010-1000-' + String(1000 + hrSeq), addr: h.addr || '서울 성동구', bank: h.bank || '국민',
      account: h.account || '123456-78-' + String(900000 + hrSeq), emergency: h.emergency || '010-9999-8888 가족', start: h.start || '2020-01-01', ...over,
    });
  }
  g.gs.MEMO_ = {};
}
const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 }; // 왕십리에서 약 33m
const FAR = { lat: 37.58, lng: 126.978, acc: 20 }; // 약 1.5km(가산 자리)
const GASAN = { lat: 37.58, lng: 126.978 };
const ADMIN = '582941';
// 2026-11-16 월요일. 왕십리 10:00-20:00, 가산 12:00-21:00. 김민우(왕십리), 이지은(가산), 박퇴사(퇴사)
function fresh({ mode = '필수', hr = true } = {}) {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  g.sheet('직원').getRange(2, 1, 3, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', '10,320', '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  const set = (k, v) => g.gs.setSetting_(k, v);
  set('관리자PIN', ADMIN);
  set('앱시작일', '2026-01-01');
  set('지각유예(분)', '0');
  set('위치확인', mode);
  g.gs.adminSetPlace(ADMIN, '왕십리', STORE.lat, STORE.lng);
  if (hr) hrFill(g);
  return g;
}
const PHONE = { 김민우: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박퇴사: 'cccccccccccccccc', 박점장: 'eeeeeeeeeeeeeeee', 최유나: 'ffffffffffffffff' };
const NEWPHONE = 'n0n0n0n0n0n0n0n0';
const punch = (g, name, pin, type, pos = NEAR, device = PHONE[name], label = 'iPhone 사파리', agree = true) =>
  g.gs.punch({ name, pin, type, lat: pos && pos.lat, lng: pos && pos.lng, acc: pos && pos.acc, device, label, agree });
const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
const ROW = { 김민우: 2, 이지은: 3, 박점장: 5, 최유나: 6 };
function v3(opts = {}) {
  const g = fresh(opts);
  g.sheet('직원').getRange(5, 1, 2, 14).setValues([
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '1357', 10320, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박점장');
  g.gs.setup();
  if (opts.hr !== false) hrFill(g, ['박점장', '최유나']);
  return g;
}
const tgOn = (g) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
};
const sentTo = (g, chat) => g.tg.sent.filter((m) => String(m.chat_id) === String(chat)).map((m) => m.text);
const suspects = (g) => {
  const sh = g.sheet('의심기록');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};
const tryOf = (g, date, name) => { const v = g.props.get('try:' + date + ':' + name); return v ? JSON.parse(v) : null; };
const logRow = (g, date, name) => {
  const sh = g.sheet('출퇴근기록');
  for (let r = 2; r <= sh.getLastRow(); r++) { const v = sh.rowDisplay(r); if (v[0] === date && v[2] === name) return v; }
  return null;
};
const todayItem = (g, cred, name) => plain(g.gs.adminToday(cred)).list.find((x) => x.name === name);
// 인사 정보 양식(직원 화면 [인사 정보 넣기])
const hrForm = (over = {}) => ({
  rrn: '', phone: '010-2222-3333', addr: '서울 성동구 왕십리로 1', bank: '국민', account: '123456-78-901234', emergency: '010-9999-8888 어머니',
  agree: true, device: PHONE.김민우, label: 'iPhone 사파리', ...over,
});
// 김민우: 폰 등록(11/16 출퇴근), 그다음 주소를 지워서 인사 정보가 빠진 상태
function hrGap(g) {
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민우', '0123', 'out');
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { addr: '' });
  g.gs.MEMO_ = {};
}

/* ───── 매장 반경 계산 ───── */

test('반경 계산: 출근 찍을 때(checkPlace_)와 같은 매장·거리를 주고, 막거나 [의심기록]에 남기지 않아요', () => {
  const g = fresh();
  g.gs.adminSetPlace(ADMIN, '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-16 09:50');
  const set = g.gs.settings_();
  const kim = g.gs.findStaff_('김민우');
  const now = g.gs.nowKst_();
  const edge = { lat: 37.5665 + 0.0016, lng: 126.978, acc: 90 }; // 약 178m, GPS 오차 90m → 반경 안
  for (const pos of [NEAR, edge, { ...GASAN, acc: 10 }, { lat: 37.5665, lng: 126.978 }]) {
    const want = plain(g.gs.checkPlace_(set, pos, kim, now));
    assert.deepEqual(plain(g.gs.nearStore_(set, pos, kim)), { dist: want.dist, store: want.store }, JSON.stringify(pos));
  }
  const before = suspects(g).length;
  assert.equal(g.gs.nearStore_(set, { lat: 37.5665 + 0.004, lng: 126.978, acc: 20 }, kim), null, '약 440m: 반경 밖');
  assert.equal(g.gs.nearStore_(set, { lat: 37.5665 + 0.004, lng: 126.978, acc: 5000 }, kim), null, 'GPS 오차는 100m까지만 봐줘요');
  assert.equal(g.gs.nearStore_(set, { lat: null, lng: null }, kim), null, '위치 없음');
  assert.equal(g.gs.nearStore_(set, { lat: NaN, lng: 1 }, kim), null);
  assert.equal(g.gs.nearStore_(set, null, kim), null);
  assert.equal(suspects(g).length, before, '[의심기록]에 안 남아요');
  // 위치 확인 안 함·내 매장 위치 미등록: 반경을 알 수 없어서 null
  assert.equal(g.gs.nearStore_({ ...set, mode: '안함' }, NEAR, kim), null);
  g.gs.adminSetPlace(ADMIN, '왕십리', '', '');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.nearStore_(g.gs.settings_(), NEAR, g.gs.findStaff_('김민우')), null);
  // 매장 반경을 따로 정한 매장
  g.gs.adminSetPlace(ADMIN, '왕십리', STORE.lat, STORE.lng);
  g.sheet('매장').getRange(2, 6).setValue('20');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.nearStore_(g.gs.settings_(), { ...NEAR, acc: 5 }, g.gs.findStaff_('김민우')), null, '반경 20m + 오차 5m < 33m');
});

/* ───── 새 폰 승인 대기 ───── */

test('새 폰: 매장 반경 안에서 막힌 출근은 처음 누른 시각만 기억하고, 사장님이 새 폰 카드에서 [이 시각으로 출근 적기]', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in'); // 첫 폰 등록
  g.setKst('2026-11-17 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE, 'Galaxy 크롬'), /등록된 폰이 아니에요/);
  assert.equal(g.sheet('출퇴근기록').getLastRow(), 2, '기록 줄은 안 생겨요(어제 줄만)');
  const t = tryOf(g, '2026-11-17', '김민우');
  assert.deepEqual([t.time, t.min, t.store, t.why, t.dev], ['09:58', 598, '왕십리', 'phone', NEWPHONE]);
  assert.ok(t.dist > 20 && t.dist < 50);
  // 다시 눌러도 처음 것 그대로
  g.setKst('2026-11-17 10:04');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE, 'Galaxy 크롬'), /등록된 폰이 아니에요/);
  assert.equal(tryOf(g, '2026-11-17', '김민우').time, '09:58');
  // 사장님 화면: 새 폰 카드와 직원 줄에 시각·거리
  g.setKst('2026-11-17 10:20');
  const today = plain(g.gs.adminToday(ADMIN));
  const card = today.pending.find((x) => x.name === '김민우');
  assert.deepEqual([card.tried.time, card.tried.why, card.tried.whyText, card.tried.dist], ['09:58', 'phone', '새 폰 승인 대기', t.dist]);
  assert.equal(today.list.find((x) => x.name === '김민우').tried.time, '09:58');
  assert.equal(today.list.find((x) => x.name === '이지은').tried, null);
  // 적기: 그 시각으로 기록, 지각은 그 시각 기준(10:00 출근 → 지각 아님)
  const r = plain(g.gs.adminTryPunch(ADMIN, '김민우'));
  assert.deepEqual(r.tried, { name: '김민우', time: '09:58', late: 0 });
  const row = logRow(g, '2026-11-17', '김민우');
  assert.deepEqual(row.slice(3, 8), ['10:00', '20:00', '09:58', '', '']);
  assert.equal(row[11], String(t.dist), '출근거리도 그때 거리');
  assert.match(row[13], /처음 누른 시각으로 적음\(새 폰 승인 대기 · 사장님이 10:20에 적음\)/);
  assert.ok(suspects(g).some((s) => s[1] === '김민우' && s[2] === '처음 누른 시각으로 적음' && /사장님이 출근 09:58로 적음 \(10:20에 · 새 폰 승인 대기 · 약 \d+m\)/.test(s[3])));
  // 한 번만: 기억은 지워지고, 카드의 승인 요청은 그대로(폰 승인은 따로)
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null);
  assert.equal(r.pending.find((x) => x.name === '김민우').tried, null);
  assert.equal(r.list.find((x) => x.name === '김민우').tried, null);
  assert.throws(() => g.gs.adminTryPunch(ADMIN, '김민우'), /막힌 출근 기록이 없어요/);
  g.gs.adminDevice(ADMIN, '김민우', true, 'add');
  g.setKst('2026-11-17 20:00');
  assert.equal(punch(g, '김민우', '0123', 'out', NEAR, NEWPHONE).work, 20 * 60 - (9 * 60 + 58), '퇴근은 새 폰으로');
});

test('새 폰: 늦게 눌렀으면 그 시각으로 지각이 계산되고, 다른 매장 반경이면 지원 근무(그 매장 시간 기준)로 적어요', () => {
  const g = fresh();
  g.gs.adminSetPlace(ADMIN, '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  punch(g, '이지은', '5678', 'in', { ...GASAN, acc: 10 });
  g.setKst('2026-11-17 10:07');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE), /등록된 폰이 아니에요/);
  g.setKst('2026-11-17 10:40');
  assert.equal(plain(g.gs.adminTryPunch(ADMIN, '김민우')).tried.late, 7, '10:07 → 7분 지각(적은 때 10:40이 아니에요)');
  assert.equal(logRow(g, '2026-11-17', '김민우')[7], '7');
  // 김민우가 가산(12:00 시작) 근처에서 새 폰으로 → 지원 근무
  g.setKst('2026-11-18 11:50');
  assert.throws(() => punch(g, '김민우', '0123', 'in', { ...GASAN, acc: 10 }, 'n1n1n1n1n1n1n1n1'), /등록된 폰이 아니에요/);
  assert.equal(tryOf(g, '2026-11-18', '김민우').store, '가산');
  g.setKst('2026-11-18 12:30');
  assert.equal(plain(g.gs.adminTryPunch(ADMIN, '김민우')).tried.late, 0);
  const row = logRow(g, '2026-11-18', '김민우');
  assert.deepEqual([row[3], row[5], row[14]], ['12:00', '11:50', '가산']);
  assert.match(row[13], /다른 매장\(가산\)/);
  assert.match(row[13], /지원 근무\(가산\) 시간 기준/);
});

/* ───── 인사 정보 미입력 ───── */

test('인사 정보: 막힌 출근 → 60분 안에 인사 정보를 다 넣으면 처음 누른 시각으로 저절로 출근', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 09:55');
  // 직원 화면: 첫 문장은 그대로, 뒤에 '언제까지 넣으면 그 시각으로 찍히는지'
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저 다 넣어야 출근이 찍혀요\. 아직 안 넣은 것: 주소\.\n처음 누른 시각\(09:55\)은 기억해 둘게요\. 10:55까지 인사 정보를 다 넣으면 그 시각으로 출근이 찍혀요\.$/);
  assert.equal(logRow(g, '2026-11-17', '김민우'), null);
  g.setKst('2026-11-17 10:01');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /처음 누른 시각\(09:55\)은 기억해 둘게요\. 10:55까지/, '다시 눌러도 처음 시각');
  assert.deepEqual([tryOf(g, '2026-11-17', '김민우').time, tryOf(g, '2026-11-17', '김민우').why], ['09:55', 'hr']);
  // 점장 화면: 인사 정보를 아직 다 안 넣어서 점장은 못 적어요(대신 찍기와 같아요)
  assert.equal(todayItem(g, MGR, '김민우').tried.time, '09:55');
  assert.throws(() => g.gs.adminTryPunch(MGR, '김민우'), /인사 정보를 아직 다 안 넣어서 점장님이 대신 출근을 적을 수 없어요\(아직: 주소\)/);
  g.setKst('2026-11-17 10:20');
  const r = plain(g.gs.hrSave('김민우', '0123', hrForm()));
  assert.equal(r.ok, true);
  assert.deepEqual([r.punched.type, r.punched.time, r.punched.late, r.punched.today.tIn, r.punched.support], ['in', '09:55', 0, '09:55', '']);
  const row = logRow(g, '2026-11-17', '김민우');
  assert.equal(row[5], '09:55');
  assert.match(row[13], /처음 누른 시각으로 적음\(인사 정보 미입력 · 인사 정보를 다 넣은 10:20에 저절로\)/);
  assert.ok(suspects(g).some((s) => s[1] === '김민우' && s[2] === '처음 누른 시각으로 적음' && /인사 정보를 다 넣어서 출근 09:55로 저절로 적음/.test(s[3])));
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null, '한 번 쓰면 지워요');
  // 다시 저장해도 두 번 안 찍혀요
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched, undefined);
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /이미 09:55에 출근/);
});

test('인사 정보: 60분이 지나면 저절로 안 찍고, [오늘]에 [09:55로 대신 찍기]가 남아요. 점장이 적으면 사장님께 알림(번호는 안 적어요)', () => {
  const g = v3();
  tgOn(g);
  hrGap(g);
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저/);
  g.setKst('2026-11-17 10:56');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), (e) => /인사 정보를 먼저/.test(e.message) && !/기억해 둘게요/.test(e.message), '60분이 지나면 안내도 안 붙여요');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched, undefined, '61분 뒤');
  assert.equal(logRow(g, '2026-11-17', '김민우'), null);
  const item = todayItem(g, MGR, '김민우');
  assert.deepEqual([item.tried.time, item.hrOk], ['09:55', true]);
  const before = sentTo(g, 555).length;
  const r = plain(g.gs.adminTryPunch(MGR, '김민우'));
  assert.equal(r.tried.time, '09:55');
  assert.match(logRow(g, '2026-11-17', '김민우')[13], /처음 누른 시각으로 적음\(인사 정보 미입력 · 박점장 점장이 10:56에 적음\)/);
  const note = sentTo(g, 555).slice(before).find((x) => /처음 누른 시각으로 출근 적음/.test(x));
  assert.match(note, /\[왕십리\] 김민우 출근 09:55 \(인사 정보 미입력 · 약 \d+m\)\n박점장 점장이 10:56에 적었어요\./);
  assert.ok(!/010|2222|3333|901234/.test(note), '휴대폰·계좌 번호는 안 적어요');
  // 사장님이 직접 적으면 사장님께는 알림 안 가요(대신 찍기와 같아요)
  g.setKst('2026-11-18 09:50');
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { emergency: '' });
  g.gs.MEMO_ = {};
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /비상연락처/);
  g.setKst('2026-11-18 10:30');
  const n0 = sentTo(g, 555).length;
  assert.equal(plain(g.gs.adminTryPunch(ADMIN, '김민우')).tried.time, '09:50', '사장님은 인사 정보가 빠져도 적을 수 있어요(대신 찍기와 같아요)');
  assert.equal(sentTo(g, 555).length, n0);
});

test('인사 정보: 처음 막힌 게 새 폰이어도, 사장님이 그 폰을 승인하고 인사 정보를 넣으면 처음 누른 시각으로', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 09:57');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE, 'Galaxy 크롬'), /등록된 폰이 아니에요/);
  assert.equal(tryOf(g, '2026-11-17', '김민우').why, 'phone', '폰 확인이 먼저예요');
  // 승인 전에는 그 폰으로 인사 정보를 못 넣어요
  g.setKst('2026-11-17 10:01');
  assert.throws(() => g.gs.hrSave('김민우', '0123', hrForm({ device: NEWPHONE })), /등록된 폰\)에서만/);
  g.gs.adminDevice(ADMIN, '김민우', true, 'replace');
  g.setKst('2026-11-17 10:05');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-17', '김민우').time, '09:57', '처음 누른 것 그대로');
  g.setKst('2026-11-17 10:12');
  const r = plain(g.gs.hrSave('김민우', '0123', hrForm({ device: NEWPHONE })));
  assert.deepEqual([r.punched.time, r.punched.late], ['09:57', 0]);
  assert.match(logRow(g, '2026-11-17', '김민우')[13], /처음 누른 시각으로 적음\(새 폰 승인 대기 · 인사 정보를 다 넣은 10:12에 저절로\)/);
});

test('인사 정보: 폰 확인을 안 쓰는 가게도 돼요. 처음 동의를 출근 누를 때 했으면 동의도 그때로 저장해요', () => {
  const g = v3({ hr: false });
  hrFill(g, ['김민우'], { addr: '' });
  g.gs.setSetting_('폰확인', '안함');
  g.gs.setStaffCell_(ROW.김민우, '동의', '');
  g.setKst('2026-11-17 10:03');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, '', 'x', false), /처음 한 번만 동의가 필요해요/);
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null, '동의를 안 하면 기억 안 해요');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, '', 'x', true), /인사 정보를 먼저/);
  const t = tryOf(g, '2026-11-17', '김민우');
  assert.deepEqual([t.time, t.why, t.dev, t.ag], ['10:03', 'hr', '', 1]);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.findStaff_('김민우').agreed, false, '막힌 출근에서는 동의를 저장 안 해요');
  g.setKst('2026-11-17 10:30');
  const r = plain(g.gs.hrSave('김민우', '0123', hrForm({ device: '' })));
  assert.deepEqual([r.punched.time, r.punched.late], ['10:03', 3]);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.findStaff_('김민우').agreed, true);
  assert.equal(g.sheet('직원').rowDisplay(ROW.김민우)[14], '2026-11-17 10:03 출근 누를 때');
});

/* ───── 막아야 하는 것 ───── */

test('막기: 매장 반경 밖·위치 없음·위치 확인 안 함이면 기억하지 않고, 기록도 안 생겨요', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR, NEWPHONE), /등록된 폰이 아니에요/);
  const noHint = (e) => /인사 정보를 먼저/.test(e.message) && !/기억해 둘게요/.test(e.message);
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR), noHint);
  assert.throws(() => punch(g, '김민우', '0123', 'in', null), noHint);
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null);
  assert.equal(todayItem(g, ADMIN, '김민우').tried, null);
  assert.throws(() => g.gs.adminTryPunch(ADMIN, '김민우'), /막힌 출근 기록이 없어요/);
  g.setKst('2026-11-17 10:10');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched, undefined);
  assert.equal(logRow(g, '2026-11-17', '김민우'), null, '저절로 찍히지 않아요');
  // 반경 밖에서 먼저 누르고 반경 안에서 다시 누르면 반경 안에서 처음 누른 것
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { addr: '' });
  g.gs.MEMO_ = {};
  g.setKst('2026-11-18 09:40');
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR), /인사 정보를 먼저/);
  g.setKst('2026-11-18 09:52');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-18', '김민우').time, '09:52');
  // 위치 확인 안 함: 반경을 알 수 없어서 기억 안 해요
  g.gs.setSetting_('위치확인', '안함');
  g.gs.MEMO_ = {};
  g.setKst('2026-11-19 09:50');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-19', '김민우'), null);
});

test('막기: 다른 날 누른 것은 안 쓰고, 다음 날 10분 검사가 지워요', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 23:20');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저/);
  assert.ok(tryOf(g, '2026-11-17', '김민우'));
  g.setKst('2026-11-18 00:10');
  assert.equal(todayItem(g, ADMIN, '김민우').tried, null, '어제 누른 것은 [오늘]에 안 보여요');
  assert.throws(() => g.gs.adminTryPunch(ADMIN, '김민우'), /막힌 출근 기록이 없어요/);
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched, undefined, '자정을 넘긴 60분 안이어도 다른 날이라 안 찍어요');
  assert.equal(logRow(g, '2026-11-18', '김민우'), null);
  assert.equal(logRow(g, '2026-11-17', '김민우'), null);
  g.setKst('2026-11-18 00:20');
  g.gs.checkMissing();
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null, '다음 날 지워요');
});

test('막기: 출근 기록이 이미 있으면 적지 않아요(대신 찍기·직접 찍기 뒤)', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저/);
  g.setKst('2026-11-17 10:02');
  g.gs.proxyPunch(ADMIN, '김민우', 'in', '폰 방전');
  assert.equal(todayItem(g, ADMIN, '김민우').tried, null, '출근 기록이 있으면 버튼이 없어요');
  assert.throws(() => g.gs.adminTryPunch(ADMIN, '김민우'), /오늘 이미 10:02 출근 기록이 있어요/);
  g.setKst('2026-11-17 10:20');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched, undefined);
  assert.equal(logRow(g, '2026-11-17', '김민우')[5], '10:02', '대신 찍은 시각 그대로');
  // 새 폰: 승인 뒤 직접 찍었으면 끝
  g.setKst('2026-11-18 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, 'n2n2n2n2n2n2n2n2'), /등록된 폰이 아니에요/);
  g.gs.adminDevice(ADMIN, '김민우', true, 'add');
  g.setKst('2026-11-18 10:09');
  punch(g, '김민우', '0123', 'in', NEAR, 'n2n2n2n2n2n2n2n2');
  assert.equal(plain(g.gs.adminToday(ADMIN)).list.find((x) => x.name === '김민우').tried, null);
  assert.throws(() => g.gs.adminTryPunch(ADMIN, '김민우'), /오늘 이미 10:09 출근 기록이 있어요/);
});

test('막기: 점장은 자기 매장 직원만(본인은 안 돼요), 로그인 없이·직원 비밀번호로는 못 불러요', () => {
  const g = v3();
  g.gs.adminSetPlace(ADMIN, '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-16 09:50');
  for (const n of ['박점장', '최유나']) punch(g, n, n === '박점장' ? '246813' : '1357', 'in', n === '최유나' ? { ...GASAN, acc: 10 } : NEAR);
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '박점장', '246813', 'in', NEAR, 'm1m1m1m1m1m1m1m1'), /등록된 폰이 아니에요/);
  assert.throws(() => punch(g, '최유나', '1357', 'in', { ...GASAN, acc: 10 }, 'm2m2m2m2m2m2m2m2'), /등록된 폰이 아니에요/);
  assert.ok(tryOf(g, '2026-11-17', '박점장') && tryOf(g, '2026-11-17', '최유나'));
  assert.throws(() => g.gs.adminTryPunch(MGR, '최유나'), /점장님 매장 직원만/);
  assert.throws(() => g.gs.adminTryPunch(MGR, '박점장'), /본인 출근은 대신 적을 수 없어요/);
  assert.equal(todayItem(g, MGR, '최유나'), undefined, '다른 매장 직원은 점장 화면에 없어요');
  assert.throws(() => g.gs.adminTryPunch('', '최유나'), /관리자 비밀번호를 넣어주세요/);
  assert.throws(() => g.gs.adminTryPunch('111111', '최유나'), /관리자 비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.adminTryPunch({ name: '최유나', pin: '1357' }, '최유나'), /점장으로 등록돼 있지 않아요/);
  assert.throws(() => g.gs.adminTryPunch(ADMIN, '박퇴사'), /명단에 없는/);
  assert.equal(logRow(g, '2026-11-17', '최유나'), null);
  assert.equal(logRow(g, '2026-11-17', '박점장'), null);
  assert.equal(plain(g.gs.adminTryPunch(ADMIN, '박점장')).tried.time, '09:55', '점장 본인 것은 사장님이');
});

test('막기: 비밀번호가 틀리거나 처음 정하는 번호, 동료 폰으로 누른 건 기억하지 않아요', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 09:50');
  punch(g, '이지은', '5678', 'in', NEAR); // 이지은 폰 등록(왕십리 근처에서 지원)
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '9999', 'in'), /비밀번호가 틀렸어요/);
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, PHONE.이지은), /이지은 님 폰으로 등록돼 있어요/);
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null);
  // 폰도 비밀번호도 없는 직원: 아무 번호로나 누를 수 있어서 기억 안 해요(이름을 잘못 눌러도 남의 시각이 안 생기게)
  g.sheet('직원').getRange(ROW.최유나, 3).setValue('');
  g.gs.hrWrite_(g.gs.hrFind_('최유나').row, { addr: '' });
  g.gs.MEMO_ = {};
  assert.throws(() => punch(g, '최유나', '4826', 'in', NEAR, 'q1q1q1q1q1q1q1q1'), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-17', '최유나'), null);
  // 폰이 없는 직원이 동료 폰으로 누르면(폰 확인 전에 막히는 자리) 기억 안 해요
  g.gs.setStaffCell_(ROW.김민우, '등록폰', '');
  g.gs.MEMO_ = {};
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, PHONE.이지은), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null);
  // 같은 사람이 자기 폰(아직 등록 전)으로 누르면 기억해요 → 인사 정보를 넣을 때 그 폰이 등록되고 그 시각으로
  g.setKst('2026-11-17 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, PHONE.김민우), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-17', '김민우').time, '09:58');
  g.setKst('2026-11-17 10:15');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm({ device: PHONE.이지은 }))).punched, undefined, '다른 폰에서 넣으면 안 찍어요');
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { addr: '' });
  g.gs.MEMO_ = {};
  const r = plain(g.gs.hrSave('김민우', '0123', hrForm({ device: PHONE.김민우 })));
  assert.equal(r.punched.time, '09:58');
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.findStaff_('김민우').deviceIds), [PHONE.김민우], '출근을 누른 그 폰이 등록돼요(직접 찍을 때처럼)');
});

test('막기: 폰이 2대면 출근을 누른 폰에서 넣었을 때만, 인사 정보가 원래 다 있었으면(새 폰만 막힘) 저절로 안 찍어요', () => {
  const g = v3();
  hrGap(g);
  g.gs.setStaffCell_(ROW.김민우, '등록폰', '#' + PHONE.김민우 + ' iPhone · 11/16 등록 | #' + NEWPHONE + ' 업무폰 · 11/16 승인');
  g.gs.MEMO_ = {};
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE), /인사 정보를 먼저/);
  g.setKst('2026-11-17 10:05');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm({ device: PHONE.김민우 }))).punched, undefined);
  assert.equal(todayItem(g, ADMIN, '김민우').tried.time, '09:55', '사장님 화면에는 남아요');
  // 인사 정보가 다 있는 직원이 새 폰으로 막혔다가 승인 뒤 인사 정보를 고쳐도 저절로 안 찍어요(인사 정보 때문에 막힌 게 아니라서)
  g.setKst('2026-11-18 09:59');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, 'n3n3n3n3n3n3n3n3'), /등록된 폰이 아니에요/);
  g.gs.adminDevice(ADMIN, '김민우', true, 'replace');
  g.setKst('2026-11-18 10:10');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm({ device: 'n3n3n3n3n3n3n3n3', addr: '서울 성동구 왕십리로 2' }))).punched, undefined);
  assert.equal(logRow(g, '2026-11-18', '김민우'), null);
  assert.equal(todayItem(g, ADMIN, '김민우').tried.time, '09:59');
});

test('막기: 퇴근이 막힌 건 기억하지 않고, 인사 정보 필수를 끄면 인사 정보 때문에 막히지 않아요', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 20:00');
  assert.throws(() => punch(g, '김민우', '0123', 'out', NEAR, NEWPHONE), /등록된 폰이 아니에요/);
  assert.throws(() => punch(g, '김민우', '0123', 'out'), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-17', '김민우'), null);
  g.gs.setSetting_('인사정보필수', '안함');
  g.gs.MEMO_ = {};
  g.setKst('2026-11-18 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE), /등록된 폰이 아니에요/);
  assert.equal(tryOf(g, '2026-11-18', '김민우').why, 'phone');
  g.gs.adminDevice(ADMIN, '김민우', true, 'add');
  g.setKst('2026-11-18 10:05');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm({ device: NEWPHONE }))).punched, undefined, '인사 정보 필수가 꺼져 있으면 인사 정보 때문에 막힌 게 아니에요');
});

test('막기: 동의를 안 했으면(출근을 누를 때도 안 함) 저절로 안 찍고, 폰도 등록하지 않아요', () => {
  const g = v3();
  hrGap(g);
  g.gs.setStaffCell_(ROW.김민우, '등록폰', '');
  g.gs.MEMO_ = {};
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저/);
  assert.equal(tryOf(g, '2026-11-17', '김민우').ag, 0, '이미 동의한 사람이라 이번에 동의한 건 아니에요');
  g.gs.setStaffCell_(ROW.김민우, '동의', ''); // 그 사이 동의가 지워졌어요
  g.gs.MEMO_ = {};
  g.setKst('2026-11-17 10:10');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched, undefined);
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.findStaff_('김민우').deviceIds || []), [], '폰을 등록하지 않아요(찍지도 않았으니까)');
  assert.equal(logRow(g, '2026-11-17', '김민우'), null);
  assert.equal(todayItem(g, ADMIN, '김민우').tried.time, '09:55', '사장님 화면에는 남아요');
});

test('지원 매장: 휴무표에 적힌 지원 매장(자기 매장과 붙어 있음)은 직접 찍을 때처럼 그 매장 시간 기준으로 적어요', () => {
  const g = fresh();
  g.sheet('매장').getRange(4, 1, 1, 3).setValues([['사무실', '11:00', '20:00']]);
  g.gs.MEMO_ = {};
  g.gs.adminSetPlace(ADMIN, '사무실', STORE.lat, STORE.lng + 0.0005); // 왕십리에서 약 44m
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-17 10:50');
  g.gs.setMark_('2026-11-17', '김민우', () => '사무실');
  g.gs.GRID_ = {};
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE), /등록된 폰이 아니에요/);
  const t = tryOf(g, '2026-11-17', '김민우');
  assert.deepEqual([t.store, t.typed], ['사무실', 1]);
  g.setKst('2026-11-17 11:30');
  assert.equal(plain(g.gs.adminTryPunch(ADMIN, '김민우')).tried.late, 0, '사무실 11:00 기준이라 10:50은 지각 아님');
  const row = logRow(g, '2026-11-17', '김민우');
  assert.deepEqual([row[3], row[5], row[14]], ['11:00', '10:50', '사무실']);
  assert.match(row[13], /휴무표에 적힌 지원 매장/);
  // 같은 자리에서 직접 찍었을 때와 같은 결과인지(다음 날, 등록된 폰으로)
  g.gs.adminDevice(ADMIN, '김민우', true, 'add');
  g.setKst('2026-11-18 10:50');
  g.gs.setMark_('2026-11-18', '김민우', () => '사무실');
  g.gs.GRID_ = {};
  punch(g, '김민우', '0123', 'in', NEAR, NEWPHONE);
  const direct = logRow(g, '2026-11-18', '김민우');
  assert.deepEqual([direct[3], direct[14], direct[11]], [row[3], row[14], row[11]]);
});

test('60분 경계: 처음 누른 때부터 딱 60분까지는 저절로 찍혀요', () => {
  const g = v3();
  hrGap(g);
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /10:55까지/);
  g.setKst('2026-11-17 10:55');
  assert.equal(plain(g.gs.hrSave('김민우', '0123', hrForm())).punched.time, '09:55');
  // 밤늦게 누른 것: 안내의 마감 시각은 그날 23:59까지만
  g.gs.hrWrite_(g.gs.hrFind_('박점장').row, { addr: '' });
  g.gs.MEMO_ = {};
  g.setKst('2026-11-17 23:30');
  assert.throws(() => punch(g, '박점장', '246813', 'in'), /처음 누른 시각\(23:30\)은 기억해 둘게요\. 23:59까지/);
  // 내 매장 위치가 아직 없으면(가산) 반경을 알 수 없어서 기억 안 하고 안내도 없어요
  g.gs.hrWrite_(g.gs.hrFind_('최유나').row, { addr: '' });
  g.gs.MEMO_ = {};
  assert.throws(() => punch(g, '최유나', '1357', 'in'), (e) => /인사 정보를 먼저/.test(e.message) && !/기억해 둘게요/.test(e.message));
  assert.equal(tryOf(g, '2026-11-17', '최유나'), null);
});
