import React from 'react';

interface IntensityBadgeProps {
  intensity?: 'LOW' | 'MED' | 'HIGH' | string;
  className?: string;
}

export const IntensityBadge: React.FC<IntensityBadgeProps> = ({ intensity = 'MED', className = '' }) => {
  const val = String(intensity || 'MED').trim().toUpperCase();
  const cls = val === 'LOW' ? 'int-low' : val === 'HIGH' ? 'int-high' : 'int-med';

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
