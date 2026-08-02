'use client';

import React from 'react';
import { AppMode } from '@/hooks/useAudioEngine';
import { COLORS } from '@/lib/colors';

interface HeaderProps {
  mode: AppMode;
}

export default function Header({ mode }: HeaderProps) {
  const badgeColor = mode === 'host' ? COLORS.neonPurple : COLORS.neonBlue;
  const badgeLabel = mode === 'host' ? 'HOST' : 'CLIENT';

  return (
    <header className="header">
      <div className="logo-row">
        <span className="logo-icon">🎵</span>
        <span className="logo-text">MusicJAM</span>
        {mode !== 'idle' && (
          <span
            className="mode-badge"
            style={{
              backgroundColor: `${badgeColor}22`,
              border: `1px solid ${badgeColor}44`,
            }}
          >
            <span
              className="mode-badge-dot"
              style={{ backgroundColor: badgeColor }}
            />
            <span className="mode-badge-text" style={{ color: badgeColor }}>
              {badgeLabel}
            </span>
          </span>
        )}
      </div>
      <p className="header-subtitle">Zero-lag synchronized audio streaming</p>
    </header>
  );
}
