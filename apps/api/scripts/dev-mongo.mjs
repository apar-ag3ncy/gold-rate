// Local development without Docker: an in-memory MongoDB on port 27017 (data is lost when this process stops).
// Usage: npm run dev:mongo   (then `npm run seed`, `npm run dev:api`, `npm run dev:web`, `npm run dev:worker`)
import { MongoMemoryServer } from 'mongodb-memory-server';
const port = Number(process.env.DEV_MONGO_PORT ?? 27017);
const mem = await MongoMemoryServer.create({ instance: { port, dbName: 'chheda_gold', launchTimeout: 60_000 } });
console.log(`In-memory MongoDB running at ${mem.getUri()} – keep this terminal open. Ctrl+C to stop (all data is discarded).`);
const stop = async () => { await mem.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
