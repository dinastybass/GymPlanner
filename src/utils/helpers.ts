export function normalizarTextoBusqueda(val: any): string {
  if (!val) return '';
  return String(val)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function coincideBusqueda(texto: any, terminoBusqueda: any): boolean {
  const term = normalizarTextoBusqueda(terminoBusqueda);
  if (!term) return true;
  const target = normalizarTextoBusqueda(texto);
  return target.includes(term);
}

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

export function esSesionCompletada(data: any): boolean {
  if (!data) return false;
  const est1 = String(data.estado || '').trim().toLowerCase();
  const est2 = String(data.estado_sesion || '').trim().toLowerCase();
  const asist = String(data.asistencia || '').trim().toLowerCase();
  return (
    est1 === 'completada' ||
    est2 === 'completada' ||
    asist === 'completada' ||
    asist === 'asistio' ||
    asist === 'asistió' ||
    data.completada === true
  );
}

export function esSesionCancelada(data: any): boolean {
  if (!data) return false;
  const est1 = String(data.estado || '').trim().toLowerCase();
  const est2 = String(data.estado_sesion || '').trim().toLowerCase();
  return est1 === 'cancelada' || est2 === 'cancelada';
}

export function parsearFechaFirestore(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof val === 'object') {
    const secs =
      typeof val.seconds === 'number'
        ? val.seconds
        : typeof val._seconds === 'number'
        ? val._seconds
        : null;
    const nanos =
      typeof val.nanoseconds === 'number'
        ? val.nanoseconds
        : typeof val._nanoseconds === 'number'
        ? val._nanoseconds
        : 0;
    if (secs !== null) {
      const d = new Date(secs * 1000 + Math.floor(nanos / 1e6));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

