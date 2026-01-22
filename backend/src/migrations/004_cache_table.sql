-- Create persistent cache table for bulletproof instant loading
CREATE TABLE IF NOT EXISTS leaderboard_cache (
    cache_key VARCHAR(100) PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_created_at 
ON leaderboard_cache(created_at DESC);

-- Migration tracking
INSERT INTO migrations (filename, executed_at) 
VALUES ('004_cache_table.sql', NOW())
ON CONFLICT (filename) DO NOTHING;