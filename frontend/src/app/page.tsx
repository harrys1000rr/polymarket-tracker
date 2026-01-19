'use client';

import { useState } from 'react';
import { useLeaderboard, useWallet, useHealth } from '@/hooks/useApi';
import LeaderboardTable from '@/components/LeaderboardTable';
import SimulatorPanel from '@/components/SimulatorPanel';
import {
  formatCurrency,
  formatPnl,
  formatPercent,
  formatWalletAddress,
  formatTimeAgo,
  getPnlColor,
} from '@/utils/format';
import clsx from 'clsx';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function Home() {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const { leaderboard, lastUpdated, isLoading, isError, liveStatus, isConnected } = useLeaderboard('realized_pnl', 10);
  const { wallet, isLoading: walletLoading } = useWallet(selectedWallet);
  const { health } = useHealth();

  // Use live status if available (real-time from SSE), fallback to health endpoint
  const displayTradesLast1h = liveStatus?.tradesLast1h ?? health?.tradesLast1h;
  const displayActiveWallets = liveStatus?.activeWallets ?? health?.activeWallets;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Active Traders (24h)</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayActiveWallets != null ? displayActiveWallets.toLocaleString() : '-'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Trades Last Hour</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayTradesLast1h != null ? displayTradesLast1h.toLocaleString() : '-'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Top Trader PnL (7d)</p>
          <p className={clsx('text-2xl font-bold', getPnlColor(leaderboard[0]?.realizedPnlGbp || 0))}>
            {leaderboard[0] ? formatPnl(leaderboard[0].realizedPnlGbp || 0, 'GBP') : '-'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Data Status</p>
          <div className="flex items-center space-x-2">
            <span
              className={clsx(
                'w-2 h-2 rounded-full',
                isConnected && liveStatus?.wsConnected
                  ? 'bg-green-500 animate-pulse'
                  : health?.status === 'healthy'
                  ? 'bg-green-500'
                  : health?.status === 'degraded'
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              )}
            />
            <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
              {isConnected ? 'Live' : health?.status || 'Connecting...'}
            </span>
          </div>
          {lastUpdated && (
            <p className="text-xs text-gray-500 mt-1">Updated {formatTimeAgo(lastUpdated)}</p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
              <p className="mt-4 text-gray-500">Loading leaderboard...</p>
            </div>
          ) : isError ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-red-500">
              Failed to load leaderboard. Please try again.
            </div>
          ) : (
            <LeaderboardTable
              leaderboard={leaderboard}
              onSelectWallet={setSelectedWallet}
              selectedWallet={selectedWallet}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Simulator Quick View */}
          <SimulatorPanel compact />

          {/* Selected Wallet Details */}
          {selectedWallet && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Wallet Details
                </h3>
                <button
                  onClick={() => setSelectedWallet(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {walletLoading ? (
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                </div>
              ) : wallet ? (
                <div className="space-y-4">
                  <p className="font-mono text-sm text-gray-600 dark:text-gray-400">
                    {formatWalletAddress(wallet.walletAddress)}
                  </p>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">7d PnL</p>
                      <p className={clsx('font-semibold', getPnlColor(wallet.stats['7d'].pnlGbp || 0))}>
                        {formatPnl(wallet.stats['7d'].pnlGbp || 0, 'GBP')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">7d Volume</p>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(wallet.stats['7d'].volumeGbp || 0, 'GBP')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Trades</p>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {wallet.stats['7d'].trades}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Win Rate</p>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {((wallet.stats['7d'].winRate || 0) * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>

                  {/* PnL Chart */}
                  {wallet.pnlChart.length > 0 && (
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={wallet.pnlChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                          <XAxis dataKey="timestamp" tick={false} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip
                            formatter={(value: number) => [formatCurrency(value, 'GBP'), 'PnL']}
                            labelFormatter={(ts) => new Date(ts).toLocaleDateString()}
                          />
                          <Line
                            type="monotone"
                            dataKey="cumulativePnl"
                            stroke="#0ea5e9"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Recent Trades */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Recent Trades
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {wallet.recentTrades.slice(0, 10).map((trade, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-700 rounded p-2"
                        >
                          <div className="flex items-center space-x-2">
                            <span
                              className={clsx(
                                'px-1.5 py-0.5 rounded text-white font-medium',
                                trade.side === 'BUY' ? 'bg-green-500' : 'bg-red-500'
                              )}
                            >
                              {trade.side}
                            </span>
                            <span className="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">
                              {trade.outcome}
                            </span>
                          </div>
                          <span className="text-gray-500">
                            {formatCurrency(trade.usdcSizeGbp || 0, 'GBP')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <a
                    href={`https://polymarket.com/portfolio/${wallet.walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-sm text-primary-600 hover:text-primary-700"
                  >
                    View on Polymarket
                  </a>
                </div>
              ) : (
                <p className="text-gray-500">Select a wallet to view details</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
