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
 * Calculate REAL PnL for traders by tracking their positions and outcomes
 */
export async function calculateRealPnL(daysBack: number = 7): Promise<Map<string, PnLResult>> {
  logger.info({ daysBack }, 'Calculating real PnL for traders');
  
  const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
  
  // Get all trades in the time window
  const trades = await query(`
    SELECT 
      wallet_address,
      token_id,
      condition_id,
      outcome,
      side,
      size,
      price,
      COALESCE(usdc_size, size * price) as usd_amount,
      timestamp
    FROM trades_raw 
    WHERE timestamp >= $1
    ORDER BY wallet_address, token_id, timestamp
  `, [cutoffTime]);
  
  // Group trades by wallet and build positions
  const walletPositions = new Map<string, Map<string, Position>>();
  
  for (const trade of trades.rows) {
    const walletAddr = trade.wallet_address;
    const tokenKey = `${trade.token_id}_${trade.outcome}`;
    
    if (!walletPositions.has(walletAddr)) {
      walletPositions.set(walletAddr, new Map());
    }
    
    const positions = walletPositions.get(walletAddr)!;
    
    if (!positions.has(tokenKey)) {
      positions.set(tokenKey, {
        walletAddress: walletAddr,
        tokenId: trade.token_id,
        conditionId: trade.condition_id,
        outcome: trade.outcome,
        netPosition: 0,
        averagePrice: 0,
        totalCost: 0,
        marketResolved: false,
      });
    }
    
    const position = positions.get(tokenKey)!;
    
    // Update position based on trade
    const tradeSize = trade.side === 'BUY' ? trade.size : -trade.size;
    const tradeCost = trade.side === 'BUY' ? trade.usd_amount : -trade.usd_amount;
    
    // Update net position and average price
    if (position.netPosition === 0) {
      // New position
      position.netPosition = tradeSize;
      position.averagePrice = trade.price;
      position.totalCost = tradeCost;
    } else if (Math.sign(position.netPosition) === Math.sign(tradeSize)) {
      // Adding to existing position
      const newTotalCost = position.totalCost + tradeCost;
      const newNetPosition = position.netPosition + tradeSize;
      position.averagePrice = newTotalCost / newNetPosition;
      position.netPosition = newNetPosition;
      position.totalCost = newTotalCost;
    } else {
      // Reducing or reversing position
      position.netPosition += tradeSize;
      if (position.netPosition === 0) {
        // Position closed - this is realized PnL
        position.totalCost += tradeCost; // This becomes realized PnL
      } else {
        // Partial close - calculate proportional realized PnL
        const closedPortion = Math.abs(tradeSize) / Math.abs(position.netPosition + tradeSize);
        const realizedCost = position.totalCost * closedPortion;
        position.totalCost = position.totalCost * (1 - closedPortion) + tradeCost;
      }
    }
  }
  
  // Get market outcomes for resolved markets
  const resolvedMarkets = await query(`
    SELECT DISTINCT 
      condition_id,
      winning_outcome,
      is_closed
    FROM markets 
    WHERE is_closed = true
  `);
  
  const marketOutcomes = new Map<string, string>();
  for (const market of resolvedMarkets.rows) {
    if (market.winning_outcome) {
      marketOutcomes.set(market.condition_id, market.winning_outcome);
    }
  }
  
  // Calculate PnL for each wallet
  const results = new Map<string, PnLResult>();
  
  for (const [walletAddr, positions] of walletPositions) {
    let realizedPnl = 0;
    let unrealizedPnl = 0;
    
    for (const [tokenKey, position] of positions) {
      const marketResolution = marketOutcomes.get(position.conditionId);
      
      if (marketResolution) {
        // Market is resolved - calculate realized PnL
        if (position.outcome === marketResolution) {
          // Won the bet - position worth $1 per share
          realizedPnl += (position.netPosition * 1.0) - position.totalCost;
        } else {
          // Lost the bet - position worth $0
          realizedPnl += 0 - position.totalCost;
        }
      } else {
        // Market not resolved - calculate unrealized PnL using current price
        // For now, assume current price = average price (conservative)
        // In production, we'd get latest market price
        const currentValue = position.netPosition * position.averagePrice;
        unrealizedPnl += currentValue - position.totalCost;
      }
    }
    
    results.set(walletAddr, {
      walletAddress: walletAddr,
      realizedPnl,
      unrealizedPnl,
      totalPnl: realizedPnl + unrealizedPnl,
    });
  }
  
  logger.info({ walletsProcessed: results.size }, 'Real PnL calculation complete');
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