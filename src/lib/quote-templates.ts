import type { Worksheet } from "exceljs";

import type { QuoteCellValue } from "./quote-table-model";
import { bulbTemplate } from "./quote-templates/bulb";
import { cabinetTemplate } from "./quote-templates/cabinet";
import { ceilingTemplate } from "./quote-templates/ceiling";
import { deskLampTemplate } from "./quote-templates/desk-lamp";
import { downlightTemplate } from "./quote-templates/downlight";
import { emergencyTemplate } from "./quote-templates/emergency";
import { fanLightTemplate } from "./quote-templates/fan-light";
import { filamentTemplate } from "./quote-templates/filament";
import { floodlightTemplate } from "./quote-templates/floodlight";
import { g4g9Template } from "./quote-templates/g4g9";
import { gardenTemplate } from "./quote-templates/garden";
import { highbayTemplate } from "./quote-templates/highbay";
import { ingroundTemplate } from "./quote-templates/inground";
import { linearTemplate } from "./quote-templates/linear";
import { magneticTrackTemplate } from "./quote-templates/magnetic-track";
import { mirrorLightTemplate } from "./quote-templates/mirror-light";
import { moistureProofTemplate } from "./quote-templates/moisture-proof";
import { panelTemplate } from "./quote-templates/panel";
import { purificationTemplate } from "./quote-templates/purification";
import { solarTemplate } from "./quote-templates/solar";
import { solarWallTemplate } from "./quote-templates/solar-wall";
import { streetLightTemplate } from "./quote-templates/street-light";
import { stripTemplate } from "./quote-templates/strip";
import { stringLightTemplate } from "./quote-templates/string-light";
import { trackLightTemplate } from "./quote-templates/track-light";
import { triproofTemplate } from "./quote-templates/triproof";
import { tubeTemplate } from "./quote-templates/tube";
import { wallLampTemplate } from "./quote-templates/wall-lamp";
import { workLightTemplate } from "./quote-templates/work-light";

export interface QuoteTemplateColumn {
  header: string;
  key: string;
  width: number;
}

export interface QuoteTemplateConfig {
  category: string;
  sheetName: string;
  columns: QuoteTemplateColumn[];
  writeRow: (ws: Worksheet, rowIndex: number, item: QuoteTemplateItem) => void;
  writeHeader?: (ws: Worksheet) => void;
  buildRowCells: (item: QuoteTemplateItem, index: number) => Record<string, QuoteCellValue>;
}

export interface QuoteTemplateItem {
  productName: string;
  modelNo: string | null;
  size: string | null;
  material: string | null;
  remark: string | null;
  salePrice: number;
  purchasePrice: number;
  currency: string;
  moq: string | null;
  ctnQty: string | null;
  ctnLength: string | null;
  ctnWidth: string | null;
  ctnHeight: string | null;
  params: Record<string, string>;
}

const TEMPLATE_REGISTRY = new Map<string, QuoteTemplateConfig>();

export function registerTemplate(config: QuoteTemplateConfig): void {
  TEMPLATE_REGISTRY.set(config.category, config);
}

export function getTemplate(category: string): QuoteTemplateConfig | null {
  return TEMPLATE_REGISTRY.get(category) ?? null;
}

export function hasTemplate(category: string): boolean {
  return TEMPLATE_REGISTRY.has(category);
}

registerTemplate(bulbTemplate);
registerTemplate(cabinetTemplate);
registerTemplate(ceilingTemplate);
registerTemplate(deskLampTemplate);
registerTemplate(downlightTemplate);
registerTemplate(emergencyTemplate);
registerTemplate(fanLightTemplate);
registerTemplate(filamentTemplate);
registerTemplate(floodlightTemplate);
registerTemplate(g4g9Template);
registerTemplate(gardenTemplate);
registerTemplate(highbayTemplate);
registerTemplate(ingroundTemplate);
registerTemplate(linearTemplate);
registerTemplate(magneticTrackTemplate);
registerTemplate(mirrorLightTemplate);
registerTemplate(moistureProofTemplate);
registerTemplate(panelTemplate);
registerTemplate(purificationTemplate);
registerTemplate(solarTemplate);
registerTemplate(solarWallTemplate);
registerTemplate(streetLightTemplate);
registerTemplate(stripTemplate);
registerTemplate(stringLightTemplate);
registerTemplate(trackLightTemplate);
registerTemplate(triproofTemplate);
registerTemplate(tubeTemplate);
registerTemplate(wallLampTemplate);
registerTemplate(workLightTemplate);
