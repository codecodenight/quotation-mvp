# V33: Chat loading 计时 + 光效筛选日志追踪

## 背景
DeepSeek V4 推理模型每轮 API 调用需要 10-20 秒，最多 5 轮。用户只看到静态的"正在查询..."，不知道是卡死了还是在正常工作。此外 V31.0 添加了 prompt 引导 DeepSeek 使用 `min_efficacy` 结构化参数，需要在日志中追踪实际命中率。

## 部分 A：Loading 计时器

### 修改 `src/app/chat/chat-client.tsx`

1. 新增一个 `queryStartTime` state：
```typescript
const [queryStartTime, setQueryStartTime] = useState<number | null>(null);
```

2. 在 `submitMessage` 函数中，发送前设置时间戳：
```typescript
setQueryStartTime(Date.now());
```

3. 新建一个小组件 `ElapsedTimer`，每秒更新显示已用时间：
```typescript
function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  if (elapsed < 2) return null;
  return <span className="tabular-nums text-stone-400">{elapsed}s</span>;
}
```

注意：需要在文件顶部 import 中添加 `useEffect`（现在只 import 了 `FormEvent, useMemo, useState, useTransition`）。

4. 修改 loading 显示区域（约第 296 行），从：
```tsx
{isPending ? (
  <div className="flex max-w-[78%] items-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-sm text-stone-600 shadow-panel">
    <Loader2 className="animate-spin" size={16} />
    正在查询...
  </div>
) : null}
```
改为：
```tsx
{isPending && queryStartTime ? (
  <div className="flex max-w-[78%] items-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-sm text-stone-600 shadow-panel">
    <Loader2 className="animate-spin" size={16} />
    正在查询...
    <ElapsedTimer startTime={queryStartTime} />
  </div>
) : null}
```

5. 在 `appendAssistantResponse` 函数中（或收到响应后），清除时间戳：
```typescript
setQueryStartTime(null);
```

## 部分 B：光效筛选日志追踪

### 修改 `src/app/chat/actions.ts`

在 `sendChatMessage` 函数中，tool call 循环内（约第 86 行 `console.log` 之后），添加一条专用日志来追踪是否使用了数值筛选参数：

```typescript
const numericFilterKeys = ["min_efficacy", "max_efficacy", "min_watts", "max_watts", "cri"];
const usedFilters = numericFilterKeys.filter((key) => args[key] != null);
if (usedFilters.length > 0) {
  console.log(`[CHAT-FILTER] ${toolCall.function.name} numeric filters:`, usedFilters.join(", "));
}
```

这样在服务器日志中 grep `[CHAT-FILTER]` 就能看到 DeepSeek 是否正确使用了结构化数值参数。

## 验证

```bash
npx next build
```

Build 成功即可。

## 不做
- 不改 DeepSeek prompt
- 不改数据层
- 不改排序逻辑
- 不做流式响应（架构改动太大）
