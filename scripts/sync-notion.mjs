// 빌드 전에 실행: Notion DB에서 발행된 글을 가져와
//  1) 본문을 마크다운으로 변환 (사진은 사이트로 내려받아 영구 보관, 유튜브/임베드는 iframe)
//  2) src/data/posts.json 으로 캐시
// 페이지(Astro)는 이 캐시만 읽으므로 렌더 시 Notion 호출이 없고, 사진 만료 문제도 없다.
//
// NOTION_TOKEN / NOTION_DATABASE_ID 가 없으면 빈 캐시를 쓰고 정상 종료한다.

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_FILE = path.join(ROOT, 'src/data/posts.json');
const ABOUT_FILE = path.join(ROOT, 'src/data/about.json');
const IMG_DIR = path.join(ROOT, 'public/notion');
const IMG_PUBLIC_BASE = '/notion';

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

async function writeCache(posts) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(posts, null, 2));
  console.log(`[sync-notion] wrote ${posts.length} post(s) → src/data/posts.json`);
}
async function writeAbout(about) {
  await fs.mkdir(path.dirname(ABOUT_FILE), { recursive: true });
  await fs.writeFile(ABOUT_FILE, JSON.stringify(about, null, 2));
  console.log(`[sync-notion] wrote about.json (${about?.markdown ? 'with content' : 'empty'})`);
}

if (!token || !databaseId) {
  console.log('[sync-notion] NOTION_TOKEN/NOTION_DATABASE_ID 없음 → 빈 캐시로 진행');
  await writeCache([]);
  await writeAbout({ markdown: '' });
  process.exit(0);
}

const notion = new Client({ auth: token, notionVersion: '2022-06-28' });
const n2m = new NotionToMarkdown({ notionClient: notion });

// ── 유틸 ──────────────────────────────────────────────
function findPropByType(props, type) {
  return Object.values(props || {}).find((p) => p?.type === type) || null;
}
function titleText(props) {
  const t = findPropByType(props, 'title');
  return (t?.title || []).map((x) => x.plain_text).join('').trim() || 'Untitled';
}
function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
function youtubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}
function iframeFor(url) {
  const yt = youtubeId(url);
  if (yt) {
    return `\n<div class="embed"><iframe src="https://www.youtube.com/embed/${yt}" title="YouTube" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>\n`;
  }
  return null;
}

// 이미지 다운로드 → public/notion/<blockId>.<ext> → 로컬 경로 반환
async function downloadImage(url, blockId) {
  try {
    const clean = url.split('?')[0];
    let ext = path.extname(clean).toLowerCase().replace('.', '') || 'png';
    if (ext.length > 5) ext = 'png';
    const filename = `${blockId.replace(/-/g, '')}.${ext}`;
    await fs.mkdir(IMG_DIR, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(path.join(IMG_DIR, filename), buf);
    return `${IMG_PUBLIC_BASE}/${filename}`;
  } catch (e) {
    console.warn(`[sync-notion] 이미지 다운로드 실패 (${blockId}): ${e.message}`);
    return url; // 실패 시 원본 URL 유지
  }
}

// ── 커스텀 변환기 (사진 / 동영상 / 임베드) ───────────────
n2m.setCustomTransformer('image', async (block) => {
  const img = block.image;
  const src = img?.external?.url || img?.file?.url;
  if (!src) return false;
  const caption = (img.caption || []).map((c) => c.plain_text).join('');
  const local = await downloadImage(src, block.id);
  return `![${caption}](${local})`;
});
n2m.setCustomTransformer('video', async (block) => {
  const src = block.video?.external?.url || block.video?.file?.url;
  const frame = src && iframeFor(src);
  return frame || false;
});
n2m.setCustomTransformer('embed', async (block) => {
  const frame = block.embed?.url && iframeFor(block.embed.url);
  return frame || false;
});
n2m.setCustomTransformer('bookmark', async (block) => {
  const url = block.bookmark?.url;
  const frame = url && iframeFor(url);
  if (frame) return frame;
  return url ? `[${url}](${url})` : false;
});

// ── 메인 ──────────────────────────────────────────────
async function getAllPages() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: databaseId, start_cursor: cursor });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

const pages = await getAllPages();
const metas = pages
  .map((page) => {
    const props = page.properties || {};
    const title = titleText(props);
    const date = findPropByType(props, 'date')?.date?.start || null;
    const published = Boolean(findPropByType(props, 'checkbox')?.checkbox);
    const base = slugify(title);
    const slug = base || page.id.replace(/-/g, '').slice(0, 12);
    const coverUrl = page.cover?.external?.url || page.cover?.file?.url || null;
    return { id: page.id, title, date, published, slug, coverUrl };
  })
  .filter((p) => p.published)
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

// 슬러그 중복 방지
const seen = new Map();
for (const m of metas) {
  const n = seen.get(m.slug) || 0;
  seen.set(m.slug, n + 1);
  if (n > 0) m.slug = `${m.slug}-${n + 1}`;
}

const posts = [];
for (const m of metas) {
  const mdBlocks = await n2m.pageToMarkdown(m.id);
  const { parent: markdown } = n2m.toMarkdownString(mdBlocks);
  // 썸네일: 페이지 커버 > 본문 첫 이미지 > 없음
  let thumb = null;
  if (m.coverUrl) {
    thumb = await downloadImage(m.coverUrl, `${m.id}-cover`);
  } else {
    const firstImg = (markdown || '').match(/!\[[^\]]*\]\((\/notion\/[^)]+)\)/);
    thumb = firstImg ? firstImg[1] : null;
  }
  const { coverUrl, ...meta } = m;
  posts.push({ ...meta, thumb, markdown: markdown || '' });
  console.log(`[sync-notion] · ${m.title} (${m.slug})${thumb ? ' [썸네일]' : ''}`);
}

await writeCache(posts);

// ── About 페이지 ──────────────────────────────────────
// NOTION_ABOUT_PAGE_ID 가 있으면 그걸 쓰고, 없으면 integration에 공유된
// 페이지 중 제목이 'About'(또는 '소개')인 단독 페이지를 자동으로 찾는다.
async function findAboutPageId() {
  if (process.env.NOTION_ABOUT_PAGE_ID) return process.env.NOTION_ABOUT_PAGE_ID;
  const res = await notion.search({ filter: { property: 'object', value: 'page' } });
  for (const p of res.results) {
    if (p.object !== 'page') continue;
    if (p.parent?.type === 'database_id') continue; // DB 행 제외
    const title = titleText(p.properties || {}).toLowerCase();
    if (title === 'about' || title === '소개') return p.id;
  }
  return null;
}

try {
  const aboutId = await findAboutPageId();
  if (aboutId) {
    const blocks = await n2m.pageToMarkdown(aboutId);
    const { parent: markdown } = n2m.toMarkdownString(blocks);
    await writeAbout({ markdown: markdown || '' });
    console.log(`[sync-notion] · About 페이지 가져옴 (${aboutId})`);
  } else {
    console.log("[sync-notion] About 페이지 못 찾음 (제목 'About'으로 만들고 공유하세요)");
    await writeAbout({ markdown: '' });
  }
} catch (e) {
  console.warn('[sync-notion] About 가져오기 실패:', e.message);
  await writeAbout({ markdown: '' });
}
