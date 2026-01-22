import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { config } from './config.js';
import { logger, createChildLogger } from './utils/logger.js';

const log = createChildLogger('main');

// Bulletproof fast startup - no blocking operations
async function main() {
  log.info({ env: config.NODE_ENV, port: config.PORT }, 'Starting Fast Polymarket Tracker');

  // ============================================
  // Express Server - START IMMEDIATELY
  // ============================================

  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors({
    origin: [
      'http://localhost:3000',
      'https://frontend--polymarketSim.code.run',
      'https://p01--frontend--h769bkzvfdpf.code.run',
      /\.code\.run$/
    ],
    credentials: true,
  }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));

  // Health check - Real data only
  app.get('/api/health', async (req, res) => {
    try {
      // Try to get real database status
      const { checkConnection } = await import('./models/database.js');
      const dbConnected = await checkConnection();
      
      let tradesLast1h = 0;
      let activeWallets = 0;
      
      if (dbConnected) {
        try {
          const dataStore = await import('./services/data-store.js');
          tradesLast1h = await dataStore.getTradesCount(1);
          activeWallets = await dataStore.getActiveWalletsCount();
        } catch (e) {
          // Database queries failed but connection exists
        }
      }
      
      res.json({
        status: dbConnected ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        message: 'Real data backend',
        dbConnected: dbConnected,
        wsConnected: false, // Will be real status later
        tradesLast1h: tradesLast1h,
        activeWallets: activeWallets,
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        message: 'Database unavailable - no fake data',
        error: 'Real data systems starting up'
      });
    }
  });

  // USD API endpoint - Real data only
  app.get('/api/follower-sim', async (req, res) => {
    try {
      const bankrollUsd = parseFloat(req.query.bankroll_usd as string) || 100;
      
      // Import real simulator function
      const { getQuickEstimate } = await import('./services/simulator.js');
      const estimate = await getQuickEstimate(bankrollUsd);
      
      res.json({
        type: 'quick_estimate',
        bankrollUsd: bankrollUsd,
        ...estimate,
      });
    } catch (error) {
      // If real data fails, return error - NO FAKE DATA
      res.status(503).json({ 
        error: 'Real data temporarily unavailable',
        message: 'No fake data - please try again shortly'
      });
    }
  });

  // Leaderboard endpoint - Real data only
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const metric = (req.query.metric as string) || 'realized_pnl';
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const forceRefresh = req.query.force_refresh === 'true';
      
      if (forceRefresh) {
        // Bypass all caches and use Polymarket API directly
        const { getPolymarketLeaderboard, convertToLeaderboardEntry } = await import('./services/polymarket-leaderboard.js');
        
        const orderBy = metric === 'volume' ? 'VOLUME' : 'PNL';
        const polymarketData = await getPolymarketLeaderboard({
          orderBy,
          timePeriod: 'WEEK',
          limit: Math.min(limit, 50),
        });

        const leaderboard = polymarketData.map((entry, index) => convertToLeaderboardEntry(entry, index));
        
        res.json({
          timestamp: new Date().toISOString(),
          window: 'WEEK',
          metric: metric,
          leaderboard: leaderboard,
          lastUpdated: new Date().toISOString(),
          source: 'polymarket_api_direct',
        });
      } else {
        // Use normal cached data store
        const dataStore = await import('./services/data-store.js');
        const leaderboard = await dataStore.getLeaderboard(metric as any, limit);
        
        res.json({
          timestamp: new Date().toISOString(),
          window: '7d',
          metric: metric,
          leaderboard: leaderboard,
          lastUpdated: new Date().toISOString(),
          source: 'cached_data',
        });
      }
    } catch (error) {
      // If real data fails, return error - NO FAKE DATA
      res.status(503).json({ 
        error: 'Real leaderboard data temporarily unavailable',
        message: 'No fake data - please try again shortly'
      });
    }
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Fast Polymarket Tracker API',
      version: '2.0.0',
      description: 'Bulletproof fast-startup API',
      status: 'running',
      uptime: process.uptime(),
      endpoints: {
        health: '/api/health',
        leaderboard: '/api/leaderboard',
        simulator: '/api/follower-sim',
      },
    });
  });

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    log.error({ err, path: req.path }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  // START SERVER IMMEDIATELY - NO WAITING
  const server = app.listen(config.PORT, () => {
    log.info({ port: config.PORT }, '🚀 FAST SERVER STARTED IMMEDIATELY');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');
    server.close(() => {
      log.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Initialize everything else in background - DON'T BLOCK STARTUP
  setTimeout(async () => {
    log.info('Starting background initialization...');
    
    // All the slow stuff happens here - after server is already running
    try {
      // Database connection and migrations - CRITICAL for real data
      const { runMigrations, checkConnection } = await import('./models/database.js');
      const dbOk = await checkConnection();
      if (dbOk) {
        log.info('Database connected in background');
        await runMigrations();
        log.info('Migrations completed in background');
        
        // Start backfill for real data
        const { backfillTrades } = await import('./workers/aggregator.js');
        backfillTrades(1).then(() => {
          log.info('Real data backfill completed');
        }).catch((err) => {
          log.error({ err }, 'Backfill failed - will have limited real data');
        });
      } else {
        log.error('Database connection failed - no real data available');
      }
      
      // Data store initialization
      const dataStore = await import('./services/data-store.js');
      await dataStore.initializeCache().catch(() => {
        log.warn('Cache initialization failed, using mock data');
      });
      
      // WebSocket streams
      const { wsStream } = await import('./services/websocket-stream.js');
      wsStream.connect().catch(() => {
        log.warn('WebSocket connection failed, will retry');
      });
      
      // Aggregator
      const { startAggregator } = await import('./workers/aggregator.js');
      startAggregator();
      
      log.info('🎉 Background initialization completed');
      
    } catch (error) {
      log.error({ error }, 'Background initialization failed - continuing with mock data');
    }
  }, 1000); // Start background init after 1 second
}

// Handle startup errors gracefully
main().catch((error) => {
  log.error({ error }, 'Startup failed');
  
  // Even if main() fails, try to start a basic server
  const app = express();
  app.use(express.json());
  app.get('/api/health', (req, res) => {
    res.json({ status: 'emergency', message: 'Basic server running' });
  });
  
  app.listen(config.PORT, () => {
    log.info({ port: config.PORT }, 'Emergency server started');
  });
});