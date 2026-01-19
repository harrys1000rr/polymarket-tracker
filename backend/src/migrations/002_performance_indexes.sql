-- Performance Indexes for Fast Aggregation
-- Version: 002

-- Critical composite index for wallet + timestamp queries
CREATE INDEX IF NOT EXISTS idx_trades_wallet_timestamp
ON trades_raw(wallet_address, timestamp DESC);

-- Index for fast distinct wallet lookup
CREATE INDEX IF NOT EXISTS idx_trades_wallet_timestamp_asc
ON trades_raw(timestamp DESC, wallet_address);

-- Migration tracking
INSERT INTO schema_migrations (version) VALUES ('002_performance_indexes') ON CONFLICT DO NOTHING;
