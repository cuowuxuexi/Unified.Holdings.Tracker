import { Position, Quote } from '../../types';
import { getExchangeRateForAssetToCNY } from '../currencyService';
import { getCurrencyForAsset } from '../portfolioReplay';

/**
 * Calculates real-time profit and loss for each position based on current quotes.
 * Updates the position objects in place (or returns new objects).
 *
 * @description
 * 使用摊薄成本法计算盈亏：
 * - totalCost = 累计买入 - 累计卖出（可为负数）
 * - totalBuyCost = 累计买入成本（只增不减，用于收益率分母）
 * - totalPnl = 当前市值 - 摊薄成本
 * - totalPnlPercent = totalPnl / totalBuyCost（分母永远为正，避免负成本导致计算错误）
 *
 * @param positions - Array of current positions.
 * @param quotes - A map of stock codes to their latest quotes.
 * @returns The updated array of positions with PnL calculations.
 */
export function calculateRealtimePnl(
  positions: Position[],
  quotes: Record<string, Quote>
): Position[] {
  return positions.map((position) => {
    const quote = quotes[position.asset.code];
    const currency =
      position.currency || getCurrencyForAsset(position.asset.code);
    const updatedPosition: Position = {
      ...position,
      currency,
    }; // Create a copy to avoid modifying the original object directly

    if (quote && quote.currentPrice != null) {
      updatedPosition.currentPrice = quote.currentPrice;
      // Update asset name from the quote if available
      if (quote.name) {
        updatedPosition.asset = { ...updatedPosition.asset, name: quote.name };
      }

      const exchangeRate = getExchangeRateForAssetToCNY(position.asset.code);
      const marketValueLocal = quote.currentPrice * position.quantity;
      const marketValueCny = marketValueLocal * exchangeRate;

      updatedPosition.marketValueLocal = marketValueLocal;
      updatedPosition.marketValue = marketValueCny;
      updatedPosition.marketValueCNY = marketValueCny;

      const hasPosition = position.quantity > 0;
      const totalCost = hasPosition ? position.totalCost || 0 : 0;
      const totalCostLocal = hasPosition ? position.totalCostLocal : 0;

      // 总盈亏 = 市值 - 摊薄成本（摊薄成本可为负数）
      updatedPosition.totalPnl = marketValueCny - totalCost;
      if (typeof totalCostLocal === 'number') {
        updatedPosition.totalPnlLocal = marketValueLocal - totalCostLocal;
      }

      // 浮动盈亏（与雪球一致）= (现价 - 成本价) × 数量
      // 必须在同一币种下计算：原币种计算后转CNY，避免币种混淆
      if (typeof position.costPriceLocal === 'number') {
        // 港股/美股：使用原币种成本价计算
        const floatingPnlLocal =
          (quote.currentPrice - position.costPriceLocal) * position.quantity;
        updatedPosition.floatingPnlLocal = floatingPnlLocal;
        updatedPosition.floatingPnl = floatingPnlLocal * exchangeRate;
      } else {
        // A股：CNY直接计算
        const costPrice = position.costPrice || 0;
        updatedPosition.floatingPnl =
          (quote.currentPrice - costPrice) * position.quantity;
        updatedPosition.floatingPnlLocal = updatedPosition.floatingPnl;
      }

      // 计算盈亏百分比：使用 totalBuyCost（累计买入成本）作为分母
      // 这样即使摊薄成本为负数，收益率计算也不会出错
      // 公式：totalPnlPercent = totalPnl / totalBuyCost
      const denominator = position.totalBuyCost ?? position.totalCost ?? 0;
      updatedPosition.totalPnlPercent =
        denominator !== 0 ? updatedPosition.totalPnl / denominator : 0;
      updatedPosition.floatingPnlPercent =
        denominator !== 0 ? updatedPosition.floatingPnl / denominator : 0;

      // Calculate daily PnL based on changeAmount if available
      if (quote.changeAmount != null) {
        const dailyChangeLocal = quote.changeAmount * position.quantity;
        updatedPosition.dailyChangeLocal = dailyChangeLocal;
        updatedPosition.dailyChange = dailyChangeLocal * exchangeRate;
      } else {
        updatedPosition.dailyChange = undefined;
        updatedPosition.dailyChangeLocal = undefined;
      }
      updatedPosition.dailyChangePercent = quote.changePercent ?? undefined;
      updatedPosition.weeklyChangePercent =
        quote.weeklyChangePercent ?? undefined;
      updatedPosition.monthlyChangePercent =
        quote.monthlyChangePercent ?? undefined;
      updatedPosition.yearlyChangePercent =
        quote.yearlyChangePercent ?? undefined;
    } else {
      // Handle cases where quote is missing or doesn't have price
      console.warn(
        `Quote not found or invalid for ${position.asset.code}, cannot calculate real-time PnL.`
      );
      updatedPosition.currentPrice = undefined; // Or position.costPrice? or null?
      updatedPosition.marketValue = 0; // Or based on cost?
      updatedPosition.marketValueCNY = 0;
      updatedPosition.marketValueLocal = 0;
      updatedPosition.totalPnl = undefined;
      updatedPosition.totalPnlPercent = undefined;
      updatedPosition.dailyChange = undefined;
      updatedPosition.dailyChangeLocal = undefined;
      updatedPosition.dailyChangePercent = undefined;
    }

    // 验证持仓数据
    const validation = validatePositionData(updatedPosition);
    if (!validation.isValid) {
      validation.warnings.forEach((warning) => {
        console.warn(`[数据验证警告] ${warning}`);
      });
    }

    return updatedPosition;
  });
}

/**
 * 验证持仓数据，检测异常值
 * @param position - 持仓数据
 * @returns 验证结果和警告信息
 */
export function validatePositionData(position: Position): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // 检查1: 总盈亏% 异常（绝对值超过1000%，即10倍）
  // 注意：使用摊薄成本法后，收益率分母为 totalBuyCost，不会因负成本出错
  if (
    position.totalPnlPercent !== undefined &&
    position.totalPnlPercent !== null
  ) {
    const percentValue = Math.abs(position.totalPnlPercent);
    if (percentValue > 10) {
      warnings.push(
        `${position.asset.code}: 总盈亏%异常 (${(position.totalPnlPercent * 100).toFixed(2)}%)，` +
          `成本价=${position.costPrice?.toFixed(4)}, 市值=${position.marketValue?.toFixed(2)}`
      );
    }
  }

  // 检查2: 成本价为0（但有持仓）- 负成本价现在是允许的
  if (position.costPrice !== undefined && position.costPrice !== null) {
    if (position.costPrice === 0 && position.quantity > 0) {
      warnings.push(
        `${position.asset.code}: 成本价为0，持仓数量=${position.quantity}`
      );
    }
    // 负成本价现在是允许的（摊薄成本法下表示已回本且有盈余）
    if (position.costPrice < 0) {
      console.log(
        `[摊薄成本] ${position.asset.code}: 成本价为负数 (${position.costPrice.toFixed(4)})，表示已回本且有盈余`
      );
    }
  }

  // 检查3: 无持仓但仍有成本或盈亏数据
  if (position.quantity <= 0 && (position.totalCost || 0) !== 0) {
    warnings.push(
      `${position.asset.code}: 持仓为0但总成本为${(position.totalCost || 0).toFixed(2)}`
    );
  }

  // 检查4: 市值异常（负数或为0但有持仓）
  if (position.marketValue !== undefined && position.marketValue !== null) {
    if (position.marketValue < 0) {
      warnings.push(
        `${position.asset.code}: 市值为负数 (${position.marketValue.toFixed(2)})`
      );
    } else if (position.marketValue === 0 && position.quantity > 0) {
      warnings.push(
        `${position.asset.code}: 市值为0但持仓数量=${position.quantity}，可能是行情数据缺失`
      );
    }
  }

  // 检查5: 持仓数量异常（负数）
  if (position.quantity < 0) {
    warnings.push(
      `${position.asset.code}: 持仓数量为负数 (${position.quantity})`
    );
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}
