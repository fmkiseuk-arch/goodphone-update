// 화면 확인용: 진짜 브라우저(아이폰 크기)에서 직원 화면·사장님 화면을 눌러보고 캡처해요.
// 서버 쪽은 gas-mock 으로 Code.gs 를 그대로 돌려요.
// 실행: node attendance/test/ui-check.js [캡처 저장 폴더]
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const { createGas } = require('./gas-mock');

const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const STORE = { latitude: 37.5665, longitude: 126.978 };
const PHONE = { 김민수: 'a1a1a1a1a1a1a1a1', 이지은: 'b2b2b2b2b2b2b2b2', 박준호: 'c3c3c3c3c3c3c3c3', 최유나: 'd4d4d4d4d4d4d4d4' };

function seed() {
  const g = createGas({ now: Date.parse('2026-11-18T09:00:00+09:00') }); // 수요일
  g.gs.setup();
  g.sheet('직원').getRange(2, 1, 4, 11).setValues([
    ['김민수', '0123', 12000, '10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00', '휴무', '휴무', ''],
    ['이지은', '', 10320, '12:00-21:00', '12:00-21:00', '12:00-21:00', '', '12:00-21:00', '12:00-21:00', '', ''],
    ['박준호', '4321', 10320, '10:00-19:00', '10:00-19:00', '10:00-19:00', '10:00-19:00', '10:00-19:00', '', '', ''],
    ['최유나', '5555', 10320, '', '', '', '', '', '11:00-20:00', '11:00-20:00', ''],
  ]);
  g.gs.setSetting_('관리자PIN', '777777');
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  g.gs.adminSetPlace('777777', STORE.latitude, STORE.longitude);
  const near = { lat: 37.5666, lng: 126.978, acc: 15 };
  const p = (when, name, pin, type) => {
    g.setKst(when);
    g.gs.punch({ name, pin, type, ...near, device: PHONE[name], label: 'iPhone 사파리(홈화면)' });
  };
  // 이번 달 기록 조금
  p('2026-11-16 09:57', '김민수', '0123', 'in'); p('2026-11-16 20:02', '김민수', '0123', 'out');
  p('2026-11-17 10:12', '김민수', '0123', 'in'); p('2026-11-17 20:00', '김민수', '0123', 'out');
  p('2026-11-16 12:00', '이지은', '', 'in'); p('2026-11-16 21:00', '이지은', '', 'out');
  p('2026-11-17 11:58', '이지은', '', 'in'); p('2026-11-17 20:30', '이지은', '', 'out');
  p('2026-11-16 09:59', '박준호', '4321', 'in'); p('2026-11-16 19:00', '박준호', '4321', 'out');
  p('2026-11-17 10:05', '박준호', '4321', 'in');
  p('2026-11-18 10:04', '박준호', '4321', 'in');
  p('2026-11-14 11:00', '최유나', '5555', 'in'); p('2026-11-14 20:00', '최유나', '5555', 'out');
  g.setKst('2026-11-18 10:07');
  return g;
}

const BRIDGE = () => {
  function make(ok, no) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return (f) => make(f, no);
        if (prop === 'withFailureHandler') return (f) => make(ok, f);
        return (...args) => {
          window.__gas(prop, args).then((r) => setTimeout(() => {
            if (r.err) { if (no) no(new Error(r.err)); } else if (ok) ok(r.ok);
          }, 120));
        };
      },
    });
  }
  window.google = { script: { run: make(null, null) } };
};

async function open(browser, file, g, opts = {}) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    geolocation: opts.geo || { ...STORE, accuracy: 12 },
    permissions: ['geolocation'],
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: opts.dark ? 'dark' : 'light',
    ...(opts.ua ? { userAgent: opts.ua } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.exposeFunction('__gas', (fn, args) => {
    try { return { ok: JSON.parse(JSON.stringify(g.gs[fn](...args))) }; } catch (e) { return { err: e.message }; }
  });
  await page.addInitScript(BRIDGE);
  if (opts.device) await page.addInitScript((id) => localStorage.setItem('att:device', id), opts.device);
  await page.goto('file://' + path.join(__dirname, '..', file));
  return { page, ctx, errors };
}

(async () => {
  const browser = await chromium.launch();
  const g = seed();

  // ── 직원 화면 ──
  const s = await open(browser, 'Index.html', g, { device: PHONE['김민수'] });
  await s.page.getByRole('button', { name: '김민수' }).waitFor();
  await s.page.screenshot({ path: path.join(OUT, '1-이름선택.png') });
  await s.page.getByRole('button', { name: '김민수' }).click();
  await s.page.getByText('오늘 근무').waitFor();
  await s.page.fill('#pin', '0123');
  await s.page.click('#btnIn');
  await s.page.getByText('출근 완료').waitFor();
  const res = await s.page.textContent('#result');
  assert.match(res, /출근 완료 · 10:07/);
  assert.match(res, /7분 지각/);
  assert.equal(await s.page.isDisabled('#btnIn'), true, '출근 버튼은 한 번 찍으면 꺼져요');
  await s.page.click('#mineBtn');
  await s.page.locator('#mine table').waitFor();
  await s.page.screenshot({ path: path.join(OUT, '2-직원-출근완료.png'), fullPage: true });

  // 이름 기억: 새로고침해도 바로 내 화면
  await s.page.reload();
  await s.page.getByText('출근 10:07').waitFor();
  assert.equal(await s.page.inputValue('#pin'), '0123');

  // 멀리서 찍으면 거절
  const far = await open(browser, 'Index.html', g, { device: PHONE['이지은'], geo: { latitude: 37.6, longitude: 126.978, accuracy: 10 } });
  await far.page.getByRole('button', { name: '이지은' }).click();
  await far.page.getByText('오늘 근무').waitFor();
  await far.page.click('#btnIn');
  await far.page.locator('#result.bad').waitFor();
  assert.match(await far.page.textContent('#result'), /떨어져 있어요/);
  await far.page.screenshot({ path: path.join(OUT, '3-직원-멀리서.png') });

  // 최유나가 새 폰(등록 안 된 폰)으로 찍으려 함 → 거절 + 승인 요청
  const np = await open(browser, 'Index.html', g);
  await np.page.getByRole('button', { name: '최유나' }).click();
  await np.page.getByText('근무표에 없는 날').waitFor();
  await np.page.fill('#pin', '5555');
  await np.page.click('#btnIn');
  await np.page.locator('#result.bad').waitFor();
  assert.match(await np.page.textContent('#result'), /등록된 폰이 아니에요/);
  await np.page.screenshot({ path: path.join(OUT, '8-직원-새폰.png') });

  // 카톡 안에서 열면 안내가 떠요
  const kakao = await open(browser, 'Index.html', g, { ua: devices['iPhone 13'].userAgent + ' KAKAOTALK 10.4.5' });
  await kakao.page.locator('#inapp').waitFor();
  assert.equal(await s.page.isVisible('#inapp'), false);

  // ── 사장님 화면 ──
  const a = await open(browser, 'Admin.html', g);
  await a.page.fill('#apin', '1111');
  await a.page.click('#loginForm button');
  await a.page.getByText('관리자 비밀번호가 틀렸어요').waitFor();
  g.cache.clear();
  await a.page.fill('#apin', '777777');
  await a.page.click('#loginForm button');
  await a.page.locator('#people .person').first().waitFor();
  const people = await a.page.textContent('#people');
  assert.match(people, /김민수.*지각/);
  assert.match(people, /최유나.*휴무/);
  assert.equal(await a.page.isVisible('#pendingCard'), true, '새 폰 승인 요청이 보여요');
  assert.match(await a.page.textContent('#suspects'), /최유나 · 새 폰 승인 요청/);
  assert.match(await a.page.textContent('#suspects'), /이지은 · 매장 밖/);
  await a.page.screenshot({ path: path.join(OUT, '4-사장님-오늘.png'), fullPage: true });
  await a.page.click('[data-approve="최유나"]');
  await a.page.getByText('승인했어요').waitFor();
  assert.equal(await a.page.isVisible('#pendingCard'), false);
  // 승인 뒤에는 새 폰으로 찍혀요
  await np.page.click('#btnIn');
  await np.page.getByText('출근 완료').waitFor();

  await a.page.click('[data-tab=month]');
  await a.page.locator('#sumTable [data-who]').first().waitFor();
  await a.page.click('#sumTable [data-who="김민수"]');
  await a.page.getByText('김민수 날짜별 기록').waitFor();
  const sum = await a.page.textContent('#sumTable');
  assert.match(sum, /김민수.*2회19분.*3,800원/);
  assert.match(sum, /이지은조퇴 30분/);
  const cut = await a.page.evaluate(() => Array.from(document.querySelectorAll('.scroll')).map((el) => el.scrollWidth - el.clientWidth));
  assert.ok(cut.every((x) => x <= 0), '휴대폰에서 표가 잘려요: ' + cut);
  await a.page.screenshot({ path: path.join(OUT, '5-사장님-월별.png'), fullPage: true });
  await a.page.click('#export');
  await a.page.getByText("'정산 2026-11' 시트를 만들었어요").waitFor();

  await a.page.click('[data-tab=set]');
  await a.page.click('#setPlace');
  await a.page.getByText('등록했어요').waitFor();
  assert.equal(await a.page.inputValue('#appUrl'), 'https://script.google.com/macros/s/TEST/exec');
  await a.page.screenshot({ path: path.join(OUT, '6-사장님-설정.png'), fullPage: true });

  // 다크 모드 한 장
  const d = await open(browser, 'Index.html', g, { dark: true, device: PHONE['박준호'] });
  await d.page.getByRole('button', { name: '박준호' }).click();
  await d.page.getByText('출근 10:04').waitFor();
  await d.page.screenshot({ path: path.join(OUT, '7-직원-다크모드.png') });

  // 가로 스크롤이 생기면 안 돼요
  for (const x of [s, a, d]) {
    const overflow = await x.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, '가로 스크롤 ' + overflow + 'px');
  }
  const errs = [s, far, np, kakao, a, d].flatMap((x) => x.errors);
  assert.deepEqual(errs, [], '브라우저 오류: ' + errs.join('\n'));

  await browser.close();
  console.log('화면 확인 통과. 캡처:', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
