import { readConfig } from './config.js';
import { openStore, migrate } from './db.js';

const store = await openStore(readConfig());
try {
  await migrate(store);
  console.log('数据库迁移完成');
} finally {
  await store.close();
}
