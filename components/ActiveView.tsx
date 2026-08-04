'use client';

import React, { useState, useRef } from 'react';
import PulseRing from './PulseRing';
import StatsPanel from './StatsPanel';
import AudioVisualizer from './AudioVisualizer';
import { AppMode, EngineStats } from '@/hooks/useAudioEngine';
import { COLORS } from '@/lib/colors';

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
  const isHost      = mode === 'host';
  const accentColor = isHost ? COLORS.neonPurple : COLORS.neonBlue;
  const icon        = isHost ? '📡' : '🎧';
  const title       = isHost ? 'Host Session' : 'Listening Party';
  const subtitle    = isHost
    ? 'Upload a track or load from your local library'
    : 'Synchronized perfect 0ms playback';

  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
    }
  };

  return (
    <section className="active-view">
      {/* ── "Tap to Listen" overlay for mobile autoplay block ── */}
      {needsGesture && (
        <div className="tap-to-listen">
          <button
            id="tap-to-listen-btn"
            className="tap-to-listen__btn"
            onClick={onResumeAudio}
          >
            <span className="tap-to-listen__icon">🔊</span>
            <span className="tap-to-listen__label">Tap to Unlock Audio</span>
            <span className="tap-to-listen__sub">
              Required by your browser to allow playback
            </span>
          </button>
        </div>
      )}

      {/* Pulsing icon */}
      <div className="active-icon-container">
        <PulseRing color={accentColor} active={isPlaying} />
        <span className="active-icon">{icon}</span>
      </div>

      <h2 className="active-title">{title}</h2>
      <p className="active-subtitle">{subtitle}</p>

      {/* Room code banner (host only) */}
      {isHost && roomCode && (
        <div className="room-code-banner">
          <div className="room-code-banner__left">
            <span className="room-code-banner__label">Room Code</span>
            <span className="room-code-banner__code">{roomCode}</span>
            <span className="room-code-banner__hint">Share this with clients to join</span>
          </div>
          <button
            id="copy-room-code-btn"
            className="room-code-banner__copy"
            onClick={handleCopy}
            title="Copy room code"
          >
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
        </div>
      )}

      {/* Track Info & Controls */}
      <div className="track-controls-card">
        {isHost ? (
          <div className="host-controls">
            {!trackName && (
              <div className="upload-prompt">
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/ogg"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  ref={fileInputRef}
                />
                
                <div className="library-section">
                  {libraryTracks.length > 0 && (
                    <>
                      <h4 className="library-title">My Saved Library</h4>
                      <ul className="library-list">
                        {libraryTracks.map(t => (
                          <li key={t} className="library-item">
                            <button className="library-play-btn" onClick={() => onLoadFromLibrary(t)}>▶ {t}</button>
                            <button className="library-del-btn" onClick={() => onDeleteFromLibrary(t)} title="Delete from local cache">✕</button>
                          </li>
                        ))}
                      </ul>
                      <div className="library-divider">or</div>
                    </>
                  )}
                </div>

                <button 
                  className="primary-button" 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || connectedClients === 0}
                >
                  {isLoading ? 'Uploading...' : connectedClients === 0 ? 'Wait for clients to join...' : '📁 Select New Audio File'}
                </button>
              </div>
            )}
            
            {trackName && (
              <div className="track-info">
                <h3>{trackName}</h3>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${downloadProgress}%`, backgroundColor: accentColor }}></div>
                </div>
                <p className="progress-text">
                  {downloadProgress < 100 
                    ? `Transferring to clients... ${Math.round(downloadProgress)}%` 
                    : 'Ready to play'}
                </p>
                
                <div className="playback-buttons">
                  {isPlaying ? (
                    <button className="primary-button" onClick={onBroadcastPause}>⏸ Pause</button>
                  ) : (
                    <button className="primary-button" onClick={onBroadcastPlay} disabled={downloadProgress < 100}>▶ Play Sync</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="client-controls">
            {trackName ? (
              <div className="track-info">
                <h3>{trackName}</h3>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${downloadProgress}%`, backgroundColor: accentColor }}></div>
                </div>
                <p className="progress-text">
                  {downloadProgress < 100 
                    ? `Downloading track... ${Math.round(downloadProgress)}%` 
                    : isPlaying ? '🎵 Playing in sync' : 'Waiting for host to play...'}
                </p>
              </div>
            ) : (
              <div className="waiting-prompt">
                <p>Waiting for host to select a track...</p>
                {libraryTracks.length > 0 && (
                  <p className="client-cache-note">({libraryTracks.length} tracks cached on your device for instant loading)</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Audio visualizer */}
      <AudioVisualizer
        analyserNode={analyserNode}
        mode={mode}
        accentColor={accentColor}
      />

      {/* Stats panel */}
      <StatsPanel stats={stats} mode={mode} connectedClients={connectedClients} />

      {/* Stop button */}
      <button
        id="stop-streaming-btn"
        className="stop-button"
        onClick={onStop}
        disabled={isLoading}
        aria-label="Stop session"
      >
        {isLoading && !trackName ? (
          <span className="stop-button__loading">
            <span className="spinner" />
            Stopping…
          </span>
        ) : (
          isHost ? '■ End Session' : '■ Leave Room'
        )}
      </button>
      
      <style jsx>{`
        .track-controls-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 24px;
          width: 100%;
          text-align: center;
        }
        .upload-prompt p {
          margin-bottom: 16px;
          color: rgba(255, 255, 255, 0.7);
        }
        .primary-button {
          background: ${accentColor};
          color: #000;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-weight: bold;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.2s;
        }
        .primary-button:hover:not(:disabled) {
          opacity: 0.9;
          transform: scale(1.02);
        }
        .primary-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .track-info h3 {
          margin: 0 0 12px 0;
          font-size: 1.1rem;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .progress-bar-container {
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .progress-bar-fill {
          height: 100%;
          transition: width 0.1s linear;
        }
        .progress-text {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.6);
          margin: 0 0 16px 0;
        }
        .playback-buttons {
          display: flex;
          gap: 12px;
          justify-content: center;
        }
        .waiting-prompt p {
          color: rgba(255, 255, 255, 0.5);
          margin: 0;
          font-style: italic;
        }
        .client-cache-note {
          font-size: 0.8rem;
          margin-top: 8px !important;
          color: rgba(255, 255, 255, 0.3) !important;
        }
        
        .library-section {
          margin-bottom: 24px;
        }
        .library-title {
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: rgba(255, 255, 255, 0.5);
          margin: 0 0 12px 0;
        }
        .library-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 200px;
          overflow-y: auto;
        }
        .library-item {
          display: flex;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          padding: 4px;
        }
        .library-item:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .library-play-btn {
          background: transparent;
          border: none;
          color: #fff;
          text-align: left;
          padding: 8px 12px;
          flex-grow: 1;
          cursor: pointer;
          font-size: 0.9rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .library-del-btn {
          background: transparent;
          border: none;
          color: rgba(255, 100, 100, 0.6);
          cursor: pointer;
          padding: 0 12px;
        }
        .library-del-btn:hover {
          color: rgba(255, 100, 100, 1);
        }
        .library-divider {
          margin-top: 16px;
          color: rgba(255, 255, 255, 0.3);
          font-size: 0.9rem;
          position: relative;
        }
        .library-divider::before, .library-divider::after {
          content: '';
          position: absolute;
          top: 50%;
          width: 40%;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
        }
        .library-divider::before { left: 0; }
        .library-divider::after { right: 0; }
      `}</style>
    </section>
  );
}
