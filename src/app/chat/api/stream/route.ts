import type { NextRequest } from "next/server";

import type {
  ChatCompletionMessageParam,
  ChatCompletionToolCall,
  ChatCompletionToolMessageParam,
} from "@/lib/chat-llm-types";
import {
  CHAT_TOOL_DEFINITIONS,
  compactForLLM,
  executeChatTool,
  expandHistoryMessages,
  type ChatMessageInput,
  type ToolCallRecord,
} from "@/lib/chat-tools";
import { CHAT_SYSTEM_PROMPT, DEEPSEEK_MODEL, createDeepSeekChatStream } from "@/lib/deepseek";

export const dynamic = "force-dynamic";

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_MESSAGES = 10;

type StreamEvent =
  | { type: "status"; tool: string }
  | { type: "delta"; text: string }
  | { type: "tool_result"; result: unknown }
  | { type: "done"; toolCalls: ToolCallRecord[] }
  | { type: "error"; message: string };

export async function POST(request: NextRequest) {
  let payload: { message?: string; history?: ChatMessageInput[] };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const userMessage = (payload.message ?? "").trim();
  if (!userMessage) {
    return Response.json({ error: "请输入要查询的产品、价格或历史报价。" }, { status: 400 });
  }
  const history = Array.isArray(payload.history) ? payload.history : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runChatStream(userMessage, history, send);
      } catch (error) {
        send({
          type: "error",
          message: `网络繁忙，请稍后重试。${error instanceof Error ? `（${error.message}）` : ""}`,
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

async function runChatStream(
  userMessage: string,
  history: ChatMessageInput[],
  send: (event: StreamEvent) => void,
) {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...expandHistoryMessages(history.slice(-MAX_HISTORY_MESSAGES)),
    { role: "user", content: userMessage },
  ];
  const allToolCallRecords: ToolCallRecord[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const { content, toolCalls } = await streamOneRound(messages, (delta) => {
      send({ type: "delta", text: delta });
    });

    if (toolCalls.length === 0) {
      send({ type: "done", toolCalls: allToolCallRecords });
      return;
    }

    messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
    const toolMessages: ChatCompletionToolMessageParam[] = [];
    for (const toolCall of toolCalls) {
      send({ type: "status", tool: toolCall.function.name });
      const args = parseToolArguments(toolCall.function.arguments);
      console.log(`[CHAT-TOOL] call: ${toolCall.function.name}`, args);
      const result = await executeChatTool(toolCall.function.name, args);
      const compactResult = JSON.stringify(compactForLLM(result.toolName, result.data));
      send({ type: "tool_result", result });
      allToolCallRecords.push({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
        result: compactResult,
      });
      toolMessages.push({ role: "tool", tool_call_id: toolCall.id, content: compactResult });
    }
    messages.push(...toolMessages);
  }

  send({ type: "done", toolCalls: allToolCallRecords });
}

type StreamedToolCallAccumulator = {
  id: string;
  name: string;
  arguments: string;
};

async function streamOneRound(
  messages: ChatCompletionMessageParam[],
  onDelta: (text: string) => void,
): Promise<{ content: string; toolCalls: ChatCompletionToolCall[] }> {
  const body = await createDeepSeekChatStream({
    model: DEEPSEEK_MODEL,
    messages,
    tools: CHAT_TOOL_DEFINITIONS,
    tool_choice: "auto",
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCallAccumulators: StreamedToolCallAccumulator[] = [];

  const processLine = (line: string) => {
    if (!line.startsWith("data:")) {
      return;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      return;
    }
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      return;
    }
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      onDelta(delta.content);
    }
    for (const toolCallDelta of delta.tool_calls ?? []) {
      const index = toolCallDelta.index ?? 0;
      toolCallAccumulators[index] ??= { id: "", name: "", arguments: "" };
      if (toolCallDelta.id) {
        toolCallAccumulators[index].id = toolCallDelta.id;
      }
      if (toolCallDelta.function?.name) {
        toolCallAccumulators[index].name = toolCallDelta.function.name;
      }
      if (toolCallDelta.function?.arguments) {
        toolCallAccumulators[index].arguments += toolCallDelta.function.arguments;
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffer.slice(0, newlineIndex).trim());
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    processLine(buffer.trim());
  }

  const toolCalls: ChatCompletionToolCall[] = toolCallAccumulators
    .filter((accumulator) => accumulator.id && accumulator.name)
    .map((accumulator) => ({
      id: accumulator.id,
      type: "function" as const,
      function: { name: accumulator.name, arguments: accumulator.arguments },
    }));

  return { content, toolCalls };
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
