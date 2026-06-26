// Notion → 사이트 콘텐츠 연동.
// 빌드 시점에 Notion 데이터베이스를 읽어 글 목록/본문을 가져온다.
// NOTION_TOKEN / NOTION_DATABASE_ID 환경변수가 없으면 빈 목록을 반환해
// (자격증명 셋업 전에도) 빌드가 깨지지 않도록 한다.

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

const enabled = Boolean(token && databaseId);

const notion = enabled ? new Client({ auth: token }) : null;
const n2m = enabled ? new NotionToMarkdown({ notionClient: notion }) : null;

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-') || 'post';
}

function plainTitle(page) {
  // 'Name' (title) 속성에서 제목 텍스트 추출
  const props = page.properties || {};
  const titleProp = Object.values(props).find((p) => p.type === 'title');
  return (titleProp?.title || []).map((t) => t.plain_text).join('') || 'Untitled';
}

/** 발행(Published 체크)된 글 목록을 최신순으로 반환 */
export async function getPublishedPosts() {
  if (!enabled) return [];

  const pages = [];
  let cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      filter: { property: 'Published', checkbox: { equals: true } },
      sorts: [{ property: 'Date', direction: 'descending' }],
      start_cursor: cursor,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return pages.map((page) => {
    const title = plainTitle(page);
    const dateProp = page.properties?.Date?.date?.start || null;
    return {
      id: page.id,
      title,
      slug: slugify(title),
      date: dateProp,
    };
  });
}

/** slug에 해당하는 글의 메타 + 마크다운 본문 반환 */
export async function getPostBySlug(slug) {
  if (!enabled) return null;
  const posts = await getPublishedPosts();
  const meta = posts.find((p) => p.slug === slug);
  if (!meta) return null;

  const mdBlocks = await n2m.pageToMarkdown(meta.id);
  const { parent: markdown } = n2m.toMarkdownString(mdBlocks);
  return { ...meta, markdown };
}
