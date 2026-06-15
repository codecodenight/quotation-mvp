# V7.2：文件路径可移植化

## 背景

当前 `files` 表中 693 条 `volume_name='local'` 记录的 `absolute_path_snapshot` 全是绝对路径：

```
/Users/bigmac/Desktop/Codex Projects/quotation-mvp/data/source-archive/...
/Users/bigmac/Desktop/Codex Projects/quotation-mvp/sample-data/...
/Users/bigmac/Desktop/Codex Projects/quotation-mvp/sample data/...
```

`src/lib/file-paths.ts` 中 `resolveStoredFilePath` 对 `volume_name='local'` 的处理是：`candidateFromVolume` 返回 null → 直接 fallback 到 `absolutePathSnapshot`。

这意味着项目目录移动或 Tauri 打包后，所有源文件预览/下载会 404。

**对比**：产品图片 `products.image_path` 用的是相对路径（`data/images/...`），没有这个问题。

## 要求

### Part A：修改 `file-paths.ts`（代码变更）

让 `volume_name='local'` 的文件基于项目根目录 + `relative_path` 解析：

```typescript
function candidateFromVolume(volumeName: string, relativePath: string): string | null {
  if (!volumeName) {
    return null;
  }

  if (volumeName === "local") {
    // 基于项目根目录（process.cwd()）解析
    return join(process.cwd(), relativePath);
  }

  return join("/Volumes", volumeName, relativePath);
}
```

`resolveStoredFilePath` 的 fallback 逻辑保持不变——如果基于 `cwd + relative_path` 找不到文件，仍会尝试 `absolutePathSnapshot`。

### Part B：验证本地文件可访问

写 `scripts/v7.2-path-check.ts`（只读，不改 DB），验证：

1. 所有 `volume_name='local'` 的文件，通过修改后的路径解析逻辑能找到文件
2. 产品图片路径（`products.image_path`）通过 `path.join(process.cwd(), image_path)` 能找到文件
3. 输出 accessible / missing 统计到 `docs/v7.2-path-check-report.md`

### Part C：更新 `relative_path`（数据变更，可选）

检查 `volume_name='local'` 的文件，如果 `relative_path` 不是以项目内路径开头（如 `data/`、`sample-data/`、`sample data/`、`hejia/`），说明 relative_path 不够规范。

统计有多少条记录的 `relative_path` 无法通过 `cwd + relative_path` 找到文件，但 `absolutePathSnapshot` 能找到。

如果数量 > 0，在报告中列出，但**不自动修复**——列入报告供人工审阅。

## 验证

- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run` 全过
- 启动 dev server 后，访问 `/api/files/{local_file_id}` 返回 200

## 不做

- 不改 `absolutePathSnapshot` 字段（保留作为 fallback）
- 不动 My Passport 文件记录（V7.1 负责）
- 不动产品图片路径（已经是相对路径）
