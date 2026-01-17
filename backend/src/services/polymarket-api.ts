import axios, { AxiosInstance } from 'axios';
import { API_ENDPOINTS, config } from '../config.js';
import { createChildLogger } from '../utils/logger.js';
import {
  PolymarketTrade,
  PolymarketTradeSchema,
  PolymarketPosition,
  PolymarketPositionSchema,
  PolymarketMarket,
  PolymarketMarketSchema,
  Orderbook,
} from '../models/types.js';
import pLimit from 'p-limit';

const logger = createChildLogger('polymarket-api');

// Rate limiters per API
const dataApiLimiter = pLimit(15); // 150/10s = 15/s safe limit
const clobApiLimiter = pLimit(100); // 1500/10s = 150/s, use 100
const gammaApiLimiter = pLimit(25); // 300/10s = 30/s, use 25

class PolymarketAPI {
  private dataApi: AxiosInstance;
  private clobApi: AxiosInstance;
  private gammaApi: AxiosInstance;

  constructor() {
    this.dataApi = axios.create({
      baseURL: config.POLYMARKET_DATA_API,
      timeout: 30000,
    });

    this.clobApi = axios.create({
      baseURL: config.POLYMARKET_CLOB_API,
      timeout: 30000,
    });

    this.gammaApi = axios.create({
      baseURL: config.POLYMARKET_GAMMA_API,
      timeout: 30000,
    });

    // Add response interceptors for logging
    [this.dataApi, this.clobApi, this.gammaApi].forEach((api) => {
      api.interceptors.response.use(
        (response) => response,
        (error) => {
          logger.warn(
            {
              url: error.config?.url,
              status: error.response?.status,
              message: error.message,
            },
            'API request failed'
          );
          throw error;
        }
      );
    });
  }

  // ============================================
  // Trade Data
  // ============================================

  async getTrades(params: {
    user?: string;
    market?: string;
    limit?: number;
    offset?: number;
    startTimestamp?: number;
    endTimestamp?: number;
  }): Promise<PolymarketTrade[]> {
    return dataApiLimiter(async () => {
      const response = await this.dataApi.get('/trades', {
        params: {
          user: params.user,
          market: params.market,
          limit: params.limit || 500,
          offset: params.offset || 0,
          start: params.startTimestamp,
          end: params.endTimestamp,
          takerOnly: true,
        },
      });

      const trades: PolymarketTrade[] = [];
      for (const item of response.data || []) {
        try {
          trades.push(PolymarketTradeSchema.parse(item));
        } catch (err) {
          logger.debug({ item }, 'Failed to parse trade');
        }
      }

      return trades;
    });
  }

  async getRecentTrades(limit: number = 500): Promise<PolymarketTrade[]> {
    return this.getTrades({ limit });
  }

  async getTradesSince(timestamp: number): Promise<PolymarketTrade[]> {
    const allTrades: PolymarketTrade[] = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const trades = await this.getTrades({
        limit,
        offset,
        startTimestamp: timestamp,
      });

      allTrades.push(...trades);

      if (trades.length < limit) break;
      offset += limit;

      // Safety limit
      if (offset > 10000) break;
    }

    return allTrades;
  }

  async getWalletTrades(
    walletAddress: string,
    options: { limit?: number; days?: number } = {}
  ): Promise<PolymarketTrade[]> {
    const { limit = 500, days = 7 } = options;
    const startTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;

    const allTrades: PolymarketTrade[] = [];
    let offset = 0;

    while (true) {
      const trades = await this.getTrades({
        user: walletAddress,
        limit,
        offset,
        startTimestamp,
      });

      allTrades.push(...trades);

      if (trades.length < limit) break;
      offset += limit;

      if (offset > 5000) break;
    }

    return allTrades;
  }

  // ============================================
  // Positions
  // ============================================

  async getPositions(walletAddress: string): Promise<PolymarketPosition[]> {
    return dataApiLimiter(async () => {
      const response = await this.dataApi.get('/positions', {
        params: {
          user: walletAddress,
          sizeThreshold: 0.01,
          limit: 500,
        },
      });

      const positions: PolymarketPosition[] = [];
      for (const item of response.data || []) {
        try {
          positions.push(PolymarketPositionSchema.parse(item));
        } catch (err) {
          logger.debug({ item }, 'Failed to parse position');
        }
      }

      return positions;
    });
  }

  // ============================================
  // Price Data
  // ============================================

  async getMidpoint(tokenId: string): Promise<number | null> {
    return clobApiLimiter(async () => {
      try {
        const response = await this.clobApi.get('/midpoint', {
          params: { token_id: tokenId },
        });
        return parseFloat(response.data?.mid) || null;
      } catch {
        return null;
      }
    });
  }

  async getOrderbook(tokenId: string): Promise<Orderbook | null> {
    return clobApiLimiter(async () => {
      try {
        const response = await this.clobApi.get('/book', {
          params: { token_id: tokenId },
        });

        const data = response.data;
        if (!data) return null;

        const bids = (data.bids || []).map((b: any) => ({
          price: parseFloat(b.price),
          size: parseFloat(b.size),
        }));

        const asks = (data.asks || []).map((a: any) => ({
          price: parseFloat(a.price),
          size: parseFloat(a.size),
        }));

        const bestBid = bids[0]?.price || 0;
        const bestAsk = asks[0]?.price || 1;
        const midPrice = (bestBid + bestAsk) / 2;
        const spreadBps = bestAsk > 0 ? ((bestAsk - bestBid) / midPrice) * 10000 : 0;

        return {
          tokenId,
          timestamp: Date.now(),
          bids,
          asks,
          bestBid,
          bestAsk,
          midPrice,
          spreadBps: Math.round(spreadBps),
        };
      } catch {
        return null;
      }
    });
  }

  async getPriceHistory(
    tokenId: string,
    options: {
      startTs?: number;
      endTs?: number;
      interval?: string;
      fidelity?: number;
    } = {}
  ): Promise<Array<{ timestamp: number; price: number }>> {
    return clobApiLimiter(async () => {
      try {
        const response = await this.clobApi.get('/prices-history', {
          params: {
            market: tokenId,
            startTs: options.startTs,
            endTs: options.endTs,
            interval: options.interval || '1h',
            fidelity: options.fidelity,
          },
        });

        return (response.data?.history || []).map((h: any) => ({
          timestamp: h.t * 1000, // Convert to ms
          price: parseFloat(h.p),
        }));
      } catch {
        return [];
      }
    });
  }

  async getBatchMidpoints(
    tokenIds: string[]
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    // Process in parallel with rate limiting
    await Promise.all(
      tokenIds.map(async (tokenId) => {
        const price = await this.getMidpoint(tokenId);
        if (price !== null) {
          results.set(tokenId, price);
        }
      })
    );

    return results;
  }

  // ============================================
  // Market Data
  // ============================================

  async getMarkets(params: {
    limit?: number;
    offset?: number;
    active?: boolean;
    closed?: boolean;
    conditionIds?: string[];
  } = {}): Promise<PolymarketMarket[]> {
    return gammaApiLimiter(async () => {
      const response = await this.gammaApi.get('/markets', {
        params: {
          limit: params.limit || 100,
          offset: params.offset || 0,
          active: params.active,
          closed: params.closed,
          condition_ids: params.conditionIds?.join(','),
        },
      });

      const markets: PolymarketMarket[] = [];
      for (const item of response.data || []) {
        try {
          markets.push(PolymarketMarketSchema.parse(item));
        } catch (err) {
          logger.debug({ item }, 'Failed to parse market');
        }
      }

      return markets;
    });
  }

  async getMarketByCondition(conditionId: string): Promise<PolymarketMarket | null> {
    const markets = await this.getMarkets({ conditionIds: [conditionId], limit: 1 });
    return markets[0] || null;
  }

  async getActiveMarkets(limit: number = 500): Promise<PolymarketMarket[]> {
    const allMarkets: PolymarketMarket[] = [];
    let offset = 0;

    while (true) {
      const markets = await this.getMarkets({
        limit: 100,
        offset,
        active: true,
      });

      allMarkets.push(...markets);

      if (markets.length < 100 || allMarkets.length >= limit) break;
      offset += 100;
    }

    return allMarkets.slice(0, limit);
  }

  async getRecentlyClosedMarkets(days: number = 7): Promise<PolymarketMarket[]> {
    const allMarkets: PolymarketMarket[] = [];
    let offset = 0;

    while (true) {
      const markets = await this.getMarkets({
        limit: 100,
        offset,
        closed: true,
      });

      // Filter to recently closed (within X days)
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const recentlyClosed = markets.filter((m) => {
        if (!m.endDate) return true;
        return new Date(m.endDate).getTime() > cutoff;
      });

      allMarkets.push(...recentlyClosed);

      if (markets.length < 100) break;
      offset += 100;

      // Safety limit
      if (offset > 1000) break;
    }

    return allMarkets;
  }
}

export const polymarketApi = new PolymarketAPI();
