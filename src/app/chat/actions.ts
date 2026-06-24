"use server";

import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

import { createQuote, previewQuote } from "@/app/(admin)/quotes/actions";
import { CHAT_TOOL_DEFINITIONS, buildChatQuoteFormData, executeChatTool, type ChatQuoteDraftInput, type ChatToolResult } from "@/lib/chat-tools";
import { CHAT_SYSTEM_PROMPT, DEEPSEEK_MODEL, getDeepSeekClient } from "@/lib/deepseek";

export type ChatMessageInput = {
  role: "user" | "assistant";
  text: string;
};

export type AssistantChatResponse = {
  text: string;
  toolResults: ChatToolResult[];
};

export type ChatQuoteGenerateResult = {
  quoteId: string;
  downloadUrl: string;
  itemCount: number;
  totalSaleAmount: string;
};

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_MESSAGES = 10;

export async function sendChatMessage(
  userMessage: string,
  history: ChatMessageInput[] = [],
): Promise<AssistantChatResponse> {
  const safeMessage = userMessage.trim();
  if (!safeMessage) {
    return { text: "请输入要查询的产品、价格或历史报价。", toolResults: [] };
  }

  let client;
  try {
    client = getDeepSeekClient();
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : "DeepSeek API Key 未配置。",
      toolResults: [],
    };
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...history.slice(-MAX_HISTORY_MESSAGES).map(toOpenAIMessage),
    { role: "user", content: safeMessage },
  ];
  const toolResults: ChatToolResult[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        tools: CHAT_TOOL_DEFINITIONS,
        tool_choice: "auto",
      });
      const choice = response.choices[0];
      const message = choice?.message;
      if (!message) {
        return { text: "没有收到有效回复，请稍后重试。", toolResults };
      }

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return {
          text: message.content || "查询完成，结果如下。",
          toolResults,
        };
      }

      messages.push(message);
      const toolMessages: ChatCompletionToolMessageParam[] = [];
      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") {
          continue;
        }
        const args = parseToolArguments(toolCall.function.arguments);
        const numericFilterKeys = ["min_efficacy", "max_efficacy", "min_watts", "max_watts", "cri"];
        const usedFilters = numericFilterKeys.filter((key) => args[key] != null);
        if (usedFilters.length > 0) {
          console.log(`[CHAT-FILTER] ${toolCall.function.name} numeric filters:`, usedFilters.join(", "));
        }
        const result = await executeChatTool(toolCall.function.name, args);
        toolResults.push(result);
        toolMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.data),
        });
      }
      messages.push(...toolMessages);
    }
  } catch (error) {
    return {
      text: `网络繁忙，请稍后重试。${error instanceof Error ? `（${error.message}）` : ""}`,
      toolResults,
    };
  }

  return {
    text: "查询已经完成，但助手还需要更多信息。你可以换个关键词再试。",
    toolResults,
  };
}

export async function getProductOffersForChat(productId: string): Promise<ChatToolResult> {
  return executeChatTool("get_product_offers", { product_id: productId });
}

export async function generateQuoteFromChatDraft(input: ChatQuoteDraftInput): Promise<ChatQuoteGenerateResult> {
  const formData = buildChatQuoteFormData(input);
  const preview = await previewQuote(formData);
  const created = await createQuote(formData);

  return {
    quoteId: created.quoteId,
    downloadUrl: `/api/quotes/${created.quoteId}/download`,
    itemCount: preview.rows.length,
    totalSaleAmount: input.items
      .reduce((sum, item, index) => sum + Number(preview.rows[index]?.salePrice ?? 0) * item.quantity, 0)
      .toFixed(2),
  };
}

function toOpenAIMessage(message: ChatMessageInput): ChatCompletionMessageParam {
  return {
    role: message.role,
    content: message.text,
  };
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
