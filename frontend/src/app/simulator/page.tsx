'use client';

import SimulatorPanel from '@/components/SimulatorPanel';

export default function SimulatorPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Copy Trading Simulator
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Simulate what your returns might have been if you copied the top Polymarket traders
          over the past 7 days. Configure entry delays, slippage models, and position sizing
          to see realistic outcomes.
        </p>
      </div>

      <SimulatorPanel />

      {/* Methodology Explanation */}
      <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Simulation Methodology
        </h2>

        <div className="grid md:grid-cols-2 gap-6 text-sm text-gray-600 dark:text-gray-400">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Entry Delay Model</h3>
            <p>
              When a top trader makes a trade, you wouldn&apos;t be able to copy it instantly.
              The simulation adds a configurable delay (default: 60 seconds ± 30s) before
              calculating your entry price. During this time, the price may move against you.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Slippage Model</h3>
            <p>
              We use historical orderbook depth data to calculate realistic slippage.
              Larger trades eat through more orderbook levels, resulting in worse average
              fill prices. This is more accurate than fixed percentage assumptions.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Market Impact</h3>
            <p>
              For larger simulated positions, we apply a square-root market impact model
              (Almgren-Chriss). This accounts for the fact that your trades would move
              the market price, especially in less liquid markets.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Monte Carlo Simulation</h3>
            <p>
              We run hundreds of simulations with randomized delays and price paths to
              generate a distribution of outcomes. The percentiles (5th, 50th, 95th) show
              the range of realistic results, not just a single point estimate.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Position Sizing</h3>
            <p>
              <strong>Equal weight:</strong> Divides your bankroll equally across all followed trades.
              <br />
              <strong>Proportional:</strong> Sizes positions based on the original trader&apos;s
              relative trade size.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">PnL Calculation</h3>
            <p>
              For settled markets, we use the actual resolution price (1.0 for winning outcome,
              0.0 for losing). For open markets, we use the current mid-market price for
              unrealized PnL.
            </p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <h3 className="font-medium text-gray-900 dark:text-white mb-2">Key Assumptions</h3>
          <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>You would have had the capital available at each trade time</li>
            <li>You could have detected and reacted to trades within the specified delay</li>
            <li>Your trades wouldn&apos;t have been front-run or detected by other copiers</li>
            <li>Transaction costs (gas fees) are not included</li>
            <li>All values displayed in USD</li>
            <li>Partial fills are accounted for when orderbook liquidity is insufficient</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
