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

      <div className="action-stack">
        <div className="action-card" onClick={isLoading ? undefined : onStartHost}>
          <h3>Host a Party</h3>
          <p>Create a room and stream your library in perfect sync.</p>
          <button className="btn-primary" disabled={isLoading}>Start Hosting</button>
        </div>

        <div className="action-card">
          <h3>Join a Party</h3>
          <p>Enter a 6-letter code to listen in.</p>
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
