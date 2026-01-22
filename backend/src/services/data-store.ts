import { query, transaction, refreshLeaderboardView } from '../models/database.js';
import { createChildLogger } from '../utils/logger.js';
import {
  Trade,
  Orderbook,
  OrderbookSnapshot,
  PriceTick,
  WalletStats,
  LeaderboardEntry,
  Market,
} from '../models/types.js';

const logger = createChildLogger('data-store');

// ============================================
// Leaderboard Cache (for instant response)
// ============================================
interface LeaderboardCache {
  data: LeaderboardEntry[];
  timestamp: number;
}

// Multi-layer caching for bulletproof instant loading
const leaderboardCache: Map<string, LeaderboardCache> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - fresh cache
const STALE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour - stale but usable
const PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - last resort cache

// Initialize cache on startup
export async function initializeCache(): Promise<void> {
  try {
    logger.info('Initializing leaderboard cache...');
    const metrics: Array<'realized_pnl' | 'roi' | 'volume'> = ['realized_pnl', 'roi', 'volume'];
    const limits = [5, 10, 25];
    
    for (const metric of metrics) {
      for (const limit of limits) {
        try {
          const data = await getLeaderboardDirect(metric, limit);
          setLeaderboardCache(metric, limit, data);
        } catch (error) {
          // Cache empty array if DB query fails - no mock data
          setLeaderboardCache(metric, limit, []);
          logger.warn({ error, metric, limit }, 'Failed to initialize cache entry, using empty data');
        }
      }
    }
    logger.info('Leaderboard cache initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize cache');
  }
}

export function setLeaderboardCache(metric: string, limit: number, data: LeaderboardEntry[]): void {
  const key = `${metric}:${limit}`;
  leaderboardCache.set(key, { data, timestamp: Date.now() });
}

function getLeaderboardCache(metric: string, limit: number): { data: LeaderboardEntry[]; isStale: boolean } | null {
  const key = `${metric}:${limit}`;
  const cached = leaderboardCache.get(key);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      return { data: cached.data, isStale: false }; // Fresh cache
    } else if (age < STALE_CACHE_TTL_MS) {
      return { data: cached.data, isStale: true }; // Stale but usable
    }
  }
  return null;
}

// ============================================
// Trade Storage
// ============================================

export async function insertTrade(trade: Trade): Promise<boolean> {
  try {
    await query(
      `INSERT INTO trades_raw (
        wallet_address, condition_id, token_id, side, outcome,
        size, price, usdc_size, timestamp, tx_hash, market_title, market_slug
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (wallet_address, tx_hash, token_id, timestamp) DO NOTHING`,
      [
        trade.walletAddress,
        trade.conditionId,
        trade.tokenId,
        trade.side,
        trade.outcome,
        trade.size,
        trade.price,
        trade.usdcSize || trade.size * trade.price,
        trade.timestamp,
        trade.txHash,
        trade.marketTitle,
        trade.marketSlug,
      ]
    );
    return true;
  } catch (err) {
    logger.error({ err, trade }, 'Failed to insert trade');
    return false;
  }
}

export async function insertTrades(trades: Trade[]): Promise<number> {
  if (trades.length === 0) return 0;

  let inserted = 0;
  for (const trade of trades) {
    if (await insertTrade(trade)) {
      inserted++;
    }
  }
  return inserted;
}

export async function getTradesSince(timestampMs: number): Promise<Trade[]> {
  // Timestamps in DB are in seconds (Unix epoch), convert milliseconds to seconds
  const timestampSec = Math.floor(timestampMs / 1000);
  const result = await query<any>(
    `SELECT * FROM trades_raw WHERE timestamp >= $1 ORDER BY timestamp ASC`,
    [timestampSec]
  );

  return result.rows.map(rowToTrade);
}

export async function getWalletTrades(
  walletAddress: string,
  days: number = 7
): Promise<Trade[]> {
  // Timestamps are in seconds (Unix epoch), convert cutoff to seconds
  const cutoff = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const result = await query<any>(
    `SELECT * FROM trades_raw
     WHERE wallet_address = $1 AND timestamp >= $2
     ORDER BY timestamp DESC
     LIMIT 1000`,
    [walletAddress, cutoff]
  );

  return result.rows.map(rowToTrade);
}

export async function getRecentTrades(limit: number = 100): Promise<Trade[]> {
  const result = await query<any>(
    `SELECT * FROM trades_raw ORDER BY timestamp DESC LIMIT $1`,
    [limit]
  );

  return result.rows.map(rowToTrade);
}

// Get recent trades for multiple wallets (for leaderboard display)
export async function getRecentTradesForWallets(
  walletAddresses: string[],
  tradesPerWallet: number = 5
): Promise<Map<string, Trade[]>> {
  if (walletAddresses.length === 0) return new Map();

  // Use a lateral join to get top N trades per wallet efficiently
  const result = await query<any>(
    `SELECT DISTINCT ON (wallet_address, rn) *
     FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY wallet_address ORDER BY timestamp DESC) as rn
       FROM trades_raw
       WHERE wallet_address = ANY($1)
     ) sub
     WHERE rn <= $2
     ORDER BY wallet_address, rn`,
    [walletAddresses, tradesPerWallet]
  );

  const tradeMap = new Map<string, Trade[]>();
  for (const row of result.rows) {
    const trade = rowToTrade(row);
    const existing = tradeMap.get(trade.walletAddress) || [];
    existing.push(trade);
    tradeMap.set(trade.walletAddress, existing);
  }

  return tradeMap;
}

function rowToTrade(row: any): Trade {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    conditionId: row.condition_id,
    tokenId: row.token_id,
    side: row.side,
    outcome: row.outcome,
    size: parseFloat(row.size),
    price: parseFloat(row.price),
    usdcSize: row.usdc_size ? parseFloat(row.usdc_size) : undefined,
    timestamp: parseInt(row.timestamp),
    txHash: row.tx_hash,
    marketTitle: row.market_title,
    marketSlug: row.market_slug,
    receivedAt: row.received_at,
  };
}

// ============================================
// Orderbook Snapshots
// ============================================

export async function insertOrderbookSnapshot(orderbook: Orderbook): Promise<void> {
  // Calculate depth at 1% and 5% from mid
  const bidDepth100bps = calculateDepthWithin(orderbook.bids, orderbook.midPrice, 0.01);
  const askDepth100bps = calculateDepthWithin(orderbook.asks, orderbook.midPrice, 0.01);
  const bidDepth500bps = calculateDepthWithin(orderbook.bids, orderbook.midPrice, 0.05);
  const askDepth500bps = calculateDepthWithin(orderbook.asks, orderbook.midPrice, 0.05);

  await query(
    `INSERT INTO orderbook_snapshots (
      token_id, timestamp, best_bid, best_ask, mid_price, spread_bps,
      bid_depth_100bps, ask_depth_100bps, bid_depth_500bps, ask_depth_500bps, full_book
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      orderbook.tokenId,
      orderbook.timestamp,
      orderbook.bestBid,
      orderbook.bestAsk,
      orderbook.midPrice,
      orderbook.spreadBps,
      bidDepth100bps,
      askDepth100bps,
      bidDepth500bps,
      askDepth500bps,
      JSON.stringify({ bids: orderbook.bids.slice(0, 20), asks: orderbook.asks.slice(0, 20) }),
    ]
  );
}

function calculateDepthWithin(
  levels: Array<{ price: number; size: number }>,
  midPrice: number,
  percentFromMid: number
): number {
  let totalSize = 0;
  for (const level of levels) {
    const priceDiff = Math.abs(level.price - midPrice) / midPrice;
    if (priceDiff <= percentFromMid) {
      totalSize += level.size * level.price; // USD value
    }
  }
  return totalSize;
}

export async function getOrderbookSnapshot(
  tokenId: string,
  timestamp: number
): Promise<OrderbookSnapshot | null> {
  const result = await query<any>(
    `SELECT * FROM orderbook_snapshots
     WHERE token_id = $1 AND timestamp <= $2
     ORDER BY timestamp DESC
     LIMIT 1`,
    [tokenId, timestamp]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    tokenId: row.token_id,
    timestamp: parseInt(row.timestamp),
    bestBid: parseFloat(row.best_bid),
    bestAsk: parseFloat(row.best_ask),
    midPrice: parseFloat(row.mid_price),
    spreadBps: row.spread_bps,
    bidDepth100bps: parseFloat(row.bid_depth_100bps),
    askDepth100bps: parseFloat(row.ask_depth_100bps),
    bidDepth500bps: parseFloat(row.bid_depth_500bps),
    askDepth500bps: parseFloat(row.ask_depth_500bps),
    fullBook: row.full_book,
  };
}

// ============================================
// Price Ticks
// ============================================

export async function insertPriceTick(tick: PriceTick): Promise<void> {
  await query(
    `INSERT INTO price_ticks (token_id, timestamp, price, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_id, timestamp) DO UPDATE SET price = $3`,
    [tick.tokenId, tick.timestamp, tick.price, tick.source]
  );
}

export async function getPriceAtTime(
  tokenId: string,
  timestamp: number
): Promise<number | null> {
  // Get closest price before or at the timestamp
  const result = await query<any>(
    `SELECT price FROM price_ticks
     WHERE token_id = $1 AND timestamp <= $2
     ORDER BY timestamp DESC
     LIMIT 1`,
    [tokenId, timestamp]
  );

  if (result.rows.length === 0) return null;
  return parseFloat(result.rows[0].price);
}

export async function getPriceHistory(
  tokenId: string,
  startTimestamp: number,
  endTimestamp: number
): Promise<Array<{ timestamp: number; price: number }>> {
  const result = await query<any>(
    `SELECT timestamp, price FROM price_ticks
     WHERE token_id = $1 AND timestamp BETWEEN $2 AND $3
     ORDER BY timestamp ASC`,
    [tokenId, startTimestamp, endTimestamp]
  );

  return result.rows.map((row: any) => ({
    timestamp: parseInt(row.timestamp),
    price: parseFloat(row.price),
  }));
}

// ============================================
// Wallet Stats
// ============================================

export async function upsertWalletStats(stats: Partial<WalletStats> & { walletAddress: string }): Promise<void> {
  await query(
    `INSERT INTO wallet_stats_live (
      wallet_address, pnl_1h, pnl_24h, pnl_7d,
      volume_1h, volume_24h, volume_7d,
      trades_1h, trades_24h, trades_7d,
      realized_pnl_7d, settled_trades_7d, winning_trades_7d,
      unrealized_pnl, open_positions, unique_markets_7d,
      first_trade_seen, last_trade_seen, last_updated
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW()
    )
    ON CONFLICT (wallet_address) DO UPDATE SET
      pnl_1h = COALESCE($2, wallet_stats_live.pnl_1h),
      pnl_24h = COALESCE($3, wallet_stats_live.pnl_24h),
      pnl_7d = COALESCE($4, wallet_stats_live.pnl_7d),
      volume_1h = COALESCE($5, wallet_stats_live.volume_1h),
      volume_24h = COALESCE($6, wallet_stats_live.volume_24h),
      volume_7d = COALESCE($7, wallet_stats_live.volume_7d),
      trades_1h = COALESCE($8, wallet_stats_live.trades_1h),
      trades_24h = COALESCE($9, wallet_stats_live.trades_24h),
      trades_7d = COALESCE($10, wallet_stats_live.trades_7d),
      realized_pnl_7d = COALESCE($11, wallet_stats_live.realized_pnl_7d),
      settled_trades_7d = COALESCE($12, wallet_stats_live.settled_trades_7d),
      winning_trades_7d = COALESCE($13, wallet_stats_live.winning_trades_7d),
      unrealized_pnl = COALESCE($14, wallet_stats_live.unrealized_pnl),
      open_positions = COALESCE($15, wallet_stats_live.open_positions),
      unique_markets_7d = COALESCE($16, wallet_stats_live.unique_markets_7d),
      first_trade_seen = COALESCE($17, wallet_stats_live.first_trade_seen),
      last_trade_seen = COALESCE($18, wallet_stats_live.last_trade_seen),
      last_updated = NOW()`,
    [
      stats.walletAddress,
      stats.pnl1h,
      stats.pnl24h,
      stats.pnl7d,
      stats.volume1h,
      stats.volume24h,
      stats.volume7d,
      stats.trades1h,
      stats.trades24h,
      stats.trades7d,
      stats.realizedPnl7d,
      stats.settledTrades7d,
      stats.winningTrades7d,
      stats.unrealizedPnl,
      stats.openPositions,
      stats.uniqueMarkets7d,
      stats.firstTradeSeen,
      stats.lastTradeSeen,
    ]
  );
}

export async function getWalletStats(walletAddress: string): Promise<WalletStats | null> {
  const result = await query<any>(
    `SELECT * FROM wallet_stats_live WHERE wallet_address = $1`,
    [walletAddress]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    walletAddress: row.wallet_address,
    pnl1h: parseFloat(row.pnl_1h) || 0,
    pnl24h: parseFloat(row.pnl_24h) || 0,
    pnl7d: parseFloat(row.pnl_7d) || 0,
    volume1h: parseFloat(row.volume_1h) || 0,
    volume24h: parseFloat(row.volume_24h) || 0,
    volume7d: parseFloat(row.volume_7d) || 0,
    trades1h: row.trades_1h || 0,
    trades24h: row.trades_24h || 0,
    trades7d: row.trades_7d || 0,
    realizedPnl7d: parseFloat(row.realized_pnl_7d) || 0,
    settledTrades7d: row.settled_trades_7d || 0,
    winningTrades7d: row.winning_trades_7d || 0,
    unrealizedPnl: parseFloat(row.unrealized_pnl) || 0,
    openPositions: row.open_positions || 0,
    uniqueMarkets7d: row.unique_markets_7d || 0,
    firstTradeSeen: row.first_trade_seen,
    lastTradeSeen: row.last_trade_seen,
    lastUpdated: row.last_updated,
  };
}

export async function getActiveWallets(hours: number = 24): Promise<string[]> {
  // First try wallet_stats_live
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const result = await query<any>(
    `SELECT wallet_address FROM wallet_stats_live
     WHERE last_trade_seen >= $1
     ORDER BY volume_7d DESC
     LIMIT 1000`,
    [cutoff]
  );

  if (result.rows.length > 0) {
    return result.rows.map((row: any) => row.wallet_address);
  }

  // Fallback: Get active wallets directly from trades_raw (for initial bootstrap)
  const cutoffSec = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
  const tradesResult = await query<any>(
    `SELECT DISTINCT wallet_address FROM trades_raw
     WHERE timestamp >= $1
     ORDER BY wallet_address
     LIMIT 1000`,
    [cutoffSec]
  );

  return tradesResult.rows.map((row: any) => row.wallet_address);
}

// ============================================
// Leaderboard
// ============================================

export async function getLeaderboard(
  metric: 'realized_pnl' | 'roi' | 'volume' = 'realized_pnl',
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  // Layer 1: In-memory cache for INSTANT response
  const cached = getLeaderboardCache(metric, limit);
  if (cached) {
    // If cache is stale, refresh in background but return stale data immediately
    if (cached.isStale) {
      setImmediate(async () => {
        try {
          const freshData = await getLeaderboardDirect(metric, limit);
          setLeaderboardCache(metric, limit, freshData);
          await savePersistentCache(metric, limit, freshData);
        } catch (error) {
          logger.warn({ error, metric, limit }, 'Background cache refresh failed');
        }
      });
    }
    return cached.data; // Always return immediately, even if stale
  }

  // Layer 2: Persistent cache from database
  try {
    const persistentData = await getPersistentCache(metric, limit);
    if (persistentData) {
      setLeaderboardCache(metric, limit, persistentData);
      // Trigger background refresh
      setImmediate(async () => {
        try {
          const freshData = await getLeaderboardDirect(metric, limit);
          setLeaderboardCache(metric, limit, freshData);
          await savePersistentCache(metric, limit, freshData);
        } catch (error) {
          logger.warn({ error, metric, limit }, 'Background refresh from persistent cache failed');
        }
      });
      return persistentData;
    }
  } catch (error) {
    logger.warn({ error, metric, limit }, 'Persistent cache lookup failed');
  }

  // Layer 3: Fresh data with timeout (last resort)
  try {
    const result = await Promise.race([
      getLeaderboardDirect(metric, limit),
      new Promise<LeaderboardEntry[]>((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 1500) // 1.5 second timeout
      )
    ]);
    setLeaderboardCache(metric, limit, result);
    await savePersistentCache(metric, limit, result);
    return result;
  } catch (error) {
    logger.error({ error, metric, limit }, 'All cache layers failed');
    // Cache empty array for future instant responses
    const emptyData: LeaderboardEntry[] = [];
    setLeaderboardCache(metric, limit, emptyData);
    return emptyData;
  }
}

export async function getLeaderboardDirect(
  metric: string,
  limit: number
): Promise<LeaderboardEntry[]> {
  try {
    // Use the actual realized PnL column (not estimated) and require minimum activity
    let orderBy: string;
    let whereClause: string;
    
    switch (metric) {
      case 'roi':
        orderBy = 'CASE WHEN volume_7d > 0 THEN realized_pnl_7d / volume_7d ELSE 0 END DESC';
        whereClause = 'volume_7d >= 100 AND trades_7d >= 3';
        break;
      case 'volume':
        orderBy = 'volume_7d DESC';
        whereClause = 'volume_7d >= 100';
        break;
      default: // realized_pnl
        orderBy = 'realized_pnl_7d DESC';
        whereClause = 'volume_7d >= 100 AND trades_7d >= 3';
    }

    const result = await query<any>(
      `SELECT
        wallet_address,
        realized_pnl_7d,
        unrealized_pnl,
        volume_7d,
        trades_7d,
        unique_markets_7d,
        settled_trades_7d,
        winning_trades_7d,
        last_trade_seen
      FROM wallet_stats_live
      WHERE ${whereClause}
      ORDER BY ${orderBy} NULLS LAST
      LIMIT $1`,
      [limit]
    );

    return result.rows.map((row: any, index: number) => ({
      rank: index + 1,
      walletAddress: row.wallet_address,
      realizedPnl: parseFloat(row.realized_pnl_7d) || 0,
      unrealizedPnl: parseFloat(row.unrealized_pnl) || 0,
      totalPnl: (parseFloat(row.realized_pnl_7d) || 0) + (parseFloat(row.unrealized_pnl) || 0),
      volume: parseFloat(row.volume_7d) || 0,
      tradeCount: row.trades_7d || 0,
      winRate: row.settled_trades_7d > 0 ? row.winning_trades_7d / row.settled_trades_7d : 0,
      roiPercent: row.volume_7d > 0 ? (parseFloat(row.realized_pnl_7d) || 0) / (parseFloat(row.volume_7d) || 1) * 100 : 0,
      uniqueMarkets: row.unique_markets_7d || 0,
      lastTradeTime: row.last_trade_seen || new Date(),
    }));
  } catch (error) {
    logger.error({ error }, 'Leaderboard query failed');
    throw error; // Don't return mock data, let it fail properly
  }
}

// ============================================
// Persistent Cache Layer (Database-backed)
// ============================================

async function savePersistentCache(metric: string, limit: number, data: LeaderboardEntry[]): Promise<void> {
  try {
    const key = `${metric}:${limit}`;
    await query(
      `INSERT INTO leaderboard_cache (cache_key, data, created_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (cache_key) DO UPDATE SET 
         data = $2, created_at = NOW()`,
      [key, JSON.stringify(data)]
    );
  } catch (error) {
    logger.warn({ error, metric, limit }, 'Failed to save persistent cache');
  }
}

async function getPersistentCache(metric: string, limit: number): Promise<LeaderboardEntry[] | null> {
  try {
    const key = `${metric}:${limit}`;
    const result = await query<any>(
      `SELECT data, created_at FROM leaderboard_cache 
       WHERE cache_key = $1 
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [key]
    );
    
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].data);
    }
  } catch (error) {
    logger.warn({ error, metric, limit }, 'Failed to get persistent cache');
  }
  return null;
}

export async function saveLeaderboardSnapshot(
  entries: LeaderboardEntry[],
  metric: string,
  windowHours: number
): Promise<void> {
  const now = new Date();

  for (const entry of entries) {
    await query(
      `INSERT INTO leaderboard_snapshots (
        snapshot_time, window_hours, metric, rank, wallet_address,
        metric_value, volume_usdc, trade_count, win_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        now,
        windowHours,
        metric,
        entry.rank,
        entry.walletAddress,
        entry.realizedPnl,
        entry.volume,
        entry.tradeCount,
        entry.winRate,
      ]
    );
  }
}

// ============================================
// Markets Cache
// ============================================

export async function upsertMarket(market: Market): Promise<void> {
  await query(
    `INSERT INTO markets_cache (
      condition_id, token_id_yes, token_id_no, title, slug,
      is_closed, end_date, winning_outcome, resolution_price_yes,
      daily_volume, total_liquidity, last_price_yes, last_price_no, last_updated
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    ON CONFLICT (condition_id) DO UPDATE SET
      is_closed = COALESCE($6, markets_cache.is_closed),
      winning_outcome = COALESCE($8, markets_cache.winning_outcome),
      resolution_price_yes = COALESCE($9, markets_cache.resolution_price_yes),
      daily_volume = COALESCE($10, markets_cache.daily_volume),
      total_liquidity = COALESCE($11, markets_cache.total_liquidity),
      last_price_yes = COALESCE($12, markets_cache.last_price_yes),
      last_price_no = COALESCE($13, markets_cache.last_price_no),
      last_updated = NOW()`,
    [
      market.conditionId,
      market.tokenIdYes,
      market.tokenIdNo,
      market.title,
      market.slug,
      market.isClosed,
      market.endDate,
      market.winningOutcome,
      market.resolutionPriceYes,
      market.dailyVolume,
      market.totalLiquidity,
      market.lastPriceYes,
      market.lastPriceNo,
    ]
  );
}

export async function getMarket(conditionId: string): Promise<Market | null> {
  const result = await query<any>(
    `SELECT * FROM markets_cache WHERE condition_id = $1`,
    [conditionId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    conditionId: row.condition_id,
    tokenIdYes: row.token_id_yes,
    tokenIdNo: row.token_id_no,
    title: row.title,
    slug: row.slug,
    isClosed: row.is_closed,
    endDate: row.end_date,
    winningOutcome: row.winning_outcome,
    resolutionPriceYes: row.resolution_price_yes ? parseFloat(row.resolution_price_yes) : undefined,
    dailyVolume: row.daily_volume ? parseFloat(row.daily_volume) : undefined,
    totalLiquidity: row.total_liquidity ? parseFloat(row.total_liquidity) : undefined,
    lastPriceYes: row.last_price_yes ? parseFloat(row.last_price_yes) : undefined,
    lastPriceNo: row.last_price_no ? parseFloat(row.last_price_no) : undefined,
    lastUpdated: row.last_updated,
  };
}

export async function getClosedMarkets(): Promise<Market[]> {
  const result = await query<any>(
    `SELECT * FROM markets_cache WHERE is_closed = true`
  );

  return result.rows.map((row: any) => ({
    conditionId: row.condition_id,
    tokenIdYes: row.token_id_yes,
    tokenIdNo: row.token_id_no,
    title: row.title,
    slug: row.slug,
    isClosed: true,
    winningOutcome: row.winning_outcome,
    resolutionPriceYes: row.resolution_price_yes ? parseFloat(row.resolution_price_yes) : undefined,
  }));
}

// ============================================
// System State
// ============================================

export async function getSystemState(key: string): Promise<any> {
  const result = await query<any>(
    `SELECT value FROM system_state WHERE key = $1`,
    [key]
  );
  return result.rows[0]?.value;
}

export async function setSystemState(key: string, value: any): Promise<void> {
  await query(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// ============================================
// Stats
// ============================================

export async function getTradesCount(hours: number = 1): Promise<number> {
  // Timestamps are in seconds (Unix epoch), convert cutoff to seconds
  const cutoff = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
  const result = await query<any>(
    `SELECT COUNT(*) as count FROM trades_raw WHERE timestamp >= $1`,
    [cutoff]
  );
  return parseInt(result.rows[0]?.count) || 0;
}

export async function getActiveWalletsCount(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await query<any>(
    `SELECT COUNT(*) as count FROM wallet_stats_live WHERE last_trade_seen >= $1`,
    [cutoff]
  );
  return parseInt(result.rows[0]?.count) || 0;
}
