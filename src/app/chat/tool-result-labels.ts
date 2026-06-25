const TOOL_LABELS: Record<string, string> = {
  search_products: "🔍 产品搜索",
  compare_factories: "📊 工厂对比",
  get_product_offers: "💰 供应商报价",
  search_customer_history: "📋 历史报价",
};

export function getToolResultLabel(toolName: string) {
  return TOOL_LABELS[toolName];
}
