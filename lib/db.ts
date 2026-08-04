import { get, set, keys, del } from 'idb-keyval';

export interface SavedTrack {
  name: string;
  data: ArrayBuffer;
  timestamp: number;
}

const TRACK_PREFIX = 'mj_track_';

export async function saveTrackToDb(name: string, data: ArrayBuffer): Promise<void> {
  const track: SavedTrack = {
    name,
    data,
    timestamp: Date.now(),
  };
  await set(`${TRACK_PREFIX}${name}`, track);
}

export async function getTrackFromDb(name: string): Promise<SavedTrack | undefined> {
  return await get<SavedTrack>(`${TRACK_PREFIX}${name}`);
}

export async function getAllTrackNamesFromDb(): Promise<string[]> {
  const allKeys = await keys();
  return allKeys
    .filter(k => typeof k === 'string' && k.startsWith(TRACK_PREFIX))
    .map(k => (k as string).replace(TRACK_PREFIX, ''));
}

export async function deleteTrackFromDb(name: string): Promise<void> {
  await del(`${TRACK_PREFIX}${name}`);
}
