import React, { useState } from 'react';
import { Input, Button, List, Space } from 'antd'; // Import necessary Antd components
import useAppStore from '../store'; // Correct: default import
import { Quote } from '../store/types'; // Correct: use Quote type
import { formatPercent } from './utils/format';

const StockQuote: React.FC = () => {
  const [codesInput, setCodesInput] = useState('');
  const { stockQuotes, fetchStockQuotes } = useAppStore();

  const handleFetchQuotes = () => {
    // Split by comma, trim whitespace, and filter out empty strings
    const codes = codesInput.split(',').map(code => code.trim()).filter(code => code);
    if (codes.length > 0) {
      fetchStockQuotes(codes);
    }
  };

  // Convert the stockQuotes map to an array for the List component
  const quotesList = Object.values(stockQuotes);

  return (
    <div>
      <Space.Compact style={{ width: '100%', marginBottom: '16px' }}>
        <Input
          placeholder="输入股票代码，用逗号分隔（例如：sh600519,hk00700）"
          value={codesInput}
          onChange={(e) => setCodesInput(e.target.value)}
          onPressEnter={handleFetchQuotes} // Allow fetching on Enter key
        />
        <Button type="primary" onClick={handleFetchQuotes}>
          查询
        </Button>
      </Space.Compact>

      <List
        header={<div>股票行情</div>}
        bordered
        dataSource={quotesList}
        renderItem={(item: Quote) => ( // Explicitly type item
          <List.Item>
            {item.name} ({item.code}): {item.currentPrice?.toFixed(2)} ({formatPercent(item.changePercent, 2)})
          </List.Item>
        )}
        locale={{ emptyText: '请输入代码查询或无数据...' }} // Add locale for empty state
      />
    </div>
  );
};

export default StockQuote;