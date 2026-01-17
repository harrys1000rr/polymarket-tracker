# Polymarket Trader Monitor - Technical Design Document

## Overview

A **near real-time** analytics platform that monitors top Polymarket traders and provides a realistic "copy trading" performance simulator. **Security-first design: no private keys, no signing, no wallet execution.**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js)                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐                    │
│  │ Leaderboard │  │ Wallet Detail│  │  Copy Simulator  │                    │
│  │  (Live)     │  │   (Live)     │  │   (Realistic)    │                    │
│  └─────────────┘  └──────────────┘  └──────────────────┘                    │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ REST API + SSE (live updates)
┌────────────────────────────────────────▼────────────────────────────────────┐
│                            BACKEND (Node.js/TypeScript)                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     REST API + Server-Sent Events                    │    │
│  │  GET /api/leaderboard  GET /api/wallet/:addr  GET /api/stream/live  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                         │                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────┐     │
│  │  WebSocket       │  │ Real-time        │  │  Realistic Simulator  │     │
│  │  Trade Stream    │  │ Aggregator       │  │  (orderbook-aware)    │     │
│  └────────┬─────────┘  └────────┬─────────┘  └────────────────────────┘     │
│           │                     │                                            │
│  ┌────────▼─────────────────────▼─────────────────────────────────────┐     │
│  │                         PostgreSQL                                  │     │
│  │  trades_raw │ orderbook_snapshots │ wallet_stats │ follower_sims   │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     POLYMARKET REAL-TIME STREAMS (Read-Only)                  │
│                                                                               │
│  WebSocket Streams:                                                           │
│  - wss://ws-subscriptions-clob.polymarket.com (orderbook updates)            │
│  - wss://ws-live-data.polymarket.com (real-time trades)                      │
│                                                                               │
│  REST APIs (supplementary):                                                   │
│  - data-api.polymarket.com (historical trades, positions)                    │
│  - clob.polymarket.com (orderbook depth, prices)                             │
│  - gamma-api.polymarket.com (market metadata)                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Real-Time Data Strategy

### Primary: WebSocket Streams

**1. Real-Time Trade Stream**
```
URL: wss://ws-live-data.polymarket.com
Topic: activity, Type: trades
```
- Receives trades within ~1-2 seconds of execution
- Contains: wallet, market, side, size, price, timestamp
- No polling delay - true real-time

**2. Orderbook Stream**
```
URL: wss://ws-subscriptions-clob.polymarket.com/ws/
Channel: MARKET
```
- Live bid/ask updates for tracked markets
- Used for realistic slippage calculation
- Tracks depth at each price level

### Secondary: REST API (Gap-filling)

- On startup: backfill last 7 days of trades
- Every 60s: reconciliation check for missed WebSocket messages
- On reconnect: fetch trades since last known timestamp

## Realistic Simulation Model

### Why Realistic Matters

Naive copy-trading simulators assume:
- Instant execution at displayed price ❌
- Infinite liquidity ❌
- No market impact ❌

Our simulator accounts for:
- **Actual orderbook depth** at time of simulated entry
- **Price movement** during the delay period
- **Market impact** based on trade size vs available liquidity
- **Spread crossing** costs

### Slippage Model (Orderbook-Aware)

```typescript
interface OrderbookSnapshot {
  timestamp: number;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

function calculateRealisticEntryPrice(
  side: 'BUY' | 'SELL',
  sizeUsd: number,
  orderbook: OrderbookSnapshot
): { price: number; slippageBps: number; filled: boolean } {

  const levels = side === 'BUY' ? orderbook.asks : orderbook.bids;
  let remainingSize = sizeUsd;
  let totalCost = 0;

  for (const level of levels) {
    const levelValue = level.price * level.size;
    if (remainingSize <= levelValue) {
      totalCost += remainingSize;
      remainingSize = 0;
      break;
    }
    totalCost += levelValue;
    remainingSize -= levelValue;
  }

  if (remainingSize > 0) {
    // Insufficient liquidity - partial fill or worse price
    return {
      price: levels[levels.length - 1]?.price ?? 0,
      slippageBps: 500, // 5% penalty for illiquid
      filled: false
    };
  }

  const avgPrice = totalCost / sizeUsd;
  const midPrice = (orderbook.bids[0].price + orderbook.asks[0].price) / 2;
  const slippageBps = Math.abs(avgPrice - midPrice) / midPrice * 10000;

  return { price: avgPrice, slippageBps, filled: true };
}
```

### Entry Delay Simulation

```typescript
async function simulateDelayedEntry(
  originalTrade: Trade,
  delaySeconds: number
): Promise<SimulatedEntry> {

  const entryTime = originalTrade.timestamp + delaySeconds * 1000;

  // Get actual price at entry time (from stored snapshots)
  const priceAtEntry = await getPriceSnapshot(
    originalTrade.tokenId,
    entryTime
  );

  // Get orderbook at entry time
  const orderbookAtEntry = await getOrderbookSnapshot(
    originalTrade.tokenId,
    entryTime
  );

  // Calculate realistic fill
  const fill = calculateRealisticEntryPrice(
    originalTrade.side,
    simulatedSizeUsd,
    orderbookAtEntry
  );

  return {
    intendedPrice: originalTrade.price,
    actualEntryPrice: fill.price,
    priceMovement: priceAtEntry.mid - originalTrade.price,
    slippageBps: fill.slippageBps,
    partialFill: !fill.filled
  };
}
```

### Market Impact Model

For larger simulated positions:

```typescript
function calculateMarketImpact(
  tradeSize: number,
  dailyVolume: number,
  volatility: number
): number {
  // Square-root market impact model (Almgren-Chriss)
  const participation = tradeSize / dailyVolume;
  const impact = volatility * Math.sqrt(participation) * 0.1;
  return impact; // as decimal (0.01 = 1%)
}
```

### Scenario Generation

Instead of fixed best/realistic/worst, we run **Monte Carlo simulation**:

```typescript
interface SimulationConfig {
  bankrollGbp: number;
  entryDelaySeconds: number;  // Base delay
  delayVarianceSeconds: number; // ± variance
  useActualOrderbook: boolean;
  marketImpactEnabled: boolean;
  numSimulations: number; // e.g., 1000
}

function runMonteCarloSim(
  trades: Trade[],
  config: SimulationConfig
): SimulationResults {
  const results: number[] = [];

  for (let i = 0; i < config.numSimulations; i++) {
    let portfolioValue = config.bankrollGbp;

    for (const trade of trades) {
      // Random delay within variance
      const delay = config.entryDelaySeconds +
        (Math.random() - 0.5) * 2 * config.delayVarianceSeconds;

      const entry = simulateDelayedEntry(trade, delay);
      // ... calculate PnL with realistic entry
    }

    results.push(portfolioValue);
  }

  results.sort((a, b) => a - b);

  return {
    percentile5: results[Math.floor(results.length * 0.05)],
    percentile25: results[Math.floor(results.length * 0.25)],
    median: results[Math.floor(results.length * 0.50)],
    percentile75: results[Math.floor(results.length * 0.75)],
    percentile95: results[Math.floor(results.length * 0.95)],
    mean: results.reduce((a, b) => a + b, 0) / results.length
  };
}
```

## Database Schema

### trades_raw (real-time ingestion)
```sql
CREATE TABLE trades_raw (
    id BIGSERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    condition_id VARCHAR(66) NOT NULL,
    token_id VARCHAR(80) NOT NULL,
    side VARCHAR(4) NOT NULL,
    outcome VARCHAR(10) NOT NULL,
    size DECIMAL(24, 8) NOT NULL,
    price DECIMAL(10, 6) NOT NULL,
    usdc_size DECIMAL(18, 6),
    timestamp BIGINT NOT NULL,
    tx_hash VARCHAR(66),
    market_title TEXT,
    received_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet_address, tx_hash, token_id, timestamp)
);

CREATE INDEX idx_trades_wallet ON trades_raw(wallet_address);
CREATE INDEX idx_trades_timestamp ON trades_raw(timestamp DESC);
CREATE INDEX idx_trades_condition ON trades_raw(condition_id);
CREATE INDEX idx_trades_received ON trades_raw(received_at DESC);
```

### orderbook_snapshots (for realistic simulation)
```sql
CREATE TABLE orderbook_snapshots (
    id BIGSERIAL PRIMARY KEY,
    token_id VARCHAR(80) NOT NULL,
    timestamp BIGINT NOT NULL,
    best_bid DECIMAL(10, 6),
    best_ask DECIMAL(10, 6),
    mid_price DECIMAL(10, 6),
    spread_bps INT,
    bid_depth_100 DECIMAL(18, 6), -- liquidity within 1%
    ask_depth_100 DECIMAL(18, 6),
    bid_depth_500 DECIMAL(18, 6), -- liquidity within 5%
    ask_depth_500 DECIMAL(18, 6),
    full_book JSONB, -- compressed orderbook
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orderbook_token_time ON orderbook_snapshots(token_id, timestamp DESC);

-- Partition by day for efficient cleanup
-- Keep 14 days of orderbook history
```

### price_ticks (high-frequency price data)
```sql
CREATE TABLE price_ticks (
    token_id VARCHAR(80) NOT NULL,
    timestamp BIGINT NOT NULL,
    price DECIMAL(10, 6) NOT NULL,
    source VARCHAR(20), -- 'trade', 'orderbook', 'api'
    PRIMARY KEY (token_id, timestamp)
);

CREATE INDEX idx_price_ticks_time ON price_ticks(timestamp DESC);
```

### wallet_stats_live (real-time aggregates)
```sql
CREATE TABLE wallet_stats_live (
    wallet_address VARCHAR(42) PRIMARY KEY,

    -- Rolling windows (updated in real-time)
    pnl_1h DECIMAL(18, 6) DEFAULT 0,
    pnl_24h DECIMAL(18, 6) DEFAULT 0,
    pnl_7d DECIMAL(18, 6) DEFAULT 0,

    volume_1h DECIMAL(18, 6) DEFAULT 0,
    volume_24h DECIMAL(18, 6) DEFAULT 0,
    volume_7d DECIMAL(18, 6) DEFAULT 0,

    trades_1h INT DEFAULT 0,
    trades_24h INT DEFAULT 0,
    trades_7d INT DEFAULT 0,

    -- Realized (settled markets only)
    realized_pnl_7d DECIMAL(18, 6) DEFAULT 0,
    settled_trades_7d INT DEFAULT 0,
    winning_trades_7d INT DEFAULT 0,

    -- Current positions value
    unrealized_pnl DECIMAL(18, 6) DEFAULT 0,
    open_positions INT DEFAULT 0,

    -- Timestamps
    first_trade_seen TIMESTAMP,
    last_trade_seen TIMESTAMP,
    last_updated TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallet_stats_pnl ON wallet_stats_live(pnl_7d DESC);
CREATE INDEX idx_wallet_stats_volume ON wallet_stats_live(volume_7d DESC);
```

### leaderboard_current (materialized view, refreshed every second)
```sql
CREATE MATERIALIZED VIEW leaderboard_current AS
SELECT
    wallet_address,
    pnl_7d as realized_pnl,
    unrealized_pnl,
    pnl_7d + unrealized_pnl as total_pnl,
    volume_7d,
    trades_7d,
    CASE WHEN settled_trades_7d > 0
         THEN winning_trades_7d::DECIMAL / settled_trades_7d
         ELSE 0 END as win_rate,
    CASE WHEN volume_7d > 0
         THEN (pnl_7d / volume_7d) * 100
         ELSE 0 END as roi_percent,
    last_trade_seen
FROM wallet_stats_live
WHERE volume_7d >= 100  -- Minimum $100 volume
  AND trades_7d >= 5    -- Minimum 5 trades
ORDER BY pnl_7d DESC
LIMIT 100;

CREATE UNIQUE INDEX ON leaderboard_current(wallet_address);
```

### follower_simulations
```sql
CREATE TABLE follower_simulations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Config
    config_json JSONB NOT NULL,

    -- Results
    pnl_p5 DECIMAL(18, 6),   -- 5th percentile (worst realistic)
    pnl_p25 DECIMAL(18, 6),  -- 25th percentile
    pnl_median DECIMAL(18, 6),
    pnl_p75 DECIMAL(18, 6),  -- 75th percentile
    pnl_p95 DECIMAL(18, 6),  -- 95th percentile (best realistic)
    pnl_mean DECIMAL(18, 6),

    -- Detailed breakdown
    daily_pnl JSONB,
    market_breakdown JSONB,
    trade_log JSONB
);
```

### markets_cache
```sql
CREATE TABLE markets_cache (
    condition_id VARCHAR(66) PRIMARY KEY,
    token_id_yes VARCHAR(80),
    token_id_no VARCHAR(80),
    title TEXT,
    slug VARCHAR(255),
    is_closed BOOLEAN DEFAULT FALSE,
    end_date TIMESTAMP,
    winning_outcome VARCHAR(10),
    resolution_price_yes DECIMAL(10, 6),
    daily_volume DECIMAL(18, 6),
    total_liquidity DECIMAL(18, 6),
    last_updated TIMESTAMP DEFAULT NOW()
);
```

## Real-Time Update Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WebSocket Connection Manager                      │
│                                                                      │
│  ┌──────────────────┐      ┌──────────────────────────────────────┐ │
│  │ Trade Stream     │      │ Orderbook Stream                     │ │
│  │ (ws-live-data)   │      │ (ws-subscriptions-clob)              │ │
│  └────────┬─────────┘      └───────────────┬──────────────────────┘ │
│           │                                │                         │
│           ▼                                ▼                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Event Processor                            │   │
│  │  - Deduplicate trades                                        │   │
│  │  - Update wallet_stats_live (real-time)                      │   │
│  │  - Store orderbook snapshots (every 5s per market)           │   │
│  │  - Store price ticks                                         │   │
│  │  - Refresh materialized view (every 1s)                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                │                                     │
│                                ▼                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                 Server-Sent Events (SSE)                      │   │
│  │  - Push leaderboard updates to connected clients             │   │
│  │  - Push new trades for followed wallets                      │   │
│  │  - Push price updates for open positions                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## API Specification

### GET /api/leaderboard
Real-time leaderboard with sub-second freshness.

### GET /api/stream/leaderboard (SSE)
Server-Sent Events stream for live leaderboard updates.

```typescript
// Client usage
const eventSource = new EventSource('/api/stream/leaderboard');
eventSource.onmessage = (event) => {
  const leaderboard = JSON.parse(event.data);
  updateUI(leaderboard);
};
```

### GET /api/stream/trades/:wallet (SSE)
Live trade stream for a specific wallet.

### POST /api/follower-sim
Run realistic copy-trading simulation.

**Request:**
```json
{
  "bankroll_gbp": 100,
  "entry_delay_sec": 60,
  "delay_variance_sec": 30,
  "use_actual_orderbook": true,
  "market_impact_enabled": true,
  "sizing_rule": "equal",
  "max_exposure_pct": 10,
  "min_trade_usd": 10,
  "num_simulations": 1000
}
```

**Response:**
```json
{
  "simulation_id": "sim_abc123",
  "parameters": { ... },
  "results": {
    "percentile_5": -8.50,
    "percentile_25": 2.30,
    "median": 6.80,
    "percentile_75": 12.40,
    "percentile_95": 22.10,
    "mean": 7.20,
    "sharpe_ratio": 0.85
  },
  "daily_breakdown": [
    { "date": "2024-01-09", "pnl_median": 1.20, "pnl_range": [-0.50, 3.10] },
    ...
  ],
  "market_contributions": [
    { "market": "...", "pnl_contribution": 2.50, "trade_count": 3 },
    ...
  ],
  "assumptions": {
    "entry_delay": "60s ± 30s random variance",
    "slippage": "Based on actual orderbook depth at entry time",
    "market_impact": "Square-root model (Almgren-Chriss)",
    "partial_fills": "Accounted for when liquidity insufficient"
  },
  "disclaimer": "HYPOTHETICAL SIMULATION ONLY. Past performance does not guarantee future results. Not financial advice."
}
```

## Environment Variables

```env
# Database
DATABASE_URL=postgres://user:pass@host:5432/polymarket

# Polymarket APIs (all public, no auth)
POLYMARKET_DATA_API=https://data-api.polymarket.com
POLYMARKET_CLOB_API=https://clob.polymarket.com
POLYMARKET_GAMMA_API=https://gamma-api.polymarket.com
POLYMARKET_WS_TRADES=wss://ws-live-data.polymarket.com
POLYMARKET_WS_ORDERBOOK=wss://ws-subscriptions-clob.polymarket.com/ws/

# Real-time settings
ORDERBOOK_SNAPSHOT_INTERVAL_MS=5000
LEADERBOARD_REFRESH_INTERVAL_MS=1000
PRICE_TICK_INTERVAL_MS=1000

# Simulation defaults
DEFAULT_NUM_SIMULATIONS=1000
MAX_SIMULATIONS_PER_REQUEST=5000

# Server
PORT=3001
NODE_ENV=production
```

## Security Measures

1. **No secrets**: Only public WebSocket/API endpoints
2. **No private keys**: Cannot sign any transactions
3. **No execution**: Read-only data streams only
4. **Input validation**: All simulation parameters validated
5. **Rate limiting**: Respect upstream limits, implement backoff
6. **No PII storage**: Only public blockchain addresses

## Disclaimers (shown prominently in UI)

```
⚠️ HYPOTHETICAL SIMULATION RESULTS

This tool shows what MIGHT have happened if you had copied these traders.
It is NOT a guarantee of future performance.

Assumptions made:
• Entry delay: Your trade executes X seconds after the original
• Slippage: Based on historical orderbook depth
• Market impact: Your trade may move the price
• Partial fills: Large orders may not fully execute

IMPORTANT:
• Past performance does not predict future results
• This is NOT financial advice
• Do your own research before trading
• You could lose your entire investment
```
