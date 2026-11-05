export function normalizarIntensidad(val: any): 'LOW' | 'MED' | 'HIGH' {
  const s = String(val || 'MED').trim().toUpperCase();
  if (s === 'LOW' || s === 'BAJA') return 'LOW';
  if (s === 'HIGH' || s === 'ALTA') return 'HIGH';
  return 'MED';
}

export function renderIntensityBadge(
  intensidadRaw: any,
  opts?: { prefix?: string; compact?: boolean }
): string {
  const val = normalizarIntensidad(intensidadRaw);
  const cls = val === 'LOW' ? 'int-low' : val === 'HIGH' ? 'int-high' : 'int-med';
  const prefix = opts?.prefix !== undefined ? opts.prefix : '⚡ ';
  const styleExtra = opts?.compact ? 'style="font-size:0.68rem;padding:2px 7px;"' : '';
  return `<span class="intensity-badge ${cls}" ${styleExtra} title="Intensidad: ${val}">${prefix}${val}</span>`;
}
