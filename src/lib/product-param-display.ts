export type ProductParamDisplay = {
  paramKey: string;
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
  confidence: string;
};

const PARAM_DISPLAY_PRIORITY = [
  "watts",
  "ip",
  "voltage",
  "cct",
  "material",
  "beam_angle",
  "pf",
  "luminous_efficacy",
] as const;

const priorityIndex = new Map<string, number>(PARAM_DISPLAY_PRIORITY.map((key, index) => [key, index]));

export function sortDisplayParams<T extends ProductParamDisplay>(params: T[]): T[] {
  return [...params].sort((left, right) => {
    const leftIndex = priorityIndex.get(left.paramKey) ?? PARAM_DISPLAY_PRIORITY.length;
    const rightIndex = priorityIndex.get(right.paramKey) ?? PARAM_DISPLAY_PRIORITY.length;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.paramKey.localeCompare(right.paramKey);
  });
}

export function formatParamLabel(param: ProductParamDisplay): string {
  const value = (param.normalizedValue || param.rawValue).trim();
  if (!value) {
    return "";
  }

  switch (param.paramKey) {
    case "watts":
    case "cct":
    case "luminous_efficacy":
      return appendUnit(value, param.unit);
    case "beam_angle":
      return value.endsWith("°") ? value : `${value}°`;
    case "pf":
      return `PF ${value}`;
    case "ip":
    case "voltage":
    case "material":
      return value;
    default:
      return `${param.paramKey}: ${appendUnit(value, param.unit)}`;
  }
}

function appendUnit(value: string, unit: string | null): string {
  if (!unit || value.toLowerCase().endsWith(unit.toLowerCase())) {
    return value;
  }
  return `${value}${unit}`;
}
