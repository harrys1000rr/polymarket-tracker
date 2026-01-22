import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { config } from './config.js';
import { logger, createChildLogger } from './utils/logger.js';
import { runMigrations, checkConnection, cleanupOldData } from './models/database.js';
import { wsStream } from './services/websocket-stream.js';
import * as dataStore from './services/data-store.js';
import {
  startAggregator,
  stopAggregator,
  processTrade,
  backfillTrades,
  syncMarkets,
} from './workers/aggregator.js';
import apiRoutes, { broadcastLeaderboard, broadcastStatus } from './routes/api.js';
import { Trade } from './models/types.js';

const log = createChildLogger('main');

async function main() {
  log.info({ env: config.NODE_ENV, port: config.PORT }, 'Starting Polymarket Tracker');

  // ============================================
  // Database Setup
  // ============================================

  log.info('Connecting to database...');
  const dbOk = await checkConnection();
  if (!dbOk) {
    log.error('Database connection failed');
    process.exit(1);
  }
  log.info('Database connected');

  log.info('Running migrations...');
  await runMigrations();
  
  // Initialize cache in background for instant responses
  log.info('Initializing leaderboard cache in background...');
  dataStore.initializeCache().catch((err) => {
    log.warn({ err }, 'Cache initialization failed, will use empty cache');
  });

  // ============================================
  // Express Server
  // ============================================

  const app = express();

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Allow SSE
  }));
  app.use(cors());
  app.use(compression());
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > 1000 || res.statusCode >= 400) {
        log.info({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
        });
      }
    });
    next();
  });

  // API Routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Polymarket Tracker API',
      version: '1.0.0',
      description: 'Real-time Polymarket trader monitoring and copy performance simulator',
      endpoints: {
        health: '/api/health',
        leaderboard: '/api/leaderboard',
        wallet: '/api/wallet/:address',
        simulator: '/api/follower-sim',
        stream: '/api/stream/leaderboard',
        stats: '/api/stats',
      },
      disclaimer: 'HYPOTHETICAL SIMULATION ONLY - NOT FINANCIAL ADVICE',
    });
  });

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    log.error({ err, path: req.path }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(config.PORT, () => {
    log.info({ port: config.PORT }, 'HTTP server started');
  });

  // ============================================
  // WebSocket Streams
  // ============================================

  log.info('Connecting to Polymarket streams...');

  // Handle incoming trades
  wsStream.on('trade', async (trade: Trade) => {
    try {
      // Store in database
      await dataStore.insertTrade(trade);

      // Update real-time stats
      processTrade(trade);

      // Store price tick
      await dataStore.insertPriceTick({
        tokenId: trade.tokenId,
        timestamp: trade.timestamp,
        price: trade.price,
        source: 'trade',
      });
    } catch (err) {
      log.error({ err, trade: trade.txHash }, 'Failed to process trade');
    }
  });

  // Handle orderbook updates
  wsStream.on('orderbook', async (orderbook) => {
    try {
      await dataStore.insertOrderbookSnapshot(orderbook);
      await dataStore.insertPriceTick({
        tokenId: orderbook.tokenId,
        timestamp: orderbook.timestamp,
        price: orderbook.midPrice,
        source: 'orderbook',
      });
    } catch (err) {
      log.error({ err }, 'Failed to process orderbook');
    }
  });

  wsStream.on('connected', () => {
    log.info('WebSocket streams connected');
  });

  wsStream.on('disconnected', () => {
    log.warn('WebSocket streams disconnected');
  });

  wsStream.on('error', (err) => {
    log.error({ err }, 'WebSocket stream error');
  });

  // Connect to streams in background - don't block startup
  wsStream.connect().catch((err) => {
    log.warn({ err }, 'WebSocket connection failed, will retry');
  });

  // ============================================
  // Data Backfill
  // ============================================

  // Start backfill in background without blocking server startup
  const lastTradeTimestamp = await dataStore.getSystemState('last_trade_timestamp');
  const needsBackfill = !lastTradeTimestamp || Date.now() - lastTradeTimestamp > 60 * 60 * 1000;

  if (needsBackfill) {
    log.info('Starting data backfill in background...');
    // Don't await - let it run in background
    backfillTrades(config.TRADE_BACKFILL_DAYS).then(() => {
      log.info('Backfill completed');
      dataStore.setSystemState('last_trade_timestamp', Date.now());
    }).catch((err) => {
      log.error({ err }, 'Backfill failed');
    });
  } else {
    log.info('No backfill needed, data is recent');
  }

  // ============================================
  // Start Workers
  // ============================================

  startAggregator();

  // Broadcast leaderboard and status updates for real-time feel
  setInterval(async () => {
    try {
      const leaderboard = await dataStore.getLeaderboard('realized_pnl', 10);
      broadcastLeaderboard(leaderboard);
      await broadcastStatus();
    } catch (err) {
      // Silently ignore broadcast errors
    }
  }, 5000); // Every 5 seconds to reduce load

  // Cleanup old data daily
  setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

  // ============================================
  // Graceful Shutdown
  // ============================================

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');

    // Stop accepting new connections
    server.close();

    // Stop workers
    stopAggregator();

    // Disconnect WebSocket
    wsStream.disconnect();

    // Save state
    await dataStore.setSystemState('last_trade_timestamp', Date.now());

    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log.info('Polymarket Tracker is running');
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
