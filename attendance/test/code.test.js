// 실행: node --test attendance/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');
// 스크립트 안에서 만든 배열·객체를 평범한 값으로 바꿔서 비교해요
const plain = (x) => JSON.parse(JSON.stringify(x));

const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 }; // 약 33m
const FAR = { lat: 37.58, lng: 126.978, acc: 20 }; // 약 1.5km

// 2026-11-16 은 월요일
// 매장: 왕십리(10:00-20:00), 가산(12:00-21:00, 위치는 왕십리에서 약 1.5km 북쪽)
// 김민수(왕십리): 주말은 [직원] 요일 칸에 '휴무' / 이지은(가산): 수·일 휴무 / 박퇴사: 재직 X
const GASAN = { lat: 37.58, lng: 126.978 };
function fresh({ grace = '0', mode = '필수', email = '' } = {}) {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  //            이름      매장      PIN     시급      월  화  수      목  금  토      일      재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 3, 14).setValues([
    ['김민수', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', '10,320', '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  const set = (k, v) => g.gs.setSetting_(k, v);
  set('관리자PIN', '777777');
  set('지각유예(분)', grace);
  set('위치확인', mode);
  set('알림이메일', email);
  g.gs.adminSetPlace('777777', '왕십리', STORE.lat, STORE.lng);
  return g;
}
// 직원마다 자기 폰 번호
const PHONE = { 김민수: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박퇴사: 'cccccccccccccccc', 예시직원: 'dddddddddddddddd' };
const punch = (g, name, pin, type, pos = NEAR, device = PHONE[name], label = 'iPhone 사파리') =>
  g.gs.punch({ name, pin, type, lat: pos && pos.lat, lng: pos && pos.lng, acc: pos && pos.acc, device, label, agree: true });
const suspects = (g) => {
  const sh = g.sheet('의심기록');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};

test('시간·날짜 읽기: 시트가 보여주는 여러 모양을 다 읽어요', () => {
  const { gs } = createGas({ now: 0 });
  assert.equal(gs.parseTime_('10:05'), 605);
  assert.equal(gs.parseTime_('오후 6:30:00'), 18 * 60 + 30);
  assert.equal(gs.parseTime_('오전 12:10:00'), 10);
  assert.equal(gs.parseTime_('오후 12:10:00'), 12 * 60 + 10);
  assert.equal(gs.parseTime_('10시 30분'), 630);
  assert.equal(gs.parseTime_(''), null);
  assert.deepEqual({ ...gs.parseSchedule_('10:00-20:00') }, { start: 600, end: 1200 });
  assert.deepEqual({ ...gs.parseSchedule_('12:00 ~ 21:30') }, { start: 720, end: 1290 });
  assert.deepEqual({ ...gs.parseSchedule_('10-20') }, { start: 600, end: 1200 });
  assert.equal(gs.parseSchedule_('휴무'), null);
  assert.equal(gs.parseSchedule_(''), null);
  assert.equal(gs.parseDate_('2026. 11. 3'), '2026-11-03');
  assert.equal(gs.parseDate_('2026-11-18'), '2026-11-18');
  assert.equal(gs.dowOf_('2026-11-16'), 1);
  assert.equal(gs.prevYm_('2026-01'), '2025-12');
});

test('지각·조퇴·차감 계산: 늦은 분만큼 시급으로 빼요', () => {
  const { gs } = createGas({ now: 0 });
  // 12,000원 시급, 7분 지각 → 1,400원
  assert.deepEqual({ ...gs.calc_('10:00', '20:00', '10:07', '20:00', 12000, 0) }, { late: 7, early: 0, work: 593, deduct: 1400 });
  // 유예 5분: 5분 늦으면 지각 아님, 6분이면 6분 전부 지각
  assert.equal(gs.calc_('10:00', '20:00', '10:05', '', 12000, 5).late, 0);
  assert.equal(gs.calc_('10:00', '20:00', '10:06', '', 12000, 5).late, 6);
  // 조퇴 30분 → 6,000원, 원 단위 버림
  assert.deepEqual({ ...gs.calc_('10:00', '20:00', '09:55', '19:30', 10320, 0) }, { late: 0, early: 30, work: 575, deduct: 5160 });
  assert.equal(gs.calc_('10:00', '20:00', '10:01', '', 10321, 0).deduct, 172); // 172.01 → 172
});

test('처음 설정: 탭들과 10분 알림이 만들어지고, 다시 실행해도 그대로예요', () => {
  const g = fresh();
  for (const n of ['설정', '매장', '직원', '근무변경', '출퇴근기록', '의심기록', '요청', '휴무표 2026-11', '휴무표 2026-12']) assert.ok(g.sheet(n), n);
  assert.equal(g.triggers.length, 1);
  g.gs.setup();
  assert.equal(g.triggers.length, 1);
  assert.equal(g.sheet('직원').rowDisplay(2)[0], '김민수');
  assert.equal(g.sheet('직원').rowDisplay(2)[2], '0123', 'PIN 앞의 0이 사라지면 안 돼요');
  assert.equal(g.book.getSheets().filter((x) => x.getName() === '휴무표 2026-11').length, 1, '다시 실행해도 휴무표는 한 장');
});

test('정시 출근 → 지각 출근 → 중복 출근 막기 → 퇴근', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  let r = punch(g, '김민수', '0123', 'in');
  assert.equal(r.time, '09:58');
  assert.equal(r.late, 0);

  g.setKst('2026-11-16 12:09');
  r = punch(g, '이지은', '5678', 'in'); // 비밀번호 없는 직원
  assert.equal(r.late, 9);

  g.setKst('2026-11-16 12:30');
  assert.throws(() => punch(g, '김민수', '0123', 'in'), /이미 09:58에 출근/);

  g.setKst('2026-11-16 20:03');
  r = punch(g, '김민수', '0123', 'out');
  assert.equal(r.work, 20 * 60 + 3 - (9 * 60 + 58));
  assert.equal(r.early, 0);

  const log = g.sheet('출퇴근기록');
  assert.equal(log.getLastRow(), 3);
  const kim = log.rowDisplay(2);
  assert.deepEqual(kim.slice(0, 7), ['2026-11-16', '월', '김민수', '10:00', '20:00', '09:58', '20:03']);
  const lee = log.rowDisplay(3);
  assert.equal(lee[3], '12:00');
  assert.equal(lee[7], '9');
  assert.equal(lee[10], '1,548'); // 10,320 × 9 ÷ 60 = 1548
  assert.equal(lee[11], '', '가산은 아직 위치 등록 전이라 거리는 없어요');
  assert.match(lee[13], /매장 위치 미등록/, '대신 메모에 남아요');
  assert.ok(Number(kim[11]) > 0 && Number(kim[11]) < 60, '왕십리(등록됨)는 출근거리(m)가 남아요');
});

test('비밀번호: 틀리면 거절, 5번 틀리면 잠김', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:59');
  assert.throws(() => punch(g, '김민수', '123', 'in'), /비밀번호가 틀렸어요/);
  for (let i = 0; i < 4; i++) assert.throws(() => punch(g, '김민수', '1111', 'in'));
  assert.throws(() => punch(g, '김민수', '0123', 'in'), /잠겼어요/);
  g.cache.clear();
  assert.equal(punch(g, '김민수', '0123', 'in').time, '09:59');
});

test('퇴사자는 목록에도 없고 찍을 수도 없어요', () => {
  const g = fresh();
  const names = Array.from(g.gs.getStaffList().staff, (p) => p.name);
  assert.deepEqual(names, ['김민수', '이지은']);
  assert.throws(() => punch(g, '박퇴사', '9999', 'in'), /명단에 없는/);
});

test('위치 확인: 멀면 거절, 위치 없으면 거절, 기록만 모드면 통과', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:50');
  assert.throws(() => punch(g, '김민수', '0123', 'in', FAR), /떨어져 있어요/);
  assert.throws(() => punch(g, '김민수', '0123', 'in', null), /위치를 확인하지 못했어요/);
  // 실내 GPS 오차: 반경 100m + 오차 최대 100m까지 봐줘요
  const edge = { lat: 37.5665 + 0.0016, lng: 126.978, acc: 90 }; // 약 178m
  assert.equal(punch(g, '김민수', '0123', 'in', edge).time, '09:50');

  const g2 = fresh({ mode: '기록만' });
  g2.setKst('2026-11-16 09:50');
  assert.equal(punch(g2, '김민수', '0123', 'in', FAR).time, '09:50');
  assert.ok(Number(g2.sheet('출퇴근기록').rowDisplay(2)[11]) > 1000, '먼 거리도 기록은 남아요');
});

test('내 매장 위치가 등록 전이면 막지 않고 메모로 남겨요 (매장을 하나씩 등록하는 동안)', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.setKst('2026-11-16 10:55');
  assert.equal(punch(g, '예시직원', '1234', 'in', null).time, '10:55', '위치를 못 받아도 통과');
  assert.match(g.sheet('출퇴근기록').rowDisplay(2)[13], /매장 위치 미등록/);
  // [매장] 탭에 없는 매장 이름이고, 등록된 매장도 하나도 없으면 알려줘요
  g.sheet('직원').getRange(2, 2).setValue('없는매장');
  g.setKst('2026-11-17 10:55');
  assert.throws(() => punch(g, '예시직원', '1234', 'in'), /매장 위치를 등록하지 않았어요/);
});

test('일찍 퇴근, 퇴근 다시 찍기, 출근 없이 퇴근', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 19:40');
  let r = punch(g, '김민수', '0123', 'out');
  assert.equal(r.early, 20);
  g.setKst('2026-11-16 20:10');
  r = punch(g, '김민수', '0123', 'out');
  assert.equal(r.early, 0);
  let row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[6], '20:10');
  assert.match(row[13], /퇴근 다시 찍음\(이전 19:40\)/);

  g.setKst('2026-11-16 21:00');
  r = punch(g, '이지은', '5678', 'out');
  assert.equal(r.work, null);
  row = g.sheet('출퇴근기록').rowDisplay(3);
  assert.match(row[13], /출근 기록 없음/);
});

test('근무변경 시트가 요일 근무표보다 우선해요', () => {
  const g = fresh();
  g.sheet('근무변경').appendRow(['2026-11-16', '김민수', '13:00-21:00', '대타']);
  g.setKst('2026-11-16 12:55');
  const t = g.gs.getToday('김민수');
  assert.equal(t.sIn, '13:00');
  assert.equal(punch(g, '김민수', '0123', 'in').late, 0);

  g.sheet('근무변경').appendRow(['2026-11-17', '이지은', '휴무', '']);
  g.setKst('2026-11-17 09:00');
  assert.equal(g.gs.getToday('이지은').sIn, '');
});

test('사장님 오늘 화면: 상태를 맞게 보여줘요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:03');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:20');
  const r = g.gs.adminToday('777777');
  const by = Object.fromEntries(r.list.map((p) => [p.name, p]));
  assert.equal(by['김민수'].status, '근무중');
  assert.equal(by['김민수'].late, 3);
  assert.equal(by['이지은'].status, '미출근');
  assert.deepEqual(plain(r.info.stores.map((x) => [x.name, x.hasPlace, x.open, x.staff])), [['왕십리', true, '10:00', 1], ['가산', false, '12:00', 1]]);
  assert.deepEqual(plain(r.list.map((x) => x.store)), ['왕십리', '가산'], '매장 순서대로');
  assert.equal(r.info.weakPin, false);
  assert.throws(() => g.gs.adminToday('0000'), /관리자 비밀번호가 틀렸어요/);

  g.setKst('2026-11-21 11:00'); // 토요일: 김민수 휴무
  const sat = Object.fromEntries(g.gs.adminToday('777777').list.map((p) => [p.name, p]));
  assert.equal(sat['김민수'].status, '휴무');
  assert.equal(sat['이지은'].status, '출근 전');
});

test('월별 합계, 내 기록, 정산 시트', () => {
  const g = fresh();
  const day = (d, tin, tout) => {
    g.setKst(`2026-11-${d} ${tin}`); punch(g, '김민수', '0123', 'in');
    if (tout) { g.setKst(`2026-11-${d} ${tout}`); punch(g, '김민수', '0123', 'out'); }
  };
  day('16', '10:00', '20:00');
  day('17', '10:12', '20:00'); // 12분 지각 → 2,400원
  day('18', '09:50', null); // 퇴근 안 찍음
  g.setKst('2026-11-19 09:00');

  const mine = g.gs.getMyMonth('김민수', '0123', '');
  assert.equal(mine.ym, '2026-11');
  assert.equal(mine.rows.length, 3);
  assert.equal(mine.total.days, 3);
  assert.equal(mine.total.lateCount, 1);
  assert.equal(mine.total.lateMin, 12);
  assert.equal(mine.total.deduct, 2400);
  assert.equal(mine.total.noOut, 1);
  assert.equal(mine.total.work, 600 + 588);
  assert.throws(() => g.gs.getMyMonth('김민수', '', ''), /비밀번호/);

  const m = g.gs.adminMonth('777777', '2026-11');
  const kim = m.staff.find((s) => s.name === '김민수');
  assert.equal(kim.deduct, 2400);
  assert.ok(m.staff.find((s) => s.name === '이지은'), '기록이 없어도 재직자는 보여요');
  assert.ok(!m.staff.find((s) => s.name === '박퇴사'));

  const ex = g.gs.adminExport('777777', '2026-11');
  assert.equal(ex.name, '정산 2026-11');
  const sh = g.sheet('정산 2026-11');
  const kimRow = sh.rowDisplay(2);
  assert.equal(kimRow[0], '김민수');
  assert.equal(kimRow[1], '왕십리', '정산 시트에 매장 칸');
  assert.equal(kimRow[3], '19시간 48분');
  assert.equal(kimRow[7], '2,400');
  assert.equal(sh.rowDisplay(5)[0], '날짜');
  assert.equal(sh.rowDisplay(6)[5], '10:00', '정산 시트의 시간도 그대로 보여요');
  // 다시 만들어도 한 벌만
  g.gs.adminExport('777777', '2026-11');
  assert.equal(g.book.getSheets().filter((s) => s.getName() === '정산 2026-11').length, 1);
});

test('사장님이 시트에서 출근 시간을 고치면 지각·차감이 다시 계산돼요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  punch(g, '김민수', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  assert.equal(log.rowDisplay(2)[7], '30');
  // 사장님이 손으로 10:05로 고침 (텍스트 칸이라 글자 그대로 들어가요)
  log.getRange(2, 6).setValue('10:05');
  g.gs.onEdit({ range: log.getRange(2, 6) });
  const row = log.rowDisplay(2);
  assert.equal(row[7], '5');
  assert.equal(row[10], '1,000');
});

test('시트 칸 서식이 시간으로 바뀌어 있어도(오전/오후 표시) 제대로 읽어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  log.setFmt(2, 6, ''); // 누가 서식을 '자동'으로 바꿈
  log.getRange(2, 6).setValue('10:20');
  assert.equal(log.rowDisplay(2)[5], '오전 10:20:00');
  g.gs.onEdit({ range: log.getRange(2, 6) });
  assert.equal(log.rowDisplay(2)[7], '20');
  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민수', '0123', 'out').late, 20);
});

test('미출근 메일: 기준 시간이 지나면 한 번만 보내요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:05');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0, '아직 10분 안 지남');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].body, /김민수 \(출근 예정 10:00\)/);
  assert.doesNotMatch(g.mails[0].body, /이지은/);
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1, '같은 날 같은 사람은 한 번만');
  g.setKst('2026-11-16 12:15');
  punch(g, '이지은', '5678', 'in');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1, '찍은 사람은 메일 안 감');

  const quiet = fresh();
  quiet.setKst('2026-11-16 10:30');
  quiet.gs.checkMissing();
  assert.equal(quiet.mails.length, 0, '알림이메일이 비어 있으면 안 보냄');
});

test('기록이 1000줄을 넘어도 계속 써져요', () => {
  const g = fresh();
  const log = g.sheet('출퇴근기록');
  const filler = Array.from({ length: 998 }, (_, i) => ['2026-10-01', '수', 'x' + i, '', '', '10:00', '20:00', '', '', 600, '', '', '', '']);
  log.getRange(2, 1, filler.length, 14).setNumberFormats(filler.map(() => g.gs.LOG_FMT)).setValues(filler);
  assert.equal(log.getLastRow(), 999);
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:00');
  punch(g, '이지은', '5678', 'in');
  assert.equal(log.getLastRow(), 1001);
  const last = log.rowDisplay(1001);
  assert.equal(last[2], '이지은');
  assert.equal(last[0], '2026-11-16', '새로 늘어난 줄도 날짜가 글자 그대로 보여요');
  assert.equal(last[5], '12:00', '새로 늘어난 줄도 시간이 글자 그대로 보여요');
});

test('시트 메뉴용 함수는 웹 화면에서 부르면 막혀요', () => {
  const g = fresh();
  assert.throws(() => g.gs.menuExportThis(), /getUi/);
  assert.equal(g.sheet('정산 2026-11'), null);
});

test('폰 등록: 처음 찍은 폰이 등록되고, 그 폰으로만 찍혀요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  const staff = g.sheet('직원');
  assert.match(staff.rowDisplay(2)[12], /^#aaaaaaaaaaaaaaaa iPhone 사파리 · 11\/16 등록$/);

  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민수', '0123', 'out').time, '20:00', '같은 폰은 통과');
});

test('동료 폰으로 대신 찍기: 다른 직원 폰이면 거절하고 기록·메일', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:01');
  // 김민수가 이지은 비밀번호를 알고 자기 폰으로 대신 찍으려 함
  assert.throws(() => punch(g, '이지은', '5678', 'in', NEAR, PHONE['김민수']), /김민수 님 폰으로 등록돼 있어요/);
  assert.equal(g.gs.getToday('이지은').tIn, '', '출근이 안 찍혀요');
  assert.deepEqual(suspects(g).at(-1).slice(1, 3), ['이지은', '다른 직원 폰']);
  assert.match(suspects(g).at(-1)[3], /김민수 님 폰으로 찍으려 함/);
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /이지은 · 다른 직원 폰/);
  assert.equal(g.sheet('직원').rowDisplay(3)[12], '', '이지은 폰으로 등록되지도 않아요');
});

test('새 폰: 거절 → 사장님 승인 → 새 폰만 통과, 예전 폰은 거절', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');

  const NEW = 'eeeeeeeeeeeeeeee';
  g.setKst('2026-11-17 09:59');
  assert.throws(() => punch(g, '김민수', '0123', 'in', NEAR, NEW, 'Android 크롬'), /새 폰 승인을 요청했어요/);
  assert.throws(() => punch(g, '김민수', '0123', 'in', NEAR, NEW, 'Android 크롬'), /새 폰 승인/);
  assert.equal(g.mails.length, 1, '같은 폰으로 여러 번 눌러도 메일은 한 번');
  assert.equal(suspects(g).filter((s) => s[2] === '새 폰 승인 요청').length, 2, '시도는 매번 남아요');
  assert.match(suspects(g).at(-1)[3], /Android 크롬 \(등록된 폰: iPhone 사파리\)/);

  const today = g.gs.adminToday('777777');
  assert.equal(today.pending.length, 1);
  assert.equal(today.pending[0].name, '김민수');
  assert.match(today.pending[0].label, /Android 크롬 · 11\/17 09:59 요청/);
  assert.equal(today.suspects.length, 2);

  const after = g.gs.adminDevice('777777', '김민수', true);
  assert.equal(after.pending.length, 0);
  assert.match(after.devices.find((d) => d.name === '김민수').label, /Android 크롬 · 11\/17 승인/);
  assert.equal(g.sheet('직원').rowDisplay(2)[13], '', '요청 칸은 비워져요');

  g.setKst('2026-11-17 10:02');
  assert.equal(punch(g, '김민수', '0123', 'in', NEAR, NEW).late, 2);
  g.setKst('2026-11-17 20:00');
  assert.throws(() => punch(g, '김민수', '0123', 'out', NEAR, PHONE['김민수']), /등록된 폰이 아니에요/);
});

test('새 폰 거절, 관리자 비밀번호 틀림', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  assert.throws(() => punch(g, '김민수', '0123', 'out', NEAR, 'ffffffffffffffff'));
  assert.throws(() => g.gs.adminDevice('1111', '김민수', false), /관리자 비밀번호/);
  assert.equal(suspects(g).at(-1)[2], '관리자 비밀번호 틀림');
  g.gs.adminDevice('777777', '김민수', false);
  assert.equal(g.gs.adminToday('777777').pending.length, 0);
  assert.match(g.sheet('직원').rowDisplay(2)[12], /aaaaaaaaaaaaaaaa/, '등록폰은 그대로');
  assert.throws(() => g.gs.adminDevice('777777', '김민수', true), /승인 대기 중인 폰이 없어요/);
});

test('다른 직원 폰을 승인하려 하면 막아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  punch(g, '이지은', '5678', 'in', NEAR, PHONE['이지은']);
  // 이지은 줄에 김민수 폰 번호로 요청이 생긴 상황(시트를 손으로 고친 경우 등)
  g.sheet('직원').getRange(3, 14).setValue('#aaaaaaaaaaaaaaaa iPhone 사파리 · 11/16 12:00 요청');
  assert.throws(() => g.gs.adminDevice('777777', '이지은', true), /김민수 님 폰으로 등록돼 있어서/);
});

test('폰 번호가 없으면(시크릿 모드 등) 거절, 폰확인=안함이면 통과', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  assert.throws(() => punch(g, '김민수', '0123', 'in', NEAR, ''), /시크릿/);
  assert.equal(suspects(g).at(-1)[2], '폰 확인 안 됨');
  g.gs.setSetting_('폰확인', '안함');
  assert.equal(punch(g, '김민수', '0123', 'in', NEAR, '').time, '09:58');
});

test('의심기록: 비밀번호 틀림, 매장 밖, 위치 없음, 기록만 모드의 매장 밖', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:50');
  assert.throws(() => punch(g, '김민수', '9999', 'in'));
  assert.throws(() => punch(g, '김민수', '0123', 'in', FAR));
  assert.throws(() => punch(g, '김민수', '0123', 'in', null));
  const s = suspects(g);
  assert.deepEqual(s.map((x) => x[2]), ['비밀번호 틀림', '매장 밖', '위치 없음']);
  assert.equal(s[0][0], '2026-11-16 09:50');
  assert.match(s[1][3], /가장 가까운 매장\(왕십리\)에서 1\.5km \(GPS 오차 20m\)/);

  g.gs.setSetting_('위치확인', '기록만');
  g.setKst('2026-11-16 09:55');
  assert.equal(punch(g, '김민수', '0123', 'in', FAR).time, '09:55');
  assert.equal(suspects(g).at(-1)[2], '매장 밖에서 찍음');
  assert.equal(g.gs.adminToday('777777').suspects[0].kind, '매장 밖에서 찍음', '최근 것이 위에');
});

test('예전 버전 시트에 setup을 다시 돌리면 등록폰 칸과 의심기록 탭이 생겨요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const old = g.book.insertSheet('직원');
  old.getRange(1, 1, 2, 11).setValues([
    ['이름', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직'],
    ['김민수', '1234', 12000, '10:00-20:00', '', '', '', '', '', '', ''],
  ]);
  g.gs.setup();
  assert.deepEqual(plain(old.rowDisplay(1).slice(11, 14)), ['매장', '등록폰', '새폰요청'], '없는 칸은 오른쪽 끝에 붙어요');
  assert.ok(g.sheet('의심기록'));
  assert.ok(g.sheet('매장'));
  const kim = g.gs.staff_()[0];
  assert.equal(kim.name, '김민수', '기존 직원은 그대로');
  assert.equal(kim.pin, '1234', '칸 순서가 달라도 머리글 이름으로 읽어요');
  assert.equal(kim.week[1], '10:00-20:00');
});

/* ───── 정정·휴무·대타 요청, 텔레그램 ───── */

const req = (g, name, pin, kind, extra = {}) => g.gs.makeRequest({ name, pin, kind, ...extra });
const reqRows = (g) => {
  const sh = g.sheet('요청');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r));
  return out;
};
// 휴무표 그날 칸
const mark = (g, name, date) => { g.gs.GRID_ = {}; return g.gs.dayMark_(name, date); };
const changeRows = (g) => {
  const sh = g.sheet('근무변경');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};

test('정정 요청: 퇴근을 깜빡함 → 사장님 승인 → 기록에 반영', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:03');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-17 09:40');
  const r = req(g, '김민수', '0123', 'fix', { date: '2026-11-16', type: 'out', time: '20:05', reason: '마감하다 깜빡함' });
  assert.equal(r.mine.length, 1);
  assert.equal(r.mine[0].state, '대기');
  assert.equal(r.mine[0].what, '퇴근 20:05');
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /\[왕십리\] 김민수 · 기록 정정 요청/);
  assert.match(g.mails[0].body, /사유: 마감하다 깜빡함/);

  const t = g.gs.adminToday('777777');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].before, '', '퇴근 기록이 원래 없었어요');
  g.gs.adminRequest('777777', t.requests[0].id, true);

  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[6], '20:05');
  assert.equal(row[9], String(20 * 60 + 5 - (10 * 60 + 3)), '근무시간이 다시 계산돼요');
  assert.match(row[13], /정정 승인: 퇴근 20:05 마감하다 깜빡함/);
  assert.equal(reqRows(g)[0][7], '승인');
  assert.equal(g.gs.adminToday('777777').requests.length, 0);
});

test('정정 요청: 출근 시간 고치기(이전 시간 남김), 기록이 없던 날도 새로 만들어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-18 12:00');
  req(g, '김민수', '0123', 'fix', { date: '2026-11-16', type: 'in', time: '09:58', reason: '폰이 꺼져서 늦게 찍음' });
  req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '10:00', reason: '출근 깜빡' });
  const ids = g.gs.adminToday('777777').requests.map((x) => x.id);
  assert.equal(g.gs.adminToday('777777').requests[0].before, '10:30');
  ids.forEach((id) => g.gs.adminRequest('777777', id, true));
  const log = g.sheet('출퇴근기록');
  const d16 = log.rowDisplay(2);
  assert.equal(d16[5], '09:58');
  assert.equal(d16[7], '', '지각이 없어졌어요');
  assert.match(d16[13], /이전 10:30/);
  const d17 = log.rowDisplay(3);
  assert.deepEqual(d17.slice(0, 6), ['2026-11-17', '화', '김민수', '10:00', '20:00', '10:00']);
});

test('정정 요청 검사: 미래, 14일 넘음, 사유 없음, 같은 요청 중복, 비밀번호', () => {
  const g = fresh();
  g.setKst('2026-11-18 12:00');
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-18', type: 'out', time: '20:00', reason: 'x' }), /아직 지나지 않은 시간/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-19', type: 'out', time: '10:00', reason: 'x' }), /14일 전까지/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-01', type: 'out', time: '10:00', reason: 'x' }), /14일 전까지/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: ' ' }), /사유/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '8시', reason: 'x' }), /시간을 넣어/);
  assert.throws(() => req(g, '김민수', '1111', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: 'x' }), /비밀번호/);
  req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: 'x' });
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:10', reason: 'x' }), /이미 있어요/);
  req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '10:00', reason: 'x' }); // 출근은 따로 돼요
  assert.equal(reqRows(g).length, 2);
});

test('휴무 요청: 승인하면 휴무표 그날 칸에 휴무가 들어가요, 거절·취소', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-21', reason: '병원' }), /원래 근무가 없는 날/); // 토요일
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-15', reason: '병원' }), /60일 안/);
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-20', reason: '' }), /사유/);
  req(g, '김민수', '0123', 'off', { date: '2026-11-20', reason: '병원' });
  assert.throws(() => req(g, '김민수', '0123', 'swap', { date: '2026-11-20' }), /이미 휴무 요청/);

  const id = g.gs.adminToday('777777').requests[0].id;
  g.gs.adminRequest('777777', id, true);
  assert.equal(mark(g, '김민수', '2026-11-20'), '휴무');
  assert.equal(changeRows(g).length, 0, '근무변경은 안 건드려요');
  g.setKst('2026-11-20 09:00');
  assert.equal(g.gs.getToday('김민수').sIn, '', '그날은 휴무');
  assert.throws(() => g.gs.adminRequest('777777', id, false), /이미 승인된/);

  g.setKst('2026-11-16 15:00');
  const r2 = req(g, '김민수', '0123', 'off', { date: '2026-11-19', reason: '가족 행사' });
  g.gs.adminRequest('777777', r2.mine[0].id, false);
  const r3 = req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '개인 사정' });
  const after = g.gs.cancelRequest('김민수', '0123', r3.mine[0].id);
  assert.deepEqual(plain(after.mine.map((x) => x.state)), ['취소', '거절', '승인']);
  assert.equal(mark(g, '김민수', '2026-11-19'), '', '거절은 휴무표를 안 바꿔요');
  assert.equal(mark(g, '김민수', '2026-11-18'), '', '취소도 휴무표를 안 바꿔요');
});

test('월차·반차 신청: 승인하면 휴무표에 그대로 적혀요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  const a = req(g, '김민수', '0123', 'off', { offType: '월차', date: '2026-11-19', reason: '병원' });
  assert.equal(a.mine[0].kind, '월차');
  assert.match(g.mails.at(-1).subject, /김민수 · 월차 요청/);
  assert.match(g.mails.at(-1).body, /10:00-20:00 근무 → 월차/);
  const b = req(g, '김민수', '0123', 'off', { offType: '반차', date: '2026-11-20', reason: '오후 병원' });
  assert.throws(() => req(g, '김민수', '0123', 'off', { offType: '휴무', date: '2026-11-20', reason: 'x' }), /이미 반차 요청/);
  g.gs.adminRequest('777777', a.mine[0].id, true);
  g.gs.adminRequest('777777', b.mine[0].id, true);
  assert.equal(mark(g, '김민수', '2026-11-19'), '월차');
  assert.equal(mark(g, '김민수', '2026-11-20'), '반차');
  g.setKst('2026-11-20 13:30');
  const t = g.gs.getToday('김민수');
  assert.equal(t.sIn, '', '반차 날은 지각을 안 봐요');
  assert.equal(punch(g, '김민수', '0123', 'in').late, 0);
});

test('대타: 구함 → 동료 수락 → 사장님 승인 → 두 사람 근무표가 바뀌어요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  // 11/20(금) 김민수 10:00-20:00 → 이지은이 대신 (이지은도 금요일 12:00-21:00 근무 → 합쳐서 10:00-21:00)
  const a = req(g, '김민수', '0123', 'swap', { date: '2026-11-20', reason: '집안일' });
  assert.equal(a.mine[0].what, '10:00-20:00');
  assert.match(g.mails.at(-1).subject, /김민수 · 대타 구하는 중/);

  assert.throws(() => g.gs.adminRequest('777777', a.mine[0].id, true), /아직 대타를 해줄 동료가 없어요/);

  const seen = g.gs.getRequests('이지은', '5678');
  assert.equal(seen.swaps.length, 1);
  assert.equal(seen.swaps[0].reason, '', '동료에게는 사유를 안 보여줘요');
  assert.equal(g.gs.getRequests('김민수', '0123').swaps.length, 0, '내 요청은 대타 목록에 안 떠요');
  assert.throws(() => g.gs.takeSwap('김민수', '0123', a.mine[0].id), /본인 요청/);

  const b = g.gs.takeSwap('이지은', '5678', a.mine[0].id);
  assert.equal(b.mine[0].taker, '이지은');
  assert.equal(b.swaps.length, 0);
  assert.match(g.mails.at(-1).subject, /대타 수락/);
  assert.match(g.mails.at(-1).body, /이지은 님은 그날 원래 12:00-21:00 근무라서/);
  assert.throws(() => g.gs.takeSwap('박퇴사', '9999', a.mine[0].id), /명단에 없는/);

  const t = g.gs.adminToday('777777').requests[0];
  assert.equal(t.state, '수락');
  assert.match(t.note, /두 시간을 합쳐요/);
  g.gs.adminRequest('777777', t.id, true);
  assert.equal(mark(g, '김민수', '2026-11-20'), '휴무', '요청한 사람은 휴무표에 휴무');
  assert.equal(mark(g, '이지은', '2026-11-20'), '대타', '대타는 휴무표에 대타');
  assert.deepEqual(plain(changeRows(g)), [
    ['2026-11-20', '이지은', '10:00-21:00', '김민수 님 대신 대타 (원래 12:00-21:00 근무와 합침)'],
  ], '대타 시간은 근무변경에');
  g.setKst('2026-11-20 09:00');
  assert.equal(g.gs.getToday('이지은').sIn, '10:00');
  assert.equal(g.gs.getToday('김민수').sIn, '');
});

test('대타: 수락한 사람이 취소하면 다시 구하는 중, 요청자가 취소하면 끝', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  const a = req(g, '이지은', '5678', 'swap', { date: '2026-11-17' }); // 화요일 12:00-21:00
  const id = a.mine[0].id;
  g.gs.takeSwap('김민수', '0123', id);
  g.gs.cancelRequest('김민수', '0123', id);
  assert.equal(g.gs.getRequests('김민수', '0123').swaps.length, 1, '다시 대타 목록에 떠요');
  g.gs.cancelRequest('이지은', '5678', id);
  assert.equal(g.gs.getRequests('김민수', '0123').swaps.length, 0);
  assert.throws(() => g.gs.takeSwap('김민수', '0123', id), /끝난 요청/);
});

test('오늘 대타가 승인되면 이미 찍은 출근 기록의 예정 시간도 바뀌어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:00');
  const a = req(g, '이지은', '5678', 'swap', { date: '2026-11-16' }); // 월 12:00-21:00
  g.gs.takeSwap('김민수', '0123', a.mine[0].id);
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.gs.adminRequest('777777', a.mine[0].id, true);
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.deepEqual(row.slice(2, 6), ['김민수', '10:00', '21:00', '10:00']);
  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민수', '0123', 'out').early, 60, '바뀐 퇴근 예정(21:00) 기준으로 조퇴 계산');
});

test('텔레그램: 토큰 저장 → 연결 확인 → 알림이 텔레그램으로, 끊기면 메일로', () => {
  const g = fresh({ email: 'owner@example.com' });
  assert.throws(() => g.gs.adminTelegram('777777', 'abc'), /토큰 모양/);
  assert.throws(() => g.gs.adminTelegram('777777', '123456789:' + 'x'.repeat(32) + 'BAD'), /텔레그램 오류: Unauthorized/);
  const TOKEN = '123456789:' + 'A'.repeat(35);
  const r = g.gs.adminTelegram('777777', TOKEN);
  assert.equal(r.bot, 'goodphone_test_bot');
  assert.equal(r.info.tg, '토큰만');

  assert.match(r.code, /^\d{6}$/, '사장님 채팅방을 찾을 연결 코드');
  assert.throws(() => g.gs.adminTelegramLink('777777'), /봇에게 온 연결 코드가 없어요/);
  g.tg.updates.push({ update_id: 0, message: { chat: { id: 999, type: 'private' }, text: 'hi' } });
  g.tg.updates.push({ update_id: 1, message: { chat: { id: 555111, type: 'private' }, text: '/start own' + r.code } });
  g.tg.updates.push({ update_id: 2, message: { chat: { id: 998, type: 'private' }, text: '안녕하세요' } });
  const info = g.gs.adminTelegramLink('777777');
  assert.equal(info.tg, '연결됨');
  assert.equal(g.tg.sent.at(-1).chat_id, 555111);
  assert.match(g.tg.sent.at(-1).text, /알림이 연결됐어요/);

  // 미출근 알림이 메일 대신 텔레그램으로
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0);
  assert.match(g.tg.sent.at(-1).text, /아직 출근 안 찍은 직원 1명/);
  assert.match(g.tg.sent.at(-1).text, /사장님 화면: https:\/\/script\.google\.com\/macros\/s\/TEST\/exec\?page=admin/);
  assert.equal(g.tg.sent.at(-1).chat_id, '555111');

  // 텔레그램이 안 되면 메일로
  g.tg.down = true;
  g.setKst('2026-11-16 12:20');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /아직 출근 안 찍은 직원/);

  g.gs.adminTelegramOff('777777');
  assert.equal(g.gs.adminToday('777777').info.tg, '');
});

test('텔레그램만 연결하고 메일이 없어도 미출근 알림이 가요', () => {
  const g = fresh();
  g.gs.setSetting_('텔레그램토큰', '123456789:' + 'A'.repeat(35));
  g.gs.setSetting_('텔레그램채팅ID', '777');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(g.tg.sent.length, 1);
});

test('시트와 따로 만든 스크립트(SHEET_ID): 그 시트를 열고, 시트 고침 감지를 직접 연결해요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.SHEET_ID = 'SHEET123';
  g.gs.setup();
  assert.ok(g.openedIds.includes('SHEET123'));
  assert.deepEqual(g.triggers.map((t) => [t.getHandlerFunction(), t.kind]), [['checkMissing', 'time'], ['sheetEdited', 'edit']]);
  g.gs.setup();
  assert.equal(g.triggers.length, 2, '다시 실행해도 두 개만');

  // sheetEdited 로도 다시 계산돼요
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setSetting_('폰확인', '안함');
  g.setKst('2026-11-16 10:30');
  g.gs.punch({ name: '예시직원', pin: '1234', type: 'in', agree: true });
  const log = g.sheet('출퇴근기록');
  assert.equal(log.rowDisplay(2)[3], '11:00', '매장 기본 출근 11:00');
  log.getRange(2, 6).setValue('11:05');
  g.gs.sheetEdited({ range: log.getRange(2, 6) });
  assert.equal(log.rowDisplay(2)[7], '5');
  assert.equal(mark(g, '예시직원', '2026-11-16'), '11:05', '고친 시간이 휴무표에도 적혀요');
});

test('같은 순간에 보낸 요청도 번호가 겹치지 않아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  for (const d of ['17', '18', '19', '20']) req(g, '김민수', '0123', 'off', { date: `2026-11-${d}`, reason: '개인' });
  const ids = reqRows(g).map((r) => r[0]);
  assert.equal(new Set(ids).size, 4, ids.join(','));
});

test('한 파일 버전(dist/Code.gs): 최신이고, 화면과 기능이 그대로 돌아가요', () => {
  const fs = require('fs');
  const path = require('path');
  const { bundle } = require('../build');
  const dist = path.join(__dirname, '..', 'dist', 'Code.gs');
  assert.equal(fs.readFileSync(dist, 'utf8'), bundle(), 'dist/Code.gs 가 예전 거예요. node attendance/build.js 를 실행하세요.');

  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00'), file: dist });
  const staff = g.gs.doGet({ parameter: {} });
  const admin = g.gs.doGet({ parameter: { page: 'admin' } });
  assert.equal(staff.title, '출퇴근');
  assert.equal(admin.title, '출퇴근 관리');
  assert.equal(staff.html, fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8'));
  assert.equal(admin.html, fs.readFileSync(path.join(__dirname, '..', 'Admin.html'), 'utf8'));

  g.gs.setup();
  g.gs.setSetting_('관리자PIN', '777777');
  g.gs.adminSetPlace('777777', '본점', 37.5665, 126.978);
  g.setKst('2026-11-16 11:02');
  assert.equal(g.gs.punch({ name: '예시직원', pin: '1234', type: 'in', ...NEAR, device: 'dddddddddddddddd', label: 'x', agree: true }).late, 2);
});

test('원본(Code.gs)은 HTML 파일을 그대로 써요', () => {
  const g = createGas({ now: 0 });
  assert.equal(g.gs.doGet({ parameter: { page: 'admin' } }).file, 'Admin');
  assert.equal(g.gs.doGet({}).file, 'Index');
});

/* ───── 매장 여러 곳 · 휴무표 · 첫 비밀번호 ───── */

const monthRowOf = (g, ym, name) => {
  const sh = g.sheet('휴무표 ' + ym);
  for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[2] === name) return { r, v: sh.rowDisplay(r) };
  return null;
};

test('휴무표: 지각하면 그날 칸에 출근 시간이 자동으로 적히고, 정시면 안 적혀요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:07');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-17 09:59');
  punch(g, '김민수', '0123', 'in');
  assert.equal(mark(g, '김민수', '2026-11-16'), '10:07');
  assert.equal(mark(g, '김민수', '2026-11-17'), '');
  const row = monthRowOf(g, '2026-11', '김민수');
  assert.ok(row, '휴무표에 김민수 줄이 자동으로 생겨요');
  assert.equal(row.v[1], '왕십리');
  assert.equal(row.v[9 + 15], '10:07', '16일 칸(J열부터 1일)');
  assert.ok(!monthRowOf(g, '2026-11', '박퇴사'), '퇴사자는 휴무표에 안 들어가요');
});

test('휴무표: 수식(휴무에 반차 0.5, 월차 이월·잔여, 지각)이 들어가고 아웃 칸은 없어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:07');
  punch(g, '김민수', '0123', 'in');
  const { r } = monthRowOf(g, '2026-11', '김민수');
  const f = g.sheet('휴무표 2026-11').getRange(r, 4, 1, 7).getValues()[0];
  assert.equal(f[0], `=COUNTIF(J${r}:AN${r},"*휴무*")+COUNTIF(J${r}:AN${r},"*휴가*")+0.5*COUNTIF(J${r}:AN${r},"*반차*")`);
  assert.equal(f[1], `=COUNTIF(J${r}:AN${r},"*월차*")`);
  assert.equal(f[2], 0, '11월은 앞 달 탭이 없어서 이월 0');
  assert.equal(f[3], 1, '부여 1');
  assert.equal(f[4], `=F${r}+G${r}-E${r}`);
  assert.equal(f[5], `=SUMPRODUCT(--ISNUMBER(SEARCH(":",J${r}:AN${r})))`);
  assert.equal(f[6], '', '아웃 칸은 없어요(J열은 1일)');
  // 12월 탭은 11월 탭을 이어 받아요. 20일부터 10분마다 도는 작업이 다음 달 탭에 직원 줄을 채워요
  assert.ok(g.sheet('휴무표 2026-12'), '처음 설정 때 다음 달 탭도 만들어 둬요');
  assert.ok(!monthRowOf(g, '2026-12', '김민수'), '설정 뒤에 넣은 직원은 아직 없음');
  g.setKst('2026-11-20 09:00');
  g.gs.checkMissing();
  const dec = monthRowOf(g, '2026-12', '김민수');
  assert.ok(dec);
  const d = g.sheet('휴무표 2026-12').getRange(dec.r, 6, 1, 1).getValues()[0];
  assert.equal(d[0], `=IFERROR(VLOOKUP($C${dec.r},'휴무표 2026-11'!$C:$H,6,FALSE),0)`);
  // 머리글: 11/1 은 일요일
  const h = g.sheet('휴무표 2026-11');
  assert.equal(h.rowDisplay(1)[8], '지각');
  assert.equal(h.rowDisplay(1)[9], '11/1');
  assert.equal(h.rowDisplay(2)[9], '일');
  assert.equal(h.rowDisplay(1)[9 + 29], '11/30');
  assert.equal(h.rowDisplay(1)[9 + 30], '', '11월은 30일까지');
  assert.equal(h.rowDisplay(1)[40], '메모');
  assert.ok(!h.rowDisplay(1).includes('아웃'));
  assert.match(h.cfRules[0].calls.find((c) => c[0] === 'whenFormulaSatisfied')[1], /SEARCH\(":",J3\)/, '지각 빨간 글씨 규칙도 J열 기준');
  const texts = Array.from(h.cfRules, (x) => (x.calls.find((c) => c[0] === 'whenTextContains') || [])[1]);
  assert.deepEqual(texts, [undefined, '결근', '대타', '반차', '월차', '대체', '휴무?', '휴', undefined], '지각 빨강·결근?·대타·반차·월차·대체·고른 휴무·휴무 색칠·오늘 머리글');
  assert.match(h.cfRules.at(-1).calls.find((c) => c[0] === 'whenFormulaSatisfied')[1], /TEXT\(J\$1,"M\/D"\)=TEXT\(TODAY\(\),"M\/D"\)/);
});

test('휴무표: 해가 바뀌어도 월차 이월은 이어 받아요', () => {
  const g = fresh();
  g.setKst('2026-12-21 09:00');
  g.gs.checkMissing(); // 20일이 지나면 다음 달 탭을 미리 만들어요
  assert.ok(g.sheet('휴무표 2027-01'));
  const jan = monthRowOf(g, '2027-01', '김민수');
  const v = g.sheet('휴무표 2027-01').getRange(jan.r, 6, 1, 1).getValues()[0];
  assert.match(String(v[0]), /'휴무표 2026-12'!\$C:\$H/);
});

test('예전 휴무표(아웃 칸이 있는 탭)도 머리글로 칸을 찾아서 그대로 읽고 써요', () => {
  const g = fresh();
  // 아웃 칸(J)이 있는 예전 모양의 11월 탭을 직접 만들어요: J 아웃, K부터 1일, AP 메모
  const sh = g.sheet('휴무표 2026-11'); // setup 이 만든 탭을 비우고 예전 모양으로 다시 써요
  sh.clear();
  if (sh.getMaxColumns() < 42) sh.insertColumnsAfter(sh.getMaxColumns(), 42 - sh.getMaxColumns());
  const head = ['No', '매장', '이름', '휴무', '월차', '이월', '부여', '잔여', '지각', '아웃'];
  for (let d = 1; d <= 31; d++) head.push(d <= 30 ? '11/' + d : '');
  head.push('메모');
  sh.getRange(1, 1, 1, 42).setValues([head]);
  sh.getRange(3, 1, 1, 42).setNumberFormat('@');
  const row = ['1', '왕십리', '김민수', '', '', '', '', '', '', '=IF(I3>2,1,0)+3'];
  for (let d = 1; d <= 31; d++) row.push(d === 18 ? '월차' : '');
  row.push('');
  sh.getRange(3, 1, 1, 42).setValues([row]);
  assert.equal(mark(g, '김민수', '2026-11-18'), '월차', '18일 칸을 정확히 읽어요');
  g.setKst('2026-11-17 10:05');
  punch(g, '김민수', '0123', 'in');
  assert.equal(sh.rowDisplay(3)[10 + 16], '10:05', '17일 칸(K열부터 1일)에 써요');
  assert.equal(sh.rowDisplay(3)[9], '=IF(I3>2,1,0)+3', '아웃 칸은 안 건드려요');
});

test('휴무표에 휴무·월차가 적힌 날은 쉬는 날: 지각·미출근 알림 없음, 사장님 화면에 표시', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:00');
  g.gs.adminToday('777777'); // 휴무표 줄 만들기
  g.gs.ensureMonth_('2026-11');
  const { r } = monthRowOf(g, '2026-11', '김민수');
  g.sheet('휴무표 2026-11').getRange(r, 10 + 17).setValue('월차'); // 11/18 (J열이 1일)
  g.setKst('2026-11-18 10:30');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0, '월차인 날은 미출근 알림 없음');
  const t = g.gs.adminToday('777777').list.find((x) => x.name === '김민수');
  assert.equal(t.status, '휴무');
  assert.equal(t.mark, '월차');
  assert.equal(punch(g, '김민수', '0123', 'in').late, 0, '쉬는 날 나와서 찍어도 지각 아님');
  assert.equal(mark(g, '김민수', '2026-11-18'), '월차', '휴무표의 월차는 그대로');
});

test('매장 기본 시간: 요일 칸이 비어 있으면 매장 출근 시간, 요일 칸이 있으면 그 시간(사무실)', () => {
  const g = fresh();
  g.sheet('매장').getRange(4, 1, 1, 2).setValues([['사무실', '']]);
  g.sheet('직원').getRange(5, 1, 1, 14).setValues([['오사무', '사무실', '1111', '', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '휴무', '휴무', '', '', '']]);
  g.sheet('직원').getRange(6, 1, 1, 3).setValues([['시간미정', '사무실', '2222']]);
  g.setKst('2026-11-16 09:00');
  assert.equal(g.gs.getToday('오사무').sIn, '09:00');
  const st = Object.fromEntries(g.gs.adminToday('777777').list.map((x) => [x.name, x.status]));
  assert.equal(st['시간미정'], '시간 미정', '근무시간이 안 정해진 사무실 직원은 휴무가 아니라 시간 미정');
  assert.equal(st['오사무'], '출근 전');
  assert.equal(g.gs.getToday('이지은').sIn, '12:00', '가산 기본 12:00');
  assert.equal(g.gs.getToday('이지은').sOut, '21:00');
  g.setKst('2026-11-21 09:00');
  assert.equal(g.gs.getToday('오사무').sIn, '', '토요일 휴무');
  // 퇴근 시간이 없는 매장은 조퇴를 안 봐요
  g.sheet('매장').getRange(2, 3).setValue('');
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 15:00');
  const out = punch(g, '김민수', '0123', 'out');
  assert.equal(out.early, 0);
  assert.equal(out.work, 300);
});

test('다른 매장에서 찍어도 돼요(지원 근무): 가장 가까운 매장 이름이 기록에 남아요', () => {
  const g = fresh();
  g.gs.adminSetPlace('777777', '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-16 09:55');
  punch(g, '김민수', '0123', 'in', { ...GASAN, acc: 10 });
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[14], '가산', '찍은매장');
  assert.equal(row[3], '10:00', '지각 기준은 내 근무시간');
  assert.throws(() => g.gs.adminSetPlace('777777', '없는매장', 1, 1), /없는 매장/);
});

test('첫 비밀번호: 처음 쓰는 직원은 찍을 때 정한 번호가 비밀번호가 돼요', () => {
  const g = fresh();
  g.sheet('직원').getRange(3, 3).setValue(''); // 이지은 PIN 비움
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '이지은').pin, false);
  g.setKst('2026-11-16 11:58');
  assert.throws(() => punch(g, '이지은', '', 'in'), /처음 쓰시는군요/);
  assert.throws(() => punch(g, '이지은', '12', 'in'), /4자리/);
  g.gs.adminSetPlace('777777', '가산', GASAN.lat, GASAN.lng);
  assert.throws(() => punch(g, '이지은', '1357', 'in', { lat: 37.7, lng: 126.978, acc: 10 }), /떨어져 있어요/);
  assert.equal(g.sheet('직원').rowDisplay(3)[2], '', '찍기가 실패하면 비밀번호도 저장 안 해요');
  assert.throws(() => g.gs.getRequests('이지은', '2468'), /먼저 출근을 한 번 찍어서/);
  assert.equal(punch(g, '이지은', '2468', 'in').time, '11:58');
  assert.equal(g.sheet('직원').rowDisplay(3)[2], '2468');
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '이지은').pin, true);
  g.setKst('2026-11-16 21:00');
  assert.throws(() => punch(g, '이지은', '1111', 'out'), /비밀번호가 틀렸어요/);
  assert.equal(punch(g, '이지은', '2468', 'out').time, '21:00');
});

test('새로 들어온 직원은 휴무표에 자동으로 줄이 생겨요', () => {
  const g = fresh();
  g.gs.ensureMonth_('2026-11');
  assert.ok(monthRowOf(g, '2026-11', '김민수'));
  g.sheet('직원').getRange(5, 1, 1, 3).setValues([['신입', '가산', '1357']]);
  g.setKst('2026-11-16 12:10');
  punch(g, '신입', '1357', 'in', NEAR, 'eeeeeeeeeeeeeeee');
  const row = monthRowOf(g, '2026-11', '신입');
  assert.ok(row);
  assert.equal(row.v[9 + 15], '12:10');
});

test('직원 목록은 매장 순서대로, 매장 이름도 같이 줘요', () => {
  const g = fresh();
  g.sheet('직원').getRange(5, 1, 1, 3).setValues([['나중왕', '왕십리', '1357']]);
  const l = g.gs.getStaffList();
  assert.deepEqual(plain(l.stores), ['왕십리', '가산']);
  assert.deepEqual(plain(l.staff.map((x) => x.name + '@' + x.store)), ['김민수@왕십리', '나중왕@왕십리', '이지은@가산']);
});

test('매장·직원을 미리 채워 둔 시트에 setup: 데이터는 그대로, 휴무표에 재직자만 매장 순서로', () => {
  const g = createGas({ now: Date.parse('2026-11-19T22:00:00+09:00') });
  const st = g.book.insertSheet('매장');
  st.getRange(1, 1, 4, 7).setNumberFormat('@'); // 구글 시트 API로 글자 그대로 넣은 것처럼
  st.getRange(1, 1, 4, 7).setValues([
    ['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모'],
    ['왕십리', '11:00', '', '', '', '', ''],
    ['청주', '11:00', '', '', '', '', ''],
    ['사무실(창)', '', '', '', '', '', '직원마다 달라요'],
  ]);
  const sf = g.book.insertSheet('직원');
  sf.getRange(1, 1, 5, 14).setValues([
    ['이름', '매장', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청'],
    ['김예지', '청주', '', '', '', '', '', '', '', '', '', '퇴사', '', ''],
    ['이기석', '사무실(창)', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['김태인', '청주', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['김권일', '왕십리', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.gs.setup();
  assert.equal(st.rowDisplay(2)[1], '11:00', '매장 데이터 그대로');
  const names = [];
  const m = g.sheet('휴무표 2026-11');
  for (let r = 3; r <= m.getLastRow(); r++) names.push(m.rowDisplay(r)[1] + ':' + m.rowDisplay(r)[2]);
  assert.deepEqual(names, ['왕십리:김권일', '청주:김태인', '사무실(창):이기석'], '퇴사자 빼고 매장 순서대로');
  assert.ok(g.sheet('휴무표 2026-12'));
  assert.equal(g.gs.getToday('김권일').sIn, '11:00');
  assert.equal(g.gs.getToday('이기석').sIn, '', '사무실은 시간을 정하기 전까지 비어 있어요');
});


/* ───── v2: 11시 몰림 · 다른 매장 · 동의 · 비밀번호 · 퇴근 누락 ───── */

test('다른 매장에서 찍으면 통과는 되지만 의심기록과 메모에 남아요(대타·근무변경이 있으면 안 남겨요)', () => {
  const g = fresh();
  g.gs.adminSetPlace('777777', '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in', { ...GASAN, acc: 10 });
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[14], '가산');
  assert.match(row[13], /다른 매장\(가산\)/);
  assert.deepEqual(plain(suspects(g).at(-1).slice(1, 3)), ['김민수', '다른 매장에서 찍음']);
  const t = g.gs.adminToday('777777').list.find((x) => x.name === '김민수');
  assert.equal(t.place, '가산', '사장님 화면에 어디서 찍었는지 보여요');
  // 근무변경이 잡힌 날은 계획된 지원 근무라 의심기록 없음
  g.sheet('근무변경').appendRow(['2026-11-17', '김민수', '12:00-21:00', '가산 지원']);
  const before = suspects(g).length;
  g.setKst('2026-11-17 11:58');
  punch(g, '김민수', '0123', 'in', { ...GASAN, acc: 10 });
  assert.equal(suspects(g).length, before);
});

test('처음 한 번 동의해야 찍혀요. 동의한 날짜가 [직원] 동의 칸에 남아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  const bare = { name: '김민수', pin: '0123', type: 'in', ...NEAR, device: PHONE['김민수'], label: 'x' };
  assert.throws(() => g.gs.punch(bare), /동의가 필요해요/);
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '김민수').agreed, false);
  g.gs.punch({ ...bare, agree: true });
  assert.equal(g.sheet('직원').rowDisplay(2)[14], '2026-11-16 09:58');
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '김민수').agreed, true);
  g.setKst('2026-11-16 20:00');
  assert.equal(g.gs.punch({ ...bare, type: 'out' }).time, '20:00', '한 번 동의하면 다음부터는 안 물어요');
});

test('예전 [직원] 탭에 동의 칸이 없어도, 처음 동의할 때 칸을 알아서 붙여요', () => {
  const g = fresh();
  const sh = g.sheet('직원');
  sh.getRange(1, 15, 1, 2).setValues([['', '']]); // 동의·텔레그램 머리글이 없던 예전 시트처럼
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  assert.equal(sh.rowDisplay(1)[14], '동의');
  assert.equal(sh.rowDisplay(2)[14], '2026-11-16 09:58');
});

test('기록 시간은 누른 순간: 줄이 너무 길면 오류 대신 "다시 눌러주세요"', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:59');
  g.setLockBusy(true);
  assert.throws(() => punch(g, '김민수', '0123', 'in'), /잠깐 밀렸어요. 다시 한 번 눌러주세요/);
  g.setLockBusy(false);
  assert.equal(punch(g, '김민수', '0123', 'in').time, '10:59');
});

test('쉬운 비밀번호(1234 등)나 3명 이상 같은 번호면 바꾸라고 알려줘요', () => {
  const g = fresh();
  g.sheet('직원').getRange(2, 3).setValue('1234');
  g.setKst('2026-11-16 09:58');
  assert.equal(punch(g, '김민수', '1234', 'in').weakPin, true);
  assert.equal(punch(g, '이지은', '5678', 'in').weakPin, false);
  g.sheet('직원').getRange(2, 3).setValue('5678');
  g.sheet('직원').getRange(4, 3).setValue('5678'); // 박퇴사(퇴사자도 같은 번호면 셈)
  assert.equal(g.gs.getHome('이지은', '5678').weakPin, true, '셋이 같은 번호');
});

test('직원이 직접 비밀번호 바꾸기', () => {
  const g = fresh();
  assert.throws(() => g.gs.changePin('김민수', '9999', '2468'), /비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.changePin('김민수', '0123', '12'), /4~6자리/);
  assert.throws(() => g.gs.changePin('김민수', '0123', '0123'), /지금 비밀번호와 같아요/);
  assert.throws(() => g.gs.changePin('김민수', '0123', '1234'), /너무 쉬운 번호/);
  g.gs.changePin('김민수', '0123', '2468');
  assert.equal(g.sheet('직원').rowDisplay(2)[2], '2468');
  g.setKst('2026-11-16 09:58');
  assert.throws(() => punch(g, '김민수', '0123', 'in'), /비밀번호가 틀렸어요/);
  assert.equal(punch(g, '김민수', '2468', 'in').time, '09:58');
});

test('사장님이 비밀번호를 미리 정하거나 초기화하고, 폰 등록도 지울 수 있어요', () => {
  const g = fresh();
  g.sheet('직원').getRange(3, 3).setValue(''); // 이지은 PIN 비움
  let t = g.gs.adminToday('777777');
  assert.equal(t.devices.find((d) => d.name === '이지은').pin, '미정');
  t = g.gs.adminSetPin('777777', '이지은', '0581');
  assert.equal(t.devices.find((d) => d.name === '이지은').pin, '정함');
  assert.equal(g.sheet('직원').rowDisplay(3)[2], '0581', '앞의 0도 그대로');
  assert.throws(() => g.gs.adminSetPin('777777', '이지은', '12a4'), /4~6자리/);
  assert.equal(g.gs.adminSetPin('777777', '이지은', '1234').devices.find((d) => d.name === '이지은').pin, '쉬움');
  // 잠긴 직원도 사장님이 비밀번호를 다시 정하면 풀려요
  for (let i = 0; i < 5; i++) assert.throws(() => punch(g, '이지은', '0000', 'in'));
  assert.throws(() => punch(g, '이지은', '1234', 'in'), /잠겼어요/);
  g.gs.adminSetPin('777777', '이지은', '7351');
  g.setKst('2026-11-16 11:59');
  assert.equal(punch(g, '이지은', '7351', 'in').time, '11:59');
  // 폰 초기화
  assert.match(g.sheet('직원').rowDisplay(3)[12], /bbbb/);
  g.gs.adminResetDevice('777777', '이지은');
  assert.equal(g.sheet('직원').rowDisplay(3)[12], '');
  assert.throws(() => g.gs.adminSetPin('1111', '이지은', '5555'), /관리자 비밀번호/);
});

test('직원 화면 한 번에 불러오기: 오늘·요청·퇴근 누락(정정 요청 보내면 사라짐)·비밀번호 오류', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-17 09:50');
  let h = g.gs.getHome('김민수', '0123');
  assert.equal(h.today.sIn, '10:00');
  assert.deepEqual(plain(h.missingOut), { date: '2026-11-16', dow: '월', tIn: '10:00' });
  assert.ok(h.requests);
  req(g, '김민수', '0123', 'fix', { date: '2026-11-16', type: 'out', time: '20:00', reason: '깜빡' });
  h = g.gs.getHome('김민수', '0123');
  assert.equal(h.missingOut, null, '정정 요청을 보냈으면 안 보여요');
  assert.equal(h.requests.mine.length, 1);
  const bad = g.gs.getHome('김민수', '9999');
  assert.match(bad.pinError, /비밀번호가 틀렸어요/);
  assert.equal(bad.requests, null);
  assert.equal(g.gs.getHome('김민수', '').requests, null, '비밀번호 없으면 오늘만');
});

test('밤(23시~7시)에는 미출근 알림 검사를 안 해요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.sheet('직원').getRange(2, 5, 1, 7).setValues([['06:00-15:00', '06:00-15:00', '06:00-15:00', '06:00-15:00', '06:00-15:00', '휴무', '휴무']]);
  g.setKst('2026-11-16 06:30');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0);
  g.setKst('2026-11-16 07:10');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
});

test('사장님 비밀번호가 6자리보다 짧으면 바꾸라고 알려줘요', () => {
  const g = fresh();
  assert.equal(g.gs.adminToday('777777').info.weakPin, false);
  g.gs.setSetting_('관리자PIN', '7777');
  assert.equal(g.gs.adminToday('7777').info.weakPin, true);
});

/* ───── v3: 점장 결재, 직원 텔레그램, 하루 마감, 근무표, 다음 달 휴무, 공휴일·대체휴무 ───── */

const MGR = { name: '박점장', pin: '2468' };
const TOKEN = '123456789:' + 'A'.repeat(35);
PHONE.박점장 = 'eeeeeeeeeeeeeeee';
PHONE.최유나 = 'ffffffffffffffff';
// fresh() + 왕십리 점장 박점장, 가산 직원 최유나. 점장은 [매장] 점장 칸(8번째)에 이름을 적어요
function v3(opts = {}) {
  const g = fresh(opts);
  g.sheet('직원').getRange(5, 1, 2, 14).setValues([
    ['박점장', '왕십리', '2468', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '1357', 10320, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박점장');
  g.gs.setup(); // 새 직원 줄을 휴무표에
  return g;
}
const ROW = { 김민수: 2, 이지은: 3, 박점장: 5, 최유나: 6 };
// 텔레그램: 사장님 채팅 555, chats = {이름: 직원 채팅 번호}
const tgOn = (g, chats = {}) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const [n, id] of Object.entries(chats)) g.gs.setStaffCell_(ROW[n], '텔레그램', id);
};
const sentTo = (g, chat) => g.tg.sent.filter((m) => String(m.chat_id) === String(chat)).map((m) => m.text);
const setting = (g, key) => {
  const sh = g.sheet('설정');
  for (let r = 2; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === key) return sh.rowDisplay(r)[1];
  return undefined;
};

test('결재: 직원 → 점장(관리자에게 올리기) → 관리자 승인, 단계마다 알림', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 박점장: '9005', 김민수: '9002' });
  g.setKst('2026-11-16 15:00');
  const list = g.gs.getStaffList();
  assert.deepEqual(plain(list.mgr), { 왕십리: '박점장' });
  assert.deepEqual(plain(list.managers), ['박점장']);

  req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '병원' });
  assert.equal(reqRows(g)[0][10], '점장', '점장이 있는 매장은 점장에게 먼저');
  assert.match(sentTo(g, 9005).at(-1), /\[왕십리\] 김민수 · 휴무 요청/);
  assert.match(sentTo(g, 9005).at(-1), /관리자에게 올리기/);
  assert.equal(sentTo(g, 555).length, 0, '사장님께는 점장이 올리면 가요');

  const t = g.gs.adminToday(MGR);
  assert.equal(t.role, 'manager');
  assert.equal(t.me, '박점장');
  assert.deepEqual(Array.from(t.list, (p) => p.name), ['김민수', '박점장'], '자기 매장 직원만');
  assert.equal(t.devices.length, 0, '폰·비밀번호 관리는 관리자만');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].route, '점장');
  assert.throws(() => g.gs.adminRequest(MGR, t.requests[0].id, true), /관리자\(사장님\)만/, '점장은 승인 못 해요');

  const t2 = g.gs.mgrForward(MGR, t.requests[0].id, '그날 인원 괜찮아요');
  assert.equal(t2.requests[0].route, '관리자');
  const row = reqRows(g)[0];
  assert.equal(row[10], '관리자');
  assert.equal(row[11], '올림 11/16 15:00 박점장 · 그날 인원 괜찮아요');
  assert.match(sentTo(g, 555).at(-1), /김민수 · 휴무 요청 \(점장 확인\)/);
  assert.match(sentTo(g, 555).at(-1), /점장 박점장: 그날 인원 괜찮아요/);
  assert.throws(() => g.gs.mgrForward(MGR, t.requests[0].id, ''), /이미 관리자에게 올라간/);
  assert.equal(g.gs.getRequests('김민수', '0123').mine[0].route, '관리자', '직원 화면에도 단계가 보여요');

  g.gs.adminRequest('777777', t.requests[0].id, true);
  assert.equal(mark(g, '김민수', '2026-11-18'), '휴무');
  assert.match(sentTo(g, 9002).at(-1), /휴무 요청이 승인됐어요/);
  assert.equal(g.mails.length, 0, '텔레그램이 되면 메일은 안 가요');
});

test('결재: 점장이 돌려보내면 직원에게 이유가 가고, 고쳐서 다시 보낼 수 있어요', () => {
  const g = v3();
  tgOn(g, { 김민수: '9002' });
  g.setKst('2026-11-16 15:00');
  req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '병원', offType: '월차' });
  const id = reqRows(g)[0][0];
  assert.throws(() => g.gs.mgrReturn(MGR, id, '  '), /이유를 적어주세요/);
  g.gs.mgrReturn(MGR, id, '그날 교육이라 다른 날로');
  const mine = g.gs.getRequests('김민수', '0123').mine[0];
  assert.equal(mine.state, '돌려보냄');
  assert.equal(mine.mgr, '돌려보냄 11/16 15:00 박점장 · 그날 교육이라 다른 날로');
  assert.match(sentTo(g, 9002).at(-1), /월차 요청을 점장이 돌려보냈어요/);
  assert.match(sentTo(g, 9002).at(-1), /이유: 그날 교육이라 다른 날로/);
  assert.throws(() => g.gs.mgrReturn(MGR, id, '또'), /점장이 돌려보낸 요청/);
  assert.throws(() => g.gs.adminRequest('777777', id, true), /점장이 돌려보낸 요청/);
  req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '병원', offType: '월차' });
  assert.equal(reqRows(g).length, 2, '같은 날 다시 보낼 수 있어요');
  assert.equal(g.gs.adminToday('777777').requests.length, 1, '돌려보낸 건 관리자 목록에서 빠져요');
});

test('결재: 관리자에게 바로, 점장 본인 요청, 점장이 알림을 안 켰으면 사장님께도', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '병원', to: 'admin' });
  assert.equal(reqRows(g)[0][10], '관리자');
  assert.match(g.mails.at(-1).subject, /\[왕십리\] 김민수 · 휴무 요청$/);
  assert.match(g.mails.at(-1).body, /사장님 화면에서 승인해주세요/);
  assert.throws(() => g.gs.mgrForward(MGR, reqRows(g)[0][0], ''), /이미 관리자에게/);

  req(g, '박점장', '2468', 'off', { date: '2026-11-19', reason: '개인' });
  assert.equal(reqRows(g)[1][10], '관리자', '점장 본인 요청은 관리자에게');

  req(g, '김민수', '0123', 'off', { date: '2026-11-20', reason: '개인' });
  assert.equal(reqRows(g)[2][10], '점장');
  assert.match(g.mails.at(-1).subject, /\(점장 확인 전\)/);
  assert.match(g.mails.at(-1).body, /박점장 점장이 텔레그램 알림을 안 켜서/);

  req(g, '이지은', '5678', 'off', { date: '2026-11-17', reason: '개인' });
  assert.equal(reqRows(g)[3][10], '관리자', '점장이 없는 매장(가산)은 관리자에게');
});

test('점장 화면: 자기 매장만 보고, 관리자 기능은 막혀요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:07');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 15:00');
  req(g, '이지은', '5678', 'off', { date: '2026-11-17', reason: '개인' });
  const t = g.gs.adminToday(MGR);
  assert.equal(t.requests.length, 0, '다른 매장 요청은 안 보여요');
  assert.deepEqual(Array.from(t.info.stores, (s) => s.name), ['왕십리']);
  assert.equal(t.info.sheetUrl, '', '시트 주소도 안 줘요');
  assert.equal(t.info.role, 'manager');
  const m = g.gs.adminMonth(MGR, '2026-11');
  assert.deepEqual(Array.from(m.staff, (s) => s.name), ['김민수', '박점장']);
  assert.equal(m.staff[0].lateCount, 1);
  assert.equal(m.staff[0].deduct, 0, '점장 화면에는 차감액이 없어요');
  assert.equal(m.noMoney, true);
  assert.equal(g.gs.adminMonth('777777', '2026-11').staff[0].deduct, 1400);
  for (const f of [() => g.gs.adminSetPin(MGR, '김민수', '4321'), () => g.gs.adminResetDevice(MGR, '김민수'),
    () => g.gs.adminDevice(MGR, '김민수', true), () => g.gs.adminExport(MGR, '2026-11'),
    () => g.gs.adminTelegram(MGR, TOKEN), () => g.gs.adminConfirmWishes(MGR, '')]) {
    assert.throws(f, /관리자\(사장님\)만/);
  }
  g.gs.adminSetPlace(MGR, '왕십리', 37.5, 127.0);
  assert.equal(g.gs.stores_()[0].lat, 37.5);
  assert.throws(() => g.gs.adminSetPlace(MGR, '가산', 37.5, 127.0), /점장님 매장만/);
  assert.throws(() => g.gs.adminToday({ name: '김민수', pin: '0123' }), /점장으로 등록돼 있지 않아요/);
  assert.throws(() => g.gs.adminToday({ name: '박점장', pin: '0000' }), /비밀번호가 틀렸어요/);
  assert.equal(suspects(g).at(-1)[2], '점장 화면 비밀번호 틀림');
  assert.equal(g.gs.adminToday('777777').role, 'admin');
});

test('직원 텔레그램 알림 켜기: 링크 → [시작] → 연결 확인. 사장님 연결은 직원 메시지를 건너뛰어요', () => {
  const g = v3();
  assert.throws(() => g.gs.staffTgStart('김민수', '0123'), /아직 텔레그램 알림을 연결하지 않았어요/);
  assert.equal(g.gs.getHome('김민수', '0123').tg, '', '사장님이 봇을 연결하기 전엔 안 보여요');
  const own = g.gs.adminTelegram('777777', TOKEN);
  assert.equal(own.info.tgBot, 'goodphone_test_bot');
  assert.equal(g.gs.getHome('김민수', '0123').tg, 'off');
  assert.throws(() => g.gs.staffTgStart('김민수', '1111'), /비밀번호가 틀렸어요/);
  const s = g.gs.staffTgStart('김민수', '0123');
  assert.match(s.url, /^https:\/\/t\.me\/goodphone_test_bot\?start=g[0-9a-f]{15}$/);
  const code = s.url.split('start=')[1];
  assert.throws(() => g.gs.staffTgCheck('김민수', '0123'), /아직 연결 전이에요/);
  g.tg.updates.push({ update_id: 10, message: { chat: { id: 9002, type: 'private' }, text: '/start ' + code } });
  assert.equal(g.gs.staffTgCheck('김민수', '0123').tg, 'on');
  assert.equal(g.gs.getHome('김민수', '0123').tg, 'on');
  assert.equal(g.gs.staff_().find((p) => p.name === '김민수').tg, '9002');
  assert.match(sentTo(g, 9002).at(-1), /알림 연결 완료/);
  assert.throws(() => g.gs.staffTgCheck('김민수', '0123'), /연결 시간\(30분\)이 지났어요/, '코드는 한 번만');

  // 사장님 연결 확인: 연결 코드가 맞는 메시지만 봐요(같은 때 직원이 봇에게 말을 걸어도 잘못 연결되지 않아요)
  assert.throws(() => g.gs.adminTelegramLink('777777'), /봇에게 온 연결 코드가 없어요/);
  g.tg.updates.push({ update_id: 11, message: { chat: { id: 555, type: 'private' }, text: '/start ' + own.code } });
  g.tg.updates.push({ update_id: 12, message: { chat: { id: 9002, type: 'private' }, text: '고마워요' } });
  g.tg.updates.push({ update_id: 13, message: { chat: { id: 9007, type: 'private' }, text: '/start' } });
  g.tg.updates.push({ update_id: 14, message: { chat: { id: 9008, type: 'private' }, text: '/start g0123456789abcde' } });
  assert.equal(g.gs.adminTelegramLink('777777').tg, '연결됨');
  assert.equal(setting(g, '텔레그램채팅ID'), '555');
  assert.throws(() => g.gs.adminTelegramLink('777777'), /연결 코드 시간/, '코드는 한 번만');
  // 단톡방: 봇을 초대하고 그 방에 '/start@봇이름 코드'
  const code2 = g.gs.adminTelegramCode('777777').code;
  g.tg.updates.push({ update_id: 15, message: { chat: { id: -100777, type: 'group' }, text: '/start@goodphone_test_bot ' + code2 } });
  assert.equal(g.gs.adminTelegramLink('777777').tg, '연결됨');
  assert.equal(setting(g, '텔레그램채팅ID'), '-100777');

  assert.equal(g.gs.staffTgOff('김민수', '0123').tg, 'off');
  assert.equal(g.gs.getHome('김민수', '0123').tg, 'off');
  g.gs.adminTelegramOff('777777');
  assert.equal(setting(g, '텔레그램봇'), '');
});

test('직원 알림: 대타 구함은 같은 매장 동료에게, 수락·승인 결과는 당사자에게', () => {
  const g = v3();
  tgOn(g, { 김민수: '9002', 박점장: '9005', 이지은: '9003' });
  g.setKst('2026-11-16 15:00');
  req(g, '김민수', '0123', 'swap', { date: '2026-11-18', to: 'admin' });
  assert.match(sentTo(g, 9005).at(-1), /동료가 대타를 구해요/);
  assert.match(sentTo(g, 9005).at(-1), /11\/18\(수\) 10:00-20:00 · 김민수 님 대신/);
  assert.equal(sentTo(g, 9003).length, 0, '다른 매장(가산) 직원에게는 안 가요');
  const id = reqRows(g)[0][0];
  g.gs.takeSwap('박점장', '2468', id);
  assert.match(sentTo(g, 9002).at(-1), /대타를 구했어요/);
  assert.match(sentTo(g, 555).at(-1), /대타 수락 · 승인해주세요/);
  g.gs.adminRequest('777777', id, true);
  assert.match(sentTo(g, 9002).at(-1), /대타 요청이 승인됐어요/);
  assert.match(sentTo(g, 9005).at(-1), /대타가 승인됐어요/);
  assert.match(sentTo(g, 9005).at(-1), /근무가 확정됐어요/);
});

test('출근 알림: 텔레그램을 켠 직원에게 출근 20분 전 한 번, 안 찍으면 본인에게도', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민수: '9002' });
  g.setKst('2026-11-16 09:35');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 0, '25분 전이라 아직');
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /곧 출근이에요/);
  assert.match(sentTo(g, 9002).at(-1), /오늘 10:00 출근 \(왕십리\)/);
  g.setKst('2026-11-16 09:55');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 1, '한 번만');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /아직 출근을 안 찍었어요/);
  assert.match(sentTo(g, 555).at(-1), /아직 출근 안 찍은 직원 2명/);
  // 0으로 바꾸면 출근 전 알림은 안 가요
  g.gs.setSetting_('출근전알림(분)', '0');
  g.setKst('2026-11-17 09:45');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 2);
});

test('하루 마감 정리: 23:30 뒤 한 번. 결근?·퇴근 안 찍음·요약, 정정 승인하면 결근?이 바뀌어요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 이지은: '9003' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장', '2468', 'in');
  g.setKst('2026-11-16 20:01');
  punch(g, '박점장', '2468', 'out');
  g.setKst('2026-11-16 21:00');
  req(g, '최유나', '1357', 'fix', { date: '2026-11-16', type: 'in', time: '12:00', reason: '깜빡' });
  g.setKst('2026-11-16 23:10');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-16'), '', '23:30 전에는 정리 안 해요');
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-16'), '결근?');
  assert.equal(mark(g, '최유나', '2026-11-16'), '', '그날 요청을 보낸 사람은 빼요');
  assert.equal(mark(g, '박점장', '2026-11-16'), '');
  const sum = g.tg.sent.find((m) => String(m.chat_id) === '555' && /하루 마감 정리/.test(m.text));
  assert.ok(sum);
  assert.equal(sum.disable_notification, true, '밤이라 소리 없이');
  assert.match(sum.text, /11\/16\(월\) · 출근 2명/);
  assert.match(sum.text, /결근\? \(기록 없음\) 1명 → 휴무표에 "결근\?"으로 적었어요\n\[왕십리\] 김민수 \(예정 10:00\)/);
  assert.match(sum.text, /퇴근 안 찍음 1명\n\[가산\] 이지은 \(출근 12:03\)/);
  assert.match(sentTo(g, 9003).at(-1), /퇴근을 안 찍었어요/);
  const n = g.tg.sent.length;
  g.setKst('2026-11-16 23:45');
  g.gs.checkMissing();
  g.setKst('2026-11-17 02:00');
  g.gs.checkMissing();
  assert.equal(g.tg.sent.length, n, '한 번만');

  g.setKst('2026-11-17 10:00');
  req(g, '김민수', '0123', 'fix', { date: '2026-11-16', type: 'in', time: '10:05', reason: '폰 배터리' });
  g.gs.adminRequest('777777', reqRows(g).at(-1)[0], true);
  assert.equal(mark(g, '김민수', '2026-11-16'), '10:05', '결근?이 지각 시간으로 바뀌어요');
});

test('하루 마감 정리: 밤에 못 돌았으면 새벽에 어제 것을 해요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-17 00:50');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-16'), '결근?');
  assert.match(g.mails.at(-1).subject, /하루 마감 정리/);
  assert.match(g.mails.at(-1).body, /11\/16\(월\)/);
});

test('대체휴무: 쉬는 날 출근하면 쌓이고(반차 날은 빼요), 신청·승인하면 휴무표에 대체로 적고 써요', () => {
  const g = v3({ email: 'owner@example.com' });
  // 11/21(토): 김민수는 [직원] 토요일 칸이 휴무
  g.setKst('2026-11-21 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-21 19:00');
  punch(g, '김민수', '0123', 'out');
  g.gs.setMark_('2026-11-21', '박점장', () => '반차');
  g.setKst('2026-11-21 15:00');
  punch(g, '박점장', '2468', 'in');
  g.setKst('2026-11-21 20:00');
  punch(g, '박점장', '2468', 'out');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  const sub = g.sheet('대체휴무');
  assert.equal(sub.getLastRow(), 2, '김민수만 (박점장은 반차라 빼요)');
  assert.deepEqual(plain(sub.rowDisplay(2).slice(0, 4)), ['2026-11-21', '김민수', '적립', '1']);
  assert.match(sub.rowDisplay(2)[4], /휴무날 출근 9시간/);
  assert.match(g.mails.at(-1).body, /쉬는 날 출근 1명 → 대체휴무로 쌓았어요\n\[왕십리\] 김민수 9시간/);

  g.setKst('2026-11-22 10:00');
  assert.equal(g.gs.getSchedule('김민수', '0123', '2026-11').sum.sub, 1);
  req(g, '김민수', '0123', 'off', { offType: '대체', date: '2026-11-25', reason: '주말 근무 대신', to: 'admin' });
  assert.throws(() => req(g, '김민수', '0123', 'off', { offType: '대체', date: '2026-11-26', reason: '또' }),
    /쓸 수 있는 대체휴무가 없어요. \(남은 대체휴무 1일, 이미 신청한 1일\)/);
  g.gs.adminRequest('777777', reqRows(g).at(-1)[0], true);
  assert.equal(mark(g, '김민수', '2026-11-25'), '대체');
  assert.deepEqual(plain(sub.rowDisplay(3).slice(1, 4)), ['김민수', '사용', '1']);
  assert.equal(g.gs.getSchedule('김민수', '0123', '2026-11').sum.sub, 0);
  assert.equal(g.gs.adminToday('777777').devices.find((d) => d.name === '김민수').sub, 0);
  g.setKst('2026-11-25 10:30');
  assert.equal(g.gs.getToday('김민수').sIn, '', '대체로 쉬는 날은 근무 없음');
});

test('대체휴무 쌓기 설정: 휴무날·공휴일이면 공휴일 출근도(4시간 미만 0.5일), 안함이면 안 쌓아요', () => {
  const g = v3();
  g.gs.setSetting_('공휴일추가', '2026-11-18 회사창립일');
  g.setKst('2026-11-18 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-18 13:00');
  punch(g, '김민수', '0123', 'out');
  g.setKst('2026-11-18 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 1, '기본(휴무날만)은 공휴일 출근을 안 쌓아요');

  g.gs.setSetting_('공휴일추가', '2026-11-19 회사창립일');
  g.gs.setSetting_('대체휴무적립', '휴무날·공휴일');
  g.setKst('2026-11-19 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-19 13:00');
  punch(g, '김민수', '0123', 'out');
  g.setKst('2026-11-19 23:40');
  g.gs.checkMissing();
  assert.deepEqual(plain(g.sheet('대체휴무').rowDisplay(2).slice(0, 4)), ['2026-11-19', '김민수', '적립', '0.5']);
  assert.match(g.sheet('대체휴무').rowDisplay(2)[4], /공휴일\(회사창립일\) 출근 3시간/);

  g.gs.setSetting_('대체휴무적립', '안함');
  g.setKst('2026-11-21 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 2, '안함이면 쉬는 날 출근도 안 쌓아요');
});

test('공휴일: 휴무표 머리글을 빨갛게, 요일 칸 메모로 이름. 설정으로 더하고 빼요', () => {
  const g = v3();
  const dec = g.sheet('휴무표 2026-12');
  const col = (d) => 9 + d; // J열 = 1일
  assert.equal(dec.notes['2,' + col(25)], '12/25(금) 성탄절');
  assert.equal(dec.colors['1,' + col(25)], '#dc2626');
  assert.equal(dec.colors['2,' + col(25)], '#dc2626');
  assert.equal(dec.colors['1,' + col(26)], '#2563eb', '토요일은 파랑');
  assert.equal(dec.colors['1,' + col(24)], '#000000');
  g.gs.setSetting_('공휴일추가', '2026-12-31 회사휴무, 2026. 12. 24');
  g.gs.setSetting_('공휴일제외', '2026-12-25');
  g.gs.setup();
  assert.equal(dec.notes['2,' + col(25)], undefined, '뺀 공휴일은 메모도 지워져요');
  assert.equal(dec.colors['1,' + col(25)], '#000000');
  assert.equal(dec.notes['2,' + col(31)], '12/31(목) 회사휴무');
  assert.equal(dec.notes['2,' + col(24)], '12/24(목) 휴일');
  assert.ok(dec.notes['1,' + col(1)].includes('결근?'), '1일 머리글 메모(칸에 쓰는 말)는 그대로');
  g.setKst('2026-11-20 10:00');
  assert.deepEqual(plain(g.gs.getSchedule('김민수', '0123', '2026-12').holidays), { '2026-12-24': '휴일', '2026-12-31': '회사휴무' });
  assert.equal(g.gs.adminToday('777777').holiday, '');
  g.setKst('2026-12-31 10:00');
  assert.equal(g.gs.adminToday('777777').holiday, '회사휴무');
});

test('근무표 보기: 우리 매장 쉬는 날·대타는 보이고, 남의 지각·결근?은 안 보여요', () => {
  const g = v3();
  const nov = g.sheet('휴무표 2026-11');
  const put = (n, d, v) => nov.getRange(monthRowOf(g, '2026-11', n).r, 9 + d).setValue(v);
  put('박점장', 18, '휴무');
  put('박점장', 17, '결근?');
  put('박점장', 19, '10:12');
  put('박점장', 20, '대타 10:05');
  put('김민수', 16, '10:07');
  put('김민수', 23, '월차');
  put('김민수', 24, '반차');
  put('김민수', 25, '휴무');
  nov.getRange(monthRowOf(g, '2026-11', '김민수').r, 8).setValue('2'); // 잔여(시트에서는 수식 결과)
  g.setKst('2026-11-19 10:00');
  const s = g.gs.getSchedule('김민수', '0123', '');
  assert.equal(s.ym, '2026-11');
  assert.equal(s.days, 30);
  assert.equal(s.firstDow, 0, '11/1 일요일');
  assert.equal(s.store, '왕십리');
  assert.equal(s.me[15], '지각', '내 지각은 "지각"으로');
  assert.equal(s.me[20], '쉼', '토요일은 [직원] 요일 칸 휴무');
  assert.deepEqual(Array.from(s.others, (o) => o.name), ['박점장'], '같은 매장만');
  const park = s.others[0];
  assert.equal(park.days[17], '휴무');
  assert.equal(park.days[16], '', '남의 결근?은 안 보여요');
  assert.equal(park.days[18], '', '남의 지각 시간도');
  assert.equal(park.days[19], '대타');
  assert.equal(s.count[17], 1, '11/18 쉬는 사람 1명');
  assert.equal(s.count[20], 1, '11/21 토요일 김민수 정기 휴무');
  assert.equal(s.sum.off, 1.5, '휴무 1 + 반차 0.5');
  assert.equal(s.sum.monthly, 1);
  assert.equal(s.sum.monthlyLeft, 2);
  assert.equal(s.wish, null, '이번 달은 고르기 없음');
  assert.throws(() => g.gs.getSchedule('김민수', '0123', '2027-02'), /지난달·이번 달·다음 달만/);
  assert.throws(() => g.gs.getSchedule('김민수', '9999', ''), /비밀번호가 틀렸어요/);
});

test('다음 달 휴무 고르기: 기간·하루 인원·한 달 일수·금지일 규칙, 사장님이 확정', () => {
  const g = v3();
  g.setKst('2026-11-19 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-08', true), /12월 휴무는 11\/20~11\/25에만 고를 수 있어요/);
  assert.equal(g.gs.getSchedule('김민수', '0123', '2026-12').wish.open, false);
  g.setKst('2026-11-20 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-11-28', true), /다음 달\(12월\) 날짜만/);
  const s = g.gs.wishDay('김민수', '0123', '2026-12-08', true);
  assert.equal(mark(g, '김민수', '2026-12-08'), '휴무?');
  assert.equal(s.me[7], '휴무?');
  assert.equal(s.sum.wishes, 1);
  assert.equal(s.wish.open, true);
  assert.equal(s.wish.maxOff, 1);
  assert.equal(g.gs.wishDay('김민수', '0123', '2026-12-08', true).sum.wishes, 1, '두 번 눌러도 그대로');

  assert.throws(() => g.gs.wishDay('박점장', '2468', '2026-12-08', true), /12\/08\(화\)은 이미 김민수 님이 쉬어요. \(왕십리 하루 최대 1명\)/);
  g.gs.wishDay('이지은', '5678', '2026-12-08', true); // 다른 매장은 상관없어요
  g.sheet('매장').getRange(2, 9).setValue('2'); // 왕십리 최대휴무 2명
  g.gs.wishDay('박점장', '2468', '2026-12-08', true);

  g.sheet('매장').getRange(2, 10).setValue('2'); // 왕십리 월휴무 2일
  g.gs.wishDay('김민수', '0123', '2026-12-09', true);
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-10', true), /한 달에 휴무는 2일까지/);
  g.gs.wishDay('김민수', '0123', '2026-12-09', false);
  assert.equal(mark(g, '김민수', '2026-12-09'), '');

  g.gs.setSetting_('휴무금지일', '12/24, 2026-12-31');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-24', true), /휴무를 고를 수 없는 날/);
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-31', true), /휴무를 고를 수 없는 날/);
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-05', true), /원래 쉬는 날/);
  g.gs.setMark_('2026-12-15', '김민수', () => '월차');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-15', true), /이미 "월차"/);
  assert.deepEqual(plain(g.gs.getSchedule('김민수', '0123', '2026-12').wish.blocked), [24, 31]);

  const w = g.gs.adminWishes('777777');
  const ws = w.stores.find((x) => x.name === '왕십리');
  assert.deepEqual(plain(ws.rows.find((r) => r.name === '김민수').wish), [8]);
  assert.equal(ws.wishes, 2);
  assert.equal(ws.over.length, 0);
  g.sheet('매장').getRange(2, 9).setValue('1');
  assert.deepEqual(plain(g.gs.adminWishes('777777').stores[0].over), [{ day: 8, dow: '화', names: ['김민수', '박점장'] }], '하루 최대를 넘는 날');
  assert.deepEqual(Array.from(g.gs.adminWishes(MGR).stores, (x) => x.name), ['왕십리'], '점장은 자기 매장만');
  const c = g.gs.adminConfirmWishes('777777', '왕십리');
  assert.equal(c.confirmed, 2);
  assert.equal(mark(g, '김민수', '2026-12-08'), '휴무');
  assert.equal(mark(g, '박점장', '2026-12-08'), '휴무');
  assert.equal(mark(g, '이지은', '2026-12-08'), '휴무?', '가산은 그대로');
  assert.equal(mark(g, '김민수', '2026-12-15'), '월차', '다른 칸은 그대로');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-08', false), /확정된 거라 앱에서 못 빼요/);

  g.setKst('2026-11-26 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-11', true), /고를 기간이 지났어요/);
  g.gs.setSetting_('휴무신청기간', '');
  g.gs.wishDay('김민수', '0123', '2026-12-11', true);
  assert.equal(mark(g, '김민수', '2026-12-11'), '휴무?', '기간을 비우면 언제든');
});

test('휴무 요청 승인 화면: 그날 같은 매장에 이미 쉬는 사람을 알려줘요', () => {
  const g = v3();
  g.setKst('2026-11-16 15:00');
  g.gs.setMark_('2026-11-18', '박점장', () => '휴무');
  req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '병원' });
  const q = g.gs.adminToday('777777').requests[0];
  assert.equal(q.note, '그날 왕십리는 이미 박점장 님이 쉬어요 (하루 최대 1명을 넘어요)');
  assert.equal(q.store, '왕십리');
  assert.deepEqual(plain(q.managers), ['박점장']);
});

test('예전 시트에 setup: [매장] 점장·최대휴무·월휴무 칸, [요청] 보낼곳·점장확인 머리글, [대체휴무] 탭', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const st = g.book.insertSheet('매장');
  st.getRange(1, 1, 2, 7).setValues([['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모'], ['본점', '11:00', '', '', '', '', '']]);
  const rq = g.book.insertSheet('요청');
  rq.getRange(1, 1, 2, 10).setValues([['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시'],
    ['R1', '2026-11-15 10:00', '예시직원', '휴무', '2026-11-20', '11:00-', '개인', '대기', '', '']]);
  g.gs.setup();
  assert.deepEqual(plain(st.rowDisplay(1).slice(7, 10)), ['점장', '최대휴무', '월휴무']);
  assert.match(st.notes['1,8'], /점장 이름/);
  assert.deepEqual(plain(rq.rowDisplay(1).slice(10, 12)), ['보낼곳', '점장확인']);
  assert.ok(g.sheet('대체휴무'));
  g.gs.setSetting_('관리자PIN', '777777');
  const t = g.gs.adminToday('777777');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].route, '관리자', '예전 요청(보낼곳 빈칸)은 관리자에게');
  // [매장] 칸 순서를 바꿔도 머리글로 읽어요
  st.getRange(1, 1, 2, 3).setValues([['출근', '매장', '퇴근'], ['10:30', '본점', '19:00']]);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.stores_()[0].name, '본점');
  assert.equal(g.gs.stores_()[0].open, 630);
});

test('하루 마감 정리: 근무시간이 안 정해진 사람·고른 휴무(휴무?)에 출근하면 대체휴무를 안 쌓고, 공휴일엔 결근?을 안 적어요', () => {
  const g = v3({ email: 'owner@example.com' });
  // 사무실: [매장] 출근 시간 없음 + [직원] 요일 칸 비어 있음 = 시간 미정 (쉬는 날 아님)
  g.sheet('매장').getRange(4, 1, 1, 7).setValues([['사무실', '', '', '', '', '', '']]);
  g.sheet('직원').getRange(7, 1, 1, 14).setValues([['오사무', '사무실', '8080', 10320, '', '', '', '', '', '', '', '', '', '']]);
  g.gs.setup();
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setMark_('2026-11-17', '박점장', () => '휴무?');
  g.setKst('2026-11-17 11:00');
  punch(g, '오사무', '8080', 'in', null, 'gggggggggggggggg');
  punch(g, '박점장', '2468', 'in');
  g.setKst('2026-11-17 19:00');
  punch(g, '오사무', '8080', 'out', null, 'gggggggggggggggg');
  punch(g, '박점장', '2468', 'out');
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 1, '시간 미정·휴무?는 쉬는 날로 안 봐요');
  assert.doesNotMatch(g.mails.at(-1).body, /쉬는 날 출근/);

  // 공휴일: 기록이 없어도 결근?을 안 적고 요약에만
  g.gs.setSetting_('공휴일추가', '2026-11-18 회사창립일');
  g.setKst('2026-11-18 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-18'), '', '공휴일엔 매장이 쉬었을 수도 있어서 안 적어요');
  assert.match(g.mails.at(-1).body, /11\/18\(수\) 회사창립일 · 출근 0명/);
  assert.match(g.mails.at(-1).body, /공휴일에 아무도 출근 안 한 매장이라 결근\?으로 안 적음 \d명\n\[왕십리\] 김민수/);

  // 공휴일이어도 그 매장에 출근한 사람이 있으면 연 날로 봐서 평소처럼 적어요
  g.gs.setSetting_('공휴일추가', '2026-11-18 회사창립일, 2026-11-19 임시공휴일');
  g.setKst('2026-11-19 10:02');
  punch(g, '박점장', '2468', 'in');
  g.setKst('2026-11-19 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-19'), '결근?', '왕십리는 박점장이 출근해서 연 날');
  assert.equal(mark(g, '이지은', '2026-11-19'), '', '가산은 아무도 안 와서 쉰 날일 수 있어요');
});

/* ───── 테스트·휴무표 도구 ───── */

test('휴무표 만들기: 원하는 달을 바로 만들고(사이 달도 같이), 이미 있으면 빠진 직원만 넣어요', () => {
  const g = v3();
  g.setKst('2026-11-19 10:00');
  assert.ok(!g.sheet('휴무표 2027-02'));
  const r = g.gs.adminMakeMonth('777777', '2027.2');
  assert.equal(r.name, '휴무표 2027-02');
  assert.equal(r.created, true);
  assert.deepEqual(plain(r.made), ['휴무표 2027-01', '휴무표 2027-02'], '사이 달(1월)도 같이 만들어서 월차 이월이 이어져요');
  assert.equal(r.staff, 4);
  assert.equal(r.holidays, 4, '설 연휴 2/6~2/9');
  assert.match(r.url, /#gid=\d+$/);
  const row = monthRowOf(g, '2027-02', '김민수').r;
  assert.match(String(g.sheet('휴무표 2027-02').getRange(row, 6).getValues()[0][0]), /'휴무표 2027-01'/);
  assert.equal(g.sheet('휴무표 2027-02').notes['2,' + (9 + 7)], '02/07(일) 설날');
  g.sheet('직원').getRange(7, 1, 1, 2).setValues([['신입', '왕십리']]);
  const r2 = g.gs.adminMakeMonth('777777', '2027-02');
  assert.equal(r2.created, false);
  assert.equal(r2.added, 1, '이미 있으면 빠진 직원만');
  assert.ok(monthRowOf(g, '2027-02', '신입'));
  assert.throws(() => g.gs.adminMakeMonth('777777', '2028-01'), /앞뒤 12달/);
  assert.throws(() => g.gs.adminMakeMonth('777777', 'abc'), /달을 골라주세요/);
  assert.throws(() => g.gs.adminMakeMonth(MGR, '2027-01'), /관리자\(사장님\)만/);
});

test('마감 정리 미리 보기: 휴무표·장부를 안 바꾸고 아무에게도 안 보내요. 원하면 사장님 알림으로 받아요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-16 22:00');
  const r = g.gs.adminClosePreview('777777', 'today', false);
  assert.equal(r.date, '2026-11-16');
  assert.match(r.text, /결근\? \(기록 없음\) \d명/);
  assert.match(r.text, /퇴근 안 찍음 1명\n\[가산\] 이지은 \(출근 12:03\)/);
  assert.equal(mark(g, '김민수', '2026-11-16'), '', '미리 보기는 휴무표를 안 바꿔요');
  assert.equal(g.mails.length, 0, '아무에게도 안 보내요');
  assert.equal(r.done, false);
  assert.equal(g.gs.adminClosePreview('777777', 'today', true).via, '메일');
  assert.match(g.mails.at(-1).subject, /\[미리 보기\] 하루 마감 정리/);
  // 쉬는 날 출근도 장부에 안 적어요
  g.setKst('2026-11-21 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-21 19:00');
  punch(g, '김민수', '0123', 'out');
  assert.match(g.gs.adminClosePreview('777777', 'today', false).text, /쉬는 날 출근 1명 → 대체휴무로 쌓아요/, '미리 보기는 "쌓아요"');
  assert.equal(g.sheet('대체휴무').getLastRow(), 1);
  // 진짜 정리는 그대로 23:30에
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 2);
  g.setKst('2026-11-22 09:00');
  const y = g.gs.adminClosePreview('777777', 'yesterday', false);
  assert.equal(y.date, '2026-11-21');
  assert.equal(y.done, true, '어제 것은 이미 정리됐다고 알려줘요');
  assert.throws(() => g.gs.adminClosePreview(MGR, 'today'), /관리자\(사장님\)만/);
});

test('알림 시험: 텔레그램이 되면 텔레그램, 아니면 메일, 둘 다 없으면 안내', () => {
  const g = v3();
  assert.throws(() => g.gs.adminNotifyTest('777777'), /알림 받을 곳이 없어요/);
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  assert.equal(g.gs.adminNotifyTest('777777').via, '메일');
  tgOn(g);
  assert.equal(g.gs.adminNotifyTest('777777').via, '텔레그램');
  assert.match(sentTo(g, 555).at(-1), /시험 알림/);
  g.gs.setSetting_('알림이메일', '');
  g.tg.down = true;
  assert.throws(() => g.gs.adminNotifyTest('777777'), /텔레그램으로 못 보냈어요/);
  assert.throws(() => g.gs.adminNotifyTest(MGR), /관리자\(사장님\)만/);
});

test('휴무 고르기 오늘만 열기: 기간 전에도 오늘은 고를 수 있고, 다음 날이면 다시 닫혀요', () => {
  const g = v3();
  g.setKst('2026-11-10 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-08', true), /11\/20~11\/25에만/);
  const w = g.gs.adminWishOpen('777777', true);
  assert.equal(w.open, true);
  assert.equal(w.forced, true);
  g.gs.wishDay('김민수', '0123', '2026-12-08', true);
  assert.equal(mark(g, '김민수', '2026-12-08'), '휴무?');
  assert.equal(g.gs.getHome('김민수', '0123').wish.open, true, '직원 화면에도 열려요');
  g.setKst('2026-11-11 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-09', true), /11\/20~11\/25에만/, '다음 날은 다시 닫혀요');
  g.gs.checkMissing();
  assert.equal(g.gs.PropertiesService.getScriptProperties().getProperty('wishOpen:2026-11-10'), null, '지난 날 표시는 저절로 지워져요');
  g.setKst('2026-11-11 10:30');
  g.gs.adminWishOpen('777777', true);
  g.gs.adminWishOpen('777777', false);
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-09', true), /에만 고를 수 있어요/, '닫기');
  assert.throws(() => g.gs.adminWishOpen(MGR, true), /관리자\(사장님\)만/);
});

test('테스트 직원: 어디서든 폰 등록 없이 찍히고, 월별·정산에서 빠지고, [테스트 지우기]로 기록까지 지워져요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in'); // 김민수 폰 등록
  const t = g.gs.adminTestStaff('777777', '가산');
  assert.ok(t.list.some((p) => p.name === '테스트' && p.store === '가산'));
  assert.equal(g.gs.getStaffList().staff.find((p) => p.name === '테스트').test, true);
  assert.ok(monthRowOf(g, '2026-11', '테스트'));
  assert.ok(monthRowOf(g, '2026-12', '테스트'));
  // 멀리서, 김민수 폰으로 찍어도 돼요(테스트 직원은 폰 등록·위치 확인을 안 해요)
  g.setKst('2026-11-16 12:05');
  const r = punch(g, '테스트', '2580', 'in', FAR, PHONE.김민수);
  assert.equal(r.late, 5);
  assert.equal(r.place, '테스트(위치 확인 안 함)');
  assert.equal(g.gs.staff_().find((p) => p.name === '테스트').device, '', '폰이 묶이지 않아요');
  assert.equal(g.gs.staff_().find((p) => p.name === '김민수').deviceId, PHONE.김민수, '김민수 폰도 그대로');
  req(g, '테스트', '2580', 'off', { date: '2026-11-18', reason: '시험' });
  g.gs.addSub_('2026-11-14', '테스트', '적립', 1, '시험');
  g.gs.addChange_('2026-11-20', '테스트', '13:00-21:00', '시험');
  g.gs.logSuspect_('테스트', '시험', '시험');
  assert.ok(!g.gs.adminMonth('777777', '2026-11').staff.some((s) => s.name === '테스트'), '월별·정산에서 빠져요');
  assert.ok(g.gs.adminToday('777777').list.some((p) => p.name === '테스트'), '오늘 화면에는 보여요');

  const c = g.gs.adminTestClear('777777');
  assert.equal(c.removed, 8, '기록 1 + 요청 1 + 근무변경 1 + 의심기록 1 + 대체휴무 1 + 휴무표 2 + 직원 1');
  assert.ok(!c.list.some((p) => p.name === '테스트'));
  assert.ok(!monthRowOf(g, '2026-11', '테스트'));
  assert.ok(!monthRowOf(g, '2026-12', '테스트'));
  for (const [tab, col] of [['출퇴근기록', 2], ['요청', 2], ['근무변경', 1], ['의심기록', 1], ['대체휴무', 1], ['직원', 0]]) {
    const sh = g.sheet(tab);
    for (let i = 2; i <= sh.getLastRow(); i++) assert.notEqual(sh.rowDisplay(i)[col], '테스트', tab);
  }
  const log = g.sheet('출퇴근기록');
  assert.equal(log.getLastRow(), 2, '다른 사람 기록은 그대로');
  assert.deepEqual(plain(log.rowDisplay(2).slice(2, 6)), ['김민수', '10:00', '20:00', '09:58']);
  assert.equal(g.gs.staff_().length, 5, '직원 5명(퇴사자 포함)은 그대로');
  assert.throws(() => g.gs.adminTestStaff(MGR, '왕십리'), /관리자\(사장님\)만/);
  assert.throws(() => g.gs.adminTestClear(MGR), /관리자\(사장님\)만/);
});

/* ───── 코드 검토에서 나온 것 ───── */

test('검토: 없는 날짜(12/32)는 휴무 고르기·요청에서 거절되고, 휴무표 메모 칸은 안 건드려요', () => {
  const g = v3();
  g.setKst('2026-11-20 10:00');
  const dec = g.sheet('휴무표 2026-12');
  const r = monthRowOf(g, '2026-12', '김민수').r;
  dec.getRange(r, 41).setValue('사장님 메모');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-32', true), /다음 달\(12월\) 날짜만/);
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-31', reason: 'x' }), /날짜를 골라주세요/);
  assert.equal(dec.rowDisplay(r)[40], '사장님 메모');
  assert.equal(g.gs.parseDate_('2026-02-30'), '');
  assert.equal(g.gs.parseDate_('2026. 2. 28'), '2026-02-28');
  g.gs.setMark_('2026-12-32', '김민수', () => '휴무?');
  assert.equal(dec.rowDisplay(r)[40], '사장님 메모', '휴무표 쓰기도 날짜 칸 밖은 안 건드려요');
});

test('검토: "대체근무 12-21"처럼 근무를 적은 건 쉬는 날이 아니에요("대체"만 적힌 칸만 대체휴무)', () => {
  const g = v3();
  g.gs.addChange_('2026-11-17', '김민수', '대체근무 12:00-21:00', '');
  g.setKst('2026-11-17 12:20');
  assert.equal(punch(g, '김민수', '0123', 'in').late, 20, '근무로 봐서 지각이 계산돼요');
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 1, '근무한 날이라 대체휴무로 안 쌓아요');
  g.gs.setMark_('2026-11-19', '박점장', () => '대체');
  g.setKst('2026-11-19 09:00');
  assert.equal(g.gs.getToday('박점장').sIn, '', '"대체"만 적힌 날은 쉬는 날');
});

test('검토: 점장이 두 명인 매장에서도 점장은 자기 요청·자기가 맡은 대타를 처리 못 해요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.sheet('매장').getRange(2, 8).setValue('박점장, 김민수');
  g.setKst('2026-11-16 15:00');
  req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '병원' });
  const id = reqRows(g)[0][0];
  assert.equal(reqRows(g)[0][10], '점장', '다른 점장(박점장)이 있으니 점장에게');
  const kim = { name: '김민수', pin: '0123' };
  assert.throws(() => g.gs.mgrForward(kim, id, ''), /본인 요청은/);
  assert.throws(() => g.gs.mgrReturn(kim, id, '안 돼요'), /본인 요청은/);
  g.gs.mgrForward(MGR, id, '확인');
  assert.equal(reqRows(g)[0][10], '관리자');
  // 김민수 대타를 박점장이 맡으면: 박점장도 김민수도 못 올리고, 사장님께 바로 알려요
  req(g, '김민수', '0123', 'swap', { date: '2026-11-19' });
  const sid = reqRows(g)[1][0];
  g.gs.takeSwap('박점장', '2468', sid);
  assert.match(g.mails.at(-1).subject, /대타 수락 · 확인해주세요 \(점장 확인 전\)/);
  assert.throws(() => g.gs.mgrForward(MGR, sid, ''), /본인이 대타를 맡은/);
  assert.throws(() => g.gs.mgrForward(kim, sid, ''), /본인 요청은/);
  g.gs.adminRequest('777777', sid, true);
  assert.equal(reqRows(g)[1][7], '승인', '관리자는 바로 처리할 수 있어요');
});

test('검토: 대타를 맡은 사람이 수락을 취소하면, 점장이 올렸던 것도 처음으로 돌아가요', () => {
  const g = v3();
  g.setKst('2026-11-16 15:00');
  req(g, '김민수', '0123', 'swap', { date: '2026-11-18' });
  const id = reqRows(g)[0][0];
  g.gs.takeSwap('이지은', '5678', id);
  g.gs.mgrForward(MGR, id, '이지은 괜찮아요');
  assert.equal(reqRows(g)[0][10], '관리자');
  g.gs.cancelRequest('이지은', '5678', id);
  const row = reqRows(g)[0];
  assert.equal(row[7], '대기');
  assert.equal(row[10], '점장', '새 대타가 정해지면 점장이 다시 봐요');
  assert.equal(row[11], '', '예전 점장 한마디는 지워요');
  g.gs.takeSwap('최유나', '1357', id);
  assert.equal(g.gs.adminToday(MGR).requests[0].route, '점장');
});

test('검토: [요청] K·L 칸에 사장님이 쓰던 게 있으면 새 칸을 그 앞에 끼워 넣어요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const rq = g.book.insertSheet('요청');
  rq.getRange(1, 1, 2, 11).setValues([['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시', '메모'],
    ['R1', '2026-11-15 10:00', '예시직원', '휴무', '2026-11-20', '11:00-', '개인', '대기', '', '', '사장님 메모']]);
  g.gs.setup();
  assert.deepEqual(plain(rq.rowDisplay(1).slice(10, 13)), ['보낼곳', '점장확인', '메모']);
  assert.equal(rq.rowDisplay(2)[12], '사장님 메모', '사장님 칸은 오른쪽으로 밀려서 그대로');
  g.gs.setSetting_('관리자PIN', '777777');
  g.gs.adminRequest('777777', 'R1', false);
  assert.equal(rq.rowDisplay(2)[7], '거절');
  assert.equal(rq.rowDisplay(2)[10], '관리자');
  assert.equal(rq.rowDisplay(2)[12], '사장님 메모', '처리해도 사장님 칸은 안 건드려요');
  g.gs.setup();
  assert.deepEqual(plain(rq.rowDisplay(1).slice(10, 13)), ['보낼곳', '점장확인', '메모'], '다시 setup 해도 또 끼우지 않아요');
});

test('검토: 휴무신청기간을 "20일~25일"이나 "18일부터 22일까지"처럼 적어도 그 기간만 열려요', () => {
  const g = v3();
  g.gs.setSetting_('휴무신청기간', '20일~25일');
  g.setKst('2026-11-26 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-08', true), /고를 기간이 지났어요/);
  g.gs.setSetting_('휴무신청기간', '매달 18일부터 22일까지');
  g.setKst('2026-11-18 10:00');
  g.gs.wishDay('김민수', '0123', '2026-12-08', true);
  assert.equal(mark(g, '김민수', '2026-12-08'), '휴무?');
  g.setKst('2026-11-23 10:00');
  assert.throws(() => g.gs.wishDay('김민수', '0123', '2026-12-09', true), /11\/18~11\/22에만/);
});

test('검토: 공휴일에는 그 매장에 누가 출근해야 미출근 알림을 보내요(설·추석처럼 쉬는 날 알림 폭탄 방지)', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민수: '9002' });
  g.gs.setSetting_('공휴일추가', '2026-11-16 회사창립일');
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 0, '매장이 쉬는지 모르니 직원에게 안 보내요');
  assert.equal(sentTo(g, 555).length, 0, '사장님께도 안 보내요');
  g.setKst('2026-11-16 10:20');
  punch(g, '박점장', '2468', 'in');
  g.setKst('2026-11-16 10:25');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /아직 출근을 안 찍었어요/, '박점장이 출근해서 연 날로 봐요');
  assert.match(sentTo(g, 555).at(-1), /아직 출근 안 찍은 직원 1명/);
});

test('검토: 마감 정리는 줄을 서서 한 번만, 다시 돌아도 직원 알림은 한 번만', () => {
  const g = v3();
  tgOn(g, { 이지은: '9003' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-16 23:35');
  g.setLockBusy(true);
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-16'), '', '줄이 막혀 있으면 이번엔 건너뛰어요');
  assert.equal(sentTo(g, 9003).length, 0);
  g.setLockBusy(false);
  g.setKst('2026-11-16 23:45');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민수', '2026-11-16'), '결근?', '다음 번에 해요');
  assert.equal(sentTo(g, 9003).length, 1);
  // 중간에 오류가 나서 다시 도는 경우(끝 표시를 지워서 흉내): 직원 알림은 두 번 안 가요
  g.gs.PropertiesService.getScriptProperties().deleteProperty('close:2026-11-16');
  g.setKst('2026-11-16 23:55');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9003).length, 1, '퇴근 안 찍음 알림은 한 번만');
});

/* ───── 1년 보기 · 시트 서식 ───── */

test('휴무표 서식: 주말·공휴일 열 음영, 매장 사이 굵은 선, 매장 이름은 묶음 첫 줄만 진하게', () => {
  const g = v3();
  const dec = g.sheet('휴무표 2026-12');
  const bg = (day) => (dec.bgs || []).filter((b) => b.r === 3 && b.c === 9 + day && b.nc === 1).map((b) => b.color).at(-1);
  assert.equal(bg(5), '#eff6ff', '12/5 토요일은 옅은 파랑');
  assert.equal(bg(6), '#fef2f2', '12/6 일요일은 옅은 빨강');
  assert.equal(bg(25), '#fef2f2', '12/25 성탄절도 옅은 빨강');
  assert.equal(bg(7), null, '평일은 음영 없음');
  // 줄: 예시직원(본점) · 김민수 · 박점장(왕십리) · 이지은 · 최유나(가산) — 매장이 바뀌는 줄 아래에 굵은 선
  const names = [];
  for (let r = 3; r <= dec.getLastRow(); r++) names.push([r, dec.rowDisplay(r)[1], dec.rowDisplay(r)[2]]);
  const ends = names.filter((x, i) => i === names.length - 1 || names[i + 1][1] !== x[1]).map((x) => x[0]);
  assert.deepEqual(Object.keys(dec.borders).map(Number).sort((a, b) => a - b), ends);
  assert.ok(Object.values(dec.borders).every((s) => s === 'SOLID_MEDIUM'));
  const firstKim = names.find((x) => x[2] === '김민수')[0];
  const park = names.find((x) => x[2] === '박점장')[0];
  assert.equal(dec.colors[firstKim + ',2'], '#111827', '매장 묶음 첫 줄은 진하게');
  assert.equal(dec.colors[park + ',2'], '#cbd5e1', '같은 매장 둘째 줄부터는 옅게');
  assert.equal(dec.getRange(firstKim, 1).getValues()[0][0], '=ROW()-2', 'No 칸은 줄을 끼워 넣어도 맞게 수식으로');
  // 예전 탭처럼 No가 숫자로 적혀 있어도, 다시 칠할 때(setup) 줄 번호 수식으로 바꿔요
  dec.getRange(3, 1, 2, 1).setValues([['7'], ['8']]);
  g.gs.setup();
  for (let r = 3; r <= dec.getLastRow(); r++) assert.equal(dec.getRange(r, 1).getValues()[0][0], '=ROW()-2', '예전 줄 번호도 수식으로');
});

test('휴무표: 새 직원은 맨 아래가 아니라 자기 매장 묶음 안에 들어가요', () => {
  const g = v3();
  const nov = g.sheet('휴무표 2026-11');
  const order = () => { const o = []; for (let r = 3; r <= nov.getLastRow(); r++) o.push(nov.rowDisplay(r)[2] + '/' + nov.rowDisplay(r)[1]); return o; };
  const before = order();
  g.sheet('직원').getRange(7, 1, 1, 3).setValues([['신입왕', '왕십리', '']]);
  g.setKst('2026-11-16 10:00');
  g.gs.checkMissing(); // 10분마다 도는 작업이 빠진 직원을 넣어요
  const after = order();
  assert.equal(after.length, before.length + 1);
  const i = after.indexOf('신입왕/왕십리');
  assert.ok(i > 0 && after[i - 1].endsWith('/왕십리'), '왕십리 묶음 끝에: ' + after.join(', '));
  assert.ok(after[i + 1].endsWith('/가산'), '바로 아래는 가산 묶음: ' + after.join(', '));
  assert.equal(after.at(-1), before.at(-1), '맨 아래 줄은 그대로');
  const r = monthRowOf(g, '2026-11', '신입왕').r;
  assert.equal(nov.fmt(r, 10), '@', '끼워 넣은 줄도 날짜 칸이 글자 서식이라 11:08 같은 지각 시간이 그대로 보여요');
  // 그 아래 직원(가산)도 그대로 읽고 써요
  g.setKst('2026-11-16 12:09');
  punch(g, '이지은', '5678', 'in');
  assert.equal(mark(g, '이지은', '2026-11-16'), '12:09');
});

test('출퇴근기록: 매장 칸이 생기고(예전 줄은 찍을 때 채움), 주말 줄·지각·퇴근 누락에 색이 칠해져요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:05');
  punch(g, '김민수', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  assert.equal(log.rowDisplay(1)[15], '매장');
  assert.equal(log.rowDisplay(2)[15], '왕십리');
  // 기록이 없던 날을 정정 승인으로 새로 만들어도 매장이 들어가요
  g.setKst('2026-11-17 09:00');
  req(g, '이지은', '5678', 'fix', { date: '2026-11-16', type: 'in', time: '12:00', reason: '깜빡' });
  g.gs.adminRequest('777777', reqRows(g).at(-1)[0], true);
  assert.equal(log.rowDisplay(3)[2], '이지은');
  assert.equal(log.rowDisplay(3)[15], '가산');
  const rules = Array.from(log.cfRules || [], (x) => (x.calls.find((c) => c[0] === 'whenFormulaSatisfied') || [])[1]);
  assert.ok(rules.includes('=$B2="토"') && rules.includes('=$B2="일"'), '주말 줄 색칠');
  assert.ok(rules.some((f) => /\$H2/.test(f)), '지각 칸 빨간 글씨');
  assert.ok(rules.some((f) => /\$G2=""/.test(f)), '퇴근 안 찍은 칸 노랑');
  // 예전 시트(매장 칸 없음): setup 이 머리글을 붙이고, 그 줄은 다음에 찍을 때 채워요
  log.getRange(1, 16).setValue('');
  log.getRange(2, 16).setValue('');
  g.gs.setup();
  assert.equal(log.rowDisplay(1)[15], '매장');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민수', '0123', 'out');
  assert.equal(log.rowDisplay(2)[15], '왕십리');
  assert.equal(g.gs.adminExport('777777', '2026-11').name, '정산 2026-11');
  const ex = g.sheet('정산 2026-11');
  let top = 1;
  while (ex.rowDisplay(top)[0] !== '날짜') top++;
  assert.equal(ex.rowDisplay(top)[15], '매장', '정산 시트 날짜별 기록에도 매장 칸');
  assert.equal(ex.rowDisplay(top + 1)[15], '왕십리');
});

test('직원 1년 보기: 휴무표 탭 12개를 안 열어도 한 사람의 1년이 달마다 나와요', () => {
  const g = v3();
  // 11월: 출근 2번(한 번 지각), 휴무표에 휴무·반차·월차·결근?, 대체휴무 적립 1
  g.setKst('2026-11-16 10:05');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민수', '0123', 'out');
  g.setKst('2026-11-17 09:58');
  punch(g, '김민수', '0123', 'in');
  g.gs.setMark_('2026-11-18', '김민수', () => '휴무');
  g.gs.setMark_('2026-11-19', '김민수', () => '반차');
  g.gs.setMark_('2026-11-20', '김민수', () => '월차');
  g.gs.setMark_('2026-11-23', '김민수', () => '결근?');
  g.gs.addSub_('2026-11-21', '김민수', '적립', 1, '시험');
  // 12월: 휴무 1
  g.gs.setMark_('2026-12-02', '김민수', () => '휴무');
  const nov = g.sheet('휴무표 2026-11');
  nov.getRange(monthRowOf(g, '2026-11', '김민수').r, 8).setValue('3'); // 잔여(시트에서는 수식 결과)
  g.setKst('2026-11-18 09:00'); // 오늘(11/17)은 아직 퇴근 누락이 아니라서, 다음 날 봐요
  const y = g.gs.adminYear('777777', '김민수', '2026');
  assert.equal(y.name, '김민수');
  assert.equal(y.store, '왕십리');
  assert.equal(y.months.length, 12);
  const n = y.months[10];
  assert.equal(n.ym, '2026-11');
  assert.equal(n.days, 2);
  assert.equal(n.lateCount, 1);
  assert.equal(n.lateMin, 5);
  assert.equal(n.off, 1.5, '휴무 1 + 반차 0.5');
  assert.equal(n.monthly, 1);
  assert.equal(n.monthlyLeft, 3);
  assert.equal(n.absent, 1);
  assert.equal(n.subGot, 1);
  assert.equal(n.noOut, 1, '11/17 퇴근 안 찍음');
  assert.equal(y.months[11].off, 1);
  assert.equal(y.total.off, 2.5);
  assert.equal(y.total.days, 2);
  assert.equal(y.total.monthlyLeft, 3);
  assert.ok(y.total.deduct > 0, '관리자는 차감액도 봐요');
  // 점장: 자기 매장만, 차감액 없이
  const m = g.gs.adminYear(MGR, '김민수', '2026');
  assert.equal(m.total.deduct, 0);
  assert.equal(m.noMoney, true);
  assert.throws(() => g.gs.adminYear(MGR, '이지은', '2026'), /점장님 매장 직원만/);
  assert.throws(() => g.gs.adminYear('777777', '없는사람', '2026'), /직원을 찾을 수 없어요/);
});

test('1년 요약 시트: 한 사람 한 달이 한 줄, 사람마다 합계 줄, 필터로 한 사람만 볼 수 있어요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:05');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:00');
  punch(g, '이지은', '5678', 'in');
  g.gs.setMark_('2026-12-02', '김민수', () => '휴무');
  const r = g.gs.adminExportYear('777777', '2026');
  assert.equal(r.name, '연간 2026');
  const sh = g.sheet('연간 2026');
  assert.deepEqual(plain(sh.rowDisplay(1).slice(0, 4)), ['이름', '매장', '월', '근무일']);
  const rows = [];
  for (let i = 2; i <= sh.getLastRow(); i++) rows.push(sh.rowDisplay(i).slice(0, 3).join('/'));
  assert.deepEqual(rows.filter((x) => x.startsWith('김민수')), ['김민수/왕십리/11월', '김민수/왕십리/12월', '김민수/왕십리/합계']);
  assert.ok(rows.includes('이지은/가산/합계'));
  assert.ok(sh.filter, '필터가 걸려 있어요');
  assert.ok(Object.keys(sh.borders).length >= 2, '사람마다 선으로 구분');
  assert.equal(g.gs.adminExportYear('777777', '2026').name, '연간 2026', '다시 만들어도 한 장');
  assert.equal(g.book.getSheets().filter((x) => x.getName() === '연간 2026').length, 1);
  assert.throws(() => g.gs.adminExportYear(MGR, '2026'), /관리자\(사장님\)만/);
});

test('휴무표: 읽은 뒤에 누가 줄을 끼워 넣어도(새 직원 등) 엉뚱한 줄에 쓰지 않아요', () => {
  const g = v3();
  const nov = g.sheet('휴무표 2026-11');
  g.gs.GRID_ = {};
  g.gs.monthGrid_('2026-11'); // 이 실행이 휴무표를 읽어 둔 상태
  const kimBefore = monthRowOf(g, '2026-11', '김민수').r;
  nov.insertRowsAfter(2, 1); // 그 사이 다른 실행이 맨 위에 줄을 끼워 넣음
  g.gs.setMark_('2026-11-18', '김민수', () => '휴무');
  const kim = monthRowOf(g, '2026-11', '김민수').r;
  assert.equal(kim, kimBefore + 1);
  assert.equal(nov.rowDisplay(kim)[9 + 18 - 1], '휴무', '김민수 줄에 써요');
  assert.equal(nov.rowDisplay(kim - 1)[9 + 18 - 1] || '', '', '위 줄(다른 사람)은 그대로');
});

/* ───── PC용 1년 탭 ───── */

const sheetRows = (sh) => { const out = []; for (let r = 1; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r)); return out; };

test('직원 1년 탭(PC): 직원·연도를 고르면 달마다 합계와 1년 달력(휴무표 칸 그대로)이 채워져요', () => {
  const g = v3();
  const sh = g.sheet('직원 1년');
  assert.ok(sh, 'setup 이 만들어 둬요');
  assert.ok(sh.validations['3,2'] && sh.validations['3,4'], 'B3 직원, D3 연도는 고르는 칸');
  g.setKst('2026-11-16 10:05');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민수', '0123', 'out');
  g.gs.setMark_('2026-11-18', '김민수', () => '휴무');
  g.gs.setMark_('2026-12-02', '김민수', () => '월차');
  g.setKst('2026-11-20 09:00');
  sh.getRange(3, 2).setValue('김민수');
  sh.getRange(3, 4).setValue('2026');
  g.gs.onEdit({ range: sh.getRange(3, 2) }); // 사장님이 B3에서 고른 것처럼
  const rows = sheetRows(sh);
  assert.match(rows[4][0], /달마다 합계 · 김민수 \(왕십리\) · 2026년/);
  const nov = rows.find((r) => r[0] === '11월' && r[1] !== '' && !/^\d{1,2}:/.test(r[1]));
  assert.deepEqual(plain(nov.slice(0, 4)), ['11월', '1', '9시간 55분', '1'], '근무 1일, 지각 1회');
  assert.equal(rows.find((r) => r[0] === '합계')[7], '1', '휴무 합계');
  // 1년 달력: 11월 줄에 16일 지각 시간, 18일 휴무 / 12월 줄에 2일 월차
  const head = rows.findIndex((r) => r[0] === '월' && r[1] === '1');
  assert.ok(head > 0);
  const calNov = rows[head + 11], calDec = rows[head + 12];
  assert.equal(calNov[0], '11월');
  assert.equal(calNov[16], '10:05');
  assert.equal(calNov[18], '휴무');
  assert.equal(calDec[2], '월차');
  const r11 = head + 12; // 11월 줄의 시트 줄 번호(1부터)
  assert.equal(sh.bgCells[r11 + ',' + (1 + 21)], '#eff6ff', '11/21 토요일 음영');
  assert.equal(sh.bgCells[r11 + ',' + (1 + 22)], '#fef2f2', '11/22 일요일 음영');
  assert.equal(sh.bgCells[r11 + ',' + (1 + 31)], '#e5e7eb', '11월에 없는 31일은 회색');
  const texts = Array.from(sh.cfRules, (x) => (x.calls.find((c) => c[0] === 'whenTextContains') || [])[1]);
  assert.ok(texts.includes('월차') && texts.includes('결근'), '휴무표와 같은 색칠 규칙');
  // 새로고침 체크: 그 사이 바뀐 기록을 다시 읽고, 체크는 풀려요
  g.gs.setMark_('2026-11-19', '김민수', () => '반차');
  sh.getRange(3, 6).setValue(true);
  g.gs.onEdit({ range: sh.getRange(3, 6) });
  assert.equal(sheetRows(sh)[head + 11][19], '반차');
  assert.equal(sh.rowDisplay(3)[5], 'false');
});

test('매장 1년 탭(PC): 매장을 고르면 직원별 1년 합계·달마다 매장 합계·달마다 지각과 휴무가 채워져요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:05');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 10:12');
  punch(g, '박점장', '2468', 'in');
  g.setKst('2026-11-16 12:30');
  punch(g, '이지은', '5678', 'in');
  g.gs.setMark_('2026-11-18', '김민수', () => '휴무');
  g.gs.addSub_('2026-03-02', '박퇴사', '적립', 1, '예전 기록'); // 퇴사자도 그해 기록이 있으면 보여요
  g.setKst('2026-11-20 09:00');
  const sh = g.sheet('매장 1년');
  sh.getRange(3, 2).setValue('왕십리');
  g.gs.onEdit({ range: sh.getRange(3, 2) });
  const rows = sheetRows(sh);
  assert.match(rows[4][0], /직원별 1년 합계 · 왕십리 · 2026년/);
  const kim = rows.find((r) => r[0] === '김민수');
  assert.equal(kim[3], '1', '김민수 지각 1회');
  assert.equal(kim[7], '1', '김민수 휴무 1일');
  assert.ok(rows.find((r) => r[0] === '박점장'));
  assert.ok(rows.find((r) => r[0] === '박퇴사 (퇴사)'), '그해 기록이 있는 퇴사자');
  assert.ok(!rows.some((r) => r[0] === '이지은'), '다른 매장(가산)은 안 나와요');
  const total = rows.find((r) => r[0] === '매장 합계');
  assert.equal(total[3], '2', '매장 지각 합계 2회');
  const nov = rows.find((r) => r[0] === '11월');
  assert.equal(nov[3], '2', '11월 매장 지각 2회');
  const lateTitle = rows.findIndex((r) => r[0] === '달마다 지각(회)');
  const lateKim = rows.slice(lateTitle).find((r) => r[0] === '김민수');
  assert.equal(lateKim[11], '1', '김민수 11월 지각 1회');
  assert.equal(lateKim[13], '1', '합계');
  assert.ok(rows.some((r) => r[0] === '달마다 휴무(일)'));
  // 가산으로 바꾸면 가산 직원만
  sh.getRange(3, 2).setValue('가산');
  g.gs.onEdit({ range: sh.getRange(3, 2) });
  const rows2 = sheetRows(sh);
  assert.ok(rows2.some((r) => r[0] === '이지은'));
  assert.ok(!rows2.some((r) => r[0] === '김민수'));
});
