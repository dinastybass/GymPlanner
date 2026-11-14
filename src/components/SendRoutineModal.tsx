import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore';
import { setDoc, updateDoc, writeBatch } from '../services/offlineSyncService';
import { EjercicioSesion } from '../types';
import { CustomDropdown } from './CustomDropdown';
import { getValoresMaestro } from '../services/maestrosService';
import { useUndo } from '../context/UndoContext';
import {
  normalizarIntensidad,
  formatIntensityOptionLabel,
  DEFAULT_INTENSIDADES_SESION,
  parsearFechaFirestore,
  esSesionCompletada,
  esSesionCancelada
} from '../utils/helpers';

export interface SendRoutineModalProps {
  isOpen: boolean;
  onClose: () => void;
  ejercicios: EjercicioSesion[];
  defaultIntensity?: string;
  defaultTipoSesion?: string;
  defaultClientId?: string;
  excludeSessionId?: string;
  onSuccess?: () => void;
}

interface SgSlotOption {
  slotKey: string;
  timestampMs: number;
  fechaHoraInicio: any;
  dateLabel: string;
  firstDocId: string;
  docIds: string[];
  participantes: string[];
  ejercicios: any[];
  docsSnapshot: { id: string; data: any }[];
}

function esTipoSmallGroup(tipoRaw: any): boolean {
  const t = String(tipoRaw || '').trim().toLowerCase();
  return t.includes('small') || t.includes('group') || t === 'sg' || t === 's.g.';
}

function isSessionCompletedOrCancelled(data: any): boolean {
  if (!data) return false;
  return esSesionCompletada(data) || esSesionCancelada(data);
}

export const SendRoutineModal: React.FC<SendRoutineModalProps> = ({
  isOpen,
  onClose,
  ejercicios,
  defaultIntensity = 'MED',
  defaultTipoSesion = '',
  defaultClientId = '',
  excludeSessionId = '',
  onSuccess
}) => {
  const { pushAction, showToast } = useUndo();
  const [mode, setMode] = useState<'cliente' | 'small_group' | 'plantilla'>('cliente');

  // Mode cliente state
  const [clientes, setClientes] = useState<{ id: string; name: string; search: string }[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<string>('');
  const [sesiones, setSesiones] = useState<any[]>([]);
  const [selectedSesion, setSelectedSesion] = useState<string>('');
  const [loadingSesiones, setLoadingSesiones] = useState(false);

  // Mode Small Group state
  const [sgSlots, setSgSlots] = useState<SgSlotOption[]>([]);
  const [selectedSgSlotKey, setSelectedSgSlotKey] = useState<string>('');
  const [loadingSgSlots, setLoadingSgSlots] = useState(false);

  const [overwriteMode, setOverwriteMode] = useState<'replace' | 'merge'>('replace');

  // Mode plantilla state
  const [tiposSesion, setTiposSesion] = useState<string[]>([]);
  const [niveles, setNiveles] = useState<string[]>([]);
  const [intensidades, setIntensidades] = useState<string[]>(DEFAULT_INTENSIDADES_SESION);
  const [plantillaTipo, setPlantillaTipo] = useState<string>(defaultTipoSesion);
  const [plantillaNombre, setPlantillaNombre] = useState<string>('');
  const [plantillaNivel, setPlantillaNivel] = useState<string>('');
  const [plantillaIntensidad, setPlantillaIntensidad] = useState<string>(
    normalizarIntensidad(defaultIntensity)
  );

  const [saving, setSaving] = useState(false);

  // Inicializar clientes, slots Small Group y valores maestros al abrir
  useEffect(() => {
    if (!isOpen) return;

    setSelectedCliente('');
    setSelectedSesion('');
    setSesiones([]);
    setSelectedSgSlotKey('');
    setSgSlots([]);
    setOverwriteMode('replace');
    setMode('cliente');
    setPlantillaNombre('');
    setPlantillaIntensidad(normalizarIntensidad(defaultIntensity));

    const now = new Date();
    const startOfTodayUTC = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    );

    // Cargar clientes y luego los slots de Small Group disponibles
    setLoadingSgSlots(true);
    getDocs(collection(db, 'clientes'))
      .then(async snap => {
        const list: { id: string; name: string; search: string }[] = [];
        const clientesMap: Record<string, string> = {};
        snap.forEach(d => {
          const data = d.data();
          const alias = String(data.Alias || data.alias || '').trim();
          const fullName = String(
            data.Nombre_Cliente || data.nombre_cliente || data.Nombre || data.nombre || ''
          ).trim();
          const name = alias || fullName || 'Sin nombre';
          list.push({ id: d.id, name, search: `${alias} ${fullName}` });
          clientesMap[d.id] = name;
          if (data.ID_Cliente) {
            clientesMap[data.ID_Cliente] = name;
          }
        });
        list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
        setClientes(list);

        try {
          const qSG = query(
            collection(db, 'agenda_sesiones'),
            where('fecha_hora_inicio', '>=', startOfTodayUTC)
          );
          const sgSnap = await getDocs(qSG);
          const grouped: Record<string, SgSlotOption> = {};

          sgSnap.forEach(d => {
            const data = d.data();
            if (!esTipoSmallGroup(data.tipo_sesion)) return;
            if (isSessionCompletedOrCancelled(data)) return;
            const fechaObj = parsearFechaFirestore(data.fecha_hora_inicio);
            if (!fechaObj) return;

            const tsMs = fechaObj.getTime();
            const key = String(tsMs);
            const idCli = data.id_cliente || data.ID_Cliente || '';
            const nombrePart =
              (idCli && clientesMap[idCli]) ||
              data.alias ||
              data.Alias ||
              data.nombre_cliente ||
              data.Nombre_Cliente ||
              data.cliente_nombre ||
              'Cliente';
            const ejs = Array.isArray(data.ejercicios) ? data.ejercicios : [];

            if (!grouped[key]) {
              const dateLabel = `${fechaObj.toLocaleDateString('es-ES', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: 'UTC'
              })} · ${fechaObj.toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'UTC'
              })}`;

              grouped[key] = {
                slotKey: key,
                timestampMs: tsMs,
                fechaHoraInicio: data.fecha_hora_inicio,
                dateLabel,
                firstDocId: d.id,
                docIds: [],
                participantes: [],
                ejercicios: ejs,
                docsSnapshot: []
              };
            }

            grouped[key].docIds.push(d.id);
            grouped[key].docsSnapshot.push({ id: d.id, data });
            if (!grouped[key].participantes.includes(nombrePart)) {
              grouped[key].participantes.push(nombrePart);
            }
            if (grouped[key].ejercicios.length === 0 && ejs.length > 0) {
              grouped[key].ejercicios = ejs;
              grouped[key].firstDocId = d.id;
            }
          });

          const slotsList = Object.values(grouped)
            .filter(slot => !(excludeSessionId && slot.docIds.includes(excludeSessionId)))
            .sort((a, b) => a.timestampMs - b.timestampMs);

          setSgSlots(slotsList);
        } catch (errSg) {
          console.warn('Error cargando slots de Small Group:', errSg);
        } finally {
          setLoadingSgSlots(false);
        }
      })
      .catch(err => {
        console.warn('Error cargando clientes:', err);
        setLoadingSgSlots(false);
      });

    // Cargar maestros para plantillas
    getValoresMaestro('Sesiones', 'Tipo de Sesión').then(res => {
      setTiposSesion(res);
      if (res.length > 0) {
        const matched = defaultTipoSesion
          ? res.find(t => t.toLowerCase() === defaultTipoSesion.toLowerCase())
          : undefined;
        setPlantillaTipo(matched || res[0]);
      }
    });
    getValoresMaestro('Ejercicios', 'Niveles').then(res => {
      setNiveles(res);
      if (res.length > 0 && !plantillaNivel) setPlantillaNivel(res[0]);
    });
    getValoresMaestro('Sesiones', 'Intensidad de la Sesión').then(res => {
      if (res && res.length > 0) setIntensidades(res);
    });
  }, [isOpen, defaultIntensity, defaultTipoSesion, excludeSessionId]);

  // Cargar sesiones no completadas del cliente seleccionado
  useEffect(() => {
    if (!selectedCliente) {
      setSesiones([]);
      setSelectedSesion('');
      return;
    }

    setLoadingSesiones(true);
    setSelectedSesion('');
    const now = new Date();
    const startOfTodayUTC = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    );

    const q = query(collection(db, 'agenda_sesiones'), where('id_cliente', '==', selectedCliente));
    getDocs(q)
      .then(snap => {
        const list: any[] = [];
        snap.forEach(d => {
          // Excluir la sesión de origen para no enviarse a sí misma
          if (excludeSessionId && d.id === excludeSessionId) return;

          const data = d.data();
          // Excluir sesiones completadas o canceladas
          if (isSessionCompletedOrCancelled(data)) return;

          // Permitir sesiones sin fecha o desde hoy en adelante
          const esSinFecha = Boolean(data.sin_fecha === true || !data.fecha_hora_inicio);
          if (!esSinFecha) {
            const fechaObj = parsearFechaFirestore(data.fecha_hora_inicio);
            if (!fechaObj || fechaObj < startOfTodayUTC) return;
          }

          list.push({ id: d.id, ...data });
        });

        // Ordenar sesiones ASCENDENTE (primero la más cercana en fecha, sin fecha al final)
        list.sort((a, b) => {
          const aSin = Boolean(a.sin_fecha || !a.fecha_hora_inicio);
          const bSin = Boolean(b.sin_fecha || !b.fecha_hora_inicio);
          if (aSin && !bSin) return 1;
          if (!aSin && bSin) return -1;
          if (aSin && bSin) return 0;
          const tA = parsearFechaFirestore(a.fecha_hora_inicio)?.getTime() || 0;
          const tB = parsearFechaFirestore(b.fecha_hora_inicio)?.getTime() || 0;
          return tA - tB;
        });

        setSesiones(list);
        setSelectedSesion('');
      })
      .catch(err => console.error('Error cargando sesiones:', err))
      .finally(() => setLoadingSesiones(false));
  }, [selectedCliente, excludeSessionId]);

  if (!isOpen) return null;

  const currentTargetSession = sesiones.find(s => s.id === selectedSesion);
  const currentTargetSgSlot = sgSlots.find(s => s.slotKey === selectedSgSlotKey);

  const targetExercisesCount =
    mode === 'small_group'
      ? currentTargetSgSlot?.ejercicios?.length || 0
      : currentTargetSession?.ejercicios?.length || 0;
  const targetHasExercises = targetExercisesCount > 0;

  const actualizarSlotSmallGroup = async (
    fechaHoraInicio: any,
    ejerciciosOrigen: any[],
    intensidadNorm: string,
    labelDestino: string
  ) => {
    const qGroup = query(
      collection(db, 'agenda_sesiones'),
      where('fecha_hora_inicio', '==', fechaHoraInicio)
    );
    const snapGroup = await getDocs(qGroup);

    const groupDocs: { id: string; data: any }[] = [];
    let prevEjerciciosComunes: any[] = [];
    snapGroup.forEach(d => {
      const dataD = d.data();
      if (!esTipoSmallGroup(dataD.tipo_sesion) || esSesionCancelada(dataD)) return;
      groupDocs.push({ id: d.id, data: dataD });
      if (prevEjerciciosComunes.length === 0 && Array.isArray(dataD.ejercicios) && dataD.ejercicios.length > 0) {
        prevEjerciciosComunes = dataD.ejercicios;
      }
    });

    if (groupDocs.length === 0) {
      throw new Error('No se encontraron sesiones activas en ese slot de Small Group.');
    }

    const finalEjercicios =
      overwriteMode === 'merge'
        ? [...prevEjerciciosComunes, ...ejerciciosOrigen]
        : ejerciciosOrigen;

    const author = localStorage.getItem('gym_user_name') || 'Usuario';
    const fechaEdicion = new Date();
    const updatePayload = {
      ejercicios: finalEjercicios,
      intensidad: intensidadNorm,
      Intensidad: intensidadNorm,
      intensidad_sesion: intensidadNorm,
      programado_por: author,
      ultimo_editor: author,
      fecha_programacion: fechaEdicion,
      fecha_ultima_edicion: fechaEdicion,
      orden_customizado: true
    };

    const batch = writeBatch(db);
    const undoOps: any[] = [];
    const redoOps: any[] = [];

    groupDocs.forEach(gDoc => {
      batch.update(doc(db, 'agenda_sesiones', gDoc.id), updatePayload);
      undoOps.push({
        type: 'set',
        collection: 'agenda_sesiones',
        id: gDoc.id,
        data: {
          ejercicios: gDoc.data.ejercicios || [],
          intensidad: gDoc.data.intensidad || 'MED',
          Intensidad: gDoc.data.Intensidad || 'MED',
          intensidad_sesion: gDoc.data.intensidad_sesion || 'MED',
          orden_customizado: Boolean(gDoc.data.orden_customizado)
        },
        merge: true
      });
      redoOps.push({
        type: 'set',
        collection: 'agenda_sesiones',
        id: gDoc.id,
        data: updatePayload,
        merge: true
      });
    });

    await batch.commit();

    pushAction({
      label: `Enviar rutina a ${labelDestino}`,
      undoOps,
      redoOps,
      showToast: true,
      toastMessage: `➡️ Rutina enviada exitosamente a ${labelDestino}`
    });

    showToast(`➡️ Rutina enviada exitosamente a ${labelDestino}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ejercicios || ejercicios.length === 0) {
      alert('No hay ejercicios para enviar.');
      return;
    }

    setSaving(true);
    try {
      const intensidadNorm = normalizarIntensidad(defaultIntensity);
      const ejerciciosAClonar = JSON.parse(JSON.stringify(ejercicios));

      if (mode === 'cliente') {
        if (!selectedSesion) {
          alert('Por favor selecciona una sesión destino.');
          setSaving(false);
          return;
        }

        const sesionDestinoSnap = await getDoc(doc(db, 'agenda_sesiones', selectedSesion));
        if (!sesionDestinoSnap.exists()) {
          throw new Error('La sesión de destino no existe en la base de datos.');
        }
        const dataDestino = sesionDestinoSnap.data();
        const targetClientObj = clientes.find(c => c.id === selectedCliente);
        const targetClientName = targetClientObj?.name || 'Cliente';

        if (esTipoSmallGroup(dataDestino.tipo_sesion) && dataDestino.fecha_hora_inicio) {
          await actualizarSlotSmallGroup(
            dataDestino.fecha_hora_inicio,
            ejerciciosAClonar,
            intensidadNorm,
            `Small Group (${targetClientName})`
          );
        } else {
          const prevEjercicios = dataDestino.ejercicios || [];
          const finalEjercicios =
            overwriteMode === 'merge'
              ? [...prevEjercicios, ...ejerciciosAClonar]
              : ejerciciosAClonar;

          const author = localStorage.getItem('gym_user_name') || 'Usuario';
          const fechaEdicion = new Date();
          const updatePayload = {
            ejercicios: finalEjercicios,
            intensidad: intensidadNorm,
            Intensidad: intensidadNorm,
            intensidad_sesion: intensidadNorm,
            programado_por: author,
            ultimo_editor: author,
            fecha_programacion: fechaEdicion,
            fecha_ultima_edicion: fechaEdicion,
            orden_customizado: true
          };

          await updateDoc(doc(db, 'agenda_sesiones', selectedSesion), updatePayload);

          pushAction({
            label: `Enviar rutina a ${targetClientName}`,
            undoOps: [
              {
                type: 'set',
                collection: 'agenda_sesiones',
                id: selectedSesion,
                data: {
                  ejercicios: prevEjercicios,
                  intensidad: dataDestino.intensidad || 'MED',
                  Intensidad: dataDestino.Intensidad || 'MED',
                  intensidad_sesion: dataDestino.intensidad_sesion || 'MED',
                  orden_customizado: Boolean(dataDestino.orden_customizado)
                },
                merge: true
              }
            ],
            redoOps: [
              {
                type: 'set',
                collection: 'agenda_sesiones',
                id: selectedSesion,
                data: updatePayload,
                merge: true
              }
            ],
            showToast: true,
            toastMessage: `➡️ Rutina enviada exitosamente a ${targetClientName}`
          });

          showToast(`➡️ Rutina enviada exitosamente a ${targetClientName}`);
        }

        onClose();
        if (onSuccess) onSuccess();
      } else if (mode === 'small_group') {
        if (!currentTargetSgSlot) {
          alert('Por favor selecciona una sesión de Small Group.');
          setSaving(false);
          return;
        }

        await actualizarSlotSmallGroup(
          currentTargetSgSlot.fechaHoraInicio,
          ejerciciosAClonar,
          intensidadNorm,
          `Small Group (${currentTargetSgSlot.dateLabel})`
        );

        onClose();
        if (onSuccess) onSuccess();
      } else {
        // Modo Plantilla
        if (!plantillaNombre.trim() || !plantillaTipo || !plantillaNivel) {
          alert('Completa todos los campos obligatorios de la plantilla.');
          setSaving(false);
          return;
        }

        const idPlantilla = `PLANTILLA-${Date.now()}`;
        const newPlantilla = {
          tipo_sesion: plantillaTipo,
          nombre: plantillaNombre.trim(),
          nivel: plantillaNivel,
          intensidad: plantillaIntensidad,
          Intensidad: plantillaIntensidad,
          ejercicios: ejerciciosAClonar,
          orden_customizado: true
        };

        await setDoc(doc(db, 'plantillas_sesiones', idPlantilla), newPlantilla);

        pushAction({
          label: `Crear plantilla "${plantillaNombre}"`,
          undoOps: [{ type: 'delete', collection: 'plantillas_sesiones', id: idPlantilla }],
          redoOps: [{ type: 'set', collection: 'plantillas_sesiones', id: idPlantilla, data: newPlantilla, merge: false }],
          showToast: true,
          toastMessage: `📋 Plantilla "${plantillaNombre}" creada en ${plantillaTipo}`
        });

        showToast(`📋 Plantilla "${plantillaNombre}" creada exitosamente`);
        onClose();
        if (onSuccess) onSuccess();
      }
    } catch (err: any) {
      console.error('Error al exportar rutina:', err);
      alert('Error al procesar la exportación: ' + (err.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const renderOverwriteSelector = () => (
    <div
      style={{
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 16
      }}
    >
      <p style={{ margin: '0 0 8px 0', fontSize: '0.84rem', fontWeight: 600, color: '#92400e' }}>
        ⚠️ La sesión destino ya tiene {targetExercisesCount} ejercicio(s) programados:
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', cursor: 'pointer', color: '#78350f' }}>
          <input
            type="radio"
            name="overwriteMode"
            value="replace"
            checked={overwriteMode === 'replace'}
            onChange={() => setOverwriteMode('replace')}
            style={{ width: 'auto', margin: 0 }}
          />
          <span><strong>Sobrescribir:</strong> Reemplazar la rutina completa con los nuevos ejercicios</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', cursor: 'pointer', color: '#78350f' }}>
          <input
            type="radio"
            name="overwriteMode"
            value="merge"
            checked={overwriteMode === 'merge'}
            onChange={() => setOverwriteMode('merge')}
            style={{ width: 'auto', margin: 0 }}
          />
          <span><strong>Fusionar:</strong> Añadir estos ejercicios a los que ya existen en la sesión</span>
        </label>
      </div>
    </div>
  );

  const isSubmitDisabled =
    saving ||
    (mode === 'cliente' && (!selectedSesion || !selectedCliente)) ||
    (mode === 'small_group' && !selectedSgSlotKey);

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 560, borderRadius: 14 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar modal">&times;</button>
        <div className="modal-header" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: '1.25rem' }}>
            <span className="ui-icon">➡️</span>
            <span>Enviar Sesión / Rutina</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Envía los ejercicios a otra sesión de cliente (PT), a una sesión de Small Group o guárdalos como plantilla.
          </p>
        </div>

        {/* Pestañas de Modo */}
        <div className="segmented-switcher cols-3">
          <button
            type="button"
            className={`segmented-btn ${mode === 'cliente' ? 'active' : ''}`}
            onClick={() => setMode('cliente')}
          >
            <span className="ui-icon">👤</span>
            <span>Cliente / PT</span>
          </button>
          <button
            type="button"
            className={`segmented-btn ${mode === 'small_group' ? 'active' : ''}`}
            onClick={() => setMode('small_group')}
          >
            <span className="ui-icon">👥</span>
            <span>Small Group</span>
          </button>
          <button
            type="button"
            className={`segmented-btn ${mode === 'plantilla' ? 'active' : ''}`}
            onClick={() => setMode('plantilla')}
          >
            <span className="ui-icon">📋</span>
            <span>Plantilla</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'cliente' ? (
            <div>
              {/* Combo con buscador integrado para cliente */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 6 }}>
                  Cliente Destino *
                </label>
                <CustomDropdown
                  options={clientes.map(c => ({ value: c.id, label: c.name, search: c.search }))}
                  value={selectedCliente}
                  onChange={setSelectedCliente}
                  placeholder="Buscar o elegir un cliente..."
                  searchPlaceholder="Escribe para buscar cliente..."
                />
              </div>

              {/* Selector de Sesión Destino (Solo sesiones no completadas) */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    Sesión Destino (Pendiente) *
                  </label>
                  {sesiones.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {sesiones.length} {sesiones.length === 1 ? 'sesión pendiente' : 'sesiones pendientes'}
                    </span>
                  )}
                </div>

                <select
                  value={selectedSesion}
                  onChange={e => setSelectedSesion(e.target.value)}
                  disabled={!selectedCliente || loadingSesiones || sesiones.length === 0}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '0.9rem',
                    background: (!selectedCliente || loadingSesiones || sesiones.length === 0) ? '#f8fafc' : '#ffffff',
                    cursor: (!selectedCliente || loadingSesiones || sesiones.length === 0) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {!selectedCliente ? (
                    <option value="">Primero selecciona un cliente arriba...</option>
                  ) : loadingSesiones ? (
                    <option value="">Buscando sesiones pendientes...</option>
                  ) : sesiones.length === 0 ? (
                    <option value="">Este cliente no tiene sesiones pendientes o disponibles</option>
                  ) : (
                    <>
                      <option value="">-- Elige una sesión de destino --</option>
                      {sesiones.map(s => {
                        const numEj = s.ejercicios ? s.ejercicios.length : 0;
                        const textEj = numEj > 0 ? `(${numEj} ej. programados)` : '(Vacía)';
                        let dateStr = '📌 Sin fecha asignada';
                        const d = parsearFechaFirestore(s.fecha_hora_inicio);
                        if (d) {
                          dateStr = `${d.toLocaleDateString('es-ES', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            timeZone: 'UTC'
                          })} · ${d.toLocaleTimeString('es-ES', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'UTC'
                          })}`;
                        }
                        const tipoLabel = esTipoSmallGroup(s.tipo_sesion) ? '[S.G.]' : '[PT]';

                        return (
                          <option key={s.id} value={s.id}>
                            {dateStr} {tipoLabel} {textEj}
                          </option>
                        );
                      })}
                    </>
                  )}
                </select>
              </div>

              {targetHasExercises && renderOverwriteSelector()}
            </div>
          ) : mode === 'small_group' ? (
            <div>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    Sesión Small Group Destino *
                  </label>
                  {sgSlots.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {sgSlots.length} {sgSlots.length === 1 ? 'grupo disponible' : 'grupos disponibles'}
                    </span>
                  )}
                </div>

                <CustomDropdown
                  options={sgSlots.map(slot => {
                    const numEj = slot.ejercicios ? slot.ejercicios.length : 0;
                    const textEj = numEj > 0 ? `${numEj} ej.` : 'Vacía';
                    const partResumen =
                      slot.participantes.length > 3
                        ? `${slot.participantes.slice(0, 3).join(', ')} +${slot.participantes.length - 3}`
                        : slot.participantes.join(', ');
                    return {
                      value: slot.slotKey,
                      label: `${slot.dateLabel} · ${slot.participantes.length} al. (${textEj})`,
                      sublabel: `Participantes: ${partResumen}`,
                      search: `${slot.dateLabel} ${partResumen} ${slot.participantes.join(' ')}`
                    };
                  })}
                  value={selectedSgSlotKey}
                  onChange={setSelectedSgSlotKey}
                  placeholder={
                    loadingSgSlots
                      ? 'Buscando sesiones de Small Group...'
                      : sgSlots.length === 0
                        ? 'No hay sesiones de Small Group pendientes'
                        : 'Buscar o elegir un Small Group...'
                  }
                  searchPlaceholder="Filtrar por día, hora o cliente del grupo..."
                  disabled={loadingSgSlots || sgSlots.length === 0}
                />

                {!loadingSgSlots && sgSlots.length === 0 && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    No hay sesiones de Small Group programadas desde hoy en adelante.
                  </p>
                )}
              </div>

              {currentTargetSgSlot && (
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    marginBottom: 16,
                    fontSize: '0.84rem'
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: 4 }}>
                    👥 Participantes en este Small Group ({currentTargetSgSlot.participantes.length}):
                  </div>
                  <div style={{ color: 'var(--text-main)', lineHeight: 1.4 }}>
                    {currentTargetSgSlot.participantes.join(' · ')}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>
                    La rutina se aplicará automáticamente a todos los participantes del grupo.
                  </div>
                </div>
              )}

              {targetHasExercises && renderOverwriteSelector()}
            </div>
          ) : (
            <div>
              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 5 }}>
                  Tipo de Sesión (Sección del catálogo) *
                </label>
                <select
                  value={plantillaTipo}
                  onChange={e => setPlantillaTipo(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }}
                >
                  {tiposSesion.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 5 }}>
                  Nombre de la Plantilla *
                </label>
                <input
                  type="text"
                  value={plantillaNombre}
                  onChange={e => setPlantillaNombre(e.target.value)}
                  placeholder="Ej. Pierna Fuerza - Nivel 2"
                  required
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 15 }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 5 }}>
                    Nivel Objetivo *
                  </label>
                  <select
                    value={plantillaNivel}
                    onChange={e => setPlantillaNivel(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }}
                  >
                    {niveles.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 15 }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 5 }}>
                    Intensidad *
                  </label>
                  <select
                    value={plantillaIntensidad}
                    onChange={e => setPlantillaIntensidad(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }}
                  >
                    {Array.from(
                      new Set([
                        ...intensidades.map(normalizarIntensidad),
                        normalizarIntensidad(plantillaIntensidad)
                      ])
                    ).map(intOpt => (
                      <option key={intOpt} value={intOpt}>
                        {formatIntensityOptionLabel(intOpt)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitDisabled}
            >
              {saving
                ? 'Procesando...'
                : mode === 'plantilla'
                  ? 'Crear Plantilla'
                  : 'Confirmar y Enviar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

