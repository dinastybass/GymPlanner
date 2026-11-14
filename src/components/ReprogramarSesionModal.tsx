import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { getValoresMaestro } from '../services/maestrosService';
import {
  reprogramarSesionConFechaOrdenCronologico,
  asignarFechaASesionSinFechaConCascadaAtras,
  resolverColisionSesionMismoDia
} from '../services/sessionCascadeService';
import {
  esSesionCompletada,
  esSesionCancelada,
  parsearFechaFirestore
} from '../utils/helpers';
import { useUndo } from '../context/UndoContext';

export interface ReprogramarSesionModalProps {
  isOpen: boolean;
  sessionId: string;
  clientId?: string;
  clientName?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const DIAS_SEMANA_DEFAULT = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const HORARIOS_IND_DEFAULT = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
  '19:00', '19:30', '20:00', '20:30', '21:00'
];

function getMondayUTC(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

export const ReprogramarSesionModal: React.FC<ReprogramarSesionModalProps> = ({
  isOpen,
  sessionId,
  clientId,
  clientName,
  onClose,
  onSuccess
}) => {
  const { pushAction } = useUndo();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diasSemana, setDiasSemana] = useState<string[]>(DIAS_SEMANA_DEFAULT);
  const [horariosInd, setHorariosInd] = useState<string[]>(HORARIOS_IND_DEFAULT);
  const [horariosSG, setHorariosSG] = useState<string[]>(HORARIOS_IND_DEFAULT);

  const [resolvedClientId, setResolvedClientId] = useState<string>('');
  const [resolvedClientName, setResolvedClientName] = useState<string>('');
  const [sesionesCliente, setSesionesCliente] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayUTC(new Date()));
  const [originMonday, setOriginMonday] = useState<Date>(() => getMondayUTC(new Date()));

  const [modalColisionDia, setModalColisionDia] = useState<{
    open: boolean;
    idSesionOrigen: string;
    idSesionExistenteDia: string;
    nuevaFechaUTC: Date | null;
    horaExistenteStr: string;
    horaNuevaStr: string;
    fechaLabelStr: string;
    numEjExistente: number;
    numEjEntrante: number;
    saving: boolean;
  }>({
    open: false,
    idSesionOrigen: '',
    idSesionExistenteDia: '',
    nuevaFechaUTC: null,
    horaExistenteStr: '',
    horaNuevaStr: '',
    fechaLabelStr: '',
    numEjExistente: 0,
    numEjEntrante: 0,
    saving: false
  });

  const [modalUbicarSinFecha, setModalUbicarSinFecha] = useState<{
    open: boolean;
    idSesionSinFecha: string;
    esSinFecha: boolean;
    nuevaFechaUTC: Date | null;
    fechaLabelStr: string;
    horaStr: string;
    numEjercicios: number;
    saving: boolean;
  }>({
    open: false,
    idSesionSinFecha: '',
    esSinFecha: true,
    nuevaFechaUTC: null,
    fechaLabelStr: '',
    horaStr: '',
    numEjercicios: 0,
    saving: false
  });

  const cargarDatosReprogramacion = useCallback(async () => {
    if (!isOpen || !sessionId) return;
    setLoading(true);
    try {
      const [diasDB, horasIndDB, horasSGDB] = await Promise.all([
        getValoresMaestro('Agenda', 'Días de la semana'),
        getValoresMaestro('Agenda', 'Horarios Sesiones Individuales'),
        getValoresMaestro('Agenda', 'Horarios Small Groups')
      ]);

      if (diasDB.length > 0) setDiasSemana(diasDB);
      if (horasIndDB.length > 0) setHorariosInd(horasIndDB);
      if (horasSGDB.length > 0) {
        const horasExtraidas = Array.from(
          new Set(
            horasSGDB
              .map(item => {
                const partes = String(item).trim().split(/\s+/);
                return partes.length > 1 ? partes[partes.length - 1] : partes[0];
              })
              .filter(h => /^\d{1,2}:\d{2}$/.test(h))
          )
        ).sort();
        setHorariosSG(horasExtraidas.length > 0 ? horasExtraidas : (horasIndDB.length > 0 ? horasIndDB : HORARIOS_IND_DEFAULT));
      }

      let idCli = clientId || '';
      let nomCli = clientName || '';
      let sesionOrigenRaw: any = null;

      const snapOrigen = await getDoc(doc(db, 'agenda_sesiones', sessionId));
      if (snapOrigen.exists()) {
        const d = snapOrigen.data();
        sesionOrigenRaw = { id: snapOrigen.id, ...d };
        if (!idCli) {
          idCli = d.id_cliente || d.ID_Cliente || '';
        }
        if (!nomCli) {
          nomCli = d.alias || d.Alias || d.nombre_cliente || d.Nombre_Cliente || 'Cliente';
        }
      }

      setResolvedClientId(idCli);
      setResolvedClientName(nomCli || 'Cliente');

      const lista: any[] = [];
      if (idCli) {
        const q = query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', idCli));
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
          const data = docSnap.data();
          if (esSesionCancelada(data) && docSnap.id !== sessionId) return;
          const esSinFecha = Boolean(data.sin_fecha === true || !data.fecha_hora_inicio);
          const fechaObj = esSinFecha ? null : parsearFechaFirestore(data.fecha_hora_inicio);
          lista.push({
            id: docSnap.id,
            ...data,
            sin_fecha: esSinFecha,
            fechaObj
          });
        });
      }

      if (sesionOrigenRaw && !lista.some(x => x.id === sessionId)) {
        const esSinFecha = Boolean(sesionOrigenRaw.sin_fecha === true || !sesionOrigenRaw.fecha_hora_inicio);
        const fechaObj = esSinFecha ? null : parsearFechaFirestore(sesionOrigenRaw.fecha_hora_inicio);
        lista.push({
          ...sesionOrigenRaw,
          sin_fecha: esSinFecha,
          fechaObj
        });
      }

      setSesionesCliente(lista);

      const sesOrig = lista.find(s => s.id === sessionId);
      const now = new Date();
      const hoyUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0));
      const baseDate = sesOrig && !sesOrig.sin_fecha && sesOrig.fechaObj ? sesOrig.fechaObj : hoyUTC;
      const mon = getMondayUTC(baseDate);
      setOriginMonday(new Date(mon));
      setWeekStart(new Date(mon));
    } catch (error) {
      console.error('Error cargando calendario de reprogramación:', error);
    } finally {
      setLoading(false);
    }
  }, [isOpen, sessionId, clientId, clientName]);

  useEffect(() => {
    if (isOpen && sessionId) {
      setModalColisionDia(prev => ({ ...prev, open: false, saving: false }));
      setModalUbicarSinFecha(prev => ({ ...prev, open: false, saving: false }));
      cargarDatosReprogramacion();
    }
  }, [isOpen, sessionId, cargarDatosReprogramacion]);

  if (!isOpen) return null;

  const sesionOrig = sesionesCliente.find(s => s.id === sessionId);
  const tipo = String(sesionOrig?.tipo_sesion || '').toLowerCase();
  const esSG = tipo.includes('small') || tipo.includes('group');
  const slots = esSG ? horariosSG : horariosInd;

  const morningSlots = slots.filter(h => parseInt(h.split(':')[0], 10) < 14);
  const afternoonSlots = slots.filter(h => parseInt(h.split(':')[0], 10) >= 14);

  const getRowForTime = (timeStr: string) => {
    const idxM = morningSlots.indexOf(timeStr);
    if (idxM !== -1) return idxM + 2;
    const idxA = afternoonSlots.indexOf(timeStr);
    if (idxA !== -1) return idxA + morningSlots.length + 3;
    return -1;
  };

  const numDias = diasSemana.length || 5;
  const diasSemanaFechas: Date[] = [];
  for (let i = 0; i < numDias; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    diasSemanaFechas.push(d);
  }

  const primerDia = diasSemanaFechas[0];
  const ultimoDia = diasSemanaFechas[diasSemanaFechas.length - 1];
  const weekLabel = `${primerDia.getUTCDate()} ${MESES_CORTOS[primerDia.getUTCMonth()]} - ${ultimoDia.getUTCDate()} ${MESES_CORTOS[ultimoDia.getUTCMonth()]} ${ultimoDia.getUTCFullYear()}`;

  const weekStartUTC = new Date(weekStart);
  weekStartUTC.setUTCHours(0, 0, 0, 0);
  const weekEndUTC = new Date(weekStart);
  weekEndUTC.setUTCDate(weekEndUTC.getUTCDate() + numDias);
  weekEndUTC.setUTCHours(0, 0, 0, 0);

  const sesionesSemanaCliente = sesionesCliente.filter(
    s => !s.sin_fecha && s.fechaObj && s.fechaObj >= weekStartUTC && s.fechaObj < weekEndUTC
  );

  const now = new Date();
  const hoyISO = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .split('T')[0];

  const gridRowsTemplate = `auto repeat(${morningSlots.length}, 34px) 14px repeat(${afternoonSlots.length}, 34px)`;

  const cambiarSemana = (deltaWeeks: number) => {
    const nextMonday = new Date(weekStart);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + deltaWeeks * 7);
    setWeekStart(nextMonday);
  };

  const seleccionarCeldaReprog = async (y: number, m: number, d: number, timeStr: string) => {
    if (!sesionOrig || saving) return;

    const [hh, mm] = timeStr.split(':').map(Number);
    const nuevaFechaUTC = new Date(Date.UTC(y, m, d, hh, mm, 0));

    // Si hace clic en la misma fecha y misma hora exacta de la sesión origen, no hacer nada
    if (
      !sesionOrig.sin_fecha &&
      sesionOrig.fechaObj &&
      sesionOrig.fechaObj.getTime() === nuevaFechaUTC.getTime()
    ) {
      return;
    }

    const esMismoDiaOrigen =
      !sesionOrig.sin_fecha &&
      Boolean(sesionOrig.fechaObj) &&
      sesionOrig.fechaObj.getUTCFullYear() === y &&
      sesionOrig.fechaObj.getUTCMonth() === m &&
      sesionOrig.fechaObj.getUTCDate() === d;

    // Si es el mismo día de la sesión actual, no preguntar nada: solo actualizar la hora
    if (esMismoDiaOrigen) {
      setSaving(true);
      const editorActual = localStorage.getItem('gym_user_name') || 'Entrenador';
      try {
        const res = await reprogramarSesionConFechaOrdenCronologico({
          idSesion: sesionOrig.id,
          nuevaFechaUTC,
          conCascada: false,
          usuario: editorActual
        });

        if (res) {
          pushAction({
            label: `Actualizar hora de sesión (${resolvedClientName})`,
            undoOps: res.undoOps,
            redoOps: res.redoOps,
            showToast: true,
            toastMessage: res.toastMessage
          });
        }

        onClose();
        if (onSuccess) await onSuccess();
      } catch (e) {
        console.error('Error al actualizar la hora de la sesión:', e);
        alert('Hubo un error al actualizar la hora de la sesión.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Comprobar si existe otra sesión distinta del mismo cliente en ese día diferente
    const sesionExistenteMismoDia = sesionesCliente.find(s => {
      if (s.sin_fecha || !s.fechaObj || s.id === sesionOrig.id) return false;
      return (
        s.fechaObj.getUTCFullYear() === y &&
        s.fechaObj.getUTCMonth() === m &&
        s.fechaObj.getUTCDate() === d
      );
    });

    if (sesionExistenteMismoDia && esSesionCompletada(sesionExistenteMismoDia)) {
      alert('Operación bloqueada: No puedes reprogramar una sesión en un día que ya tiene una sesión completada.');
      return;
    }

    const fechaLabelStr = `${DIAS_CORTOS[nuevaFechaUTC.getUTCDay()]} ${String(d).padStart(
      2,
      '0'
    )}/${String(m + 1).padStart(2, '0')}/${y}`;

    if (sesionExistenteMismoDia) {
      const fExist = sesionExistenteMismoDia.fechaObj as Date;
      const horaExistStr = `${String(fExist.getUTCHours()).padStart(2, '0')}:${String(
        fExist.getUTCMinutes()
      ).padStart(2, '0')}`;

      setModalColisionDia({
        open: true,
        idSesionOrigen: sesionOrig.id,
        idSesionExistenteDia: sesionExistenteMismoDia.id,
        nuevaFechaUTC,
        horaExistenteStr: horaExistStr,
        horaNuevaStr: timeStr,
        fechaLabelStr,
        numEjExistente: Array.isArray(sesionExistenteMismoDia.ejercicios)
          ? sesionExistenteMismoDia.ejercicios.length
          : 0,
        numEjEntrante: Array.isArray(sesionOrig.ejercicios) ? sesionOrig.ejercicios.length : 0,
        saving: false
      });
      return;
    }

    // Tanto para sesión sin fecha como para reprogramación con fecha hacia un día diferente,
    // preguntar si se desea ubicar CON o SIN cascada
    setModalUbicarSinFecha({
      open: true,
      idSesionSinFecha: sesionOrig.id,
      esSinFecha: Boolean(sesionOrig.sin_fecha),
      nuevaFechaUTC,
      fechaLabelStr,
      horaStr: timeStr,
      numEjercicios: Array.isArray(sesionOrig.ejercicios) ? sesionOrig.ejercicios.length : 0,
      saving: false
    });
  };

  const ejecutarUbicacionSinFecha = async (conCascada: boolean) => {
    if (!modalUbicarSinFecha.nuevaFechaUTC || modalUbicarSinFecha.saving) return;
    setModalUbicarSinFecha(prev => ({ ...prev, saving: true }));
    const editorActual = localStorage.getItem('gym_user_name') || 'Entrenador';

    try {
      const res = modalUbicarSinFecha.esSinFecha
        ? await asignarFechaASesionSinFechaConCascadaAtras({
            idSesionSinFecha: modalUbicarSinFecha.idSesionSinFecha,
            nuevaFechaUTC: modalUbicarSinFecha.nuevaFechaUTC,
            conCascada,
            usuario: editorActual
          })
        : await reprogramarSesionConFechaOrdenCronologico({
            idSesion: modalUbicarSinFecha.idSesionSinFecha,
            nuevaFechaUTC: modalUbicarSinFecha.nuevaFechaUTC,
            conCascada,
            usuario: editorActual
          });

      if (res) {
        pushAction({
          label: conCascada
            ? `Reprogramar sesión con cascada (${resolvedClientName})`
            : `Ubicar sesión sin cascada (${resolvedClientName})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }

      setModalUbicarSinFecha(prev => ({ ...prev, open: false, saving: false }));
      onClose();
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error('Error al ubicar/reprogramar sesión:', e);
      alert('Hubo un error al ubicar la sesión.');
      setModalUbicarSinFecha(prev => ({ ...prev, saving: false }));
    }
  };

  const ejecutarResolucionColisionMismoDia = async (modo: 'MACHACAR' | 'CASCADA_ADELANTE') => {
    if (!modalColisionDia.nuevaFechaUTC || modalColisionDia.saving) return;
    setModalColisionDia(prev => ({ ...prev, saving: true }));
    const editorActual = localStorage.getItem('gym_user_name') || 'Entrenador';

    try {
      const res = await resolverColisionSesionMismoDia({
        idSesionExistenteDia: modalColisionDia.idSesionExistenteDia,
        nuevaFechaUTC: modalColisionDia.nuevaFechaUTC,
        modo,
        idSesionOrigen: modalColisionDia.idSesionOrigen,
        usuario: editorActual
      });

      if (res) {
        pushAction({
          label:
            modo === 'MACHACAR'
              ? `Machacar sesión del mismo día (${resolvedClientName})`
              : `Actualizar sesión en cascada (${resolvedClientName})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }

      setModalColisionDia(prev => ({ ...prev, open: false, saving: false }));
      onClose();
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error('Error resolviendo colisión en el mismo día:', e);
      alert('Hubo un error al sobrescribir la sesión de ese día.');
      setModalColisionDia(prev => ({ ...prev, saving: false }));
    }
  };

  const numEjOrigen = Array.isArray(sesionOrig?.ejercicios) ? sesionOrig.ejercicios.length : 0;
  const horaOrigenStr =
    sesionOrig && !sesionOrig.sin_fecha && sesionOrig.fechaObj
      ? `${String(sesionOrig.fechaObj.getUTCHours()).padStart(2, '0')}:${String(
          sesionOrig.fechaObj.getUTCMinutes()
        ).padStart(2, '0')}`
      : '--:--';
  const fechaOrigenStr =
    sesionOrig && !sesionOrig.sin_fecha && sesionOrig.fechaObj
      ? `${DIAS_CORTOS[sesionOrig.fechaObj.getUTCDay()]} ${String(
          sesionOrig.fechaObj.getUTCDate()
        ).padStart(2, '0')}/${String(sesionOrig.fechaObj.getUTCMonth() + 1).padStart(
          2,
          '0'
        )}/${sesionOrig.fechaObj.getUTCFullYear()}`
      : '';

  return (
    <>
      <div
        className="modal-overlay"
        style={{ display: 'flex', zIndex: 2100 }}
        onClick={() => {
          if (!saving) onClose();
        }}
      >
        <div
          className="modal-content"
          style={{ maxWidth: 940, width: '95%' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            className="modal-close"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
          <div className="modal-header" style={{ marginBottom: 12 }}>
            <h2>
              <span className="ui-icon">📅</span>
              <span>Reprogramar Sesión en Calendario</span>
            </h2>
            {sesionOrig && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fcd34d',
                  color: '#92400e',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: '0.88rem',
                  marginTop: 6,
                  lineHeight: 1.4
                }}
              >
                {sesionOrig.sin_fecha ? (
                  <>
                    📌 <strong>Sesión sin fecha a ubicar:</strong>{' '}
                    <strong>{resolvedClientName}</strong> · <strong>Sin fecha asignada</strong> (
                    {numEjOrigen} ejercicio{numEjOrigen === 1 ? '' : 's'}) &mdash; Haz clic en
                    cualquier día y hora del calendario para asignarla.
                  </>
                ) : (
                  <>
                    📍 <strong>Sesión a reprogramar:</strong>{' '}
                    <strong>{resolvedClientName}</strong> · {fechaOrigenStr} a las{' '}
                    <strong>{horaOrigenStr}</strong> ({numEjOrigen} ejercicio
                    {numEjOrigen === 1 ? '' : 's'}) &mdash; Haz clic en cualquier hora del
                    calendario (incluso media hora antes o después) para ubicarla.
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="reprog-toolbar">
              <div className="reprog-nav-group">
                <button
                  type="button"
                  className="reprog-nav-arrow"
                  onClick={() => cambiarSemana(-1)}
                  title="Semana anterior"
                >
                  &lt;
                </button>
                <div className="reprog-week-title">
                  <span className="ui-icon">📅</span>
                  <span>{weekLabel}</span>
                </div>
                <button
                  type="button"
                  className="reprog-nav-arrow"
                  onClick={() => cambiarSemana(1)}
                  title="Semana siguiente"
                >
                  &gt;
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-outline"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => {
                    const nowRef = new Date();
                    const hoyUTC = new Date(
                      Date.UTC(nowRef.getFullYear(), nowRef.getMonth(), nowRef.getDate())
                    );
                    setWeekStart(getMondayUTC(hoyUTC));
                  }}
                >
                  Semana actual
                </button>
                {sesionOrig && !sesionOrig.sin_fecha && sesionOrig.fechaObj && (
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                    onClick={() => setWeekStart(new Date(originMonday))}
                  >
                    Semana de la sesión
                  </button>
                )}
              </div>
            </div>

            <div className="reprog-calendar-wrapper">
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Cargando calendario semanal...
                </div>
              ) : (
                <div
                  className="reprog-calendar-grid"
                  style={{
                    gridTemplateColumns: `60px repeat(${numDias}, 1fr)`,
                    gridTemplateRows: gridRowsTemplate
                  }}
                >
                  <div
                    className="reprog-day-header"
                    style={{ gridColumn: 1, gridRow: 1, borderRight: '3px solid #64748b' }}
                  >
                    Hora
                  </div>
                  {diasSemanaFechas.map((dObj, i) => {
                    const dd = dObj.getUTCDate().toString().padStart(2, '0');
                    const mm = (dObj.getUTCMonth() + 1).toString().padStart(2, '0');
                    const dateISO = dObj.toISOString().split('T')[0];
                    const isToday = dateISO === hoyISO;
                    return (
                      <div
                        key={i}
                        className="reprog-day-header"
                        style={{
                          gridColumn: i + 2,
                          gridRow: 1,
                          background: isToday ? '#f0fdfa' : undefined
                        }}
                      >
                        <strong>
                          {(diasSemana[i] || DIAS_SEMANA_DEFAULT[i] || '').toUpperCase()}
                          {isToday ? ' (HOY)' : ''}
                        </strong>
                        <span>
                          {dd}/{mm}
                        </span>
                      </div>
                    );
                  })}

                  {morningSlots.map((t, idx) => {
                    const r = idx + 2;
                    return (
                      <React.Fragment key={`m-${t}`}>
                        <div className="reprog-time-label" style={{ gridColumn: 1, gridRow: r }}>
                          {t}
                        </div>
                        {diasSemanaFechas.map((dObj, c) => (
                          <div
                            key={`mc-${c}`}
                            className="reprog-bg-cell"
                            style={{ gridColumn: c + 2, gridRow: r }}
                            title={`Mover a ${diasSemana[c] || ''} ${dObj.getUTCDate()}/${
                              dObj.getUTCMonth() + 1
                            } a las ${t}`}
                            onClick={() =>
                              seleccionarCeldaReprog(
                                dObj.getUTCFullYear(),
                                dObj.getUTCMonth(),
                                dObj.getUTCDate(),
                                t
                              )
                            }
                          />
                        ))}
                      </React.Fragment>
                    );
                  })}

                  <div
                    className="reprog-noon-separator"
                    style={{ gridRow: morningSlots.length + 2 }}
                  />

                  {afternoonSlots.map((t, idx) => {
                    const r = idx + morningSlots.length + 3;
                    return (
                      <React.Fragment key={`a-${t}`}>
                        <div className="reprog-time-label" style={{ gridColumn: 1, gridRow: r }}>
                          {t}
                        </div>
                        {diasSemanaFechas.map((dObj, c) => (
                          <div
                            key={`ac-${c}`}
                            className="reprog-bg-cell"
                            style={{ gridColumn: c + 2, gridRow: r }}
                            title={`Mover a ${diasSemana[c] || ''} ${dObj.getUTCDate()}/${
                              dObj.getUTCMonth() + 1
                            } a las ${t}`}
                            onClick={() =>
                              seleccionarCeldaReprog(
                                dObj.getUTCFullYear(),
                                dObj.getUTCMonth(),
                                dObj.getUTCDate(),
                                t
                              )
                            }
                          />
                        ))}
                      </React.Fragment>
                    );
                  })}

                  {/* Tarjetas visuales de sesiones del cliente con pointerEvents: 'none' para permitir clic en cualquier media hora subyacente */}
                  {sesionesSemanaCliente.map(s => {
                    const f = s.fechaObj as Date;
                    const dayOfWeek = f.getUTCDay();
                    if (dayOfWeek < 1 || dayOfWeek > numDias) return null;
                    const col = dayOfWeek + 1;
                    const hStr = `${f.getUTCHours().toString().padStart(2, '0')}:${f
                      .getUTCMinutes()
                      .toString()
                      .padStart(2, '0')}`;
                    const row = getRowForTime(hStr);
                    if (row === -1) return null;

                    const esOrigen = s.id === sessionId;
                    const esComp = esSesionCompletada(s);
                    const numEj = Array.isArray(s.ejercicios) ? s.ejercicios.length : 0;
                    const ejLabel = numEj > 0 ? `${numEj} ej.` : 'Vacía';
                    const cardClass = esOrigen
                      ? 'reprog-event-origin'
                      : esComp
                      ? 'reprog-event-completed'
                      : 'reprog-event-other';
                    const spanRows = esSG ? 1 : 2;
                    const labelText = esOrigen
                      ? `📍 Actual ${hStr} (${ejLabel})`
                      : esComp
                      ? `✓ ${hStr} (${ejLabel})`
                      : `📅 ${hStr} (${ejLabel})`;

                    return (
                      <div
                        key={s.id}
                        className={`reprog-event-card ${cardClass}`}
                        style={{
                          gridColumn: col,
                          gridRow: `${row} / span ${spanRows}`,
                          pointerEvents: 'none'
                        }}
                      >
                        <div
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {labelText}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="reprog-legend">
              <span className="reprog-legend-item">
                <span
                  className="reprog-legend-box"
                  style={{ background: '#fef3c7', border: '2px dashed #d97706' }}
                />{' '}
                Sesión a mover
              </span>
              <span className="reprog-legend-item">
                <span
                  className="reprog-legend-box"
                  style={{ background: '#e0f2fe', border: '1px solid #38bdf8' }}
                />{' '}
                Otras sesiones del cliente
              </span>
              <span className="reprog-legend-item">
                <span
                  className="reprog-legend-box"
                  style={{ background: '#dcfce7', border: '1px solid #86efac' }}
                />{' '}
                Sesión completada (bloqueada)
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--accent-dark)' }}>
                💡 Haz clic en cualquier tramo de media hora para elegir dónde moverla
              </span>
            </div>

            <div className="modal-footer" style={{ marginTop: 15 }}>
              <button
                type="button"
                className="btn-outline"
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Colisión de Sesión en el Mismo Día */}
      {modalColisionDia.open && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2300 }}
          onClick={() => {
            if (!modalColisionDia.saving) {
              setModalColisionDia(prev => ({ ...prev, open: false }));
            }
          }}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 520 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              disabled={modalColisionDia.saving}
              onClick={() => setModalColisionDia(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>
                <span className="ui-icon">⚠️</span>
                <span>Ya existe una sesión ese día</span>
              </h2>
              <p>
                <strong>{resolvedClientName}</strong> ya tiene una sesión programada el{' '}
                <strong>{modalColisionDia.fechaLabelStr}</strong> a las{' '}
                <strong>{modalColisionDia.horaExistenteStr}</strong> (
                {modalColisionDia.numEjExistente} ejercicio
                {modalColisionDia.numEjExistente === 1 ? '' : 's'}).
              </p>
              <p style={{ marginTop: 8, fontSize: '0.86rem', color: '#475569' }}>
                No se pueden tener dos sesiones el mismo día. La sesión de ese día se actualizará a
                la nueva hora elegida (<strong>{modalColisionDia.horaNuevaStr}</strong>). ¿Qué
                deseas hacer con los ejercicios?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="modal-choice-btn choice-warn"
                disabled={modalColisionDia.saving}
                onClick={() => ejecutarResolucionColisionMismoDia('MACHACAR')}
              >
                <span className="modal-choice-icon">🔄</span>
                <div className="modal-choice-body">
                  <div className="modal-choice-title">
                    Actualizar a las {modalColisionDia.horaNuevaStr} y machacar ejercicios
                  </div>
                  <div className="modal-choice-desc">
                    Sustituye los ejercicios que había en ese día ({modalColisionDia.numEjExistente}{' '}
                    ej.) por los de la sesión que estás moviendo ({modalColisionDia.numEjEntrante}{' '}
                    ej.) sin desplazar el resto de sesiones.
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="modal-choice-btn choice-info"
                disabled={modalColisionDia.saving}
                onClick={() => ejecutarResolucionColisionMismoDia('CASCADA_ADELANTE')}
              >
                <span className="modal-choice-icon">⏩</span>
                <div className="modal-choice-body">
                  <div className="modal-choice-title">
                    Actualizar a las {modalColisionDia.horaNuevaStr} y realizar cascada hacia
                    delante
                  </div>
                  <div className="modal-choice-desc">
                    Coloca aquí los ejercicios de la sesión entrante (
                    {modalColisionDia.numEjEntrante} ej.) y desplaza la rutina que estaba ese día
                    hacia las siguientes sesiones futuras (ubicando la última en la primera vacía
                    del bloque final o en "Sin fecha").
                  </div>
                </div>
              </button>
            </div>

            <div className="modal-footer" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn-outline"
                disabled={modalColisionDia.saving}
                onClick={() => setModalColisionDia(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ubicar Sesión (Con o Sin Cascada) */}
      {modalUbicarSinFecha.open && (
        <div
          className="modal-overlay"
          style={{ display: 'flex', zIndex: 2350 }}
          onClick={() => {
            if (!modalUbicarSinFecha.saving) {
              setModalUbicarSinFecha(prev => ({ ...prev, open: false }));
            }
          }}
        >
          <div
            className="modal-content"
            style={{ maxWidth: 520 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              disabled={modalUbicarSinFecha.saving}
              onClick={() => setModalUbicarSinFecha(prev => ({ ...prev, open: false }))}
            >
              ×
            </button>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>
                <span className="ui-icon">
                  {modalUbicarSinFecha.esSinFecha ? '📌' : '📅'}
                </span>
                <span>
                  {modalUbicarSinFecha.esSinFecha
                    ? 'Ubicar sesión sin fecha'
                    : 'Reprogramar sesión a nueva fecha'}
                </span>
              </h2>
              <p>
                Vas a ubicar la sesión de <strong>{resolvedClientName}</strong> (
                {modalUbicarSinFecha.numEjercicios} ejercicio
                {modalUbicarSinFecha.numEjercicios === 1 ? '' : 's'}) el{' '}
                <strong>{modalUbicarSinFecha.fechaLabelStr}</strong> a las{' '}
                <strong>{modalUbicarSinFecha.horaStr}</strong>.
              </p>
              <p style={{ marginTop: 8, fontSize: '0.86rem', color: '#475569' }}>
                ¿Quieres ubicar esta programación directamente en esa fecha sin mover nada, o
                realizar cascada?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                className="modal-choice-btn choice-success"
                disabled={modalUbicarSinFecha.saving}
                onClick={() => ejecutarUbicacionSinFecha(false)}
              >
                <span className="modal-choice-icon">📍</span>
                <div className="modal-choice-body">
                  <div className="modal-choice-title">
                    Ubicar directamente sin cascada (sin mover nada)
                  </div>
                  <div className="modal-choice-desc">
                    Coloca esta sesión y su programación ({modalUbicarSinFecha.numEjercicios} ej.)
                    directamente el {modalUbicarSinFecha.fechaLabelStr} a las{' '}
                    {modalUbicarSinFecha.horaStr} sin desplazar ninguna otra sesión.
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="modal-choice-btn choice-info"
                disabled={modalUbicarSinFecha.saving}
                onClick={() => ejecutarUbicacionSinFecha(true)}
              >
                <span className="modal-choice-icon">🔄</span>
                <div className="modal-choice-body">
                  <div className="modal-choice-title">
                    Ubicar con cascada
                  </div>
                  <div className="modal-choice-desc">
                    {modalUbicarSinFecha.esSinFecha
                      ? 'Inserta este hueco, adelanta las programaciones posteriores en cascada y ubica esta rutina al final (en la última sesión programada o primera vacía del bloque final).'
                      : 'Mueve la sesión a la nueva fecha y reordena las rutinas en cascada manteniendo su orden cronológico.'}
                  </div>
                </div>
              </button>
            </div>

            <div className="modal-footer" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn-outline"
                disabled={modalUbicarSinFecha.saving}
                onClick={() => setModalUbicarSinFecha(prev => ({ ...prev, open: false }))}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
