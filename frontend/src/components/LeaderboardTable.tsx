'use client';

import { useState } from 'react';
import { LeaderboardEntry } from '@/types';
import {
  formatCurrency,
  formatPnl,
  formatPercent,
  formatWalletAddress,
  formatTimeAgo,
} from '@/utils/format';
import clsx from 'clsx';

interface Props {
  leaderboard: LeaderboardEntry[];
  onSelectWallet?: (address: string) => void;
  selectedWallet?: string | null;
}

export default function LeaderboardTable({ leaderboard, onSelectWallet, selectedWallet }: Props) {
  const [sortBy, setSortBy] = useState<'rank' | 'pnl' | 'volume' | 'trades'>('rank');

  const sorted = [...leaderboard].sort((a, b) => {
    switch (sortBy) {
      case 'pnl':
        return (b.realizedPnl || 0) - (a.realizedPnl || 0);
      case 'volume':
        return (b.volume || 0) - (a.volume || 0);
      case 'trades':
        return b.tradeCount - a.tradeCount;
      default:
        return a.rank - b.rank;
    }
  });

  return (
    <div className="rounded-xl border border-white/5 bg-[rgb(22,27,34)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl">🏆</span>
            <div>
              <h2 className="text-lg font-bold text-white">Top Whales</h2>
              <p className="text-xs text-gray-500">7 day performance</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-500">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="rank">Rank</option>
              <option value="pnl">PnL</option>
              <option value="volume">Volume</option>
              <option value="trades">Trades</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">Trader</th>
              <th className="px-4 py-3 text-right font-medium">PnL (7d)</th>
              <th className="px-4 py-3 text-right font-medium hidden sm:table-cell">Volume</th>
              <th className="px-4 py-3 text-right font-medium hidden md:table-cell">Trades</th>
              <th className="px-4 py-3 text-right font-medium hidden lg:table-cell">Last Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sorted.map((entry, index) => {
              const pnl = entry.realizedPnl || 0;
              const isPositive = pnl >= 0;

              return (
                <tr
                  key={entry.walletAddress}
                  onClick={() => onSelectWallet?.(entry.walletAddress)}
                  className={clsx(
                    'cursor-pointer table-row-hover',
                    selectedWallet === entry.walletAddress && 'bg-purple-500/10'
                  )}
                >
                  {/* Rank */}
                  <td className="px-4 py-3">
                    <RankBadge rank={entry.rank} />
                  </td>

                  {/* Trader */}
                  <td className="px-4 py-3">
                    <a
                      href={`https://polymarket.com/profile/${entry.walletAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="group flex items-center space-x-2"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white">
                        {entry.walletAddress.slice(2, 4).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-mono text-sm text-gray-300 group-hover:text-purple-400 transition-colors">
                          {formatWalletAddress(entry.walletAddress)}
                        </span>
                        {entry.displayName && (
                          <p className="text-xs text-gray-500">{entry.displayName}</p>
                        )}
                      </div>
                      <svg className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </td>

                  {/* PnL */}
                  <td className="px-4 py-3 text-right">
                    <span className={clsx(
                      'font-bold stat-number',
                      isPositive ? 'text-green-400' : 'text-red-400'
                    )}>
                      {formatPnl(pnl, 'USD')}
                    </span>
                  </td>

                  {/* Volume */}
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    <span className="text-sm text-gray-400 stat-number">
                      {formatCurrency(entry.volume, 'USD')}
                    </span>
                  </td>

                  {/* Trades */}
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    <span className="text-sm text-gray-400">{entry.tradeCount}</span>
                  </td>

                  {/* Last Active */}
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    <span className="text-xs text-gray-500">
                      {entry.lastTradeSeen ? formatTimeAgo(entry.lastTradeSeen) : '-'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {leaderboard.length === 0 && (
        <div className="px-4 py-12 text-center">
          <span className="text-3xl">🔍</span>
          <p className="mt-2 text-gray-500">No whales found yet...</p>
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full rank-1 flex items-center justify-center animate-float">
        <span className="text-sm">👑</span>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full rank-2 flex items-center justify-center">
        <span className="text-sm font-bold text-white">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full rank-3 flex items-center justify-center">
        <span className="text-sm font-bold text-white">3</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
      <span className="text-sm font-medium text-gray-400">{rank}</span>
    </div>
  );
}
