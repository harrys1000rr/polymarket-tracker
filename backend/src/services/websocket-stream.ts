import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config, API_ENDPOINTS } from '../config.js';
import { createChildLogger } from '../utils/logger.js';
import { Trade, Orderbook, OrderbookLevel } from '../models/types.js';

const logger = createChildLogger('websocket-stream');

interface StreamEvents {
  trade: (trade: Trade) => void;
  orderbook: (orderbook: Orderbook) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
}

export class WebSocketStream extends EventEmitter {
  private tradeWs: WebSocket | null = null;
  private orderbookWs: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;
  private subscribedMarkets = new Set<string>();
  private subscribedTokens = new Set<string>();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  // ============================================
  // Trade Stream (wss://ws-live-data.polymarket.com)
  // ============================================

  async connectTradeStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info({ url: API_ENDPOINTS.wsTrades }, 'Connecting to trade stream');

        this.tradeWs = new WebSocket(API_ENDPOINTS.wsTrades);

        this.tradeWs.on('open', () => {
          logger.info('Trade stream connected');
          this.isConnected = true;

          // Subscribe to all trades
          this.tradeWs?.send(
            JSON.stringify({
              type: 'subscribe',
              channel: 'trades',
            })
          );

          this.startPing();
          this.emit('connected');
          resolve();
        });

        this.tradeWs.on('message', (data: Buffer) => {
          this.handleTradeMessage(data);
        });

        this.tradeWs.on('error', (error) => {
          logger.error({ error }, 'Trade stream error');
          this.emit('error', error);
        });

        this.tradeWs.on('close', (code, reason) => {
          logger.warn({ code, reason: reason.toString() }, 'Trade stream closed');
          this.isConnected = false;
          this.emit('disconnected');
          this.scheduleReconnect('trade');
        });

        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Trade stream connection timeout'));
          }
        }, 30000);
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleTradeMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      // Handle different message formats
      if (message.type === 'trade' || message.event === 'trade') {
        const tradeData = message.data || message;

        const trade: Trade = {
          walletAddress: tradeData.taker_address || tradeData.maker_address || 'unknown',
          conditionId: tradeData.market || tradeData.condition_id || '',
          tokenId: tradeData.asset_id || tradeData.token_id || '',
          side: (tradeData.side || 'BUY').toUpperCase() as 'BUY' | 'SELL',
          outcome: tradeData.outcome || 'YES',
          size: parseFloat(tradeData.size) || 0,
          price: parseFloat(tradeData.price) || 0,
          usdcSize: parseFloat(tradeData.usdc_size) || parseFloat(tradeData.size) * parseFloat(tradeData.price),
          timestamp: tradeData.timestamp || Date.now(),
          txHash: tradeData.transaction_hash || tradeData.tx_hash,
          marketTitle: tradeData.title,
          marketSlug: tradeData.slug,
        };

        if (trade.walletAddress && trade.size > 0) {
          this.emit('trade', trade);
        }
      } else if (message.type === 'pong' || message.event === 'pong') {
        // Heartbeat response
      }
    } catch (err) {
      logger.debug({ data: data.toString().slice(0, 200) }, 'Failed to parse trade message');
    }
  }

  // ============================================
  // Orderbook Stream
  // ============================================

  async connectOrderbookStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info({ url: API_ENDPOINTS.wsOrderbook }, 'Connecting to orderbook stream');

        this.orderbookWs = new WebSocket(API_ENDPOINTS.wsOrderbook);

        this.orderbookWs.on('open', () => {
          logger.info('Orderbook stream connected');

          // Subscribe to markets we're tracking
          if (this.subscribedTokens.size > 0) {
            this.subscribeToTokens(Array.from(this.subscribedTokens));
          }

          resolve();
        });

        this.orderbookWs.on('message', (data: Buffer) => {
          this.handleOrderbookMessage(data);
        });

        this.orderbookWs.on('error', (error) => {
          logger.error({ error }, 'Orderbook stream error');
          this.emit('error', error);
        });

        this.orderbookWs.on('close', (code, reason) => {
          logger.warn({ code, reason: reason.toString() }, 'Orderbook stream closed');
          this.scheduleReconnect('orderbook');
        });

        setTimeout(() => reject(new Error('Orderbook stream timeout')), 30000);
      } catch (err) {
        reject(err);
      }
    });
  }

  subscribeToTokens(tokenIds: string[]): void {
    for (const tokenId of tokenIds) {
      this.subscribedTokens.add(tokenId);
    }

    if (this.orderbookWs?.readyState === WebSocket.OPEN) {
      this.orderbookWs.send(
        JSON.stringify({
          type: 'MARKET',
          assets_ids: tokenIds,
        })
      );
      logger.debug({ count: tokenIds.length }, 'Subscribed to tokens');
    }
  }

  unsubscribeFromTokens(tokenIds: string[]): void {
    for (const tokenId of tokenIds) {
      this.subscribedTokens.delete(tokenId);
    }

    if (this.orderbookWs?.readyState === WebSocket.OPEN) {
      this.orderbookWs.send(
        JSON.stringify({
          operation: 'unsubscribe',
          assets_ids: tokenIds,
        })
      );
    }
  }

  private handleOrderbookMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'book' || message.event === 'book') {
        const bookData = message.data || message;

        const parseBidsAsks = (arr: any[]): OrderbookLevel[] => {
          return (arr || []).map((item: any) => ({
            price: parseFloat(Array.isArray(item) ? item[0] : item.price),
            size: parseFloat(Array.isArray(item) ? item[1] : item.size),
          }));
        };

        const bids = parseBidsAsks(bookData.bids);
        const asks = parseBidsAsks(bookData.asks);

        const bestBid = bids[0]?.price || 0;
        const bestAsk = asks[0]?.price || 1;
        const midPrice = (bestBid + bestAsk) / 2;

        const orderbook: Orderbook = {
          tokenId: bookData.asset_id || bookData.market || '',
          timestamp: Date.now(),
          bids,
          asks,
          bestBid,
          bestAsk,
          midPrice,
          spreadBps: midPrice > 0 ? Math.round(((bestAsk - bestBid) / midPrice) * 10000) : 0,
        };

        if (orderbook.tokenId) {
          this.emit('orderbook', orderbook);
        }
      } else if (message.type === 'price_change' || message.event === 'price') {
        // Handle incremental price updates
        const priceData = message.data || message;
        const tokenId = priceData.asset_id || priceData.market;
        const price = parseFloat(priceData.price);

        if (tokenId && price) {
          // Emit as a simplified orderbook update
          const orderbook: Orderbook = {
            tokenId,
            timestamp: Date.now(),
            bids: [{ price, size: 0 }],
            asks: [{ price, size: 0 }],
            bestBid: price,
            bestAsk: price,
            midPrice: price,
            spreadBps: 0,
          };
          this.emit('orderbook', orderbook);
        }
      }
    } catch (err) {
      logger.debug({ data: data.toString().slice(0, 200) }, 'Failed to parse orderbook message');
    }
  }

  // ============================================
  // Connection Management
  // ============================================

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.tradeWs?.readyState === WebSocket.OPEN) {
        this.tradeWs.send(JSON.stringify({ type: 'ping' }));
      }
      if (this.orderbookWs?.readyState === WebSocket.OPEN) {
        this.orderbookWs.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private scheduleReconnect(type: 'trade' | 'orderbook'): void {
    const delay = 5000 + Math.random() * 5000; // 5-10s random backoff

    logger.info({ type, delay }, 'Scheduling reconnect');

    setTimeout(async () => {
      try {
        if (type === 'trade') {
          await this.connectTradeStream();
        } else {
          await this.connectOrderbookStream();
        }
      } catch (err) {
        logger.error({ err, type }, 'Reconnect failed');
        this.scheduleReconnect(type);
      }
    }, delay);
  }

  async connect(): Promise<void> {
    await Promise.all([
      this.connectTradeStream().catch((err) => {
        logger.error({ err }, 'Failed to connect trade stream');
      }),
      this.connectOrderbookStream().catch((err) => {
        logger.error({ err }, 'Failed to connect orderbook stream');
      }),
    ]);
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.tradeWs) {
      this.tradeWs.close();
      this.tradeWs = null;
    }
    if (this.orderbookWs) {
      this.orderbookWs.close();
      this.orderbookWs = null;
    }
    this.isConnected = false;
  }

  isTradeStreamConnected(): boolean {
    return this.tradeWs?.readyState === WebSocket.OPEN;
  }

  isOrderbookStreamConnected(): boolean {
    return this.orderbookWs?.readyState === WebSocket.OPEN;
  }

  getStatus(): { tradeStream: boolean; orderbookStream: boolean } {
    return {
      tradeStream: this.isTradeStreamConnected(),
      orderbookStream: this.isOrderbookStreamConnected(),
    };
  }
}

export const wsStream = new WebSocketStream();
