# 끌당북스 · PULL STORY — Website

`pullstory.net` 공식 사이트. **Build in public** — 매주 한 페이지씩 자라는 정적 사이트.

> "이미 이룬 사람의 강의가 아닙니다. 지금 시도하는 한 사람의 일기입니다."

## 현재 단계
- **V1 (Week 01)** — 정적 HTML 한 장짜리 placeholder. 빌드 도구 없음.

## 구조
```
index.html     메인 랜딩 (단일 파일, 인라인 CSS)
favicon.svg    파비콘
```

## 로컬 미리보기
```bash
cd pullstory-web
python3 -m http.server 8000   # http://localhost:8000
```

## 배포
- **Vercel** (Free Hobby) + GitHub 연동 → `git push` 시 자동 배포.
- 도메인: `pullstory.net` (Namecheap → Vercel 네임서버/DNS 연결).
- 앱은 추후 `app.pullstory.net` 서브도메인으로 별도 연결.

## 로드맵
- [x] V1 빈 사이트 (Week 01)
- [ ] 콘텐츠/블로그 (Episode 글 버전) — 추후 Astro 마이그레이션 검토
- [ ] `app.pullstory.net` 앱 연결

> 전체 프로젝트 컨텍스트: `../scashbook-app/CLAUDE.md`
