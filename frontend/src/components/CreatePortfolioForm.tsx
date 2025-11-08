import React, { useState } from 'react';
import { Form, Input, InputNumber, Button, message, Checkbox } from 'antd';
import useAppStore from '../store'; // Adjust path if needed
import { PortfolioInput } from '../store/types'; // Adjust path if needed

interface CreatePortfolioFormProps {
  onSuccess?: () => void; // Optional callback after successful submission
}

const CreatePortfolioForm: React.FC<CreatePortfolioFormProps> = ({ onSuccess }) => {
  const [form] = Form.useForm();
  const createPortfolio = useAppStore((state) => state.createPortfolio);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [leverageEnabled, setLeverageEnabled] = useState(false);

  const onFinish = async (values: any) => {
    setIsSubmitting(true);
    const portfolioData: PortfolioInput = {
      name: values.name,
      cash: values.cash,
      leverageInfo: leverageEnabled
        ? {
            totalCredit: values.totalCredit,
            usedCredit: 0, // Initial used credit is 0
            availableCredit: values.totalCredit, // Initial available is total
            interestRate: values.interestRate / 100, // Convert percentage to decimal
          }
        : undefined, // Set to undefined if leverage is not enabled
    };

    try {
      await createPortfolio(portfolioData);
      message.success(`投资组合 "${portfolioData.name}" 创建成功！`);
      form.resetFields();
      setLeverageEnabled(false); // Reset checkbox state
      onSuccess?.(); // Call the success callback if provided
    } catch (error) {
      console.error('Failed to create portfolio:', error);
      message.error('创建投资组合失败，请重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onFinishFailed = (errorInfo: any) => {
    console.log('Failed:', errorInfo);
    message.error('请正确填写所有必填项。');
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={onFinish}
      onFinishFailed={onFinishFailed}
      initialValues={{ cash: 100000, enableLeverage: false }} // Default values
    >
      <Form.Item
        name="name"
        label="投资组合名称"
        rules={[{ required: true, message: '请输入投资组合名称！' }]}
      >
        <Input placeholder="例如：我的成长股" />
      </Form.Item>

      <Form.Item
        name="cash"
        label="初始现金余额"
        rules={[
          { required: true, message: '请输入初始现金！' },
          { type: 'number', min: 0, max: 100000000, message: '初始现金必须为0~1亿之间的数字' }
        ]}
      >
        <InputNumber min={0} max={100000000} style={{ width: '100%' }} placeholder="初始现金金额" />
      </Form.Item>

      <Form.Item name="enableLeverage" valuePropName="checked">
         <Checkbox onChange={(e) => setLeverageEnabled(e.target.checked)}>启用杠杆</Checkbox>
      </Form.Item>

      {leverageEnabled && (
        <>
          <Form.Item
            name="totalCredit"
            label="总信用额度"
            rules={[{ required: true, message: '请输入总信用额度！' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="总杠杆金额" />
          </Form.Item>
          <Form.Item
            name="interestRate"
            label="年利率 (%)"
            rules={[{ required: true, message: '请输入年利率！' }]}
          >
            <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} placeholder="例如：5.5 表示 5.5%" />
          </Form.Item>
        </>
      )}


      <Form.Item>
        <Button type="primary" htmlType="submit" loading={isSubmitting}>
          创建投资组合
        </Button>
      </Form.Item>
    </Form>
  );
};

export default CreatePortfolioForm;