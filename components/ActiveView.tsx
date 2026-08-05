'use client';

import React, { useState, useRef, useMemo } from 'react';
import StatsPanel from './StatsPanel';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';

interface ActiveViewProps {
  mode:                AppMode;
  stats:               EngineStats | null;
  connectedClients:    number;
  analyserNode:        AnalyserNode | null; // not used in minimal theme
  isLoading:           boolean;
  roomCode:            string;
  needsGesture:        boolean;
  trackName:           string | null;
  trackDuration:       number;
  getPlaybackPosition: () => number;
  downloadProgress:    number;
  isPlaying:           boolean;
  libraryTracks:       string[];
  onUploadFile:        (file: File) => void;
  onLoadFromLibrary:   (name: string) => void;
  onDeleteFromLibrary: (name: string) => void;
  onBroadcastPlay:     () => void;
  onBroadcastPause:    () => void;
  onBroadcastSeek:     (time: number) => void;
  onStop:              () => void;
  onResumeAudio:       () => void;
}

export default function ActiveView({
  mode,
  stats,
  connectedClients,
  isLoading,
  roomCode,
  needsGesture,
  trackName,
  trackDuration,
  getPlaybackPosition,
  downloadProgress,
  isPlaying,
  libraryTracks,
  onUploadFile,
  onLoadFromLibrary,
  onDeleteFromLibrary,
  onBroadcastPlay,
  onBroadcastPause,
  onBroadcastSeek,
  onStop,
  onResumeAudio,
}: ActiveViewProps) {
  const isHost = mode === 'host';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStats, setShowStats] = useState(false);

  // Refs for high-frequency progress bar updates without React re-renders
  const progressInputRef = useRef<HTMLInputElement>(null);
  const progressTimeRef = useRef<HTMLSpanElement>(null);
  const isDraggingRef = useRef(false);

  React.useEffect(() => {
    let rafId: number;
    const updateProgressUI = () => {
      if (!isDraggingRef.current && progressInputRef.current && progressTimeRef.current) {
        const pos = getPlaybackPosition();
        progressInputRef.current.value = pos.toString();
        progressTimeRef.current.innerText = formatTime(pos);
        
        // Fix for progress bar visual fill
        const percent = trackDuration ? (pos / trackDuration) * 100 : 0;
        progressInputRef.current.style.backgroundSize = `${percent}% 100%`;
      }
      rafId = requestAnimationFrame(updateProgressUI);
    };
    rafId = requestAnimationFrame(updateProgressUI);
    return () => cancelAnimationFrame(rafId);
  }, [getPlaybackPosition, trackDuration]);

  const filteredLibrary = useMemo(() => {
    return libraryTracks.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [libraryTracks, searchQuery]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <section className="premium-active-view">
      {/* Mobile Audio Unlock Overlay */}
      {needsGesture && (
        <div className="gesture-overlay">
          <div className="gesture-modal">
            <h2>Playback Paused</h2>
            <p>Tap below to instantly resync audio playback with the host.</p>
            <button className="btn-accent" onClick={onResumeAudio}>
              Resume Sync
            </button>
          </div>
        </div>
      )}

      {/* Main View Area (Library) */}
      <div className="view-header">
        <div>
          <h2 className="session-title">{isHost ? 'Your Library' : 'Listening Party'}</h2>
          {isHost && (
            <div className="room-badge">
              Room Code: <span>{roomCode}</span>
            </div>
          )}
        </div>
      </div>

      <div className="library-section">
        {/* Massive Now Playing Visual */}
        <div className="now-playing-hero">
          <div className={`hero-art ${isPlaying ? 'playing' : ''}`}>
            {isPlaying ? '🎧' : '🎵'}
          </div>
          <h2 className="hero-title">{trackName || 'No track selected'}</h2>
          <p className="hero-subtitle">
             {downloadProgress < 100 && trackName ? `Downloading ${Math.round(downloadProgress)}%` : (trackName ? 'High-Fidelity Sync' : 'Waiting for audio...')}
          </p>
        </div>

        {isHost ? (
          <div className="host-library-wrapper">
            <div className="library-toolbar">
              <button 
                className="btn-upload" 
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                {isLoading ? 'Uploading...' : 'Upload Music'}
              </button>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                ref={fileInputRef}
              />
              <div className="search-box">
                <span className="search-icon">🔍</span>
                <input 
                  type="text" 
                  placeholder="Find in library" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="track-list">
              {filteredLibrary.length === 0 ? (
                <div className="empty-state">
                  <h3>No tracks found</h3>
                  <p>Upload audio files to add them to your library.</p>
                </div>
              ) : (
                filteredLibrary.map((t, index) => (
                  <div key={t} className={`track-item ${t === trackName ? 'active' : ''}`} onClick={() => onLoadFromLibrary(t)}>
                    <div className="track-number">{index + 1}</div>
                    <div className="track-info-col">
                      <div className="track-title">{t}</div>
                      <div className="track-artist">High-Fidelity Audio</div>
                    </div>
                    {/* Stop event bubbling so clicking delete doesn't trigger load */}
                    <button 
                      className="btn-delete" 
                      onClick={(e) => { e.stopPropagation(); onDeleteFromLibrary(t); }}
                      title="Delete from Library"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="client-library-wrapper">
            <h3 className="client-library-title">Cached on your device</h3>
            <div className="track-list">
              {libraryTracks.length === 0 ? (
                <div className="empty-state">
                  <p>No tracks cached yet.</p>
                </div>
              ) : (
                libraryTracks.map((t, index) => (
                  <div key={t} className={`track-item ${t === trackName ? 'active' : ''}`}>
                    <div className="track-number">{index + 1}</div>
                    <div className="track-info-col">
                      <div className="track-title">{t}</div>
                      <div className="track-artist">Available offline</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Player */}
      <div className="bottom-player-wrapper">
        <div className="glass-pill bottom-player">
          <div className="player-main-row">
            <div className="player-now-playing">
              <div className="player-art">
                {isPlaying ? '🔊' : '🎵'}
              </div>
              <div className="player-track-info">
                <div className="player-track-title">{trackName || 'No track selected'}</div>
                <div className="player-track-artist">
                  {downloadProgress < 100 && trackName ? `Downloading ${Math.round(downloadProgress)}%` : (trackName ? 'High-Fidelity Audio' : '—')}
                </div>
              </div>
            </div>

            <div className="player-controls">
              {isHost ? (
                <button 
                  className="btn-circle" 
                  onClick={isPlaying ? onBroadcastPause : onBroadcastPlay}
                  disabled={!trackName || downloadProgress < 100}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  {isPlaying ? 'Synced' : 'Waiting'}
                </div>
              )}
            </div>

            <div className="player-right">
              {/* Info Button for Stats */}
              <button className="btn-icon-subtle" onClick={() => setShowStats(true)} title="View Diagnostics">
                ℹ️
              </button>
              <button className="btn-icon-subtle" onClick={onStop} title="Leave Room" style={{ marginLeft: '12px', color: '#ff4444' }}>
                ✕
              </button>
            </div>
          </div>

          <div className="player-progress-bar-wrapper">
            {downloadProgress < 100 && trackName ? (
              <div 
                className="player-progress-fill" 
                style={{ width: `${downloadProgress}%`, backgroundColor: 'var(--text-muted)' }} 
              />
            ) : (
              <div className="seek-bar-container">
                <span className="time-label" ref={progressTimeRef}>0:00</span>
                <input 
                  ref={progressInputRef}
                  type="range"
                  className="seek-slider"
                  min={0}
                  max={trackDuration || 100}
                  step={0.1}
                  defaultValue={0}
                  onPointerDown={() => { isDraggingRef.current = true; }}
                  onPointerUp={(e) => { 
                    isDraggingRef.current = false;
                    if (isHost && trackDuration) {
                      onBroadcastSeek(parseFloat(e.currentTarget.value));
                    }
                  }}
                  onChange={(e) => {
                    if (progressTimeRef.current) {
                      progressTimeRef.current.innerText = formatTime(parseFloat(e.target.value));
                    }
                  }}
                  disabled={!isHost || !trackName || downloadProgress < 100}
                />
                <span className="time-label">{formatTime(trackDuration)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Modal */}
      {showStats && (
        <StatsPanel 
          stats={stats} 
          mode={mode} 
          connectedClients={connectedClients} 
          onClose={() => setShowStats(false)} 
        />
      )}
    </section>
  );
}
