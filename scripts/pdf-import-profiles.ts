export type PdfImportProfile = {
  id: string;
  relativePath: string;
  category: string;
  factoryName: string;
  currency: "RMB";
  columnHints: {
    modelNo: string[];
    purchasePrice: string[];
    wattage?: string[];
    moq?: string[];
    size?: string[];
    material?: string[];
    remark?: string[];
    ctnQty?: string[];
  };
  productNameRule: "model-as-name" | "category-factory-model";
  parser: "puya-g4g9" | "puzhao-fangchao" | "puzhao-sanfang" | "jielaite-fan";
  pages?: number[];
  yTolerance?: number;
  minDataColumns?: number;
  skipRowsBefore?: number;
};

export const PDF_IMPORT_PROFILES: PdfImportProfile[] = [
  {
    id: "S02-puya-g4g9",
    relativePath: "光源/G4G9/G4 G9源头工厂 普雅产品价目表220318杭州汇浮.pdf",
    category: "G4G9",
    factoryName: "普雅",
    currency: "RMB",
    columnHints: {
      modelNo: ["型号"],
      purchasePrice: ["含税", "报价"],
      wattage: ["功率"],
      size: ["尺寸"],
      remark: ["产品类型", "产品类"],
    },
    productNameRule: "model-as-name",
    parser: "puya-g4g9",
  },
  {
    id: "S03-puzhao-fangchao",
    relativePath: "户外照明 工业照明/防潮灯/普照/CL04防潮灯报价表2024年4月25 普照.pdf",
    category: "防潮灯",
    factoryName: "普照",
    currency: "RMB",
    columnHints: {
      modelNo: ["产品型号", "型号"],
      purchasePrice: ["含税出厂", "含税", "单价"],
      material: ["材质"],
      size: ["产品尺寸", "尺寸"],
      ctnQty: ["装箱"],
      remark: ["详细参数"],
    },
    productNameRule: "model-as-name",
    parser: "puzhao-fangchao",
  },
  {
    id: "S05-puzhao-sanfang",
    relativePath: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管A-报价表_20250403205611.pdf",
    category: "三防灯",
    factoryName: "普照",
    currency: "RMB",
    columnHints: {
      modelNo: ["产品型号", "型号"],
      purchasePrice: ["含税单价", "含税", "单价"],
      wattage: ["功率"],
      size: ["灯体尺寸", "尺寸"],
      remark: ["备注"],
    },
    productNameRule: "model-as-name",
    parser: "puzhao-sanfang",
  },
  {
    id: "S06-puzhao-sanfang-b",
    relativePath: "户外照明 工业照明/三防灯/普照/普照2025-4月更新/双色管B报价表_20250403205729.pdf",
    category: "三防灯",
    factoryName: "普照",
    currency: "RMB",
    columnHints: {
      modelNo: ["型号"],
      purchasePrice: ["含税价"],
      wattage: ["瓦数"],
      size: ["成品尺寸"],
      material: ["材料"],
      ctnQty: ["包装率"],
      remark: ["配置", "PF"],
    },
    productNameRule: "model-as-name",
    parser: "puzhao-sanfang",
    yTolerance: 6,
  },
  {
    id: "S10-jielaite-fanshan",
    relativePath: "室内照明/风扇灯/伊特/2025年杰莱特风扇产品报价-全.pdf",
    category: "风扇灯",
    factoryName: "杰莱特",
    currency: "RMB",
    columnHints: {
      modelNo: ["产品型号", "model", "型号"],
      purchasePrice: ["含税单价", "price", "含税"],
      wattage: ["功率", "power"],
      moq: ["起订量", "moq"],
    },
    productNameRule: "model-as-name",
    parser: "jielaite-fan",
  },
];
