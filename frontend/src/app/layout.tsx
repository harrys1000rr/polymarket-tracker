import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Polymarket Alpha | Track the Whales',
  description: 'Track top Polymarket traders, copy their alpha, and simulate your gains. DYOR.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <nav className="glass sticky top-0 z-50 border-b border-white/5">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center space-x-3">
                  <a href="/" className="flex items-center space-x-2 group">
                    <span className="text-2xl">🐋</span>
                    <span className="text-xl font-black bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                      Polymarket Alpha
                    </span>
                  </a>
                  <span className="hidden sm:inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    Beta
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <a
                    href="/"
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-all"
                  >
                    Leaderboard
                  </a>
                  <a
                    href="/simulator"
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-all"
                  >
                    Simulator
                  </a>
                  <div className="flex items-center space-x-2 ml-4 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                    <span className="live-dot"></span>
                    <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Live</span>
                  </div>
                </div>
              </div>
            </div>
          </nav>

          {/* Main Content */}
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>

          {/* Footer */}
          <footer className="border-t border-white/5 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-2 text-xs text-gray-500">
                  <span>Built for degens</span>
                  <span>|</span>
                  <span>NFA</span>
                  <span>|</span>
                  <span>DYOR</span>
                </div>
                <div className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <span className="text-amber-400 text-xs font-medium">
                    Simulation only - Past performance ≠ future results
                  </span>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
