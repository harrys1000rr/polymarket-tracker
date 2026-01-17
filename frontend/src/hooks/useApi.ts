import useSWR from 'swr';
import { useEffect, useState, useCallback } from 'react';
import type {
  LeaderboardResponse,
  WalletResponse,
  SimulationResults,
  QuickEstimate,
  HealthResponse,
  SimulationConfig,
} from '@/types';

// Production backend URL - hardcoded since Northflank build args not working
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://p01--backend--h769bkzvfdpf.code.run';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error('API request failed');
    throw error;
  }
  return res.json();
};

// ============================================
// Leaderboard Hook with SSE for Live Updates
// ============================================

export function useLeaderboard(
  metric: 'realized_pnl' | 'roi' | 'volume' = 'realized_pnl',
  limit: number = 10
) {
  const { data, error, mutate } = useSWR<LeaderboardResponse>(
    `${API_URL}/api/leaderboard?metric=${metric}&limit=${limit}`,
    fetcher,
    {
      refreshInterval: 5000, // Fallback polling
      revalidateOnFocus: true,
    }
  );

  // SSE for real-time updates
  useEffect(() => {
    const eventSource = new EventSource(`${API_URL}/api/stream/leaderboard`);

    eventSource.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);
        if (update.type === 'leaderboard' && update.data) {
          mutate(
            (current) => ({
              ...current!,
              leaderboard: update.data,
              lastUpdated: new Date().toISOString(),
            }),
            false
          );
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Will auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [mutate]);

  return {
    leaderboard: data?.leaderboard || [],
    lastUpdated: data?.lastUpdated,
    isLoading: !error && !data,
    isError: error,
    refresh: mutate,
  };
}

// ============================================
// Wallet Details Hook
// ============================================

export function useWallet(address: string | null) {
  const { data, error, mutate } = useSWR<WalletResponse>(
    address ? `${API_URL}/api/wallet/${address}` : null,
    fetcher,
    {
      refreshInterval: 10000,
    }
  );

  return {
    wallet: data,
    isLoading: !error && !data && !!address,
    isError: error,
    refresh: mutate,
  };
}

// ============================================
// Quick Estimate Hook
// ============================================

export function useQuickEstimate(bankrollGbp: number = 100) {
  const { data, error, mutate } = useSWR<QuickEstimate>(
    `${API_URL}/api/follower-sim?bankroll_gbp=${bankrollGbp}`,
    fetcher,
    {
      refreshInterval: 30000,
    }
  );

  return {
    estimate: data,
    isLoading: !error && !data,
    isError: error,
    refresh: mutate,
  };
}

// ============================================
// Full Simulation Hook
// ============================================

export function useSimulation() {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = useCallback(async (config: Partial<SimulationConfig>) => {
    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/follower-sim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bankrollGbp: config.bankrollGbp || 100,
          entryDelaySec: config.entryDelaySec || 60,
          delayVarianceSec: config.delayVarianceSec || 30,
          sizingRule: config.sizingRule || 'equal',
          maxExposurePct: config.maxExposurePct || 10,
          minTradeUsd: config.minTradeUsd || 10,
          useActualOrderbook: config.useActualOrderbook ?? true,
          marketImpactEnabled: config.marketImpactEnabled ?? true,
          numSimulations: config.numSimulations || 500,
          windowDays: config.windowDays || 7,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Simulation failed');
      }

      const data = await response.json();
      setResults(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRunning(false);
    }
  }, []);

  return {
    runSimulation,
    isRunning,
    results,
    error,
    clearResults: () => setResults(null),
  };
}

// ============================================
// Health Check Hook
// ============================================

export function useHealth() {
  const { data, error } = useSWR<HealthResponse>(
    `${API_URL}/api/health`,
    fetcher,
    {
      refreshInterval: 10000,
    }
  );

  return {
    health: data,
    isLoading: !error && !data,
    isError: error,
  };
}

// ============================================
// Recent Trades Hook
// ============================================

export function useRecentTrades(limit: number = 50) {
  const { data, error, mutate } = useSWR<{ trades: any[]; count: number }>(
    `${API_URL}/api/trades/recent?limit=${limit}`,
    fetcher,
    {
      refreshInterval: 5000,
    }
  );

  return {
    trades: data?.trades || [],
    isLoading: !error && !data,
    isError: error,
    refresh: mutate,
  };
}
