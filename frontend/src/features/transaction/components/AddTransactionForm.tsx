import {
  Form,
  Select,
  InputNumber,
  DatePicker,
  Input,
  Button,
  message,
  Alert,
} from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useAddTransaction } from '../../../shared/hooks/useTransactions';
import type { TransactionInput } from '../../../generated/api';

const { Option } = Select;
const { TextArea } = Input;

interface AddTransactionFormProps {
  portfolioId: string;
  onSuccess: () => void;
}

type TransactionFormValues = Omit<TransactionInput, 'date'> & {
  date: Dayjs;
};

export function AddTransactionForm({
  portfolioId,
  onSuccess,
}: AddTransactionFormProps) {
  const [form] = Form.useForm();
  const addTransaction = useAddTransaction();

  const transactionType = Form.useWatch('type', form);

  const handleSubmit = async (values: TransactionFormValues) => {
    try {
      await addTransaction.mutateAsync({
        portfolioId,
        transaction: {
          ...values,
          date: values.date.toISOString(),
        },
      });
      message.success('交易记录添加成功！');
      form.resetFields();
      onSuccess();
    } catch (error) {
      message.error('添加失败，请重试');
      console.error('Add transaction error:', error);
    }
  };

  const needsAssetCode = ['BUY', 'SELL', 'DIVIDEND'].includes(transactionType);
  const needsQuantity = ['BUY', 'SELL'].includes(transactionType);
  const needsPrice = ['BUY', 'SELL'].includes(transactionType);
  const needsAmount = [
    'DEPOSIT',
    'WITHDRAW',
    'DIVIDEND',
    'LEVERAGE_ADD',
    'LEVERAGE_REMOVE',
    'LEVERAGE_COST',
  ].includes(transactionType);

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{
        date: dayjs(),
        type: 'BUY',
        commission: 0,
        leverageUsed: 0,
      }}
    >
      <Form.Item
        label="交易日期"
        name="date"
        rules={[{ required: true, message: '请选择交易日期' }]}
      >
        <DatePicker style={{ width: '100%' }} showTime />
      </Form.Item>

      <Form.Item
        label="交易类型"
        name="type"
        rules={[{ required: true, message: '请选择交易类型' }]}
      >
        <Select>
          <Option value="BUY">买入</Option>
          <Option value="SELL">卖出</Option>
          <Option value="DEPOSIT">入金</Option>
          <Option value="WITHDRAW">出金</Option>
          <Option value="DIVIDEND">分红</Option>
          <Option value="LEVERAGE_ADD">融资</Option>
          <Option value="LEVERAGE_REMOVE">还款</Option>
          <Option value="LEVERAGE_COST">融资成本</Option>
        </Select>
      </Form.Item>

      {transactionType === 'LEVERAGE_ADD' && (
        <Alert
          message="融资利率说明"
          description="融资利率将使用投资组合中设置的固定利率。请确保在创建投资组合时已配置融资利率，否则融资成本计算将为0。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {needsAssetCode && (
        <Form.Item
          label="资产代码"
          name="assetCode"
          rules={[{ required: true, message: '请输入资产代码' }]}
        >
          <Input placeholder="例如：sh600519" />
        </Form.Item>
      )}

      {needsQuantity && (
        <Form.Item
          label="数量"
          name="quantity"
          rules={[{ required: true, message: '请输入数量' }]}
        >
          <InputNumber style={{ width: '100%' }} min={0} precision={0} />
        </Form.Item>
      )}

      {needsPrice && (
        <Form.Item
          label="价格"
          name="price"
          rules={[{ required: true, message: '请输入价格' }]}
        >
          <InputNumber style={{ width: '100%' }} min={0} precision={2} />
        </Form.Item>
      )}

      {needsAmount && (
        <Form.Item
          label="金额"
          name="amount"
          rules={[{ required: true, message: '请输入金额' }]}
        >
          <InputNumber style={{ width: '100%' }} min={0} precision={2} />
        </Form.Item>
      )}

      <Form.Item label="手续费" name="commission">
        <InputNumber style={{ width: '100%' }} min={0} precision={2} />
      </Form.Item>

      {['BUY', 'SELL'].includes(transactionType) && (
        <Form.Item label="使用融资" name="leverageUsed">
          <InputNumber style={{ width: '100%' }} min={0} precision={2} />
        </Form.Item>
      )}

      <Form.Item label="备注" name="notes">
        <TextArea rows={3} placeholder="可选" />
      </Form.Item>

      <Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={addTransaction.isPending}
          block
        >
          添加
        </Button>
      </Form.Item>
    </Form>
  );
}
