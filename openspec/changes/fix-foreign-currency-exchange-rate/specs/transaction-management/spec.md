## ADDED Requirements

### Requirement: 外币交易汇率换算验证

系统在处理外币（港币、美元）交易时，**必须（SHALL）**正确进行汇率换算，并将换算后的人民币金额保存到数据库。同时**必须（SHALL）**保存原始币种和使用的汇率，以便追溯和审计。

#### Scenario: 卖出港股交易的汇率换算

- **WHEN** 用户卖出港股（资产代码以 'hk' 开头），数量为1股，价格为100港元
- **AND** 当前港币对人民币汇率为 0.92
- **THEN** 系统应计算卖出金额为 100 × 0.92 = 92 人民币
- **AND** 投资组合现金余额增加92元人民币（扣除佣金后）
- **AND** 交易记录中 `amount` 字段保存为92
- **AND** 交易记录中 `currency` 字段保存为 'HKD'
- **AND** 交易记录中 `exchangeRate` 字段保存为0.92

#### Scenario: 卖出美股交易的汇率换算

- **WHEN** 用户卖出美股（资产代码以 'us' 开头），数量为1股，价格为100美元
- **AND** 当前美元对人民币汇率为 7.25
- **THEN** 系统应计算卖出金额为 100 × 7.25 = 725 人民币
- **AND** 投资组合现金余额增加725元人民币（扣除佣金后）
- **AND** 交易记录中 `amount` 字段保存为725
- **AND** 交易记录中 `currency` 字段保存为 'USD'
- **AND** 交易记录中 `exchangeRate` 字段保存为7.25

#### Scenario: 港股股息的汇率换算

- **WHEN** 用户收到港股股息（资产代码以 'hk' 开头），金额为100港元
- **AND** 当前港币对人民币汇率为 0.92
- **THEN** 系统应计算股息金额为 100 × 0.92 = 92 人民币
- **AND** 投资组合现金余额增加92元人民币
- **AND** 交易记录中 `amount` 字段保存为92
- **AND** 交易记录中 `currency` 字段保存为 'HKD'
- **AND** 交易记录中 `exchangeRate` 字段保存为0.92

#### Scenario: 美股股息的汇率换算

- **WHEN** 用户收到美股股息（资产代码以 'us' 开头），金额为10美元
- **AND** 当前美元对人民币汇率为 7.25
- **THEN** 系统应计算股息金额为 10 × 7.25 = 72.5 人民币
- **AND** 投资组合现金余额增加72.5元人民币
- **AND** 交易记录中 `amount` 字段保存为72.5
- **AND** 交易记录中 `currency` 字段保存为 'USD'
- **AND** 交易记录中 `exchangeRate` 字段保存为7.25

#### Scenario: A股交易不需要汇率换算

- **WHEN** 用户卖出A股（资产代码以 'sh' 或 'sz' 开头），价格为100元
- **THEN** 系统不应进行汇率换算
- **AND** 交易记录中 `currency` 字段保存为 'CNY'
- **AND** 交易记录中 `exchangeRate` 字段可以为1.0或NULL

#### Scenario: 前端未传递币种时自动推断

- **WHEN** 前端提交交易请求时未包含 `currency` 字段
- **AND** 交易的资产代码以 'hk' 开头
- **THEN** 后端应自动推断币种为 'HKD'
- **AND** 日志中应记录 "Auto-inferred currency: HKD for hk00700"

#### Scenario: 汇率API调用失败的处理

- **WHEN** 用户卖出港股
- **AND** 汇率服务API调用失败或超时
- **THEN** 系统应记录错误日志
- **AND** 交易应被拒绝（返回错误给用户）
- **OR** 系统可选择使用最近缓存的汇率（如果存在且不超过24小时）

### Requirement: 汇率换算日志记录

系统在执行汇率换算时，**必须（SHALL）**在控制台输出详细的日志信息，以便开发者调试和用户审计。

#### Scenario: SELL交易的日志输出

- **WHEN** 执行卖出港股交易
- **THEN** 控制台应输出包含以下信息的日志：
  - `[SELL] Asset: hk00700, Original Amount: 100, Exchange Rate: 0.92, Amount CNY: 92`
  - `[SELL] Currency: HKD, Saving exchange rate: 0.92`

#### Scenario: DIVIDEND交易的日志输出

- **WHEN** 执行港股股息交易
- **THEN** 控制台应输出包含以下信息的日志：
  - `[DIVIDEND] Asset: hk00700, Is Foreign: true, Exchange Rate: 0.92`
  - `[DIVIDEND] Original Amount: 100, Amount CNY: 92`

#### Scenario: 币种推断的日志输出

- **WHEN** 后端自动推断交易币种
- **THEN** 控制台应输出：
  - `[Currency Inference] Asset: hk00700, Inferred Currency: HKD`

#### Scenario: 数据库保存的日志输出

- **WHEN** 交易数据保存到数据库
- **THEN** 控制台应输出：
  - `[DB Save] Transaction data: { currency: 'HKD', exchangeRate: 0.92 }`

### Requirement: 编译产物一致性保证

当 `packages/infra` 的 TypeScript 源码被修改后，系统**必须（SHALL）**确保编译产物被正确更新，并且后端服务加载的是最新的编译后代码。

#### Scenario: 源码修改后重新编译

- **WHEN** 开发者修改了 `packages/infra/src/storage/storage.prisma.ts`
- **THEN** 开发者必须执行 `npm run build` 在 `packages/infra` 目录
- **AND** `packages/infra/dist/` 目录应包含最新的编译后 `.js` 文件
- **AND** 编译后文件的修改时间应晚于源文件

#### Scenario: 后端服务重启以加载新代码

- **WHEN** `packages/infra` 重新编译完成
- **THEN** 后端服务必须重启以加载新的编译产物
- **AND** 可以通过停止旧进程并重新执行 `npm run dev` 实现
- **OR** 可以使用自动化脚本 `scripts/rebuild-infra.sh` 一键完成编译和重启

#### Scenario: 验证加载的代码版本

- **WHEN** 后端服务启动
- **THEN** 可以通过在代码中添加临时日志（如 `console.log('[Version Check] storage.prisma.ts loaded at ' + new Date())`）来验证加载的是最新版本
- **AND** 该日志应在服务启动时输出

## MODIFIED Requirements

### Requirement: 交易记录数据完整性

交易记录（Transaction）在保存到数据库时，**必须（MUST）**包含完整的币种和汇率信息。对于涉及买入、卖出、股息的交易，系统应根据资产代码自动识别币种，并获取当时的汇率。

**注：此需求修改了原有的交易记录保存逻辑，新增了对 `currency` 和 `exchangeRate` 字段的强制要求。**

#### Scenario: 买入交易保存完整信息

- **WHEN** 用户买入港股，数量10股，价格50港元，佣金5港元
- **AND** 当前港币对人民币汇率为 0.92
- **THEN** 数据库中的交易记录应包含：
  - `type`: 'BUY'
  - `assetCode`: 'hk00700'
  - `quantity`: 10
  - `price`: 50
  - `amount`: (10 × 50 + 5) × 0.92 = 465.6（人民币）
  - `commission`: 5 × 0.92 = 4.6（人民币）
  - `currency`: 'HKD'
  - `exchangeRate`: 0.92

#### Scenario: 卖出交易保存完整信息

- **WHEN** 用户卖出港股，数量10股，价格50港元，佣金5港元
- **AND** 当前港币对人民币汇率为 0.92
- **THEN** 数据库中的交易记录应包含：
  - `type`: 'SELL'
  - `assetCode`: 'hk00700'
  - `quantity`: 10
  - `price`: 50
  - `amount`: (10 × 50 - 5) × 0.92 = 454.4（人民币）
  - `commission`: 5 × 0.92 = 4.6（人民币）
  - `currency`: 'HKD'
  - `exchangeRate`: 0.92

#### Scenario: 股息交易保存完整信息

- **WHEN** 用户收到港股股息100港元
- **AND** 当前港币对人民币汇率为 0.92
- **THEN** 数据库中的交易记录应包含：
  - `type`: 'DIVIDEND'
  - `assetCode`: 'hk00700'
  - `amount`: 100 × 0.92 = 92（人民币）
  - `currency`: 'HKD'
  - `exchangeRate`: 0.92

#### Scenario: 存取款交易使用人民币

- **WHEN** 用户存入或取出资金
- **THEN** 交易记录中 `currency` 应为 'CNY'
- **AND** `exchangeRate` 可以为1.0或NULL

#### Scenario: 历史交易数据的兼容性

- **WHEN** 查询历史交易记录
- **AND** 某些旧交易没有 `currency` 或 `exchangeRate` 字段
- **THEN** 系统应默认将 `currency` 视为 'CNY'
- **AND** 系统应默认将 `exchangeRate` 视为1.0
- **AND** 前端显示时应正确处理这些空值

### Requirement: 汇率服务可靠性

汇率服务（`currency-service`）在获取汇率时，**必须（MUST）**提供容错机制，确保在API调用失败时系统仍能正常运作（使用缓存或默认值）。

**注：此需求增强了原有汇率服务的错误处理能力。**

#### Scenario: 汇率API成功返回

- **WHEN** 调用 `getExchangeRateForAssetToCNY('hk00700')`
- **AND** 外部汇率API正常响应
- **THEN** 应返回最新的港币对人民币汇率（如0.92）
- **AND** 该汇率应被缓存24小时

#### Scenario: 汇率API失败时使用缓存

- **WHEN** 调用 `getExchangeRateForAssetToCNY('hk00700')`
- **AND** 外部汇率API调用失败或超时
- **AND** 缓存中有24小时内的汇率数据
- **THEN** 应返回缓存的汇率
- **AND** 应记录警告日志 "Using cached exchange rate due to API failure"

#### Scenario: 汇率API失败且无缓存时使用默认值

- **WHEN** 调用 `getExchangeRateForAssetToCNY('hk00700')`
- **AND** 外部汇率API调用失败或超时
- **AND** 缓存中没有有效的汇率数据
- **THEN** 应返回预设的默认汇率（如 HKD: 0.92, USD: 7.2）
- **AND** 应记录警告日志 "Using fallback exchange rate due to API failure and no cache"
- **OR** 抛出错误并拒绝交易（取决于业务规则）

#### Scenario: 汇率合理性验证

- **WHEN** 从API或缓存获取到汇率
- **AND** 汇率值不在合理范围内（如 < 0.1 或 > 20）
- **THEN** 应记录警告日志 "Suspicious exchange rate: X for assetCode"
- **AND** 可选择拒绝该汇率并使用备用值

## REMOVED Requirements

无移除的需求。

