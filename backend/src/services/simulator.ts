import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { createChildLogger } from '../utils/logger.js';
import { config } from '../config.js';
import * as dataStore from './data-store.js';
import { polymarketApi } from './polymarket-api.js';
import {
  SimulationConfig,
  SimulationResults,
  SimulatedTrade,
  SimulationLogEntry,
  Trade,
  OrderbookSnapshot,
  LeaderboardEntry,
} from '../models/types.js';

const logger = createChildLogger('simulator');

// ============================================
// Realistic Entry Price Calculation
// ============================================

interface FillResult {
  avgPrice: number;
  slippageBps: number;
  filled: boolean;
  fillRatio: number;
}

function calculateRealisticFill(
  side: 'BUY' | 'SELL',
  sizeUsd: number,
  orderbook: OrderbookSnapshot | null,
  marketImpactEnabled: boolean,
  dailyVolume: number = 100000
): FillResult {
  // Default if no orderbook data
  if (!orderbook) {
    // Use a conservative slippage estimate based on trade size
    const baseSlippage = Math.min(50, Math.sqrt(sizeUsd / 100) * 10);
    return {
      avgPrice: side === 'BUY' ? 0.5 * (1 + baseSlippage / 10000) : 0.5 * (1 - baseSlippage / 10000),
      slippageBps: baseSlippage,
      filled: true,
      fillRatio: 1,
    };
  }

  // Use orderbook depth to calculate realistic fill
  const relevantDepth = side === 'BUY' ? orderbook.askDepth100bps : orderbook.bidDepth100bps;
  const deeperDepth = side === 'BUY' ? orderbook.askDepth500bps : orderbook.bidDepth500bps;

  let fillRatio = 1;
  let slippageBps = orderbook.spreadBps / 2; // Start with half spread

  if (sizeUsd > relevantDepth) {
    // We'll move through multiple price levels
    if (sizeUsd > deeperDepth) {
      // Large order - may not fully fill
      fillRatio = Math.min(1, deeperDepth / sizeUsd);
      slippageBps = 500; // 5% slippage for very large orders
    } else {
      // Medium order - some slippage
      const depthRatio = sizeUsd / relevantDepth;
      slippageBps = orderbook.spreadBps / 2 + depthRatio * 100; // Linear slippage model
    }
  }

  // Add market impact if enabled
  if (marketImpactEnabled && dailyVolume > 0) {
    const participation = sizeUsd / dailyVolume;
    // Square-root market impact model
    const impactBps = Math.sqrt(participation) * 100;
    slippageBps += impactBps;
  }

  // Calculate final price
  const midPrice = orderbook.midPrice;
  const slippageMultiplier = 1 + (side === 'BUY' ? 1 : -1) * (slippageBps / 10000);
  const avgPrice = midPrice * slippageMultiplier;

  return {
    avgPrice: Math.max(0.001, Math.min(0.999, avgPrice)), // Clamp to valid range
    slippageBps: Math.round(slippageBps),
    filled: fillRatio >= 0.95,
    fillRatio,
  };
}

// ============================================
// Single Simulation Run
// ============================================

interface PortfolioState {
  cash: number;
  positions: Map<string, { size: number; avgPrice: number; outcome: string; conditionId: string }>;
}

async function runSingleSimulation(
  trades: Trade[],
  cfg: SimulationConfig,
  topTraders: string[],
  rng: () => number // Random number generator for reproducibility
): Promise<{
  finalPnl: number;
  dailyPnl: Map<string, number>;
  marketPnl: Map<string, number>;
  tradeLog: SimulatedTrade[];
}> {
  const portfolio: PortfolioState = {
    cash: cfg.bankrollGbp * config.GBP_USD_RATE, // Convert to USD
    positions: new Map(),
  };

  const tradeLog: SimulatedTrade[] = [];
  const dailyPnl = new Map<string, number>();
  const marketPnl = new Map<string, number>();

  // Calculate allocation per trader
  const allocationPerTrader = portfolio.cash / topTraders.length;

  // Track exposure per market
  const marketExposure = new Map<string, number>();
  const maxExposureUsd = portfolio.cash * (cfg.maxExposurePct / 100);

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of sortedTrades) {
    // Check if this trade is from a top trader
    if (!topTraders.includes(trade.walletAddress)) continue;

    // Check minimum trade size
    const tradeUsd = trade.usdcSize || trade.size * trade.price;
    if (tradeUsd < cfg.minTradeUsd) continue;

    // Calculate random delay within variance
    const delay = cfg.entryDelaySec + (rng() - 0.5) * 2 * cfg.delayVarianceSec;
    const entryTime = trade.timestamp + delay * 1000;

    // Get price at entry time (with delay)
    let priceAtEntry = await dataStore.getPriceAtTime(trade.tokenId, entryTime);
    if (priceAtEntry === null) {
      // Fall back to original trade price with some drift
      const drift = (rng() - 0.5) * 0.02; // ±1% random drift
      priceAtEntry = trade.price * (1 + drift);
    }

    // Get orderbook snapshot for realistic slippage
    let orderbook: OrderbookSnapshot | null = null;
    if (cfg.useActualOrderbook) {
      orderbook = await dataStore.getOrderbookSnapshot(trade.tokenId, entryTime);
    }

    // Calculate position size
    let positionSizeUsd: number;
    if (cfg.sizingRule === 'equal') {
      positionSizeUsd = allocationPerTrader / (sortedTrades.length / topTraders.length);
      positionSizeUsd = Math.min(positionSizeUsd, 50); // Cap at $50 per trade
    } else {
      // Proportional sizing based on trader's trade size
      const traderVolume = trades
        .filter((t) => t.walletAddress === trade.walletAddress)
        .reduce((sum, t) => sum + (t.usdcSize || t.size * t.price), 0);
      positionSizeUsd = (tradeUsd / traderVolume) * allocationPerTrader;
    }

    // Check market exposure limit
    const currentExposure = marketExposure.get(trade.conditionId) || 0;
    if (currentExposure + positionSizeUsd > maxExposureUsd) {
      positionSizeUsd = Math.max(0, maxExposureUsd - currentExposure);
    }

    if (positionSizeUsd < 1) continue; // Skip tiny positions

    // Get market daily volume for impact calculation
    const market = await dataStore.getMarket(trade.conditionId);
    const dailyVolume = market?.dailyVolume || 100000;

    // Calculate realistic fill
    const fill = calculateRealisticFill(
      trade.side,
      positionSizeUsd,
      orderbook,
      cfg.marketImpactEnabled,
      dailyVolume
    );

    // Adjust for partial fills
    const actualSizeUsd = positionSizeUsd * fill.fillRatio;
    const shares = actualSizeUsd / fill.avgPrice;

    // Update portfolio
    const posKey = `${trade.conditionId}_${trade.outcome}`;

    if (trade.side === 'BUY') {
      // Opening or adding to position
      const existing = portfolio.positions.get(posKey);
      if (existing) {
        const newSize = existing.size + shares;
        existing.avgPrice = (existing.avgPrice * existing.size + fill.avgPrice * shares) / newSize;
        existing.size = newSize;
      } else {
        portfolio.positions.set(posKey, {
          size: shares,
          avgPrice: fill.avgPrice,
          outcome: trade.outcome,
          conditionId: trade.conditionId,
        });
      }
      portfolio.cash -= actualSizeUsd;
      marketExposure.set(trade.conditionId, (marketExposure.get(trade.conditionId) || 0) + actualSizeUsd);
    } else {
      // Closing position
      const existing = portfolio.positions.get(posKey);
      if (existing && existing.size > 0) {
        const sellShares = Math.min(shares, existing.size);
        const pnl = (fill.avgPrice - existing.avgPrice) * sellShares;
        portfolio.cash += sellShares * fill.avgPrice;
        existing.size -= sellShares;

        // Track PnL
        const dateKey = new Date(trade.timestamp).toISOString().split('T')[0];
        dailyPnl.set(dateKey, (dailyPnl.get(dateKey) || 0) + pnl);
        marketPnl.set(trade.conditionId, (marketPnl.get(trade.conditionId) || 0) + pnl);
      }
    }

    // Log the simulated trade
    tradeLog.push({
      originalTrade: trade,
      simulatedEntryTime: entryTime,
      intendedPrice: trade.price,
      actualEntryPrice: fill.avgPrice,
      priceMovement: priceAtEntry - trade.price,
      slippageBps: fill.slippageBps,
      positionSize: shares,
      positionSizeUsd: actualSizeUsd,
      exitPrice: 0, // Will be calculated at end
      pnl: 0, // Will be calculated at end
      partialFill: !fill.filled,
      marketImpact: cfg.marketImpactEnabled ? fill.slippageBps * 0.3 : 0,
    });
  }

  // Calculate final PnL including unrealized
  let unrealizedPnl = 0;
  for (const [posKey, pos] of portfolio.positions) {
    if (pos.size <= 0.001) continue;

    const market = await dataStore.getMarket(pos.conditionId);

    let exitPrice: number;
    if (market?.isClosed && market.winningOutcome) {
      // Settled - use resolution price
      exitPrice = market.winningOutcome.toUpperCase() === pos.outcome.toUpperCase() ? 1.0 : 0.0;
    } else {
      // Still open - use current price
      exitPrice = market?.lastPriceYes || 0.5;
      if (pos.outcome.toUpperCase() === 'NO') {
        exitPrice = 1 - exitPrice;
      }
    }

    const pnl = (exitPrice - pos.avgPrice) * pos.size;
    unrealizedPnl += pnl;

    // Add to market PnL
    marketPnl.set(pos.conditionId, (marketPnl.get(pos.conditionId) || 0) + pnl);
  }

  const totalPnlUsd = portfolio.cash - cfg.bankrollGbp * config.GBP_USD_RATE + unrealizedPnl;
  const totalPnlGbp = totalPnlUsd / config.GBP_USD_RATE;

  return {
    finalPnl: totalPnlGbp,
    dailyPnl,
    marketPnl,
    tradeLog,
  };
}

// ============================================
// Monte Carlo Simulation
// ============================================

export async function runSimulation(cfg: SimulationConfig): Promise<SimulationResults> {
  const simulationId = uuidv4();
  const startTime = Date.now();
  const simulationLog: SimulationLogEntry[] = [];
  let stepCounter = 0;

  logger.info({ simulationId, cfg }, 'Starting simulation');

  // Log setup phase
  simulationLog.push({
    step: ++stepCounter,
    type: 'setup',
    description: 'Initializing simulation parameters',
    details: {
      bankrollGbp: cfg.bankrollGbp,
      bankrollUsd: cfg.bankrollGbp * config.GBP_USD_RATE,
      entryDelaySec: cfg.entryDelaySec,
      delayVarianceSec: cfg.delayVarianceSec,
      sizingRule: cfg.sizingRule,
      maxExposurePct: cfg.maxExposurePct,
      minTradeUsd: cfg.minTradeUsd,
      useActualOrderbook: cfg.useActualOrderbook,
      marketImpactEnabled: cfg.marketImpactEnabled,
      numSimulations: cfg.numSimulations,
      windowDays: cfg.windowDays,
    },
    calculation: `Initial capital: £${cfg.bankrollGbp} × ${config.GBP_USD_RATE} (GBP/USD rate) = $${(cfg.bankrollGbp * config.GBP_USD_RATE).toFixed(2)}`,
  });

  // Get top traders
  const leaderboard = await dataStore.getLeaderboard('realized_pnl', 10);
  const topTraders = leaderboard.map((e) => e.walletAddress);

  if (topTraders.length === 0) {
    throw new Error('No traders in leaderboard');
  }

  simulationLog.push({
    step: ++stepCounter,
    type: 'setup',
    description: `Loaded ${topTraders.length} top traders to follow`,
    details: {
      traderCount: topTraders.length,
      topTraderPnl: leaderboard[0]?.totalPnl || 0,
      avgTraderPnl: leaderboard.reduce((sum, e) => sum + e.totalPnl, 0) / leaderboard.length,
    },
    calculation: `Following top ${topTraders.length} traders ranked by PnL`,
  });

  // Get trades for the window
  const windowStart = Date.now() - cfg.windowDays * 24 * 60 * 60 * 1000;
  const trades = await dataStore.getTradesSince(windowStart);

  // Filter trades from followed traders
  const relevantTrades = trades.filter(t => topTraders.includes(t.walletAddress));

  simulationLog.push({
    step: ++stepCounter,
    type: 'setup',
    description: `Loaded historical trade data for ${cfg.windowDays}-day window`,
    details: {
      totalTradesInWindow: trades.length,
      tradesFromTopTraders: relevantTrades.length,
      windowStartDate: new Date(windowStart).toISOString(),
      windowEndDate: new Date().toISOString(),
    },
    calculation: `${relevantTrades.length} trades from top traders / ${trades.length} total trades = ${((relevantTrades.length / trades.length) * 100).toFixed(1)}% coverage`,
  });

  logger.info({ tradeCount: trades.length, traders: topTraders.length }, 'Loaded data for simulation');

  // Run Monte Carlo simulations
  const results: number[] = [];
  const allDailyPnl: Map<string, number[]> = new Map();
  const allMarketPnl: Map<string, number[]> = new Map();
  let sampleTradeLog: SimulatedTrade[] = [];

  // Seeded random for reproducibility
  let seed = Date.now();
  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  simulationLog.push({
    step: ++stepCounter,
    type: 'setup',
    description: `Starting Monte Carlo simulation with ${cfg.numSimulations} iterations`,
    details: {
      iterations: cfg.numSimulations,
      randomSeed: seed,
      method: 'Linear Congruential Generator',
    },
    calculation: `Running ${cfg.numSimulations} simulations with random entry delays and price variations`,
  });

  for (let i = 0; i < cfg.numSimulations; i++) {
    const result = await runSingleSimulation(trades, cfg, topTraders, seededRandom);
    results.push(result.finalPnl);

    // Save sample trade log from first simulation
    if (i === 0) {
      sampleTradeLog = result.tradeLog.slice(0, 20); // Keep first 20 trades as sample
    }

    // Aggregate daily PnL
    for (const [date, pnl] of result.dailyPnl) {
      if (!allDailyPnl.has(date)) allDailyPnl.set(date, []);
      allDailyPnl.get(date)!.push(pnl);
    }

    // Aggregate market PnL
    for (const [market, pnl] of result.marketPnl) {
      if (!allMarketPnl.has(market)) allMarketPnl.set(market, []);
      allMarketPnl.get(market)!.push(pnl);
    }
  }

  // Sort results for percentile calculation
  results.sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] || 0;
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stdDev = (arr: number[]) => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length);
  };

  // Calculate Sharpe ratio (assuming risk-free rate of 0)
  const avgReturn = mean(results);
  const returnStdDev = stdDev(results);
  const sharpeRatio = returnStdDev > 0 ? avgReturn / returnStdDev : 0;

  simulationLog.push({
    step: ++stepCounter,
    type: 'summary',
    description: 'Calculating distribution statistics from simulation results',
    details: {
      simulationsCompleted: cfg.numSimulations,
      minPnl: Math.min(...results),
      maxPnl: Math.max(...results),
      avgPnl: avgReturn,
      stdDev: returnStdDev,
    },
    calculation: `Mean = Σ(PnL) / N = £${avgReturn.toFixed(2)}, StdDev = √(Σ(PnL - Mean)² / N) = £${returnStdDev.toFixed(2)}`,
  });

  const p5 = percentile(results, 0.05);
  const p25 = percentile(results, 0.25);
  const p50 = percentile(results, 0.5);
  const p75 = percentile(results, 0.75);
  const p95 = percentile(results, 0.95);

  simulationLog.push({
    step: ++stepCounter,
    type: 'summary',
    description: 'Computing percentile distribution',
    details: {
      p5: p5,
      p25: p25,
      p50_median: p50,
      p75: p75,
      p95: p95,
    },
    calculation: `5th percentile = £${p5.toFixed(2)} (worst case), Median = £${p50.toFixed(2)} (typical), 95th percentile = £${p95.toFixed(2)} (best case)`,
  });

  simulationLog.push({
    step: ++stepCounter,
    type: 'summary',
    description: 'Calculating risk-adjusted return (Sharpe Ratio)',
    details: {
      avgReturn: avgReturn,
      stdDev: returnStdDev,
      sharpeRatio: sharpeRatio,
      riskFreeRate: 0,
    },
    calculation: `Sharpe Ratio = (Mean Return - Risk-Free Rate) / StdDev = (${avgReturn.toFixed(2)} - 0) / ${returnStdDev.toFixed(2)} = ${sharpeRatio.toFixed(3)}`,
  });

  // Build daily breakdown
  const dailyBreakdown = Array.from(allDailyPnl.entries())
    .map(([date, pnls]) => ({
      date,
      pnlMedian: percentile(pnls.sort((a, b) => a - b), 0.5),
      pnlP5: percentile(pnls.sort((a, b) => a - b), 0.05),
      pnlP95: percentile(pnls.sort((a, b) => a - b), 0.95),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build market contributions
  const marketContributions = Array.from(allMarketPnl.entries())
    .map(([conditionId, pnls]) => ({
      conditionId,
      market: '', // Will be filled from cache
      pnlContribution: mean(pnls),
      tradeCount: pnls.length / cfg.numSimulations,
    }))
    .sort((a, b) => b.pnlContribution - a.pnlContribution)
    .slice(0, 10);

  // Fill in market names
  for (const mc of marketContributions) {
    const market = await dataStore.getMarket(mc.conditionId);
    mc.market = market?.title || mc.conditionId.slice(0, 16) + '...';
  }

  if (marketContributions.length > 0) {
    simulationLog.push({
      step: ++stepCounter,
      type: 'summary',
      description: 'Top contributing markets to P&L',
      details: {
        topMarket: marketContributions[0].market,
        topMarketPnl: marketContributions[0].pnlContribution,
        uniqueMarketsTraded: allMarketPnl.size,
      },
      calculation: `Best market contributed £${marketContributions[0].pnlContribution.toFixed(2)} on average`,
    });
  }

  // Add sample trade breakdown to log
  if (sampleTradeLog.length > 0) {
    const sampleTrade = sampleTradeLog[0];
    simulationLog.push({
      step: ++stepCounter,
      type: 'trade',
      timestamp: sampleTrade.simulatedEntryTime,
      description: 'Sample trade execution breakdown (from first simulation)',
      details: {
        originalTradePrice: sampleTrade.intendedPrice,
        actualEntryPrice: sampleTrade.actualEntryPrice,
        priceMovement: sampleTrade.priceMovement,
        slippageBps: sampleTrade.slippageBps,
        positionSizeUsd: sampleTrade.positionSizeUsd,
        partialFill: sampleTrade.partialFill,
        marketImpact: sampleTrade.marketImpact,
      },
      calculation: `Entry delay caused price movement of ${(sampleTrade.priceMovement * 100).toFixed(2)}%, slippage of ${sampleTrade.slippageBps}bps = ${(sampleTrade.slippageBps / 100).toFixed(2)}%`,
    });
  }

  const simulationResults: SimulationResults = {
    simulationId,
    config: cfg,
    results: {
      pnlP5: p5,
      pnlP25: p25,
      pnlMedian: p50,
      pnlP75: p75,
      pnlP95: p95,
      pnlMean: avgReturn,
      sharpeRatio,
    },
    dailyBreakdown,
    marketContributions,
    tradersFollowed: topTraders,
    windowStart: new Date(windowStart),
    windowEnd: new Date(),
    disclaimer: `HYPOTHETICAL SIMULATION ONLY. These results are based on ${cfg.numSimulations} Monte Carlo simulations with the following assumptions:
- Entry delay: ${cfg.entryDelaySec}s ± ${cfg.delayVarianceSec}s random variance
- Slippage: ${cfg.useActualOrderbook ? 'Based on actual orderbook depth' : 'Estimated from trade size'}
- Market impact: ${cfg.marketImpactEnabled ? 'Square-root model enabled' : 'Disabled'}
- Sizing: ${cfg.sizingRule === 'equal' ? 'Equal weight per trade' : 'Proportional to trader size'}
- Max exposure: ${cfg.maxExposurePct}% per market

Past performance does not guarantee future results. This is NOT financial advice.`,
    simulationLog,
    sampleTradeLog,
  };

  logger.info(
    {
      simulationId,
      duration: Date.now() - startTime,
      median: simulationResults.results.pnlMedian,
    },
    'Simulation complete'
  );

  return simulationResults;
}

// ============================================
// Quick Estimate (without full Monte Carlo)
// ============================================

export async function getQuickEstimate(
  bankrollGbp: number = 100
): Promise<{
  estimatedPnlGbp: { low: number; mid: number; high: number };
  topTraders: LeaderboardEntry[];
  disclaimer: string;
}> {
  const leaderboard = await dataStore.getLeaderboard('realized_pnl', 10);

  if (leaderboard.length === 0) {
    return {
      estimatedPnlGbp: { low: 0, mid: 0, high: 0 },
      topTraders: [],
      disclaimer: 'Insufficient data for estimate',
    };
  }

  // Calculate average ROI of top traders
  const avgRoi = leaderboard.reduce((sum, e) => sum + e.roiPercent, 0) / leaderboard.length;
  const minRoi = Math.min(...leaderboard.map((e) => e.roiPercent));
  const maxRoi = Math.max(...leaderboard.map((e) => e.roiPercent));

  // Apply conservative adjustments for copy trading friction
  const frictionFactor = 0.6; // Assume 40% loss due to delays, slippage, etc.

  const estimatedPnlGbp = {
    low: bankrollGbp * (minRoi / 100) * frictionFactor * 0.5,
    mid: bankrollGbp * (avgRoi / 100) * frictionFactor,
    high: bankrollGbp * (maxRoi / 100) * frictionFactor * 0.8,
  };

  return {
    estimatedPnlGbp,
    topTraders: leaderboard,
    disclaimer: `Quick estimate based on top trader ROI (${avgRoi.toFixed(1)}% avg) with 40% friction adjustment. Run full simulation for accurate results.`,
  };
}
