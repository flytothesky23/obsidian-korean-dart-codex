# Release Guide

Korean DART Codex uses GitHub Releases as the BRAT distribution surface.

Required release assets:

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`

## Prepare

Update `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and
`CHANGELOG.md` to the same semantic version, then run:

```bash
npm ci
npm run release:prepare
```

## Publish

Commit with the repository Lore commit protocol, create a tag matching the
manifest version, and push both.

```bash
git tag "v$(node -p 'require(\"./manifest.json\").version')"
git push origin main --tags
```

GitHub Actions rebuilds the bundle and publishes the four BRAT assets. Never
include `DART_API_KEY`, `KRX_API_KEY`, Codex tokens, `.env`, or local vault data
in a release.

## BRAT smoke test

1. Add `https://github.com/flytothesky23/obsidian-korean-dart-codex` in BRAT.
2. Confirm BRAT downloads all four release assets.
3. Enable `Korean DART Codex`.
4. Confirm the target market's KRX base/trade API products are approved.
5. Open the panel and verify the DART/KRX tabs and each MCP status badge. Treat
   KRX as ready only when its official API live probe turns the badge green.
6. Run one source-backed DART question and one dated KRX market-data question.
7. Save a KRX result and verify `research_mode`, `sources`,
   `trading_dates`, and `tools_used` frontmatter.
