import { createChildLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { query, refreshLeaderboardView } from '../models/database.js';
import * as dataStore from '../services/data-store.js';
import { polymarketApi } from '../services/polymarket-api.js';
import { Trade, WalletStats } from '../models/types.js';

const logger = createChildLogger('aggregator');

// In-memory state for fast updates
const walletTradeCache = new Map<string, Trade[]>();
const lastAggregation = { timestamp: 0 };

export function getLastAggregationTime(): number {
  return lastAggregation.timestamp;
}

// ============================================
// Real-time Trade Processing
// ============================================

export function processTrade(trade: Trade): void {
  // Add to in-memory cache for fast aggregation
  const trades = walletTradeCache.get(trade.walletAddress) || [];
  trades.push(trade);

  // Keep only last 7 days in memory
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = trades.filter((t) => t.timestamp >= cutoff);
  walletTradeCache.set(trade.walletAddress, filtered);

  // Immediately update wallet stats with this trade
  updateWalletStatsIncremental(trade).catch((err) => {
    logger.error({ err, wallet: trade.walletAddress }, 'Failed incremental update');
  });
}

async function updateWalletStatsIncremental(trade: Trade): Promise<void> {
  const existing = await dataStore.getWalletStats(trade.walletAddress);

  const volume = trade.usdcSize || trade.size * trade.price;
  const now = new Date();

  await dataStore.upsertWalletStats({
    walletAddress: trade.walletAddress,
    volume7d: (existing?.volume7d || 0) + volume,
    trades7d: (existing?.trades7d || 0) + 1,
    firstTradeSeen: existing?.firstTradeSeen || now,
    lastTradeSeen: now,
  });
}

// ============================================
// Full Aggregation (runs periodically)
// ============================================

export async function runFullAggregation(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting full aggregation');

  try {
    // Get all active wallets
    const activeWallets = await dataStore.getActiveWallets(168); // 7 days

    logger.info({ walletCount: activeWallets.length }, 'Aggregating wallet stats');

    // Process in batches
    const batchSize = 50;
    for (let i = 0; i < activeWallets.length; i += batchSize) {
      const batch = activeWallets.slice(i, i + batchSize);
      await Promise.all(batch.map(aggregateWalletStats));
    }

    // Refresh materialized view
    try {
      await refreshLeaderboardView();
    } catch (err) {
      logger.warn({ err }, 'Failed to refresh leaderboard view');
    }

    // Save leaderboard snapshot every hour
    if (Date.now() - lastAggregation.timestamp > 60 * 60 * 1000) {
      const leaderboard = await dataStore.getLeaderboard('realized_pnl', 50);
      await dataStore.saveLeaderboardSnapshot(leaderboard, 'realized_pnl', 168);
    }

    lastAggregation.timestamp = Date.now();
    logger.info({ duration: Date.now() - startTime }, 'Full aggregation complete');
  } catch (err) {
    logger.error({ err }, 'Full aggregation failed');
  }
}

async function aggregateWalletStats(walletAddress: string): Promise<void> {
  try {
    const now = Date.now();
    const cutoff1h = now - 1 * 60 * 60 * 1000;
    const cutoff24h = now - 24 * 60 * 60 * 1000;
    const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;

    // Get trades from database
    const result = await query<any>(
      `SELECT
        side, outcome, size, price, usdc_size, timestamp, condition_id
       FROM trades_raw
       WHERE wallet_address = $1 AND timestamp >= $2
       ORDER BY timestamp ASC`,
      [walletAddress, cutoff7d]
    );

    const trades = result.rows;
    if (trades.length === 0) return;

    // Calculate rolling stats
    let volume1h = 0, volume24h = 0, volume7d = 0;
    let trades1h = 0, trades24h = 0, trades7d = 0;
    const markets = new Set<string>();
    const positions = new Map<string, { size: number; avgPrice: number; side: string }>();

    for (const trade of trades) {
      const volume = parseFloat(trade.usdc_size) || parseFloat(trade.size) * parseFloat(trade.price);
      const timestamp = parseInt(trade.timestamp);

      volume7d += volume;
      trades7d++;
      markets.add(trade.condition_id);

      if (timestamp >= cutoff24h) {
        volume24h += volume;
        trades24h++;
      }

      if (timestamp >= cutoff1h) {
        volume1h += volume;
        trades1h++;
      }

      // Track positions for unrealized PnL
      const posKey = `${trade.condition_id}_${trade.outcome}`;
      const pos = positions.get(posKey) || { size: 0, avgPrice: 0, side: trade.side };

      if (trade.side === 'BUY') {
        const newSize = pos.size + parseFloat(trade.size);
        pos.avgPrice = (pos.avgPrice * pos.size + parseFloat(trade.price) * parseFloat(trade.size)) / newSize;
        pos.size = newSize;
      } else {
        pos.size -= parseFloat(trade.size);
      }

      positions.set(posKey, pos);
    }

    // Calculate realized and unrealized PnL
    let realizedPnl = 0;
    let unrealizedPnl = 0;
    let settledTrades = 0;
    let winningTrades = 0;
    let openPositions = 0;

    // Get closed markets for realized PnL
    const closedMarkets = await dataStore.getClosedMarkets();
    const closedConditions = new Set(closedMarkets.map((m) => m.conditionId));

    for (const [posKey, pos] of positions) {
      const [conditionId, outcome] = posKey.split('_');

      if (pos.size <= 0.001) continue; // Negligible position

      const market = closedMarkets.find((m) => m.conditionId === conditionId);

      if (market?.isClosed && market.winningOutcome) {
        // Settled market - calculate realized PnL
        const exitPrice = market.winningOutcome.toUpperCase() === outcome.toUpperCase() ? 1.0 : 0.0;
        const pnl = (exitPrice - pos.avgPrice) * pos.size;
        realizedPnl += pnl;
        settledTrades++;
        if (pnl > 0) winningTrades++;
      } else {
        // Open market - calculate unrealized PnL
        openPositions++;
        // Get current price (use cached or fetch)
        const cachedMarket = await dataStore.getMarket(conditionId);
        let currentPrice = 0.5; // Default

        if (cachedMarket) {
          currentPrice = outcome.toUpperCase() === 'YES'
            ? (cachedMarket.lastPriceYes || 0.5)
            : (cachedMarket.lastPriceNo || 0.5);
        }

        unrealizedPnl += (currentPrice - pos.avgPrice) * pos.size;
      }
    }

    // Update stats
    await dataStore.upsertWalletStats({
      walletAddress,
      pnl1h: 0, // Would need more complex calculation
      pnl24h: 0,
      pnl7d: realizedPnl + unrealizedPnl,
      volume1h,
      volume24h,
      volume7d,
      trades1h,
      trades24h,
      trades7d,
      realizedPnl7d: realizedPnl,
      settledTrades7d: settledTrades,
      winningTrades7d: winningTrades,
      unrealizedPnl,
      openPositions,
      uniqueMarkets7d: markets.size,
      lastTradeSeen: new Date(Math.max(...trades.map((t: any) => parseInt(t.timestamp)))),
    });
  } catch (err) {
    logger.error({ err, wallet: walletAddress }, 'Failed to aggregate wallet');
  }
}

// ============================================
// Market Data Sync
// ============================================

export async function syncMarkets(): Promise<void> {
  logger.info('Syncing market data');

  try {
    // Get active markets
    const activeMarkets = await polymarketApi.getActiveMarkets(500);

    for (const market of activeMarkets) {
      let tokenIdYes: string | undefined;
      let tokenIdNo: string | undefined;

      if (market.clobTokenIds) {
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          tokenIdYes = tokenIds[0];
          tokenIdNo = tokenIds[1];
        } catch {}
      }

      let lastPriceYes: number | undefined;
      let lastPriceNo: number | undefined;

      if (market.outcomePrices) {
        try {
          const prices = JSON.parse(market.outcomePrices);
          lastPriceYes = parseFloat(prices[0]);
          lastPriceNo = parseFloat(prices[1]);
        } catch {}
      }

      await dataStore.upsertMarket({
        conditionId: market.conditionId,
        tokenIdYes,
        tokenIdNo,
        title: market.question,
        slug: market.slug,
        isClosed: market.closed || false,
        endDate: market.endDate ? new Date(market.endDate) : undefined,
        dailyVolume: market.volumeNum,
        totalLiquidity: market.liquidityNum,
        lastPriceYes,
        lastPriceNo,
      });
    }

    // Get recently closed markets for settlement data
    const closedMarkets = await polymarketApi.getRecentlyClosedMarkets(7);

    for (const market of closedMarkets) {
      let winningOutcome: string | undefined;
      let resolutionPriceYes: number | undefined;

      if (market.outcomePrices) {
        try {
          const prices = JSON.parse(market.outcomePrices);
          resolutionPriceYes = parseFloat(prices[0]);
          // If YES price is 1.0, YES won; if 0.0, NO won
          if (resolutionPriceYes >= 0.99) winningOutcome = 'YES';
          else if (resolutionPriceYes <= 0.01) winningOutcome = 'NO';
        } catch {}
      }

      await dataStore.upsertMarket({
        conditionId: market.conditionId,
        isClosed: true,
        winningOutcome,
        resolutionPriceYes,
      });
    }

    logger.info({ active: activeMarkets.length, closed: closedMarkets.length }, 'Market sync complete');
  } catch (err) {
    logger.error({ err }, 'Market sync failed');
  }
}

// ============================================
// Price Updates
// ============================================

export async function updatePrices(tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return;

  try {
    const prices = await polymarketApi.getBatchMidpoints(tokenIds);

    for (const [tokenId, price] of prices) {
      await dataStore.insertPriceTick({
        tokenId,
        timestamp: Date.now(),
        price,
        source: 'api',
      });
    }
  } catch (err) {
    logger.error({ err }, 'Price update failed');
  }
}

// ============================================
// Backfill
// ============================================

export async function backfillTrades(days: number = 7): Promise<void> {
  logger.info({ days }, 'Starting trade backfill');

  try {
    const startTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;
    const trades = await polymarketApi.getTradesSince(startTimestamp);

    logger.info({ tradeCount: trades.length }, 'Fetched trades for backfill');

    let inserted = 0;
    for (const trade of trades) {
      const success = await dataStore.insertTrade({
        walletAddress: trade.proxyWallet,
        conditionId: trade.conditionId,
        tokenId: trade.asset,
        side: trade.side,
        outcome: trade.outcome,
        size: parseFloat(trade.size),
        price: parseFloat(trade.price),
        usdcSize: trade.usdcSize ? parseFloat(trade.usdcSize) : undefined,
        timestamp: trade.timestamp,
        txHash: trade.transactionHash,
        marketTitle: trade.title,
        marketSlug: trade.slug,
      });

      if (success) inserted++;
    }

    logger.info({ inserted, total: trades.length }, 'Trade backfill complete');

    // Run full aggregation after backfill
    await runFullAggregation();
  } catch (err) {
    logger.error({ err }, 'Trade backfill failed');
  }
}

// ============================================
// Scheduler
// ============================================

let aggregationInterval: NodeJS.Timeout | null = null;
let marketSyncInterval: NodeJS.Timeout | null = null;

export function startAggregator(): void {
  logger.info('Starting aggregator workers');

  // Run full aggregation every 5 seconds
  aggregationInterval = setInterval(
    runFullAggregation,
    config.STATS_AGGREGATION_INTERVAL_MS
  );

  // Sync markets every 5 minutes
  marketSyncInterval = setInterval(syncMarkets, 5 * 60 * 1000);

  // Initial runs
  syncMarkets().catch((err) => logger.error({ err }, 'Initial market sync failed'));
  runFullAggregation().catch((err) => logger.error({ err }, 'Initial aggregation failed'));
}

export function stopAggregator(): void {
  if (aggregationInterval) {
    clearInterval(aggregationInterval);
    aggregationInterval = null;
  }
  if (marketSyncInterval) {
    clearInterval(marketSyncInterval);
    marketSyncInterval = null;
  }
}
