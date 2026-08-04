'use client';

import React from 'react';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';

interface StatsPanelProps {
  stats: EngineStats | null;
  mode: AppMode;
  connectedClients: number;
}

export default function StatsPanel({ stats, mode, connectedClients }: StatsPanelProps) {
  if (!stats && mode !== 'host') return null;

  return (
    <div className="stats-grid">
      {mode === 'host' ? (
        <>
          <div className="stat-card">
            <div className="stat-label">Clients Connected</div>
            <div className="stat-val">{connectedClients}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sync RTT</div>
            <div className="stat-val">{stats ? `${Math.round(stats.lastRttUs / 1000)}ms` : '—'}</div>
          </div>
        </>
      ) : (
        <>
          <div className="stat-card">
            <div className="stat-label">Clock Offset</div>
            <div className="stat-val">{stats ? `${Math.round(stats.clockOffsetUs / 1000)}ms` : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sync RTT</div>
            <div className="stat-val">{stats ? `${Math.round(stats.lastRttUs / 1000)}ms` : '—'}</div>
          </div>
        </>
      )}
    </div>
  );
}
