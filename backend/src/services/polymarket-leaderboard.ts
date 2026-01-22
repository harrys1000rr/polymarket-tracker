import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('polymarket-leaderboard');

export interface PolymarketLeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

export interface LeaderboardParams {
  category?: 'OVERALL' | string;
  timePeriod?: 'DAY' | 'WEEK' | 'MONTH' | 'ALL';
  orderBy?: 'PNL' | 'VOLUME';
  limit?: number;
  offset?: number;
  user?: string;
  userName?: string;
}

/**
 * Fetch real trader leaderboard data from Polymarket's official API
 */
export async function getPolymarketLeaderboard(
  params: LeaderboardParams = {}
): Promise<PolymarketLeaderboardEntry[]> {
  const {
    category = 'OVERALL',
    timePeriod = 'WEEK',
    orderBy = 'PNL',
    limit = 25,
    offset = 0,
    user,
    userName
  } = params;

  const searchParams = new URLSearchParams({
    category,
    timePeriod,
    orderBy,
    limit: limit.toString(),
    offset: offset.toString(),
  });

  if (user) searchParams.set('user', user);
  if (userName) searchParams.set('userName', userName);

  const url = `https://data-api.polymarket.com/v1/leaderboard?${searchParams}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PolymarketTracker/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
    }

    const data: PolymarketLeaderboardEntry[] = await response.json();
    
    logger.info(
      { 
        count: data.length, 
        timePeriod, 
        orderBy,
        topPnl: data[0]?.pnl 
      }, 
      'Fetched Polymarket leaderboard'
    );

    return data;
  } catch (error) {
    logger.error({ error, url }, 'Failed to fetch Polymarket leaderboard');
    throw error;
  }
}

/**
 * Get specific trader's real PnL from Polymarket
 */
export async function getTraderPnL(walletAddress: string): Promise<PolymarketLeaderboardEntry | null> {
  try {
    const data = await getPolymarketLeaderboard({ 
      user: walletAddress,
      limit: 1 
    });
    
    return data[0] || null;
  } catch (error) {
    logger.error({ error, walletAddress }, 'Failed to fetch trader PnL');
    return null;
  }
}

/**
 * Convert Polymarket leaderboard entry to our LeaderboardEntry format
 */
export function convertToLeaderboardEntry(entry: PolymarketLeaderboardEntry, index: number) {
  return {
    rank: index + 1,
    walletAddress: entry.proxyWallet,
    displayName: entry.userName,
    realizedPnl: entry.pnl, // This is the REAL PnL from Polymarket
    unrealizedPnl: 0, // Polymarket doesn't separate realized/unrealized
    totalPnl: entry.pnl,
    volume: entry.vol,
    tradeCount: 0, // Not provided by Polymarket API
    winRate: 0, // Not provided by Polymarket API  
    roiPercent: entry.vol > 0 ? (entry.pnl / entry.vol) * 100 : 0,
    uniqueMarkets: 0, // Not provided by Polymarket API
    lastTradeTime: new Date(), // Not provided by Polymarket API
    verifiedBadge: entry.verifiedBadge,
    profileImage: entry.profileImage,
    xUsername: entry.xUsername,
  };
}