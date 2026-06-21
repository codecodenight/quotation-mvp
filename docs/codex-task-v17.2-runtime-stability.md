# V17.2: Runtime Stability — Dev Server Memory & File Watching

## Goal

Make `next dev` and `next start` reliable on a 16GB Mac that also runs Chrome + VS Code + Codex + Claude CLI (~4GB combined). The app is a daily-use tool — "日常工具第一要求是能打开".

## Context

- Next.js 16 (Turbopack default in dev)
- Project has large non-code directories that Turbopack watches unnecessarily:
  - `data/images/` — 9,610 files, 123MB
  - `data/source-archive/` — 40 files, 340MB (some iCloud-dehydrated)
  - `data/deepseek-cache/` — 319 files
  - `backups/` — 67 files, 134MB
  - `outputs/`, `sample-data/`, `sample data/`
- No `NODE_OPTIONS` memory cap set
- User's daily workflow is querying quotes, not editing code — `next start` (production mode) is the right default

## Changes

### A. Memory cap in dev script

In `package.json`, update the `"dev"` script:

```json
"dev": "NODE_OPTIONS='--max-old-space-size=2048' next dev",
```

This caps V8 heap at 2GB, preventing runaway growth while leaving headroom for the OS and other apps.

### B. Exclude data directories from file watching

In `next.config.ts`, add a `webpack` override for watch exclusion. Turbopack in Next.js 16 also respects the top-level `watchOptions` config when falling back to webpack, but the primary mechanism is the `serverExternalPackages` + directory exclusion pattern.

Add to `nextConfig`:

```ts
webpack: (config) => {
  config.watchOptions = {
    ...config.watchOptions,
    ignored: [
      '**/data/**',
      '**/backups/**',
      '**/outputs/**',
      '**/sample-data/**',
      '**/sample data/**',
      '**/node_modules/**',
    ],
  };
  return config;
},
```

Also check if Turbopack has its own ignore mechanism. If `next.config.ts` supports `experimental.turbo` with watch exclusion, add it too. If not, the webpack fallback config above is sufficient — users can run `next dev --turbo=false` if Turbopack still watches those dirs.

### C. Add `prod` script for daily use

In `package.json`, add:

```json
"prod": "next build && next start",
```

This is the recommended daily-use entry point. Production mode has no file watching, no HMR, ~1/3 the memory of dev mode.

### D. Verify no regression

After all changes:

1. Run `npm run dev` — confirm it starts without error, loads the quotes page (`/quotes`), and loads the chat page (`/chat`). Check that Node RSS stays under 1.5GB after loading all pages.
2. Run `npm run prod` — confirm build succeeds and the app works at `http://localhost:3000`.
3. Run `npx tsc --noEmit` — zero errors.
4. Run `npx vitest run` — all tests pass.

### E. Write report

Write results to `docs/v17.2-runtime-stability-report.md`:

```markdown
# V17.2 Runtime Stability Report

## Changes
- [ ] package.json: dev script memory cap
- [ ] package.json: prod script added
- [ ] next.config.ts: watchOptions exclusion
- [ ] Turbopack exclusion (if supported)

## Verification
- Dev server starts: yes/no
- Quotes page loads: yes/no
- Chat page loads: yes/no
- Node RSS after loading all pages: ___MB
- `npm run prod` works: yes/no
- tsc: 0 errors / __ errors
- vitest: __ passed / __ failed

## Notes
(any issues encountered)
```
