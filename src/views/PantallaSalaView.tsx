import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  cargarCatalogoMaestros,
  extraerListaMaster,
  onCatalogoMaestrosChanged
} from '../services/maestrosService';
import {
  esSesionCompletada,
  esSesionCancelada,
  obtenerFechaOperativaEfectiva
} from '../utils/helpers';

interface PantallaSalaViewProps {
  onBack: () => void;
}

const diasSemanaMap: Record<number, string> = {
  1: 'LUNES',
  2: 'MARTES',
  3: 'MIÉRCOLES',
  4: 'JUEVES',
  5: 'VIERNES',
  6: 'SÁBADO',
  0: 'DOMINGO'
};

const mesesMap: Record<number, string> = {
  0: 'ENERO',
  1: 'FEBRERO',
  2: 'MARZO',
  3: 'ABRIL',
  4: 'MAYO',
  5: 'JUNIO',
  6: 'JULIO',
  7: 'AGOSTO',
  8: 'SEPTIEMBRE',
  9: 'OCTUBRE',
  10: 'NOVIEMBRE',
  11: 'DICIEMBRE'
};

function calcularTurnoObjetivo(diasSemana: string[]) {
  const now = new Date();
  const currentTotalMins = now.getHours() * 60 + now.getMinutes();

  const { targetDate, rolledOver } = obtenerFechaOperativaEfectiva(diasSemana, now);
  const esHoyMismo = !rolledOver;
  const targetBlock: 'MAÑANA' | 'TARDE' = !esHoyMismo
    ? 'MAÑANA'
    : currentTotalMins >= 13 * 60 + 30
      ? 'TARDE'
      : 'MAÑANA';

  return { targetDate, targetBlock, esHoyMismo, currentTotalMins };
}

function getLayoutDimensions(count: number) {
  if (count <= 4) return { cols: 4, rows: 1, capacity: 4, compact: false };
  if (count <= 8) return { cols: 4, rows: 2, capacity: 8, compact: false };
  if (count <= 10) return { cols: 5, rows: 2, capacity: 10, compact: true };
  return { cols: 6, rows: 2, capacity: 12, compact: true };
}

export const PantallaSalaView: React.FC<PantallaSalaViewProps> = ({ onBack }) => {
  const { isProyector, logout } = useAuth();

  const [ordenBloques, setOrdenBloques] = useState<string[]>([
    'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    'BLOQUE 2: FUERZA - PRINCIPAL',
    'BLOQUE 3: COMPENSATORIO - ACCESORIO',
    'BLOQUE 4: METABÓLICO - ACONDICIONAMIENTO'
  ]);
  const diasSemanaRef = React.useRef<string[]>([
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes'
  ]);
  const [sesionesActivas, setSesionesActivas] = useState<any[]>([]);
  const [shiftDateLabel, setShiftDateLabel] = useState('CARGANDO...');
  const [shiftBlockLabel, setShiftBlockLabel] = useState('TURNO');
  const keepAwakeVideoRef = React.useRef<HTMLVideoElement | null>(null);

  // Evitar que la TV de la sala apague la pantalla (Screen Wake Lock API + Vídeo oculto en bucle continuo)
  useEffect(() => {
    let wakeLock: any = null;
    let canvasInterval: ReturnType<typeof setInterval> | null = null;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          if (!wakeLock || wakeLock.released) {
            wakeLock = await (navigator as any).wakeLock.request('screen');
          }
        }
      } catch {
        // Algunos navegadores de Smart TV no soportan WakeLock y dependen del vídeo oculto
      }
    };

    const startHiddenVideoLoop = () => {
      const videoEl = keepAwakeVideoRef.current;
      if (!videoEl) return;

      try {
        videoEl.muted = true;
        videoEl.loop = true;
        videoEl.playsInline = true;

        // Si el navegador soporta captureStream desde un canvas, generamos un stream real de 1fps
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const ctx = canvas.getContext('2d');
        if (ctx && typeof (canvas as any).captureStream === 'function') {
          let toggle = false;
          const drawTick = () => {
            toggle = !toggle;
            ctx.fillStyle = toggle ? '#0f172a' : '#1e293b';
            ctx.fillRect(0, 0, 2, 2);
          };
          drawTick();
          canvasInterval = setInterval(drawTick, 1000);
          const stream = (canvas as any).captureStream(1);
          videoEl.srcObject = stream;
        }

        const playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch {
        // Fallback silencioso
      }
    };

    const ensureAwake = () => {
      requestWakeLock();
      const videoEl = keepAwakeVideoRef.current;
      if (videoEl && videoEl.paused) {
        videoEl.play().catch(() => {});
      }
    };

    requestWakeLock();
    startHiddenVideoLoop();

    keepAliveTimer = setInterval(ensureAwake, 25000);
    document.addEventListener('visibilitychange', ensureAwake);
    document.addEventListener('click', ensureAwake);
    document.addEventListener('touchstart', ensureAwake);
    document.addEventListener('keydown', ensureAwake);

    return () => {
      if (canvasInterval) clearInterval(canvasInterval);
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      document.removeEventListener('visibilitychange', ensureAwake);
      document.removeEventListener('click', ensureAwake);
      document.removeEventListener('touchstart', ensureAwake);
      document.removeEventListener('keydown', ensureAwake);
      if (wakeLock && typeof wakeLock.release === 'function') {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  const actualizarPantallaSala = useCallback(async () => {
    try {
      const { targetDate, targetBlock, esHoyMismo, currentTotalMins } = calcularTurnoObjetivo(
        diasSemanaRef.current
      );

      const diaNombre = diasSemanaMap[targetDate.getDay()] || '';
      const diaNum = targetDate.getDate();
      const mesNombre = mesesMap[targetDate.getMonth()] || '';

      setShiftDateLabel(`${diaNombre} — ${diaNum} DE ${mesNombre}`);
      setShiftBlockLabel(targetBlock);

      const y = targetDate.getFullYear();
      const m = targetDate.getMonth();
      const d = targetDate.getDate();

      const startOfDay = new Date(Date.UTC(y, m, d, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));

      const [snapClientes, snapSesiones] = await Promise.all([
        getDocs(collection(db, 'clientes')),
        getDocs(
          query(
            collection(db, 'agenda_sesiones'),
            where('fecha_hora_inicio', '>=', startOfDay),
            where('fecha_hora_inicio', '<=', endOfDay)
          )
        )
      ]);

      const clientesMap: Record<string, string> = {};
      snapClientes.forEach(docC => {
        const data = docC.data();
        const nombre =
          data.Alias || data.alias || data.Nombre_Cliente || data.nombre_completo || 'Sin nombre';
        clientesMap[docC.id] = nombre;
      });

      const sesionesCandidatas: any[] = [];
      snapSesiones.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.fecha_hora_inicio) return;
        if (esSesionCompletada(data) || esSesionCancelada(data)) return;

        const tipo = (data.tipo_sesion || '').toLowerCase();
        if (tipo.includes('small') || tipo.includes('group')) return;

        const fecha = data.fecha_hora_inicio.toDate
          ? data.fecha_hora_inicio.toDate()
          : new Date(data.fecha_hora_inicio);
        const hora = fecha.getUTCHours();
        const minutos = fecha.getUTCMinutes();
        const sesionStartMins = hora * 60 + minutos;

        if (targetBlock === 'MAÑANA' && hora >= 14) return;
        if (targetBlock === 'TARDE' && hora < 14) return;

        // No mostrar sesiones que empezaron hace más de 2h 30m ni posteriores a 30 minutos desde la hora actual (solo aplica en el día en curso)
        if (esHoyMismo) {
          if (currentTotalMins - sesionStartMins > 150) return;
          if (sesionStartMins - currentTotalMins > 30) return;
        }

        const idCli = data.id_cliente;
        const nombreCliente =
          (idCli && clientesMap[idCli]) || data.cliente_nombre || 'Cliente';
        const timeStr = `${hora.toString().padStart(2, '0')}:${minutos
          .toString()
          .padStart(2, '0')}`;

        sesionesCandidatas.push({
          id: docSnap.id,
          ...data,
          fecha,
          nombreCliente,
          timeStr
        });
      });

      sesionesCandidatas.sort((a, b) => {
        const diff = a.fecha.getTime() - b.fecha.getTime();
        if (diff !== 0) return diff;
        return (a.nombreCliente || '').localeCompare(b.nombreCliente || '');
      });

      setSesionesActivas(sesionesCandidatas.slice(0, 12));
    } catch (e) {
      console.error('Error actualizando Pantalla Sala:', e);
    }
  }, []);

  const aplicarMaestros = useCallback(async () => {
    try {
      const maestros = await cargarCatalogoMaestros();
      const bloques = extraerListaMaster(maestros, 'Ejercicios', [
        'Bloque de la sesión en que se recomienda',
        'Bloque de recomendación'
      ]);
      if (bloques.length > 0) setOrdenBloques(bloques);

      const dias = extraerListaMaster(maestros, 'Agenda', [
        'Días de la semana',
        'Dias de la semana'
      ]);
      if (dias.length > 0) {
        diasSemanaRef.current = dias;
      }
    } catch (e) {
      console.warn('Error cargando maestros en pantalla_sala:', e);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await aplicarMaestros();
      await actualizarPantallaSala();
    };
    init();

    const interval = setInterval(actualizarPantallaSala, 60000);
    return () => clearInterval(interval);
  }, [aplicarMaestros, actualizarPantallaSala]);

  useEffect(() => {
    return onCatalogoMaestrosChanged(() => {
      aplicarMaestros();
    });
  }, [aplicarMaestros]);

  const handleCloseOrLogout = async () => {
    if (isProyector) {
      await logout();
    } else {
      onBack();
    }
  };

  const renderFilaEjercicioSala = (ej: any, keyStr: string) => {
    const acronimo = ej.Acrónimo || ej.alias || ej.Nombre_Ejercicio || 'EJ';
    const detallesArr: string[] = [];
    if (ej.Detalle && String(ej.Detalle).trim() !== '') detallesArr.push(ej.Detalle);
    if (ej.Material_Adaptacion && String(ej.Material_Adaptacion).trim() !== '') {
      detallesArr.push(ej.Material_Adaptacion);
    }

    let prescTxt = ej.Series || '';
    if (ej.Peso && String(ej.Peso).trim() !== '') {
      prescTxt += (prescTxt ? ' · ' : '') + `${ej.Peso}`;
    }

    return (
      <div key={keyStr} className="sala-ex-row">
        <span className="sala-ex-name">
          • {acronimo}
          {detallesArr.length > 0 && (
            <span className="sala-ex-detail"> - {detallesArr.join(' · ')}</span>
          )}
        </span>
        {prescTxt && <span className="sala-ex-presc">{prescTxt}</span>}
      </div>
    );
  };

  const renderTarjetaSala = (s: any) => {
    const tieneEjercicios = Array.isArray(s.ejercicios) && s.ejercicios.length > 0;
    const bloquesSecuenciales: { nombre: string; ejercicios: any[] }[] = [];

    if (tieneEjercicios) {
      let listaEj = [...s.ejercicios];
      if (!s.orden_customizado) {
        listaEj.sort((a, b) => {
          const bA = a.Bloque || 'General';
          const bB = b.Bloque || 'General';
          const idxA = ordenBloques.indexOf(bA);
          const idxB = ordenBloques.indexOf(bB);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return bA.localeCompare(bB);
        });
      }

      listaEj.forEach(ej => {
        const b = ej.Bloque || 'Ejercicios';
        const ultimo = bloquesSecuenciales[bloquesSecuenciales.length - 1];
        if (!ultimo || ultimo.nombre !== b) {
          bloquesSecuenciales.push({ nombre: b, ejercicios: [ej] });
        } else {
          ultimo.ejercicios.push(ej);
        }
      });
    }

    return (
      <div
        key={s.id}
        className={`sala-card ${tieneEjercicios ? 'has-exercises' : ''}`}
      >
        <div className="sala-card-header">
          <span className="sala-client-name" title={s.nombreCliente}>
            {s.nombreCliente}
          </span>
          <div className="sala-header-badges">
            <span className="sala-card-time">{s.timeStr}</span>
          </div>
        </div>
        <div className="sala-card-body">
          {!tieneEjercicios ? (
            <div className="sala-no-exercises">Sin ejercicios pautados</div>
          ) : (
            bloquesSecuenciales.map((grupoBloque, bIdx) => {
              const itemsRender: {
                esSubgrupo: boolean;
                nombre?: string;
                pauta?: string;
                ejercicios: any[];
              }[] = [];

              grupoBloque.ejercicios.forEach(ej => {
                const sub =
                  ej.Subgrupo && String(ej.Subgrupo).trim() !== ''
                    ? String(ej.Subgrupo).trim()
                    : null;
                const pauta =
                  ej.Subgrupo_Series && String(ej.Subgrupo_Series).trim() !== ''
                    ? String(ej.Subgrupo_Series).trim()
                    : '';
                if (sub) {
                  const ultimo = itemsRender[itemsRender.length - 1];
                  if (ultimo && ultimo.esSubgrupo && ultimo.nombre === sub) {
                    ultimo.ejercicios.push(ej);
                    if (!ultimo.pauta && pauta) ultimo.pauta = pauta;
                  } else {
                    itemsRender.push({
                      esSubgrupo: true,
                      nombre: sub,
                      pauta,
                      ejercicios: [ej]
                    });
                  }
                } else {
                  itemsRender.push({ esSubgrupo: false, ejercicios: [ej] });
                }
              });

              return (
                <div key={bIdx} className="sala-block">
                  <div className="sala-block-title">
                    {grupoBloque.nombre.replace(/BLOQUE \d+: /i, '')}
                  </div>
                  {itemsRender.map((item, iIdx) =>
                    item.esSubgrupo ? (
                      <div key={iIdx} className="sala-subgrupo">
                        <div className="sala-subgrupo-header">
                          <span className="sala-subgrupo-title">
                            <span className="ui-icon">🔄</span>
                            <span>{item.nombre}</span>
                          </span>
                          {item.pauta && (
                            <span className="sala-subgrupo-reps">{item.pauta}</span>
                          )}
                        </div>
                        {item.ejercicios.map((ej, eIdx) =>
                          renderFilaEjercicioSala(ej, `${bIdx}-${iIdx}-${eIdx}`)
                        )}
                      </div>
                    ) : (
                      renderFilaEjercicioSala(item.ejercicios[0], `${bIdx}-${iIdx}`)
                    )
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const count = sesionesActivas.length;
  const { cols, rows, capacity, compact } = getLayoutDimensions(count);
  const emptyCount = Math.max(0, capacity - count);

  return (
    <div className="sala-fullscreen-wrap">
      <header className="sala-header">
        <div className="sala-brand">
          <img src="/assets/logo.png" alt="GO & train" />
          <span className="sala-brand-badge">PANTALLA SALA</span>
        </div>

        <div className="sala-shift-info">
          <span>{shiftDateLabel}</span>
          <span>—</span>
          <span className="sala-shift-pill">{shiftBlockLabel}</span>
        </div>

        <div className="sala-actions">
          <button
            type="button"
            className="btn-volver-sala"
            onClick={handleCloseOrLogout}
            style={
              isProyector
                ? { color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }
                : undefined
            }
          >
            {isProyector ? (
              <>
                <span className="ui-icon">⏻</span>
                <span>Cerrar Sesión</span>
              </>
            ) : (
              <>
                <span className="ui-icon">✕</span>
                <span>Cerrar Sala</span>
              </>
            )}
          </button>
        </div>
      </header>

      <main
        className={`sala-board ${compact ? 'density-compact' : ''}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
        }}
      >
        {sesionesActivas.map(s => renderTarjetaSala(s))}
        {Array.from({ length: emptyCount }).map((_, idx) => (
          <div key={`empty-${idx}`} className="sala-card empty-slot" title="Puesto disponible">
            <div className="empty-slot-watermark">
              <img src="/assets/logo.png" alt="GO & train" className="empty-slot-logo" />
            </div>
          </div>
        ))}
      </main>

      {/* Vídeo oculto en reproducción continua para impedir el reposo o protector de pantalla en Smart TVs */}
      <video
        ref={keepAwakeVideoRef}
        className="tv-keep-awake-video"
        muted
        loop
        playsInline
        autoPlay
        aria-hidden="true"
        src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjc5NSA2YThhOWI2IC0gSC4yNjQvTVBFRy00 AVCIGNvZGVjIC0gQ29weXJpZ2h0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwcyk9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTYgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfHlyaW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCB2YnZfbWF4cmF0ZT0wIHZidl9idWZzaXplPTAgY3JmX21heD0wLjAgbmFsX2hyZD1ub25lIGZpbGxlcj0wIGlwX3JhdGlvPTEuNDAgYXE9MToxLjAw"
      />
    </div>
  );
};
