// 페이지는 Notion을 직접 호출하지 않고, 빌드 전에 scripts/sync-notion.mjs 가
// 만들어 둔 캐시(src/data/pages.json)만 읽는다.
// 캐시가 없으면 빈 값 → 빌드가 깨지지 않는다.

let pages = {};
try {
  const mod = await import('../data/pages.json', { with: { type: 'json' } });
  pages = mod.default || {};
} catch {
  pages = {};
}

/** 단일 페이지 마크다운 반환 (key: 'about' | 'shelf') */
export async function getPage(key) {
  return pages[key] || '';
}
