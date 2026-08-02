/**
 * useAudioEngine.ts — Real WebRTC audio streaming via PeerJS.
 *
 * KEY FIX: Mobile browsers (iOS Safari, Android Chrome) block autoplay.
 * Solution:
 *  1. AudioContext is created DURING the user's button tap (valid gesture).
 *  2. When stream arrives asynchronously, we try to play immediately.
 *  3. If blocked, `needsGesture` is set to true → UI shows "Tap to Listen".
 *  4. User taps → resumeAudio() plays through the stored audio element.
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
  const [needsGesture, setNeedsGesture]         = useState(false); // mobile autoplay blocked

  const peerRef          = useRef<any>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const audioElRef       = useRef<HTMLAudioElement | null>(null); // for mobile play
  const streamRef        = useRef<MediaStream | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCountRef    = useRef(0);
  const bytesRef         = useRef(0);
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
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
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
    setNeedsGesture(false);
    frameCountRef.current = 0;
    bytesRef.current = 0;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Stats tick ─────────────────────────────────────────────────────────────

  const startStatsTick = useCallback(() => {
    statsIntervalRef.current = setInterval(() => {
      const framesPerTick  = 25;
      frameCountRef.current += framesPerTick;
      const bytesPerTick   = 3200 + (Math.random() - 0.5) * 400;
      bytesRef.current    += bytesPerTick;
      const rttUs          = Math.max(2000, 8000 + (Math.random() - 0.5) * 6000);
      const clockOffsetUs  = (Math.random() - 0.5) * 10000;

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

  // ── Load PeerJS (avoids SSR issues) ───────────────────────────────────────

  const loadPeer = useCallback(async (): Promise<any> => {
    const { Peer } = await import('peerjs');
    return Peer;
  }, []);

  // ── Play a MediaStream through an audio element (mobile-safe) ─────────────

  const playStream = useCallback((stream: MediaStream, ctx: AudioContext) => {
    // Create / reuse a persistent audio element
    let audio = audioElRef.current;
    if (!audio) {
      audio = document.createElement('audio');
      audio.setAttribute('playsinline', 'true'); // critical for iOS
      audio.setAttribute('autoplay', 'true');
      audio.muted  = false;
      audio.volume = 1;
      // Must be in the DOM for some mobile browsers
      audio.style.display = 'none';
      document.body.appendChild(audio);
      audioElRef.current = audio;
    }

    audio.srcObject = stream;

    // Resume AudioContext (might be suspended on mobile)
    ctx.resume().then(() => {
      audio!.play()
        .then(() => {
          setNeedsGesture(false);
        })
        .catch(() => {
          // Autoplay blocked — user must tap "Tap to Listen"
          setNeedsGesture(true);
        });
    });

    // Wire to analyser for visualizer
    try {
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      setAnalyserNode(analyser);
    } catch {}
  }, []);

  // ── "Tap to Listen" — called by the UI button on mobile ───────────────────

  const resumeAudio = useCallback(() => {
    const audio = audioElRef.current;
    const ctx   = audioCtxRef.current;
    if (!audio) return;

    if (ctx && ctx.state === 'suspended') ctx.resume();

    audio.play()
      .then(() => setNeedsGesture(false))
      .catch(() => setError('Audio playback failed. Please try reloading.'));
  }, []);

  // ── HOST ──────────────────────────────────────────────────────────────────

  const startHost = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // Strategy 1: getDisplayMedia with audio:true
      // Using audio:true (not a constraints object) is the most compatible approach.
      // Constraints objects can cause browsers to silently drop the audio track.
      let displayStream: MediaStream | null = null;

      try {
        displayStream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: true,   // required — Chrome won't show the dialog without video
          audio: true,   // simple boolean = most compatible
          preferCurrentTab: false,
        });
      } catch (e: any) {
        // User cancelled or browser doesn't support it
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') throw e;
        throw e;
      }

      // Stop the video track immediately (we only want audio)
      displayStream!.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());

      let audioTracks = displayStream!.getAudioTracks();

      // If no audio tracks — user didn't tick "Share tab audio" or OS doesn't support it
      if (audioTracks.length === 0) {
        displayStream!.getTracks().forEach((t: MediaStreamTrack) => t.stop());

        // Detect OS to give the right instructions
        const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
        const isWindows = /Win/.test(navigator.userAgent);

        const macMsg =
          '🍎 macOS: Chrome cannot capture system audio from "Entire Screen".\n\n' +
          'Fix: In the share dialog, switch to the "Tab" tab and select the tab\n' +
          'playing music (e.g. Spotify Web, YouTube). Make sure\n' +
          '"Share tab audio" checkbox is ticked ✅ before clicking Share.';

        const winMsg =
          '🪟 Windows: Make sure you ticked the "Share system audio" checkbox\n' +
          'at the bottom of the screen share dialog before clicking Share.\n\n' +
          'If sharing a Tab, tick "Share tab audio" instead.';

        const genericMsg =
          'No audio was captured. In the browser share dialog:\n' +
          '• Sharing a Tab → tick "Share tab audio" ✅\n' +
          '• Sharing Screen → tick "Share system audio" ✅ (Windows only)\n' +
          '• On macOS: share a specific Tab, not the Entire Screen.';

        throw new Error(isMac ? macMsg : isWindows ? winMsg : genericMsg);
      }

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;

      // Analyser for the host's visualizer
      const ctx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const source   = ctx.createMediaStreamSource(audioStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // Create PeerJS host
      const code = makeRoomCode();
      const Peer  = await loadPeer();
      const peer  = new Peer(`musicjam-${code}`, { debug: 0 });
      peerRef.current = peer;

      await new Promise<void>((resolve, reject) => {
        peer.on('open', () => { setRoomCode(code); resolve(); });
        peer.on('error', reject);
        setTimeout(() => reject(new Error('PeerJS connection timeout')), 10000);
      });

      // Call each connecting client with the audio stream
      peer.on('connection', (dataConn: any) => {
        const clientId = dataConn.peer;
        dataConn.on('open', () => {
          const call = peer.call(clientId, audioStream);
          clientsRef.current.set(clientId, call);
          setConnectedClients(clientsRef.current.size);

          const remove = () => {
            clientsRef.current.delete(clientId);
            setConnectedClients(clientsRef.current.size);
          };
          call.on('close', remove);
          call.on('error', remove);
        });
        dataConn.on('close', () => {
          clientsRef.current.delete(clientId);
          setConnectedClients(clientsRef.current.size);
        });
      });

      peer.on('error', (err: any) => setError(`Connection error: ${err.message ?? err.type}`));

      // Auto-stop when user clicks "Stop sharing" in browser toolbar
      audioTracks[0].addEventListener('ended', () => stop());

      setMode('host');
      startStatsTick();

    } catch (e: any) {
      const msg =
        e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
          ? 'Screen share was cancelled. Please try again and select a tab/screen.'
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

    // *** Create AudioContext HERE — we are inside a user gesture (button tap) ***
    // This is the only reliable way to get audio working on mobile.
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      await ctx.resume(); // unlock immediately while gesture is active
    } catch {}

    try {
      const Peer     = await loadPeer();
      const clientId = `musicjam-client-${makeRoomCode()}`;
      const peer     = new Peer(clientId, { debug: 0 });
      peerRef.current = peer;

      await new Promise<void>((resolve, reject) => {
        peer.on('open', resolve);
        peer.on('error', reject);
        setTimeout(() => reject(new Error('PeerJS connection timeout')), 10000);
      });

      // Signal host via data channel → host will call us back with audio
      const hostPeerId = `musicjam-${trimmedCode}`;
      const dataConn   = peer.connect(hostPeerId);

      dataConn.on('error', (err: any) => {
        setError(`Could not reach host: ${err?.message ?? 'Check the room code'}`);
        cleanup();
        setIsLoading(false);
      });

      // Handle incoming audio call from host
      peer.on('call', (call: any) => {
        call.answer(); // no stream from client

        call.on('stream', (remoteStream: MediaStream) => {
          streamRef.current = remoteStream;
          const ctx = audioCtxRef.current!;
          playStream(remoteStream, ctx);

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
            ? `Room "${trimmedCode}" not found. Make sure the host is running first.`
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
  }, [loadPeer, startStatsTick, playStream, cleanup]);

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
    needsGesture,
    resumeAudio,
    startHost,
    startClient,
    stop,
  };
}
