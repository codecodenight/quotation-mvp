# V46.1 — Chore：代码去重 + macOS 重复文件防复发

> **补录说明**：本任务由 Claude Fable 5 于 2026-07-07 直接执行完成，此文档为事后补录的记录（非 Codex 执行指令）。

## 1. 代码去重（HANDOFF 记录的已知 tech debt）

`buildParamFilter` / `buildProductIdsFilter` / `intersectProductIdFilters` 在 `src/app/(admin)/quotes/page.tsx` 和 `src/lib/chat-tools.ts` 各有一份相同实现（含 `PRODUCT_ID_FILTER_CHUNK_SIZE = 400` 常量）。

抽取到 **`src/lib/product-where-filters.ts`**，两处改为 import。验证：tsc 零错误，chat-tools 21 个测试通过。

## 2. macOS 重复文件防复发

" 2" 后缀重复文件（Finder/iCloud 生成）第二次破坏构建：`src/` 内 30+ 个 `xxx 2.ts`，其中 `route 2.ts` 被 Next.js 注册为路由导致 RSC manifest 错误（V44 曾清理过一次）。

- 本次清理：`src/` 内全部 `* 2.*` 移出（隔离备份，未直接删除）
- `.gitignore` 追加：
  ```
  # macOS Finder/iCloud duplicate files (break Next.js routing; see V44)
  * 2.*
  * 2/
  ```
- 根因建议：项目在 iCloud 同步路径内（Desktop），考虑移出或对 `node_modules`/`.next` 设置排除
