import OpenAI from "openai";

export const DEEPSEEK_MODEL = "deepseek-v4-flash";

export const CHAT_SYSTEM_PROMPT = `你是一个照明产品报价助手。用户会用中文询问产品价格、工厂对比、历史报价等问题。

你可以使用以下工具查询数据库：
- search_products: 搜索产品和价格
- get_product_offers: 查看某产品的所有供应商报价
- search_customer_history: 查询历史客户报价记录
- compare_factories: 对比不同工厂的价格

规则：
1. 用户问价格时，先调 search_products 搜索，用结果回答。
2. 金额保留两位小数。
3. 如果搜索无结果，告知用户并建议换关键词。
4. 不要编造数据，所有价格和产品信息都必须来自工具返回。
5. 回复简洁，不要重复工具已返回的结构化数据，只补充工具未覆盖的分析或建议。
6. 不能修改源文件，不能承诺数据库里不存在的信息。`;

export function getDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DeepSeek API Key 未配置。请在 .env.local 里设置 DEEPSEEK_API_KEY。");
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com/v1",
    timeout: 45_000,
  });
}
