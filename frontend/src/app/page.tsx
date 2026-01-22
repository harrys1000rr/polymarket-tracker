'use client';

import { useState, useEffect } from 'react';
import { useLeaderboard, useWallet, useHealth, useStats } from '@/hooks/useApi';
import LeaderboardTable from '@/components/LeaderboardTable';
import SimulatorPanel from '@/components/SimulatorPanel';
import {
  formatCurrency,
  formatPnl,
  formatWalletAddress,
  formatTimeAgo,
} from '@/utils/format';
import clsx from 'clsx';

export default function Home() {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const { leaderboard, lastUpdated, isLoading, isError, liveStatus, isConnected } = useLeaderboard('realized_pnl', 10);
  const { wallet, isLoading: walletLoading } = useWallet(selectedWallet);
  const { health } = useHealth();
  const { stats } = useStats(); // Reliable fallback for stats
  const [retryCount, setRetryCount] = useState(0);

  // Auto retry on error
  useEffect(() => {
    if (isError && retryCount < 3) {
      const timer = setTimeout(() => setRetryCount(r => r + 1), 2000);
      return () => clearTimeout(timer);
    }
  }, [isError, retryCount]);

  // Use multiple fallback sources for stats (priority: live status > stats > health)
  const displayTradesLast1h = liveStatus?.tradesLast1h ?? stats?.tradesLast1h ?? health?.tradesLast1h ?? 0;
  const displayActiveWallets = liveStatus?.activeWallets ?? stats?.activeWallets ?? health?.activeWallets ?? 0;
  const topTraderPnl = leaderboard[0]?.realizedPnlGbp || leaderboard[0]?.realizedPnl || 0;

  return (
    <div className="space-y-6">
      {/* Hero Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon="🐋"
          label="Whales Tracked"
          value={displayActiveWallets.toLocaleString()}
          subtext="active traders"
          color="purple"
        />
        <StatCard
          icon="📊"
          label="Trades/Hour"
          value={displayTradesLast1h.toLocaleString()}
          subtext="real-time data"
          color="cyan"
        />
        <StatCard
          icon="👑"
          label="Top Alpha (7d)"
          value={formatPnl(topTraderPnl, 'GBP')}
          subtext="best performer"
          color={topTraderPnl >= 0 ? 'green' : 'red'}
          highlight
        />
        <StatCard
          icon={isConnected ? "🟢" : "🔴"}
          label="Feed Status"
          value={isConnected ? "Live" : "Connecting..."}
          subtext={lastUpdated ? `${formatTimeAgo(lastUpdated)}` : 'syncing...'}
          color={isConnected ? 'green' : 'yellow'}
        />
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isError ? (
            <ErrorState onRetry={() => setRetryCount(r => r + 1)} />
          ) : leaderboard.length === 0 ? (
            <EmptyState />
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
          {/* Quick Simulator */}
          <SimulatorPanel compact />

          {/* Selected Wallet Details */}
          {selectedWallet && (
            <WalletDetailsPanel
              wallet={wallet}
              loading={walletLoading}
              onClose={() => setSelectedWallet(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({
  icon,
  label,
  value,
  subtext,
  color,
  highlight
}: {
  icon: string;
  label: string;
  value: string;
  subtext: string;
  color: 'purple' | 'cyan' | 'green' | 'red' | 'yellow';
  highlight?: boolean;
}) {
  const colorClasses = {
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/20',
    cyan: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/20',
    green: 'from-green-500/20 to-green-600/10 border-green-500/20',
    red: 'from-red-500/20 to-red-600/10 border-red-500/20',
    yellow: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/20',
  };

  const textColors = {
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
  };

  return (
    <div className={clsx(
      'relative overflow-hidden rounded-xl p-4 border bg-gradient-to-br transition-all duration-200 card-hover',
      colorClasses[color],
      highlight && 'ring-1 ring-green-500/30'
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</p>
          <p className={clsx('text-2xl font-black stat-number mt-1', textColors[color])}>
            {value}
          </p>
          <p className="text-xs text-gray-500 mt-1">{subtext}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

// Loading Skeleton
function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-white/5 bg-[rgb(22,27,34)] overflow-hidden">
      <div className="p-4 border-b border-white/5">
        <div className="skeleton h-6 w-48 rounded" />
      </div>
      <div className="p-4 space-y-3">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="flex items-center space-x-4">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton h-4 w-32 rounded" />
            <div className="flex-1" />
            <div className="skeleton h-4 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Error State
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
      <span className="text-4xl">😵</span>
      <h3 className="text-lg font-bold text-white mt-4">Connection Issue</h3>
      <p className="text-sm text-gray-400 mt-2">
        Having trouble connecting to the server. This might be temporary.
      </p>
      <button
        onClick={onRetry}
        className="mt-4 px-6 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium transition-all"
      >
        Try Again
      </button>
    </div>
  );
}

// Empty State
function EmptyState() {
  return (
    <div className="rounded-xl border border-white/5 bg-[rgb(22,27,34)] p-8 text-center">
      <span className="text-4xl">🔍</span>
      <h3 className="text-lg font-bold text-white mt-4">No Whales Yet</h3>
      <p className="text-sm text-gray-400 mt-2">
        Waiting for trading data to come in. Check back shortly!
      </p>
    </div>
  );
}

// Wallet Details Panel
function WalletDetailsPanel({
  wallet,
  loading,
  onClose
}: {
  wallet: any;
  loading: boolean;
  onClose: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/5 bg-[rgb(22,27,34)] p-4">
        <div className="flex justify-between items-center mb-4">
          <div className="skeleton h-5 w-32 rounded" />
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <div className="space-y-3">
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-24 w-full rounded" />
        </div>
      </div>
    );
  }

  if (!wallet) return null;

  const pnl = wallet.stats?.['7d']?.pnlGbp || 0;
  const volume = wallet.stats?.['7d']?.volumeGbp || 0;
  const trades = wallet.stats?.['7d']?.trades || 0;
  const winRate = (wallet.stats?.['7d']?.winRate || 0) * 100;

  return (
    <div className="rounded-xl border border-white/5 bg-[rgb(22,27,34)] p-4 animate-slide-up">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white flex items-center space-x-2">
          <span>🔍</span>
          <span>Whale Intel</span>
        </h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">✕</button>
      </div>

      <p className="font-mono text-sm text-gray-400 mb-4">
        {formatWalletAddress(wallet.walletAddress)}
      </p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs text-gray-500">7d PnL</p>
          <p className={clsx('text-lg font-bold', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {formatPnl(pnl, 'GBP')}
          </p>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs text-gray-500">Volume</p>
          <p className="text-lg font-bold text-white">{formatCurrency(volume, 'GBP')}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs text-gray-500">Trades</p>
          <p className="text-lg font-bold text-white">{trades}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs text-gray-500">Win Rate</p>
          <p className="text-lg font-bold text-white">{winRate.toFixed(0)}%</p>
        </div>
      </div>

      {/* Recent Trades */}
      {wallet.recentTrades?.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recent Moves</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {wallet.recentTrades.slice(0, 5).map((trade: any, i: number) => (
              <div key={i} className="rounded-lg bg-white/5 p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className={trade.side === 'BUY' ? 'tag-buy tag' : 'tag-sell tag'}>
                      {trade.side}
                    </span>
                    <span className="text-sm text-gray-300">{trade.outcome}</span>
                  </div>
                  <span className="text-sm font-medium text-white">
                    {formatCurrency(trade.usdcSizeGbp || 0, 'GBP')}
                  </span>
                </div>
                {trade.marketTitle && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">{trade.marketTitle}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <a
        href={`https://polymarket.com/profile/${wallet.walletAddress}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full text-center py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-all font-medium text-sm"
      >
        View Full Profile →
      </a>
    </div>
  );
}
