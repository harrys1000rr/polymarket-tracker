'use client';

import { useState } from 'react';
import { LeaderboardEntry } from '@/types';
import {
  formatCurrency,
  formatPnl,
  formatPercent,
  formatWalletAddress,
  formatTimeAgo,
  getPnlColor,
} from '@/utils/format';
import clsx from 'clsx';

interface Props {
  leaderboard: LeaderboardEntry[];
  onSelectWallet?: (address: string) => void;
  selectedWallet?: string | null;
}

export default function LeaderboardTable({ leaderboard, onSelectWallet, selectedWallet }: Props) {
  const [sortBy, setSortBy] = useState<'rank' | 'pnl' | 'roi' | 'volume'>('rank');

  const sorted = [...leaderboard].sort((a, b) => {
    switch (sortBy) {
      case 'pnl':
        return (b.realizedPnlGbp || b.realizedPnl) - (a.realizedPnlGbp || a.realizedPnl);
      case 'roi':
        return b.roiPercent - a.roiPercent;
      case 'volume':
        return (b.volumeGbp || b.volume) - (a.volumeGbp || a.volume);
      default:
        return a.rank - b.rank;
    }
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Top 10 Traders (7 Days)
          </h2>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-500">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="rank">Rank</option>
              <option value="pnl">PnL</option>
              <option value="roi">ROI</option>
              <option value="volume">Volume</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Rank
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Trader
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Realized PnL
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Unrealized
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                ROI
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Win Rate
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Volume
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Trades
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Last Trade
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {sorted.map((entry) => (
              <tr
                key={entry.walletAddress}
                onClick={() => onSelectWallet?.(entry.walletAddress)}
                className={clsx(
                  'cursor-pointer transition-colors',
                  selectedWallet === entry.walletAddress
                    ? 'bg-primary-50 dark:bg-primary-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={clsx(
                      'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold',
                      entry.rank === 1 && 'bg-yellow-100 text-yellow-800',
                      entry.rank === 2 && 'bg-gray-100 text-gray-800',
                      entry.rank === 3 && 'bg-orange-100 text-orange-800',
                      entry.rank > 3 && 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {entry.rank}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <a
                    href={`https://polymarket.com/profile/${entry.walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="group flex items-center space-x-2"
                  >
                    {entry.profileImageUrl && (
                      <img
                        src={entry.profileImageUrl}
                        alt=""
                        className="w-6 h-6 rounded-full"
                      />
                    )}
                    <div className="flex flex-col">
                      {entry.displayName ? (
                        <>
                          <span className="text-sm font-medium text-primary-600 dark:text-primary-400 group-hover:underline">
                            {entry.displayName}
                          </span>
                          <span className="font-mono text-xs text-gray-400">
                            {formatWalletAddress(entry.walletAddress)}
                          </span>
                        </>
                      ) : (
                        <span className="font-mono text-sm text-primary-600 dark:text-primary-400 group-hover:underline">
                          {formatWalletAddress(entry.walletAddress)}
                        </span>
                      )}
                    </div>
                    <svg className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className={clsx('font-semibold', getPnlColor(entry.realizedPnlGbp || entry.realizedPnl))}>
                    {formatPnl(entry.realizedPnlGbp || entry.realizedPnl, 'GBP')}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className={clsx('text-sm', getPnlColor(entry.unrealizedPnlGbp || entry.unrealizedPnl))}>
                    {formatPnl(entry.unrealizedPnlGbp || entry.unrealizedPnl, 'GBP')}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className={clsx('text-sm', getPnlColor(entry.roiPercent))}>
                    {formatPercent(entry.roiPercent)}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {((entry.winRate || 0) * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {formatCurrency(entry.volumeGbp || entry.volume, 'GBP')}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{entry.tradeCount}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  <span className="text-xs text-gray-500">
                    {entry.lastTradeSeen ? formatTimeAgo(entry.lastTradeSeen) : '-'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {leaderboard.length === 0 && (
        <div className="px-4 py-12 text-center text-gray-500">
          <p>No traders found. Data is still loading...</p>
        </div>
      )}
    </div>
  );
}
