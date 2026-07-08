// 빌드 전에 실행: Notion DB에서 발행된 글을 가져와
//  1) 본문을 마크다운으로 변환 (사진은 사이트로 내려받아 영구 보관, 유튜브/임베드는 iframe)
//  2) src/data/posts.json 으로 캐시
// 페이지(Astro)는 이 캐시만 읽으므로 렌더 시 Notion 호출이 없고, 사진 만료 문제도 없다.
//
// NOTION_TOKEN / NOTION_DATABASE_ID 가 없으면 빈 캐시를 쓰고 정상 종료한다.

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_FILE = path.join(ROOT, 'src/data/posts.json');
const PAGES_FILE = path.join(ROOT, 'src/data/pages.json');
const IMG_DIR = path.join(ROOT, 'public/notion');
const IMG_PUBLIC_BASE = '/notion';

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

async function writeCache(posts) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(posts, null, 2));
  console.log(`[sync-notion] wrote ${posts.length} post(s) → src/data/posts.json`);
}
async function writePages(pages) {
  await fs.mkdir(path.dirname(PAGES_FILE), { recursive: true });
  await fs.writeFile(PAGES_FILE, JSON.stringify(pages, null, 2));
  const filled = Object.entries(pages).filter(([, v]) => v).map(([k]) => k);
  console.log(`[sync-notion] wrote pages.json (${filled.join(', ') || 'empty'})`);
}

if (!token || !databaseId) {
  console.log('[sync-notion] NOTION_TOKEN/NOTION_DATABASE_ID 없음 → 빈 캐시로 진행');
  await writeCache([]);
  await writePages({ about: '', shelf: '' });
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

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 본문 이미지: 가로 최대 1600px webp로 최적화 저장 → 로컬 경로 반환
async function downloadImage(url, blockId) {
  const id = blockId.replace(/-/g, '');
  await fs.mkdir(IMG_DIR, { recursive: true });
  try {
    const buf = await fetchBuffer(url);
    const out = `${id}.webp`;
    await sharp(buf)
      .rotate() // EXIF 회전 보정
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(IMG_DIR, out));
    return `${IMG_PUBLIC_BASE}/${out}`;
  } catch (e) {
    console.warn(`[sync-notion] 이미지 최적화 실패 (${blockId}): ${e.message}`);
    try {
      const buf = await fetchBuffer(url);
      const out = `${id}.img`;
      await fs.writeFile(path.join(IMG_DIR, out), buf);
      return `${IMG_PUBLIC_BASE}/${out}`;
    } catch {
      return url;
    }
  }
}

// 썸네일: 280x280 cover webp 생성 → 로컬 경로 반환
async function saveThumb(buf, name) {
  await fs.mkdir(IMG_DIR, { recursive: true });
  const out = `${name}-thumb.webp`;
  await sharp(buf)
    .rotate()
    .resize(280, 280, { fit: 'cover' })
    .webp({ quality: 72 })
    .toFile(path.join(IMG_DIR, out));
  return `${IMG_PUBLIC_BASE}/${out}`;
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
  // 썸네일(280x280 webp): 페이지 커버 > 본문 첫 이미지 > 없음
  let thumb = null;
  try {
    if (m.coverUrl) {
      const buf = await fetchBuffer(m.coverUrl);
      thumb = await saveThumb(buf, `${m.id.replace(/-/g, '')}-cover`);
    } else {
      const firstImg = (markdown || '').match(/!\[[^\]]*\]\((\/notion\/[^)]+)\)/);
      if (firstImg) {
        const localPath = path.join(ROOT, 'public', firstImg[1]);
        const buf = await fs.readFile(localPath);
        const baseName = path.basename(firstImg[1]).replace(/\.[a-z0-9]+$/i, '');
        thumb = await saveThumb(buf, baseName);
      }
    }
  } catch (e) {
    console.warn(`[sync-notion] 썸네일 생성 실패 (${m.title}): ${e.message}`);
    thumb = null;
  }
  const { coverUrl, ...meta } = m;
  posts.push({ ...meta, thumb, markdown: markdown || '' });
  console.log(`[sync-notion] · ${m.title} (${m.slug})${thumb ? ' [썸네일]' : ''}`);
}

await writeCache(posts);

// ── 단일 페이지들 (About, 책장 프로필) ──────────────────
// integration에 공유된 단독 페이지 중 제목이 아래 후보와 맞는 걸 자동으로 찾는다.
const NAMED_PAGES = {
  about: ['about', '소개'],
  shelf: ['책장', '프로필', '서재'],
};

async function collectNamedPages() {
  const out = { about: '', shelf: '' };
  try {
    const res = await notion.search({ filter: { property: 'object', value: 'page' } });
    const candidates = res.results.filter(
      (p) => p.object === 'page' && p.parent?.type !== 'database_id'
    );
    for (const [key, titles] of Object.entries(NAMED_PAGES)) {
      const page = candidates.find((p) =>
        titles.includes(titleText(p.properties || {}).toLowerCase().trim())
      );
      if (page) {
        const blocks = await n2m.pageToMarkdown(page.id);
        const { parent: md } = n2m.toMarkdownString(blocks);
        out[key] = md || '';
        console.log(`[sync-notion] · '${key}' 페이지 가져옴 (${page.id})`);
      } else {
        console.log(`[sync-notion] '${key}' 페이지 없음 (제목 후보: ${titles.join(' / ')})`);
      }
    }
  } catch (e) {
    console.warn('[sync-notion] 단일 페이지 가져오기 실패:', e.message);
  }
  return out;
}

await writePages(await collectNamedPages());
