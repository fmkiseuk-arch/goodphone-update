// 한 파일 버전 만들기: Code.gs + Index.html + Admin.html → dist/Code.gs
// Apps Script에 이 파일 하나만 붙여넣으면 돼요.
// 실행: node attendance/build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 코드 버전: 세 파일 내용으로 만든 짧은 번호(내용이 같으면 늘 같은 번호). Code.gs 의 var CODE_VER = 'dev'; 자리에 넣어요.
// 사장님 화면이 '시트에 붙여넣은 코드'와 '웹 앱(배포한 버전)'이 다른지 알아보는 데 써요.
const VER_RE = /^var CODE_VER = '[^'\n]*';/m;
function codeVersion(code, index, admin) {
  const h = crypto.createHash('sha256');
  [code.replace(VER_RE, ''), index, admin].forEach((s) => h.update(s + '\0'));
  return h.digest('hex').slice(0, 8);
}

function bundle() {
  const dir = __dirname;
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const head = [
    '/**',
    ' * 굳폰 출퇴근 — 한 파일 버전 (자동으로 만든 파일이에요. 고칠 땐 attendance/ 의 원본을 고치고 node attendance/build.js)',
    ' *',
    ' * 쓰는 법: 구글 시트 → 확장 프로그램 → Apps Script → 원래 있던 내용을 지우고 이 파일 전체를 붙여넣기',
    ' *        → 저장 → 위쪽에서 setup 고르고 ▶ 실행(권한 허용) → 배포 → 새 배포 → 웹 앱',
    ' *          (실행: 나 / 액세스: 모든 사용자) → 배포 → 나온 주소가 직원 화면, 주소 뒤에 ?page=admin 이 사장님 화면',
    ' */',
    '',
  ].join('\n');
  const code = read('Code.gs'), index = read('Index.html'), admin = read('Admin.html');
  if (!VER_RE.test(code)) throw new Error("Code.gs 에 var CODE_VER = 'dev'; 줄이 없어요(코드 버전을 넣을 곳)");
  const stamped = code.replace(VER_RE, "var CODE_VER = '" + codeVersion(code, index, admin) + "';");
  const pages = 'var PAGES = {\n  Index: ' + JSON.stringify(index) + ',\n  Admin: ' + JSON.stringify(admin) + ',\n};\n';
  return head + stamped + '\n/* ───────────── 화면 HTML (Index.html, Admin.html 를 그대로 담음) ───────────── */\n' + pages;
}

module.exports = { bundle, codeVersion };

if (require.main === module) {
  const out = path.join(__dirname, 'dist', 'Code.gs');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bundle());
  const ver = (/^var CODE_VER = '([^']*)';/m.exec(fs.readFileSync(out, 'utf8')) || [])[1];
  console.log('만들었어요:', out, fs.statSync(out).size + ' bytes · 코드 버전 ' + ver);
}
