// 화면 확인용: 진짜 브라우저(아이폰 크기)에서 직원 화면·사장님 화면을 눌러보고 캡처해요.
// 서버 쪽은 gas-mock 으로 Code.gs 를 그대로 돌려요.
// 실행: node attendance/test/ui-check.js [캡처 저장 폴더]
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const { createGas } = require('./gas-mock');
const { oldBlock } = require('./old-sample');

const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const STORE = { latitude: 37.5665, longitude: 126.978 };
const PHONE = { 김민수: 'a1a1a1a1a1a1a1a1', 이지은: 'b2b2b2b2b2b2b2b2', 박준호: 'c3c3c3c3c3c3c3c3', 최유나: 'd4d4d4d4d4d4d4d4', 신입: 'e5e5e5e5e5e5e5e5' };

function seed() {
  const g = createGas({ now: Date.parse('2026-11-18T09:00:00+09:00') }); // 수요일
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 3, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
    ['사무실', '', '', '', '', '', ''],
  ]);
  //   이름 매장 PIN 시급 월 화 수 목 금 토 일 재직 등록폰 새폰요청
  const W = (t) => [t, t, t, t, t];
  g.sheet('직원').getRange(2, 1, 5, 14).setValues([
    ['김민수', '왕십리', '0123', 12000, ...W(''), '휴무', '휴무', '', '', ''],
    ['박준호', '왕십리', '4321', 10320, ...W('10:00-19:00'), '', '', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '', '휴무', '', '', '휴무', '', '', ''], // 목·일 휴무
    ['신입', '가산', '', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '사무실', '5555', 10320, ...W('휴무'), '11:00-20:00', '11:00-20:00', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박준호'); // 왕십리 점장
  g.gs.setSetting_('관리자PIN', '777777');
  g.gs.setSetting_('앱시작일', '2026-11-01');
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  g.gs.adminSetPlace('777777', '왕십리', STORE.latitude, STORE.longitude);
  g.gs.adminSetPlace('777777', '사무실', STORE.latitude, STORE.longitude + 0.0005);
  g.gs.adminSetPlace('777777', '가산', 37.58, 126.978);
  const near = { lat: 37.5666, lng: 126.978, acc: 15 };
  const p = (when, name, pin, type) => {
    g.setKst(when);
    g.gs.punch({ name, pin, type, ...near, device: PHONE[name], label: 'iPhone 사파리(홈화면)', agree: true });
  };
  // 이번 달 기록 조금
  p('2026-11-16 09:57', '김민수', '0123', 'in'); p('2026-11-16 20:02', '김민수', '0123', 'out');
  p('2026-11-17 10:12', '김민수', '0123', 'in'); p('2026-11-17 20:00', '김민수', '0123', 'out');
  p('2026-11-16 12:00', '이지은', '5678', 'in'); p('2026-11-16 21:00', '이지은', '5678', 'out');
  p('2026-11-17 11:58', '이지은', '5678', 'in'); p('2026-11-17 20:30', '이지은', '5678', 'out');
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
          // 새로고침 직후엔 __gas 연결이 늦게 붙을 수 있어서 기다려요 (진짜 구글에선 google.script.run 이 항상 있어요)
          const ready = new Promise((res) => { const t = () => (typeof window.__gas === 'function' ? res() : setTimeout(t, 10)); t(); });
          ready.then(() => window.__gas(prop, args)).then((r) => setTimeout(() => {
            if (r.err) { if (no) no(new Error(r.err)); } else if (ok) ok(r.ok);
          }, 120));
        };
      },
    });
  }
  window.google = { script: { run: make(null, null) } };
};

// 화면 파일은 작은 로컬 웹서버로 열어요. file:// 로 열면 크롬이 새로고침 때 저장값(localStorage)을
// 가끔(약 8%) 통째로 잃어서 '이름 기억' 같은 확인이 들쭉날쭉해져요. 진짜 폰은 https 주소라 그런 일이 없어요.
let BASE = '';
function serve() {
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    if (!/^(Index|Admin)\.html$/.test(name)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '..', name)));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => { BASE = 'http://127.0.0.1:' + srv.address().port + '/'; ok(srv); }));
}

const OPENED = [];
/** 서버 시계를 옮기고, 열려 있는 폰 화면들의 시계도 같이 맞춰요. */
async function setClock(g, when) {
  g.setKst(when);
  for (const ctx of OPENED) await ctx.clock.setFixedTime(new Date(g.gs.Date.now()));
}

async function open(browser, file, g, opts = {}) {
  const ctx = await browser.newContext({
    ...(opts.device_ || devices['iPhone 13']),
    geolocation: opts.geo || { ...STORE, accuracy: 12 },
    permissions: ['geolocation'],
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: opts.dark ? 'dark' : 'light',
    ...(opts.ua ? { userAgent: opts.ua } : {}),
  });
  // 폰 시계를 가짜 서버 시계와 같게 고정해요. 진짜 오늘 날짜를 쓰면 날짜 칸의 '오늘부터' 제한 때문에
  // 며칠 지나서 돌릴 때 확인이 틀어져요(타이머는 그대로 가요)
  await ctx.clock.setFixedTime(new Date(g.gs.Date.now()));
  const page = await ctx.newPage();
  const errors = [];
  OPENED.push(ctx);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(opts.prompt || '') : d.accept()));
  await page.exposeFunction('__gas', (fn, args) => {
    try { return { ok: JSON.parse(JSON.stringify(g.gs[fn](...args))) }; } catch (e) { return { err: e.message }; }
  });
  await page.addInitScript(BRIDGE);
  if (opts.device) await page.addInitScript((id) => localStorage.setItem('att:device', id), opts.device);
  await page.goto(BASE + file);
  return { page, ctx, errors };
}

// 기다리다 실패하면 그때 화면 상태(보이는 글자, 저장값, 브라우저 오류)를 같이 보여줘요
async function seen(x, sel) {
  try {
    await x.page.locator(sel).first().waitFor();
  } catch (e) {
    const state = await x.page.evaluate(() => Array.from(document.querySelectorAll('section, .notice, #note'))
      .filter((el) => !el.hidden).map((el) => (el.id || el.className) + ': ' + el.textContent.replace(/\s+/g, ' ').slice(0, 160))
      .concat(['저장된 값: ' + JSON.stringify(Object.assign({}, localStorage))]));
    console.error('기다린 것: ' + sel + '\n화면:\n  ' + state.join('\n  ') + '\n브라우저 오류: ' + (x.errors.join(' | ') || '없음'));
    throw e;
  }
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const g = seed();

  // ── 직원 화면 ──
  const s = await open(browser, 'Index.html', g, { device: PHONE['김민수'] });
  await s.page.getByRole('button', { name: '김민수' }).waitFor();
  assert.deepEqual(await s.page.locator('#names .group').allTextContents(), ['왕십리', '가산', '사무실'], '이름을 매장별로 묶어요');
  await s.page.screenshot({ path: path.join(OUT, '1-이름선택.png'), fullPage: true });
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
  await seen(s, 'text=출근 10:07');
  assert.equal(await s.page.inputValue('#pin'), '0123');

  // 멀리서 찍으면 거절
  const far = await open(browser, 'Index.html', g, { device: PHONE['이지은'], geo: { latitude: 37.6, longitude: 126.978, accuracy: 10 } });
  await far.page.getByRole('button', { name: '이지은' }).click();
  await far.page.getByText('오늘 근무').waitFor();
  await far.page.fill('#pin', '5678');
  await far.page.click('#btnIn');
  await far.page.locator('#result.bad').waitFor();
  assert.match(await far.page.textContent('#result'), /떨어져 있어요/);
  await far.page.screenshot({ path: path.join(OUT, '3-직원-멀리서.png') });

  // 이지은: 11/20(금) 대타 구하기
  await far.page.locator('#pin').dispatchEvent('change');
  await far.page.getByText('아직 보낸 요청이 없어요').waitFor();
  await far.page.click('[data-kind=swap]');
  await far.page.fill('#fDate', '2026-11-20');
  await far.page.fill('#fReason', '집안 행사');
  await far.page.click('#fSend');
  await seen(far, 'text=대타 구함을 올렸어요');
  assert.match(await far.page.textContent('#myReqs'), /대타 11\/20\(금\) 12:00-21:00 대타.*대타 구하는 중/);

  // 김민수: 어제(11/17) 퇴근 정정 요청
  await s.page.click('[data-kind=fix]');
  await s.page.selectOption('#fDateFix', '2026-11-17');
  await s.page.fill('#fTime', '20:05');
  await s.page.fill('#fReason', '마감하다 늦게 찍음');
  assert.equal(await s.page.textContent('#toMgr'), '박준호 점장에게', '우리 매장 점장에게 먼저 보내요');
  await s.page.click('#fSend');
  await s.page.getByText('요청을 보냈어요. 점장이 확인하고 관리자에게 올리면 승인해요.').waitFor();
  assert.match(await s.page.textContent('#myReqs'), /점장 확인 중/);
  assert.match(await s.page.textContent('#swaps'), /11\/20\(금\) 12:00-21:00이지은 님 대신/, '동료의 대타 구함이 보여요');
  await s.page.screenshot({ path: path.join(OUT, '9-직원-요청.png'), fullPage: true });

  // 근무표: 이번 달 달력, 내 지각·정기 휴무, 날짜를 누르면 누가 쉬는지
  const kimNov = () => g.gs.monthGrid_('2026-11', true).rows['김민수'].row;
  g.sheet('휴무표 2026-11').getRange(kimNov(), 10).setValue('만근 예정'); // 시트가 계산한 만근 값처럼
  await s.page.click('#schedBtn');
  await s.page.locator('#cal [data-d="30"]').waitFor();
  assert.match(await s.page.textContent('#fullLine'), /이 달 만근 예정 → 다음 달 월차 1개/);
  assert.equal(await s.page.locator('#cal [data-d]').count(), 30);
  assert.match(await s.page.textContent('#cal [data-d="17"]'), /지각/);
  assert.match(await s.page.getAttribute('#cal [data-d="18"]', 'class'), /\bnow\b/, '오늘 표시');
  const tops = await s.page.evaluate(() => [15, 16, 17, 18, 19, 20, 21].map((d) => document.querySelector('#cal [data-d="' + d + '"]').getBoundingClientRect().top));
  assert.equal(new Set(tops).size, 1, '한 주의 칸이 같은 높이에 있어요: ' + tops);
  assert.match(await s.page.textContent('#cal [data-d="21"]'), /쉼/);
  await s.page.click('#cal [data-d="21"]');
  assert.match(await s.page.textContent('#dayInfo'), /11\/21\(토\).*나: 쉼/);
  await s.page.locator('#schedCard').screenshot({ path: path.join(OUT, '14-직원-근무표.png') });
  await s.page.click('#schedBtn');

  // 박준호: 어제(11/17) 퇴근을 안 찍어서 안내가 떠요 → 버튼을 누르면 정정 양식이 채워져요
  const pj = await open(browser, 'Index.html', g, { device: PHONE['박준호'] });
  await pj.page.addInitScript(() => localStorage.setItem('att:pin:박준호', '4321'));
  await pj.page.reload();
  await pj.page.getByRole('button', { name: '박준호' }).click();
  await pj.page.locator('#missOut:not([hidden])').waitFor();
  assert.match(await pj.page.textContent('#missOut'), /11\/17\(화\) 퇴근을 안 찍었어요/);
  await pj.page.screenshot({ path: path.join(OUT, '12-직원-퇴근누락.png'), fullPage: true });
  await pj.page.click('#missGo');
  assert.equal(await pj.page.inputValue('#fDateFix'), '2026-11-17');
  assert.equal(await pj.page.isChecked('input[name=ftype][value=out]'), true);
  await pj.page.click('[data-kind=fix]'); // 양식 닫기
  await pj.page.locator('[data-take]').click();
  await pj.page.getByText('대타를 수락했어요').waitFor();
  assert.match(await pj.page.textContent('#myReqs'), /내가 대타 · 승인 대기/);
  assert.equal(await pj.page.isVisible('#wTo'), false, '점장 본인 요청은 관리자에게 바로(고르는 칸 없음)');

  // ── 점장 화면: 박준호(왕십리 점장)가 이름 + 내 비밀번호로 들어가서 관리자에게 올려요 ──
  const m = await open(browser, 'Admin.html', g, { prompt: '퇴근 20:05 맞아요' });
  await m.page.click('#loginMode');
  await m.page.locator('#mgrName option').first().waitFor({ state: 'attached' });
  assert.deepEqual(await m.page.locator('#mgrName option').allTextContents(), ['박준호']);
  await m.page.fill('#apin', '4321');
  await m.page.click('#loginForm button');
  await m.page.locator('#people .person').first().waitFor();
  assert.match(await m.page.textContent('#roleTag'), /왕십리 점장 · 박준호/);
  const mp = await m.page.textContent('#people');
  assert.match(mp, /김민수/);
  assert.doesNotMatch(mp, /이지은/, '점장은 자기 매장만');
  assert.match(await m.page.textContent('#reqs'), /김민수.*퇴근 20:05로 고쳐주세요.*점장 확인 전/);
  await m.page.screenshot({ path: path.join(OUT, '16-점장-오늘.png'), fullPage: true });
  await m.page.click('[data-fwd]');
  await m.page.getByText('관리자에게 올렸어요').waitFor();
  assert.match(await m.page.textContent('#reqs'), /관리자 승인을 기다리는 중/);
  await m.page.click('[data-tab=set]');
  assert.equal(await m.page.isVisible('#tgStatus'), false, '점장은 텔레그램 설정 안 보여요');
  assert.equal(await m.page.isVisible('#devices'), false, '직원 관리도 안 보여요');
  assert.match(await m.page.textContent('#stores'), /왕십리.*점장 박준호/);
  assert.doesNotMatch(await m.page.textContent('#stores'), /가산/);
  await m.page.click('[data-tab=month]');
  await m.page.locator('#sumTable [data-who]').first().waitFor();
  assert.doesNotMatch(await m.page.textContent('#sumTable'), /차감액|원/, '점장 화면엔 차감액이 없어요');
  assert.equal(await m.page.isVisible('#export'), false);
  // 로그아웃하면 다시 로그인 화면
  await m.page.click('[data-tab=set]');
  await m.page.click('#logout');
  await seen(m, '#login:not([hidden])');
  assert.equal(await m.page.evaluate(() => localStorage.getItem('att:admin') || sessionStorage.getItem('att:admin')), null);

  // 신입: 비밀번호가 아직 없어서 처음 출근할 때 정해요
  const nw = await open(browser, 'Index.html', g, { device: PHONE['신입'], geo: { latitude: 37.58, longitude: 126.978, accuracy: 10 } });
  await nw.page.getByRole('button', { name: '신입' }).click();
  await nw.page.locator('#pinHint:not([hidden])').waitFor();
  assert.equal(await nw.page.textContent('#pinLabel'), '새 비밀번호 (숫자 4자리)');
  assert.equal(await nw.page.isVisible('#agreeBox'), true, '처음엔 동의 칸이 보여요');
  await nw.page.screenshot({ path: path.join(OUT, '11-직원-첫비밀번호.png'), fullPage: true });
  await nw.page.fill('#pin', '2468');
  await nw.page.click('#btnIn');
  await nw.page.getByText('아래 동의 칸에 체크해주세요').waitFor();
  await nw.page.check('#agree');
  await nw.page.click('#btnIn');
  await nw.page.getByText('출근 완료').waitFor();
  assert.match(await nw.page.textContent('#result'), /비밀번호가 등록됐어요/);
  assert.equal(await nw.page.isVisible('#agreeBox'), false, '동의하고 나면 사라져요');
  assert.match(g.gs.staff_().find((x) => x.name === '신입').pin, /^2468$/);
  assert.equal(await nw.page.isHidden('#pinHint'), true, '정하고 나면 안내가 사라져요');
  assert.equal(g.gs.staff_().find((x) => x.name === '신입').pin, '2468');

  // 최유나가 새 폰(등록 안 된 폰)으로 찍으려 함 → 거절 + 승인 요청 (사무실, 수요일 휴무)
  const np = await open(browser, 'Index.html', g);
  await np.page.getByRole('button', { name: '최유나' }).click();
  await np.page.getByText('오늘은 쉬는 날이에요').waitFor();
  await np.page.fill('#pin', '5555');
  await np.page.click('#btnIn');
  await np.page.locator('#result.bad').waitFor();
  assert.match(await np.page.textContent('#result'), /등록된 폰이 아니에요/);
  await np.page.screenshot({ path: path.join(OUT, '8-직원-새폰.png') });

  // 카톡 안에서 열면 안내가 떠요
  const kakao = await open(browser, 'Index.html', g, { ua: devices['iPhone 13'].userAgent + ' KAKAOTALK 10.4.5' });
  await kakao.page.locator('#inapp').waitFor();
  assert.equal(await s.page.isVisible('#inapp'), false);

  // ── 사장님 화면 ── (비번 정하기 창에는 7351 을 넣어요)
  const a = await open(browser, 'Admin.html', g, { prompt: '7351' });
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
  // 매장 필터
  await a.page.click('#storeChips [data-store="가산"]');
  const onlyGasan = await a.page.textContent('#people');
  assert.match(onlyGasan, /이지은/);
  assert.doesNotMatch(onlyGasan, /김민수/);
  await a.page.click('#storeChips [data-store=""]');
  await a.page.screenshot({ path: path.join(OUT, '4-사장님-오늘.png'), fullPage: true });
  await a.page.click('[data-approve="최유나"]');
  await a.page.getByText('승인했어요').waitFor();
  assert.equal(await a.page.isVisible('#pendingCard'), false);
  // 승인 뒤에는 새 폰으로 찍혀요
  await np.page.click('#btnIn');
  await np.page.getByText('출근 완료').waitFor();
  // 최유나 비밀번호 5555는 쉬운 번호 → 바꾸라는 안내 → 바꾸기
  await np.page.locator('#weakPin:not([hidden])').waitFor();
  await np.page.click('#weakGo');
  await np.page.fill('#newPin', '8642');
  await np.page.fill('#newPin2', '8642');
  await np.page.click('#pinChangeSend');
  await np.page.getByText('바꿨어요').waitFor();
  assert.equal(g.gs.staff_().find((x) => x.name === '최유나').pin, '8642');

  // 직원 요청 2건(김민수 정정, 이지은→박준호 대타) 승인
  await a.page.click('#refresh');
  await a.page.locator('#reqCard:not([hidden])').waitFor();
  const reqText = await a.page.textContent('#reqs');
  assert.match(reqText, /김민수.*11\/17\(화\) 퇴근 20:05로 고쳐주세요.*지금 기록 20:00.*사유: 마감하다 늦게 찍음/);
  assert.match(reqText, /이지은.*11\/20\(금\) 12:00-21:00 → 박준호 님이 대신 근무/);
  assert.match(reqText, /점장 박준호 확인 퇴근 20:05 맞아요/, '점장이 올린 요청과 한마디');
  await a.page.locator('#reqCard').screenshot({ path: path.join(OUT, '10-사장님-요청.png') });
  await a.page.locator('[data-rq-ok]').first().click();
  await a.page.getByText('승인했어요. 기록과 근무표에 반영됐어요.').waitFor();
  await a.page.locator('[data-rq-ok]').first().click();
  await a.page.waitForFunction(() => document.getElementById('reqCard').hidden);
  const fixed = g.sheet('출퇴근기록');
  let found17 = false;
  for (let r = 2; r <= fixed.getLastRow(); r++) {
    const v = fixed.rowDisplay(r);
    if (v[0] === '2026-11-17' && v[2] === '김민수') { found17 = true; assert.equal(v[6], '20:05'); }
  }
  assert.ok(found17);
  assert.equal(g.sheet('근무변경').getLastRow(), 2, '대타 승인 → 대타 시간만 근무변경에 1줄');
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('이지은', '2026-11-20'), '휴무', '휴무표: 요청한 사람 휴무');
  assert.equal(g.gs.dayMark_('박준호', '2026-11-20'), '대타', '휴무표: 대타');
  assert.equal(g.gs.dayMark_('김민수', '2026-11-18'), '10:07', '휴무표: 오늘 지각 시간이 자동으로');

  await a.page.click('[data-tab=month]');
  await a.page.locator('#sumTable [data-who]').first().waitFor();
  await a.page.click('#sumTable [data-who="김민수"]');
  await a.page.getByText('김민수 날짜별 기록').waitFor();
  const sum = await a.page.textContent('#sumTable');
  assert.match(sum, /김민수.*2회19분.*3,800원/);
  assert.match(sum, /이지은가산조퇴 30분/);
  const cut = await a.page.evaluate(() => Array.from(document.querySelectorAll('.scroll')).map((el) => el.scrollWidth - el.clientWidth));
  assert.ok(cut.every((x) => x <= 0), '휴대폰에서 표가 잘려요: ' + cut);
  await a.page.screenshot({ path: path.join(OUT, '5-사장님-월별.png'), fullPage: true });
  await a.page.click('#export');
  await a.page.getByText("'정산 2026-11' 시트를 만들었어요").waitFor();
  // 직원 1년 보기: 김민수 12달(11월까지) + 합계, 1년 요약 시트
  assert.equal(await a.page.inputValue('#yrName'), '김민수', '위 표에서 누른 사람이 골라져요');
  g.sheet('휴무표 2026-11').getRange(kimNov(), 10).setValue('아님: 11/17 결근?');
  await a.page.click('#yrGo');
  await seen(a, '#yrTable tbody tr');
  assert.match(await a.page.textContent('#yrFull'), /만근 아님: 11월 11\/17 결근\?/);
  const yr = await a.page.textContent('#yrTable');
  assert.match(yr, /11월.*\d+일.*2회.*합계/);
  assert.match(yr, /1월기록 없음/);
  await a.page.locator('#yearCard').screenshot({ path: path.join(OUT, '21-사장님-1년보기.png') });
  await a.page.click('#yrExport');
  await a.page.getByText("'연간 2026' 시트를 만들었어요").waitFor();
  assert.ok(g.sheet('연간 2026'));
  const yearOver = await a.page.evaluate(() => { const el = document.querySelector('#yearCard .scroll'); return el.scrollWidth - el.clientWidth; });
  assert.ok(yearOver <= 0, '1년 표가 휴대폰에서 잘려요: ' + yearOver);

  await a.page.click('[data-tab=set]');
  assert.match(await a.page.textContent('#stores'), /왕십리.*위치 등록됨.*가산.*위치 등록됨.*사무실.*직원별 시간/);
  await a.page.click('[data-place="왕십리"]');
  await a.page.getByText('왕십리 위치를 등록했어요').waitFor();
  assert.equal(await a.page.inputValue('#appUrl'), 'https://script.google.com/macros/s/TEST/exec');
  // 텔레그램 연결
  await a.page.fill('#tgToken', '123456789:' + 'A'.repeat(35));
  await a.page.click('#tgSave');
  await a.page.getByText('저장했어요 (@goodphone_test_bot)').waitFor();
  await seen(a, '#tgCodeBox:not([hidden])');
  const ownerCode = (await a.page.textContent('#tgCode')).trim();
  assert.match(ownerCode, /^\/start \d{6}$/);
  assert.match(await a.page.getAttribute('#tgOwnerOpen', 'href'), /^https:\/\/t\.me\/goodphone_test_bot\?start=own\d{6}$/);
  await a.page.click('#tgLink');
  await a.page.getByText('봇에게 온 연결 코드가 없어요').waitFor();
  g.tg.updates.push({ update_id: 1, message: { chat: { id: 4242, type: 'private' }, text: ownerCode } });
  await a.page.click('#tgLink');
  await a.page.getByText('연결됐어요!').waitFor();
  assert.match(await a.page.textContent('#tgStatus'), /연결됨/);
  assert.equal(await a.page.isVisible('#tgSetup'), false);
  // 직원 관리: 사장님이 이지은 비밀번호를 미리 정해줘요
  await a.page.click('[data-setpin="이지은"]');
  await a.page.getByText('이지은 님 비밀번호를 정했어요').waitFor();
  assert.equal(g.gs.staff_().find((x) => x.name === '이지은').pin, '7351');
  assert.match(g.tg.sent.at(-1).text, /알림이 연결됐어요/);
  await a.page.screenshot({ path: path.join(OUT, '6-사장님-설정.png'), fullPage: true });

  // ── 테스트 도구: 알림 시험, 마감 정리 미리 보기, 테스트 직원 ──
  await a.page.click('#notifyTest');
  await a.page.getByText('텔레그램(으)로 시험 알림을 보냈어요').waitFor();
  assert.match(g.tg.sent.at(-1).text, /시험 알림/);
  const sheetBefore = g.sheet('출퇴근기록').getLastRow();
  await a.page.click('[data-close="today"]');
  await seen(a, '#closeOut:not([hidden])');
  assert.match(await a.page.textContent('#closeOut'), /11\/18\(수\) · 출근 \d+명/);
  assert.equal(g.sheet('출퇴근기록').getLastRow(), sheetBefore, '미리 보기는 아무것도 안 바꿔요');
  await a.page.selectOption('#testStore', '왕십리');
  await a.page.click('#testMake');
  await a.page.getByText('테스트 직원을 왕십리에 만들었어요').waitFor();
  await a.page.locator('#testCard').screenshot({ path: path.join(OUT, '19-사장님-테스트.png') });
  // 사장님 폰(아무 폰)으로, 매장에서 먼 곳에서도 테스트 직원으로 찍혀요
  const tt = await open(browser, 'Index.html', g, { geo: { latitude: 35.1, longitude: 129.0, accuracy: 30 }, device: PHONE['김민수'] });
  await tt.page.getByRole('button', { name: '테스트' }).click();
  await seen(tt, '#testNote:not([hidden])');
  await tt.page.fill('#pin', '9753');
  await tt.page.check('#agree');
  await tt.page.click('#btnIn');
  await tt.page.getByText('출근 완료').waitFor();
  assert.match(await tt.page.textContent('#result'), /테스트라 위치는 안 봤어요/);
  assert.equal(g.gs.staff_().find((x) => x.name === '김민수').deviceId, PHONE['김민수'], '김민수 폰 등록은 그대로');
  await a.page.click('#testClear');
  await a.page.getByText(/테스트 기록 \d+줄을 지웠어요/).waitFor();
  assert.ok(!g.gs.staff_().some((x) => x.name === '테스트'), '테스트 직원이 지워져요');
  assert.equal(g.sheet('출퇴근기록').getLastRow(), sheetBefore, '테스트 출근 기록도 지워져요');

  // 작은 폰(아이폰 SE, 폭 320)에서도 가로로 안 넘쳐요
  const se = await open(browser, 'Index.html', g, { device: PHONE['신입'], device_: devices['iPhone SE'] });
  await se.page.getByRole('button', { name: '신입' }).click();
  await se.page.getByText('오늘 근무').waitFor();
  await se.page.fill('#pin', '2468');
  await se.page.click('#schedBtn');
  await se.page.locator('#cal [data-d="30"]').waitFor();
  const seOver = await se.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(seOver <= 0, '작은 폰 가로 스크롤 ' + seOver + 'px');
  const ase = await open(browser, 'Admin.html', g, { device_: devices['iPhone SE'] });
  await ase.page.fill('#apin', '777777');
  await ase.page.click('#loginForm button');
  await ase.page.locator('#people .person').first().waitFor();
  await ase.page.click('[data-tab=set]');
  const aseOver = await ase.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(aseOver <= 0, '작은 폰 사장님 화면 가로 스크롤 ' + aseOver + 'px');
  await ase.page.screenshot({ path: path.join(OUT, '13-사장님-직원관리-SE.png'), fullPage: true });

  // 다크 모드 한 장
  const d = await open(browser, 'Index.html', g, { dark: true, device: PHONE['박준호'] });
  await d.page.getByRole('button', { name: '박준호' }).click();
  await d.page.getByText('출근 10:04').waitFor();
  await d.page.screenshot({ path: path.join(OUT, '7-직원-다크모드.png') });

  // ── 직원 텔레그램 알림 켜기 (사장님이 봇을 연결한 뒤) ──
  await s.page.reload();
  await seen(s, '#tgCard:not([hidden])');
  assert.equal(await s.page.textContent('#tgState'), '꺼짐');
  await s.page.click('#tgStart');
  await s.page.locator('#tgStep:not([hidden])').waitFor();
  const href = await s.page.getAttribute('#tgOpen', 'href');
  assert.match(href, /^https:\/\/t\.me\/goodphone_test_bot\?start=g[0-9a-f]{15}$/);
  await s.page.click('#tgCheck');
  await s.page.getByText('아직 연결 전이에요').waitFor();
  g.tg.updates.push({ update_id: 2, message: { chat: { id: 7001, type: 'private' }, text: '/start ' + href.split('start=')[1] } });
  await s.page.click('#tgCheck');
  await s.page.getByText('연결됐어요!').waitFor();
  assert.equal(await s.page.textContent('#tgState'), '켜짐');
  await s.page.locator('#tgCard').screenshot({ path: path.join(OUT, '18-직원-텔레그램.png') });

  // ── 다음 달 휴무 고르기 (11/20~11/25) ──
  await setClock(g, '2026-11-20 10:00');
  await s.page.reload();
  await seen(s, '#wishBar:not([hidden])');
  assert.match(await s.page.textContent('#wishBar'), /12월 휴무 고르는 기간이에요/);
  await s.page.click('#wishGo');
  await s.page.locator('#cal [data-d="8"]').waitFor();
  assert.match(await s.page.getAttribute('#cal [data-d="25"]', 'class'), /hol/, '성탄절은 빨간 날');
  await s.page.click('#cal [data-d="8"]');
  await s.page.getByText('12/8(화) 휴무?를 넣었어요').waitFor();
  assert.match(await s.page.textContent('#cal [data-d="8"]'), /휴무\?/);
  assert.match(await s.page.textContent('#schedSum'), /고른 휴무 1일/);
  await s.page.locator('#schedCard').screenshot({ path: path.join(OUT, '15-직원-휴무고르기.png') });
  // 같은 매장 박준호가 같은 날을 고르면 막혀요(하루 최대 1명)
  await pj.page.reload();
  await seen(pj, '#wishBar:not([hidden])');
  await pj.page.click('#wishGo');
  await pj.page.locator('#cal [data-d="8"]').waitFor();
  assert.match(await pj.page.textContent('#cal [data-d="8"]'), /1명/, '그날 쉬는 동료 수');
  await pj.page.click('#cal [data-d="8"]');
  await pj.page.getByText('이미 김민수 님이 쉬어요').waitFor();
  // 사장님 화면 [휴무] 탭에서 확정
  await a.page.click('[data-tab=off]');
  await a.page.locator('#offStores .offrow').first().waitFor();
  assert.match(await a.page.textContent('#offStores'), /왕십리.*1건 확정.*김민수.*고름 8/);
  await a.page.screenshot({ path: path.join(OUT, '17-사장님-휴무.png'), fullPage: true });
  assert.equal(await a.page.isVisible('#wishToday'), false, '고르는 기간에는 [오늘만 열기]가 안 보여요');
  await a.page.click('[data-confirm="왕십리"]');
  await a.page.getByText('왕십리 휴무 1건을 확정했어요.').waitFor();
  // 휴무표 만들기: 원하는 달을 바로
  await a.page.fill('#mkYm', '2027-01');
  await a.page.click('#mkMonth');
  await a.page.getByText("'휴무표 2027-01' 탭을 만들었어요").waitFor();
  assert.ok(g.sheet('휴무표 2027-01'));
  await a.page.screenshot({ path: path.join(OUT, '20-사장님-휴무표만들기.png'), fullPage: true });
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('김민수', '2026-12-08'), '휴무');

  // ── 입사 등록: 신입이 새 폰에서 직접 입력 → 사장님 [오늘]에서 승인 → 신입 폰에서 바로 출근 ──
  const jn = await open(browser, 'Index.html', g, { device: 'f6f6f6f6f6f6f6f6' });
  await jn.page.click('#joinBtn');
  await seen(jn, '#joinCard:not([hidden])');
  await jn.page.fill('#jName', '한신입');
  await jn.page.fill('#jRrn1', '950101');
  await jn.page.fill('#jRrn2', '1928374');
  await jn.page.fill('#jPhone', '010-1234-5678');
  // 휴대폰이 두 개인 사람: 번호 추가(2개까지), 지우기
  await jn.page.click('#jPhoneAdd');
  await jn.page.click('#jPhoneAdd');
  assert.equal(await jn.page.isVisible('#jPhoneAdd'), false, '2개까지만');
  await jn.page.locator('#jPhones .xdel').nth(1).click();
  assert.equal(await jn.page.locator('#jPhones .xph').count(), 1);
  await jn.page.fill('#jPhones .xnum', '010-1111-2222');
  await jn.page.fill('#jPhones .xmemo', '업무용');
  await jn.page.fill('#jAddr', '서울 성동구 왕십리로 1');
  await jn.page.fill('#jBank', '국민');
  await jn.page.fill('#jAccount', '123456-78-901234');
  await jn.page.selectOption('#jStore', '왕십리');
  await jn.page.fill('#jPin', '4826');
  await jn.page.fill('#jPin2', '4826');
  await jn.page.click('#jSend');
  await jn.page.getByText('개인정보 수집·이용 동의에 체크해주세요').waitFor();
  await jn.page.check('#jAgree');
  await jn.page.screenshot({ path: path.join(OUT, '24-입사등록.png'), fullPage: true });
  await jn.page.click('#jSend');
  await seen(jn, '#waitCard:not([hidden])');
  assert.equal(await jn.page.inputValue('#jRrn2'), '', '보낸 뒤 주민번호를 화면에서 지워요');
  assert.match(g.gs.hrFind_('한신입', '승인 대기').rrn, /^950101-1\*{6}$/);
  assert.equal(g.gs.hrFind_('한신입', '승인 대기').phone2, '010-1111-2222 업무용');
  await jn.page.reload();
  await seen(jn, '#waitCard:not([hidden])'); // 새로고침해도 기다리는 화면
  await a.page.click('[data-tab=today]');
  await a.page.click('#refresh');
  await seen(a, '#joinCard:not([hidden])');
  assert.match(await a.page.textContent('#joins'), /한신입 95년생/);
  await a.page.click('[data-join-ok="한신입"]');
  await a.page.getByText('한신입 님을 승인했어요').waitFor();
  await jn.page.click('#waitCheck');
  await seen(jn, '#me:not([hidden])');
  assert.equal(await jn.page.inputValue('#pin'), '4826', '정한 비밀번호를 기억해요');
  await jn.page.click('#btnIn');
  await jn.page.getByText('출근 완료').waitFor();

  // ── 이미 일하는 직원: 인사 정보 한 번 입력 ──
  await s.page.reload();
  await seen(s, '#hrBar:not([hidden])');
  await s.page.click('#hrGo');
  await seen(s, '#joinCard:not([hidden])');
  assert.equal(await s.page.isVisible('#wjName'), false, '이름·지점·비밀번호 칸은 숨겨요');
  await s.page.fill('#jRrn1', '900202');
  await s.page.fill('#jRrn2', '1357924');
  await s.page.fill('#jPhone', '01022223333');
  await s.page.fill('#jAddr', '서울 성동구');
  await s.page.fill('#jBank', '신한');
  await s.page.fill('#jAccount', '110-123-456789');
  await s.page.check('#jAgree');
  await s.page.click('#jSend');
  await seen(s, 'text=인사 정보를 저장했어요');
  await seen(s, '#me:not([hidden])');
  await s.page.waitForFunction(() => document.getElementById('hrBar').hidden);

  // ── 사장님 [직원] 탭: 인사 카드 → 주민번호 전체 보기, 비고 저장, 연락처 저장, 지점 이동 ──
  await a.page.click('[data-tab=hr]');
  await seen(a, '#hrList .hrp');
  assert.match(await a.page.textContent('#hrList'), /한신입\s*95년생/);
  await a.page.screenshot({ path: path.join(OUT, '25-사장님-직원목록.png'), fullPage: true });
  await a.page.click('[data-hr="김민수"]');
  await seen(a, '#hrCard:not([hidden])');
  assert.equal(await a.page.inputValue('#hRrn'), '900202-1******');
  await a.page.fill('#hPhone2', '010-5555-6666 개인');
  await a.page.click('#hRrnShow');
  await a.page.waitForFunction(() => document.getElementById('hRrn').value === '900202-1357924');
  await a.page.fill('#hMemo', '보건증 2027-01 만료');
  await a.page.click('#hSave');
  await a.page.getByText('저장했어요.').waitFor();
  assert.equal(g.gs.hrFind_('김민수').memo, '보건증 2027-01 만료');
  assert.equal(g.gs.hrFind_('김민수').phone2, '010-5555-6666 개인');
  await a.page.click('#hContact');
  await seen(a, '#hContactOut a.btn');
  assert.match(await a.page.getAttribute('#hContactOut a', 'href'), /\?vcf=[0-9a-f-]{36}$/, '아이폰은 바로 여는 주소');
  assert.match(await a.page.textContent('#hContactOut'), /김민수 90년생/);
  await a.page.screenshot({ path: path.join(OUT, '26-사장님-인사카드.png'), fullPage: true });
  await a.page.selectOption('#hMoveStore', '가산');
  await a.page.click('#hMove');
  await seen(a, 'text=가산(으)로 옮겼어요');
  assert.equal(g.gs.findStaff_('김민수').store, '가산');
  assert.match(await a.page.textContent('#hrMeta'), /왕십리→가산/);
  await ase.page.click('[data-tab=hr]');
  await seen(ase, '#hrList .hrp');
  const hrOver = await ase.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(hrOver <= 0, '작은 폰 [직원] 탭 가로 스크롤 ' + hrOver + 'px');

  // ── 앱 시작일: 시작 전으로 되돌리면 맨 위에 안내가 뜨고, 오늘부터로 하면 사라져요 ──
  await a.page.click('[data-tab=set]');
  assert.match(await a.page.textContent('#startState'), /2026-11-01부터 시작했어요/);
  await a.page.click('#startClear');
  await a.page.getByText('시작 전으로 되돌렸어요').waitFor();
  assert.equal(await a.page.isVisible('#notStarted'), true);
  assert.match(await a.page.textContent('#notStarted'), /아직 앱 시작 전이에요/);
  assert.equal(g.gs.settings_().startDate, '');
  await a.page.screenshot({ path: path.join(OUT, '27-사장님-앱시작일.png'), fullPage: true });
  // ── 예전 휴무표 가져오기(시작 전): 주소 붙여넣기 → 미리 보기 → 가져오기 → 퇴사자 1년 보기 ──
  const OLD_ID = 'OLDFILE_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  g.addBook(OLD_ID, { 휴무표: [].concat(
    oldBlock(2026, 9, [
      { store: '왕십리', name: '김민수', days: { 2: '휴무', 7: '11:8', 15: '8월차', 24: '추석' } },
      { store: '왕십리', name: '옛직원', days: { 3: '휴무', 20: '가산', 28: '퇴사' } },
      { store: '아라', name: '이지은', days: { 9: '휴무' } },
    ]),
    oldBlock(2026, 10, [
      { store: '왕십리', name: '김민수', days: { 6: '휴무', 14: '9월차' } },
      { store: '가산', name: '이지은', days: { 8: '휴뮤', 21: '무급' } },
    ]),
    oldBlock(2026, 11, [{ store: '왕십리', name: '김민수', days: { 28: '휴무' } }]),
  ) }, '예전 굳폰 파일');
  await a.page.fill('#impSrc', 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit#gid=0');
  await a.page.click('#impPreview');
  await a.page.getByText('미리 보기예요').waitFor();
  const impText = await a.page.textContent('#impView');
  assert.match(impText, /예전 굳폰 파일/);
  assert.match(impText, /새 탭/);
  assert.match(impText, /올해 거쳐 간 사람 3명/);
  assert.match(impText, /아라→검단/);
  assert.ok(!g.sheet('휴무표 2026-10'), '미리 보기는 탭을 안 만들어요');
  await a.page.locator('#importCard').screenshot({ path: path.join(OUT, '28-사장님-예전휴무표-미리보기.png') });
  await a.page.click('#impRun');
  await a.page.getByText('다 가져왔어요').waitFor();
  assert.ok(g.sheet('휴무표 2026-09') && g.sheet('휴무표 2026-10'));
  assert.match(await a.page.textContent('#impView'), /가져오기 끝!/);
  assert.match(await a.page.textContent('#impLast'), /마지막으로 가져온 때/);
  await a.page.locator('#importCard').screenshot({ path: path.join(OUT, '29-사장님-예전휴무표-끝.png') });
  // 퇴사자(예전 휴무표에만 있는 사람)도 1년 보기에서 골라 볼 수 있어요
  await a.page.click('[data-tab=month]');
  await a.page.selectOption('#yrName', '옛직원');
  await a.page.click('#yrGo');
  await a.page.getByText(/옛직원 \(왕십리, 퇴사\) 2026년 · 지원 1번\(가산 1\)/).waitFor();
  await a.page.click('[data-tab=set]');

  await a.page.click('#startToday');
  await a.page.getByText(/시작일을 2026-11-\d\d로 정했어요/).waitFor();
  assert.equal(await a.page.isVisible('#notStarted'), false);

  // 가로 스크롤이 생기면 안 돼요
  for (const x of [s, far, pj, a, d, m, jn]) {
    const overflow = await x.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, '가로 스크롤 ' + overflow + 'px');
  }
  const errs = [s, far, pj, nw, np, kakao, a, se, ase, d, m, tt, jn].flatMap((x) => x.errors);
  assert.deepEqual(errs, [], '브라우저 오류: ' + errs.join('\n'));

  await browser.close();
  srv.close();
  console.log('화면 확인 통과. 캡처:', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
