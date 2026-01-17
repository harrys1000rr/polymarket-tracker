import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Polymarket Tracker - Copy Trading Simulator',
  description: 'Monitor top Polymarket traders and simulate copy trading performance',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <a href="/" className="flex items-center space-x-2">
                    <span className="text-xl font-bold text-primary-600">Polymarket Tracker</span>
                  </a>
                </div>
                <div className="flex items-center space-x-4">
                  <a
                    href="/"
                    className="text-gray-600 dark:text-gray-300 hover:text-primary-600 px-3 py-2 text-sm font-medium"
                  >
                    Leaderboard
                  </a>
                  <a
                    href="/simulator"
                    className="text-gray-600 dark:text-gray-300 hover:text-primary-600 px-3 py-2 text-sm font-medium"
                  >
                    Simulator
                  </a>
                  <div className="flex items-center space-x-1 text-xs text-gray-500">
                    <span className="live-dot"></span>
                    <span>LIVE</span>
                  </div>
                </div>
              </div>
            </div>
          </nav>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
          <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="text-center text-sm text-gray-500 space-y-2">
                <p className="font-semibold text-amber-600">
                  HYPOTHETICAL SIMULATION ONLY - NOT FINANCIAL ADVICE
                </p>
                <p>
                  Past performance does not guarantee future results. All simulation results are based on
                  historical data with assumptions about entry delay, slippage, and market impact.
                </p>
                <p>Do your own research before trading. You could lose your entire investment.</p>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
