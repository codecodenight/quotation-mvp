/* eslint-disable @typescript-eslint/no-require-imports */
{
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

const prisma = new PrismaClient();

const solarUpdates = [
  {
    currentModelNo: "1",
    modelNo: "XYJ-SWL-500LM",
    productName: "Solar Wall Light 500LM",
    ctnQty: "18",
    ctnLength: "53.5",
    ctnWidth: "44",
    ctnHeight: "21.5",
    remark:
      "碲化镉太阳能板 147*48mm/0.7W 18650 1*2000MAH 3.7V 感应角度120度 8M 模式 3M 开机上电15S热机时间，15s后检测光控进入待机状态，天黑后底灯微亮（初始亮度为5LM），人来感应亮灯或接收到其他灯具的联动信号亮灯（初始亮度为500LM），延时时长为20S；微亮定时6H,6H后微亮关闭但不影响感应亮灯，天亮后待机不亮灯。 IP65 500LM 6500±500K",
  },
  {
    currentModelNo: "2",
    modelNo: "XYJ-SWL-700LM",
    productName: "Solar Wall Light 700LM",
    ctnQty: "30",
    ctnLength: "47.5",
    ctnWidth: "43.5",
    ctnHeight: "35",
    remark:
      "单晶硅太阳能板 1.8W 18650 1*1800MAH 3.7V 颗感应角度120度 8M 3种模式 3M 1.人来高亮800lm，人走过20S后灭灯 2.人来高亮800lm，人走过20S后低亮24lm 3.小夜灯模式200lm阶梯放电，无人体感应 IP65 700LM 6500±500K",
  },
  {
    currentModelNo: "3",
    modelNo: "XYJ-SWL-1000LM",
    productName: "Solar Wall Light 1000LM",
    ctnQty: "36",
    ctnLength: "59",
    ctnWidth: "38",
    ctnHeight: "43",
    remark:
      "碲化镉太阳能板 128*77mm/1W 18650 1*2000MAH 3.7V 感应角度90度 8M 3种模式 3M 1.人来高亮1000lm，人走过20S后灭灯 2.人来高亮1000lm，人走过20S后低亮20lm 3.小夜灯模式200lm 4H之后进入模式一 IP65 1000LM 6500±500K",
  },
  {
    currentModelNo: "4",
    modelNo: "XYJ-SWL-1500LM",
    productName: "Solar Wall Light 1500LM",
    ctnQty: "18",
    ctnLength: "59",
    ctnWidth: "38",
    ctnHeight: "43",
    remark:
      "碲化镉太阳能板 81*146 1.8W 18650 1*2000MAH 3.7V 感应角度180度 15M 模式 4.5M 连接线 模式). ①模式1:轻按1次进入模式1(高亮模式):高亮1500LM热机3S后,如果是白天,光控生效灭灯;如果是晚上,进入感应待机模式,当有人经过时感应高亮1500LM延时时间结束后灭灯(延迟时间长 短由TIME旋钮决定) ② 模式2:短按1次,进入模式3(常亮模式):低亮100LM热机3S后,如果是白天,光控生效灭灯;如果是晚上,进入100LM长亮模式,感应关闭,定时4 小时,4小时后转感应高亮模式,无感应灭灯,直到天亮. ③关灯：整灯关闭，不影响充电 提示:上电第一次开机时,热机时间需要15S,15S后检光控 IP65 1500LM 6500±500K",
  },
  {
    currentModelNo: "5",
    modelNo: "XYJ-SWL-2000LM",
    productName: "Solar Wall Light 2000LM",
    ctnQty: "8",
    ctnLength: "43.5",
    ctnWidth: "41.5",
    ctnHeight: "35",
    remark:
      "碲化镉太阳能板 165*133 2.1W 18650 1*2200MAH 3.7V 感应角度180度 15M 模式 AUTO/ON/OFF 4.5M 连接线 1、短按第一次,进入AUTO模式:晚上感应亮灯,白天灭灯,感应亮灯延迟时间受时间调节旋钮(TIME)控制;30S/60S/120S ; 2、短按第二次,进入ON模式:不受光敏控制(白天/晚上都可以亮灯),感应关闭.长亮亮灯时长90分钟以上; 3、短按第三次,OFF 关机； IP65 2000LM 6500±500K",
  },
];

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    let productsUpdated = 0;
    let offersUpdated = 0;
    let productsCreated = 0;
    let offersMoved = 0;

    for (const item of solarUpdates) {
      const product = await tx.product.findFirst({
        where: { category: "地插灯/太阳能壁灯", modelNo: item.currentModelNo, productName: item.currentModelNo },
        include: { supplierOffers: true },
      });
      if (!product) {
        throw new Error(`未找到太阳能产品 ${item.currentModelNo}`);
      }
      if (product.supplierOffers.length !== 1) {
        throw new Error(`太阳能产品 ${item.currentModelNo} 报价数量异常：${product.supplierOffers.length}`);
      }

      await tx.product.update({
        where: { id: product.id },
        data: {
          modelNo: item.modelNo,
          productName: item.productName,
          size: null,
          remark: item.remark,
        },
      });
      productsUpdated += 1;

      await tx.supplierOffer.update({
        where: { id: product.supplierOffers[0].id },
        data: {
          moq: "3000",
          ctnQty: item.ctnQty,
          ctnLength: item.ctnLength,
          ctnWidth: item.ctnWidth,
          ctnHeight: item.ctnHeight,
        },
      });
      offersUpdated += 1;
    }

    const singleColorProduct = await tx.product.findFirst({ where: { category: "皮线灯", productName: "皮线灯-单色" } });
    if (!singleColorProduct) {
      throw new Error("未找到皮线灯-单色");
    }
    await tx.product.update({
      where: { id: singleColorProduct.id },
      data: {
        modelNo: "RD-F-05-AY",
        remark: "50珠皮线灯 灯珠距离：10厘米 亮灯颜色：红/黄/蓝/绿/单彩/双彩 USB供电 不带APP 不同步 带记忆",
      },
    });
    productsUpdated += 1;

    const doubleColorProduct = await tx.product.findFirst({ where: { category: "皮线灯", productName: "皮线灯-双彩" } });
    if (!doubleColorProduct) {
      throw new Error("未找到皮线灯-双彩");
    }
    await tx.product.update({
      where: { id: doubleColorProduct.id },
      data: {
        modelNo: "RD-DF-05-AY",
        remark: "50珠皮线灯 灯珠距离：10厘米 亮灯颜色：双色/双彩 USB供电 不带APP 不同步 带记忆",
      },
    });
    productsUpdated += 1;

    const singleColor = await tx.product.findFirst({
      where: { category: "皮线灯", productName: "皮线灯-单色", modelNo: "RD-F-05-AY" },
      include: { supplierOffers: true },
    });
    if (!singleColor) {
      throw new Error("未找到皮线灯-单色");
    }
    const fantasyOffer = singleColor.supplierOffers.find((offer) => offer.purchasePrice.toString() === "7.9");
    if (!fantasyOffer) {
      throw new Error("未找到错挂在皮线灯-单色下的 7.9 报价");
    }

    let fantasyProduct = await tx.product.findFirst({ where: { category: "皮线灯", modelNo: "RD-D-05-AY" } });
    if (!fantasyProduct) {
      fantasyProduct = await tx.product.create({
        data: {
          category: "皮线灯",
          productName: "皮线灯-幻彩",
          modelNo: "RD-D-05-AY",
          material: "铜线+LED",
          size: "5m/50珠",
          remark:
            "5米 50珠 USB按钮可以切换27种模式 APP带DIY功能可调1600万种颜色，3种声控方式，166种色光跳动模式，定时功能 配24键遥控器",
        },
      });
      productsCreated += 1;
    }

    await tx.supplierOffer.update({
      where: { id: fantasyOffer.id },
      data: { productId: fantasyProduct.id },
    });
    offersMoved += 1;

    return { productsUpdated, offersUpdated, productsCreated, offersMoved };
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
}
