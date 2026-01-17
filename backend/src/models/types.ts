import { z } from 'zod';

// ============================================
// API Response Types (from Polymarket)
// ============================================

export const PolymarketTradeSchema = z.object({
  proxyWallet: z.string(),
  conditionId: z.string(),
  asset: z.string(), // token_id
  side: z.enum(['BUY', 'SELL']),
  outcome: z.string(),
  size: z.string(),
  price: z.string(),
  usdcSize: z.string().optional(),
  timestamp: z.number(),
  transactionHash: z.string().optional(),
  title: z.string().optional(),
  slug: z.string().optional(),
  outcomeIndex: z.number().optional(),
});

export type PolymarketTrade = z.infer<typeof PolymarketTradeSchema>;

export const PolymarketPositionSchema = z.object({
  proxyWallet: z.string(),
  asset: z.string(),
  conditionId: z.string(),
  size: z.string(),
  avgPrice: z.string(),
  initialValue: z.string().optional(),
  currentValue: z.string().optional(),
  cashPnl: z.string().optional(),
  percentPnl: z.string().optional(),
  realizedPnl: z.string().optional(),
  curPrice: z.string().optional(),
  title: z.string().optional(),
  outcome: z.string().optional(),
  redeemable: z.boolean().optional(),
});

export type PolymarketPosition = z.infer<typeof PolymarketPositionSchema>;

export const PolymarketMarketSchema = z.object({
  id: z.string(),
  question: z.string().optional(),
  conditionId: z.string(),
  slug: z.string().optional(),
  clobTokenIds: z.string().optional(), // JSON string array
  outcomes: z.string().optional(), // JSON string array
  outcomePrices: z.string().optional(), // JSON string array
  volume: z.string().optional(),
  liquidity: z.string().optional(),
  volumeNum: z.number().optional(),
  liquidityNum: z.number().optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  endDate: z.string().optional(),
  lastTradePrice: z.number().optional(),
  bestBid: z.number().optional(),
  bestAsk: z.number().optional(),
});

export type PolymarketMarket = z.infer<typeof PolymarketMarketSchema>;

// ============================================
// Internal Types
// ============================================

export interface Trade {
  id?: number;
  walletAddress: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  size: number;
  price: number;
  usdcSize?: number;
  timestamp: number;
  txHash?: string;
  marketTitle?: string;
  marketSlug?: string;
  receivedAt?: Date;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  tokenId: string;
  timestamp: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spreadBps: number;
}

export interface OrderbookSnapshot {
  tokenId: string;
  timestamp: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spreadBps: number;
  bidDepth100bps: number;
  askDepth100bps: number;
  bidDepth500bps: number;
  askDepth500bps: number;
  fullBook?: Orderbook;
}

export interface PriceTick {
  tokenId: string;
  timestamp: number;
  price: number;
  source: 'trade' | 'orderbook' | 'api';
}

export interface WalletStats {
  walletAddress: string;
  pnl1h: number;
  pnl24h: number;
  pnl7d: number;
  volume1h: number;
  volume24h: number;
  volume7d: number;
  trades1h: number;
  trades24h: number;
  trades7d: number;
  realizedPnl7d: number;
  settledTrades7d: number;
  winningTrades7d: number;
  unrealizedPnl: number;
  openPositions: number;
  uniqueMarkets7d: number;
  firstTradeSeen?: Date;
  lastTradeSeen?: Date;
  lastUpdated?: Date;
}

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  volume: number;
  tradeCount: number;
  winRate: number;
  roiPercent: number;
  uniqueMarkets: number;
  lastTradeSeen?: Date;
}

export interface Market {
  conditionId: string;
  tokenIdYes?: string;
  tokenIdNo?: string;
  title?: string;
  slug?: string;
  isClosed: boolean;
  endDate?: Date;
  winningOutcome?: string;
  resolutionPriceYes?: number;
  dailyVolume?: number;
  totalLiquidity?: number;
  lastPriceYes?: number;
  lastPriceNo?: number;
  lastUpdated?: Date;
}

// ============================================
// Simulation Types
// ============================================

export interface SimulationConfig {
  bankrollGbp: number;
  entryDelaySec: number;
  delayVarianceSec: number;
  sizingRule: 'equal' | 'proportional';
  maxExposurePct: number;
  minTradeUsd: number;
  useActualOrderbook: boolean;
  marketImpactEnabled: boolean;
  numSimulations: number;
  windowDays: number;
}

export const SimulationConfigSchema = z.object({
  bankrollGbp: z.number().min(10).max(100000).default(100),
  entryDelaySec: z.number().min(0).max(3600).default(60),
  delayVarianceSec: z.number().min(0).max(300).default(30),
  sizingRule: z.enum(['equal', 'proportional']).default('equal'),
  maxExposurePct: z.number().min(1).max(100).default(10),
  minTradeUsd: z.number().min(0).max(10000).default(10),
  useActualOrderbook: z.boolean().default(true),
  marketImpactEnabled: z.boolean().default(true),
  numSimulations: z.number().min(100).max(5000).default(1000),
  windowDays: z.number().min(1).max(30).default(7),
});

export interface SimulatedTrade {
  originalTrade: Trade;
  simulatedEntryTime: number;
  intendedPrice: number;
  actualEntryPrice: number;
  priceMovement: number;
  slippageBps: number;
  positionSize: number;
  positionSizeUsd: number;
  exitPrice: number;
  pnl: number;
  partialFill: boolean;
  marketImpact: number;
}

export interface SimulationResults {
  simulationId: string;
  config: SimulationConfig;
  results: {
    pnlP5: number;
    pnlP25: number;
    pnlMedian: number;
    pnlP75: number;
    pnlP95: number;
    pnlMean: number;
    sharpeRatio: number;
  };
  dailyBreakdown: Array<{
    date: string;
    pnlMedian: number;
    pnlP5: number;
    pnlP95: number;
  }>;
  marketContributions: Array<{
    market: string;
    conditionId: string;
    pnlContribution: number;
    tradeCount: number;
  }>;
  tradersFollowed: string[];
  windowStart: Date;
  windowEnd: Date;
  disclaimer: string;
}

// ============================================
// WebSocket Message Types
// ============================================

export interface WsTradeMessage {
  type: 'trade';
  data: {
    asset_id: string;
    market: string;
    side: string;
    size: string;
    price: string;
    timestamp: number;
    maker_address: string;
    taker_address: string;
    transaction_hash?: string;
  };
}

export interface WsOrderbookMessage {
  type: 'book' | 'price_change';
  market?: string;
  asset_id?: string;
  bids?: Array<[string, string]>;
  asks?: Array<[string, string]>;
  price?: string;
  timestamp?: number;
}

// ============================================
// API Response Types
// ============================================

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  lastTradeIngested?: string;
  lastAggregation?: string;
  dbConnected: boolean;
  wsConnected: boolean;
  tradesLast1h: number;
  activeWallets: number;
}

export interface LeaderboardResponse {
  timestamp: string;
  window: string;
  metric: string;
  leaderboard: LeaderboardEntry[];
  lastUpdated: string;
}

export interface WalletResponse {
  walletAddress: string;
  stats: {
    '1h': Partial<WalletStats>;
    '24h': Partial<WalletStats>;
    '7d': Partial<WalletStats>;
  };
  recentTrades: Trade[];
  activePositions: Array<{
    market: string;
    conditionId: string;
    outcome: string;
    size: number;
    avgPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
  }>;
  pnlChart: Array<{
    timestamp: number;
    cumulativePnl: number;
  }>;
}
