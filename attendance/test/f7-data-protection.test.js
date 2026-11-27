// 기록 지키기: 매주 드라이브 백업 · 주민번호 열쇠 백업·되살리기 · 사장님 화면 알림(처음 보는 폰, 주민번호 전체 보기)
// 실행: node --test attendance/test/f7-data-protection.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
// 가짜 이름·가짜 번호예요
const RRN = { 김민우: '9002021357924', 이지은: '9707072123456', 박점장: '8505051234567' };

// 2026-11-16 은 월요일. 왕십리 10:00-20:00(점장 박점장), 가산 12:00-21:00. 9시에 setup(10분 자동 실행이 켜져요)
// hr: 세 사람의 인사 정보(주민번호는 암호로)를 넣어 둬요
function fresh({ hr = true } = {}) {
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
  g.gs.MEMO_ = {};
  g.gs.syncHr_();
  if (hr) {
    let i = 0;
    for (const [name, rrn] of Object.entries(RRN)) {
      i++;
      g.gs.MEMO_ = {};
      const h = g.gs.hrFind_(name);
      g.gs.hrWrite_(h.row, {
        rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: '010-1000-100' + i, addr: '서울 성동구', bank: '국민',
        account: '123456-78-90000' + i, emergency: '010-9999-8888 가족', start: '2020-01-01',
      });
    }
  }
  g.gs.MEMO_ = {};
  return g;
}
// 텔레그램: 사장님 채팅 555
function tgOn(g) {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  g.gs.MEMO_ = {};
}
const toOwner = (g) => g.tg.sent.filter((m) => String(m.chat_id) === '555');
const textsToOwner = (g, re) => toOwner(g).map((m) => m.text).filter((t) => re.test(t));
const suspects = (g) => {
  const sh = g.sheet('의심기록');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};
const settingOf = (g, key) => {
  const sh = g.sheet('설정');
  for (let r = 2; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === key) return { row: r, value: sh.rowDisplay(r)[1], note: sh.rowDisplay(r)[2] };
  return null;
};
// [인사] 탭 주민번호(암호) 칸 전부
const encCol = (g) => {
  g.gs.MEMO_ = {};
  return g.gs.hrRows_().map((h) => h.name + '=' + h.enc);
};
// 시트 메뉴 창 흉내: answers 를 차례로 돌려줘요. 입력 창(prompt)은 {text, button}, 예/아니요 창은 {alert: 'YES'|'NO'}
function fakeUi(g, answers) {
  const shown = [];
  const ui = {
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    prompt(title, msg) {
      const a = answers.shift() || { button: 'CANCEL' };
      shown.push({ kind: 'prompt', title, msg });
      return { getSelectedButton: () => a.button || 'OK', getResponseText: () => a.text || '' };
    },
    alert(title, msg) {
      shown.push({ kind: 'alert', title, msg });
      return answers.length && answers[0].alert ? answers.shift().alert : 'OK';
    },
  };
  g.gs.SpreadsheetApp.getUi = () => ui;
  return shown;
}
const backupNow = (g, when) => {
  g.setKst(when);
  g.gs.MEMO_ = {};
  return g.gs.weeklyBackup_(g.gs.settings_(), g.gs.nowKst_());
};

/* ───── 1) 매주 백업 ───── */

test('ISO 주 번호: 월요일에 시작하고, 해가 바뀌는 주는 목요일이 든 해로 세요', () => {
  const { gs } = createGas({ now: 0 });
  assert.equal(gs.isoWeek_('2026-11-16'), '2026-W47'); // 월
  assert.equal(gs.isoWeek_('2026-11-22'), '2026-W47'); // 일
  assert.equal(gs.isoWeek_('2026-11-23'), '2026-W48');
  assert.equal(gs.isoWeek_('2026-12-31'), '2026-W53');
  assert.equal(gs.isoWeek_('2027-01-01'), '2026-W53', '2027년 1월 1일(금)은 2026년 마지막 주');
  assert.equal(gs.isoWeek_('2027-01-04'), '2027-W01');
  assert.equal(gs.isoWeek_('2025-12-29'), '2026-W01', '2025년 12월 29일(월)은 2026년 첫 주');
  assert.equal(gs.isoWeek_('2021-01-03'), '2020-W53');
});

test('매주 백업: 새벽 3~6시에 시트 전체를 [출퇴근 백업] 폴더로 복사하고, 같은 주에는 다시 안 만들어요', () => {
  const g = fresh({ hr: false });
  tgOn(g);
  const at = (s) => { g.setKst(s); g.gs.checkMissing(); };
  at('2026-11-16 02:50');
  assert.equal(g.drive.files.length, 0, '3시 전에는 안 해요');
  at('2026-11-16 03:00');
  assert.equal(g.drive.folders.length, 1);
  const folder = g.drive.folders[0];
  assert.equal(folder.name, '출퇴근 백업', '폴더가 없으면 만들어요');
  assert.deepEqual(g.drive.namesIn(folder), ['출퇴근 백업 2026-11-16']);
  const copy = g.drive.files[0];
  assert.equal(copy.source, 'TEST', '이 시트 파일을 복사해요');
  assert.match(copy.desc, /^출퇴근 앱이 매주 자동으로 만든 백업이에요\. 최근 8개만 남기고 오래된 것은 휴지통으로 옮겨요\. \(원본 TEST\)$/);
  assert.equal(g.props.get('backup:week'), '2026-W47');
  assert.equal(g.props.get('backup:folder'), folder.id, '폴더를 기억해요');
  at('2026-11-16 03:10');
  at('2026-11-17 04:00');
  at('2026-11-22 05:59'); // 일요일(같은 주)
  assert.equal(g.drive.files.length, 1, '같은 주에는 한 번만');
  at('2026-11-23 02:59');
  at('2026-11-23 06:00');
  at('2026-11-23 13:00');
  assert.equal(g.drive.files.length, 1, '3시 전·6시부터는 안 해요');
  at('2026-11-23 05:59');
  assert.deepEqual(g.drive.namesIn(folder), ['출퇴근 백업 2026-11-16', '출퇴근 백업 2026-11-23'], '다음 주 새벽에 하나 더');
  assert.equal(g.drive.folders.length, 1, '폴더는 그대로 하나');
  assert.equal(textsToOwner(g, /백업/).length, 0, '잘 되면 알림은 안 보내요');
});

test('매주 백업: 앱이 만든 백업은 최근 8개만 남겨요. 사장님 파일·이름 바꾼 백업·다른 시트의 백업은 그대로', () => {
  const g = fresh({ hr: false });
  assert.equal(backupNow(g, '2026-11-16 03:00'), '출퇴근 백업 2026-11-16');
  const folder = g.drive.folders[0];
  g.drive.files[0].setName('출퇴근 백업 2026-11-16 보관'); // 사장님이 오래 남기려고 이름을 바꿈
  g.drive.addFile('사장님 메모', folder);
  g.drive.addFile('출퇴근 백업 2026-11-18', folder, '출퇴근 앱이 매주 자동으로 만든 백업이에요. (원본 OTHER)'); // 시험용 사본 시트가 같은 폴더에 만든 백업
  const days = [];
  for (let i = 1; i <= 10; i++) {
    const d = g.gs.addDays_('2026-11-16', 7 * i);
    days.push(d);
    assert.equal(backupNow(g, d + ' 03:30'), '출퇴근 백업 ' + d);
  }
  const names = g.drive.namesIn(folder);
  const mine = names.filter((n) => /^출퇴근 백업 \d{4}-\d{2}-\d{2}$/.test(n) && n !== '출퇴근 백업 2026-11-18');
  assert.deepEqual(mine, days.slice(2).map((d) => '출퇴근 백업 ' + d), '최근 8개만');
  assert.deepEqual(g.drive.files.filter((f) => f.trashed).map((f) => f.name), ['출퇴근 백업 2026-11-23', '출퇴근 백업 2026-11-30'], '오래된 것은 휴지통으로(지우지 않아요)');
  for (const n of ['출퇴근 백업 2026-11-16 보관', '사장님 메모', '출퇴근 백업 2026-11-18']) assert.ok(names.includes(n), n + ' 은 그대로');
  assert.equal(g.drive.files.length, 13, '파일을 아예 지우지는 않아요');
});

test('매주 백업: 휴지통에 버린 폴더는 안 쓰고, 사장님이 먼저 만든 같은 이름 폴더나 이름을 바꾼 폴더는 계속 써요', () => {
  const g = fresh({ hr: false });
  const made = g.drive.addFolder('출퇴근 백업'); // 사장님이 미리 만든 폴더
  backupNow(g, '2026-11-16 03:00');
  assert.equal(g.drive.files[0].parent, made.id, '같은 이름 폴더가 있으면 그걸 써요');
  assert.equal(g.drive.folders.length, 1);
  made.setTrashed(true); // 사장님이 폴더를 휴지통에 버림
  backupNow(g, '2026-11-23 03:00');
  const live = g.drive.folders.filter((f) => !f.trashed);
  assert.equal(live.length, 1);
  assert.notEqual(live[0].id, made.id, '휴지통 폴더에 넣으면 30일 뒤 사라져서 새로 만들어요');
  assert.equal(g.drive.files.at(-1).parent, live[0].id);
  assert.equal(g.props.get('backup:folder'), live[0].id);
  g.drive.folders.splice(g.drive.folders.indexOf(live[0]), 1); // 휴지통도 비워서 아주 없어짐
  const other = g.drive.addFolder('출퇴근 백업');
  backupNow(g, '2026-11-30 03:00');
  assert.equal(g.drive.files.at(-1).parent, other.id, '기억해 둔 폴더가 없으면 같은 이름 폴더를 찾아요');
  other.name = '출퇴근 백업 (사장님)'; // 이름을 바꿔도
  backupNow(g, '2026-12-07 03:00');
  assert.equal(g.drive.files.at(-1).parent, other.id, '기억해 둔 폴더에 계속 넣어요');
  assert.equal(g.drive.folders.length, 2);
});

test('매주 백업: 못 만들면 사장님께 하루 한 번 알리고, 될 때까지 10분마다 다시 해요', () => {
  const g = fresh({ hr: false });
  tgOn(g);
  // 새 코드를 붙여넣고 드라이브 권한을 아직 허용하지 않은 것처럼
  g.drive.fail = 'You do not have permission to call DriveApp.getFoldersByName. Required permissions: https://www.googleapis.com/auth/drive';
  g.setKst('2026-11-16 03:00');
  g.gs.checkMissing();
  let fails = textsToOwner(g, /자동 작업을 못 했어요/);
  assert.equal(fails.length, 1);
  assert.match(fails[0], /\[주간 백업\] 드라이브 \[출퇴근 백업\] 폴더에 사본을 못 만들었어요\. 시트 메뉴 출퇴근 → setup 실행을 한 번 눌러 드라이브 권한을 허용했는지 확인해 주세요\. \(You do not have permission/);
  assert.equal(g.props.get('backup:week'), undefined, '못 만들었으니 이번 주는 아직이에요');
  g.setKst('2026-11-16 03:10');
  g.gs.checkMissing();
  assert.equal(textsToOwner(g, /자동 작업을 못 했어요/).length, 1, '같은 날은 한 번만 알려요');
  g.drive.fail = '';
  g.setKst('2026-11-16 03:20');
  g.gs.checkMissing();
  assert.equal(g.drive.files.length, 1, '되면 바로 만들어요');
  assert.equal(g.props.get('backup:week'), '2026-W47');
});

test('매주 백업: 사본은 만들었는데 오래된 것을 못 치우면, 그렇다고 알리고 그 주에 또 만들지는 않아요', () => {
  const g = fresh({ hr: false });
  for (let i = 0; i < 8; i++) backupNow(g, g.gs.addDays_('2026-11-16', 7 * i) + ' 03:00');
  assert.equal(g.drive.files.length, 8);
  g.drive.files[0].setTrashed = () => { throw new Error('Access denied: DriveApp.'); }; // 가장 오래된 백업을 못 옮김
  assert.throws(() => backupNow(g, '2027-01-11 03:00'), /^Error: 이번 주 백업\(출퇴근 백업 2027-01-11\)은 만들었는데 오래된 백업을 정리하지 못했어요\. 다음 주에 다시 해 봐요\./);
  assert.equal(g.props.get('backup:week'), '2027-W02', '만든 건 만든 거예요');
  assert.equal(backupNow(g, '2027-01-11 03:10'), '', '같은 주에 또 만들지 않아요');
  assert.equal(g.drive.files.length, 9);
});

test('[설정] 자동백업: 기본 켬. 끔이면 안 하고, 예전 [설정] 탭처럼 줄이 없어도 켬이에요', () => {
  const g = fresh({ hr: false });
  const row = settingOf(g, '자동백업');
  assert.equal(row.value, '켬', 'setup이 줄을 만들어요');
  assert.match(row.note, /^켬: 매주 한 번\(보통 월요일 새벽 3~6시\) 이 시트 전체를 구글 드라이브 \[출퇴근 백업\] 폴더에 사본으로 저장해요/);
  assert.equal(g.gs.settings_().backup, '켬');
  g.gs.setSetting_('자동백업', '끔');
  assert.equal(g.gs.settings_().backup, '끔');
  g.setKst('2026-11-16 03:00');
  g.gs.checkMissing();
  assert.equal(g.drive.files.length, 0, '끔이면 안 해요');
  assert.equal(g.drive.folders.length, 0, '폴더도 안 만들어요');
  g.sheet('설정').deleteRow(row.row);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.settings_().backup, '켬', '줄이 없으면 켬');
  g.setKst('2026-11-16 03:10');
  g.gs.checkMissing();
  assert.equal(g.drive.files.length, 1);
});

/* ───── 2) 주민번호 열쇠 ───── */

test('주민번호 열쇠: 열쇠가 없는데 암호 칸이 있으면(사본·새 프로젝트) setup이 새 열쇠를 만들지 않고 멈춰요', () => {
  const g = fresh();
  const before = encCol(g);
  g.props.delete('hrKey');
  const setupAt = g.props.get('health:setupAt');
  g.setKst('2026-11-16 15:00');
  assert.throws(() => g.gs.setup(), (e) => {
    assert.equal(e.message, 'setup을 멈췄어요. 주민번호 열쇠가 없어요. [인사] 탭에 암호로 저장된 주민번호가 3명 있는데, 새 열쇠를 만들면 이 번호들을 영영 못 풀어요.\n' +
      '시트 메뉴 출퇴근 → 주민번호 열쇠 백업·되살리기에서 백업해 둔 열쇠를 붙여넣은 뒤 setup을 다시 실행해 주세요. 이 파일이 사본이면 원본 시트의 같은 메뉴에서 열쇠를 볼 수 있어요.');
    return true;
  });
  assert.equal(g.props.get('hrKey'), undefined, '새 열쇠를 안 만들어요');
  assert.deepEqual(encCol(g), before, '암호 칸은 그대로');
  assert.equal(g.props.get('health:setupAt'), setupAt, 'setup은 아무것도 안 했어요');
  assert.equal(g.props.get('setupRun'), undefined);
});

test('주민번호 열쇠: 열쇠가 없으면 입사 등록·주민번호 저장도 새 열쇠를 만들지 않고 막아요', () => {
  const g = fresh();
  g.props.delete('hrKey');
  const msg = /^Error: 주민번호 열쇠가 없어서 지금은 주민번호를 저장할 수 없어요\. 사장님이 시트 메뉴 출퇴근 → 주민번호 열쇠 백업·되살리기에서 열쇠를 되살려야 해요\.$/;
  assert.throws(() => g.gs.joinSubmit({
    name: '한신입', rrn: '950101-1928374', phone: '01012345678', addr: '서울 성동구 왕십리로 1', bank: '국민',
    account: '123456-78-901234', holder: '', emergency: '010-9999-8888 어머니', store: '왕십리', start: '2026-11-16',
    pin: '4826', device: '1111222233334444', label: 'Galaxy 크롬', agree: true, agreeLoc: true,
  }), msg);
  assert.throws(() => g.gs.adminHrSave(ADMIN, '김민우', { rrn: '900202-1357925' }), msg);
  // 사장님이 [인사] 탭에 13자리를 직접 적어도 새 열쇠로 암호화하지 않아요. 그 칸만 빨갛게 두고 나머지 맞추기는 계속해요
  const sh = g.sheet('인사');
  const col = sh.rowDisplay(1).indexOf('주민번호') + 1;
  g.gs.MEMO_ = {};
  const row = g.gs.hrFind_('이지은').row;
  sh.getRange(row, col).setNumberFormat('@').setValue('970707-2123456');
  g.gs.MEMO_ = {};
  g.gs.syncHr_(); // 멈추지 않아요([직원] 목록·근로자 명부·[직원]↔[인사] 맞추기가 계속 돼요)
  assert.equal(sh.getRange(row, col).getDisplayValue(), '970707-2123456', '적은 번호는 지우지 않아요');
  assert.match(sh.getRange(row, col).getNotes()[0][0], /주민번호 열쇠가 없어서 아직 가리지 못했어요/);
  assert.ok(plain(g.gs.adminHrList(ADMIN)), '[직원] 목록도 열려요');
  assert.equal(g.props.get('hrKey'), undefined, '어디서도 새 열쇠를 안 만들어요');
  assert.throws(() => g.gs.adminHrRrn(ADMIN, '김민우'), /주민번호 열쇠가 없어요\(스크립트를 새로 만들었나요\?\)\. 시트 메뉴 출퇴근 → 주민번호 열쇠 백업·되살리기에서 백업해 둔 열쇠를 되살려 주세요\./);
});

test('주민번호 열쇠: 처음 설치처럼 암호 칸이 없으면 열쇠가 없어도 그냥 만들어요', () => {
  const g = fresh({ hr: false });
  g.props.delete('hrKey');
  g.gs.setup();
  assert.match(g.props.get('hrKey'), /^[A-Za-z0-9+/]{43}=$/);
});

test('주민번호 열쇠: 열쇠가 없어지면 10분 자동 실행이 사장님께 하루 한 번 알려요', () => {
  const g = fresh();
  tgOn(g);
  g.setKst('2026-11-16 10:00');
  g.gs.checkMissing();
  assert.equal(textsToOwner(g, /주민번호 열쇠/).length, 0, '열쇠가 있으면 조용해요');
  g.props.delete('hrKey'); // 누가 스크립트 속성에서 지웠어요
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  const notes = textsToOwner(g, /주민번호 열쇠가 없어요/);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^\[굳폰 출퇴근\] 주민번호 열쇠가 없어요\n[^\n]+\n\[인사\] 탭에 암호로 저장된 주민번호가 3명 있는데 풀 열쇠가 없어요\. 지금은 주민번호를 보거나 새로 저장할 수 없어요\(신입 입사 등록도 막혀요\)\.\n시트 메뉴 출퇴근 → 주민번호 열쇠 백업·되살리기에서 백업해 둔 열쇠를 붙여넣어 주세요\./);
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(textsToOwner(g, /주민번호 열쇠가 없어요/).length, 1, '하루 한 번');
  g.setKst('2026-11-17 10:00');
  g.gs.checkMissing();
  assert.equal(textsToOwner(g, /주민번호 열쇠가 없어요/).length, 2, '다음 날 또');
  assert.equal(g.props.get('hrKey'), undefined, '알리기만 하고 열쇠는 안 만들어요');
});

test('열쇠 메뉴: 웹 화면에서는 안 열리고, 관리자 비밀번호가 맞아야 열쇠를 보여줘요', () => {
  const g = fresh();
  assert.throws(() => g.gs.menuHrKey(), /getUi/, '웹 화면에서 부르면 멈춰요(시트 메뉴에서만)');
  const shown = fakeUi(g, [{ text: '000000' }]);
  g.setActiveUser(''); // 혹시 창이 떠도 사장님이 아니면
  assert.throws(() => g.gs.menuHrKey(), /시트 메뉴에서만/);
  g.setActiveUser('owner@example.com');
  assert.equal(g.gs.menuHrKey(), 'wrong');
  const key = g.props.get('hrKey');
  assert.ok(!shown.some((s) => s.msg.includes(key)), '틀리면 열쇠를 안 보여줘요');
  assert.equal(shown[0].msg, '주민번호 열쇠는 사장님만 봐야 해요. 관리자 비밀번호를 넣어 주세요.');
  assert.equal(shown.at(-1).msg, '관리자 비밀번호가 틀렸어요. 열쇠는 보여주지 않았어요.');
  assert.ok(suspects(g).some((r) => r[1] === '(시트 메뉴)' && r[2] === '주민번호 열쇠 비밀번호 틀림'));
  fakeUi(g, [{ button: 'CANCEL' }]);
  assert.equal(g.gs.menuHrKey(), 'cancel');
});

test('열쇠 메뉴: 지금 열쇠와 보관하는 법을 보여주고, 그냥 닫으면 아무것도 안 바뀌어요', () => {
  const g = fresh();
  const key = g.props.get('hrKey');
  let shown = fakeUi(g, [{ text: ADMIN }, { button: 'CANCEL' }]);
  assert.equal(g.gs.menuHrKey(), 'shown');
  const msg = shown[1].msg;
  assert.equal(shown[1].title, '주민번호 열쇠 백업·되살리기');
  assert.ok(msg.includes('\n\n' + key + '\n\n'), '열쇠 44글자를 한 줄로 보여줘요');
  assert.match(msg, /^지금 쓰는 주민번호 열쇠예요\. 아래 44글자를 빠짐없이 복사해서 시트 밖 안전한 곳에 보관해 두세요/);
  assert.match(msg, /이 열쇠가 있어야 저장된 주민번호\(3명\)를 볼 수 있어요/);
  assert.match(msg, /시트 안이나 단톡방처럼 다른 사람도 보는 곳에는 적지 마세요/);
  assert.match(msg, /적어 둔 열쇠가 맞는지 볼 때나 열쇠를 되살릴 때는 아래 칸에 붙여넣고 \[확인\]을 누르세요\(맞게 적었으면 "지금 쓰는 열쇠와 같아요"가 나와요\)/);
  assert.doesNotMatch(msg, /안 풀려요/);
  assert.equal(g.props.get('hrKey'), key);
  assert.ok(suspects(g).some((r) => r[1] === '(시트 메뉴)' && r[2] === '주민번호 열쇠 보기'), '본 기록이 남아요');
  shown = fakeUi(g, [{ text: ADMIN }, { text: '' }]); // [확인]을 빈칸으로
  assert.equal(g.gs.menuHrKey(), 'shown');
  // 적어 둔 열쇠 확인: 맞게 적었으면 그렇다고 알려 줘요
  shown = fakeUi(g, [{ text: ADMIN }, { text: key }]);
  assert.equal(g.gs.menuHrKey(), 'same');
  assert.equal(shown.at(-1).msg, '지금 쓰는 열쇠와 같아요. 잘 적어 두셨어요.');
  // 한 글자 틀리게 적었으면 바꾸지 않고 알려 줘요
  const typo = (key[0] === 'A' ? 'B' : 'A') + key.slice(1);
  shown = fakeUi(g, [{ text: ADMIN }, { text: typo }]);
  assert.equal(g.gs.menuHrKey(), 'bad');
  assert.match(shown.at(-1).msg, /이 열쇠로는 저장된 주민번호를 하나도 풀 수 없어요/);
  assert.equal(g.props.get('hrKey'), key, '지금 열쇠는 그대로');
});

test('열쇠 메뉴: 열쇠가 없어졌을 때 백업해 둔 열쇠를 붙여넣으면 맞는지 확인하고 되살려요(그 뒤 setup·전체 보기가 돼요)', () => {
  const g = fresh();
  const key = g.props.get('hrKey');
  g.props.delete('hrKey');
  // 엉뚱한 열쇠
  let shown = fakeUi(g, [{ text: ADMIN }, { text: crypto.randomBytes(32).toString('base64') }]);
  assert.equal(g.gs.menuHrKey(), 'bad');
  assert.match(shown[1].msg, /^주민번호 열쇠가 없어요\. 그래서 저장된 주민번호 3명을 지금은 볼 수 없고, 새 주민번호도 저장할 수 없어요\(setup도 멈춰요\)\./);
  assert.match(shown[1].msg, /이 파일이 사본·백업이면 원본 시트의 같은 메뉴에서 열쇠를 볼 수 있어요/);
  assert.match(shown[1].msg, /끝내 못 찾으면 아래 칸에 새로 시작 이라고 적으세요/);
  assert.equal(shown.at(-1).msg, '이 열쇠로는 저장된 주민번호를 하나도 풀 수 없어요. 다른 열쇠인지, 빠진 글자가 없는지 확인해 주세요. (열쇠는 그대로 뒀어요)');
  assert.equal(g.props.get('hrKey'), undefined, '틀린 열쇠는 안 넣어요');
  // 글자가 빠진 열쇠
  shown = fakeUi(g, [{ text: ADMIN }, { text: key.slice(0, 40) }]);
  assert.equal(g.gs.menuHrKey(), 'bad');
  assert.match(shown.at(-1).msg, /^열쇠 모양이 아니에요\. 열쇠는 영어·숫자로 된 44글자이고 끝이 = 예요\./);
  // 맞는 열쇠(복사하다 띄어쓰기·줄바꿈이 들어가도 돼요)
  shown = fakeUi(g, [{ text: ADMIN }, { text: ' ' + key.slice(0, 20) + '\n' + key.slice(20) + ' ' }]);
  assert.equal(g.gs.menuHrKey(), 'restored');
  assert.equal(g.props.get('hrKey'), key);
  assert.equal(shown.at(-1).msg, '열쇠를 되살렸어요. 저장된 주민번호 3명을 다시 볼 수 있어요.\n이제 시트 메뉴 출퇴근 → setup 실행을 다시 눌러 주세요.');
  assert.ok(suspects(g).some((r) => r[2] === '주민번호 열쇠 되살림' && r[3] === '풀림 3명'));
  g.gs.setup(); // 이제 멈추지 않아요
  assert.equal(g.gs.adminHrRrn(ADMIN, '김민우').rrn, '900202-1357924');
});

test('열쇠 메뉴: 끝내 못 찾으면 새로 시작(예전 번호는 다시 받아요). 나중에 예전 열쇠를 찾으면 그사이 받은 번호도 안 잃고 되살려요', () => {
  const g = fresh();
  const oldKey = g.props.get('hrKey');
  g.props.delete('hrKey');
  let shown = fakeUi(g, [{ text: ADMIN }, { text: '새로 시작' }, { alert: 'NO' }]);
  assert.equal(g.gs.menuHrKey(), 'cancel', '[아니요]면 그대로');
  assert.equal(g.props.get('hrKey'), undefined);
  assert.match(shown.at(-1).msg, /^정말 새 열쇠를 만들까요\?\n이미 받은 주민번호 3명은 영영 볼 수 없게 돼요\. 직원들에게 다시 받아야 해요/);
  shown = fakeUi(g, [{ text: ADMIN }, { text: '새로시작' }, { alert: 'YES' }]);
  assert.equal(g.gs.menuHrKey(), 'fresh');
  const newKey = g.props.get('hrKey');
  assert.ok(newKey && newKey !== oldKey, '새 열쇠');
  const done = shown.at(-1).msg;
  assert.match(done, /^새 열쇠를 만들었어요\. 이제 setup을 다시 실행해 주세요\.\n\n지금 쓰는 주민번호 열쇠예요/);
  assert.ok(done.includes(newKey), '새 열쇠를 바로 보여줘요(적어 두게)');
  assert.match(done, /저장된 주민번호\(0명\)/);
  assert.match(done, /3명은 이 열쇠로 안 풀려요\. 그 직원들에게 주민번호를 다시 받아 주세요\./);
  assert.doesNotMatch(done, /붙여넣고/, '입력 칸이 없는 창이에요');
  assert.ok(suspects(g).some((r) => r[2] === '주민번호 열쇠 새로 만듦' && r[3] === '예전 열쇠로 저장된 3명은 못 풀어요'));
  g.gs.setup(); // 멈추지 않아요
  assert.throws(() => g.gs.adminHrRrn(ADMIN, '김민우'), /풀 수 없어요/, '예전 번호는 못 풀어요');
  // 이지은은 주민번호를 다시 받았어요(새 열쇠로 저장)
  const c = plain(g.gs.adminHrGet(ADMIN, '이지은'));
  g.gs.adminHrSave(ADMIN, '이지은', { phone: c.phone, addr: c.addr, bank: c.bank, account: c.account, holder: c.holder, emergency: c.emergency, memo: c.memo, start: c.start, rrn: '970707-2123457' });
  assert.equal(g.gs.adminHrRrn(ADMIN, '이지은').rrn, '970707-2123457');
  // 예전 열쇠를 찾았어요. 메뉴를 열면 지금 열쇠로 몇 명이 안 풀리는지도 보여줘요
  shown = fakeUi(g, [{ text: ADMIN }, { text: oldKey }]);
  assert.equal(g.gs.menuHrKey(), 'restored');
  assert.match(shown[1].msg, /저장된 주민번호\(1명\)/);
  assert.match(shown[1].msg, /2명은 이 열쇠로 안 풀려요/);
  assert.equal(g.props.get('hrKey'), oldKey);
  assert.equal(shown.at(-1).msg, '열쇠를 되살렸어요. 저장된 주민번호 3명을 다시 볼 수 있어요. (그중 1명은 지금 열쇠로 저장돼 있어서 되살린 열쇠로 다시 저장했어요)');
  assert.equal(g.gs.adminHrRrn(ADMIN, '김민우').rrn, '900202-1357924', '예전 번호가 다시 풀려요');
  assert.equal(g.gs.adminHrRrn(ADMIN, '이지은').rrn, '970707-2123457', '그사이 받은 번호도 그대로');
  assert.equal(g.gs.adminHrRrn(ADMIN, '박점장').rrn, '850505-1234567');
});

test('열쇠 메뉴: 저장된 주민번호가 없으면 열쇠를 지금 만들어 보여주고, 다른 열쇠로 바꾸지는 않아요', () => {
  const g = fresh({ hr: false });
  g.props.delete('hrKey');
  let shown = fakeUi(g, [{ text: ADMIN }, { button: 'CANCEL' }]);
  assert.equal(g.gs.menuHrKey(), 'shown');
  const key = g.props.get('hrKey');
  assert.match(key, /^[A-Za-z0-9+/]{43}=$/);
  assert.ok(shown[1].msg.includes(key));
  assert.match(shown[1].msg, /저장된 주민번호\(0명\)/);
  shown = fakeUi(g, [{ text: ADMIN }, { text: crypto.randomBytes(32).toString('base64') }]);
  assert.equal(g.gs.menuHrKey(), 'bad');
  assert.equal(shown.at(-1).msg, '지금 쓰는 열쇠와 달라요. 아직 저장된 주민번호가 없어서 바꾸지 않았어요. 위에 보이는 지금 열쇠를 다시 적어 두세요.');
  assert.equal(g.props.get('hrKey'), key, '확인하다 잘못 적은 열쇠로 바뀌지 않아요');
  // 열쇠도 저장된 번호도 없을 때 붙여넣은 열쇠는 그대로 받아요(그 열쇠로 저장하고 풀어요)
  g.props.delete('hrKey');
  const other = crypto.randomBytes(32).toString('base64');
  const r = g.gs.hrKeyRestore_(other);
  assert.equal(r.ok, true);
  assert.equal(r.msg, '열쇠를 되살렸어요. 아직 저장된 주민번호가 없어서 맞는 열쇠인지는 확인하지 못했어요.\n이제 시트 메뉴 출퇴근 → setup 실행을 다시 눌러 주세요.');
  assert.equal(g.props.get('hrKey'), other);
  assert.equal(g.gs.rrnDecrypt_(g.gs.rrnEncrypt_(RRN.김민우)), RRN.김민우);
});

test('시트 메뉴: 출퇴근 메뉴에 주민번호 열쇠 백업·되살리기가 있어요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const items = [];
  g.gs.SpreadsheetApp.getUi = () => ({
    createMenu: () => { const m = { addItem: (t, f) => { items.push([t, f]); return m; }, addToUi: () => {} }; return m; },
  });
  g.gs.onOpen();
  const i = items.findIndex(([t]) => t === '주민번호 열쇠 백업·되살리기');
  assert.ok(i > 0);
  assert.equal(items[i][1], 'menuHrKey');
  assert.equal(items[i - 1][1], 'setup', 'setup 바로 아래');
});

/* ───── 3) 사장님 화면 알림 ───── */

test('사장님 화면: 처음 보는 폰으로 들어오면 텔레그램으로 알려요(폰마다 한 번. 틀린 비밀번호·점장·번호 없는 부르기는 안 알려요)', () => {
  const g = fresh();
  tgOn(g);
  g.setKst('2026-11-16 14:05');
  const devA = 'a1b2c3d4e5f60718';
  assert.equal(plain(g.gs.adminToday({ pin: ADMIN, dev: devA })).role, 'admin');
  let sent = textsToOwner(g, /처음 보는 폰/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].split('\n')[0], '[굳폰 출퇴근] 처음 보는 폰에서 사장님 화면에 들어왔어요 (14:05)');
  assert.match(sent[0], /\n사장님이 새 폰·PC로 들어왔거나 브라우저 기록을 지운 거면 괜찮아요\.\n모르는 일이면 시트 \[설정\] 탭의 관리자PIN을 바로 바꿔 주세요/);
  assert.equal(toOwner(g).find((m) => /처음 보는 폰/.test(m.text)).disable_notification, false, '소리 나게 보내요');
  g.gs.adminToday({ pin: ADMIN, dev: devA });
  g.cache.clear(); // 몇 시간 지나 기억(캐시)이 비어도
  g.gs.adminToday({ pin: ADMIN, dev: devA });
  assert.equal(textsToOwner(g, /처음 보는 폰/).length, 1, '본 폰은 다시 안 알려요');
  assert.equal(g.props.get('adminDevs'), devA);
  assert.throws(() => g.gs.adminToday({ pin: '000001', dev: 'ffffffffffff0001' }), /틀렸어요/);
  assert.equal(plain(g.gs.adminToday({ ...MGR, dev: 'ffffffffffff0002' })).role, 'manager');
  assert.equal(textsToOwner(g, /처음 보는 폰/).length, 1, '틀린 비밀번호·점장은 안 알려요');
  g.gs.adminToday(ADMIN); // 폰 번호 없이(사장님 화면 밖에서 부름): 사장님 폰을 본 뒤라 알려요(6시간에 한 번)
  g.gs.adminToday(ADMIN);
  const outside = textsToOwner(g, /사장님 화면 밖에서 관리자 비밀번호로 들어왔어요/);
  assert.equal(outside.length, 1);
  assert.match(outside[0], /\(14:05\)/);
  assert.equal(g.props.get('adminDevs'), devA, '번호 없음은 본 폰 목록에 안 넣어요');
  g.setKst('2026-11-16 21:30');
  g.gs.adminHrList({ pin: ADMIN, dev: 'b1b2c3d4e5f60718' }); // 어느 기능이든 처음 보는 폰이면
  sent = textsToOwner(g, /처음 보는 폰/);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /^\[굳폰 출퇴근\] 처음 보는 폰에서 사장님 화면에 들어왔어요 \(21:30\)/);
  assert.equal(g.props.get('adminDevs'), devA + ',b1b2c3d4e5f60718');
});

test('사장님 화면: 처음 보는 폰 알림은 한 시간에 5번까지. 그동안 들어온 폰은 쉬는 시간이 끝나면 알려요', () => {
  const g = fresh({ hr: false });
  tgOn(g);
  const dev = (i) => 'dev' + String(i).padStart(13, '0');
  for (let i = 0; i < 7; i++) g.gs.adminToday({ pin: ADMIN, dev: dev(i) });
  let sent = textsToOwner(g, /처음 보는 폰/);
  assert.equal(sent.length, 5, '번호를 바꿔 가며 들어와도 알림이 쏟아지지 않게');
  assert.doesNotMatch(sent[3], /한동안은/);
  assert.match(sent[4], /※ 한 시간 안에 처음 보는 폰이 5번 들어와서, 한동안은 이 알림을 더 안 보내요\./, '마지막 알림에 그렇다고 적어요');
  assert.deepEqual(g.props.get('adminDevs').split(','), [0, 1, 2, 3, 4].map(dev), '알리지 못한 폰은 본 폰으로 적지 않아요');
  g.gs.adminToday({ pin: ADMIN, dev: dev(6) });
  assert.equal(textsToOwner(g, /처음 보는 폰/).length, 5, '쉬는 동안은 그대로');
  g.cache.delete('admdev:n'); // 한 시간이 지났어요
  g.gs.adminToday({ pin: ADMIN, dev: dev(6) });
  sent = textsToOwner(g, /처음 보는 폰/);
  assert.equal(sent.length, 6, '쉬는 시간이 끝나면 그 폰도 알려요(알림을 채워서 몰래 들어오지 못하게)');
  g.gs.adminToday({ pin: ADMIN, dev: dev(6) });
  assert.equal(textsToOwner(g, /처음 보는 폰/).length, 6, '한 번만');
});

test('사장님 화면: 본 폰은 최근 20대만 기억해요(오래된 것부터 빠져요)', () => {
  const g = fresh({ hr: false });
  tgOn(g);
  const dev = (i) => 'dev' + String(i).padStart(13, '0');
  for (let i = 0; i < 25; i++) {
    if (i % 5 === 0) g.cache.delete('admdev:n'); // 한 시간에 5대씩 새 폰
    g.gs.adminToday({ pin: ADMIN, dev: dev(i) });
  }
  assert.equal(textsToOwner(g, /처음 보는 폰/).length, 25);
  assert.deepEqual(g.props.get('adminDevs').split(','), Array.from({ length: 20 }, (_, i) => dev(i + 5)));
});

test('주민번호 전체 보기: 사장님께 소리 없이 알려요(이름·시각만, 번호는 안 적어요). [의심기록]도 그대로 남아요', () => {
  const g = fresh();
  tgOn(g);
  g.setKst('2026-11-16 15:20');
  assert.equal(g.gs.adminHrRrn(ADMIN, '김민우').rrn, '900202-1357924');
  const msgs = toOwner(g).filter((m) => /주민번호 전체 보기/.test(m.text));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /^\[굳폰 출퇴근\] 주민번호 전체 보기 \(15:20\)\n11\/16 15:20\n김민우 님 주민번호 전체를 사장님 화면에서 봤어요\.\n사장님이 본 게 아니면 시트 \[설정\] 탭의 관리자PIN을 바로 바꿔 주세요\./);
  assert.equal(msgs[0].disable_notification, true, '소리 없이');
  assert.doesNotMatch(msgs[0].text, /900202|1357924|\*{6}/, '번호(가린 번호도)는 안 적어요');
  assert.ok(suspects(g).some((r) => r[1] === '(사장님 화면)' && r[2] === '주민번호 전체 보기' && r[3] === '김민우'));
  assert.throws(() => g.gs.adminHrRrn(MGR, '김민우'), /관리자/, '점장은 못 봐요');
  // 번호를 안 보여줄 때(줄이 섞임)는 알리지 않아요
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { rrn: '850505-1******' });
  assert.throws(() => g.gs.adminHrRrn(ADMIN, '김민우'), /줄이 섞인 것 같아요/);
  assert.equal(toOwner(g).filter((m) => /주민번호 전체 보기/.test(m.text)).length, 1);
});
