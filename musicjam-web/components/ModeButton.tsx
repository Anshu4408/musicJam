'use client';

import React, { useRef, useState } from 'react';
import { COLORS } from '@/lib/colors';

interface ModeButtonProps {
  label:       string;
  subtitle:    string;
  icon:        string;
  accentColor: string;
  onPress:     () => void;
  disabled?:   boolean;
  loading?:    boolean;
}

export default function ModeButton({
  label,
  subtitle,
  icon,
  accentColor,
  onPress,
  disabled,
  loading,
}: ModeButtonProps) {
  const [pressed, setPressed] = useState(false);

  return (
    <button
      id={`mode-btn-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={`mode-button ${disabled ? 'mode-button--disabled' : ''} ${pressed ? 'mode-button--pressed' : ''}`}
      style={{
        borderColor: disabled ? COLORS.border : `${accentColor}44`,
        '--accent': accentColor,
        '--accent-glow': `${accentColor}12`,
      } as React.CSSProperties}
      onClick={() => { if (!disabled && !loading) onPress(); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      disabled={disabled || loading}
      aria-label={label}
    >
      {/* Glow overlay */}
      <span
        className="mode-button__glow"
        style={{ background: `radial-gradient(circle at 50% 0%, ${accentColor}18, transparent 70%)` }}
      />

      <span className="mode-button__icon">{icon}</span>
      <span
        className="mode-button__label"
        style={{ color: disabled ? COLORS.textMuted : COLORS.textPrimary }}
      >
        {loading ? 'Starting…' : label}
      </span>
      <span
        className="mode-button__subtitle"
        style={{ color: disabled ? COLORS.textMuted : COLORS.textSecondary }}
      >
        {subtitle}
      </span>

      {/* Bottom accent line */}
      {!disabled && (
        <span
          className="mode-button__accent-line"
          style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
        />
      )}
    </button>
  );
}
