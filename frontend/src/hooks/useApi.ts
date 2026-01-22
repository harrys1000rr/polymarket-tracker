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

// Production backend URL
const API_URL = 'https://p01--backend--h769bkzvfdpf.code.run';

const fetcher = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); // 3 second timeout for speed

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      // NO FAKE DATA - throw error for real failures
      throw new Error(`API request failed: ${res.status}`);
    }
    return res.json();
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  }
};

// ============================================
// Leaderboard Hook with SSE for Live Updates
// ============================================

interface LiveStatus {
  tradesLast1h: number;
  activeWallets: number;
  wsConnected: boolean;
  lastAggregation: number;
}

export function useLeaderboard(
  metric: 'realized_pnl' | 'roi' | 'volume' = 'realized_pnl',
  limit: number = 10
) {
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const { data, error, mutate } = useSWR<LeaderboardResponse>(
    `${API_URL}/api/leaderboard?metric=${metric}&limit=${limit}`,
    fetcher,
    {
      refreshInterval: 1000, // Very fast polling for instant feel
      revalidateOnFocus: true,
      errorRetryCount: 3, // Quick retries
      errorRetryInterval: 500, // Very fast retries
      dedupingInterval: 200, // Minimal deduplication for instant response
      shouldRetryOnError: true,
      revalidateOnMount: true,
      revalidateIfStale: true,
      // NO FALLBACK DATA - show loading/error states instead
    }
  );

  // NO SSE - rely only on real polling data
  useEffect(() => {
    // NO FAKE STATUS - will get real status from API calls
    setIsConnected(false);
    setLiveStatus(null);
  }, []);

  return {
    leaderboard: data?.leaderboard || [],
    lastUpdated: data?.lastUpdated,
    isLoading: !error && !data,
    isError: error,
    refresh: mutate,
    liveStatus,
    isConnected,
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

export function useQuickEstimate(bankrollUsd: number = 100) {
  const { data, error, mutate } = useSWR<QuickEstimate>(
    `${API_URL}/api/follower-sim?bankroll_usd=${bankrollUsd}`,
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
          bankrollUsd: config.bankrollUsd || 100,
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

// ============================================
// Stats Hook (reliable fallback)
// ============================================

interface StatsResponse {
  tradesLast1h: number;
  tradesLast24h: number;
  activeWallets: number;
  lastAggregation: string;
  gbpUsdRate: number;
}

export function useStats() {
  const { data, error, mutate } = useSWR<StatsResponse>(
    `${API_URL}/api/stats`,
    fetcher,
    {
      refreshInterval: 5000,
      dedupingInterval: 2000,
      shouldRetryOnError: true,
      errorRetryCount: 3,
    }
  );

  return {
    stats: data,
    isLoading: !error && !data,
    isError: error,
    refresh: mutate,
  };
}
