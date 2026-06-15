# V7.3 — 修正 files.relative_path 为项目相对路径

## 背景

V7.0B 迁移源文件到本地时，693 条 `files` 记录的 `relative_path` 保留了原始裸文件名（如 `核价...xlsx`），没有加上 `data/source-archive/` 前缀。当前 `file-paths.ts` 的 `candidateFromLocalSnapshot` 通过 marker 解析 `absolute_path_snapshot` 兜底，但这依赖于 snapshot 中的绝对路径在当前机器上仍然有效。部署到服务器后 snapshot 路径失效，只有 `cwd + relative_path` 可靠。

## 目标

把 693 条 local files 的 `relative_path` 从裸文件名改为项目相对路径，使 `candidateFromVolume("local", relativePath)` 即 `cwd + relative_path` 能直接解析到正确文件。

## 实现

### 脚本：`scripts/v7.3-fix-relative-path.ts`

支持 `--dry-run`（默认）和 `--apply` 模式。

#### Step 1: 备份 DB
```
cp prisma/dev.db backups/dev-before-v7.3-{timestamp}.sqlite
```

#### Step 2: 读取所有 local files
```sql
SELECT id, relative_path, absolute_path_snapshot
FROM files WHERE volume_name = 'local'
```

#### Step 3: 从 absolute_path_snapshot 推导项目相对路径

用 marker 列表从 snapshot 中提取相对路径（与现有 `candidateFromLocalSnapshot` 逻辑一致）：

```typescript
const markers = ["/data/source-archive/", "/sample-data/", "/sample data/"];

function deriveRelativePath(absolutePathSnapshot: string): string | null {
  const normalized = absolutePathSnapshot.replace(/\\/g, "/");
  for (const marker of markers) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      // 返回 marker 之后的部分（含 marker 目录名）
      // e.g., "/Users/.../data/source-archive/foo.xlsx" → "data/source-archive/foo.xlsx"
      return normalized.slice(idx + 1); // +1 跳过开头的 /
    }
  }
  return null;
}
```

#### Step 4: 验证新路径存在

对每条记录，用 `join(process.cwd(), newRelativePath)` 检查文件是否存在（`fs.access`）。

不存在的记录标记为 `SKIP`，不更新。

#### Step 5: 更新 DB（apply 模式）

```sql
UPDATE files SET relative_path = ? WHERE id = ?
```

事务包裹全部 UPDATE。

#### Step 6: 验证

| 检查项 | 预期 |
|---|---|
| local files 总数 | 693 |
| relative_path 已更新 | 693（或 693 - SKIP 数） |
| cwd+relative_path 可访问 | = 已更新数 |
| 旧的裸文件名 relative_path 剩余 | 0 |
| supplier_offers FK 完整 | 0 broken |
| price_history FK 完整 | 0 broken |

### 报告

写入 `docs/v7.3-relative-path-report.md`，包含：
- dry-run / apply 模式标记
- 备份路径
- 各 marker 目录的文件数
- SKIP 记录详情（如有）
- 验证结果表

### 不做的事

- 不修改 `absolute_path_snapshot`（保留历史记录）
- 不修改 `volume_name`
- 不修改 `file-paths.ts`（V7.3 完成后 candidateFromVolume 就能直接解析，candidateFromLocalSnapshot 成为纯冗余备份）
- 不修改源文件
