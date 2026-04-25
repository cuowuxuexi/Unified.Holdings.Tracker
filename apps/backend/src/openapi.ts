import { OpenAPIV3 } from 'openapi-types';

type UhtOpenApiDocument = OpenAPIV3.Document & {
  'x-uht-planned-readonly-contracts'?: Record<string, unknown>;
};

export const openApiDocument: UhtOpenApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Unified Holdings Tracker API',
    version: '1.0.0',
    description: '统一持仓追踪后端服务 API 文档',
    contact: {
      name: 'API Support',
    },
  },
  servers: [
    {
      url: 'http://localhost:3001/api',
      description: '本地开发服务器',
    },
  ],
  tags: [
    { name: 'Health', description: '健康检查' },
    { name: 'Portfolio', description: '投资组合管理' },
    { name: 'Transaction', description: '交易记录管理' },
    { name: 'Market', description: '市场数据' },
    { name: 'Currency', description: '汇率服务' },
    { name: 'Freshness', description: '数据新鲜度契约（预留）' },
    { name: 'Source', description: '数据源健康契约（预留）' },
  ],
  'x-uht-planned-readonly-contracts': {
    '/portfolio/{id}/data-freshness': {
      status: 'reserved',
      envelope: '#/components/schemas/DataFreshnessEnvelope',
      note: 'Reserved for M2/M3-backed freshness implementation; not a production route in M1.',
    },
    '/source-health': {
      status: 'reserved',
      envelope: '#/components/schemas/SourceHealthEnvelope',
      note: 'Reserved for Source Gateway health implementation; not a production route in M1.',
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: '健康检查',
        description: '检查服务状态和数据库连接',
        responses: {
          '200': {
            description: '服务正常',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                    uptime: { type: 'number' },
                    checks: {
                      type: 'object',
                      properties: {
                        database: { type: 'string', example: 'up' },
                      },
                    },
                  },
                },
              },
            },
          },
          '503': {
            description: '部分依赖异常',
          },
        },
      },
    },
    '/portfolio': {
      get: {
        tags: ['Portfolio'],
        summary: '获取投资组合列表',
        description: '返回所有投资组合的基本信息',
        responses: {
          '200': {
            description: '成功返回组合列表',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      cash: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Portfolio'],
        summary: '创建投资组合',
        description: '创建新的投资组合',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'cash'],
                properties: {
                  name: { type: 'string', description: '组合名称' },
                  cash: { type: 'number', description: '初始现金' },
                  leverageInfo: {
                    type: 'object',
                    properties: {
                      totalCredit: {
                        type: 'number',
                        description: '融资总额度',
                      },
                      interestRate: { type: 'number', description: '利率' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: '创建成功',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Portfolio' },
              },
            },
          },
          '400': {
            description: '请求参数错误',
          },
        },
      },
    },
    '/portfolio/exchange-rates': {
      get: {
        tags: ['Currency'],
        summary: '获取汇率',
        description: '获取主要货币对人民币的实时汇率',
        parameters: [
          {
            name: 'envelope',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description:
              'true 时返回工具型 response envelope；默认返回旧结构。',
          },
        ],
        responses: {
          '200': {
            description: '成功返回汇率',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/ExchangeRates' },
                    { $ref: '#/components/schemas/ExchangeRatesEnvelope' },
                  ],
                },
              },
            },
          },
          '503': {
            description: '汇率服务不可用',
          },
        },
      },
    },
    '/portfolio/{id}': {
      get: {
        tags: ['Portfolio'],
        summary: '获取投资组合详情',
        description: '获取指定投资组合的详细信息',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '成功返回组合详情',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PortfolioDetail' },
              },
            },
          },
          '404': {
            description: '组合不存在',
          },
        },
      },
      delete: {
        tags: ['Portfolio'],
        summary: '删除投资组合',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': {
            description: '删除成功',
          },
          '404': {
            description: '组合不存在',
          },
        },
      },
    },
    '/portfolio/{id}/transactions': {
      get: {
        tags: ['Transaction'],
        summary: '获取交易记录',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '成功返回交易列表',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Transaction' },
                },
              },
            },
          },
          '404': {
            description: '组合不存在',
          },
        },
      },
      post: {
        tags: ['Transaction'],
        summary: '添加交易记录',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TransactionInput' },
            },
          },
        },
        responses: {
          '201': {
            description: '添加成功',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Transaction' },
              },
            },
          },
          '400': {
            description: '请求参数错误',
          },
          '404': {
            description: '组合不存在',
          },
        },
      },
    },
    '/portfolio/{id}/transactions/{txId}': {
      delete: {
        tags: ['Transaction'],
        summary: '删除交易记录',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'txId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': {
            description: '删除成功',
          },
          '404': {
            description: '组合或交易不存在',
          },
        },
      },
    },
    '/portfolio/{id}/stats': {
      get: {
        tags: ['Portfolio'],
        summary: '获取投资组合统计信息',
        description: '获取组合的详细统计数据，包括持仓、盈亏等',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'period',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['total', 'daily', 'weekly', 'monthly', 'yearly'],
            },
          },
          {
            name: 'startDate',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'endDate',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
        ],
        responses: {
          '200': {
            description: '成功返回统计信息',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PortfolioStats' },
              },
            },
          },
          '404': {
            description: '组合不存在',
          },
        },
      },
    },
    '/portfolio/{id}/period-report': {
      get: {
        tags: ['Portfolio'],
        summary: '生成期间报告',
        description:
          '根据指定的起止日期或周期，生成投资组合的期间概览和详细报表数据。',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'from',
            in: 'query',
            description: '起始日期 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'to',
            in: 'query',
            description: '结束日期 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'period',
            in: 'query',
            description:
              '快捷周期选择。如果提供了此参数，可以省略 from 和 to。',
            schema: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly', 'yearly'],
            },
          },
          {
            name: 'format',
            in: 'query',
            description: '输出格式，支持 json 和 markdown',
            schema: { type: 'string', enum: ['json', 'markdown'] },
          },
          {
            name: 'envelope',
            in: 'query',
            description:
              'true 时返回工具型 response envelope；不能与 format=markdown 同用。',
            schema: { type: 'boolean', default: false },
          },
        ],
        responses: {
          '200': {
            description: '成功返回报告内容',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { type: 'object', additionalProperties: true },
                    { $ref: '#/components/schemas/PeriodReportEnvelope' },
                  ],
                },
              },
              'text/markdown': {
                schema: { type: 'string' },
              },
            },
          },
          '400': {
            description: '缺少必要的日期或周期参数',
          },
          '404': {
            description: '组合未找到',
          },
        },
      },
    },
    '/portfolio/period-report': {
      get: {
        tags: ['Portfolio'],
        summary: '生成期间报告 (兼容模式)',
        description:
          '根据指定的起止日期或周期，自动探测或通过 query 参数生成投资组合的报表。如果存在多个投资组合，则必须在 query 中指定 portfolioId',
        parameters: [
          {
            name: 'from',
            in: 'query',
            description: '起始日期 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'to',
            in: 'query',
            description: '结束日期 (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'period',
            in: 'query',
            description: '快捷周期选择',
            schema: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly', 'yearly'],
            },
          },
          {
            name: 'format',
            in: 'query',
            description: '输出格式，支持 json 和 markdown',
            schema: { type: 'string', enum: ['json', 'markdown'] },
          },
          {
            name: 'envelope',
            in: 'query',
            description:
              'true 时返回工具型 response envelope；不能与 format=markdown 同用。',
            schema: { type: 'boolean', default: false },
          },
          {
            name: 'portfolioId',
            in: 'query',
            description: '显式指定组合 ID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '成功返回报告内容',
            headers: {
              'X-UHT-Resolved-Portfolio-Id': {
                schema: { type: 'string', format: 'uuid' },
                description: '自动解析使用的组合 ID',
              },
            },
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { type: 'object', additionalProperties: true },
                    { $ref: '#/components/schemas/PeriodReportEnvelope' },
                  ],
                },
              },
              'text/markdown': {
                schema: { type: 'string' },
              },
            },
          },
          '400': {
            description: '需要指定组合或缺少日期参数',
          },
          '404': {
            description: '没有任何组合',
          },
        },
      },
    },
    '/portfolio/{id}/cash-recalc': {
      get: {
        tags: ['Portfolio'],
        summary: '现金重算校验',
        description: '重新计算组合的现金余额并返回差异',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: '返回重算结果',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    portfolioId: { type: 'string' },
                    name: { type: 'string' },
                    currentCash: { type: 'number' },
                    recalculatedCash: { type: 'number' },
                    diff: { type: 'number' },
                    steps: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          '404': {
            description: '组合不存在',
          },
        },
      },
    },
    '/portfolio/{id}/snapshot-data': {
      get: {
        tags: ['Portfolio'],
        summary: '读取指定日期组合完整快照',
        description:
          '只读快照端点。默认保持旧结构；传 envelope=true 时返回 data/meta/warnings/errors envelope。',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
            description: '真实日历日期，格式 YYYY-MM-DD。',
          },
          {
            name: 'envelope',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'true 时返回工具型 response envelope。',
          },
        ],
        responses: {
          '200': {
            description: '成功返回快照数据',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/SnapshotData' },
                    { $ref: '#/components/schemas/SnapshotDataEnvelope' },
                  ],
                },
              },
            },
          },
          '400': {
            description: '日期缺失或不是实际日历日期',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '404': {
            description: '该组合该日期无快照',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
        },
      },
    },
    '/market/quote': {
      get: {
        tags: ['Market'],
        summary: '获取行情数据',
        parameters: [
          {
            name: 'codes',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: '资产代码列表，逗号分隔',
            example: 'sh600519,hk00700',
          },
          {
            name: 'envelope',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description:
              'true 时返回包含 requested/found/missing/invalid 的工具型 envelope；默认返回旧数组。',
          },
        ],
        responses: {
          '200': {
            description: '成功返回行情数据',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Quote' },
                    },
                    { $ref: '#/components/schemas/QuoteDiagnosticsEnvelope' },
                  ],
                },
              },
            },
          },
          '400': {
            description: '缺少必需参数',
          },
        },
      },
    },
    '/market/kline': {
      get: {
        tags: ['Market'],
        summary: '获取K线数据',
        parameters: [
          {
            name: 'code',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            example: 'sh600519',
          },
          {
            name: 'period',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly', 'yearly'],
            },
          },
          {
            name: 'startDate',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'endDate',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'fq',
            in: 'query',
            schema: { type: 'string', enum: ['qfq', 'hfq', 'none'] },
          },
          {
            name: 'count',
            in: 'query',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 400,
            },
          },
          {
            name: 'envelope',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description:
              'true 时返回包含 requested/found/missing/invalid 的工具型 envelope；默认返回旧数组。',
          },
        ],
        responses: {
          '200': {
            description: '成功返回K线数据',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'array',
                      items: { $ref: '#/components/schemas/KlinePoint' },
                    },
                    { $ref: '#/components/schemas/KlineDiagnosticsEnvelope' },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Portfolio: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          cash: { type: 'number' },
          initialCash: { type: 'number' },
          leverage: { $ref: '#/components/schemas/LeverageInfo' },
          transactions: {
            type: 'array',
            items: { $ref: '#/components/schemas/Transaction' },
          },
        },
      },
      PortfolioDetail: {
        allOf: [
          { $ref: '#/components/schemas/Portfolio' },
          {
            type: 'object',
            properties: {
              positions: {
                type: 'array',
                items: { $ref: '#/components/schemas/Position' },
              },
              totalMarketValue: { type: 'number' },
              totalAssets: { type: 'number' },
              netAssets: { type: 'number' },
              netDepositedCash: { type: 'number' },
              totalCommission: { type: 'number' },
              leverageCost: { type: 'number' },
              dailyPnl: { type: 'number' },
              totalPnl: { type: 'number' },
            },
          },
        ],
      },
      PortfolioStats: {
        type: 'object',
        properties: {
          portfolioId: { type: 'string' },
          name: { type: 'string' },
          cash: { type: 'number' },
          leverage: { $ref: '#/components/schemas/LeverageInfo' },
          totalMarketValue: { type: 'number' },
          totalAssets: { type: 'number' },
          netAssets: { type: 'number' },
          netDepositedCash: { type: 'number' },
          totalCommission: { type: 'number' },
          leverageCost: { type: 'number' },
          totalDividendIncome: { type: 'number' },
          dailyPnl: { type: 'number' },
          totalPnl: { type: 'number' },
          periodReturnPercent: { type: 'number', nullable: true },
          weeklyStats: { type: 'object' },
          monthlyStats: { type: 'object' },
          yearlyStats: { type: 'object' },
          positions: {
            type: 'array',
            items: { $ref: '#/components/schemas/Position' },
          },
          timestamp: { type: 'number' },
        },
      },
      Transaction: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          date: { type: 'string', format: 'date-time' },
          type: {
            type: 'string',
            enum: [
              'BUY',
              'SELL',
              'DEPOSIT',
              'WITHDRAW',
              'DIVIDEND',
              'LEVERAGE_ADD',
              'LEVERAGE_REMOVE',
              'LEVERAGE_COST',
            ],
          },
          assetCode: { type: 'string', nullable: true },
          quantity: { type: 'number', nullable: true },
          price: { type: 'number', nullable: true },
          amount: { type: 'number', nullable: true },
          commission: { type: 'number', nullable: true },
          leverageUsed: { type: 'number', nullable: true },
          notes: { type: 'string', nullable: true },
        },
      },
      TransactionInput: {
        type: 'object',
        required: ['type', 'date'],
        properties: {
          date: { type: 'string', format: 'date-time' },
          type: {
            type: 'string',
            enum: [
              'BUY',
              'SELL',
              'DEPOSIT',
              'WITHDRAW',
              'DIVIDEND',
              'LEVERAGE_ADD',
              'LEVERAGE_REMOVE',
              'LEVERAGE_COST',
            ],
          },
          assetCode: { type: 'string' },
          quantity: { type: 'number' },
          price: { type: 'number' },
          amount: { type: 'number' },
          commission: { type: 'number' },
          leverageUsed: { type: 'number' },
          notes: { type: 'string' },
        },
      },
      LeverageInfo: {
        type: 'object',
        properties: {
          totalAmount: { type: 'number' },
          usedAmount: { type: 'number' },
          availableAmount: { type: 'number' },
          costRate: { type: 'number' },
        },
      },
      Position: {
        type: 'object',
        properties: {
          asset: { $ref: '#/components/schemas/Asset' },
          quantity: { type: 'number' },
          costPrice: { type: 'number' },
          costPriceLocal: { type: 'number' },
          totalCost: { type: 'number' },
          totalCostLocal: { type: 'number' },
          currency: { type: 'string' },
          marketValue: { type: 'number' },
          marketValueLocal: { type: 'number' },
          marketValueCNY: { type: 'number' },
          currentPrice: { type: 'number' },
          dailyChange: { type: 'number' },
          dailyChangeLocal: { type: 'number' },
          totalPnl: { type: 'number' },
          totalPnlLocal: { type: 'number' },
        },
      },
      Asset: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          market: { type: 'string', enum: ['CN', 'HK', 'US'] },
        },
      },
      ApiWarning: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
      ApiError: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
      ResponseMeta: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          generated_at: { type: 'string', format: 'date-time' },
          requested_date: { type: 'string', format: 'date', nullable: true },
          resolved_date: { type: 'string', format: 'date', nullable: true },
          latest_available_date: {
            type: 'string',
            format: 'date',
            nullable: true,
          },
        },
        additionalProperties: true,
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['data', 'meta', 'warnings', 'errors'],
        properties: {
          data: { nullable: true },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      SnapshotData: {
        type: 'object',
        required: [
          'date',
          'portfolioId',
          'portfolio',
          'positions',
          'quotes',
          'indices',
          'exchangeRates',
        ],
        properties: {
          date: { type: 'string', format: 'date' },
          portfolioId: { type: 'string' },
          portfolio: { type: 'object', additionalProperties: true },
          positions: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
          quotes: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
          indices: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
          exchangeRates: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      SnapshotDataEnvelope: {
        type: 'object',
        required: ['data', 'meta', 'warnings', 'errors'],
        properties: {
          data: { $ref: '#/components/schemas/SnapshotData' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      InvalidCodeDiagnostic: {
        type: 'object',
        required: ['code', 'reason'],
        properties: {
          code: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      QuoteDiagnostics: {
        type: 'object',
        required: ['requested', 'found', 'missing', 'invalid', 'quotes'],
        properties: {
          requested: { type: 'array', items: { type: 'string' } },
          found: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          invalid: {
            type: 'array',
            items: { $ref: '#/components/schemas/InvalidCodeDiagnostic' },
          },
          quotes: {
            type: 'array',
            items: { $ref: '#/components/schemas/Quote' },
          },
        },
      },
      QuoteDiagnosticsEnvelope: {
        type: 'object',
        required: ['data', 'meta', 'warnings', 'errors'],
        properties: {
          data: { $ref: '#/components/schemas/QuoteDiagnostics' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      KlineDiagnostics: {
        type: 'object',
        required: ['requested', 'found', 'missing', 'invalid', 'points'],
        properties: {
          requested: { type: 'array', items: { type: 'string' } },
          found: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          invalid: {
            type: 'array',
            items: { $ref: '#/components/schemas/InvalidCodeDiagnostic' },
          },
          points: {
            type: 'array',
            items: { $ref: '#/components/schemas/KlinePoint' },
          },
        },
      },
      KlineDiagnosticsEnvelope: {
        type: 'object',
        required: ['data', 'meta', 'warnings', 'errors'],
        properties: {
          data: { $ref: '#/components/schemas/KlineDiagnostics' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      ExchangeRates: {
        type: 'object',
        required: ['USD', 'HKD', 'CNY', 'updatedAt'],
        properties: {
          USD: { type: 'number', nullable: true },
          HKD: { type: 'number', nullable: true },
          CNY: { type: 'number' },
          updatedAt: { type: 'string', format: 'date-time' },
          error: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      ExchangeRatesEnvelope: {
        type: 'object',
        required: ['data', 'meta', 'warnings', 'errors'],
        properties: {
          data: { $ref: '#/components/schemas/ExchangeRates' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      PeriodReportEnvelope: {
        type: 'object',
        required: ['data', 'meta', 'warnings', 'errors'],
        properties: {
          data: { type: 'object', additionalProperties: true },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      DataFreshnessEnvelope: {
        type: 'object',
        description:
          'Reserved contract for future data-freshness endpoint; not implemented as a production route in M1.',
        properties: {
          data: {
            type: 'object',
            properties: {
              portfolioId: { type: 'string' },
              requested_date: {
                type: 'string',
                format: 'date',
                nullable: true,
              },
              resolved_date: { type: 'string', format: 'date', nullable: true },
              latest_available_date: {
                type: 'string',
                format: 'date',
                nullable: true,
              },
              status: {
                type: 'string',
                enum: ['fresh', 'stale', 'missing', 'unknown'],
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      SourceHealthEnvelope: {
        type: 'object',
        description:
          'Reserved contract for future Source Gateway health endpoint; not implemented as a production route in M1.',
        properties: {
          data: {
            type: 'object',
            properties: {
              sources: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
          warnings: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiWarning' },
          },
          errors: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
      Quote: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          currentPrice: { type: 'number' },
          change: { type: 'number' },
          changePercent: { type: 'number' },
          volume: { type: 'number' },
        },
      },
      KlinePoint: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
          open: { type: 'number' },
          close: { type: 'number' },
          high: { type: 'number' },
          low: { type: 'number' },
          volume: { type: 'number' },
        },
      },
    },
  },
};
