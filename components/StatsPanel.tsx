'use client';

import React from 'react';
import StatTile from './StatTile';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';
import { COLORS } from '@/lib/colors';

interface StatsPanelProps {
  stats:            EngineStats | null;
  mode:             AppMode;
  connectedClients: number;
}

export default function StatsPanel({ stats, mode, connectedClients }: StatsPanelProps) {
  const syncQuality =
    !stats ? '—'
    : stats.latencyMs < 5  ? 'Excellent'
    : stats.latencyMs < 20 ? 'Good'
    : 'Fair';

  const syncColor =
    !stats ? COLORS.textMuted
    : stats.latencyMs < 5  ? COLORS.neonGreen
    : stats.latencyMs < 20 ? COLORS.neonOrange
    : COLORS.neonRed;

  return (
    <div className="stats-panel">
      <div className="stats-panel__header">
        <span className="status-dot status-dot--live" />
        <span className="stats-panel__title">
          {mode === 'host' ? 'Broadcasting' : 'Receiving'} · Live
        </span>

        {/* Quality bar */}
        <div className="quality-bar-wrapper">
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="quality-bar-segment"
              style={{
                backgroundColor: stats && i <= Math.ceil((5 - Math.min(stats.latencyMs, 50)) / 10 + 1)
                  ? syncColor : COLORS.border,
              }}
            />
          ))}
        </div>
      </div>

      <div className="stat-grid">
        {mode === 'host' ? (
          <>
            <StatTile
              label="Bitrate"
              value={stats ? `${stats.bitrateKbps}` : '—'}
              unit="kbps"
              color={COLORS.neonBlue}
            />
            <StatTile
              label="Frames Sent"
              value={stats ? `${(stats.encodedFrames / 1000).toFixed(1)}k` : '—'}
              unit="frames"
              color={COLORS.neonPurple}
            />
            <StatTile
              label="Clients"
              value={`${connectedClients}`}
              unit="connected"
              color={COLORS.neonGreen}
            />
            <StatTile
              label="Bytes Sent"
              value={stats ? `${(stats.bytesSent / 1024 / 1024).toFixed(1)}` : '—'}
              unit="MB"
              color={COLORS.neonOrange}
            />
          </>
        ) : (
          <>
            <StatTile
              label="Clock Offset"
              value={stats ? `${stats.latencyMs}` : '—'}
              unit="ms"
              color={COLORS.neonBlue}
            />
            <StatTile
              label="RTT"
              value={stats ? `${Math.round(stats.lastRttUs / 1000)}` : '—'}
              unit="ms"
              color={COLORS.neonPurple}
            />
            <StatTile
              label="Sync Quality"
              value={syncQuality}
              unit=""
              color={syncColor}
            />
          </>
        )}
      </div>
    </div>
  );
}
