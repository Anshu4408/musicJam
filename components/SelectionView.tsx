'use client';

import React, { useState } from 'react';

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

      <div className="action-cards">
        <div className="action-card" onClick={isLoading ? undefined : onStartHost}>
          <div className="card-icon">📡</div>
          <h3>Start Hosting</h3>
          <p>Create a room and stream your library to others.</p>
        </div>

        <div className="action-card" onClick={(e) => {
          // Only trigger if clicking the card background, not the input itself
          if ((e.target as HTMLElement).tagName !== 'INPUT' && code.length === 6) {
            onStartClient(code);
          }
        }}>
          <div className="card-icon">🎧</div>
          <h3>Join Room</h3>
          <p>Enter a 6-letter room code to listen in.</p>
          <input
            className="join-input"
            type="text"
            placeholder="ENTER CODE"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.length === 6 && !isLoading) {
                onStartClient(code);
              }
            }}
            disabled={isLoading}
          />
          {code.length === 6 && (
            <button 
              className="btn-primary" 
              style={{ width: '100%', marginTop: '16px' }}
              onClick={() => onStartClient(code)}
              disabled={isLoading}
            >
              Join Now
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
