-- Polymarket Tracker Database Schema
-- Version: 001 - Initial Schema

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TRADES (real-time ingestion from WebSocket)
-- ============================================
CREATE TABLE IF NOT EXISTS trades_raw (
    id BIGSERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    condition_id VARCHAR(80) NOT NULL,
    token_id VARCHAR(80) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    outcome VARCHAR(10) NOT NULL,
    size DECIMAL(24, 8) NOT NULL,
    price DECIMAL(10, 6) NOT NULL,
    usdc_size DECIMAL(18, 6),
    timestamp BIGINT NOT NULL,
    tx_hash VARCHAR(66),
    market_title TEXT,
    market_slug VARCHAR(255),
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(wallet_address, tx_hash, token_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades_raw(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades_raw(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_condition ON trades_raw(condition_id);
CREATE INDEX IF NOT EXISTS idx_trades_received ON trades_raw(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades_raw(token_id);

-- ============================================
-- ORDERBOOK SNAPSHOTS (for realistic slippage)
-- ============================================
CREATE TABLE IF NOT EXISTS orderbook_snapshots (
    id BIGSERIAL PRIMARY KEY,
    token_id VARCHAR(80) NOT NULL,
    timestamp BIGINT NOT NULL,
    best_bid DECIMAL(10, 6),
    best_ask DECIMAL(10, 6),
    mid_price DECIMAL(10, 6),
    spread_bps INT,
    bid_depth_100bps DECIMAL(18, 6),
    ask_depth_100bps DECIMAL(18, 6),
    bid_depth_500bps DECIMAL(18, 6),
    ask_depth_500bps DECIMAL(18, 6),
    full_book JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orderbook_token_time ON orderbook_snapshots(token_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_orderbook_time ON orderbook_snapshots(timestamp DESC);

-- ============================================
-- PRICE TICKS (high-frequency price data)
-- ============================================
CREATE TABLE IF NOT EXISTS price_ticks (
    token_id VARCHAR(80) NOT NULL,
    timestamp BIGINT NOT NULL,
    price DECIMAL(10, 6) NOT NULL,
    source VARCHAR(20) DEFAULT 'stream',
    PRIMARY KEY (token_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_price_ticks_time ON price_ticks(timestamp DESC);

-- ============================================
-- WALLET STATS (real-time aggregates)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_stats_live (
    wallet_address VARCHAR(42) PRIMARY KEY,

    -- Rolling 1 hour
    pnl_1h DECIMAL(18, 6) DEFAULT 0,
    volume_1h DECIMAL(18, 6) DEFAULT 0,
    trades_1h INT DEFAULT 0,

    -- Rolling 24 hours
    pnl_24h DECIMAL(18, 6) DEFAULT 0,
    volume_24h DECIMAL(18, 6) DEFAULT 0,
    trades_24h INT DEFAULT 0,

    -- Rolling 7 days
    pnl_7d DECIMAL(18, 6) DEFAULT 0,
    volume_7d DECIMAL(18, 6) DEFAULT 0,
    trades_7d INT DEFAULT 0,

    -- Realized (from settled markets)
    realized_pnl_7d DECIMAL(18, 6) DEFAULT 0,
    settled_trades_7d INT DEFAULT 0,
    winning_trades_7d INT DEFAULT 0,

    -- Unrealized (open positions)
    unrealized_pnl DECIMAL(18, 6) DEFAULT 0,
    open_positions INT DEFAULT 0,

    -- Unique markets
    unique_markets_7d INT DEFAULT 0,

    -- Timestamps
    first_trade_seen TIMESTAMP WITH TIME ZONE,
    last_trade_seen TIMESTAMP WITH TIME ZONE,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_stats_pnl ON wallet_stats_live(pnl_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_stats_realized ON wallet_stats_live(realized_pnl_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_stats_volume ON wallet_stats_live(volume_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_stats_updated ON wallet_stats_live(last_updated DESC);

-- ============================================
-- LEADERBOARD SNAPSHOTS (historical tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL,
    window_hours INT NOT NULL,
    metric VARCHAR(30) NOT NULL,
    rank INT NOT NULL,
    wallet_address VARCHAR(42) NOT NULL,
    metric_value DECIMAL(18, 6) NOT NULL,
    volume_usdc DECIMAL(18, 6),
    trade_count INT,
    win_rate DECIMAL(5, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_time ON leaderboard_snapshots(snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_metric ON leaderboard_snapshots(metric, window_hours);

-- ============================================
-- MARKETS CACHE
-- ============================================
CREATE TABLE IF NOT EXISTS markets_cache (
    condition_id VARCHAR(80) PRIMARY KEY,
    token_id_yes VARCHAR(80),
    token_id_no VARCHAR(80),
    title TEXT,
    slug VARCHAR(255),
    is_closed BOOLEAN DEFAULT FALSE,
    end_date TIMESTAMP WITH TIME ZONE,
    winning_outcome VARCHAR(10),
    resolution_price_yes DECIMAL(10, 6),
    daily_volume DECIMAL(18, 6),
    total_liquidity DECIMAL(18, 6),
    last_price_yes DECIMAL(10, 6),
    last_price_no DECIMAL(10, 6),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_closed ON markets_cache(is_closed);
CREATE INDEX IF NOT EXISTS idx_markets_updated ON markets_cache(last_updated DESC);

-- ============================================
-- FOLLOWER SIMULATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS follower_simulations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Configuration
    bankroll_gbp DECIMAL(18, 6) NOT NULL,
    entry_delay_sec INT NOT NULL,
    delay_variance_sec INT DEFAULT 0,
    sizing_rule VARCHAR(20) NOT NULL,
    max_exposure_pct DECIMAL(5, 2) NOT NULL,
    min_trade_usd DECIMAL(18, 6),
    use_actual_orderbook BOOLEAN DEFAULT TRUE,
    market_impact_enabled BOOLEAN DEFAULT TRUE,
    num_simulations INT DEFAULT 1000,

    -- Results (percentiles)
    pnl_p5 DECIMAL(18, 6),
    pnl_p25 DECIMAL(18, 6),
    pnl_median DECIMAL(18, 6),
    pnl_p75 DECIMAL(18, 6),
    pnl_p95 DECIMAL(18, 6),
    pnl_mean DECIMAL(18, 6),
    sharpe_ratio DECIMAL(8, 4),

    -- Detailed breakdown
    daily_pnl JSONB,
    market_breakdown JSONB,
    trade_log JSONB,

    -- Metadata
    window_start TIMESTAMP WITH TIME ZONE,
    window_end TIMESTAMP WITH TIME ZONE,
    traders_followed JSONB
);

CREATE INDEX IF NOT EXISTS idx_simulations_created ON follower_simulations(created_at DESC);

-- ============================================
-- SYSTEM STATE (for restart recovery)
-- ============================================
CREATE TABLE IF NOT EXISTS system_state (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CLEANUP FUNCTION (for retention policy)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_data() RETURNS void AS $$
BEGIN
    -- Keep raw trades for 14 days
    DELETE FROM trades_raw WHERE received_at < NOW() - INTERVAL '14 days';

    -- Keep orderbook snapshots for 14 days
    DELETE FROM orderbook_snapshots WHERE created_at < NOW() - INTERVAL '14 days';

    -- Keep price ticks for 14 days
    DELETE FROM price_ticks WHERE timestamp < EXTRACT(EPOCH FROM (NOW() - INTERVAL '14 days')) * 1000;

    -- Keep leaderboard snapshots for 30 days
    DELETE FROM leaderboard_snapshots WHERE created_at < NOW() - INTERVAL '30 days';

    -- Keep simulations for 30 days
    DELETE FROM follower_simulations WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Create or replace the materialized view for leaderboard
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_current AS
SELECT
    wallet_address,
    realized_pnl_7d as realized_pnl,
    unrealized_pnl,
    (COALESCE(realized_pnl_7d, 0) + COALESCE(unrealized_pnl, 0)) as total_pnl,
    volume_7d,
    trades_7d,
    unique_markets_7d,
    CASE
        WHEN settled_trades_7d > 0 THEN winning_trades_7d::DECIMAL / settled_trades_7d
        ELSE 0
    END as win_rate,
    CASE
        WHEN volume_7d > 0 THEN (realized_pnl_7d / volume_7d) * 100
        ELSE 0
    END as roi_percent,
    last_trade_seen,
    last_updated
FROM wallet_stats_live
WHERE volume_7d >= 100
  AND trades_7d >= 5
ORDER BY realized_pnl_7d DESC NULLS LAST
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_current_wallet ON leaderboard_current(wallet_address);

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema') ON CONFLICT DO NOTHING;
