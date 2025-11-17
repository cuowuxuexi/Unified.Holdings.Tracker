import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select } from 'antd';
import { AttentionItem } from '../store/types';

const { TextArea } = Input;

interface AttentionFormModalProps {
  visible: boolean;
  editingItem?: AttentionItem | null;
  onSave: (item: Omit<AttentionItem, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}

// 常用图标选项
const ICON_OPTIONS = [
  { value: '💰', label: '💰 股息/资金' },
  { value: '📊', label: '📊 财报/数据' },
  { value: '⚠️', label: '⚠️ 风险提醒' },
  { value: '📅', label: '📅 日程/时间' },
  { value: '📈', label: '📈 趋势/机会' },
  { value: '🔔', label: '🔔 通知/提醒' },
  { value: '📝', label: '📝 备忘/记录' },
  { value: '🎯', label: '🎯 目标/计划' },
];

export const AttentionFormModal: React.FC<AttentionFormModalProps> = ({
  visible,
  editingItem,
  onSave,
  onCancel,
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (visible) {
      if (editingItem) {
        form.setFieldsValue({
          icon: editingItem.icon,
          title: editingItem.title,
          content: editingItem.content,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ icon: '📝' }); // 默认图标
      }
    }
  }, [visible, editingItem, form]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      onSave({
        icon: values.icon,
        title: values.title,
        content: values.content,
        updatedAt: new Date().toISOString(),
      });
      form.resetFields();
    });
  };

  return (
    <Modal
      title={editingItem ? '编辑注意事项' : '添加注意事项'}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={500}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="icon"
          label="图标"
          rules={[{ required: true, message: '请选择图标' }]}
        >
          <Select options={ICON_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="title"
          label="标题"
          rules={[
            { required: true, message: '请输入标题' },
            { max: 20, message: '标题最多20个字符' },
          ]}
        >
          <Input placeholder="例如：股息发放" />
        </Form.Item>
        <Form.Item
          name="content"
          label="内容"
          rules={[
            { required: true, message: '请输入内容' },
            { max: 200, message: '内容最多200个字符' },
          ]}
        >
          <TextArea
            placeholder="请输入详细内容..."
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
