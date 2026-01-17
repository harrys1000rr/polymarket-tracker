import pg, { QueryResult, QueryResultRow, PoolClient } from 'pg';
import { config } from '../config.js';
import { createChildLogger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createChildLogger('database');

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      logger.debug({ duration, rows: result.rowCount }, 'Slow query');
    }
    return result;
  } catch (err) {
    logger.error({ err, query: text.slice(0, 200) }, 'Query error');
    throw err;
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');

  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');

    // Check if already applied
    try {
      const result = await query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version]
      );
      if (result.rows.length > 0) {
        logger.debug({ version }, 'Migration already applied');
        continue;
      }
    } catch {
      // schema_migrations table might not exist yet
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    logger.info({ version }, 'Applying migration');

    await query(sql);
    logger.info({ version }, 'Migration applied successfully');
  }

  logger.info('All migrations complete');
}

export async function checkConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function refreshLeaderboardView(): Promise<void> {
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_current');
}

export async function cleanupOldData(): Promise<void> {
  await query('SELECT cleanup_old_data()');
  logger.info('Old data cleanup completed');
}
