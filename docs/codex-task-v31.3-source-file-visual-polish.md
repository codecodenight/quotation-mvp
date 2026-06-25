# V31.3: 源文件按钮视觉优化

## 问题
产品卡中源文件名紧贴在"推荐：美莱德 / 10 RMB"后面同一行，视觉上挤在一起，没有层次感。

## 修改文件
`src/app/chat/chat-client.tsx`

## 修改 1：ProductCardList 中的源文件按钮

找到产品卡的源文件按钮（在 `推荐：工厂 / 价格` 下方），当前代码大致为：
```tsx
className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-stone-500 hover:text-leaf"
```

改为 block 布局 + 更柔和的样式：
```tsx
className="mt-1.5 flex max-w-full items-center gap-1 truncate rounded border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-400 hover:border-leaf hover:text-leaf"
```

## 修改 2：OfferComparisonTable 中的源文件按钮

找到 offer 对比表里工厂名下方的源文件按钮，保持当前样式不变（那里已经是 block 布局，视觉正常）。

## 验证
```bash
npx next build
```
Build 成功即可。

## 不做
- 不改数据层
- 不改其他组件
