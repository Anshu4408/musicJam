'use client';

import React from 'react';
import ModeButton from './ModeButton';
import { COLORS } from '@/lib/colors';

interface SelectionViewProps {
  onStartHost:   () => void;
  onStartClient: () => void;
  isLoading:     boolean;
}

const HOW_IT_WORKS = [
  { icon: '🎵', text: 'Host captures internal audio (Spotify, YouTube, etc.)' },
  { icon: '⚡', text: 'Opus encodes & UDP multicasts every 20ms frame' },
  { icon: '🕐', text: 'NTP clock sync keeps all clients in exact alignment' },
  { icon: '🔊', text: 'Clients play audio at the precise scheduled millisecond' },
];

export default function SelectionView({
  onStartHost,
  onStartClient,
  isLoading,
}: SelectionViewProps) {
  return (
    <section className="selection-view">
      <h2 className="section-title">Choose Your Role</h2>
      <p className="section-subtitle">
        Both devices must be on the same Wi-Fi network or hotspot
      </p>

      <div className="mode-buttons-row">
        <ModeButton
          label="Start Host"
          subtitle={'Capture & broadcast\nyour device audio'}
          icon="📡"
          accentColor={COLORS.neonPurple}
          onPress={onStartHost}
          loading={isLoading}
        />
        <ModeButton
          label="Join as Client"
          subtitle={'Receive & play\nthe host audio'}
          icon="🎧"
          accentColor={COLORS.neonBlue}
          onPress={onStartClient}
          loading={isLoading}
        />
      </div>

      {/* Network topology diagram */}
      <div className="network-diagram">
        <div className="network-node network-node--host">
          <span>📡</span>
          <span>Host</span>
        </div>
        <div className="network-arrows">
          <span className="network-arrow" />
          <span className="network-label">UDP Multicast</span>
          <span className="network-arrow network-arrow--right" />
        </div>
        <div className="network-clients">
          {['🎧', '🎧', '🎧'].map((e, i) => (
            <div key={i} className="network-node network-node--client">
              <span>{e}</span>
              <span>Client {i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Info card */}
      <div className="info-card">
        <p className="info-card__title">How it works</p>
        {HOW_IT_WORKS.map((item, i) => (
          <div key={i} className="info-row">
            <span className="info-icon">{item.icon}</span>
            <span className="info-text">{item.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
