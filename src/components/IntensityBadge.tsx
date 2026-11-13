import React from 'react';
import { normalizarIntensidad, getIntensityBadgeClass } from '../utils/helpers';

interface IntensityBadgeProps {
  intensity?: string;
  className?: string;
}

export const IntensityBadge: React.FC<IntensityBadgeProps> = ({ intensity = 'MED', className = '' }) => {
  const val = normalizarIntensidad(intensity);
  const cls = getIntensityBadgeClass(val);

  return (
    <span
      className={`intensity-badge ${cls} ${className}`}
      title={`Intensidad: ${val}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.5px'
      }}
    >
      ⚡ {val}
    </span>
  );
};
