import { Form, Input, InputNumber, Button, message } from 'antd';
import { useCreatePortfolio } from '../../../shared/hooks/usePortfolios';

interface CreatePortfolioFormProps {
  onSuccess: () => void;
}

export function CreatePortfolioForm({ onSuccess }: CreatePortfolioFormProps) {
  const [form] = Form.useForm();
  const createPortfolio = useCreatePortfolio();

  const handleSubmit = async (values: {
    name: string;
    cash: number;
    totalCredit?: number;
    interestRate?: number;
  }) => {
    try {
      await createPortfolio.mutateAsync({
        name: values.name,
        cash: values.cash,
        leverageInfo:
          values.totalCredit && values.interestRate
            ? {
                totalCredit: values.totalCredit,
                usedCredit: 0, // 初始已用额度为 0
                availableCredit: values.totalCredit, // 初始可用额度等于总额度
                // 将百分比转换为小数（5% -> 0.05）
                interestRate: values.interestRate / 100,
              }
            : undefined,
      });
      message.success('投资组合创建成功！');
      form.resetFields();
      onSuccess();
    } catch (error) {
      message.error('创建失败，请重试');
      console.error('Create portfolio error:', error);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{ cash: 0, totalCredit: 0, interestRate: 0 }}
    >
      <Form.Item
        label="组合名称"
        name="name"
        rules={[{ required: true, message: '请输入组合名称' }]}
      >
        <Input placeholder="例如：2024年投资组合" />
      </Form.Item>

      <Form.Item
        label="初始现金"
        name="cash"
        rules={[{ required: true, message: '请输入初始现金' }]}
      >
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          precision={2}
          placeholder="0.00"
        />
      </Form.Item>

      <Form.Item label="融资额度（可选）" name="totalCredit">
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          precision={2}
          placeholder="0.00"
        />
      </Form.Item>

      <Form.Item label="融资利率（可选）" name="interestRate">
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          max={100}
          precision={2}
          placeholder="0.00"
          addonAfter="%"
        />
      </Form.Item>

      <Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={createPortfolio.isPending}
          block
        >
          创建
        </Button>
      </Form.Item>
    </Form>
  );
}
