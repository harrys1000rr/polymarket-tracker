import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().default('postgres://localhost:5432/polymarket'),

  // Polymarket APIs (all public, read-only)
  POLYMARKET_DATA_API: z.string().url().default('https://data-api.polymarket.com'),
  POLYMARKET_CLOB_API: z.string().url().default('https://clob.polymarket.com'),
  POLYMARKET_GAMMA_API: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_WS_TRADES: z.string().default('wss://ws-live-data.polymarket.com'),
  POLYMARKET_WS_ORDERBOOK: z.string().default('wss://ws-subscriptions-clob.polymarket.com/ws/'),

  // Real-time intervals (ms)
  ORDERBOOK_SNAPSHOT_INTERVAL_MS: z.coerce.number().default(5000),
  LEADERBOARD_REFRESH_INTERVAL_MS: z.coerce.number().default(1000),
  STATS_AGGREGATION_INTERVAL_MS: z.coerce.number().default(5000),
  PRICE_TICK_INTERVAL_MS: z.coerce.number().default(1000),

  // Ingestion settings
  TRADE_BACKFILL_DAYS: z.coerce.number().default(7),
  MAX_WALLETS_TO_TRACK: z.coerce.number().default(1000),

  // Leaderboard filters
  MIN_VOLUME_FILTER_USD: z.coerce.number().default(100),
  MIN_TRADES_FILTER: z.coerce.number().default(5),

  // Simulation defaults
  DEFAULT_NUM_SIMULATIONS: z.coerce.number().default(1000),
  MAX_SIMULATIONS_PER_REQUEST: z.coerce.number().default(5000),

  // Server
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // GBP/USD exchange rate (updated daily or use fixed)
  GBP_USD_RATE: z.coerce.number().default(1.27),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Configuration error:', result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

export const config = loadConfig();

// API endpoints derived from config
export const API_ENDPOINTS = {
  // Data API
  trades: `${config.POLYMARKET_DATA_API}/trades`,
  positions: `${config.POLYMARKET_DATA_API}/positions`,
  activity: `${config.POLYMARKET_DATA_API}/activity`,

  // CLOB API
  midpoint: `${config.POLYMARKET_CLOB_API}/midpoint`,
  book: `${config.POLYMARKET_CLOB_API}/book`,
  pricesHistory: `${config.POLYMARKET_CLOB_API}/prices-history`,

  // Gamma API
  markets: `${config.POLYMARKET_GAMMA_API}/markets`,
  events: `${config.POLYMARKET_GAMMA_API}/events`,

  // WebSocket
  wsOrderbook: config.POLYMARKET_WS_ORDERBOOK,
  wsTrades: config.POLYMARKET_WS_TRADES,
} as const;
