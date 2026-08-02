'use client';

import React, { useState } from 'react';
import ModeButton from './ModeButton';
import { COLORS } from '@/lib/colors';

interface SelectionViewProps {
  onStartHost:   () => void;
  onStartClient: (code: string) => void;
  isLoading:     boolean;
}

const HOW_IT_WORKS = [
  { icon: '🎵', text: 'Host shares a browser tab or system audio (Spotify, YouTube, etc.)' },
  { icon: '🔗', text: 'A 6-character room code is generated — share it with clients' },
  { icon: '🕐', text: 'NTP clock sync keeps all clients in exact alignment' },
  { icon: '🔊', text: 'Clients play audio at the precise scheduled millisecond' },
];

export default function SelectionView({
  onStartHost,
  onStartClient,
  isLoading,
}: SelectionViewProps) {
  const [roomInput, setRoomInput] = useState('');
  const [showJoin, setShowJoin]   = useState(false);

  return (
    <section className="selection-view">
      <h2 className="section-title">Choose Your Role</h2>
      <p className="section-subtitle">
        Host shares audio — clients join with a room code to listen in sync
      </p>

      <div className="mode-buttons-row">
        {/* ── Host Card ── */}
        <ModeButton
          label="Start Host"
          subtitle={'Share tab or system audio\n(Spotify, YouTube & more)'}
          icon="📡"
          accentColor={COLORS.neonPurple}
          onPress={onStartHost}
          loading={isLoading}
        />

        {/* ── Client Card ── */}
        <button
          id="mode-btn-join-as-client"
          className={`mode-button ${showJoin ? 'mode-button--active' : ''}`}
          style={{
            borderColor: showJoin ? `${COLORS.neonBlue}80` : COLORS.border,
            '--accent': COLORS.neonBlue,
          } as React.CSSProperties}
          onClick={() => setShowJoin(v => !v)}
          disabled={isLoading}
          aria-label="Join as Client"
        >
          <span
            className="mode-button__glow"
            style={{ background: `radial-gradient(circle at 50% 0%, ${COLORS.neonBlue}18, transparent 70%)` }}
          />
          <span className="mode-button__icon">🎧</span>
          <span className="mode-button__label" style={{ color: COLORS.textPrimary }}>
            Join as Client
          </span>
          <span className="mode-button__subtitle" style={{ color: COLORS.textSecondary }}>
            {'Receive & play\nthe host audio'}
          </span>
          {showJoin && (
            <span className="mode-button__accent-line"
              style={{ background: `linear-gradient(90deg, transparent, ${COLORS.neonBlue}, transparent)` }}
            />
          )}
        </button>
      </div>

      {/* ── Room Code Input (shown when Join is expanded) ── */}
      {showJoin && (
        <div className="join-panel">
          <p className="join-panel__label">Enter the room code from the host device</p>
          <div className="join-panel__row">
            <input
              id="room-code-input"
              className="room-code-input"
              type="text"
              placeholder="e.g. AB12CD"
              maxLength={6}
              value={roomInput}
              onChange={e => setRoomInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && roomInput.trim().length === 6) {
                  onStartClient(roomInput.trim());
                }
              }}
              autoFocus
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button
              id="join-room-btn"
              className="join-room-btn"
              onClick={() => onStartClient(roomInput.trim())}
              disabled={isLoading || roomInput.trim().length < 4}
              style={{ borderColor: `${COLORS.neonBlue}60`, color: COLORS.neonBlue }}
            >
              {isLoading ? (
                <span className="spinner" style={{ borderTopColor: COLORS.neonBlue }} />
              ) : 'Connect →'}
            </button>
          </div>
          <p className="join-panel__hint">
            💡 Make sure host is already broadcasting before joining
          </p>
        </div>
      )}

      {/* Network topology diagram */}
      <div className="network-diagram">
        <div className="network-node network-node--host">
          <span>📡</span>
          <span>Host</span>
        </div>
        <div className="network-arrows">
          <span className="network-arrow" />
          <span className="network-label">WebRTC Audio</span>
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

      {/* Pro tip */}
      <div className="tip-card">
        <span className="tip-card__icon">💡</span>
        <div>
          <p className="tip-card__title">How to share Spotify / system audio</p>
          <p className="tip-card__body">
            Click <strong>Start Host</strong>, then in the browser dialog:
          </p>
          <ol className="tip-card__steps">
            <li>Pick a <strong>Tab</strong> (e.g. Spotify Web) and tick <strong>"Share tab audio"</strong></li>
            <li>Or pick <strong>Entire Screen</strong> and tick <strong>"Share system audio"</strong> (Windows/macOS)</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
