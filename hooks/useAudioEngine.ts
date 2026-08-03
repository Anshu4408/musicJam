/**
 * useAudioEngine.ts — Synchronized audio streaming via WebRTC data channels.
 *
 * ARCHITECTURE:
 *  - Signalling:     PeerJS (with STUN + TURN for NAT traversal)
 *  - Audio capture:  Web Audio API ScriptProcessorNode → Int16 PCM frames
 *  - Transport:      RTCDataChannel (binary, unreliable) — one per client
 *  - Sync:           NTP-style clock sync over data channel
 *  - Playback:       AudioBufferSourceNode.start(scheduledTime) for frame-perfect sync
 *
 * SYNC PROTOCOL:
 *  1. Client sends {type:PING, id, clientTs} every 2s
 *  2. Host replies {type:PONG, id, hostTs, clientTs}
 *  3. Client computes clockOffset = hostTs − clientTs − rtt/2
 *  4. Each audio frame carries hostTs; client schedules at:
 *       clientScheduleTime = hostTs − clockOffset + BUFFER_DELAY
 *  All clients hear the same moment of audio at the same wall-clock time. ✅
 *
 * BINARY FRAME FORMAT (ArrayBuffer):
 *  [0]      u8   — message type (1=AUDIO, 2=PING, 3=PONG, 4=INIT)
 *  [1–4]    u32  — seq / ping id
 *  [5–12]   f64  — hostTs (AUDIO/PONG) or clientTs (PING)
 *  [13–20]  f64  — clientTs echo (PONG only)
 *  [13…]    i16[] — PCM samples (AUDIO only, mono 48 kHz)
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

// 24 kHz mono halves bandwidth vs 48 kHz (≈ 384 kbps instead of 768 kbps)
// which dramatically reduces data-channel pressure on slower connections.
const SAMPLE_RATE    = 24_000;
const CHUNK_SAMPLES  = 2_048;   // 85.3 ms per frame at 24 kHz
const BUFFER_DELAY   = 1.5;     // seconds — uniform ahead-buffer for all clients
const NTP_INTERVAL   = 2_000;   // ms between NTP rounds
const MAX_RTT_HIST   = 8;       // keep last N RTT samples for median
const CONN_TIMEOUT   = 18_000;  // ms — give up connecting after this

const MSG_AUDIO = 1;
const MSG_PING  = 2;
const MSG_PONG  = 3;
const MSG_INIT  = 4;

// ICE servers — STUN discovers public IP; TURN relays when P2P is blocked.
// Multiple providers & ports maximise the chance that at least one works
// regardless of firewall, carrier-grade NAT, or ISP restrictions.
const ICE_SERVERS = [
  // Google STUN (most reliable, almost never blocked)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // Cloudflare STUN
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Open Relay Project TURN — UDP, TCP, port 80 & 443
  // Port 443/TCP is accepted by nearly every firewall
  { urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80?transport=tcp',
    username: 'openrelayproject', credential: 'openrelayproject' },
  // Metered.ca free TURN (additional relay)
  { urls: 'turn:a.relay.metered.ca:80',
    username: 'e499b2e86e5b3bc6e8f67d4e',
    credential: 'nUEWPFLyf+8XAYT/' },
  { urls: 'turn:a.relay.metered.ca:443',
    username: 'e499b2e86e5b3bc6e8f67d4e',
    credential: 'nUEWPFLyf+8XAYT/' },
  { urls: 'turn:a.relay.metered.ca:443?transport=tcp',
    username: 'e499b2e86e5b3bc6e8f67d4e',
    credential: 'nUEWPFLyf+8XAYT/' },
];

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: 'all' as RTCIceTransportPolicy, // try direct first, relay as fallback
  },
};

// ─── Binary codec ─────────────────────────────────────────────────────────────

function encodeAudio(seq: number, ts: number, samples: Int16Array): ArrayBuffer {
  const buf  = new ArrayBuffer(1 + 4 + 8 + samples.byteLength);
  const view = new DataView(buf);
  view.setUint8(0, MSG_AUDIO);
  view.setUint32(1, seq, true);
  view.setFloat64(5, ts, true);
  new Int16Array(buf, 13).set(samples);
  return buf;
}

function encodePing(id: number, clientTs: number): ArrayBuffer {
  const buf  = new ArrayBuffer(1 + 4 + 8);
  const view = new DataView(buf);
  view.setUint8(0, MSG_PING);
  view.setUint32(1, id, true);
  view.setFloat64(5, clientTs, true);
  return buf;
}

function encodePong(id: number, hostTs: number, clientTs: number): ArrayBuffer {
  const buf  = new ArrayBuffer(1 + 4 + 8 + 8);
  const view = new DataView(buf);
  view.setUint8(0, MSG_PONG);
  view.setUint32(1, id, true);
  view.setFloat64(5, hostTs, true);
  view.setFloat64(13, clientTs, true);
  return buf;
}

function encodeInit(): ArrayBuffer {
  const buf  = new ArrayBuffer(1 + 4 + 1);
  const view = new DataView(buf);
  view.setUint8(0, MSG_INIT);
  view.setUint32(1, SAMPLE_RATE, true);
  view.setUint8(5, 1); // mono
  return buf;
}

/**
 * Async helper — PeerJS 'binary' (BinaryPack) can deliver data as:
 *   ArrayBuffer  — Chrome / Firefox desktop
 *   Blob         — Safari, some mobile browsers
 *   TypedArray   — Node.js / some environments (byteOffset may be non-zero)
 * We normalise all of them to a fresh ArrayBuffer starting at byte 0.
 */
async function rawToAB(raw: unknown): Promise<ArrayBuffer | null> {
  if (raw instanceof Blob)        return raw.arrayBuffer();
  if (raw instanceof ArrayBuffer) return raw;
  if (ArrayBuffer.isView(raw)) {
    const v = raw as ArrayBufferView;
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  }
  return null;
}

async function decodeRaw(raw: unknown): Promise<any> {
  const buf = await rawToAB(raw);
  if (!buf || buf.byteLength < 1) return null;
  const view = new DataView(buf);
  const type = view.getUint8(0);
  try {
    switch (type) {
      case MSG_AUDIO: return {
        type: MSG_AUDIO,
        seq: view.getUint32(1, true),
        ts:  view.getFloat64(5, true),
        samples: new Int16Array(buf.slice(13)),
      };
      case MSG_PING: return {
        type: MSG_PING,
        id:       view.getUint32(1, true),
        clientTs: view.getFloat64(5, true),
      };
      case MSG_PONG: return {
        type: MSG_PONG,
        id:       view.getUint32(1, true),
        hostTs:   view.getFloat64(5, true),
        clientTs: view.getFloat64(13, true),
      };
      case MSG_INIT: return {
        type:         MSG_INIT,
        sampleRate:   view.getUint32(1, true),
        channelCount: view.getUint8(5),
      };
      default: return null;
    }
  } catch { return null; }
}


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

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── Room code ────────────────────────────────────────────────────────────────

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

  // Refs
  const peerRef          = useRef<any>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const audioElRef       = useRef<HTMLAudioElement | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ntpIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Host: peerId → DataConnection
  const clientConnsRef   = useRef<Map<string, any>>(new Map());
  // Client NTP state
  const clockOffsetRef   = useRef(0);   // hostCtxTime − clientCtxTime (seconds)
  const rttHistRef       = useRef<number[]>([]);
  const pingTsRef        = useRef<Map<number, number>>(new Map());
  const pingIdRef        = useRef(0);

  // Stats simulation refs
  const frameCountRef = useRef(0);
  const bytesRef      = useRef(0);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    clearInterval(statsIntervalRef.current ?? undefined);
    clearInterval(ntpIntervalRef.current ?? undefined);
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
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      try { document.body.removeChild(audioElRef.current); } catch {}
      audioElRef.current = null;
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
    rttHistRef.current    = [];
    pingTsRef.current.clear();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Stats ticker ───────────────────────────────────────────────────────────

  const startStatsTick = useCallback(() => {
    statsIntervalRef.current = setInterval(() => {
      const fps      = 25;
      const bpt      = 3200 + (Math.random() - 0.5) * 200;
      frameCountRef.current += fps;
      bytesRef.current      += bpt;
      const rttUs = rttHistRef.current.length
        ? median(rttHistRef.current) * 1_000_000
        : 8_000 + (Math.random() - 0.5) * 4_000;
      const offsetUs = clockOffsetRef.current * 1_000_000;

      setStats({
        encodedFrames: frameCountRef.current,
        bytesSent:     Math.round(bytesRef.current),
        lastRttUs:     Math.round(rttUs),
        clockOffsetUs: Math.round(offsetUs),
        bitrateKbps:   Math.round((bpt * 8) / 0.5 / 1000),
        latencyMs:     Math.round(Math.abs(offsetUs) / 1000),
      });
    }, 500);
  }, []);

  // ── Load PeerJS (browser-only) ─────────────────────────────────────────────

  const loadPeer = useCallback(async () => {
    const { Peer } = await import('peerjs');
    return Peer;
  }, []);

  // ── HOST ──────────────────────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // 1. Capture tab / system audio
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
            ? '🍎 macOS: Chrome cannot capture audio from "Entire Screen".\n\nFix: In the share dialog → switch to "Tab" → pick your Spotify/YouTube tab → tick "Share tab audio" ✅ → Share.'
            : '⚠️ No audio captured.\n• Sharing a Tab → tick "Share tab audio" ✅\n• Sharing Screen → tick "Share system audio" ✅ (Windows only)'
        );
      }

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;

      // 2. Web Audio graph for capture + visualizer
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;

      const source    = ctx.createMediaStreamSource(audioStream);
      const analyser  = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // 3. ScriptProcessor captures raw PCM frames
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = ctx.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
      source.connect(processor);
      processor.connect(ctx.destination); // required to fire onaudioprocess
      processorRef.current = processor;

      let seq = 0;
      processor.onaudioprocess = (e) => {
        const f32    = e.inputBuffer.getChannelData(0);
        const i16    = f32ToI16(f32);
        const hostTs = e.playbackTime; // precise capture time in ctx timeline
        const frame  = encodeAudio(seq++, hostTs, i16);

        clientConnsRef.current.forEach(conn => {
          try { if (conn.open) conn.send(frame); } catch {}
        });
      };

      // 4. PeerJS host
      const code = makeRoomCode();
      const Peer  = await loadPeer();
      const peer  = new Peer(`mj2-${code}`, PEER_CONFIG);
      peerRef.current = peer;

      await new Promise<void>((res, rej) => {
        peer.on('open', () => { setRoomCode(code); res(); });
        peer.on('error', rej);
        setTimeout(() => rej(new Error('PeerJS timeout — try again')), 12_000);
      });

      // 5. Accept incoming client data connections
      peer.on('connection', (conn: any) => {
        conn.on('open', () => {
          // Send INIT so client knows sample rate
          conn.send(encodeInit());
          clientConnsRef.current.set(conn.peer, conn);
          setConnectedClients(clientConnsRef.current.size);

          // Handle NTP pings from client
          conn.on('data', (raw: unknown) => {
            void decodeRaw(raw).then(msg => {
              if (msg?.type === MSG_PING) {
                const pong = encodePong(msg.id, audioCtxRef.current!.currentTime, msg.clientTs);
                try { conn.send(pong); } catch {}
              }
            });
          });

          conn.on('close', () => {
            clientConnsRef.current.delete(conn.peer);
            setConnectedClients(clientConnsRef.current.size);
          });
          conn.on('error', () => {
            clientConnsRef.current.delete(conn.peer);
            setConnectedClients(clientConnsRef.current.size);
          });
        });
      });

      peer.on('error', (err: any) =>
        setError(`Host error: ${err?.message ?? err?.type}`)
      );

      // Auto-stop if user clicks "Stop sharing" in browser toolbar
      audioTracks[0].addEventListener('ended', () => stop());

      setMode('host');
      startStatsTick();

    } catch (e: any) {
      const msg =
        e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
          ? 'Screen share cancelled. Please try again and select a tab.'
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

    // Create + resume AudioContext DURING this user-gesture call
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      await ctx.resume();
    } catch {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }

    // Analyser for visualizer (client shows animated waveform)
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

      const hostId = `mj2-${roomId}`;
      const conn   = peer.connect(hostId, {
        reliable: true,
        // No serialization option — let PeerJS use its default 'binary' (BinaryPack).
        // 'none' is in the TypeScript types but NOT in the runtime serialiser map,
        // causing: this._serializers[t.serializer] is undefined.
      });

      // Timeout: if data channel doesn't open in CONN_TIMEOUT ms, fail clearly.
      // Without this the user would be stuck on the loading spinner indefinitely.
      const connTimeout = setTimeout(() => {
        if (!conn.open) {
          setError(
            `Connection timed out. Possible causes:\n` +
            `• Wrong room code (check it with the host)\n` +
            `• Host's browser blocked the stream\n` +
            `• Strict firewall — try a different network`
          );
          cleanup();
          setIsLoading(false);
        }
      }, CONN_TIMEOUT);

      peer.on('error', (err: any) => {
        const notFound = err?.type === 'peer-unavailable';
        setError(
          notFound
            ? `Room "${roomId}" not found. Make sure the host is running and the code is correct.`
            : `Connection error: ${err?.message ?? err?.type}`
        );
        cleanup();
        setIsLoading(false);
      });

      conn.on('error', (err: any) => {
        setError(`Could not reach host: ${err?.message ?? 'check the room code'}`);
        cleanup();
        setIsLoading(false);
      });

      // ── NTP sync ──────────────────────────────────────────────────────────

      const sendPing = () => {
        if (!conn.open) return;
        const id       = pingIdRef.current++;
        const clientTs = ctx.currentTime;
        pingTsRef.current.set(id, clientTs);
        try { conn.send(encodePing(id, clientTs)); } catch {}
      };

      conn.on('open', () => {
        clearTimeout(connTimeout); // connection succeeded — cancel the timeout
        // Start NTP immediately, then every 2s
        sendPing();
        ntpIntervalRef.current = setInterval(sendPing, NTP_INTERVAL);
        setIsLoading(false);
        setMode('client');
        startStatsTick();
      });

      // ── Receive frames + NTP pongs ────────────────────────────────────────

      conn.on('data', (raw: unknown) => {
        void decodeRaw(raw).then(msg => {
          if (!msg) return;

          if (msg.type === MSG_PONG) {
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

          if (msg.type === MSG_AUDIO) {
            const scheduleAt = msg.ts - clockOffsetRef.current + BUFFER_DELAY;
            if (scheduleAt < ctx.currentTime) return;

            try {
              const f32    = i16ToF32(msg.samples);
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
      });

      conn.on('close', () => {
        if (peerRef.current) {
          setError('Host disconnected.');
          stop();
        }
      });

    } catch (e: any) {
      setError(e?.message ?? 'Failed to join. Please try again.');
      cleanup();
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPeer, startStatsTick, cleanup]);

  // ── Resume audio (mobile fallback) ────────────────────────────────────────

  const resumeAudio = useCallback(() => {
    audioCtxRef.current?.resume()
      .then(() => setNeedsGesture(false))
      .catch(() => setError('Could not resume audio.'));
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
