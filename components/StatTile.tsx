'use client';

import React, { useEffect, useRef, useState } from 'react';

interface StatTileProps {
  label: string;
  value: string;
  unit:  string;
  color: string;
}

export default function StatTile({ label, value, unit, color }: StatTileProps) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);

  // Animate value changes with a brief flash
  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setDisplayed(value);
    }
  }, [value]);

  return (
    <div className="stat-tile">
      <span className="stat-value" style={{ color }}>{displayed}</span>
      {unit && <span className="stat-unit">{unit}</span>}
      <span className="stat-label">{label}</span>
    </div>
  );
}
