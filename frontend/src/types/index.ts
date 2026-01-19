export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  displayName?: string;
  profileImageUrl?: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  volume: number;
  tradeCount: number;
  winRate: number;
  roiPercent: number;
  uniqueMarkets: number;
  lastTradeSeen?: string;
  // GBP conversions
  realizedPnlGbp?: number;
  unrealizedPnlGbp?: number;
  totalPnlGbp?: number;
  volumeGbp?: number;
}

export interface LeaderboardResponse {
  timestamp: string;
  window: string;
  metric: string;
  leaderboard: LeaderboardEntry[];
  lastUpdated: string;
}

export interface WalletStats {
  pnl: number;
  pnlGbp?: number;
  volume: number;
  volumeGbp?: number;
  trades: number;
  realizedPnl?: number;
  realizedPnlGbp?: number;
  unrealizedPnl?: number;
  winRate?: number;
  uniqueMarkets?: number;
}

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
  usdcSizeGbp?: number;
  timestamp: number;
  txHash?: string;
  marketTitle?: string;
  marketSlug?: string;
}

export interface WalletResponse {
  walletAddress: string;
  stats: {
    '1h': WalletStats;
    '24h': WalletStats;
    '7d': WalletStats;
  };
  recentTrades: Trade[];
  pnlChart: Array<{ timestamp: number; cumulativePnl: number }>;
  lastUpdated?: string;
}

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

export interface SimulationLogEntry {
  step: number;
  type: 'setup' | 'trade' | 'position' | 'settlement' | 'summary';
  timestamp?: number;
  description: string;
  details: Record<string, string | number | boolean>;
  calculation?: string;
}

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
  resultsGbp?: {
    pnlP5: number;
    pnlP25: number;
    pnlMedian: number;
    pnlP75: number;
    pnlP95: number;
    pnlMean: number;
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
  windowStart: string;
  windowEnd: string;
  disclaimer: string;
  // Detailed simulation log showing calculations
  simulationLog?: SimulationLogEntry[];
  // Sample trade breakdown from first simulation
  sampleTradeLog?: SimulatedTrade[];
}

export interface QuickEstimate {
  type: 'quick_estimate';
  bankrollGbp: number;
  estimatedPnlGbp: {
    low: number;
    mid: number;
    high: number;
  };
  topTraders: LeaderboardEntry[];
  disclaimer: string;
}

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
