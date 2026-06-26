// @ts-check
import { defineConfig } from 'astro/config';

// 정적 사이트. Vercel이 클라우드에서 `astro build` 실행 → dist/ 배포.
export default defineConfig({
  site: 'https://pullstory.net',
});
