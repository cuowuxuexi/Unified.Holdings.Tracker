import React, { useState, useEffect } from 'react';
import { Form, Input, InputNumber, Select, DatePicker, Button, message, Slider, Row, Col, Spin, Alert } from 'antd';
import useAppStore from '../store'; // Adjust path if needed
import { TransactionType, TransactionInput } from '../store/types'; // Adjust path if needed
import dayjs from 'dayjs';

const { Option } = Select;

interface AddTransactionFormProps {
  portfolioId: string;
  onSuccess?: () => void; // Optional callback after successful submission
}

// Define which fields are relevant for each transaction type
const typeFieldConfig: Record<TransactionType, { requiresAsset?: boolean; requiresQuantityPrice?: boolean; requiresAmount?: boolean }> = {
  [TransactionType.BUY]: { requiresAsset: true, requiresQuantityPrice: true },
  [TransactionType.SELL]: { requiresAsset: true, requiresQuantityPrice: true },
  [TransactionType.DEPOSIT]: { requiresAmount: true },
  [TransactionType.WITHDRAW]: { requiresAmount: true },
  [TransactionType.DIVIDEND]: { requiresAmount: true, requiresAsset: true }, // Dividend needs amount, asset is optional (true allows display, validation should be optional)
};

// 交易类型中英文映射
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  [TransactionType.BUY]: '买入',
  [TransactionType.SELL]: '卖出',
  [TransactionType.DEPOSIT]: '入金',
  [TransactionType.WITHDRAW]: '出金',
  [TransactionType.DIVIDEND]: '股息',
};

const AddTransactionForm: React.FC<AddTransactionFormProps> = ({ portfolioId, onSuccess }) => {
  const [form] = Form.useForm();
  const addTransaction = useAppStore((state) => state.addTransaction);
  const [selectedType, setSelectedType] = useState<TransactionType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [leverageAmount, setLeverageAmount] = useState<number>(0);
  const fetchPortfolioDetail = useAppStore(state => state.fetchPortfolioDetail);
  const portfolio = useAppStore((state) => state.selectedPortfolioDetail);
  const isLoadingDetail = useAppStore(state => state.isLoadingPortfolioDetail);
  const portfolioError = useAppStore(state => state.portfolioError);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (portfolioId) {
      fetchPortfolioDetail(portfolioId);
    }
  }, [portfolioId]);

  const config = selectedType ? typeFieldConfig[selectedType] : {};

  // 获取当前 portfolio 详情
  // 兼容 leverageInfo 和 leverage 两种字段
  const leverageData = (portfolio as any)?.leverageInfo || (portfolio as any)?.leverage;
  const availableLeverage = leverageData?.availableCredit ?? leverageData?.availableAmount ?? 0;
  const availableCash = portfolio?.cash ?? 0;

  // 监控数量和价格字段，实现响应式 buyTotal, maxLeverage
  const quantity = Form.useWatch('quantity', form) as number | undefined;
  const price = Form.useWatch('price', form) as number | undefined;
  const buyTotal = (quantity ?? 0) * (price ?? 0);
  const maxLeverage = Math.min(availableLeverage, buyTotal);

  const onFinish = async (values: any) => {
    setIsSubmitting(true);
    // Remove calculations not needed for all types upfront
    // const amount = (values.quantity ?? 0) * (values.price ?? 0);
    // const commission = values.commission ?? 0;
    // const totalCost = amount + commission;
    const epsilon = 0.001;
    // const isFullLeverageIntent = values.type === TransactionType.BUY && leverageAmount >= totalCost - epsilon;

    // Construct transaction data based on type and form values
    const baseTransactionData: Partial<TransactionInput & { leverageUsed?: number }> = {
      date: values.date.toISOString(),
      type: values.type,
      note: values.note,
      // commission will be set specifically for BUY/SELL later
    };

    if (values.type === TransactionType.BUY || values.type === TransactionType.SELL) {
        const amount = (values.quantity ?? 0) * (values.price ?? 0);
        const commission = values.commission ?? 0;
        const totalCost = amount + commission;

        baseTransactionData.asset = {
          code: values.assetCode,
        };
        baseTransactionData.quantity = values.quantity;
        baseTransactionData.price = values.price;
        baseTransactionData.amount = amount; // For BUY/SELL, amount is quantity * price
        baseTransactionData.commission = commission;

        if (values.type === TransactionType.BUY) {
            const isFullLeverageIntent = leverageAmount >= totalCost - epsilon;
            if (isFullLeverageIntent) {
                baseTransactionData.leverageUsed = totalCost;
            } else if (leverageAmount > 0) {
                baseTransactionData.leverageUsed = leverageAmount;
            }
            // Validation for BUY
            const requiredFunding = totalCost - (baseTransactionData.leverageUsed ?? 0);
            if (requiredFunding > availableCash + availableLeverage + epsilon) {
                messageApi.error(`资金和融资额度都不足。需要 ${requiredFunding.toFixed(2)}，现金+融资可用 ${(availableCash + availableLeverage).toFixed(2)}。`);
                setIsSubmitting(false);
                return;
            }
        }
    } else if (values.type === TransactionType.DEPOSIT || values.type === TransactionType.WITHDRAW || values.type === TransactionType.DIVIDEND) {
        // For DEPOSIT, WITHDRAW, DIVIDEND, use the direct 'amount' field
        baseTransactionData.amount = values.amount;
        // For DIVIDEND, also include optional assetCode
        if (values.type === TransactionType.DIVIDEND && values.assetCode) {
            baseTransactionData.asset = {
              code: values.assetCode,
            };
        }
    }
    // else if (values.type === TransactionType.FEE)... handle other types if needed

    const transactionData = baseTransactionData as TransactionInput & { leverageUsed?: number };

    // Move BUY validation inside the BUY/SELL block
    /*
    if (values.type === TransactionType.BUY) {
       // ... validation moved above ...
    }
    */

    try {
      await addTransaction(portfolioId, transactionData);
      messageApi.success('交易记录添加成功！');
      form.resetFields();
      setSelectedType(null); // Reset selected type
      onSuccess?.(); // Call the success callback if provided
    } catch (error) {
      console.error('Failed to add transaction:', error);
      messageApi.error('添加交易记录失败，请重试。');
    } finally {
       setIsSubmitting(false);
    }
  };

  const onFinishFailed = (errorInfo: any) => {
    console.log('Failed:', errorInfo);
    messageApi.error('请正确填写所有必填项。');
  };

  const handleTypeChange = (value: TransactionType) => {
    setSelectedType(value);
    // Reset dependent fields when type changes to avoid carrying over invalid values
    form.setFieldsValue({
        assetCode: undefined,
        quantity: undefined,
        price: undefined,
        amount: undefined,
    });
  };

  // 无组合ID时提示
  if (!portfolioId) {
    return <Alert message="请先选择一个投资组合" type="warning" />;
  }
  // 组合详情加载中
  if (isLoadingDetail) {
    return <Spin tip="加载投资组合详情中..." />;
  }
  // 加载详情失败或无详情，但仅在fetch阶段报错时提示
  if (!portfolio && portfolioError) {
    return <Alert message="加载投资组合详情失败" description={portfolioError} type="error" />;
  }
  // 如果详情未加载完成，先不渲染表单
  if (!portfolio) {
    return null;
  }

  return (
    <>
      {contextHolder}
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        onFinishFailed={onFinishFailed}
        initialValues={{ date: dayjs() }} // Default date to today
      >
        <Form.Item
          name="type"
          label="交易类型"
          rules={[{ required: true, message: '请选择交易类型！' }]}
        >
          <Select placeholder="选择类型" onChange={handleTypeChange}>
            {[TransactionType.BUY, TransactionType.SELL, TransactionType.DEPOSIT, TransactionType.WITHDRAW, TransactionType.DIVIDEND].map((type) => (
              <Option key={type} value={type}>
                {TRANSACTION_TYPE_LABELS[type] || type}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="date"
          label="日期"
          rules={[{ required: true, message: '请选择日期！' }]}
        >
          <DatePicker showTime style={{ width: '100%' }}/>
        </Form.Item>

        {config.requiresAsset && (
            <Form.Item
              name="assetCode"
              label="资产代码"
              rules={[{ required: selectedType !== TransactionType.DIVIDEND, message: '请输入资产代码！' }]}
              help="例如: usAAPL, hk00700, sh600519"
            >
              <Input
                placeholder="输入资产代码"
                onChange={(e) => {
                  const value = e.target.value;
                  form.setFieldValue('asset', value ? { code: value } : undefined);
                }}
              />
            </Form.Item>
        )}

         {config.requiresQuantityPrice && (
            <Form.Item
              name="quantity"
              label="数量"
              rules={[{ required: config.requiresQuantityPrice, message: '请输入数量！' }]} // Required only for BUY/SELL
            >
              <InputNumber min={0} style={{ width: '100%' }} placeholder="股票/单位数量" />
            </Form.Item>
         )}

         {config.requiresQuantityPrice && ( // Show only for BUY/SELL
            <Form.Item
              name="price"
              label="单位价格"
              rules={[{ required: true, message: '请输入价格！' }]}
            >
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="每股/单位价格" />
            </Form.Item>
         )}

         {config.requiresAmount && ( // Show for DEPOSIT/WITHDRAW/FEE/DIVIDEND
            <Form.Item
              name="amount"
              label="金额"
              rules={[{ required: true, message: '请输入金额！' }]}
            >
              <InputNumber style={{ width: '100%' }} placeholder="总金额 (CNY)" />
            </Form.Item>
         )}

        {selectedType === TransactionType.BUY && (
          <Form.Item label="本次融资金额" help={`可用融资额度：${availableLeverage}，买入总额：${buyTotal}`}> 
            <Row gutter={8} align="middle">
              <Col flex="auto">
                <Slider
                  min={0}
                  max={maxLeverage}
                  step={100}
                  value={leverageAmount}
                  onChange={setLeverageAmount}
                  tooltip={{ formatter: (v) => `${v} 元` }}
                  disabled={maxLeverage <= 0}
                />
              </Col>
              <Col>
                <InputNumber
                  min={0}
                  max={maxLeverage}
                  step={100}
                  value={leverageAmount}
                  onChange={v => setLeverageAmount(Number(v) || 0)}
                  disabled={maxLeverage <= 0}
                  style={{ width: 120 }}
                />
              </Col>
            </Row>
            {maxLeverage <= 0 && <div style={{ color: '#f5222d', fontSize: 12 }}>请先输入买入数量和价格</div>}
            <div style={{ color: '#888', fontSize: 12 }}>剩余部分将自动用现金支付</div>
          </Form.Item>
        )}

        {([TransactionType.BUY, TransactionType.SELL].includes(selectedType as TransactionType)) && (
          <Form.Item
            name="commission"
            label="交易手续费"
            rules={[{ required: false, message: '请输入交易手续费！' }]}
          >
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="请输入手续费，单位：元" />
          </Form.Item>
        )}

        <Form.Item name="note" label="备注（可选）">
          <Input.TextArea rows={2} placeholder="添加相关备注" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isSubmitting} disabled={!portfolioId || !selectedType}>
            添加交易记录
          </Button>
        </Form.Item>
      </Form>
    </>
  );
};

export default AddTransactionForm;
