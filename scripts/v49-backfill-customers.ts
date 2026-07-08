/**
 * V45: 客户实体回填
 * 从 quotes.customer_name 和 customer_quote_files.customer_name 收集去重客户名，
 * 写入 customers 表（幂等：已存在的名字跳过）。
 *
 * 运行：npx tsx scripts/v45-backfill-customers.ts
 */
import { prisma } from "../src/lib/prisma";

const EXCLUDED_NAMES = new Set(["", "chat quote", "内部核价"]);

async function main() {
  const [quoteNames, fileNames] = await Promise.all([
    prisma.quote.findMany({ select: { customerName: true }, distinct: ["customerName"] }),
    prisma.customerQuoteFile.findMany({
      select: { customerName: true },
      distinct: ["customerName"],
      where: { customerName: { not: null } },
    }),
  ]);

  const names = new Set<string>();
  for (const row of [...quoteNames, ...fileNames]) {
    const name = row.customerName?.normalize("NFC").trim();
    if (name && !EXCLUDED_NAMES.has(name.toLowerCase())) {
      names.add(name);
    }
  }

  const existing = await prisma.customer.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((customer) => customer.name));

  let created = 0;
  for (const name of names) {
    if (existingNames.has(name)) {
      continue;
    }
    await prisma.customer.create({ data: { name } });
    created += 1;
  }

  console.log(`客户名来源：quotes ${quoteNames.length} 个 / customer_quote_files ${fileNames.length} 个`);
  console.log(`去重后 ${names.size} 个，已存在 ${existingNames.size} 个，本次新建 ${created} 个`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
