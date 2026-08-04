/**
 * useAudioEngine.ts
 *
 * ARCHITECTURE (v4 — minimum latency):
 *
 *  Audio transport: WebRTC MediaStream via peer.call()
 *    ↳ Uses SRTP (same as Zoom/Meet), hardware Opus codec, ~20 ms frames
 *    ↳ Browser's native jitter buffer: 20–40 ms
 *    ↳ Total one-way latency: ~50–100 ms on WiFi  ← vs ~150–600 ms SCTP
 *
 *  Sync measurement: JSON data channel (NTP ping/pong)
 *    ↳ Reports RTT, estimated one-way delay in the stats panel
 *
 *  Host flow:
 *    getDisplayMedia → audioStream → AudioContext (for analyser)
 *    On each client data connection → peer.call(clientId, audioStream)
 *
 *  Client flow:
 *    peer.connect(hostId)         ← data channel for NTP
 *    peer.on('call', call)        ← audio MediaStream
 *    call.answer()                ← listen-only, no mic
 *    call.on('stream') → <audio> ← native WebRTC pipeline to speakers
 *    createMediaStreamSource      ← route through AudioContext for analyser
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
  bufferMs:      number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NTP_INTERVAL  = 2_000;
const MAX_RTT_HIST  = 8;
const CONN_TIMEOUT  = 18_000;

// ICE servers — Google STUN + Open Relay & Metered TURN for NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302'  },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80',              username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',             username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:a.relay.metered.ca:80',                username: 'e499b2e86e5b3bc6e8f67d4e', credential: 'nUEWPFLyf+8XAYT/' },
  { urls: 'turn:a.relay.metered.ca:443',               username: 'e499b2e86e5b3bc6e8f67d4e', credential: 'nUEWPFLyf+8XAYT/' },
  { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'e499b2e86e5b3bc6e8f67d4e', credential: 'nUEWPFLyf+8XAYT/' },
];

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: 'all' as RTCIceTransportPolicy,
  },
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

  const peerRef          = useRef<any>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const audioElRef       = useRef<HTMLAudioElement | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ntpIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Host: peerId → { dataConn, call }
  const clientConnsRef = useRef<Map<string, any>>(new Map());

  // NTP state
  const clockOffsetRef = useRef(0);   // ms (wall clock)
  const rttMsHistRef   = useRef<number[]>([]);
  const pingTsRef      = useRef<Map<number, number>>(new Map()); // id → Date.now() at send
  const pingIdRef      = useRef(0);

  const frameCountRef = useRef(0);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    clearInterval(statsIntervalRef.current ?? undefined);
    clearInterval(ntpIntervalRef.current   ?? undefined);
    statsIntervalRef.current = null;
    ntpIntervalRef.current   = null;

    clientConnsRef.current.forEach(({ dataConn, call }) => {
      try { dataConn?.close(); } catch {}
      try { call?.close();     } catch {}
    });
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
    clockOffsetRef.current = 0;
    rttMsHistRef.current   = [];
    pingTsRef.current.clear();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Stats ticker ───────────────────────────────────────────────────────────

  const startStatsTick = useCallback(() => {
    statsIntervalRef.current = setInterval(() => {
      frameCountRef.current += 25; // Opus ~50 fps, we display 25

      const rttMs    = rttMsHistRef.current.length ? median(rttMsHistRef.current) : 0;
      const offsetMs = clockOffsetRef.current;
      // Estimated one-way latency = RTT/2 + Opus frame 20ms + output latency ~15ms
      const latMs    = Math.round(rttMs / 2 + 35);

      setStats({
        encodedFrames: frameCountRef.current,
        bytesSent:     0,           // WebRTC handles this internally
        lastRttUs:     Math.round(rttMs * 1000),
        clockOffsetUs: Math.round(offsetMs * 1000),
        bitrateKbps:   40,          // Opus ~40 kbps for music
        latencyMs:     latMs,
        bufferMs:      Math.round(rttMs / 2), // WebRTC native JB ≈ RTT/2
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
      // 1. Capture display/tab audio
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
            ? '🍎 macOS: In share dialog → pick "Tab" → choose Spotify/YouTube tab → tick "Share tab audio" ✅'
            : '⚠️ No audio captured.\n• Sharing Tab → tick "Share tab audio"\n• Sharing Screen → tick "Share system audio" (Windows)'
        );
      }

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;

      // 2. AudioContext for analyser only (not playback — stream is sent via WebRTC)
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source   = ctx.createMediaStreamSource(audioStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      // Do NOT connect to ctx.destination (would create feedback/double-play on host)
      setAnalyserNode(analyser);

      // 3. PeerJS peer
      const code = makeRoomCode();
      const Peer  = await loadPeer();
      const peer  = new Peer(`mj2-${code}`, PEER_CONFIG);
      peerRef.current = peer;

      await new Promise<void>((res, rej) => {
        peer.on('open', () => { setRoomCode(code); res(); });
        peer.on('error', rej);
        setTimeout(() => rej(new Error('PeerJS timeout — try again')), 12_000);
      });

      // 4. Accept incoming data connections (NTP) then call client with audio
      peer.on('connection', (dataConn: any) => {
        dataConn.on('open', () => {
          // Call the client with the audio stream
          const call = peer.call(dataConn.peer, audioStream);

          clientConnsRef.current.set(dataConn.peer, { dataConn, call });
          setConnectedClients(clientConnsRef.current.size);

          // Handle NTP pings
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
            const entry = clientConnsRef.current.get(dataConn.peer);
            try { entry?.call?.close(); } catch {}
            clientConnsRef.current.delete(dataConn.peer);
            setConnectedClients(clientConnsRef.current.size);
          };
          dataConn.on('close', remove);
          dataConn.on('error', remove);
        });
      });

      peer.on('error', (err: any) => setError(`Host error: ${err?.message ?? err?.type}`));
      // Stop if user clicks "Stop sharing" in browser
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

    // ── Create and unlock audio element NOW inside user gesture ──
    // We prime it here so autoplay is allowed when srcObject is set later.
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;  // critical for iOS
    document.body.appendChild(audio);
    audioElRef.current = audio;

    // Kick a silent play so mobile browsers "unlock" this element
    audio.play().catch(() => {});

    // AudioContext for analyser only
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

      // ── IMPORTANT: register call handler BEFORE connecting data channel ──
      // The host calls us immediately when the data connection opens.
      // If we register too late, we miss the call.
      peer.on('call', (call: any) => {
        call.answer(); // listen-only — no mic stream sent back

        call.on('stream', (remoteStream: MediaStream) => {
          // Route through audio element (handles mobile autoplay natively)
          audio.srcObject = remoteStream;
          const playPromise = audio.play();
          if (playPromise) {
            playPromise.catch(() => {
              // Autoplay blocked — show tap-to-listen overlay
              setNeedsGesture(true);
            });
          }

          // Also pipe through AudioContext for visualizer analyser
          // (don't connect to ctx.destination — audio element handles speakers)
          const source = ctx.createMediaStreamSource(remoteStream);
          source.connect(analyser);
        });

        call.on('error', (err: any) => {
          setError(`Stream error: ${err?.message ?? 'call failed'}`);
        });
      });

      // Wait for peer to open
      await new Promise<void>((res, rej) => {
        peer.on('open', res);
        peer.on('error', rej);
        setTimeout(() => rej(new Error('PeerJS timeout')), 12_000);
      });

      // Connect data channel (triggers host to call us with audio)
      const conn = peer.connect(`mj2-${roomId}`, {
        reliable:      true,
        serialization: 'json',
      });

      // Timeout if data channel never opens
      const connTimeout = setTimeout(() => {
        if (!conn.open) {
          setError(
            'Connection timed out.\n' +
            '• Check the room code\n' +
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

      // NTP ping helpers
      const sendPing = () => {
        if (!conn.open) return;
        const id = pingIdRef.current++;
        const now = performance.now();
        pingTsRef.current.set(id, now);
        try { conn.send({ type: 'ping', id, clientTs: now }); } catch {}
      };

      conn.on('open', () => {
        clearTimeout(connTimeout);
        setIsLoading(false);
        setMode('client');
        sendPing();
        ntpIntervalRef.current = setInterval(sendPing, NTP_INTERVAL);
        startStatsTick();
      });

      conn.on('data', (msg: any) => {
        if (msg?.type === 'pong') {
          const sendTime = pingTsRef.current.get(msg.id);
          if (sendTime === undefined) return;
          pingTsRef.current.delete(msg.id);

          const rttMs = performance.now() - sendTime;
          rttMsHistRef.current.push(rttMs);
          if (rttMsHistRef.current.length > MAX_RTT_HIST) rttMsHistRef.current.shift();

          const minRtt = Math.min(...rttMsHistRef.current);
          clockOffsetRef.current = msg.hostTs - sendTime - minRtt / 2;
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

  // ── Resume audio (mobile Tap-to-Listen) ───────────────────────────────────

  const resumeAudio = useCallback(() => {
    const audio = audioElRef.current;
    if (audio) {
      audio.play()
        .then(() => setNeedsGesture(false))
        .catch(() => setError('Could not resume audio. Please reload.'));
    }
    audioCtxRef.current?.resume().catch(() => {});
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
