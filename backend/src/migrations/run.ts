import { runMigrations } from '../models/database.js';
import { logger } from '../utils/logger.js';

async function main() {
  try {
    await runMigrations();
    logger.info('Migrations completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    process.exit(1);
  }
}

main();
