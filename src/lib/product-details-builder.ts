import type { ProductParamDisplay } from "./product-param-display";

export type ProductDetailsParam = Pick<ProductParamDisplay, "paramKey" | "normalizedValue" | "unit" | "rawValue">;

type ParamFormatter = {
  key: string;
  label: string;
  format: (param: ProductDetailsParam) => string;
};

const PARAM_FORMATTERS: ParamFormatter[] = [
  { key: "watts", label: "Power", format: formatWithUnit },
  { key: "cct", label: "CCT", format: formatWithUnit },
  { key: "ip", label: "IP", format: formatPlain },
  { key: "lumens", label: "Lumens", format: formatWithUnit },
  { key: "size_display", label: "Size", format: formatPlain },
  { key: "material", label: "Material", format: formatPlain },
  { key: "beam_angle", label: "Beam Angle", format: formatBeamAngle },
  { key: "pf", label: "PF", format: formatPlain },
  { key: "luminous_efficacy", label: "Luminous Efficacy", format: formatWithSpacedUnit },
  { key: "voltage", label: "Voltage", format: formatPlain },
  { key: "led_type", label: "LED Type", format: formatPlain },
  { key: "leds_per_meter", label: "LEDs/m", format: formatPlain },
  { key: "color", label: "Color", format: formatPlain },
  { key: "panel_size", label: "Panel Size", format: formatPlain },
  { key: "cutout_mm", label: "Cutout", format: formatWithUnit },
  { key: "cri", label: "CRI", format: formatPlain },
];

export function buildProductDetailsFromParams(params: ProductDetailsParam[]): string | null {
  const lines: string[] = [];
  for (const formatter of PARAM_FORMATTERS) {
    const param = params.find((candidate) => candidate.paramKey === formatter.key && hasNormalizedValue(candidate));
    if (!param) {
      continue;
    }

    const value = formatter.format(param);
    if (value) {
      lines.push(`${formatter.label}: ${value}`);
    }
  }

  return lines.length >= 2 ? lines.join("\n") : null;
}

function hasNormalizedValue(param: ProductDetailsParam): boolean {
  return Boolean(param.normalizedValue?.trim());
}

function formatPlain(param: ProductDetailsParam): string {
  return param.normalizedValue?.trim() ?? "";
}

function formatWithUnit(param: ProductDetailsParam): string {
  const value = formatPlain(param);
  const unit = param.unit?.trim() ?? "";
  if (!value || !unit || value.toLowerCase().endsWith(unit.toLowerCase())) {
    return value;
  }
  return `${value}${unit}`;
}

function formatBeamAngle(param: ProductDetailsParam): string {
  const value = formatPlain(param);
  if (!value || value.endsWith("°")) {
    return value;
  }
  return `${value}°`;
}

function formatWithSpacedUnit(param: ProductDetailsParam): string {
  const value = formatPlain(param);
  const unit = param.unit?.trim() ?? "";
  if (!value || !unit || value.toLowerCase().endsWith(unit.toLowerCase())) {
    return value;
  }
  return `${value} ${unit}`;
}
