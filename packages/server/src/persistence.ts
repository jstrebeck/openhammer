import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomManager, SerializedRoom } from './rooms.js';

/**
 * Games survive a server restart: each room is serialized to disk after
 * every applied action and reloaded at startup.
 */

export function saveRoom(dataDir: string, room: SerializedRoom): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, `${room.id}.json`), JSON.stringify(room), 'utf8');
}

export function loadRooms(dataDir: string, manager: RoomManager): number {
  if (!existsSync(dataDir)) return 0;
  let count = 0;
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const serialized = JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as SerializedRoom;
      manager.restore(serialized);
      count++;
    } catch (e) {
      console.error(`failed to restore room from ${file}: ${(e as Error).message}`);
    }
  }
  return count;
}
