import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  cargarCatalogoMaestros,
  extraerListaMaster
} from '../services/maestrosService';

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

function calcularTurnoObjetivo() {
  const now = new Date();
  const currentTotalMins = now.getHours() * 60 + now.getMinutes();

  const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let targetBlock: 'MAÑANA' | 'TARDE' = 'MAÑANA';
  let avanzarSiguienteDiaHabil = false;

  if (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
    avanzarSiguienteDiaHabil = true;
    targetBlock = 'MAÑANA';
  } else if (currentTotalMins >= 21 * 60) {
    avanzarSiguienteDiaHabil = true;
    targetBlock = 'MAÑANA';
  } else if (currentTotalMins >= 15 * 60 + 30) {
    targetBlock = 'TARDE';
  } else {
    targetBlock = 'MAÑANA';
  }

  if (avanzarSiguienteDiaHabil) {
    targetDate.setDate(targetDate.getDate() + 1);
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
  }

  const esHoyMismo =
    targetDate.getFullYear() === now.getFullYear() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getDate() === now.getDate();

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
  const [sesionesActivas, setSesionesActivas] = useState<any[]>([]);
  const [shiftDateLabel, setShiftDateLabel] = useState('CARGANDO...');
  const [shiftBlockLabel, setShiftBlockLabel] = useState('TURNO');

  const actualizarPantallaSala = useCallback(async () => {
    try {
      const { targetDate, targetBlock, esHoyMismo, currentTotalMins } = calcularTurnoObjetivo();

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
        if (data.estado_sesion === 'Completada' || data.estado_sesion === 'Cancelada') return;

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

        if (esHoyMismo && currentTotalMins - sesionStartMins > 150) return;

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

  useEffect(() => {
    const init = async () => {
      try {
        const maestros = await cargarCatalogoMaestros();
        const bloques = extraerListaMaster(maestros, 'Ejercicios', [
          'Bloque de la sesión en que se recomienda',
          'Bloque de recomendación'
        ]);
        if (bloques.length > 0) setOrdenBloques(bloques);
      } catch (e) {
        console.warn('Error cargando maestros en pantalla_sala:', e);
      }
      await actualizarPantallaSala();
    };
    init();

    const interval = setInterval(actualizarPantallaSala, 60000);
    return () => clearInterval(interval);
  }, [actualizarPantallaSala]);

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
                          <span className="sala-subgrupo-title">🔄 {item.nombre}</span>
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
            {isProyector ? '⏻ Cerrar Sesión' : '✕ Cerrar Sala'}
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
    </div>
  );
};
