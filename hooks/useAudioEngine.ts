/**
 * useAudioEngine.ts — Synchronized audio streaming via WebRTC data channels.
 *
 * PROTOCOL: JSON messages over PeerJS data channel (serialization:'json').
 *   JSON is 100% reliable across all browsers — no BinaryPack/Blob issues.
 *   Audio samples are base64-encoded Int16 PCM in each message.
 *
 * SYNC STRATEGY: Relative scheduling from first received frame.
 *   The NTP-absolute approach fails for late-joining clients because the
 *   AudioContext accumulates time during WebRTC setup (3–10 s), so
 *   NTP-derived scheduleAt lands in the past → frames silently skipped.
 *
 *   Instead: on the first good audio frame, anchor playback to
 *   (ctx.currentTime + START_BUFFER). All subsequent frames are scheduled
 *   at (anchorClientTime + frame.ts - anchorHostTs) — preserving the host's
 *   relative timing perfectly. Clients who connect at the same time will be
 *   in sync; NTP is still used for the stats RTT/offset display.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppMode = 'idle' | 'host' | 'client';

export interface EngineStats {
  encodedFrames: number;
  bytesSent:     number;
  lastRttUs:     number;
  clockOffsetUs: number;
  bitrateKbps:   number;
  latencyMs:     number;
  bufferMs:      number;   // current adaptive jitter buffer size
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SAMPLE_RATE      = 24_000;          // Hz
const CHUNK_SAMPLES    = 512;             // 21 ms per frame at 24 kHz (was 2048→85 ms)
const MIN_BUFFER       = 0.08;            // 80 ms — minimum jitter buffer
const MAX_BUFFER       = 0.60;            // 600 ms — maximum before it feels broken
const CATCHUP_THRESH   = 0.25;            // seconds behind → reset anchor
const NTP_INTERVAL     = 2_000;           // ms
const MAX_RTT_HIST     = 8;
const CONN_TIMEOUT     = 18_000;          // ms
// Adaptive jitter buffer tuning
const JB_WINDOW        = 40;              // frames to measure over (~840 ms at 512/24 kHz)
const JB_TARGET_FLOOR  = 0.015;           // want ≥15 ms headroom
const JB_SHRINK_STEP   = 0.010;           // shrink by 10 ms per window
const JB_GROW_FACTOR   = 1.5;            // overshoot when growing

// ICE servers — STUN + multiple free TURN providers
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302'  },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Open Relay Project TURN
  { urls: 'turn:openrelay.metered.ca:80',             username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',            username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  // Metered.ca free TURN
  { urls: 'turn:a.relay.metered.ca:80',               username: 'e499b2e86e5b3bc6e8f67d4e', credential: 'nUEWPFLyf+8XAYT/' },
  { urls: 'turn:a.relay.metered.ca:443',              username: 'e499b2e86e5b3bc6e8f67d4e', credential: 'nUEWPFLyf+8XAYT/' },
  { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'e499b2e86e5b3bc6e8f67d4e', credential: 'nUEWPFLyf+8XAYT/' },
];

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: 'all' as RTCIceTransportPolicy,
  },
};

// ─── PCM helpers ──────────────────────────────────────────────────────────────

function f32ToI16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return i16;
}

function i16ToF32(i16: Int16Array): Float32Array {
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) {
    f32[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return f32;
}

/** Encode Int16Array → base64 string for JSON transport */
function i16ToB64(i16: Int16Array): string {
  const bytes  = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let   binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode base64 string → Int16Array */
function b64ToI16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

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

  const peerRef          = useRef<any>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ntpIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const clientConnsRef   = useRef<Map<string, any>>(new Map());

  // NTP state (per-client session)
  const clockOffsetRef = useRef(0);
  const rttHistRef     = useRef<number[]>([]);
  const pingTsRef      = useRef<Map<number, number>>(new Map());
  const pingIdRef      = useRef(0);

  // Stats
  const frameCountRef = useRef(0);
  const bytesRef      = useRef(0);
  const bufferRef     = useRef(MIN_BUFFER); // current adaptive jitter buffer size (seconds)

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    clearInterval(statsIntervalRef.current ?? undefined);
    clearInterval(ntpIntervalRef.current   ?? undefined);
    statsIntervalRef.current = null;
    ntpIntervalRef.current   = null;

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    clientConnsRef.current.forEach(c => { try { c.close(); } catch {} });
    clientConnsRef.current.clear();

    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch {}
      peerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current?.state !== 'closed') {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    }

    setAnalyserNode(null);
    setRoomCode('');
    setNeedsGesture(false);
    frameCountRef.current = 0;
    bytesRef.current      = 0;
    clockOffsetRef.current = 0;
    rttHistRef.current     = [];
    pingTsRef.current.clear();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Stats ticker ───────────────────────────────────────────────────────────

  const startStatsTick = useCallback(() => {
    statsIntervalRef.current = setInterval(() => {
      const fps = SAMPLE_RATE / CHUNK_SAMPLES; // 46.9 fps at 512/24kHz
      const bpt = (CHUNK_SAMPLES * 2 * 1.37) / fps; // base64 ~37% overhead
      frameCountRef.current += fps;
      bytesRef.current      += bpt;

      const rttUs    = rttHistRef.current.length
        ? median(rttHistRef.current) * 1_000_000
        : 0;
      const offsetUs = clockOffsetRef.current * 1_000_000;

      setStats({
        encodedFrames: Math.round(frameCountRef.current),
        bytesSent:     Math.round(bytesRef.current),
        lastRttUs:     Math.round(rttUs),
        clockOffsetUs: Math.round(offsetUs),
        bitrateKbps:   Math.round((bpt * 8 * fps) / 1000),
        latencyMs:     Math.round(bufferRef.current * 1000 + CHUNK_SAMPLES / SAMPLE_RATE * 500),
        bufferMs:      Math.round(bufferRef.current * 1000),
      });
    }, 500);
  }, []);

  const loadPeer = useCallback(async () => {
    const { Peer } = await import('peerjs');
    return Peer;
  }, []);

  // ── HOST ──────────────────────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const display = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: false,
      });

      display.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
      const audioTracks = display.getAudioTracks();

      if (audioTracks.length === 0) {
        display.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        const isMac = /Mac/.test(navigator.userAgent) && !/Win/.test(navigator.userAgent);
        throw new Error(
          isMac
            ? '🍎 macOS: In the share dialog → switch to "Tab" → pick your Spotify/YouTube tab → tick "Share tab audio" ✅ → Share.'
            : '⚠️ No audio captured.\n• Sharing a Tab → tick "Share tab audio" ✅\n• Sharing Screen → tick "Share system audio" ✅'
        );
      }

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;

      const source   = ctx.createMediaStreamSource(audioStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // Capture PCM via ScriptProcessor
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = ctx.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
      source.connect(processor);
      processor.connect(ctx.destination);
      processorRef.current = processor;

      let seq = 0;
      processor.onaudioprocess = (e) => {
        const f32    = e.inputBuffer.getChannelData(0);
        const i16    = f32ToI16(f32);
        const hostTs = e.playbackTime;
        const msg    = { type: 'audio', seq: seq++, ts: hostTs, samples: i16ToB64(i16) };

        clientConnsRef.current.forEach(conn => {
          try { if (conn.open) conn.send(msg); } catch {}
        });
      };

      // PeerJS host
      const code = makeRoomCode();
      const Peer  = await loadPeer();
      const peer  = new Peer(`mj2-${code}`, PEER_CONFIG);
      peerRef.current = peer;

      await new Promise<void>((res, rej) => {
        peer.on('open', () => { setRoomCode(code); res(); });
        peer.on('error', rej);
        setTimeout(() => rej(new Error('PeerJS timeout — try again')), 12_000);
      });

      peer.on('connection', (conn: any) => {
        conn.on('open', () => {
          conn.send({ type: 'init', sampleRate: SAMPLE_RATE, channelCount: 1 });
          clientConnsRef.current.set(conn.peer, conn);
          setConnectedClients(clientConnsRef.current.size);

          conn.on('data', (msg: any) => {
            if (msg?.type === 'ping') {
              conn.send({ type: 'pong', id: msg.id, hostTs: audioCtxRef.current!.currentTime, clientTs: msg.clientTs });
            }
          });

          const remove = () => {
            clientConnsRef.current.delete(conn.peer);
            setConnectedClients(clientConnsRef.current.size);
          };
          conn.on('close', remove);
          conn.on('error', remove);
        });
      });

      peer.on('error', (err: any) => setError(`Host error: ${err?.message ?? err?.type}`));
      audioTracks[0].addEventListener('ended', () => stop());

      setMode('host');
      startStatsTick();

    } catch (e: any) {
      const msg = e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
        ? 'Screen share cancelled — please try again.'
        : e?.message ?? 'Failed to start host';
      setError(msg);
      cleanup();
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPeer, startStatsTick, cleanup]);

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

    // Create + resume AudioContext NOW (inside user gesture) so it's unlocked
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      await ctx.resume();
    } catch {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }

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

      const conn = peer.connect(`mj2-${roomId}`, {
        reliable:      true,
        serialization: 'json', // ← JSON: 100% cross-browser, no BinaryPack issues
      });

      // Timeout if data channel never opens
      const connTimeout = setTimeout(() => {
        if (!conn.open) {
          setError(
            'Connection timed out.\n' +
            '• Check the room code with the host\n' +
            '• Make sure the host is broadcasting\n' +
            '• Try a different network if on mobile data'
          );
          cleanup();
          setIsLoading(false);
        }
      }, CONN_TIMEOUT);

      peer.on('error', (err: any) => {
        clearTimeout(connTimeout);
        const notFound = err?.type === 'peer-unavailable';
        setError(notFound
          ? `Room "${roomId}" not found — make sure the host is running.`
          : `Connection error: ${err?.message ?? err?.type}`
        );
        cleanup();
        setIsLoading(false);
      });

      conn.on('error', (err: any) => {
        clearTimeout(connTimeout);
        setError(`Could not reach host: ${err?.message ?? 'check the room code'}`);
        cleanup();
        setIsLoading(false);
      });

      // NTP helpers
      const sendPing = () => {
        if (!conn.open) return;
        const id = pingIdRef.current++;
        const clientTs = ctx.currentTime;
        pingTsRef.current.set(id, clientTs);
        try { conn.send({ type: 'ping', id, clientTs }); } catch {}
      };

      conn.on('open', () => {
        clearTimeout(connTimeout);
        sendPing();
        ntpIntervalRef.current = setInterval(sendPing, NTP_INTERVAL);
        setIsLoading(false);
        setMode('client');
        startStatsTick();
      });

      // ── Relative scheduling state + adaptive jitter buffer ──────────────
      let anchorClientTime: number | null = null;
      let anchorHostTs:     number | null = null;
      const headroomHistory: number[] = [];  // rolling headroom window
      bufferRef.current = MIN_BUFFER;        // reset buffer for this session

      conn.on('data', (msg: any) => {
        if (!msg?.type) return;

        // ── NTP pong ──────────────────────────────────────────────────────
        if (msg.type === 'pong') {
          const sendTs = pingTsRef.current.get(msg.id);
          if (sendTs === undefined) return;
          pingTsRef.current.delete(msg.id);
          const rtt = ctx.currentTime - sendTs;
          rttHistRef.current.push(rtt);
          if (rttHistRef.current.length > MAX_RTT_HIST) rttHistRef.current.shift();
          const minRtt = Math.min(...rttHistRef.current);
          clockOffsetRef.current = msg.hostTs - sendTs - minRtt / 2;
          return;
        }

        // ── Audio frame ───────────────────────────────────────────────────
        if (msg.type === 'audio') {
          // Resume AudioContext if suspended (Android Chrome)
          if (ctx.state === 'suspended') {
            setNeedsGesture(true);
            ctx.resume().then(() => setNeedsGesture(false)).catch(() => {});
            return;
          }

          // ── Adaptive jitter buffer ─────────────────────────────────────
          // Set anchor on first frame with current adaptive buffer size
          if (anchorClientTime === null || anchorHostTs === null) {
            anchorClientTime = ctx.currentTime + bufferRef.current;
            anchorHostTs     = msg.ts;
            headroomHistory.length = 0;
          }

          // Relative schedule: preserves host's relative timing exactly
          let scheduleAt = anchorClientTime + (msg.ts - anchorHostTs);

          // Hard reset if we've fallen badly behind (tab backgrounded, etc.)
          if (scheduleAt < ctx.currentTime - CATCHUP_THRESH) {
            anchorClientTime = ctx.currentTime + bufferRef.current;
            anchorHostTs     = msg.ts;
            scheduleAt       = anchorClientTime;
            headroomHistory.length = 0;
          }

          // Measure headroom (how far in the future this frame is scheduled)
          const headroom = scheduleAt - ctx.currentTime;
          headroomHistory.push(headroom);

          // Every JB_WINDOW frames, tune the buffer size
          if (headroomHistory.length >= JB_WINDOW) {
            const minHeadroom = Math.min(...headroomHistory);
            headroomHistory.length = 0; // reset window

            if (minHeadroom < JB_TARGET_FLOOR) {
              // Frames arriving too close to their play time (or late) → grow buffer
              const deficit = JB_TARGET_FLOOR - minHeadroom;
              const grow    = deficit * JB_GROW_FACTOR;
              bufferRef.current = Math.min(MAX_BUFFER, bufferRef.current + grow);
              // Shift anchor forward so future frames land further ahead
              anchorClientTime = (anchorClientTime ?? ctx.currentTime) + grow;
            } else if (minHeadroom > JB_TARGET_FLOOR * 4 && bufferRef.current > MIN_BUFFER) {
              // Plenty of headroom → cautiously shrink buffer toward minimum
              bufferRef.current = Math.max(MIN_BUFFER, bufferRef.current - JB_SHRINK_STEP);
              // Shift anchor back to reduce latency
              anchorClientTime = (anchorClientTime ?? ctx.currentTime) - JB_SHRINK_STEP;
            }
          }

          // Skip the frame if we've genuinely fallen behind (post-adjustment)
          if (scheduleAt < ctx.currentTime) return;

          try {
            const i16    = b64ToI16(msg.samples);
            const f32    = i16ToF32(i16);
            const buffer = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
            buffer.getChannelData(0).set(f32);

            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(analyser);
            src.connect(ctx.destination);
            src.start(scheduleAt);
          } catch {}
        }
      });

      conn.on('close', () => {
        if (peerRef.current) { setError('Host disconnected.'); stop(); }
      });

    } catch (e: any) {
      setError(e?.message ?? 'Failed to join. Please try again.');
      cleanup();
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPeer, startStatsTick, cleanup]);

  // ── Resume audio (mobile Tap-to-Listen button) ────────────────────────────

  const resumeAudio = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    ctx.resume()
      .then(() => setNeedsGesture(false))
      .catch(() => setError('Could not resume audio. Please reload the page.'));
  }, []);

  // ── Stop ──────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    cleanup();
    setMode('idle');
    setStats(null);
    setConnectedClients(0);
  }, [cleanup]);

  return {
    mode, isLoading, error, stats,
    connectedClients, analyserNode,
    roomCode, needsGesture,
    startHost, startClient, stop, resumeAudio,
  };
}
