import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, where, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { updateDoc, addDoc } from '../services/offlineSyncService';
import { cargarCatalogoMaestros, extraerListaMaster } from '../services/maestrosService';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';
import { normalizarIntensidad, esSesionCompletada, parsearFechaFirestore } from '../utils/helpers';
import {
  revertirVencimientosAutomaticos,
  procesarCaducidadSesionesSinFechaPorMeses,
  limpiarSesionesAntiguasYEjerciciosHuerfanos
} from '../services/sessionCascadeService';

interface PlanificacionViewProps {
  onNavigate: (tab: string, param?: string) => void;
}

const diasSemanaMap: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  0: 'Domingo'
};

export const PlanificacionView: React.FC<PlanificacionViewProps> = ({ onNavigate }) => {
  const { hasPermission } = useAuth();
  const { pushAction, registerChangeListener } = useUndo();

  const puedeEditarEstadoSesion = hasPermission('planificacion', 'editar');
  const puedeProgramarSesiones = hasPermission('programar_sesiones', 'ver') && hasPermission('programar_sesiones', 'editar');
  const puedeVerClientes = hasPermission('clientes', 'ver');
  const puedeVerEjercicios = hasPermission('ejercicios', 'ver');
  const puedeVerPantallaSala = hasPermission('pantalla_sala', 'ver');
  const puedeRegistrarPR = hasPermission('progreso_pr', 'crear') || hasPermission('progreso_pr', 'editar');

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    try {
      const saved = sessionStorage.getItem('gym_planificacion_date');
      if (saved) {
        const parsed = new Date(saved);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    } catch {
      // Fallback below
    }
    const d = new Date();
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    else if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    return d;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('gym_planificacion_date', currentDate.toISOString());
    } catch {
      // Ignore storage errors
    }
  }, [currentDate]);

  const [ordenBloques, setOrdenBloques] = useState<string[]>([
    'BLOQUE 1: MOVILIDAD - ACTIVACIÓN',
    'BLOQUE 2: FUERZA - PRINCIPAL',
    'BLOQUE 3: COMPENSATORIO - ACCESORIO',
    'BLOQUE 4: METABÓLICO - ACONDICIONAMIENTO'
  ]);
  const [diasSemanaPills, setDiasSemanaPills] = useState<string[]>([
    'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'
  ]);
  const [rangoManana, setRangoManana] = useState('08:00-12:30');
  const [rangoTarde, setRangoTarde] = useState('16:00-20:30');

  const [clientesMap, setClientesMap] = useState<Record<string, string>>({});
  const [sesionesRaw, setSesionesRaw] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [openManana, setOpenManana] = useState<boolean>(() => new Date().getHours() < 14);
  const [openTarde, setOpenTarde] = useState<boolean>(() => new Date().getHours() >= 14);
  const [openMananaNoComp, setOpenMananaNoComp] = useState<boolean>(true);
  const [openMananaComp, setOpenMananaComp] = useState<boolean>(false);
  const [openTardeNoComp, setOpenTardeNoComp] = useState<boolean>(true);
  const [openTardeComp, setOpenTardeComp] = useState<boolean>(false);
  const [openSG, setOpenSG] = useState<boolean>(true);

  // Modal PR state
  const [modalPR, setModalPR] = useState<{
    open: boolean;
    idCli: string;
    idEj: string;
    nomEj: string;
    peso: string;
    saving: boolean;
  }>({
    open: false,
    idCli: '',
    idEj: '',
    nomEj: '',
    peso: '',
    saving: false
  });

  useEffect(() => {
    const init = async () => {
      try {
        const maestros = await cargarCatalogoMaestros();
        const bloques = extraerListaMaster(maestros, 'Ejercicios', [
          'Bloque de la sesión en que se recomienda',
          'Bloque de recomendación'
        ]);
        if (bloques.length > 0) setOrdenBloques(bloques);

        const dias = extraerListaMaster(maestros, 'Agenda', ['Días de la semana', 'Dias de la semana']);
        if (dias.length > 0) setDiasSemanaPills(dias);

        const horariosInd = extraerListaMaster(maestros, 'Agenda', ['Horarios Sesiones Individuales']);
        if (horariosInd.length > 0) {
          const man = horariosInd.filter(h => parseInt(h.split(':')[0], 10) < 14).sort();
          const tar = horariosInd.filter(h => parseInt(h.split(':')[0], 10) >= 14).sort();
          if (man.length > 0) setRangoManana(`${man[0]}-${man[man.length - 1]}`);
          if (tar.length > 0) setRangoTarde(`${tar[0]}-${tar[tar.length - 1]}`);
        }
      } catch (e) {
        console.warn('Error cargando maestros en planificación:', e);
      }

      try {
        const snapClientes = await getDocs(collection(db, 'clientes'));
        const map: Record<string, string> = {};
        snapClientes.forEach(d => {
          const data = d.data();
          const nombre =
            (data.Alias && String(data.Alias).trim() !== '' ? data.Alias : '') ||
            data.alias ||
            data.Nombre_Cliente ||
            data.nombre_completo ||
            'Sin nombre';
          map[d.id] = nombre;
          if (data.ID_Cliente) {
            map[data.ID_Cliente] = nombre;
          }
        });
        setClientesMap(map);
      } catch (e) {
        console.error('Error cargando clientes:', e);
      }
    };
    init();
  }, []);

  const fetchDaySessions = useCallback(async () => {
    setLoading(true);
    try {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await revertirVencimientosAutomaticos();
        await limpiarSesionesAntiguasYEjerciciosHuerfanos();
        await procesarCaducidadSesionesSinFechaPorMeses();
      }
      const y = currentDate.getFullYear();
      const m = currentDate.getMonth();
      const d = currentDate.getDate();

      const startOfDay = new Date(Date.UTC(y, m, d, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));

      const q = query(
        collection(db, 'agenda_sesiones'),
        where('fecha_hora_inicio', '>=', startOfDay),
        where('fecha_hora_inicio', '<=', endOfDay)
      );

      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const fecha = parsearFechaFirestore(data.fecha_hora_inicio);
        if (!fecha) return;
        list.push({ id: docSnap.id, ...data, fecha });
      });

      list.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      setSesionesRaw(list);
    } catch (e) {
      console.error('Error al cargar sesiones del día:', e);
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    fetchDaySessions();
  }, [fetchDaySessions]);

  useEffect(() => {
    return registerChangeListener(() => {
      fetchDaySessions();
    });
  }, [registerChangeListener, fetchDaySessions]);

  const handleChangeDay = (offset: number) => {
    setCurrentDate(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + offset);
      if (next.getDay() === 6) {
        next.setDate(next.getDate() + (offset > 0 ? 2 : -1));
      } else if (next.getDay() === 0) {
        next.setDate(next.getDate() + (offset > 0 ? 1 : -2));
      }
      return next;
    });
  };

  const handleSelectDayOfWeek = (targetDay: number) => {
    setCurrentDate(prev => {
      const next = new Date(prev);
      let currentDay = next.getDay();
      if (currentDay === 0) currentDay = 7;
      const diff = targetDay - currentDay;
      next.setDate(next.getDate() + diff);
      return next;
    });
  };

  const handleToggleStatus = async (e: React.MouseEvent, sesion: any) => {
    e.stopPropagation();
    if (!puedeEditarEstadoSesion) return;
    const isCompleted = esSesionCompletada(sesion);
    const nextStatus = isCompleted ? 'Pendiente' : 'Completada';
    const nextManual = nextStatus === 'Pendiente';
    const prevEstado = sesion.estado || sesion.estado_sesion || 'Pendiente';
    const prevManual = Boolean(sesion.pendiente_manual);
    try {
      await updateDoc(doc(db, 'agenda_sesiones', sesion.id), {
        estado: nextStatus,
        estado_sesion: nextStatus,
        pendiente_manual: nextManual
      });
      setSesionesRaw(prev =>
        prev.map(s =>
          s.id === sesion.id
            ? { ...s, estado: nextStatus, estado_sesion: nextStatus, pendiente_manual: nextManual }
            : s
        )
      );
      pushAction({
        label: `Marcar sesión de ${sesion.nombreCliente || 'Cliente'} como ${nextStatus}`,
        undoOps: [
          {
            type: 'update',
            collection: 'agenda_sesiones',
            id: sesion.id,
            data: {
              estado: prevEstado,
              estado_sesion: prevEstado,
              pendiente_manual: prevManual
            }
          }
        ],
        redoOps: [
          {
            type: 'update',
            collection: 'agenda_sesiones',
            id: sesion.id,
            data: {
              estado: nextStatus,
              estado_sesion: nextStatus,
              pendiente_manual: nextManual
            }
          }
        ],
        showToast: true,
        toastMessage:
          nextStatus === 'Completada'
            ? `🟢 Sesión de ${sesion.nombreCliente || 'Cliente'} marcada como Completada`
            : `⚪ Sesión de ${sesion.nombreCliente || 'Cliente'} devuelta a Pendiente`
      });
    } catch (err) {
      console.error('Error cambiando estado:', err);
      alert('No se pudo actualizar el estado de la sesión.');
    }
  };

  const handleConfirmPR = async () => {
    const pesoNum = parseFloat(modalPR.peso);
    if (isNaN(pesoNum) || pesoNum <= 0) {
      alert('Introduce un peso válido.');
      return;
    }
    setModalPR(prev => ({ ...prev, saving: true }));
    try {
      await addDoc(collection(db, 'progreso_clientes'), {
        id_cliente: modalPR.idCli,
        id_ejercicio: modalPR.idEj,
        nombre_ejercicio: modalPR.nomEj,
        peso_levantado: pesoNum,
        fecha: new Date()
      });
      setModalPR({ open: false, idCli: '', idEj: '', nomEj: '', peso: '', saving: false });
      alert(`¡Nuevo PR de ${pesoNum} kg registrado con éxito!`);
    } catch (e) {
      console.error(e);
      alert('Error al guardar el récord.');
      setModalPR(prev => ({ ...prev, saving: false }));
    }
  };

  // Grouping sessions
  const sesionesManana: any[] = [];
  const sesionesTarde: any[] = [];
  const smallGroupsMap: Record<string, { idCli: string; nomCli: string }[]> = {};

  sesionesRaw.forEach(s => {
    const idCliente = s.id_cliente || s.ID_Cliente || '';
    const nombreCliente =
      (idCliente && clientesMap[idCliente]) ||
      s.Alias ||
      s.alias ||
      s.Nombre_Cliente ||
      s.nombre_cliente ||
      s.cliente_nombre ||
      'Sin nombre';
    const tipo = (s.tipo_sesion || '').toLowerCase();
    const hora = s.fecha.getUTCHours();
    const minutos = s.fecha.getUTCMinutes().toString().padStart(2, '0');
    const timeStr = `${hora.toString().padStart(2, '0')}:${minutos}`;

    if (tipo.includes('small') || tipo.includes('group')) {
      const endHora = (hora + 1).toString().padStart(2, '0');
      const rangeStr = `${timeStr}-${endHora}:${minutos}`;
      if (!smallGroupsMap[rangeStr]) smallGroupsMap[rangeStr] = [];
      const yaExiste = smallGroupsMap[rangeStr].some(
        c => (idCliente && c.idCli === idCliente) || c.nomCli === nombreCliente
      );
      if (!yaExiste) {
        smallGroupsMap[rangeStr].push({ idCli: idCliente || '', nomCli: nombreCliente });
      }
    } else {
      const item = { ...s, id_cliente: idCliente, nombreCliente, timeStr };
      if (hora < 14) sesionesManana.push(item);
      else sesionesTarde.push(item);
    }
  });

  const sesionesMananaNoComp = sesionesManana.filter(s => !esSesionCompletada(s));
  const sesionesMananaComp = sesionesManana.filter(s => esSesionCompletada(s));
  const sesionesTardeNoComp = sesionesTarde.filter(s => !esSesionCompletada(s));
  const sesionesTardeComp = sesionesTarde.filter(s => esSesionCompletada(s));

  const sgTimeRanges = Object.keys(smallGroupsMap);
  const totalSesiones = sesionesManana.length + sesionesTarde.length + sgTimeRanges.length;

  const nowLocal = new Date();
  const startOfTodayUTC = new Date(
    Date.UTC(
      nowLocal.getFullYear(),
      nowLocal.getMonth(),
      nowLocal.getDate(),
      0,
      0,
      0,
      0
    )
  );

  const renderCard = (s: any) => {
    const isCompleted = esSesionCompletada(s);
    const isOverdue = !isCompleted && s.fecha < startOfTodayUTC;

    let statusClass = 'status';
    let statusContent = '⚪ Pendiente';
    if (isCompleted) {
      statusClass = 'status completed';
      statusContent = '🟢 Completada';
    } else if (isOverdue) {
      statusClass = 'status overdue';
      statusContent = '🔴 Vencida';
    }

    const tieneEjercicios = Array.isArray(s.ejercicios) && s.ejercicios.length > 0;

    // Build sequential blocks
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

    const renderFilaEjercicio = (ej: any, idxKey: string) => {
      const acronimo = ej.Acrónimo || ej.alias || ej.Nombre_Ejercicio || 'EJ';
      const nombreFull = ej.Nombre_Ejercicio || acronimo;

      const detallesArr: string[] = [];
      if (ej.Detalle && String(ej.Detalle).trim() !== '') detallesArr.push(ej.Detalle);
      if (ej.Material_Adaptacion && String(ej.Material_Adaptacion).trim() !== '') {
        detallesArr.push(ej.Material_Adaptacion);
      }

      const iconoProgreso = ej.guardar_progreso ? (
        <span title="Ejercicio en seguimiento de progreso" style={{ fontSize: '0.75rem', marginLeft: 3 }}>
          📈
        </span>
      ) : null;

      let repsTxt = ej.Series || '';
      if (ej.Peso && String(ej.Peso).trim() !== '') {
        repsTxt += (repsTxt ? ' · ' : '') + `⚖️ ${ej.Peso}`;
      }
      const intEj = normalizarIntensidad(ej.intensidad || ej.Intensidad || 'MED');
      const intBadge = intEj !== 'MED' ? (
        <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#475569' }}> · {intEj}</span>
      ) : null;

      const idCli = s.id_cliente || '';
      const idEj = ej.id_ejercicio || '';

      return (
        <div key={idxKey}>
          <div className="preview-ex">
            <span>
              •{' '}
              {idEj && puedeVerEjercicios ? (
                <a
                  href={`#ficha_ejercicio/${idEj}`}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNavigate('ficha_ejercicio', idEj);
                  }}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  onMouseOver={e => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseOut={e => (e.currentTarget.style.textDecoration = 'none')}
                >
                  {acronimo}
                  {detallesArr.length > 0 && (
                    <i style={{ color: '#64748b', fontWeight: 'normal' }}>
                      {' '}
                      - {detallesArr.join(' · ')}
                    </i>
                  )}
                </a>
              ) : (
                <>
                  {acronimo}
                  {detallesArr.length > 0 && (
                    <i style={{ color: '#64748b', fontWeight: 'normal' }}>
                      {' '}
                      - {detallesArr.join(' · ')}
                    </i>
                  )}
                </>
              )}
              {iconoProgreso}
            </span>
            <span className="preview-ex-reps">
              {repsTxt}
              {intBadge}
            </span>
          </div>
          {ej.guardar_progreso && puedeRegistrarPR && (
            <div style={{ textAlign: 'right', marginBottom: 6, marginTop: -2 }}>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setModalPR({
                    open: true,
                    idCli,
                    idEj,
                    nomEj: nombreFull,
                    peso: '',
                    saving: false
                  });
                }}
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                  borderRadius: 4,
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                📈 Registrar PR
              </button>
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        key={s.id}
        className="card"
        style={{ cursor: s.id_cliente && puedeVerClientes ? 'pointer' : 'default' }}
        onClick={() => {
          if (s.id_cliente && puedeVerClientes) onNavigate('ficha_cliente', s.id_cliente);
        }}
      >
        <div className="card-header">
          <span>
            {s.id_cliente && puedeVerClientes ? (
              <a
                href={`#ficha_cliente/${s.id_cliente}`}
                className="client-link"
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigate('ficha_cliente', s.id_cliente);
                }}
              >
                {s.nombreCliente}
              </a>
            ) : (
              s.nombreCliente
            )}
          </span>
          <span className="card-time">🕒 {s.timeStr}</span>
        </div>

        <div className={`card-body ${tieneEjercicios ? 'has-data' : ''}`}>
          {!tieneEjercicios ? (
            'Sin ejercicios asignados'
          ) : (
            bloquesSecuenciales.map((grupoBloque, bIdx) => {
              const itemsRender: {
                esSubgrupo: boolean;
                nombre?: string;
                pauta?: string;
                ejercicios: any[];
              }[] = [];

              grupoBloque.ejercicios.forEach(ej => {
                const sub = ej.Subgrupo && String(ej.Subgrupo).trim() !== '' ? String(ej.Subgrupo).trim() : null;
                const pauta = ej.Subgrupo_Series && String(ej.Subgrupo_Series).trim() !== '' ? String(ej.Subgrupo_Series).trim() : '';
                if (sub) {
                  const ultimo = itemsRender[itemsRender.length - 1];
                  if (ultimo && ultimo.esSubgrupo && ultimo.nombre === sub) {
                    ultimo.ejercicios.push(ej);
                    if (!ultimo.pauta && pauta) ultimo.pauta = pauta;
                  } else {
                    itemsRender.push({ esSubgrupo: true, nombre: sub, pauta, ejercicios: [ej] });
                  }
                } else {
                  itemsRender.push({ esSubgrupo: false, ejercicios: [ej] });
                }
              });

              return (
                <div key={bIdx} className="preview-block">
                  <div className="preview-title">
                    {grupoBloque.nombre.replace(/BLOQUE \d+: /i, '')}
                  </div>
                  {itemsRender.map((item, iIdx) =>
                    item.esSubgrupo ? (
                      <div key={iIdx} className="preview-subgrupo">
                        <div className="subgrupo-header">
                          <span className="subgrupo-title">🔄 {item.nombre}</span>
                          {item.pauta && <span className="subgrupo-reps">{item.pauta}</span>}
                        </div>
                        {item.ejercicios.map((ej, eIdx) =>
                          renderFilaEjercicio(ej, `${bIdx}-${iIdx}-${eIdx}`)
                        )}
                      </div>
                    ) : (
                      renderFilaEjercicio(item.ejercicios[0], `${bIdx}-${iIdx}`)
                    )
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="card-footer">
          <div
            className={statusClass}
            style={{ cursor: puedeEditarEstadoSesion ? 'pointer' : 'default' }}
            onClick={e => handleToggleStatus(e, s)}
            title={puedeEditarEstadoSesion ? 'Haz clic para cambiar estado' : ''}
          >
            {statusContent}
          </div>
          {puedeProgramarSesiones && (
            <a
              href={`#programar_sesion/${s.id}`}
              className="link"
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                onNavigate('programar_sesion', s.id);
              }}
            >
              + Añadir Ejercicio
            </a>
          )}
        </div>
      </div>
    );
  };

  const diaNum = currentDate.getDate().toString().padStart(2, '0');
  const mesNum = (currentDate.getMonth() + 1).toString().padStart(2, '0');
  const diaSemanaIndex = currentDate.getDay();
  const diaNombre = diasSemanaMap[diaSemanaIndex] || '';

  return (
    <div className="container">
      <div className="page-header">
        <h1>
          <span className="desktop-text">Entrenamientos · Visión de Día</span>
          <span className="mobile-text">Entrenamientos</span>
        </h1>
        {puedeVerPantallaSala && (
          <button
            type="button"
            className="btn-pantalla-sala"
            onClick={() => onNavigate('pantalla_sala')}
            title="Abrir vista optimizada para proyector de sala"
          >
            📺 <span className="desktop-text">Pantalla Sala</span>
            <span className="mobile-text">Sala</span>
          </button>
        )}
      </div>

      <div className="date-bar">
        <div className="date-selector">
          <button type="button" className="nav-arrow" onClick={() => handleChangeDay(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="date-calendar-icon" style={{ fontSize: '1.2rem' }}>📅</span>
          <div className="date-info">
            <strong>{`${diaNombre.toUpperCase()} · ${diaNum}/${mesNum}`}</strong>
            <span>
              {loading
                ? 'Cargando...'
                : (
                  <>
                    <span className="desktop-text">{`${totalSesiones} ${totalSesiones === 1 ? 'sesión programada' : 'sesiones programadas'}`}</span>
                    <span className="mobile-text">{`${totalSesiones} ${totalSesiones === 1 ? 'sesión' : 'sesiones'}`}</span>
                  </>
                )}
            </span>
          </div>
          <button type="button" className="nav-arrow" onClick={() => handleChangeDay(1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="day-pills">
          {diasSemanaPills.map((dNom, idx) => {
            const dNum = idx + 1;
            const isActive = diaSemanaIndex === dNum;
            const inicialesMap: Record<string, string> = {
              lunes: 'L',
              martes: 'M',
              miércoles: 'X',
              miercoles: 'X',
              jueves: 'J',
              viernes: 'V',
              sábado: 'S',
              sabado: 'S',
              domingo: 'D'
            };
            const inicial = inicialesMap[dNom.trim().toLowerCase()] || dNom.charAt(0).toUpperCase();

            return (
              <button
                key={dNom}
                type="button"
                className={`plan-day-pill ${isActive ? 'active' : ''}`}
                onClick={() => handleSelectDayOfWeek(dNum)}
                title={dNom}
              >
                <span className="desktop-text">{dNom}</span>
                <span className="mobile-text">{inicial}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mañana */}
      <div className="section-header" onClick={() => setOpenManana(!openManana)}>
        <div className="section-title">
          <h2>Mañana</h2>
          <span>{`${rangoManana} · ${sesionesManana.length} sesiones (${sesionesMananaNoComp.length} no completadas · ${sesionesMananaComp.length} completadas)`}</span>
        </div>
        <span
          className="chevron-icon"
          style={{ transform: openManana ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {openManana && (
        <div className="section-content">
          {sesionesManana.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
              No hay sesiones individuales por la mañana.
            </div>
          ) : (
            <>
              <div className="subsection-group">
                <div
                  className="subsection-header"
                  onClick={() => setOpenMananaNoComp(!openMananaNoComp)}
                >
                  <div className="subsection-title">
                    <span>⚪ No completadas</span>
                    <span className="subsection-count">{sesionesMananaNoComp.length}</span>
                  </div>
                  <span
                    className="chevron-icon"
                    style={{ transform: openMananaNoComp ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
                {openMananaNoComp && (
                  <div className="subsection-body">
                    {sesionesMananaNoComp.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', paddingLeft: 6 }}>
                        Todas las sesiones de la mañana están completadas.
                      </div>
                    ) : (
                      <div className="cards-grid">
                        {sesionesMananaNoComp.map(s => renderCard(s))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="subsection-group">
                <div
                  className="subsection-header completed-group"
                  onClick={() => setOpenMananaComp(!openMananaComp)}
                >
                  <div className="subsection-title">
                    <span>🟢 Completadas</span>
                    <span className="subsection-count">{sesionesMananaComp.length}</span>
                  </div>
                  <span
                    className="chevron-icon"
                    style={{ transform: openMananaComp ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
                {openMananaComp && (
                  <div className="subsection-body">
                    {sesionesMananaComp.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', paddingLeft: 6 }}>
                        Aún no hay sesiones completadas por la mañana.
                      </div>
                    ) : (
                      <div className="cards-grid">
                        {sesionesMananaComp.map(s => renderCard(s))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tarde */}
      <div className="section-header" onClick={() => setOpenTarde(!openTarde)}>
        <div className="section-title">
          <h2>Tarde</h2>
          <span>{`${rangoTarde} · ${sesionesTarde.length} sesiones (${sesionesTardeNoComp.length} no completadas · ${sesionesTardeComp.length} completadas)`}</span>
        </div>
        <span
          className="chevron-icon"
          style={{ transform: openTarde ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {openTarde && (
        <div className="section-content">
          {sesionesTarde.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
              No hay sesiones individuales por la tarde.
            </div>
          ) : (
            <>
              <div className="subsection-group">
                <div
                  className="subsection-header"
                  onClick={() => setOpenTardeNoComp(!openTardeNoComp)}
                >
                  <div className="subsection-title">
                    <span>⚪ No completadas</span>
                    <span className="subsection-count">{sesionesTardeNoComp.length}</span>
                  </div>
                  <span
                    className="chevron-icon"
                    style={{ transform: openTardeNoComp ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
                {openTardeNoComp && (
                  <div className="subsection-body">
                    {sesionesTardeNoComp.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', paddingLeft: 6 }}>
                        Todas las sesiones de la tarde están completadas.
                      </div>
                    ) : (
                      <div className="cards-grid">
                        {sesionesTardeNoComp.map(s => renderCard(s))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="subsection-group">
                <div
                  className="subsection-header completed-group"
                  onClick={() => setOpenTardeComp(!openTardeComp)}
                >
                  <div className="subsection-title">
                    <span>🟢 Completadas</span>
                    <span className="subsection-count">{sesionesTardeComp.length}</span>
                  </div>
                  <span
                    className="chevron-icon"
                    style={{ transform: openTardeComp ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
                {openTardeComp && (
                  <div className="subsection-body">
                    {sesionesTardeComp.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', paddingLeft: 6 }}>
                        Aún no hay sesiones completadas por la tarde.
                      </div>
                    ) : (
                      <div className="cards-grid">
                        {sesionesTardeComp.map(s => renderCard(s))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Small Groups */}
      <div className="section-header" onClick={() => setOpenSG(!openSG)}>
        <div className="section-title">
          <h2>Small Groups</h2>
          <span>{`${sgTimeRanges.length} sesiones`}</span>
        </div>
        <span
          className="chevron-icon"
          style={{ transform: openSG ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {openSG && (
        <div className="section-content">
          <div className="cards-grid">
            {sgTimeRanges.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No hay Small Groups programados hoy.
              </div>
            ) : (
              sgTimeRanges.map(rango => {
                const clients = smallGroupsMap[rango];
                return (
                  <div key={rango} className="sg-card">
                    <div className="sg-time">🕒 {rango}</div>
                    <div className="sg-clients">
                      {clients.map((c, idx) => (
                        <React.Fragment key={idx}>
                          {idx > 0 && ' · '}
                          {c.idCli && puedeVerClientes ? (
                            <a
                              href={`#ficha_cliente/${c.idCli}`}
                              className="client-link"
                              onClick={e => {
                                e.preventDefault();
                                onNavigate('ficha_cliente', c.idCli);
                              }}
                            >
                              {c.nomCli}
                            </a>
                          ) : (
                            c.nomCli
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Modal Registrar PR */}
      {modalPR.open && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalPR(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header">
              <h2>📈 Registrar PR</h2>
              <p>{modalPR.nomEj}</p>
            </div>
            <div className="form-group">
              <label>Peso máximo levantado hoy (kg)</label>
              <input
                type="number"
                step="0.5"
                placeholder="Ej: 85.5"
                value={modalPR.peso}
                onChange={e => setModalPR(prev => ({ ...prev, peso: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setModalPR(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={modalPR.saving}
                onClick={handleConfirmPR}
              >
                {modalPR.saving ? 'Guardando...' : 'Guardar Récord'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
