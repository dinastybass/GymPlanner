import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { CustomDropdown } from './CustomDropdown';
import {
  esSesionCompletada,
  parsearFechaFirestore,
  obtenerLunesSemanaUTC,
  obtenerMesPropietarioSemanaUTC,
  obtenerSemanasDelMesOperativo
} from '../utils/helpers';

export interface PlanificarSlotContext {
  modo: 'general' | 'slot';
  dateStrID: string;
  timeKey: string;
  tipoPlan: 'Individual' | 'Small Group';
  defaultMes?: string;
}

export interface PlanificarSubmitPayload {
  tipo: 'Individual' | 'Small Group';
  clienteId: string;
  fechasUTC: Date[];
  horaIni: string;
  conCascadaAtras: boolean;
}

interface PlanificarDiasModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientes: { id: string; alias: string; nombre: string }[];
  diasSemana: string[];
  timeSlots: string[];
  horasFinOptions: string[];
  sgTimeSlotsRaw: string[];
  ocupacionMaxima: number;
  aforoGlobalPorFila: Record<string, number>;
  timeToRowMap: Record<string, number>;
  separatorRow: number;
  slotContext: PlanificarSlotContext;
  saving: boolean;
  onSubmitPlan: (payload: PlanificarSubmitPayload) => Promise<void>;
}

interface CandidateOccurrence {
  key: string;
  fechaUTC: Date;
  weekNum: number;
  label: string;
  time: string;
  isActive: boolean;
}

const MAPA_DIA_JS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6
};

const DIAS_SEMANA_MAPA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_SEMANA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseSgSlotEntry(entry: string): { diaNum: number; hora: string; entry: string } | null {
  const parts = entry.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const horaRaw = parts[parts.length - 1];
  const diaTxt = parts.slice(0, -1).join(' ');
  const diaNum = MAPA_DIA_JS[normalizarTexto(diaTxt)];
  if (diaNum === undefined || !/^\d{1,2}:\d{2}$/.test(horaRaw)) return null;
  const [hh, mm] = horaRaw.split(':');
  return {
    entry,
    diaNum,
    hora: `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`
  };
}

function formatDateChipLabel(d: Date): string {
  const dayShort = DIAS_SEMANA_CORTO[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dayShort} ${dd}/${mm}`;
}

export const PlanificarDiasModal: React.FC<PlanificarDiasModalProps> = ({
  isOpen,
  onClose,
  clientes,
  diasSemana,
  timeSlots,
  horasFinOptions,
  sgTimeSlotsRaw,
  ocupacionMaxima,
  aforoGlobalPorFila,
  timeToRowMap,
  separatorRow,
  slotContext,
  saving,
  onSubmitPlan
}) => {
  const [planTipo, setPlanTipo] = useState<'Individual' | 'Small Group'>('Individual');
  const [planClienteId, setPlanClienteId] = useState('');
  const [planSelectedDays, setPlanSelectedDays] = useState<number[]>([]);
  const [planSelectedSgSlots, setPlanSelectedSgSlots] = useState<string[]>([]);
  const [planMes, setPlanMes] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });
  const [planSelectedWeeks, setPlanSelectedWeeks] = useState<number[]>([1, 2, 3, 4, 5]);
  const [toggledDateOverrides, setToggledDateOverrides] = useState<Record<string, boolean>>({});
  const [planHoraIni, setPlanHoraIni] = useState('17:00');
  const [planHoraFin, setPlanHoraFin] = useState('18:00');
  const [planCascadaAtras, setPlanCascadaAtras] = useState(true);
  const [planClientSessions, setPlanClientSessions] = useState<
    { id: string; fechaObj: Date; numEj: number }[]
  >([]);

  // Initialize modal fields whenever opened
  useEffect(() => {
    if (!isOpen) return;

    setPlanClienteId('');
    setToggledDateOverrides({});
    setPlanCascadaAtras(true);

    if (slotContext.modo === 'slot' && slotContext.dateStrID) {
      const [y, m, d] = slotContext.dateStrID.split('-');
      const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)));
      const owner = obtenerMesPropietarioSemanaUTC(dateObj, diasSemana);
      const ownerMesStr = `${owner.year}-${String(owner.month + 1).padStart(2, '0')}`;
      setPlanMes(ownerMesStr);

      const semanasOwner = obtenerSemanasDelMesOperativo(owner.year, owner.month, diasSemana);
      const clickedMonday = obtenerLunesSemanaUTC(dateObj).getTime();
      const matchedWeek = semanasOwner.find(w => w.mondayDate.getTime() === clickedMonday);
      const nthWeek = matchedWeek ? matchedWeek.weekNum : 1;

      const dayOfWeek = dateObj.getUTCDay();
      setPlanSelectedWeeks([nthWeek]);
      setPlanTipo(slotContext.tipoPlan);

      if (slotContext.tipoPlan === 'Individual') {
        setPlanSelectedDays([dayOfWeek]);
        setPlanSelectedSgSlots([]);
        setPlanHoraIni(slotContext.timeKey);
        const [hh, mm] = slotContext.timeKey.split(':');
        setPlanHoraFin(`${String(parseInt(hh, 10) + 1).padStart(2, '0')}:${mm}`);
      } else {
        setPlanSelectedDays([]);
        const nombreDiaClick = DIAS_SEMANA_MAPA[dayOfWeek];
        const targetValue = `${nombreDiaClick} ${slotContext.timeKey}`;
        const matched = sgTimeSlotsRaw.find(
          o => normalizarTexto(o) === normalizarTexto(targetValue)
        );
        setPlanSelectedSgSlots(matched ? [matched] : []);
      }
    } else {
      if (slotContext.defaultMes) {
        setPlanMes(slotContext.defaultMes);
      } else {
        const today = new Date();
        const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
        const owner = obtenerMesPropietarioSemanaUTC(todayUTC, diasSemana);
        setPlanMes(`${owner.year}-${String(owner.month + 1).padStart(2, '0')}`);
      }
      setPlanTipo(slotContext.tipoPlan || 'Individual');
      setPlanSelectedDays([]);
      setPlanSelectedSgSlots([]);
      setPlanSelectedWeeks([1, 2, 3, 4, 5]);
      const defIni = timeSlots.includes('17:00') ? '17:00' : (timeSlots[0] || '08:00');
      setPlanHoraIni(defIni);
      const [hh, mm] = defIni.split(':');
      setPlanHoraFin(`${String(parseInt(hh, 10) + 1).padStart(2, '0')}:${mm}`);
    }
  }, [isOpen, slotContext, sgTimeSlotsRaw, timeSlots, diasSemana]);

  // Load client pending Individual sessions for cascade-back detection
  useEffect(() => {
    if (!isOpen || !planClienteId) {
      setPlanClientSessions([]);
      return;
    }
    const q = query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', planClienteId));
    getDocs(q)
      .then(snap => {
        const list: { id: string; fechaObj: Date; numEj: number }[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (data.sin_fecha) return;
          const tipo = String(data.tipo_sesion || '').toLowerCase();
          if (tipo.includes('small') || tipo.includes('group') || tipo === 'sg') return;
          if (esSesionCompletada(data)) return;
          const parsedF = parsearFechaFirestore(data.fecha_hora_inicio);
          if (!parsedF) return;
          const numEj = Array.isArray(data.ejercicios) ? data.ejercicios.length : 0;
          list.push({ id: d.id, fechaObj: parsedF, numEj });
        });
        list.sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());
        setPlanClientSessions(list);
      })
      .catch(() => setPlanClientSessions([]));
  }, [isOpen, planClienteId]);

  const semanasDelMesOperativo = useMemo(() => {
    if (!planMes) return [];
    const [yearStr, monthStr] = planMes.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;
    if (isNaN(year) || isNaN(month)) return [];
    return obtenerSemanasDelMesOperativo(year, month, diasSemana);
  }, [planMes, diasSemana]);

  const candidateOccurrences = useMemo<CandidateOccurrence[]>(() => {
    if (semanasDelMesOperativo.length === 0) return [];

    const results: CandidateOccurrence[] = [];
    const seenKeys = new Set<string>();

    if (planTipo === 'Small Group') {
      const parsedSlots = planSelectedSgSlots
        .map(parseSgSlotEntry)
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (parsedSlots.length === 0) return [];

      for (const sem of semanasDelMesOperativo) {
        const weekNum = sem.weekNum;
        for (let offset = 0; offset < 7; offset++) {
          const date = new Date(sem.mondayDate);
          date.setUTCDate(date.getUTCDate() + offset);
          const dayOfWeek = date.getUTCDay();
          const y = date.getUTCFullYear();
          const m = date.getUTCMonth();
          const d = date.getUTCDate();
          const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

          for (const slot of parsedSlots) {
            if (slot.diaNum === dayOfWeek) {
              const key = `${dateStr}T${slot.hora}`;
              if (seenKeys.has(key)) continue;
              seenKeys.add(key);

              const [hhStr, mmStr] = slot.hora.split(':');
              const fechaUTC = new Date(
                Date.UTC(y, m, d, parseInt(hhStr, 10), parseInt(mmStr, 10), 0, 0)
              );
              const isActive =
                toggledDateOverrides[key] !== undefined
                  ? toggledDateOverrides[key]
                  : planSelectedWeeks.includes(weekNum);

              results.push({
                key,
                fechaUTC,
                weekNum,
                label: formatDateChipLabel(fechaUTC),
                time: slot.hora,
                isActive
              });
            }
          }
        }
      }
    } else {
      if (planSelectedDays.length === 0) return [];
      const [hhStr, mmStr] = (planHoraIni || '08:00').split(':');
      const hh = parseInt(hhStr, 10) || 0;
      const mm = parseInt(mmStr, 10) || 0;

      for (const sem of semanasDelMesOperativo) {
        const weekNum = sem.weekNum;
        for (let offset = 0; offset < 7; offset++) {
          const date = new Date(sem.mondayDate);
          date.setUTCDate(date.getUTCDate() + offset);
          const dayOfWeek = date.getUTCDay();

          if (planSelectedDays.includes(dayOfWeek)) {
            const y = date.getUTCFullYear();
            const m = date.getUTCMonth();
            const d = date.getUTCDate();
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (seenKeys.has(dateStr)) continue;
            seenKeys.add(dateStr);

            const fechaUTC = new Date(Date.UTC(y, m, d, hh, mm, 0, 0));
            const isActive =
              toggledDateOverrides[dateStr] !== undefined
                ? toggledDateOverrides[dateStr]
                : planSelectedWeeks.includes(weekNum);

            results.push({
              key: dateStr,
              fechaUTC,
              weekNum,
              label: formatDateChipLabel(fechaUTC),
              time: planHoraIni,
              isActive
            });
          }
        }
      }
    }

    results.sort((a, b) => a.fechaUTC.getTime() - b.fechaUTC.getTime());
    return results;
  }, [
    semanasDelMesOperativo,
    planTipo,
    planSelectedSgSlots,
    planSelectedDays,
    planHoraIni,
    planSelectedWeeks,
    toggledDateOverrides
  ]);

  const fechasPlanCalculadas = useMemo(
    () => candidateOccurrences.filter(o => o.isActive).map(o => o.fechaUTC),
    [candidateOccurrences]
  );

  const sesionesPosterioresProgramadas = useMemo(() => {
    if (planTipo !== 'Individual' || !planClienteId || fechasPlanCalculadas.length === 0) {
      return [];
    }
    const primeraFechaUTC = fechasPlanCalculadas[0];
    return planClientSessions.filter(
      s => s.fechaObj.getTime() > primeraFechaUTC.getTime() && s.numEj > 0
    );
  }, [planTipo, planClienteId, fechasPlanCalculadas, planClientSessions]);

  const hasOverbooking = useMemo(() => {
    if (planTipo !== 'Individual') return false;
    let conflict = false;
    fechasPlanCalculadas.forEach(f => {
      const dateStrID = f.toISOString().split('T')[0];
      const row1 = timeToRowMap[planHoraIni];
      if (row1) {
        if ((aforoGlobalPorFila[`${dateStrID}-${row1}`] || 0) >= ocupacionMaxima) conflict = true;
        const row2 = row1 + 1;
        if (row2 !== separatorRow && (aforoGlobalPorFila[`${dateStrID}-${row2}`] || 0) >= ocupacionMaxima) {
          conflict = true;
        }
      }
    });
    return conflict;
  }, [planTipo, fechasPlanCalculadas, timeToRowMap, planHoraIni, aforoGlobalPorFila, ocupacionMaxima, separatorRow]);

  if (!isOpen) return null;

  const handleToggleWeek = (wNum: number) => {
    const active = planSelectedWeeks.includes(wNum);
    setPlanSelectedWeeks(prev =>
      active ? prev.filter(x => x !== wNum) : [...prev, wNum].sort((a, b) => a - b)
    );
    // Clear manual per-date overrides belonging to this week so the week toggle acts cleanly
    setToggledDateOverrides(prev => {
      const next = { ...prev };
      candidateOccurrences.forEach(occ => {
        if (occ.weekNum === wNum) {
          delete next[occ.key];
        }
      });
      return next;
    });
  };

  const handleToggleSingleDate = (occ: CandidateOccurrence) => {
    setToggledDateOverrides(prev => ({
      ...prev,
      [occ.key]: !occ.isActive
    }));
  };

  const handleSelectAllDates = () => {
    setPlanSelectedWeeks(semanasDelMesOperativo.map(w => w.weekNum));
    setToggledDateOverrides({});
  };

  const handleClearAllDates = () => {
    setPlanSelectedWeeks([]);
    setToggledDateOverrides({});
  };

  const handleSwitchTipo = (nuevoTipo: 'Individual' | 'Small Group') => {
    if (nuevoTipo === planTipo) return;
    setPlanTipo(nuevoTipo);
    setToggledDateOverrides({});
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planClienteId) {
      alert('Por favor, selecciona un cliente.');
      return;
    }
    if (fechasPlanCalculadas.length === 0) {
      alert('Debes seleccionar al menos una fecha o sesión válida en el mes.');
      return;
    }

    await onSubmitPlan({
      tipo: planTipo,
      clienteId: planClienteId,
      fechasUTC: fechasPlanCalculadas,
      horaIni: planHoraIni,
      conCascadaAtras: planTipo === 'Individual' && sesionesPosterioresProgramadas.length > 0 && planCascadaAtras
    });
  };

  const totalSeleccionadas = fechasPlanCalculadas.length;

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>
          &times;
        </button>

        <div className="plan-modal-header">
          <h2>Planificar Días del Mes para Cliente</h2>
          <p>Programa las asistencias de forma masiva o puntual en el calendario.</p>
        </div>

        <form onSubmit={handleFormSubmit}>
          <div className="plan-type-switch">
            <label className="radio-option">
              <input
                type="radio"
                name="plan_tipo"
                value="Individual"
                checked={planTipo === 'Individual'}
                onChange={() => handleSwitchTipo('Individual')}
              />
              Sesión Individual
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="plan_tipo"
                value="Small Group"
                checked={planTipo === 'Small Group'}
                onChange={() => handleSwitchTipo('Small Group')}
              />
              Small Group
            </label>
          </div>

          <div className="plan-modal-grid">
            <div className="form-group full">
              <label>Cliente *</label>
              <CustomDropdown
                options={[...clientes]
                  .sort((a, b) => a.alias.localeCompare(b.alias))
                  .map(c => ({
                    value: c.id,
                    label: c.alias,
                    search: `${c.alias} ${c.nombre || ''}`
                  }))}
                value={planClienteId}
                onChange={setPlanClienteId}
                placeholder="Elige un cliente..."
                searchPlaceholder="Buscar cliente por nombre o alias..."
              />
            </div>

            {planTipo === 'Individual' ? (
              <div className="form-group full">
                <label className="plan-label-row">
                  <span>Días de asistencia (puedes elegir varios) *</span>
                  <span className="plan-label-count">
                    {totalSeleccionadas === 1 ? '1 cita' : `${totalSeleccionadas} citas`}
                  </span>
                </label>
                <div className="days-selector">
                  {diasSemana.map(d => {
                    const numDia = MAPA_DIA_JS[normalizarTexto(d)] ?? 1;
                    const isSelected = planSelectedDays.includes(numDia);
                    return (
                      <button
                        type="button"
                        key={d}
                        className={`day-pill ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          setPlanSelectedDays(prev =>
                            isSelected ? prev.filter(x => x !== numDia) : [...prev, numDia]
                          );
                        }}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="form-group full">
                <label className="plan-label-row">
                  <span>Días y horarios de Small Group (puedes elegir varios) *</span>
                  <span className="plan-label-count">
                    {planSelectedSgSlots.length === 1
                      ? '1 horario'
                      : `${planSelectedSgSlots.length} horarios`}
                  </span>
                </label>
                {sgTimeSlotsRaw.length === 0 ? (
                  <p className="plan-hint-text">
                    No hay horarios configurados para Small Group.
                  </p>
                ) : (
                  <div className="days-selector">
                    {sgTimeSlotsRaw.map(entry => {
                      const isSelected = planSelectedSgSlots.includes(entry);
                      return (
                        <button
                          type="button"
                          key={entry}
                          className={`day-pill ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            setPlanSelectedSgSlots(prev =>
                              isSelected ? prev.filter(x => x !== entry) : [...prev, entry]
                            );
                          }}
                        >
                          {entry}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <label>Mes a programar</label>
              <input
                type="month"
                required
                value={planMes}
                onChange={e => {
                  setPlanMes(e.target.value);
                  setToggledDateOverrides({});
                }}
              />
            </div>

            <div className="form-group">
              <label>Semanas a programar</label>
              <div className="days-selector">
                {(semanasDelMesOperativo.length > 0
                  ? semanasDelMesOperativo.map(w => w.weekNum)
                  : [1, 2, 3, 4]
                ).map(wNum => {
                  const active = planSelectedWeeks.includes(wNum);
                  return (
                    <button
                      type="button"
                      key={wNum}
                      className={`week-pill ${active ? 'active' : ''}`}
                      onClick={() => handleToggleWeek(wNum)}
                    >
                      S{wNum}
                    </button>
                  );
                })}
              </div>
            </div>

            {planTipo === 'Individual' && (
              <>
                <div className="form-group">
                  <label>Hora de inicio</label>
                  <select
                    required
                    value={planHoraIni}
                    onChange={e => {
                      const val = e.target.value;
                      setPlanHoraIni(val);
                      const [hh, mm] = val.split(':');
                      const nextTime = `${String(parseInt(hh, 10) + 1).padStart(2, '0')}:${mm}`;
                      if (horasFinOptions.includes(nextTime)) {
                        setPlanHoraFin(nextTime);
                      }
                    }}
                  >
                    {timeSlots.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Hora de fin</label>
                  <select
                    required
                    value={planHoraFin}
                    onChange={e => setPlanHoraFin(e.target.value)}
                  >
                    {horasFinOptions.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {candidateOccurrences.length > 0 && (
              <div className="form-group full">
                <div className="plan-label-row" style={{ marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>
                    Sesiones del mes ({totalSeleccionadas} de {candidateOccurrences.length})
                  </label>
                  <div className="plan-quick-actions">
                    <button
                      type="button"
                      className="plan-quick-btn"
                      onClick={handleSelectAllDates}
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      className="plan-quick-btn"
                      onClick={handleClearAllDates}
                    >
                      Ninguna (sueltas)
                    </button>
                  </div>
                </div>
                <div className="plan-dates-box">
                  <div className="plan-dates-chips">
                    {candidateOccurrences.map(occ => (
                      <button
                        type="button"
                        key={occ.key}
                        className={`plan-date-chip ${occ.isActive ? 'active' : ''}`}
                        onClick={() => handleToggleSingleDate(occ)}
                      >
                        <span>{occ.label}</span>
                        {planTipo === 'Small Group' && <span>· {occ.time}</span>}
                      </button>
                    ))}
                  </div>
                  <p className="plan-hint-text">
                    Pulsa cualquier día para incluir o quitar sesiones sueltas del mes.
                  </p>
                </div>
              </div>
            )}

            {hasOverbooking && (
              <div className="warning-msg" style={{ display: 'flex' }}>
                <span className="ui-icon">⚠️</span>
                <span>
                  Atención: Hay un conflicto de overbooking ({ocupacionMaxima} o más clientes).
                </span>
              </div>
            )}

            {planTipo === 'Individual' && sesionesPosterioresProgramadas.length > 0 && (
              <div className="plan-cascade-box">
                <label className="plan-cascade-label">
                  <input
                    type="checkbox"
                    checked={planCascadaAtras}
                    onChange={e => setPlanCascadaAtras(e.target.checked)}
                  />
                  <div>
                    <div className="plan-cascade-title">
                      Hacer cascada hacia atrás de la sesión posterior a esta y siguientes
                    </div>
                    <div className="plan-cascade-desc">
                      Este cliente tiene{' '}
                      <strong>
                        {sesionesPosterioresProgramadas.length}{' '}
                        {sesionesPosterioresProgramadas.length === 1
                          ? 'sesión programada posterior'
                          : 'sesiones programadas posteriores'}
                      </strong>
                      . Si marcas esta casilla, esta nueva sesión tomará la rutina de la siguiente
                      sesión posterior, y así sucesivamente hacia atrás.
                    </div>
                  </div>
                </label>
              </div>
            )}
          </div>

          <div className="plan-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? 'Guardando...'
                : totalSeleccionadas === 1
                ? 'Programar 1 Cita'
                : `Programar ${totalSeleccionadas} Citas`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
