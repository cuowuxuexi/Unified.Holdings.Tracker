import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('正在查询所有组合...\n');

    const portfolios = await prisma.portfolio.findMany({
      include: {
        transactions: {
          take: 5,
          orderBy: { date: 'desc' },
        },
      },
    });

    console.log(`找到 ${portfolios.length} 个组合：\n`);

    portfolios.forEach((p, idx) => {
      console.log(`${idx + 1}. ${p.name} (ID: ${p.id})`);
      console.log(`   现金: ${p.cash}`);
      console.log(`   创建时间: ${p.createdAt}`);
      console.log(`   更新时间: ${p.updatedAt}`);
      console.log(`   交易记录数: ${p.transactions.length}`);
      console.log('');
    });

    // 检查是否有包含 "2025" 的组合
    const portfolio2025 = portfolios.find((p) => p.name.includes('2025'));
    if (portfolio2025) {
      console.log('✓ 找到 2025 组合！');
    } else {
      console.log('✗ 未找到 2025 组合');
    }
  } catch (error) {
    console.error('错误:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
