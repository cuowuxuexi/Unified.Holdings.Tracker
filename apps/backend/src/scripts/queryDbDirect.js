const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../prisma/data/portfolio.db');

console.log('数据库路径:', dbPath);
console.log('');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('无法打开数据库:', err.message);
    process.exit(1);
  }
  console.log('✓ 数据库连接成功\n');
});

// 查询所有组合
db.all('SELECT * FROM Portfolio', [], (err, rows) => {
  if (err) {
    console.error('查询错误:', err.message);
    db.close();
    return;
  }

  console.log(`找到 ${rows.length} 个组合:\n`);

  rows.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.name} (ID: ${row.id})`);
    console.log(`   现金: ${row.cash}`);
    console.log(`   创建时间: ${row.createdAt}`);
    console.log(`   更新时间: ${row.updatedAt}`);
    console.log('');
  });

  // 检查是否有 2025 组合
  const portfolio2025 = rows.find(r => r.name && r.name.includes('2025'));
  if (portfolio2025) {
    console.log('✓ 找到 2025 组合！');
    console.log('详细信息:', portfolio2025);
  } else {
    console.log('✗ 未找到 2025 组合\n');
    console.log('正在查找所有交易记录中是否有相关数据...\n');

    // 查询交易记录
    db.all('SELECT portfolioId, COUNT(*) as count FROM Transaction GROUP BY portfolioId', [], (err, txRows) => {
      if (!err && txRows.length > 0) {
        console.log('各组合的交易记录数:');
        txRows.forEach(tx => {
          const portfolio = rows.find(r => r.id === tx.portfolioId);
          console.log(`  ${portfolio ? portfolio.name : tx.portfolioId}: ${tx.count} 条`);
        });
      }
    });
  }

  db.close((err) => {
    if (err) {
      console.error('关闭数据库时出错:', err.message);
    }
  });
});
