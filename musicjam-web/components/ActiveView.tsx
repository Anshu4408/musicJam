'use client';

import React from 'react';
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
  onStop:           () => void;
}

export default function ActiveView({
  mode,
  stats,
  connectedClients,
  analyserNode,
  isLoading,
  onStop,
}: ActiveViewProps) {
  const isHost      = mode === 'host';
  const accentColor = isHost ? COLORS.neonPurple : COLORS.neonBlue;
  const icon        = isHost ? '📡' : '🎧';
  const title       = isHost ? 'Broadcasting Audio' : 'Receiving Stream';
  const subtitle    = isHost
    ? 'Your device audio is being streamed to all clients'
    : 'Synchronized to host clock · Jitter buffer active';

  return (
    <section className="active-view">
      {/* Pulsing icon */}
      <div className="active-icon-container">
        <PulseRing color={accentColor} active={true} />
        <span className="active-icon">{icon}</span>
      </div>

      <h2 className="active-title">{title}</h2>
      <p className="active-subtitle">{subtitle}</p>

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
