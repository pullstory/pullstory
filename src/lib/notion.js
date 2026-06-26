// 페이지는 Notion을 직접 호출하지 않고, 빌드 전에 scripts/sync-notion.mjs 가
// 만들어 둔 캐시(src/data/posts.json)만 읽는다. (사진은 이미 사이트로 내려받힌 상태)
// 캐시가 없으면 빈 목록 → 빌드가 깨지지 않는다.

let cache = [];
try {
  const mod = await import('../data/posts.json', { with: { type: 'json' } });
  cache = mod.default || [];
} catch {
  cache = [];
}

/** 발행된 글 목록(최신순) — 본문 제외한 메타 */
export async function getPublishedPosts() {
  return cache.map(({ id, title, date, slug }) => ({ id, title, date, slug }));
}

/** slug에 해당하는 글의 메타 + 마크다운 본문 */
export async function getPostBySlug(slug) {
  return cache.find((p) => p.slug === slug) || null;
}
