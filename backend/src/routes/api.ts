import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createChildLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { checkConnection } from '../models/database.js';
import * as dataStore from '../services/data-store.js';
import { wsStream } from '../services/websocket-stream.js';
import { runSimulation, getQuickEstimate } from '../services/simulator.js';
import { getLastAggregationTime } from '../workers/aggregator.js';
import { SimulationConfigSchema } from '../models/types.js';
import { polymarketApi } from '../services/polymarket-api.js';

const logger = createChildLogger('api');

// Profile cache to avoid repeated API calls
const profileCache = new Map<string, { displayName?: string; profileImageUrl?: string; cachedAt: number }>();
const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getProfilesForWallets(walletAddresses: string[]): Promise<Map<string, { displayName?: string; profileImageUrl?: string }>> {
  const result = new Map<string, { displayName?: string; profileImageUrl?: string }>();
  const uncachedAddresses: string[] = [];

  // Check cache first
  for (const address of walletAddresses) {
    const cached = profileCache.get(address.toLowerCase());
    if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL_MS) {
      result.set(address.toLowerCase(), { displayName: cached.displayName, profileImageUrl: cached.profileImageUrl });
    } else {
      uncachedAddresses.push(address);
    }
  }

  // Fetch uncached profiles
  if (uncachedAddresses.length > 0) {
    try {
      const profiles = await polymarketApi.getBatchUserProfiles(uncachedAddresses);
      for (const [address, profile] of profiles) {
        const cacheEntry = {
          displayName: profile.username,
          profileImageUrl: profile.profileImage,
          cachedAt: Date.now(),
        };
        profileCache.set(address.toLowerCase(), cacheEntry);
        result.set(address.toLowerCase(), { displayName: profile.username, profileImageUrl: profile.profileImage });
      }
      // Cache misses (no profile found) too
      for (const address of uncachedAddresses) {
        if (!profiles.has(address.toLowerCase())) {
          profileCache.set(address.toLowerCase(), { cachedAt: Date.now() });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch user profiles');
    }
  }

  return result;
}
const router = Router();

// ============================================
// Health Check
// ============================================

router.get('/health', async (req: Request, res: Response) => {
  try {
    const dbConnected = await checkConnection();
    const wsStatus = wsStream.getStatus();
    const tradesLast1h = await dataStore.getTradesCount(1);
    const activeWallets = await dataStore.getActiveWalletsCount();

    const lastTradeResult = await dataStore.getRecentTrades(1);
    const lastTrade = lastTradeResult[0];

    const status = dbConnected && (wsStatus.tradeStream || wsStatus.orderbookStream)
      ? 'healthy'
      : dbConnected
      ? 'degraded'
      : 'unhealthy';

    res.json({
      status,
      timestamp: new Date().toISOString(),
      lastTradeIngested: lastTrade ? new Date(lastTrade.timestamp * 1000).toISOString() : null,
      lastAggregation: new Date(getLastAggregationTime() || Date.now()).toISOString(),
      dbConnected,
      wsConnected: wsStatus.tradeStream,
      wsOrderbookConnected: wsStatus.orderbookStream,
      tradesLast1h,
      activeWallets,
    });
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(500).json({ status: 'unhealthy', error: 'Health check failed' });
  }
});

// ============================================
// Leaderboard
// ============================================

const LeaderboardQuerySchema = z.object({
  window: z.enum(['1h', '24h', '7d']).default('7d'),
  metric: z.enum(['realized_pnl', 'roi', 'volume']).default('realized_pnl'),
  limit: z.coerce.number().min(1).max(50).default(10),
});

router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const params = LeaderboardQuerySchema.parse(req.query);
    const includeTrades = req.query.includeTrades === 'true';
    const includeProfiles = req.query.includeProfiles === 'true';

    const leaderboard = await dataStore.getLeaderboard(
      params.metric as any,
      params.limit
    );

    // Optionally fetch user profiles (disabled by default for performance)
    let profilesMap = new Map<string, { displayName?: string; profileImageUrl?: string }>();
    if (includeProfiles && leaderboard.length > 0) {
      profilesMap = await getProfilesForWallets(
        leaderboard.map(e => e.walletAddress)
      );
    }

    // Optionally fetch recent trades for each wallet (for detailed view)
    let recentTradesMap = new Map<string, any[]>();
    if (includeTrades && leaderboard.length > 0) {
      recentTradesMap = await dataStore.getRecentTradesForWallets(
        leaderboard.map(e => e.walletAddress),
        5 // 5 most recent trades per wallet
      );
    }

    res.json({
      timestamp: new Date().toISOString(),
      window: params.window,
      metric: params.metric,
      leaderboard: leaderboard.map((entry) => {
        const profile = profilesMap.get(entry.walletAddress.toLowerCase());
        return {
          ...entry,
          // Add profile info (only if requested)
          displayName: profile?.displayName,
          profileImageUrl: profile?.profileImageUrl,
          // Convert to GBP for display
          realizedPnlGbp: entry.realizedPnl / config.GBP_USD_RATE,
          unrealizedPnlGbp: entry.unrealizedPnl / config.GBP_USD_RATE,
          totalPnlGbp: entry.totalPnl / config.GBP_USD_RATE,
          volumeGbp: entry.volume / config.GBP_USD_RATE,
          // Include recent trades if requested
          recentTrades: includeTrades ? (recentTradesMap.get(entry.walletAddress) || []).map(t => ({
            side: t.side,
            outcome: t.outcome,
            size: t.size,
            price: t.price,
            usdcSize: t.usdcSize,
            usdcSizeGbp: (t.usdcSize || t.size * t.price) / config.GBP_USD_RATE,
            marketTitle: t.marketTitle,
            marketSlug: t.marketSlug,
            timestamp: t.timestamp,
          })) : undefined,
        };
      }),
      lastUpdated: new Date(getLastAggregationTime() || Date.now()).toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Leaderboard fetch failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid parameters', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  }
});

// ============================================
// Wallet Details
// ============================================

router.get('/wallet/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const [stats, trades] = await Promise.all([
      dataStore.getWalletStats(address),
      dataStore.getWalletTrades(address, 7),
    ]);

    if (!stats) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Build PnL chart from trades
    const pnlChart: Array<{ timestamp: number; cumulativePnl: number }> = [];
    let cumulativePnl = 0;

    for (const trade of trades.sort((a, b) => a.timestamp - b.timestamp)) {
      // Simplified PnL calculation
      const value = trade.usdcSize || trade.size * trade.price;
      if (trade.side === 'SELL') {
        cumulativePnl += value * 0.1; // Rough estimate
      }
      pnlChart.push({
        timestamp: trade.timestamp,
        cumulativePnl,
      });
    }

    res.json({
      walletAddress: address,
      stats: {
        '1h': {
          pnl: stats.pnl1h,
          volume: stats.volume1h,
          trades: stats.trades1h,
        },
        '24h': {
          pnl: stats.pnl24h,
          volume: stats.volume24h,
          trades: stats.trades24h,
        },
        '7d': {
          pnl: stats.pnl7d,
          pnlGbp: stats.pnl7d / config.GBP_USD_RATE,
          volume: stats.volume7d,
          volumeGbp: stats.volume7d / config.GBP_USD_RATE,
          trades: stats.trades7d,
          realizedPnl: stats.realizedPnl7d,
          realizedPnlGbp: stats.realizedPnl7d / config.GBP_USD_RATE,
          unrealizedPnl: stats.unrealizedPnl,
          winRate: stats.settledTrades7d > 0
            ? stats.winningTrades7d / stats.settledTrades7d
            : 0,
          uniqueMarkets: stats.uniqueMarkets7d,
        },
      },
      recentTrades: trades.slice(0, 50).map((t) => ({
        ...t,
        usdcSizeGbp: (t.usdcSize || t.size * t.price) / config.GBP_USD_RATE,
      })),
      pnlChart,
      lastUpdated: stats.lastUpdated?.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Wallet fetch failed');
    res.status(500).json({ error: 'Failed to fetch wallet data' });
  }
});

// ============================================
// Copy Trading Simulator
// ============================================

router.post('/follower-sim', async (req: Request, res: Response) => {
  try {
    const cfg = SimulationConfigSchema.parse(req.body);

    // Limit simulations to prevent abuse
    if (cfg.numSimulations > config.MAX_SIMULATIONS_PER_REQUEST) {
      cfg.numSimulations = config.MAX_SIMULATIONS_PER_REQUEST;
    }

    const results = await runSimulation(cfg);

    res.json({
      ...results,
      // Add GBP conversions
      resultsGbp: {
        pnlP5: results.results.pnlP5,
        pnlP25: results.results.pnlP25,
        pnlMedian: results.results.pnlMedian,
        pnlP75: results.results.pnlP75,
        pnlP95: results.results.pnlP95,
        pnlMean: results.results.pnlMean,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Simulation failed');
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid parameters', details: err.errors });
    } else {
      res.status(500).json({ error: 'Simulation failed', message: (err as Error).message });
    }
  }
});

// GET version for quick estimates
router.get('/follower-sim', async (req: Request, res: Response) => {
  try {
    const bankroll = parseFloat(req.query.bankroll_gbp as string) || 100;
    const estimate = await getQuickEstimate(bankroll);

    res.json({
      type: 'quick_estimate',
      bankrollGbp: bankroll,
      ...estimate,
    });
  } catch (err) {
    logger.error({ err }, 'Quick estimate failed');
    res.status(500).json({ error: 'Failed to generate estimate' });
  }
});

// ============================================
// Server-Sent Events for Live Updates
// ============================================

const sseClients = new Set<Response>();

router.get('/stream/leaderboard', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  sseClients.add(res);

  // Send initial data
  dataStore.getLeaderboard('realized_pnl', 10).then((leaderboard) => {
    res.write(`data: ${JSON.stringify({ type: 'leaderboard', data: leaderboard })}\n\n`);
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(keepAlive);
  });
});

// Broadcast leaderboard updates to SSE clients
export function broadcastLeaderboard(leaderboard: any[]): void {
  const data = JSON.stringify({ type: 'leaderboard', data: leaderboard, timestamp: Date.now() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (e) {
      // Client disconnected
    }
  }
}

// Broadcast status updates to SSE clients
export async function broadcastStatus(): Promise<void> {
  try {
    const [tradesLast1h, activeWallets] = await Promise.all([
      dataStore.getTradesCount(1),
      dataStore.getActiveWalletsCount(),
    ]);

    const wsStatus = wsStream.getStatus();
    const status = {
      type: 'status',
      data: {
        tradesLast1h,
        activeWallets,
        wsConnected: wsStatus.tradeStream,
        lastAggregation: getLastAggregationTime(),
      },
      timestamp: Date.now(),
    };

    const data = JSON.stringify(status);
    for (const client of sseClients) {
      try {
        client.write(`data: ${data}\n\n`);
      } catch (e) {
        // Client disconnected
      }
    }
  } catch (e) {
    // Ignore broadcast errors
  }
}

router.get('/stream/trades/:address', (req: Request, res: Response) => {
  const { address } = req.params;

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// ============================================
// Recent Trades
// ============================================

router.get('/trades/recent', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const trades = await dataStore.getRecentTrades(limit);

    res.json({
      trades: trades.map((t) => ({
        ...t,
        usdcSizeGbp: (t.usdcSize || t.size * t.price) / config.GBP_USD_RATE,
      })),
      count: trades.length,
    });
  } catch (err) {
    logger.error({ err }, 'Recent trades fetch failed');
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// ============================================
// Stats
// ============================================

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const [tradesLast1h, tradesLast24h, activeWallets] = await Promise.all([
      dataStore.getTradesCount(1),
      dataStore.getTradesCount(24),
      dataStore.getActiveWalletsCount(),
    ]);

    res.json({
      tradesLast1h,
      tradesLast24h,
      activeWallets,
      lastAggregation: new Date(getLastAggregationTime() || Date.now()).toISOString(),
      gbpUsdRate: config.GBP_USD_RATE,
    });
  } catch (err) {
    logger.error({ err }, 'Stats fetch failed');
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
