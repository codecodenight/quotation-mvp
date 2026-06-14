# V5.2A: 历史报价页面去掉硬编码版本标签

## 背景

`/customer-quotes` 页面 header 硬编码了 "V5.2" 版本标签。用户界面不应显示内部版本号。

## 修改

文件：`src/app/customer-quotes/page.tsx`

找到这行（约 line 105）：

```tsx
<div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">V5.2</div>
```

改为：

```tsx
<div className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">历史报价</div>
```

与 sidebar 导航标签 "历史报价" 保持一致。

## 验证

- `npx tsc --noEmit --pretty false` 通过
- `npm run build` 通过
- 页面 header 不再显示版本号
