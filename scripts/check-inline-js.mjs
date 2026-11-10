// 홈페이지 페이지들의 inline <script>를 파싱해 본다.
// 이 스크립트들은 빌드가 손대지 않고 그대로 나가므로, 깨져도 빌드는 성공한다.
// (한 번 '\uub144' 같은 잘못된 이스케이프로 공개된 책 페이지가 통째로 죽은 적이 있다)
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src/pages', 'src/components', 'src/layouts'];
const files = [];
const walk = (d) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, {withFileTypes: true})) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.astro')) files.push(f);
  }
};
roots.forEach(walk);

let bad = 0, checked = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(src))) {
    i++;
    const body = m[2];
    if (!body.trim()) continue;                       // src=... 만 있는 것
    if (/\btype\s*=\s*["'](?!module|text\/javascript)/.test(m[1])) continue;  // json 등
    checked++;
    try { new Function(body); }
    catch (e) {
      bad++;
      const line = src.slice(0, m.index).split('\n').length;
      console.error(`✗ ${f} (script #${i}, line ~${line}): ${e.message}`);
    }
  }
}
console.log(`${checked} inline script(s) in ${files.length} file(s), ${bad} broken`);
process.exit(bad ? 1 : 0);
