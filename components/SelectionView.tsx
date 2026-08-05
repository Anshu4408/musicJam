'use client';

import React, { useState } from 'react';
import { Zap, Music, Lock } from 'lucide-react';

interface SelectionViewProps {
  onStartHost:   () => void;
  onStartClient: (code: string) => void;
  isLoading:     boolean;
}

export default function SelectionView({ onStartHost, onStartClient, isLoading }: SelectionViewProps) {
  const [code, setCode] = useState('');

  return (
    <section className="selection-view">
      <h1>MusicJAM</h1>
      <p>Zero-lag synchronized audio streaming. Listen together perfectly.</p>

      <div className="action-stack">
        <div className="action-card" onClick={isLoading ? undefined : onStartHost}>
          <h3>Host a Party</h3>
          <p>Create a room and stream your library in perfect sync.</p>
          <button className="btn-primary" disabled={isLoading}>Start Hosting</button>
        </div>

        <form className="action-card" onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6 && !isLoading) onStartClient(code);
        }}>
          <h3>Join a Party</h3>
          <p>Enter a 6-letter code to listen in.</p>
          <input
            className="join-input"
            type="text"
            placeholder="ENTER CODE"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={isLoading}
          />
          <button 
            type="submit"
            className="btn-primary" 
            style={{ width: '100%', marginTop: '16px' }}
            disabled={isLoading || code.length !== 6}
          >
            Join Now
          </button>
        </form>
      </div>

      <div style={{ marginTop: '64px', maxWidth: '800px', width: '100%', textAlign: 'center' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', marginBottom: '24px', color: 'var(--text-secondary)' }}>
          How it Works
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
          <div style={{ background: 'var(--bg-glass-light)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-glass)' }}>
            <div style={{ marginBottom: '12px', color: 'var(--accent-primary)', display: 'flex', justifyContent: 'center' }}><Zap size={32} /></div>
            <h4 style={{ fontWeight: '600', marginBottom: '8px' }}>Zero-Lag Sync</h4>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Powered by UDP Multicast and NTP Clock Synchronization for frame-perfect playback.</p>
          </div>
          <div style={{ background: 'var(--bg-glass-light)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-glass)' }}>
            <div style={{ marginBottom: '12px', color: 'var(--accent-primary)', display: 'flex', justifyContent: 'center' }}><Music size={32} /></div>
            <h4 style={{ fontWeight: '600', marginBottom: '8px' }}>High Fidelity</h4>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Streams raw audio via Opus 48kHz encoding, preserving your track's original master quality.</p>
          </div>
          <div style={{ background: 'var(--bg-glass-light)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-glass)' }}>
            <div style={{ marginBottom: '12px', color: 'var(--accent-primary)', display: 'flex', justifyContent: 'center' }}><Lock size={32} /></div>
            <h4 style={{ fontWeight: '600', marginBottom: '8px' }}>Peer-to-Peer</h4>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Music is streamed directly between devices on the same network. No cloud servers required.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
