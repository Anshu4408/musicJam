'use client';

import React, { useState, useRef, useMemo } from 'react';
import StatsPanel from './StatsPanel';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';

interface ActiveViewProps {
  mode:                AppMode;
  stats:               EngineStats | null;
  connectedClients:    number;
  analyserNode:        AnalyserNode | null;
  isLoading:           boolean;
  roomCode:            string;
  needsGesture:        boolean;
  trackName:           string | null;
  downloadProgress:    number;
  isPlaying:           boolean;
  libraryTracks:       string[];
  onUploadFile:        (file: File) => void;
  onLoadFromLibrary:   (name: string) => void;
  onDeleteFromLibrary: (name: string) => void;
  onBroadcastPlay:     () => void;
  onBroadcastPause:    () => void;
  onStop:              () => void;
  onResumeAudio:       () => void;
}

export default function ActiveView({
  mode,
  stats,
  connectedClients,
  analyserNode,
  isLoading,
  roomCode,
  needsGesture,
  trackName,
  downloadProgress,
  isPlaying,
  libraryTracks,
  onUploadFile,
  onLoadFromLibrary,
  onDeleteFromLibrary,
  onBroadcastPlay,
  onBroadcastPause,
  onStop,
  onResumeAudio,
}: ActiveViewProps) {
  const isHost = mode === 'host';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStats, setShowStats] = useState(false);

  const filteredLibrary = useMemo(() => {
    return libraryTracks.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [libraryTracks, searchQuery]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
  };

  return (
    <section className="premium-active-view">
      {/* Mobile Audio Unlock Overlay */}
      {needsGesture && (
        <div className="gesture-overlay">
          <div className="gesture-modal">
            <div className="gesture-icon">🔊</div>
            <h2>Tap to Play</h2>
            <p>Your browser paused the audio. Tap below to instantly sync.</p>
            <button className="btn-primary large" onClick={onResumeAudio}>
              Resume Audio
            </button>
          </div>
        </div>
      )}

      {/* Main UI */}
      <div className="view-header">
        <div className="session-info">
          <h2>{isHost ? 'Host Session' : 'Listening Party'}</h2>
          {isHost && (
            <p className="room-code">
              Room Code: <strong>{roomCode}</strong>
              <span className="client-count"> • {connectedClients} listening</span>
            </p>
          )}
        </div>
        <button className="btn-icon" onClick={() => setShowStats(!showStats)} title="Toggle Stats">
          ℹ️
        </button>
      </div>

      <div className="content-grid">
        {/* Left Column: Player */}
        <div className="player-section card">
          <div className="album-art-placeholder">
            <div className={`art-pulse ${isPlaying ? 'playing' : ''}`}>🎵</div>
          </div>
          
          <div className="track-details">
            <h3>{trackName || 'No track selected'}</h3>
            <p className="artist-name">{trackName ? 'High-Fidelity Audio' : 'Awaiting selection...'}</p>
          </div>

          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${downloadProgress}%`, background: downloadProgress < 100 ? '#555' : '#fff' }} 
              />
            </div>
            <div className="progress-labels">
              <span>{downloadProgress < 100 && trackName ? `Downloading ${Math.round(downloadProgress)}%` : '0:00'}</span>
              <span>{trackName && downloadProgress === 100 ? 'Ready' : ''}</span>
            </div>
          </div>

          {isHost ? (
            <div className="controls">
              <button 
                className="btn-play-pause" 
                onClick={isPlaying ? onBroadcastPause : onBroadcastPlay}
                disabled={!trackName || downloadProgress < 100}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
            </div>
          ) : (
            <div className="client-status">
              {isPlaying ? 'Synchronized perfectly 🎧' : 'Waiting for host to play...'}
            </div>
          )}
        </div>

        {/* Right Column: Library (Host Only) */}
        {isHost && (
          <div className="library-section card">
            <div className="library-header">
              <h3>My Library</h3>
              <button className="btn-secondary small" onClick={() => fileInputRef.current?.click()}>
                + Upload
              </button>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                ref={fileInputRef}
              />
            </div>

            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input 
                type="text" 
                placeholder="Search tracks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <ul className="library-list">
              {filteredLibrary.length === 0 ? (
                <li className="empty-state">No tracks found. Upload some music!</li>
              ) : (
                filteredLibrary.map(t => (
                  <li key={t} className={`library-item ${t === trackName ? 'active' : ''}`}>
                    <button className="track-btn" onClick={() => onLoadFromLibrary(t)}>
                      <span className="track-icon">{t === trackName && isPlaying ? '🔊' : '🎵'}</span>
                      <span className="track-title">{t}</span>
                    </button>
                    <button className="delete-btn" onClick={() => onDeleteFromLibrary(t)}>✕</button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {showStats && (
        <div className="stats-wrapper">
          <StatsPanel stats={stats} mode={mode} connectedClients={connectedClients} />
        </div>
      )}

      <button className="btn-danger stop-btn" onClick={onStop}>
        End Session
      </button>

    </section>
  );
}
