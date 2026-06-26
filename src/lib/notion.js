// 페이지는 Notion을 직접 호출하지 않고, 빌드 전에 scripts/sync-notion.mjs 가
// 만들어 둔 캐시(src/data/posts.json, about.json)만 읽는다.
// 캐시가 없으면 빈 값 → 빌드가 깨지지 않는다.

let cache = [];
try {
  const mod = await import('../data/posts.json', { with: { type: 'json' } });
  cache = mod.default || [];
} catch {
  cache = [];
}

let about = { markdown: '' };
try {
  const mod = await import('../data/about.json', { with: { type: 'json' } });
  about = mod.default || { markdown: '' };
} catch {
  about = { markdown: '' };
}

/** 발행된 글 목록(최신순) — 본문 제외한 메타 */
export async function getPublishedPosts() {
  return cache.map(({ id, title, date, slug, thumb }) => ({ id, title, date, slug, thumb }));
}

/** slug에 해당하는 글의 메타 + 마크다운 본문 */
export async function getPostBySlug(slug) {
  return cache.find((p) => p.slug === slug) || null;
}

/** About 페이지 마크다운 (Notion 'About' 페이지) */
export async function getAbout() {
  return about;
}
