import { OpenAPIV3 } from 'openapi-types';

export const openApiDocument: OpenAPIV3.Document = {
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
  ],
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
        responses: {
          '200': {
            description: '成功返回汇率',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    USD: { type: 'number', nullable: true },
                    HKD: { type: 'number', nullable: true },
                    CNY: { type: 'number', example: 1.0 },
                    updatedAt: { type: 'string', format: 'date-time' },
                  },
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
        ],
        responses: {
          '200': {
            description: '成功返回报告内容',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
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
                schema: { type: 'object', additionalProperties: true },
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
        ],
        responses: {
          '200': {
            description: '成功返回行情数据',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Quote' },
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
            schema: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
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
        ],
        responses: {
          '200': {
            description: '成功返回K线数据',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/KlinePoint' },
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
