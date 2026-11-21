// 앱 상태 빨간 띠: 자동 실행 멈춤 · 텔레그램 알림 실패 · 웹 앱 예전 버전 (사장님 화면 [오늘] 맨 위)
// 실행: node --test attendance/test/f2-health-banners.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
const ROW = { 김민우: 2, 이지은: 3, 박점장: 4 };

// 2026-11-16 은 월요일. 왕십리 10:00-20:00(점장 박점장), 가산 12:00-21:00. 9시에 setup(10분 자동 실행이 켜져요)
function fresh({ email = '' } = {}) {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  g.sheet('직원').getRange(2, 1, 3, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박점장');
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setSetting_('알림이메일', email);
  g.gs.MEMO_ = {};
  return g;
}
// 텔레그램: 사장님 채팅 555, chats = {이름: 직원 채팅 번호}
function tgOn(g, chats = {}) {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const [n, id] of Object.entries(chats)) g.gs.setStaffCell_(ROW[n], '텔레그램', id);
  g.gs.MEMO_ = {};
}
const health = (g, cred = ADMIN) => plain(g.gs.adminToday(cred).health);
const banner = (g, key) => (health(g).list.find((b) => b.key === key) || {}).text || '';
const sends = (g, chat) => g.tg.calls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === String(chat));
const sentTo = (g, chat) => g.tg.sent.filter((m) => String(m.chat_id) === String(chat)).map((m) => m.text);

/* ───── 1) 자동 실행이 멈추면 ───── */

test('자동 실행: setup 직후 30분은 조용하고, 그 뒤에도 안 돌았으면 빨간 띠, 돌면 사라져요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:20');
  let h = health(g);
  assert.equal(h.trigger, true, '10분 자동 실행이 있어요');
  assert.equal(h.beat, '', '아직 한 번도 안 돌았어요');
  assert.deepEqual(h.list, [], '막 setup 했으니 띄우지 않아요');
  g.setKst('2026-11-16 09:31');
  assert.equal(banner(g, 'beat'), '자동 실행이 아직 한 번도 안 돌았어요. 시트 메뉴 출퇴근 → setup 실행을 눌러 주세요. 그동안 미출근 알림과 밤 마감 정리가 멈춰 있어요.');

  g.setKst('2026-11-16 09:32');
  g.gs.checkMissing();
  assert.equal(g.props.get('health:beat'), '2026-11-16 09:32', '돈 시각을 한국 시간으로 적어요');
  h = health(g);
  assert.equal(h.beat, '2026-11-16 09:32', 'adminToday 가 마지막 실행 시각을 돌려줘요');
  assert.deepEqual(h.list, []);
  g.setKst('2026-11-16 10:02');
  assert.equal(banner(g, 'beat'), '', '딱 30분은 아직 괜찮아요');
  g.setKst('2026-11-16 10:03');
  assert.match(banner(g, 'beat'), /^자동 실행이 09:32 뒤로 멈췄어요\. 시트 메뉴 출퇴근 → setup 실행을 눌러 주세요\./);
  g.gs.checkMissing();
  assert.equal(banner(g, 'beat'), '', '다시 돌면 저절로 사라져요');
});

test('자동 실행: 08:00~23:30에만 봐요. 하루를 넘기면 날짜도 같이 보여요', () => {
  const g = fresh();
  g.setKst('2026-11-16 22:00');
  g.gs.checkMissing();
  g.setKst('2026-11-16 23:29');
  assert.match(banner(g, 'beat'), /22:00 뒤로 멈췄어요/);
  g.setKst('2026-11-16 23:40');
  assert.equal(banner(g, 'beat'), '', '밤에는 안 띄워요');
  g.setKst('2026-11-17 07:59');
  assert.equal(banner(g, 'beat'), '');
  g.setKst('2026-11-17 08:00');
  assert.match(banner(g, 'beat'), /^자동 실행이 11\/16 22:00 뒤로 멈췄어요\./, '어제 시각이면 날짜까지');
});

test('자동 실행: 줄을 못 서서 일을 건너뛰어도 돈 시각은 적고, 웹 앱 주소로 부르면 안 적어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  g.setLockBusy(true);
  g.gs.checkMissing();
  assert.equal(g.props.get('health:beat'), '2026-11-16 10:30');
  g.setLockBusy(false);
  g.setActiveUser(''); // 웹 앱을 다른 사람이 열었을 때(트리거·편집기가 아님)
  g.setKst('2026-11-16 10:40');
  g.gs.checkMissing();
  assert.equal(g.props.get('health:beat'), '2026-11-16 10:30', '아무것도 안 하고 시각도 안 적어요');
});

test('자동 실행: 트리거가 없으면 밤에도 바로 빨간 띠, setup 하면 사라져요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:05');
  g.triggers.splice(0, g.triggers.length); // 누가 트리거를 지웠어요
  let h = health(g);
  assert.equal(h.trigger, false);
  assert.equal(h.list[0].text, '자동 실행이 꺼져 있어요. 시트 메뉴 출퇴근 → setup 실행을 눌러 주세요. 그동안 미출근 알림과 밤 마감 정리가 멈춰 있어요.');
  g.setKst('2026-11-16 23:50');
  g.gs.checkMissing(); // 편집기에서 한 번 돌림(트리거는 여전히 없음)
  assert.match(banner(g, 'beat'), /^자동 실행이 23:50 뒤로 멈췄어요/, '트리거가 없으면 밤에도 띄워요');
  g.gs.setup();
  h = health(g);
  assert.equal(h.trigger, true);
  assert.deepEqual(h.list, [], '다시 켜졌고 막 setup 했으니 30분은 기다려요');
  // 시간 트리거만 봐요: 같은 이름의 시트 고침 트리거는 10분 자동 실행이 아니에요
  g.triggers.forEach((t) => { t.kind = 'edit'; });
  assert.equal(health(g).trigger, false);
});

test('자동 실행: 이 기능이 든 코드로 막 바꿔서 기록이 하나도 없으면 처음 본 때부터 30분 기다려요', () => {
  const g = fresh();
  g.props.delete('health:setupAt'); // 예전 코드로 setup 했고, 새 코드는 붙여넣기만 한 상태
  g.props.delete('health:beat');
  g.setKst('2026-11-16 15:00');
  assert.equal(banner(g, 'beat'), '', '처음 보는 상태: 바로 띄우지 않아요');
  assert.equal(g.props.get('health:seen'), '2026-11-16 15:00');
  g.setKst('2026-11-16 15:20');
  assert.equal(banner(g, 'beat'), '');
  g.setKst('2026-11-16 15:31');
  assert.match(banner(g, 'beat'), /^자동 실행이 아직 한 번도 안 돌았어요/);
});

test('빨간 띠는 관리자만: 점장 화면에는 없어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  assert.ok(health(g).list.length, '관리자에게는 보여요(자동 실행이 안 돌았어요)');
  assert.equal(g.gs.adminToday(MGR).health, null);
});

/* ───── 2) 텔레그램 알림이 안 가면 ───── */

test('텔레그램: 처음 실패한 때와 이유를 적고, 다시 되면 지워요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing(); // 정상
  assert.equal(g.props.get('health:tg'), undefined);
  g.tg.down = true; // 텔레그램 서버 고장(502)
  g.setKst('2026-11-16 10:20');
  g.gs.adminWishOpen(ADMIN, true); // 알림이 없는 일
  assert.equal(g.props.get('health:tg'), undefined);
  assert.equal(g.gs.notify_(g.gs.settings_(), '시험', '내용'), '', '메일도 없어서 못 보냈어요');
  assert.deepEqual(JSON.parse(g.props.get('health:tg')), { at: '2026-11-16 10:20', kind: 'net', err: '텔레그램 서버에 연결이 안 돼요' });
  assert.equal(banner(g, 'tg'), '텔레그램 알림이 10:20부터 안 가요(텔레그램 서버에 연결이 안 돼요). [설정] → 텔레그램 → [연결 확인]을 눌러 주세요.');
  g.setKst('2026-11-16 10:40');
  g.gs.notify_(g.gs.settings_(), '시험', '또');
  assert.match(banner(g, 'tg'), /10:20부터/, '처음 실패한 때를 그대로 둬요');
  g.tg.down = false;
  g.gs.notify_(g.gs.settings_(), '시험', '이제 돼요');
  assert.equal(g.props.get('health:tg'), undefined);
  assert.equal(banner(g, 'tg'), '');
});

test('텔레그램: 토큰이 막혔으면 "봇 토큰이 안 맞아요", 직원에게 보낸 게 되면 토큰 문제는 풀린 거예요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 11:00');
  g.gs.setSetting_('텔레그램토큰', '123456789:' + 'x'.repeat(32) + 'BAD'); // BotFather에서 토큰을 새로 받았어요
  g.gs.MEMO_ = {};
  const p = g.gs.person_('김민우');
  assert.equal(g.gs.notifyStaff_(g.gs.settings_(), p, '시험', '내용'), false);
  assert.match(banner(g, 'tg'), /11:00부터 안 가요\(봇 토큰이 안 맞아요\)/, '직원에게 보낸 것도 토큰 문제면 띄워요');
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.notifyStaff_(g.gs.settings_(), g.gs.person_('김민우'), '시험', '내용'), true);
  assert.equal(banner(g, 'tg'), '');
});

test('텔레그램: 직원 한 명이 봇을 막은 건 띠로 안 띄워요. 사장님 방이 막히면 띄우고, 직원에게 간 걸로는 안 지워요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002', 이지은: '9003' });
  g.setKst('2026-11-16 12:00');
  const set = () => { g.gs.MEMO_ = {}; return g.gs.settings_(); };
  g.tg.blocked = ['9002'];
  assert.equal(g.gs.notifyStaff_(set(), g.gs.person_('김민우'), '시험', '내용'), false);
  assert.equal(g.props.get('health:tg'), undefined, '그 직원만의 문제예요');
  g.tg.gone = ['555']; // 봇이 사장님 단톡방에서 빠졌어요
  g.gs.notify_(set(), '시험', '사장님께');
  assert.match(banner(g, 'tg'), /12:00부터 안 가요\(봇이 채팅방에서 빠졌거나 막혔어요\)/);
  g.setKst('2026-11-16 12:10');
  assert.equal(g.gs.notifyStaff_(set(), g.gs.person_('이지은'), '시험', '내용'), true);
  assert.match(banner(g, 'tg'), /12:00부터/, '직원에게 간 건 사장님 방이 된다는 뜻이 아니에요');
  g.tg.gone = [];
  g.gs.notify_(set(), '시험', '다시');
  assert.equal(banner(g, 'tg'), '');
});

test('텔레그램: 인터넷 오류에 든 봇 토큰은 저장·화면 어디에도 안 남겨요', () => {
  const g = fresh();
  tgOn(g);
  g.setKst('2026-11-16 13:00');
  g.tg.offline = true;
  assert.equal(g.gs.notify_(g.gs.settings_(), '시험', '내용'), '');
  const saved = g.props.get('health:tg');
  assert.ok(saved);
  assert.equal(saved.includes(TOKEN), false);
  assert.equal(saved.includes('AAAAAAAA'), false);
  assert.equal(JSON.parse(saved).kind, 'net');
  assert.equal(banner(g, 'tg').includes('AAAAAAAA'), false);
  // 모르는 오류는 짧게 그대로 보여 주되 긴 숫자(채팅방 번호 등)는 가려요
  assert.equal(g.gs.tgShort_(new Error('텔레그램 오류: Bad Request: message text is empty for 1234567890')), 'Bad Request: message text is empty for …');
  assert.doesNotMatch(g.gs.tgShort_(new Error('텔레그램 오류: odd 1234567890 thing')), /1234567890/);
  assert.equal(g.gs.tgShort_(new Error('텔레그램 오류: Bad Request: message is too long')), '알림 글이 너무 길어요');
  assert.equal(g.gs.tgShort_(new Error('Exception: Service invoked too many times for one day: urlfetch.')), '너무 많이 보내서 잠깐 막혔어요');
});

test('텔레그램 [연결 확인](연결된 뒤): 되면 띠가 사라지고, 안 되면 이유와 고치는 법을 알려줘요', () => {
  const g = fresh({ email: 'owner@example.com' });
  assert.throws(() => g.gs.adminTelegramCheck(ADMIN), /아직 연결되지 않았어요/);
  tgOn(g);
  assert.throws(() => g.gs.adminTelegramCheck(MGR), /관리자\(사장님\)만/);
  assert.throws(() => g.gs.adminTelegramCheck('000000'), /비밀번호/);
  g.setKst('2026-11-16 14:00');
  g.tg.gone = ['555'];
  assert.equal(g.gs.notify_(g.gs.settings_(), '시험', '내용'), '메일', '텔레그램이 안 되면 메일로 가요');
  assert.match(banner(g, 'tg'), /14:00부터 안 가요/, '메일로 갔어도 텔레그램이 안 되는 건 알려요');
  g.setKst('2026-11-16 14:05');
  assert.throws(() => g.gs.adminTelegramCheck(ADMIN), /^Error: 텔레그램으로 못 보냈어요\(봇이 채팅방에서 빠졌거나 막혔어요\)\. 텔레그램에서 봇을 다시 열어 \[시작\]을 누르거나/);
  assert.equal(g.mails.length, 1, '[연결 확인]은 메일로 대신 보내지 않아요');
  g.tg.gone = [];
  const r = plain(g.gs.adminTelegramCheck(ADMIN));
  assert.equal(r.ok, true);
  assert.equal(r.info.tg, '연결됨');
  assert.match(sentTo(g, 555).at(-1), /연결 확인: 알림이 잘 와요/);
  assert.equal(banner(g, 'tg'), '');
  // 고치는 법은 오류마다 달라요
  g.tg.down = true;
  assert.throws(() => g.gs.adminTelegramCheck(ADMIN), /텔레그램 서버에 연결이 안 돼요\)\. 텔레그램 서버나 인터넷이 잠깐 안 되는 것 같아요/);
  g.tg.down = false;
  g.gs.setSetting_('텔레그램토큰', '123456789:' + 'x'.repeat(32) + 'BAD');
  assert.throws(() => g.gs.adminTelegramCheck(ADMIN), /봇 토큰이 안 맞아요\)\. 봇 토큰이 바뀌었거나 봇이 지워졌어요/);
});

test('텔레그램: 연결을 끊거나 새 토큰을 저장하면 예전 실패 기록은 지워요. 토큰이 없으면 띠도 없어요', () => {
  const g = fresh();
  tgOn(g);
  g.setKst('2026-11-16 15:00');
  g.tg.down = true;
  g.gs.notify_(g.gs.settings_(), '시험', '내용');
  assert.ok(banner(g, 'tg'));
  g.tg.down = false;
  g.gs.adminTelegramOff(ADMIN);
  assert.equal(g.props.get('health:tg'), undefined);
  assert.equal(banner(g, 'tg'), '');
  g.props.set('health:tg', JSON.stringify({ at: '2026-11-16 15:00', kind: 'token', err: '봇 토큰이 안 맞아요' }));
  assert.equal(banner(g, 'tg'), '', '텔레그램을 안 쓰면 안 띄워요');
  g.gs.adminTelegram(ADMIN, TOKEN);
  assert.equal(g.props.get('health:tg'), undefined, '새 토큰이 맞으면 지워요');
});

test('텔레그램: 사장님 방이 아직 연결 전(토큰만)이면 사장님 방 문제는 안 띄우고, 토큰·서버 문제는 띄워요', () => {
  const g = fresh();
  tgOn(g);
  g.gs.setSetting_('텔레그램채팅ID', '');
  g.setKst('2026-11-16 16:00');
  g.props.set('health:tg', JSON.stringify({ at: '2026-11-16 15:00', kind: 'chat', err: '봇이 채팅방에서 빠졌거나 막혔어요' }));
  assert.equal(banner(g, 'tg'), '');
  g.props.set('health:tg', JSON.stringify({ at: '2026-11-16 15:00', kind: 'net', err: '텔레그램 서버에 연결이 안 돼요' }));
  assert.match(banner(g, 'tg'), /15:00부터 안 가요/);
});

/* ───── 미출근 알림: 한 곳이라도 가야 '보냄' ───── */

test('미출근 알림: 아무 데도 못 갔으면 10분마다 다시 보내고, 가면 그만 보내요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002' }); // 메일 없음: 사장님 알림은 텔레그램뿐
  g.tg.down = true;
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(sends(g, 555).length, 1);
  assert.equal(sends(g, 9002).length, 1);
  assert.equal(g.props.get('alert:2026-11-16:김민우'), 'retry:610:610', "못 보내서 '보냄'으로 안 적었어요");
  g.gs.checkMissing(); // 같은 때 겹쳐 돈 실행
  assert.equal(sends(g, 555).length, 1, '바로 또 보내지 않아요');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(sends(g, 555).length, 1, '10분이 안 지났어요');
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(sends(g, 555).length, 2, '10분 뒤 다시');
  assert.equal(sends(g, 9002).length, 2);
  assert.equal(g.props.get('alert:2026-11-16:김민우'), 'retry:610:620');
  g.tg.down = false;
  g.setKst('2026-11-16 10:30');
  g.gs.checkMissing();
  // 박점장(텔레그램 안 켬)도 못 받았던 사람이라 같이 들어가요
  assert.match(sentTo(g, 555).at(-1), /아직 출근 안 찍은 직원 2명[\s\S]*\[왕십리\] 김민우 \(출근 예정 10:00\)\n\[왕십리\] 박점장 \(출근 예정 10:00\)/);
  assert.match(sentTo(g, 9002).at(-1), /아직 출근을 안 찍었어요/);
  assert.equal(g.props.get('alert:2026-11-16:김민우'), '1');
  assert.equal(g.props.get('alert:2026-11-16:박점장'), '1');
  g.setKst('2026-11-16 10:40');
  g.gs.checkMissing();
  assert.equal(sends(g, 555).length, 3, '간 뒤로는 안 보내요');
  assert.equal(sends(g, 9002).length, 3);
});

test('미출근 알림: 계속 안 가면 처음부터 1시간까지만(10분마다) 해 보고 그만해요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002' });
  g.tg.down = true;
  for (let m = 10; m <= 80; m += 10) { // 10:10 ~ 11:20
    g.setKst('2026-11-16 ' + (m < 60 ? '10:' + m : '11:' + String(m - 60).padStart(2, '0')));
    g.gs.checkMissing();
  }
  assert.equal(sends(g, 555).length, 6, '10:10, 10:20 … 11:00 여섯 번');
  assert.equal(sends(g, 9002).length, 6);
  assert.equal(g.tg.sent.length, 0);
});

test('미출근 알림: 직원이나 사장님 메일 중 한 곳이라도 가면 한 번으로 끝나요', () => {
  // 텔레그램은 안 되지만 메일은 돼요
  const g = fresh({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.tg.down = true;
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  assert.equal(g.props.get('alert:2026-11-16:김민우'), '1');
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  // 사장님 방은 막혔지만 직원 본인에게는 갔어요
  const h = fresh();
  tgOn(h, { 김민우: '9002' });
  h.tg.gone = ['555'];
  h.setKst('2026-11-16 10:10');
  h.gs.checkMissing();
  assert.equal(sentTo(h, 9002).length, 1);
  assert.equal(h.props.get('alert:2026-11-16:김민우'), '1');
  assert.equal(h.props.get('alert:2026-11-16:박점장'), 'retry:610:610', '박점장은 텔레그램을 안 켜서 아무 데도 못 갔어요');
  h.setKst('2026-11-16 10:20');
  h.gs.checkMissing();
  assert.equal(sentTo(h, 9002).length, 1, '김민우는 다시 안 보내요');
  assert.equal(sends(h, 555).length, 2);
  assert.match(sends(h, 555).at(-1).payload.text, /직원 1명[\s\S]*박점장/, '사장님께는 못 받은 박점장만 다시');
  assert.doesNotMatch(sends(h, 555).at(-1).payload.text, /김민우/);
  assert.match(banner(h, 'tg'), /10:10부터 안 가요/, '사장님 방이 막힌 건 빨간 띠로 알려요');
});

test('미출근 알림: 보낼 곳이 아예 없는 직원은 다시 해 볼 것도 없어요', () => {
  const g = fresh();
  tgOn(g); // 직원은 텔레그램을 안 켰고 사장님 방도 아직 연결 전
  g.gs.setSetting_('텔레그램채팅ID', '');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(g.tg.calls.filter((c) => c.method === 'sendMessage').length, 0);
  assert.equal(g.props.get('alert:2026-11-16:김민우'), '1');
});

/* ───── 3) 웹 앱이 예전 버전이면 ───── */

test('코드 버전: setup·자동 실행이 지금 코드 버전을 맨 앞에 적어요(원본은 dev)', () => {
  const g = fresh();
  assert.equal(g.gs.CODE_VER, 'dev');
  assert.equal(g.props.get('health:ver'), 'dev');
  g.props.set('health:ver', 'aaaa1111,dev,bbbb2222');
  g.setKst('2026-11-16 10:00');
  g.gs.checkMissing();
  assert.equal(g.props.get('health:ver'), 'dev,aaaa1111,bbbb2222', '자동 실행(시트 코드)도 적어요');
  g.props.set('health:ver', Array.from({ length: 12 }, (_, i) => 'v' + i).join(','));
  g.gs.setup();
  assert.equal(g.props.get('health:ver').split(',').length, 10, '최근 10개만');
  assert.equal(g.props.get('health:ver').split(',')[0], 'dev');
});

test('코드 버전: 웹 앱 번호가 예전 시트 코드 번호면 빨간 띠, 처음 보는 번호(막 새로 배포)면 안 띄워요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:10');
  assert.equal(banner(g, 'ver'), '', '같은 버전');
  g.props.set('health:ver', 'abcd1234,dev'); // 새 코드를 붙여넣고 setup 했는데 웹 앱(dev)은 그대로
  assert.equal(banner(g, 'ver'), '시트에 붙여넣은 코드가 바뀌었는데 웹 앱은 아직 예전 버전이에요. Apps Script → 배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포를 눌러 주세요.');
  assert.equal(health(g).ver, 'dev');
  g.props.set('health:ver', 'abcd1234'); // 새로 배포를 먼저 하고 setup은 아직
  assert.equal(banner(g, 'ver'), '', '웹 앱이 더 새것일 수 있어서 안 띄워요');
  g.props.delete('health:ver');
  assert.equal(banner(g, 'ver'), '');
});

test('코드 버전: build.js가 세 파일 내용으로 번호를 찍고, 시트 코드와 배포한 웹 앱이 다르면 알아봐요', () => {
  const build = require('../build');
  const dir = path.join(__dirname, '..');
  const a = build.bundle();
  assert.equal(a, build.bundle(), '내용이 같으면 늘 같은 번호');
  const verA = /^var CODE_VER = '([0-9a-f]{8})';$/m.exec(a)[1];
  assert.equal((a.match(/^var CODE_VER = /gm) || []).length, 1);
  const code = fs.readFileSync(path.join(dir, 'Code.gs'), 'utf8');
  const idx = fs.readFileSync(path.join(dir, 'Index.html'), 'utf8');
  const adm = fs.readFileSync(path.join(dir, 'Admin.html'), 'utf8');
  assert.equal(build.codeVersion(code, idx, adm), verA);
  assert.equal(build.codeVersion(code.replace("var CODE_VER = 'dev';", "var CODE_VER = 'zz';"), idx, adm), verA, '버전 줄 자체는 번호에 안 들어가요');
  assert.notEqual(build.codeVersion(code, idx, adm + '\n<!-- 고침 -->'), verA, '화면만 바꿔도 번호가 바뀌어요');
  assert.notEqual(build.codeVersion(code + '\n// 고침', idx, adm), verA);

  // 화면을 고친 새 버전(B)을 만들어요: 시트에는 B를 붙여넣고 setup, 웹 앱은 아직 A
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f2-health-'));
  try {
    for (const f of ['build.js', 'Code.gs', 'Index.html']) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    fs.writeFileSync(path.join(tmp, 'Admin.html'), adm + '\n<!-- 새 버전 -->\n');
    const fileA = path.join(tmp, 'A.gs'), fileB = path.join(tmp, 'B.gs');
    fs.writeFileSync(fileA, a);
    fs.writeFileSync(fileB, require(path.join(tmp, 'build.js')).bundle());
    const now = Date.parse('2026-11-16T09:00:00+09:00');
    const web = createGas({ now, file: fileA }); // 배포해 둔 웹 앱(A)
    web.gs.setup();
    web.gs.setSetting_('관리자PIN', ADMIN);
    assert.equal(web.props.get('health:ver'), verA);
    assert.equal(banner(web, 'ver'), '');
    const sheetCode = createGas({ now, file: fileB }); // 시트에 붙여넣은 새 코드(B). 스크립트 속성은 같이 써요
    const verB = sheetCode.gs.CODE_VER;
    assert.match(verB, /^[0-9a-f]{8}$/);
    assert.notEqual(verB, verA);
    for (const [k, v] of web.props) sheetCode.props.set(k, v);
    sheetCode.gs.setup();
    web.props.set('health:ver', sheetCode.props.get('health:ver'));
    assert.equal(web.props.get('health:ver'), verB + ',' + verA);
    assert.match(banner(web, 'ver'), /웹 앱은 아직 예전 버전이에요/, '웹 앱(A)은 예전 시트 코드 번호예요');
    // 배포 관리 → 새 버전: 이제 웹 앱도 B
    sheetCode.gs.setSetting_('관리자PIN', ADMIN);
    assert.equal(banner(sheetCode, 'ver'), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
