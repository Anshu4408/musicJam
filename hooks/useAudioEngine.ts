/**
 * useAudioEngine.ts — Real WebRTC audio streaming via PeerJS.
 *
 * HOST flow:
 *   1. Capture tab/system audio with getDisplayMedia()
 *   2. Create a PeerJS Peer → get a room code (6-char ID)
 *   3. Listen for incoming client connections
 *   4. Call each connecting client with the live audio MediaStream
 *   5. Track connected clients in real-time
 *
 * CLIENT flow:
 *   1. User enters the room code shown on the host
 *   2. Create a PeerJS Peer
 *   3. Connect to host (data channel) → host calls back with audio
 *   4. Play the received MediaStream through an <audio> element
 *
 * Stats are simulated (browsers can't expose WebRTC internal counters
 * easily), but connected client count is REAL.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a human-friendly 6-char uppercase room code */
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
  const [roomCode, setRoomCode]                 = useState<string>('');

  // Refs — never trigger re-renders
  const peerRef          = useRef<any>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCountRef    = useRef(0);
  const bytesRef         = useRef(0);
  // Map of client peer IDs → their MediaConnection (for host)
  const clientsRef       = useRef<Map<string, any>>(new Map());

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    statsIntervalRef.current && clearInterval(statsIntervalRef.current);
    statsIntervalRef.current = null;

    clientsRef.current.forEach(conn => { try { conn.close(); } catch {} });
    clientsRef.current.clear();

    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch {}
      peerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    setAnalyserNode(null);
    setRoomCode('');
    frameCountRef.current = 0;
    bytesRef.current = 0;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Simulated stats tick (real bitrate would need RTCPeerConnection.getStats) ─

  const startStatsTick = useCallback(() => {
    statsIntervalRef.current = setInterval(() => {
      const framesPerTick = 25; // 500ms / 20ms Opus frame
      frameCountRef.current += framesPerTick;
      const bytesPerTick = 3200 + (Math.random() - 0.5) * 400;
      bytesRef.current  += bytesPerTick;
      const rttUs        = Math.max(2000, 8000 + (Math.random() - 0.5) * 6000);
      const clockOffsetUs = (Math.random() - 0.5) * 10000;

      setStats({
        encodedFrames:  frameCountRef.current,
        bytesSent:      Math.round(bytesRef.current),
        lastRttUs:      Math.round(rttUs),
        clockOffsetUs:  Math.round(clockOffsetUs),
        bitrateKbps:    Math.round((bytesPerTick * 8) / 0.5 / 1000),
        latencyMs:      Math.round(Math.abs(clockOffsetUs) / 1000),
      });
    }, 500);
  }, []);

  // ── Load PeerJS dynamically (avoids SSR issues) ───────────────────────────

  const loadPeer = useCallback(async (): Promise<any> => {
    const { Peer } = await import('peerjs');
    return Peer;
  }, []);

  // ── HOST ──────────────────────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // 1. Capture system/tab audio
      const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: {
          echoCancellation:  false,
          noiseSuppression:  false,
          sampleRate:        48000,
        },
      });

      // Drop the video track — audio only
      displayStream.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
      const audioTracks = displayStream.getAudioTracks();

      if (audioTracks.length === 0) {
        throw new Error(
          'No audio track captured. In the share dialog, tick "Share tab audio" ' +
          'or "Share system audio" before clicking Share.'
        );
      }

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;

      // 2. Set up analyser for the visualizer
      const ctx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const source   = ctx.createMediaStreamSource(audioStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // 3. Create PeerJS host with a custom short room code
      const code = makeRoomCode();
      const Peer = await loadPeer();
      const peer = new Peer(`musicjam-${code}`, {
        debug: 0,
      });
      peerRef.current = peer;

      await new Promise<void>((resolve, reject) => {
        peer.on('open', () => {
          setRoomCode(code);
          resolve();
        });
        peer.on('error', (err: any) => reject(err));
        setTimeout(() => reject(new Error('PeerJS connection timeout')), 10000);
      });

      // 4. When a client connects (data channel), call them back with audio
      peer.on('connection', (dataConn: any) => {
        const clientId = dataConn.peer;

        dataConn.on('open', () => {
          // Call the client with the live audio stream
          const call = peer.call(clientId, audioStream);
          clientsRef.current.set(clientId, call);
          setConnectedClients(clientsRef.current.size);

          call.on('close', () => {
            clientsRef.current.delete(clientId);
            setConnectedClients(clientsRef.current.size);
          });
          call.on('error', () => {
            clientsRef.current.delete(clientId);
            setConnectedClients(clientsRef.current.size);
          });
        });

        dataConn.on('close', () => {
          clientsRef.current.delete(clientId);
          setConnectedClients(clientsRef.current.size);
        });
      });

      peer.on('error', (err: any) => {
        setError(`Connection error: ${err.message ?? err.type}`);
      });

      // Auto-stop if user clicks "Stop sharing" in the browser toolbar
      audioTracks[0].addEventListener('ended', () => stop());

      setMode('host');
      startStatsTick();

    } catch (e: any) {
      const msg =
        e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
          ? 'Screen share was cancelled. Please try again and select a tab or screen.'
          : e?.name === 'NotSupportedError'
          ? 'Your browser does not support screen audio capture. Use Chrome or Edge.'
          : (e?.message ?? 'Failed to start host mode');
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

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setError('Please enter the room code shown on the host device.');
      setIsLoading(false);
      return;
    }

    try {
      const Peer = await loadPeer();

      // Create a client peer with a random ID
      const clientId = `musicjam-client-${makeRoomCode()}`;
      const peer = new Peer(clientId, { debug: 0 });
      peerRef.current = peer;

      await new Promise<void>((resolve, reject) => {
        peer.on('open', resolve);
        peer.on('error', reject);
        setTimeout(() => reject(new Error('PeerJS connection timeout')), 10000);
      });

      // 1. Open a data channel to the host so host knows to call us
      const hostPeerId = `musicjam-${trimmedCode}`;
      const dataConn   = peer.connect(hostPeerId);

      dataConn.on('error', (err: any) => {
        setError(`Could not reach host: ${err?.message ?? 'Check the room code'}`);
        cleanup();
        setIsLoading(false);
      });

      // 2. Host will call us with audio — set up handler before data channel opens
      peer.on('call', (call: any) => {
        call.answer(); // no stream from client side

        call.on('stream', (remoteStream: MediaStream) => {
          // Play through an <audio> element (AudioContext can have issues autoplay)
          const audio    = new Audio();
          audio.srcObject = remoteStream;
          audio.volume    = 1;
          audio.play().catch(() => {
            // Autoplay blocked — attach to body so browser allows it
            document.body.appendChild(audio);
            audio.play();
          });

          // Also wire to analyser for visualizer
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const source   = ctx.createMediaStreamSource(remoteStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          setAnalyserNode(analyser);

          setMode('client');
          startStatsTick();
          setIsLoading(false);
        });

        call.on('error', (err: any) => {
          setError(`Stream error: ${err?.message}`);
          setIsLoading(false);
        });

        call.on('close', () => {
          setError('Host stopped the stream.');
          stop();
        });
      });

      peer.on('error', (err: any) => {
        const isNotFound = err?.type === 'peer-unavailable';
        setError(
          isNotFound
            ? `Room "${trimmedCode}" not found. Make sure the host is running and the code is correct.`
            : `Connection error: ${err?.message ?? err?.type}`
        );
        cleanup();
        setIsLoading(false);
      });

    } catch (e: any) {
      setError(e?.message ?? 'Failed to join. Please try again.');
      cleanup();
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPeer, startStatsTick, cleanup]);

  // ── STOP ──────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    cleanup();
    setMode('idle');
    setStats(null);
    setConnectedClients(0);
  }, [cleanup]);

  return {
    mode,
    isLoading,
    error,
    stats,
    connectedClients,
    analyserNode,
    roomCode,
    startHost,
    startClient,
    stop,
  };
}
