'use client';

import React from 'react';
import { AppMode } from '@/hooks/useAudioEngine';

interface HeaderProps {
  mode: AppMode;
}

export default function Header({ mode }: HeaderProps) {
  return (
    <header className="header">
      <div className="logo-row">
        <span className="logo-icon">🎵</span>
        <span className="logo-text">MusicJAM</span>
      </div>
    </header>
  );
}
