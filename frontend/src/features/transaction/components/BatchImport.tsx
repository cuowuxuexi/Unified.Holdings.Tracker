import React, { useState, useRef } from 'react';
import {
  Upload,
  Button,
  Table,
  Alert,
  message,
  Space,
  Typography,
  Tag,
  Divider,
} from 'antd';
import {
  UploadOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { API_BASE_URL } from '../../../config';
import apiClient from '../../../services/api';
import type { ImportPreview, ImportResult } from '../../../services/api';

const { Title, Text } = Typography;

interface BatchImportProps {
  portfolioId: string;
  onSuccess?: () => void;
}

/**
 * 批量导入组件
 * 版本: v1.1.0 - 修复文件引用丢失问题
 */
export const BatchImport: React.FC<BatchImportProps> = ({
  portfolioId,
  onSuccess,
}) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null); // 单独保存文件引用
  const fileRef = useRef<File | null>(null); // 使用ref保存文件，不受重新渲染影响
  const fileContentRef = useRef<Blob | null>(null); // 保存文件内容（Blob）
  const fileNameRef = useRef<string>(''); // 保存文件名
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // 下载模板
  const handleDownloadTemplate = (format: 'csv' | 'xlsx' = 'csv') => {
    const url = `${API_BASE_URL}/batch/template?format=${format}`;
    window.open(url, '_blank');
  };

  // 预览
  const handlePreview = async () => {
    // 多重方式获取文件
    const file = fileRef.current || currentFile || fileList[0]?.originFileObj;

    if (!file) {
      message.warning('请先选择文件（支持 CSV 或 XLSX 格式）');
      return;
    }

    console.log('[BatchImport] 预览使用文件:', file.name);

    // 保存文件内容和文件名，防止文件引用丢失
    try {
      const blob = await file.slice(0, file.size).arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase();
      const mimeType =
        ext === 'xlsx' || ext === 'xls'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv';
      fileContentRef.current = new Blob([blob], { type: mimeType });
      fileNameRef.current = file.name;
      console.log(
        '[BatchImport] 文件内容已保存到Blob:',
        fileNameRef.current,
        blob.byteLength,
        'bytes'
      );
    } catch (e) {
      console.error('[BatchImport] 保存文件内容失败:', e);
    }

    const formData = new FormData();
    formData.append('file', file);

    setPreviewing(true);
    try {
      const data = await apiClient.previewBatchImport(formData);
      setPreview(data);
      setResult(null); // 清空之前的结果

      if (data.summary.invalidRows > 0) {
        message.warning(
          `发现 ${data.summary.invalidRows} 行数据有误，请修正后再导入`
        );
      } else {
        message.success('数据验证通过！');
      }
    } catch (error) {
      message.error('预览失败，请检查网络连接');
      console.error('Preview error:', error);
    } finally {
      setPreviewing(false);
    }
  };

  // 导入
  const handleImport = async () => {
    console.log('[BatchImport] 开始导入检查');
    console.log('[BatchImport] preview:', preview);

    if (!preview || preview.summary.invalidRows > 0) {
      message.error('请先预览并确保所有数据验证通过');
      return;
    }

    // 优先使用保存的文件内容（Blob），如果文件引用都丢失了
    let fileToUpload: File | Blob | null = null;

    // 方案1: 尝试从各种来源获取原始文件
    fileToUpload = fileRef.current || fileList[0]?.originFileObj || currentFile;

    // 方案2: 如果文件引用都丢失了，使用保存的Blob创建新File对象
    if (!fileToUpload && fileContentRef.current && fileNameRef.current) {
      console.log('[BatchImport] 文件引用丢失，使用保存的Blob创建新File对象');
      fileToUpload = new File([fileContentRef.current], fileNameRef.current, {
        type: 'text/csv',
      });
    }

    console.log('[BatchImport] 获取文件 - fileRef:', fileRef.current);
    console.log(
      '[BatchImport] 获取文件 - originFileObj:',
      fileList[0]?.originFileObj
    );
    console.log('[BatchImport] 获取文件 - currentFile:', currentFile);
    console.log('[BatchImport] 获取文件 - Blob:', fileContentRef.current);
    console.log('[BatchImport] 最终使用文件:', fileToUpload);

    if (!fileToUpload) {
      console.error('[BatchImport] 无法获取文件！所有来源都是空的');
      message.error('无法获取文件，请重新选择文件并预览');
      return;
    }

    console.log('[BatchImport] 准备弹出确认对话框');

    // 使用原生confirm对话框（避免Modal context问题）
    const confirmed = window.confirm(
      `确认导入\n\n将导入 ${preview.summary.validRows} 条交易记录到当前投资组合，是否继续？`
    );

    if (confirmed) {
      console.log('[BatchImport] 用户确认导入，准备发送请求');
      const formData = new FormData();
      formData.append('file', fileToUpload!);

      setImporting(true);
      try {
        const data = await apiClient.executeBatchImport(portfolioId, formData);

        setResult(data);

        if (data.errorCount > 0) {
          message.warning(
            `部分导入成功：成功 ${data.successCount} 条，失败 ${data.errorCount} 条`
          );
        } else {
          message.success(`成功导入 ${data.successCount} 条交易记录`);
        }

        // 刷新数据
        if (onSuccess) {
          onSuccess();
        }

        // 清空文件列表和预览
        setTimeout(() => {
          setFileList([]);
          setPreview(null);
        }, 3000);
      } catch (error) {
        message.error('导入失败，请检查网络连接');
        console.error('Import error:', error);
      } finally {
        setImporting(false);
      }
    }
  };

  // 错误列表列配置
  const errorColumns = [
    {
      title: '行号',
      dataIndex: 'rowNumber',
      key: 'rowNumber',
      width: 80,
    },
    {
      title: '字段',
      dataIndex: 'field',
      key: 'field',
      width: 100,
    },
    {
      title: '错误信息',
      dataIndex: 'message',
      key: 'message',
    },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      width: 120,
      render: (value: unknown) => (value !== undefined ? String(value) : '-'),
    },
  ];

  // 数据预览列配置
  const previewColumns = [
    {
      title: '行号',
      dataIndex: 'rowNumber',
      key: 'rowNumber',
      width: 70,
    },
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 100,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => {
        const colors: Record<string, string> = {
          BUY: 'red',
          SELL: 'green',
          DEPOSIT: 'blue',
          WITHDRAW: 'orange',
          DIVIDEND: 'purple',
          LEVERAGE_ADD: 'cyan',
          LEVERAGE_REMOVE: 'magenta',
          LEVERAGE_COST: 'gold',
        };
        return <Tag color={colors[type] || 'default'}>{type}</Tag>;
      },
    },
    {
      title: '资产代码',
      dataIndex: 'assetCode',
      key: 'assetCode',
      width: 120,
      render: (code: string) => code || '-',
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right' as const,
      render: (qty: number) => (qty ? qty.toLocaleString() : '-'),
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 100,
      align: 'right' as const,
      render: (price: number) => (price ? price.toFixed(2) : '-'),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      align: 'right' as const,
      render: (amount: number) => (amount ? amount.toFixed(2) : '-'),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      ellipsis: true,
      render: (notes: string) => notes || '-',
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Title level={4}>批量导入交易记录</Title>

      <Alert
        message="使用说明"
        description={
          <div>
            <p>1. 点击"下载模板"获取标准格式文件（支持 CSV 或 XLSX）</p>
            <p>2. 填写交易数据后，上传文件（支持 CSV 或 XLSX）</p>
            <p>3. 点击"预览"检查数据是否正确</p>
            <p>4. 确认无误后，点击"确认导入"</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Space style={{ marginBottom: 16 }}>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => handleDownloadTemplate('csv')}
          size="large"
        >
          下载 CSV 模板
        </Button>

        <Button
          icon={<DownloadOutlined />}
          onClick={() => handleDownloadTemplate('xlsx')}
          size="large"
          type="dashed"
        >
          下载 XLSX 模板
        </Button>

        <Upload
          beforeUpload={(file) => {
            // 检查文件类型
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
              message.error('只支持 CSV 或 XLSX 格式文件');
              return false;
            }
            // 三重保存文件引用（确保不丢失）
            fileRef.current = file; // ref保存（最可靠）
            setCurrentFile(file); // state保存
            // 正确构造UploadFile对象，保留originFileObj
            const uploadFile: UploadFile = {
              uid: file.uid || `-${Date.now()}`,
              name: file.name,
              status: 'done',
              originFileObj: file, // Upload组件保存
            };
            setFileList([uploadFile]);
            setPreview(null);
            setResult(null);
            console.log('[BatchImport] 文件已保存到三个位置:', file.name);
            return false; // 阻止自动上传
          }}
          fileList={fileList}
          onRemove={() => {
            fileRef.current = null; // 清空ref
            fileContentRef.current = null; // 清空Blob
            fileNameRef.current = ''; // 清空文件名
            setCurrentFile(null);
            setFileList([]);
            setPreview(null);
            setResult(null);
          }}
          maxCount={1}
          accept=".csv,.xlsx,.xls"
        >
          <Button icon={<UploadOutlined />} size="large">
            选择文件（CSV 或 XLSX）
          </Button>
        </Upload>

        {fileList.length > 0 && (
          <>
            <Button
              type="primary"
              onClick={handlePreview}
              loading={previewing}
              size="large"
            >
              预览
            </Button>

            {preview && preview.summary.invalidRows === 0 && (
              <Button
                type="primary"
                onClick={handleImport}
                loading={importing}
                danger
                size="large"
                icon={<CheckCircleOutlined />}
              >
                确认导入
              </Button>
            )}
          </>
        )}
      </Space>

      {/* 预览结果 */}
      {preview && (
        <>
          <Divider />
          <Alert
            message="预览结果"
            description={
              <div>
                <Text strong>共 {preview.summary.totalRows} 行</Text>，
                <Text strong style={{ color: '#52c41a' }}>
                  有效 {preview.summary.validRows} 行
                </Text>
                ，
                <Text strong style={{ color: '#ff4d4f' }}>
                  无效 {preview.summary.invalidRows} 行
                </Text>
                {Object.keys(preview.summary.byType).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {Object.entries(preview.summary.byType).map(
                      ([type, count]) => (
                        <Tag key={type} style={{ marginTop: 4 }}>
                          {type}: {count}
                        </Tag>
                      )
                    )}
                  </div>
                )}
              </div>
            }
            type={preview.summary.invalidRows > 0 ? 'warning' : 'success'}
            showIcon
            style={{ marginBottom: 16 }}
          />

          {/* 错误列表 */}
          {preview.validationErrors.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title level={5}>验证错误</Title>
              <Table
                dataSource={preview.validationErrors}
                columns={errorColumns}
                rowKey={(record, index) => `${record.rowNumber}-${index}`}
                pagination={{ pageSize: 5 }}
                size="small"
                bordered
              />
            </div>
          )}

          {/* 数据预览 */}
          <Title level={5}>数据预览</Title>
          <Table
            dataSource={preview.rows}
            columns={previewColumns}
            rowKey="rowNumber"
            pagination={{ pageSize: 10 }}
            size="small"
            bordered
            scroll={{ x: 1200 }}
          />
        </>
      )}

      {/* 导入结果 */}
      {result && (
        <>
          <Divider />
          <Alert
            message="导入结果"
            description={
              <div>
                <Text strong style={{ color: '#52c41a' }}>
                  成功 {result.successCount} 条
                </Text>
                ，
                <Text strong style={{ color: '#ff4d4f' }}>
                  失败 {result.errorCount} 条
                </Text>
              </div>
            }
            type={result.errorCount > 0 ? 'warning' : 'success'}
            showIcon
            style={{ marginTop: 16 }}
          />

          {result.errors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Title level={5}>导入错误详情</Title>
              <Table
                dataSource={result.errors}
                columns={errorColumns}
                rowKey={(record, index) => `${record.rowNumber}-${index}`}
                pagination={{ pageSize: 5 }}
                size="small"
                bordered
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
