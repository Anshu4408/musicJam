/**
 * useAudioEngine.ts
 *
 * ARCHITECTURE (v6 — Persistent Library & Late-Joiner Sync):
 *
 *  Transport: File chunks sent over PeerJS SCTP Data Channels.
 *  Storage: IndexedDB wrapper (lib/db) persists tracks.
 *  Sync: NTP ping/pong to measure exact clock offset. Web Audio API for playback.
 *
 *  Late-Joiner Handshake:
 *    1. Client connects.
 *    2. Host sends { type: 'welcome', trackName, isPlaying, seekPos, startNtp }.
 *    3. Client checks its local IndexedDB for `trackName`.
 *       a. If found: Instantly load & start playing if needed.
 *       b. If missing: Client sends { type: 'request_file' }.
 *    4. Host sends the file chunks specifically to that client.
 *    5. Client finishes download -> Saves to IndexedDB -> Starts playing.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveTrackToDb, getTrackFromDb, getAllTrackNamesFromDb, deleteTrackFromDb } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppMode = 'idle' | 'host' | 'client';

export interface EngineStats {
  clockOffsetUs: number;
  lastRttUs:     number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NTP_INTERVAL  = 2_000;
const MAX_RTT_HIST  = 8;
const CONN_TIMEOUT  = 18_000;
const CHUNK_SIZE    = 64 * 1024; // 64 KB chunks

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302'  },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80',              username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',             username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const PEER_CONFIG = {
  debug: 0,
  config: { iceServers: ICE_SERVERS },
};

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function makeRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioEngine() {
  const [mode, setMode]                         = useState<AppMode>('idle');
  const [isLoading, setIsLoading]               = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [stats, setStats]                       = useState<EngineStats | null>(null);
  const [connectedClients, setConnectedClients] = useState(0);
  const [analyserNode, setAnalyserNode]         = useState<AnalyserNode | null>(null);
  const [roomCode, setRoomCode]                 = useState('');
  const [needsGesture, setNeedsGesture]         = useState(false);

  // Library & Playback state
  const [libraryTracks, setLibraryTracks]       = useState<string[]>([]);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isPlaying, setIsPlaying]               = useState(false);
  const isPlayingRef                            = useRef(false);
  const [trackName, setTrackName]               = useState<string | null>(null);
  const trackNameRef                            = useRef<string | null>(null);

  const peerRef          = useRef<any>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const audioBufferRef   = useRef<AudioBuffer | null>(null);
  const sourceNodeRef    = useRef<AudioBufferSourceNode | null>(null);
  
  const playbackStartCtxTimeRef = useRef(0);
  const playbackStartOffsetRef  = useRef(0);
  
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ntpIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const clientConnsRef = useRef<Map<string, any>>(new Map());

  // NTP state
  const clockOffsetRef = useRef(0);
  const rttMsHistRef   = useRef<number[]>([]);
  const pingTsRef      = useRef<Map<number, number>>(new Map());
  const pingIdRef      = useRef(0);

  // Load library on mount
  useEffect(() => {
    getAllTrackNamesFromDb().then(setLibraryTracks).catch(() => {});
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    clearInterval(statsIntervalRef.current ?? undefined);
    clearInterval(ntpIntervalRef.current   ?? undefined);
    statsIntervalRef.current = null;
    ntpIntervalRef.current   = null;

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    clientConnsRef.current.forEach(c => { try { c.close(); } catch {} });
    clientConnsRef.current.clear();

    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch {}
      peerRef.current = null;
    }
    
    if (audioCtxRef.current?.state !== 'closed') {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    }

    setAnalyserNode(null);
    setRoomCode('');
    setNeedsGesture(false);
    setDownloadProgress(0);
    setIsPlaying(false);
    setTrackName(null);
    audioBufferRef.current = null;
    playbackStartCtxTimeRef.current = 0;
    playbackStartOffsetRef.current = 0;
    clockOffsetRef.current = 0;
    rttMsHistRef.current   = [];
    pingTsRef.current.clear();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startStatsTick = useCallback(() => {
    statsIntervalRef.current = setInterval(() => {
      const rttMs    = rttMsHistRef.current.length ? median(rttMsHistRef.current) : 0;
      const offsetMs = clockOffsetRef.current;
      setStats({
        lastRttUs:     Math.round(rttMs * 1000),
        clockOffsetUs: Math.round(offsetMs * 1000),
      });
    }, 500);
  }, []);

  const loadPeer = useCallback(async () => {
    const { Peer } = await import('peerjs');
    return Peer;
  }, []);

  // ── PLAYBACK LOGIC (Shared) ────────────────────────────────────────────────

  // Host sync heartbeat
  useEffect(() => {
    if (mode === 'host' && isPlaying && audioCtxRef.current) {
      const id = setInterval(() => {
        const currentSeek = playbackStartOffsetRef.current + (audioCtxRef.current!.currentTime - playbackStartCtxTimeRef.current);
        const conns = Array.from(clientConnsRef.current.values());
        conns.forEach(c => c.send({ type: 'sync', seekPos: currentSeek, startNtp: performance.now() }));
      }, 5000);
      return () => clearInterval(id);
    }
  }, [mode, isPlaying]);

  const startPlaybackAt = useCallback((ntpTime: number, seekPos: number) => {
    const ctx = audioCtxRef.current;
    const buffer = audioBufferRef.current;
    if (!ctx || !buffer) return;

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
    }

    const localWallTime = performance.now();
    const targetWallTime = ntpTime - clockOffsetRef.current;
    const delayMs = targetWallTime - localWallTime;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    
    if (analyserNode) source.connect(analyserNode);
    source.connect(ctx.destination);
    
    let actualSeek = seekPos;
    let startCtxTime = ctx.currentTime;
    
    if (delayMs > 0) {
      startCtxTime += (delayMs / 1000);
    } else {
      actualSeek += Math.abs(delayMs / 1000);
    }

    playbackStartCtxTimeRef.current = startCtxTime;
    playbackStartOffsetRef.current  = actualSeek;

    source.start(startCtxTime, actualSeek);
    sourceNodeRef.current = source;
    setIsPlaying(true);
    isPlayingRef.current = true;
  }, [analyserNode]);

  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      if (audioCtxRef.current) {
        playbackStartOffsetRef.current += Math.max(0, audioCtxRef.current.currentTime - playbackStartCtxTimeRef.current);
      }
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, []);

  // ── HOST ──────────────────────────────────────────────────────────────────

  const sendFileToConnection = async (conn: any, name: string, arrayBuffer: ArrayBuffer) => {
    conn.send({ type: 'file_start', name, size: arrayBuffer.byteLength });
    let offset = 0;
    while (offset < arrayBuffer.byteLength) {
      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
      conn.send({ type: 'file_chunk', data: chunk });
      offset += CHUNK_SIZE;
      await new Promise(r => setTimeout(r, 5));
    }
    conn.send({ type: 'file_end' });
  };

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      ctx.onstatechange = () => {
        setNeedsGesture(ctx.state === 'suspended');
      };

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      setAnalyserNode(analyser);

      const code = makeRoomCode();
      const Peer  = await loadPeer();
      const peer  = new Peer(`mj2-${code}`, PEER_CONFIG);
      peerRef.current = peer;

      await new Promise<void>((res, rej) => {
        peer.on('open', () => { setRoomCode(code); res(); });
        peer.on('error', rej);
        setTimeout(() => rej(new Error('PeerJS timeout — try again')), 12_000);
      });

      peer.on('connection', (dataConn: any) => {
        dataConn.on('open', () => {
          clientConnsRef.current.set(dataConn.peer, dataConn);
          setConnectedClients(clientConnsRef.current.size);

          // 1. Send Welcome Message (Handshake)
          const currentIsPlaying = isPlayingRef.current;
          const currentTrack = trackNameRef.current;
          const currentSeek = currentIsPlaying && audioCtxRef.current 
            ? playbackStartOffsetRef.current + (audioCtxRef.current.currentTime - playbackStartCtxTimeRef.current)
            : playbackStartOffsetRef.current;
          
          dataConn.send({
            type: 'welcome',
            trackName: currentTrack,
            isPlaying: currentIsPlaying,
            seekPos: currentSeek,
            startNtp: performance.now(),
          });

          dataConn.on('data', async (msg: any) => {
            if (msg?.type === 'ping') {
              dataConn.send({
                type: 'pong',
                id: msg.id,
                hostTs: performance.now(),
                clientTs: msg.clientTs,
              });
            } else if (msg?.type === 'request_file' && trackNameRef.current) {
              // 2. Client doesn't have the file, send it specifically to them
              const track = await getTrackFromDb(trackNameRef.current);
              if (track) {
                await sendFileToConnection(dataConn, trackNameRef.current, track.data);
              }
            }
          });

          const remove = () => {
            clientConnsRef.current.delete(dataConn.peer);
            setConnectedClients(clientConnsRef.current.size);
          };
          dataConn.on('close', remove);
          dataConn.on('error', remove);
        });
      });

      peer.on('error', (err: any) => setError(`Host error: ${err?.message ?? err?.type}`));

      setMode('host');
      startStatsTick();
      setIsLoading(false);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to start host');
      cleanup();
      setIsLoading(false);
    }
  }, [loadPeer, startStatsTick, cleanup, isPlaying, trackName]);

  const loadTrackIntoEngine = async (name: string, arrayBuffer: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (ctx) {
      audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer.slice(0));
    }
    setTrackName(name);
    trackNameRef.current = name;
    setDownloadProgress(100);
    playbackStartCtxTimeRef.current = 0;
    playbackStartOffsetRef.current = 0;
    if (isPlayingRef.current) stopPlayback();
  };

  // Host: Load from Library
  const loadFromLibrary = useCallback(async (name: string) => {
    setIsLoading(true);
    try {
      const track = await getTrackFromDb(name);
      if (!track) throw new Error("Track not found in library.");
      
      await loadTrackIntoEngine(name, track.data);
      
      // Tell all clients we switched tracks, they will self-sync
      const conns = Array.from(clientConnsRef.current.values());
      conns.forEach(c => c.send({ type: 'welcome', trackName: name, isPlaying: false, seekPos: 0, startNtp: performance.now() }));
    } catch (e: any) {
      setError(`Failed to load from library: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [isPlaying, stopPlayback]);

  // Host: File Upload
  const uploadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setDownloadProgress(0);
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Save to IDB
      await saveTrackToDb(file.name, arrayBuffer);
      setLibraryTracks(prev => Array.from(new Set([...prev, file.name])));
      
      await loadTrackIntoEngine(file.name, arrayBuffer);
      
      // Tell clients to sync
      const conns = Array.from(clientConnsRef.current.values());
      conns.forEach(c => c.send({ type: 'welcome', trackName: file.name, isPlaying: false, seekPos: 0, startNtp: performance.now() }));
    } catch (e: any) {
      setError(`File processing failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [isPlaying, stopPlayback]);

  // Host: Broadcast Play/Pause
  const broadcastPlay = useCallback(() => {
    const ntpTime = performance.now() + 500; // start 500ms in future
    const currentSeek = playbackStartOffsetRef.current;
    const conns = Array.from(clientConnsRef.current.values());
    conns.forEach(c => c.send({ type: 'play', startNtp: ntpTime, seekPos: currentSeek }));
    startPlaybackAt(ntpTime, currentSeek);
  }, [startPlaybackAt]);

  const broadcastPause = useCallback(() => {
    stopPlayback(); // Update our local seek pos
    const currentSeek = playbackStartOffsetRef.current;
    const conns = Array.from(clientConnsRef.current.values());
    conns.forEach(c => c.send({ type: 'pause', seekPos: currentSeek }));
  }, [stopPlayback]);


  // ── CLIENT ────────────────────────────────────────────────────────────────

  const startClient = useCallback(async (code: string) => {
    setError(null);
    setIsLoading(true);

    const roomId = code.trim().toUpperCase();
    if (!roomId) {
      setError('Enter the room code shown on the host.');
      setIsLoading(false);
      return;
    }

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    ctx.resume().catch(() => {});
    
    ctx.onstatechange = () => {
      setNeedsGesture(ctx.state === 'suspended');
    };

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    setAnalyserNode(analyser);

    try {
      const Peer     = await loadPeer();
      const clientId = `mj2-c-${makeRoomCode()}`;
      const peer     = new Peer(clientId, PEER_CONFIG);
      peerRef.current = peer;

      await new Promise<void>((res, rej) => {
        peer.on('open', res);
        peer.on('error', rej);
        setTimeout(() => rej(new Error('PeerJS timeout')), 12_000);
      });

      const conn = peer.connect(`mj2-${roomId}`, { reliable: true });

      const connTimeout = setTimeout(() => {
        if (!conn.open) {
          setError('Connection timed out.');
          cleanup();
          setIsLoading(false);
        }
      }, CONN_TIMEOUT);

      peer.on('error', (err: any) => {
        clearTimeout(connTimeout);
        setError(err?.type === 'peer-unavailable' ? 'Room not found.' : `Connection error: ${err.message}`);
        cleanup();
        setIsLoading(false);
      });

      let chunks: ArrayBuffer[] = [];
      let expectedSize = 0;
      let receivedSize = 0;
      let receivingTrackName = '';

      // Late-joiner sync state
      let pendingWelcomeState: { isPlaying: boolean, startNtp: number, seekPos: number } | null = null;

      conn.on('open', () => {
        clearTimeout(connTimeout);
        setIsLoading(false);
        setMode('client');
        
        const sendPing = () => {
          if (!conn.open) return;
          const id = pingIdRef.current++;
          const now = performance.now();
          pingTsRef.current.set(id, now);
          try { conn.send({ type: 'ping', id, clientTs: now }); } catch {}
        };
        sendPing();
        ntpIntervalRef.current = setInterval(sendPing, NTP_INTERVAL);
        startStatsTick();
      });

      conn.on('data', async (msg: any) => {
        if (msg?.type === 'pong') {
          const sendTime = pingTsRef.current.get(msg.id);
          if (sendTime === undefined) return;
          pingTsRef.current.delete(msg.id);
          const rttMs = performance.now() - sendTime;
          rttMsHistRef.current.push(rttMs);
          if (rttMsHistRef.current.length > MAX_RTT_HIST) rttMsHistRef.current.shift();
          const minRtt = Math.min(...rttMsHistRef.current);
          clockOffsetRef.current = msg.hostTs - sendTime - minRtt / 2;
        } else if (msg?.type === 'welcome') {
          // Handshake protocol
          if (!msg.trackName) return;
          
          setTrackName(msg.trackName);
          stopPlayback();
          
          // Check if we have it in IndexedDB
          const savedTrack = await getTrackFromDb(msg.trackName);
          if (savedTrack) {
            setDownloadProgress(100);
            audioBufferRef.current = await ctx.decodeAudioData(savedTrack.data.slice(0));
            
            // If the host is currently playing, jump right in
            if (msg.isPlaying) {
              startPlaybackAt(msg.startNtp, msg.seekPos);
            } else {
              playbackStartOffsetRef.current = msg.seekPos;
            }
          } else {
            // We don't have it, ask the host to send it
            setDownloadProgress(0);
            pendingWelcomeState = { isPlaying: msg.isPlaying, startNtp: msg.startNtp, seekPos: msg.seekPos };
            conn.send({ type: 'request_file', trackName: msg.trackName });
          }
        } else if (msg?.type === 'file_start') {
          chunks = [];
          receivedSize = 0;
          expectedSize = msg.size;
          receivingTrackName = msg.name;
          setDownloadProgress(0);
        } else if (msg?.type === 'file_chunk') {
          chunks.push(msg.data);
          receivedSize += msg.data.byteLength;
          setDownloadProgress((receivedSize / expectedSize) * 100);
        } else if (msg?.type === 'file_end') {
          const fullBuffer = new Uint8Array(expectedSize);
          let offset = 0;
          for (const chunk of chunks) {
            fullBuffer.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          chunks = [];
          
          try {
            // Save to IDB for next time!
            await saveTrackToDb(receivingTrackName, fullBuffer.buffer.slice(0));
            setLibraryTracks(prev => Array.from(new Set([...prev, receivingTrackName])));
            
            audioBufferRef.current = await ctx.decodeAudioData(fullBuffer.buffer);
            
            // Apply pending welcome state if we missed it while downloading
            if (pendingWelcomeState && pendingWelcomeState.isPlaying) {
              startPlaybackAt(pendingWelcomeState.startNtp, pendingWelcomeState.seekPos);
            } else if (pendingWelcomeState) {
              playbackStartOffsetRef.current = pendingWelcomeState.seekPos;
            }
            pendingWelcomeState = null;
          } catch (e) {
            setError("Failed to decode audio file.");
          }
        } else if (msg?.type === 'play') {
          startPlaybackAt(msg.startNtp, msg.seekPos);
        } else if (msg?.type === 'pause') {
          stopPlayback();
          if (msg.seekPos !== undefined) {
            playbackStartOffsetRef.current = msg.seekPos;
          }
        } else if (msg?.type === 'sync') {
          if (isPlaying && ctx) {
             const targetWallTime = msg.startNtp - clockOffsetRef.current;
             const delayMs = targetWallTime - performance.now();
             const expectedSeek = msg.seekPos + (delayMs < 0 ? Math.abs(delayMs/1000) : -(delayMs/1000));
             const localSeek = playbackStartOffsetRef.current + (ctx.currentTime - playbackStartCtxTimeRef.current);
             
             if (Math.abs(localSeek - expectedSeek) > 0.1) {
                startPlaybackAt(msg.startNtp, msg.seekPos);
             }
          }
        }
      });

      conn.on('close', () => {
        if (peerRef.current) { setError('Host disconnected.'); stop(); }
      });

    } catch (e: any) {
      setError(e?.message ?? 'Failed to join.');
      cleanup();
      setIsLoading(false);
    }
  }, [loadPeer, startStatsTick, cleanup, startPlaybackAt, stopPlayback]);

  // ── Stop ──────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    cleanup();
    setMode('idle');
    setStats(null);
    setConnectedClients(0);
  }, [cleanup]);

  const resumeAudio = useCallback(() => {
    audioCtxRef.current?.resume().then(() => setNeedsGesture(false)).catch(() => {});
  }, []);
  
  const deleteFromLibrary = useCallback(async (name: string) => {
    await deleteTrackFromDb(name);
    setLibraryTracks(prev => prev.filter(t => t !== name));
  }, []);

  return {
    mode, isLoading, error, stats,
    connectedClients, analyserNode,
    roomCode, needsGesture,
    trackName, downloadProgress, isPlaying, libraryTracks,
    uploadFile, loadFromLibrary, deleteFromLibrary, broadcastPlay, broadcastPause,
    startHost, startClient, stop, resumeAudio,
  };
}
