# V44: 清除 macOS 重复文件

## 背景

macOS 文件操作在项目目录内创建了大量 `" 2"` 后缀的重复文件（如 `backup 2.sh`、`adm-zip 2/`）。这些文件污染了 `node_modules/@types/`，导致 TypeScript 和 Next.js build 失败：

```
Cannot find type definition file for 'adm-zip 2'.
Cannot find type definition file for 'xml2js 2'.
```

## 任务

1. 删除项目根目录下所有文件名含 `" 2"` 的文件和目录（排除 `.git/`）
2. 包括 `node_modules/` 内的（node_modules 里的不需要 git 追踪，但要删干净才能 build）
3. 验证 `npx tsc --noEmit` 通过
4. 验证 `npm run build` 通过
5. 验证 `npx vitest run` 通过（允许 1 个 skipped）
6. 不需要 commit——这些文件本来就不在 git 里

## 执行方式

```bash
# 一条命令删除所有 " 2" 文件/目录
find . -name "* 2*" -not -path "*/.git/*" -exec rm -rf {} + 2>/dev/null; true
```

然后跑验证。

## 不做

- 不改任何源代码
- 不动 git 历史
- 不 commit
