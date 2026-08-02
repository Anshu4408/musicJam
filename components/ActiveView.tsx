'use client';

import React, { useState } from 'react';
import PulseRing from './PulseRing';
import StatsPanel from './StatsPanel';
import AudioVisualizer from './AudioVisualizer';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';
import { COLORS } from '@/lib/colors';

interface ActiveViewProps {
  mode:             AppMode;
  stats:            EngineStats | null;
  connectedClients: number;
  analyserNode:     AnalyserNode | null;
  isLoading:        boolean;
  roomCode:         string;
  needsGesture:     boolean;
  onStop:           () => void;
  onResumeAudio:    () => void;
}

export default function ActiveView({
  mode,
  stats,
  connectedClients,
  analyserNode,
  isLoading,
  roomCode,
  needsGesture,
  onStop,
  onResumeAudio,
}: ActiveViewProps) {
  const isHost      = mode === 'host';
  const accentColor = isHost ? COLORS.neonPurple : COLORS.neonBlue;
  const icon        = isHost ? '📡' : '🎧';
  const title       = isHost ? 'Broadcasting Audio' : 'Receiving Stream';
  const subtitle    = isHost
    ? 'Tab / system audio is being streamed to all clients'
    : 'Synchronized to host clock · Jitter buffer active';

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="active-view">

      {/* ── "Tap to Listen" overlay for mobile autoplay block ── */}
      {needsGesture && (
        <div className="tap-to-listen">
          <button
            id="tap-to-listen-btn"
            className="tap-to-listen__btn"
            onClick={onResumeAudio}
          >
            <span className="tap-to-listen__icon">🔊</span>
            <span className="tap-to-listen__label">Tap to Listen</span>
            <span className="tap-to-listen__sub">
              Your browser requires a tap to start audio
            </span>
          </button>
        </div>
      )}

      {/* Pulsing icon */}
      <div className="active-icon-container">
        <PulseRing color={accentColor} active={true} />
        <span className="active-icon">{icon}</span>
      </div>

      <h2 className="active-title">{title}</h2>
      <p className="active-subtitle">{subtitle}</p>

      {/* Client status indicator */}
      {!isHost && !needsGesture && (
        <div className="listening-badge">
          <span className="status-dot status-dot--live" />
          <span>Listening</span>
        </div>
      )}

      {/* Room code banner (host only) */}
      {isHost && roomCode && (
        <div className="room-code-banner">
          <div className="room-code-banner__left">
            <span className="room-code-banner__label">Room Code</span>
            <span className="room-code-banner__code">{roomCode}</span>
            <span className="room-code-banner__hint">Share this with clients to join</span>
          </div>
          <button
            id="copy-room-code-btn"
            className="room-code-banner__copy"
            onClick={handleCopy}
            title="Copy room code"
          >
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
        </div>
      )}

      {/* Audio visualizer */}
      <AudioVisualizer
        analyserNode={analyserNode}
        mode={mode}
        accentColor={accentColor}
      />

      {/* Stats panel */}
      <StatsPanel stats={stats} mode={mode} connectedClients={connectedClients} />

      {/* Stop button */}
      <button
        id="stop-streaming-btn"
        className="stop-button"
        onClick={onStop}
        disabled={isLoading}
        aria-label="Stop streaming"
      >
        {isLoading ? (
          <span className="stop-button__loading">
            <span className="spinner" />
            Stopping…
          </span>
        ) : (
          '■  Stop Streaming'
        )}
      </button>
    </section>
  );
}
