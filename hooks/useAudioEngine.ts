/**
 * useAudioEngine.ts
 *
 * ARCHITECTURE (v5 — Synchronized File Playback):
 *
 *  Transport: File chunks sent over PeerJS SCTP Data Channels.
 *  Sync: NTP ping/pong to measure exact clock offset between Host and Client.
 *  Playback: Web Audio API (AudioBufferSourceNode) for frame-perfect scheduling.
 *
 *  Host flow:
 *    Host selects an audio file -> reads into ArrayBuffer.
 *    Decodes to AudioBuffer for local playback.
 *    Sends file ArrayBuffer in chunks to all connected clients.
 *    Host sends PLAY(startNtp, seekPos) -> schedules its own playback at startNtp.
 *
 *  Client flow:
 *    Connects data channel -> receives file chunks -> reconstructs ArrayBuffer.
 *    Decodes to AudioBuffer.
 *    Receives PLAY(startNtp, seekPos) -> calculates local time = startNtp - offset.
 *    Schedules AudioBufferSourceNode.start(ctx.currentTime + delay) for perfect sync.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
const CHUNK_SIZE    = 64 * 1024; // 64 KB chunks for WebRTC data channels

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

  // Playback state
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isPlaying, setIsPlaying]               = useState(false);
  const [trackName, setTrackName]               = useState<string | null>(null);

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

    // Stop existing source if playing
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
    }

    // Calculate when this should start playing on the local AudioContext timeline
    const localWallTime = performance.now();
    const targetWallTime = ntpTime - clockOffsetRef.current;
    const delayMs = targetWallTime - localWallTime;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    
    if (analyserNode) source.connect(analyserNode);
    source.connect(ctx.destination);
    
    // If delay is negative (we missed the start time), adjust seekPos forward
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
  }, []);

  // ── HOST ──────────────────────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

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

          dataConn.on('data', (msg: any) => {
            if (msg?.type === 'ping') {
              dataConn.send({
                type: 'pong',
                id: msg.id,
                hostTs: performance.now(),
                clientTs: msg.clientTs,
              });
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
  }, [loadPeer, startStatsTick, cleanup]);

  // Host: File Upload
  const uploadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setDownloadProgress(0);
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Decode audio for local playback
      const ctx = audioCtxRef.current;
      if (ctx) {
        audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer.slice(0));
      }
      setTrackName(file.name);
      
      // Send to all clients
      const conns = Array.from(clientConnsRef.current.values());
      if (conns.length > 0) {
        conns.forEach(c => c.send({ type: 'file_start', name: file.name, size: arrayBuffer.byteLength }));
        
        let offset = 0;
        while (offset < arrayBuffer.byteLength) {
          const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
          conns.forEach(c => c.send({ type: 'file_chunk', data: chunk }));
          offset += CHUNK_SIZE;
          setDownloadProgress((offset / arrayBuffer.byteLength) * 100);
          
          // Yield to event loop so we don't freeze the browser
          await new Promise(r => setTimeout(r, 5));
        }
        
        conns.forEach(c => c.send({ type: 'file_end' }));
      }
      setDownloadProgress(100);
    } catch (e: any) {
      setError(`File processing failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        } else if (msg?.type === 'file_start') {
          chunks = [];
          receivedSize = 0;
          expectedSize = msg.size;
          setTrackName(msg.name);
          setDownloadProgress(0);
        } else if (msg?.type === 'file_chunk') {
          chunks.push(msg.data);
          receivedSize += msg.data.byteLength;
          setDownloadProgress((receivedSize / expectedSize) * 100);
        } else if (msg?.type === 'file_end') {
          // Stitch chunks together
          const fullBuffer = new Uint8Array(expectedSize);
          let offset = 0;
          for (const chunk of chunks) {
            fullBuffer.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          chunks = [];
          
          try {
            audioBufferRef.current = await ctx.decodeAudioData(fullBuffer.buffer);
          } catch (e) {
            setError("Failed to decode audio file.");
          }
        } else if (msg?.type === 'play') {
          startPlaybackAt(msg.startNtp, msg.seekPos);
        } else if (msg?.type === 'pause') {
          stopPlayback();
          if (msg.seekPos !== undefined) {
            playbackStartOffsetRef.current = msg.seekPos; // Sync exact pause frame
          }
        } else if (msg?.type === 'sync') {
          if (isPlaying && ctx) {
             const targetWallTime = msg.startNtp - clockOffsetRef.current;
             const delayMs = targetWallTime - performance.now();
             const expectedSeek = msg.seekPos + (delayMs < 0 ? Math.abs(delayMs/1000) : -(delayMs/1000));
             const localSeek = playbackStartOffsetRef.current + (ctx.currentTime - playbackStartCtxTimeRef.current);
             
             // If we're drifted by more than 100ms, force an immediate resync
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

  return {
    mode, isLoading, error, stats,
    connectedClients, analyserNode,
    roomCode, needsGesture,
    trackName, downloadProgress, isPlaying,
    uploadFile, broadcastPlay, broadcastPause,
    startHost, startClient, stop, resumeAudio,
  };
}
