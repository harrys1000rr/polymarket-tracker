'use client';

import { useState } from 'react';
import { useQuickEstimate, useSimulation } from '@/hooks/useApi';
import { formatCurrency, formatPnl, formatPercent, getPnlColor } from '@/utils/format';
import clsx from 'clsx';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';

interface Props {
  compact?: boolean;
}

export default function SimulatorPanel({ compact = false }: Props) {
  const [bankroll, setBankroll] = useState(100);
  const [entryDelay, setEntryDelay] = useState(60);
  const [delayVariance, setDelayVariance] = useState(30);
  const [sizingRule, setSizingRule] = useState<'equal' | 'proportional'>('equal');
  const [maxExposure, setMaxExposure] = useState(10);
  const [useOrderbook, setUseOrderbook] = useState(true);
  const [marketImpact, setMarketImpact] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { estimate, isLoading: estimateLoading } = useQuickEstimate(bankroll);
  const { runSimulation, isRunning, results, error, clearResults } = useSimulation();

  const handleRunSimulation = () => {
    runSimulation({
      bankrollGbp: bankroll,
      entryDelaySec: entryDelay,
      delayVarianceSec: delayVariance,
      sizingRule,
      maxExposurePct: maxExposure,
      minTradeUsd: 10,
      useActualOrderbook: useOrderbook,
      marketImpactEnabled: marketImpact,
      numSimulations: 500,
      windowDays: 7,
    });
  };

  if (compact) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Copy Trading Simulator
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Bankroll (GBP)
            </label>
            <input
              type="number"
              value={bankroll}
              onChange={(e) => setBankroll(Number(e.target.value))}
              min={10}
              max={10000}
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
            />
          </div>

          {estimate && !results && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Quick Estimate (7 days)</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-gray-500">Worst Case</p>
                  <p className={clsx('font-semibold', getPnlColor(estimate.estimatedPnlGbp.low))}>
                    {formatPnl(estimate.estimatedPnlGbp.low, 'GBP')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Expected</p>
                  <p className={clsx('font-bold text-lg', getPnlColor(estimate.estimatedPnlGbp.mid))}>
                    {formatPnl(estimate.estimatedPnlGbp.mid, 'GBP')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Best Case</p>
                  <p className={clsx('font-semibold', getPnlColor(estimate.estimatedPnlGbp.high))}>
                    {formatPnl(estimate.estimatedPnlGbp.high, 'GBP')}
                  </p>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleRunSimulation}
            disabled={isRunning}
            className={clsx(
              'w-full py-2 px-4 rounded-md font-medium text-white',
              isRunning
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700'
            )}
          >
            {isRunning ? 'Running Simulation...' : 'Run Full Simulation'}
          </button>

          <p className="text-xs text-amber-600 dark:text-amber-400">
            HYPOTHETICAL - Not financial advice
          </p>
        </div>
      </div>
    );
  }

  // Full simulator view
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
          Copy Trading Simulator
        </h2>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Configuration */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Configuration</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Bankroll (GBP)
              </label>
              <input
                type="number"
                value={bankroll}
                onChange={(e) => setBankroll(Number(e.target.value))}
                min={10}
                max={10000}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Entry Delay: {entryDelay}s (±{delayVariance}s)
              </label>
              <input
                type="range"
                value={entryDelay}
                onChange={(e) => setEntryDelay(Number(e.target.value))}
                min={0}
                max={300}
                step={10}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Time between original trade and your simulated entry
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Sizing Rule
              </label>
              <select
                value={sizingRule}
                onChange={(e) => setSizingRule(e.target.value as any)}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="equal">Equal weight per trade</option>
                <option value="proportional">Proportional to trader size</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
            </button>

            {showAdvanced && (
              <div className="space-y-4 pt-2 border-t">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Delay Variance: ±{delayVariance}s
                  </label>
                  <input
                    type="range"
                    value={delayVariance}
                    onChange={(e) => setDelayVariance(Number(e.target.value))}
                    min={0}
                    max={120}
                    step={5}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Max Exposure per Market: {maxExposure}%
                  </label>
                  <input
                    type="range"
                    value={maxExposure}
                    onChange={(e) => setMaxExposure(Number(e.target.value))}
                    min={5}
                    max={50}
                    step={5}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="useOrderbook"
                    checked={useOrderbook}
                    onChange={(e) => setUseOrderbook(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="useOrderbook" className="text-sm text-gray-700 dark:text-gray-300">
                    Use actual orderbook depth for slippage
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="marketImpact"
                    checked={marketImpact}
                    onChange={(e) => setMarketImpact(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="marketImpact" className="text-sm text-gray-700 dark:text-gray-300">
                    Enable market impact model
                  </label>
                </div>
              </div>
            )}

            <button
              onClick={handleRunSimulation}
              disabled={isRunning}
              className={clsx(
                'w-full py-3 px-4 rounded-md font-medium text-white text-lg',
                isRunning
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-primary-600 hover:bg-primary-700'
              )}
            >
              {isRunning ? 'Running Monte Carlo Simulation...' : 'Run Full Simulation (500 iterations)'}
            </button>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-md text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Results */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Results</h3>

            {!results && estimate && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Quick Estimate (7 days)</p>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-white dark:bg-gray-800 rounded">
                    <p className="text-xs text-gray-500 mb-1">5th Percentile</p>
                    <p className={clsx('font-semibold', getPnlColor(estimate.estimatedPnlGbp.low))}>
                      {formatPnl(estimate.estimatedPnlGbp.low, 'GBP')}
                    </p>
                  </div>
                  <div className="p-3 bg-white dark:bg-gray-800 rounded border-2 border-primary-500">
                    <p className="text-xs text-gray-500 mb-1">Expected</p>
                    <p className={clsx('font-bold text-xl', getPnlColor(estimate.estimatedPnlGbp.mid))}>
                      {formatPnl(estimate.estimatedPnlGbp.mid, 'GBP')}
                    </p>
                  </div>
                  <div className="p-3 bg-white dark:bg-gray-800 rounded">
                    <p className="text-xs text-gray-500 mb-1">95th Percentile</p>
                    <p className={clsx('font-semibold', getPnlColor(estimate.estimatedPnlGbp.high))}>
                      {formatPnl(estimate.estimatedPnlGbp.high, 'GBP')}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">{estimate.disclaimer}</p>
              </div>
            )}

            {results && (
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Monte Carlo Results ({results.config.numSimulations} simulations)
                  </p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-3 bg-white dark:bg-gray-800 rounded">
                      <p className="text-xs text-gray-500 mb-1">5th Percentile</p>
                      <p className={clsx('font-semibold', getPnlColor(results.results.pnlP5))}>
                        {formatPnl(results.results.pnlP5, 'GBP')}
                      </p>
                    </div>
                    <div className="p-3 bg-white dark:bg-gray-800 rounded border-2 border-primary-500">
                      <p className="text-xs text-gray-500 mb-1">Median</p>
                      <p className={clsx('font-bold text-xl', getPnlColor(results.results.pnlMedian))}>
                        {formatPnl(results.results.pnlMedian, 'GBP')}
                      </p>
                    </div>
                    <div className="p-3 bg-white dark:bg-gray-800 rounded">
                      <p className="text-xs text-gray-500 mb-1">95th Percentile</p>
                      <p className={clsx('font-semibold', getPnlColor(results.results.pnlP95))}>
                        {formatPnl(results.results.pnlP95, 'GBP')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Mean:</span>{' '}
                      <span className={getPnlColor(results.results.pnlMean)}>
                        {formatPnl(results.results.pnlMean, 'GBP')}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Sharpe:</span>{' '}
                      <span>{results.results.sharpeRatio.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Daily PnL Chart */}
                {results.dailyBreakdown.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                      Daily PnL Distribution
                    </h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={results.dailyBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip
                          formatter={(value: number) => [formatPnl(value, 'GBP'), '']}
                          labelStyle={{ color: '#374151' }}
                        />
                        <ReferenceLine y={0} stroke="#9CA3AF" />
                        <Bar dataKey="pnlMedian" fill="#0ea5e9" name="Median PnL" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Market Contributions */}
                {results.marketContributions.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                      Top Market Contributions
                    </h4>
                    <div className="space-y-2">
                      {results.marketContributions.slice(0, 5).map((mc, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400 truncate flex-1 mr-2">
                            {mc.market}
                          </span>
                          <span className={clsx('font-medium', getPnlColor(mc.pnlContribution))}>
                            {formatPnl(mc.pnlContribution, 'GBP')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={clearResults}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear results
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200 font-semibold mb-2">
            HYPOTHETICAL SIMULATION RESULTS
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This tool shows what MIGHT have happened if you had copied these traders.
            It is NOT a guarantee of future performance. Assumptions include entry delay,
            slippage based on orderbook depth, and market impact. Past performance does
            not predict future results. This is NOT financial advice. Do your own research.
          </p>
        </div>
      </div>
    </div>
  );
}
