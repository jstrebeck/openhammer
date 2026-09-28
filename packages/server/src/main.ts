import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.OPENHAMMER_DATA ?? '.data/rooms';

const server = await startServer({ port, dataDir });
console.log(`OpenHammer server listening on ws://localhost:${server.port}`);

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
