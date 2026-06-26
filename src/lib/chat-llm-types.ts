export type ChatCompletionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ChatCompletionToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionToolMessageParam = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

export type ChatCompletionMessageParam =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatCompletionToolCall[];
    }
  | ChatCompletionToolMessageParam;

export type ChatCompletion = {
  choices: Array<{
    message?: Extract<ChatCompletionMessageParam, { role: "assistant" }>;
  }>;
};

export type ChatCompletionCreateParamsNonStreaming = {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  tool_choice?: "auto" | "none";
};
