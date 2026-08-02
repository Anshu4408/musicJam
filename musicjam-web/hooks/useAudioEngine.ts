/**
 * useAudioEngine.ts — Web port of the React Native useAudioEngine hook.
 *
 * Uses the Web Audio API for real microphone/tab capture in Host mode.
 * Simulates realistic network stats (bitrate, RTT, frames) since browsers
 * cannot do raw UDP multicast.
 *
 * Exposed API mirrors the original hook exactly so UI components are unchanged.
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioEngine() {
  const [mode, setMode]                     = useState<AppMode>('idle');
  const [isLoading, setIsLoading]           = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [stats, setStats]                   = useState<EngineStats | null>(null);
  const [connectedClients, setConnectedClients] = useState(0);
  const [analyserNode, setAnalyserNode]     = useState<AnalyserNode | null>(null);

  // Internal refs for simulation
  const statsIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const clientIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const frameCountRef     = useRef(0);
  const bytesRef          = useRef(0);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  const cleanupAudio = useCallback(() => {
    statsIntervalRef.current  && clearInterval(statsIntervalRef.current);
    clientIntervalRef.current && clearInterval(clientIntervalRef.current);
    statsIntervalRef.current  = null;
    clientIntervalRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    setAnalyserNode(null);
    frameCountRef.current = 0;
    bytesRef.current      = 0;
  }, []);

  useEffect(() => () => cleanupAudio(), [cleanupAudio]);

  // ── Simulate live stats ───────────────────────────────────────────────────

  const startStatsSimulation = useCallback((currentMode: AppMode) => {
    // Tick every 500ms — mirrors 20ms Opus frames but batched for UI
    statsIntervalRef.current = setInterval(() => {
      // Simulate 25 Opus frames per tick (500ms / 20ms)
      const framesPerTick = 25;
      frameCountRef.current += framesPerTick;

      // Opus 128 kbps ≈ 3200 bytes/tick ± noise
      const bytesPerTick = 3200 + (Math.random() - 0.5) * 400;
      bytesRef.current += bytesPerTick;

      // RTT: 2–30ms with gentle drift
      const rttUs = Math.max(2000, Math.min(30000, (8000 + (Math.random() - 0.5) * 6000)));

      // Clock offset: ±5ms drift
      const clockOffsetUs = (Math.random() - 0.5) * 10000;

      // Bitrate derived from bytes delta
      const bitrateKbps = Math.round((bytesPerTick * 8) / 0.5 / 1000);

      setStats({
        encodedFrames: frameCountRef.current,
        bytesSent:     Math.round(bytesRef.current),
        lastRttUs:     Math.round(rttUs),
        clockOffsetUs: Math.round(clockOffsetUs),
        bitrateKbps,
        latencyMs:     Math.round(Math.abs(clockOffsetUs) / 1000),
      });
    }, 500);

    // Simulate clients connecting (host only)
    if (currentMode === 'host') {
      let clients = 0;
      clientIntervalRef.current = setInterval(() => {
        if (clients < 4 && Math.random() > 0.6) {
          clients = Math.min(4, clients + 1);
          setConnectedClients(clients);
        }
      }, 3000);
    }
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // Request microphone (fallback if tab capture unavailable)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const ctx      = new AudioContext();
      audioCtxRef.current = ctx;

      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      // Don't connect to destination — we don't want mic feedback

      setAnalyserNode(analyser);
      setMode('host');
      startStatsSimulation('host');
    } catch (e: any) {
      const msg = e?.name === 'NotAllowedError'
        ? 'Microphone permission denied. Please allow microphone access.'
        : (e?.message ?? 'Failed to start host mode');
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [startStatsSimulation]);

  const startClient = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // Client mode: create an AudioContext for simulated playback visualization
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;

      // Generate synthetic audio signal for visualization
      const oscillator = ctx.createOscillator();
      const gainNode   = ctx.createGain();
      gainNode.gain.value = 0; // Muted — no actual sound
      oscillator.connect(gainNode);
      gainNode.connect(analyser);
      oscillator.start();

      setAnalyserNode(analyser);
      setMode('client');
      startStatsSimulation('client');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to start client mode');
    } finally {
      setIsLoading(false);
    }
  }, [startStatsSimulation]);

  const stop = useCallback(async () => {
    setIsLoading(true);
    try {
      cleanupAudio();
      setMode('idle');
      setStats(null);
      setConnectedClients(0);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to stop');
    } finally {
      setIsLoading(false);
    }
  }, [cleanupAudio]);

  return {
    mode,
    isLoading,
    error,
    stats,
    connectedClients,
    analyserNode,
    startHost,
    startClient,
    stop,
  };
}
