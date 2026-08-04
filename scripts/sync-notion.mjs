// 빌드 전에 실행: Notion의 단일 페이지(About 등)를 마크다운으로 가져와
// src/data/pages.json 으로 캐시한다. 사진은 사이트로 내려받아 영구 보관하고,
// 유튜브/임베드는 iframe으로 바꾼다.
// 페이지(Astro)는 이 캐시만 읽으므로 렌더 시 Notion 호출이 없고, 사진 만료 문제도 없다.
//
// 연재 글은 이제 앱에서 쓴다 — 노션 DB 연동은 걷어냈다.
// NOTION_TOKEN 이 없으면 빈 캐시를 쓰고 정상 종료한다.

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_FILE = path.join(ROOT, 'src/data/pages.json');
const IMG_DIR = path.join(ROOT, 'public/notion');
const IMG_PUBLIC_BASE = '/notion';

const token = process.env.NOTION_TOKEN;

async function writePages(pages) {
  await fs.mkdir(path.dirname(PAGES_FILE), { recursive: true });
  await fs.writeFile(PAGES_FILE, JSON.stringify(pages, null, 2));
  const filled = Object.entries(pages).filter(([, v]) => v).map(([k]) => k);
  console.log(`[sync-notion] wrote pages.json (${filled.join(', ') || 'empty'})`);
}

if (!token) {
  console.log('[sync-notion] NOTION_TOKEN 없음 → 빈 캐시로 진행');
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
