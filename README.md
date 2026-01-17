# Polymarket Tracker

A **real-time** analytics platform that monitors top Polymarket traders and provides a realistic "copy trading" performance simulator.

## Features

- **Real-time Leaderboard**: Live updates via Server-Sent Events showing top 10 traders by realized PnL
- **Realistic Copy Simulator**: Monte Carlo simulation with orderbook-aware slippage, market impact, and entry delays
- **Wallet Analytics**: Detailed stats for individual traders including trade history and PnL charts
- **Security First**: Read-only design - no private keys, no signing, no wallet execution

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                            │
│  Live Leaderboard │ Wallet Details │ Copy Trading Simulator     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST API + SSE
┌───────────────────────────────▼─────────────────────────────────┐
│                    Backend (Node.js/TypeScript)                  │
│                                                                  │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │  WebSocket   │  │  Aggregator   │  │  Realistic         │  │
│  │  Streams     │  │  Worker       │  │  Simulator         │  │
│  └──────┬───────┘  └───────┬───────┘  └─────────────────────┘  │
│         │                  │                                     │
│  ┌──────▼──────────────────▼────────────────────────────────┐  │
│  │                    PostgreSQL                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────▼───────────────────────────┐
        │         Polymarket Public APIs (Read-Only)         │
        │  WebSocket Streams │ REST APIs │ Subgraphs         │
        └────────────────────────────────────────────────────┘
```

## Security Design

This system is **safe by design**:

- **No private keys**: Cannot sign any transactions
- **No execution**: Read-only data fetching only
- **No secrets**: Only uses public API endpoints
- **No sensitive data**: Only stores public blockchain data

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL (or use Docker)

### Option 1: Docker Compose (Recommended)

```bash
# Clone and start all services
git clone <repo-url> polymarket-tracker
cd polymarket-tracker
docker-compose up -d

# View logs
docker-compose logs -f

# Access the app
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001
```

### Option 2: Manual Setup

```bash
# Start PostgreSQL
docker run -d \
  --name polymarket-db \
  -e POSTGRES_USER=polymarket \
  -e POSTGRES_PASSWORD=polymarket_dev \
  -e POSTGRES_DB=polymarket \
  -p 5432:5432 \
  postgres:16-alpine

# Backend
cd backend
npm install
cp .env.example .env  # Edit with your settings
npm run dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

## Northflank Deployment

### Step 1: Create Northflank Project

1. Go to [Northflank](https://northflank.com) and sign in
2. Click **Create Project**
3. Name it `polymarket-tracker`
4. Select your preferred region

### Step 2: Add PostgreSQL Database

1. In your project, go to **Add-ons** → **Add database**
2. Select **PostgreSQL**
3. Choose tier:
   - **Starter** (1GB) for testing
   - **Standard** (10GB) for production
4. Click **Create**
5. Note the **Connection URI** from the addon details

### Step 3: Deploy Backend Service

1. Go to **Services** → **Add service** → **Backend**
2. **Build settings**:
   - Build type: **Dockerfile**
   - Dockerfile path: `/backend/Dockerfile`
   - Context: `/backend`
3. **Resources**:
   - vCPU: 0.5
   - Memory: 512MB
4. **Environment variables**:
   ```
   NODE_ENV=production
   PORT=3001
   DATABASE_URL=<paste PostgreSQL URI from Step 2>
   POLYMARKET_DATA_API=https://data-api.polymarket.com
   POLYMARKET_CLOB_API=https://clob.polymarket.com
   POLYMARKET_GAMMA_API=https://gamma-api.polymarket.com
   POLYMARKET_WS_TRADES=wss://ws-live-data.polymarket.com
   POLYMARKET_WS_ORDERBOOK=wss://ws-subscriptions-clob.polymarket.com/ws/
   TRADE_BACKFILL_DAYS=7
   GBP_USD_RATE=1.27
   ```
5. **Networking**:
   - Public port: 3001
   - Health check path: `/api/health`
6. Click **Deploy**
7. Note the public URL (e.g., `https://backend-xxx.northflank.app`)

### Step 4: Deploy Frontend Service

1. Go to **Services** → **Add service** → **Combined**
2. **Build settings**:
   - Build type: **Dockerfile**
   - Dockerfile path: `/frontend/Dockerfile`
   - Context: `/frontend`
   - Build arguments:
     ```
     NEXT_PUBLIC_API_URL=<backend URL from Step 3>
     ```
3. **Resources**:
   - vCPU: 0.25
   - Memory: 256MB
4. **Environment variables**:
   ```
   NEXT_PUBLIC_API_URL=<backend URL from Step 3>
   ```
5. **Networking**:
   - Public port: 3000
6. Click **Deploy**

### Step 5: Verify Deployment

1. Wait for both services to show **Running** status
2. Check backend health: `https://<backend-url>/api/health`
3. Access frontend: `https://<frontend-url>`

## API Endpoints

### Health Check
```
GET /api/health
```

### Leaderboard
```
GET /api/leaderboard?metric=realized_pnl&limit=10
```

### Wallet Details
```
GET /api/wallet/:address
```

### Copy Trading Simulation
```
POST /api/follower-sim
{
  "bankrollGbp": 100,
  "entryDelaySec": 60,
  "delayVarianceSec": 30,
  "sizingRule": "equal",
  "maxExposurePct": 10,
  "useActualOrderbook": true,
  "marketImpactEnabled": true,
  "numSimulations": 500,
  "windowDays": 7
}
```

### Live Leaderboard Stream (SSE)
```
GET /api/stream/leaderboard
```

## Simulation Methodology

### Entry Delay Model
Trades are simulated with a configurable delay (default: 60s ± 30s) to account for detection and execution time.

### Slippage Model
Uses historical orderbook depth to calculate realistic fill prices. Large trades eat through multiple price levels.

### Market Impact (Almgren-Chriss)
Applies square-root market impact model for larger positions, accounting for how your trades would move the market.

### Monte Carlo Simulation
Runs 500+ simulations with randomized delays to generate a distribution of outcomes (5th, 25th, 50th, 75th, 95th percentiles).

## Disclaimers

**HYPOTHETICAL SIMULATION ONLY - NOT FINANCIAL ADVICE**

- Past performance does not guarantee future results
- All results are based on historical data with assumptions
- Entry delays, slippage, and market impact are estimated
- Transaction costs (gas fees) are not included
- Do your own research before trading
- You could lose your entire investment

## Project Structure

```
polymarket-tracker/
├── backend/
│   ├── src/
│   │   ├── index.ts           # Main server entry
│   │   ├── config.ts          # Configuration
│   │   ├── models/            # Database & types
│   │   ├── routes/            # API routes
│   │   ├── services/          # Core services
│   │   │   ├── polymarket-api.ts    # API client
│   │   │   ├── websocket-stream.ts  # Real-time streams
│   │   │   ├── data-store.ts        # Database ops
│   │   │   └── simulator.ts         # Copy trading sim
│   │   ├── workers/           # Background workers
│   │   │   └── aggregator.ts  # Stats aggregation
│   │   ├── utils/             # Utilities
│   │   └── migrations/        # SQL migrations
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/               # Next.js app router
│   │   ├── components/        # React components
│   │   ├── hooks/             # Custom hooks (SWR)
│   │   ├── utils/             # Formatting utilities
│   │   └── types/             # TypeScript types
│   ├── Dockerfile
│   └── package.json
├── docs/
│   └── TECHNICAL_DESIGN.md
├── docker-compose.yml
└── README.md
```

## Environment Variables

### Backend

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | HTTP server port | 3001 |
| `NODE_ENV` | Environment (development/production) | development |
| `POLYMARKET_DATA_API` | Data API URL | https://data-api.polymarket.com |
| `POLYMARKET_CLOB_API` | CLOB API URL | https://clob.polymarket.com |
| `POLYMARKET_GAMMA_API` | Gamma API URL | https://gamma-api.polymarket.com |
| `POLYMARKET_WS_TRADES` | Trade WebSocket URL | wss://ws-live-data.polymarket.com |
| `POLYMARKET_WS_ORDERBOOK` | Orderbook WebSocket URL | wss://ws-subscriptions-clob.polymarket.com/ws/ |
| `TRADE_BACKFILL_DAYS` | Days of trade history to backfill | 7 |
| `GBP_USD_RATE` | GBP/USD exchange rate | 1.27 |

### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | http://localhost:3001 |

## License

MIT
