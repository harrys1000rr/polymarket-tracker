-- Covering index for leaderboard query
-- Version: 003

-- Composite covering index for fast leaderboard query
-- Includes filter columns and sort column for index-only scans
CREATE INDEX IF NOT EXISTS idx_wallet_stats_leaderboard
ON wallet_stats_live(pnl_7d DESC)
WHERE volume_7d >= 100 AND trades_7d >= 5;

-- Alternative: full covering index if partial index doesn't help
CREATE INDEX IF NOT EXISTS idx_wallet_stats_leaderboard_full
ON wallet_stats_live(pnl_7d DESC, volume_7d, trades_7d)
INCLUDE (wallet_address, unrealized_pnl, unique_markets_7d, settled_trades_7d, winning_trades_7d, last_trade_seen);

-- Migration tracking
INSERT INTO schema_migrations (version) VALUES ('003_leaderboard_index') ON CONFLICT DO NOTHING;
