import { query } from '../models/database.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('pnl-calculator');

interface Position {
  walletAddress: string;
  tokenId: string;
  conditionId: string;
  outcome: string;
  netPosition: number; // Positive = long, negative = short
  averagePrice: number;
  totalCost: number;
  marketResolved: boolean;
  winningOutcome?: string;
  finalPrice?: number;
}

interface PnLResult {
  walletAddress: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

/**
 * Calculate SIMPLE CASH FLOW PnL for traders (sells - buys)
 * This is more accurate than position tracking since it shows actual cash profit/loss
 */
export async function calculateRealPnL(daysBack: number = 7): Promise<Map<string, PnLResult>> {
  logger.info({ daysBack }, 'Calculating cash flow PnL for traders');
  
  const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
  
  // Simple cash flow calculation: sells (money in) - buys (money out)
  const cashFlowQuery = await query(`
    SELECT 
      wallet_address,
      SUM(CASE 
        WHEN side = 'SELL' THEN COALESCE(usdc_size, size * price)
        ELSE 0 
      END) as total_sells,
      SUM(CASE 
        WHEN side = 'BUY' THEN COALESCE(usdc_size, size * price)
        ELSE 0 
      END) as total_buys
    FROM trades_raw 
    WHERE timestamp >= $1
    GROUP BY wallet_address
    HAVING COUNT(*) >= 1
  `, [cutoffTime]);
  
  const results = new Map<string, PnLResult>();
  
  for (const row of cashFlowQuery.rows) {
    const totalSells = parseFloat(row.total_sells) || 0;
    const totalBuys = parseFloat(row.total_buys) || 0;
    const cashFlowPnl = totalSells - totalBuys;
    
    results.set(row.wallet_address, {
      walletAddress: row.wallet_address,
      realizedPnl: cashFlowPnl, // Cash flow is realized profit/loss
      unrealizedPnl: 0, // Not tracking unrealized for now
      totalPnl: cashFlowPnl,
    });
  }
  
  logger.info({ walletsProcessed: results.size }, 'Cash flow PnL calculation complete');
  return results;
}

/**
 * Update the wallet_stats_live table with real PnL calculations
 */
export async function updateWalletStatsWithRealPnL(): Promise<void> {
  logger.info('Updating wallet stats with real PnL calculations');
  
  const pnlResults = await calculateRealPnL(7);
  
  for (const [walletAddr, pnl] of pnlResults) {
    await query(`
      UPDATE wallet_stats_live 
      SET 
        realized_pnl_7d = $2,
        unrealized_pnl = $3,
        last_updated = NOW()
      WHERE wallet_address = $1
    `, [walletAddr, pnl.realizedPnl, pnl.unrealizedPnl]);
  }
  
  logger.info({ walletsUpdated: pnlResults.size }, 'Wallet stats updated with real PnL');
}