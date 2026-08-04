'use client';

import React from 'react';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';

interface StatsPanelProps {
  stats: EngineStats | null;
  mode: AppMode;
  connectedClients: number;
  onClose: () => void;
}

export default function StatsPanel({ stats, mode, connectedClients, onClose }: StatsPanelProps) {
  // Always render something if the modal is open, even if stats are null
  return (
    <div className="stats-modal-overlay" onClick={onClose}>
      <div className="stats-modal" onClick={e => e.stopPropagation()}>
        <div className="stats-header">
          <h3>Diagnostics</h3>
          <button className="btn-icon-subtle" onClick={onClose}>✕</button>
        </div>
        
        <div className="stats-grid">
          {mode === 'host' ? (
            <>
              <div className="stat-row">
                <span className="stat-label">Clients Connected</span>
                <span className="stat-val">{connectedClients}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Sync RTT</span>
                <span className="stat-val">{stats ? `${Math.round(stats.lastRttUs / 1000)}ms` : '—'}</span>
              </div>
            </>
          ) : (
            <>
              <div className="stat-row">
                <span className="stat-label">Clock Offset</span>
                <span className="stat-val">{stats ? `${Math.round(stats.clockOffsetUs / 1000)}ms` : '—'}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Sync RTT</span>
                <span className="stat-val">{stats ? `${Math.round(stats.lastRttUs / 1000)}ms` : '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
