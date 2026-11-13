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
  DEFAULT_INTENSIDADES_SESION
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

function isSessionCompletedOrCancelled(data: any): boolean {
  if (!data) return false;
  const estadoSesion = String(data.estado_sesion || '').trim().toLowerCase();
  const estado = String(data.estado || '').trim().toLowerCase();
  const asistencia = String(data.asistencia || '').trim().toLowerCase();

  if (estadoSesion === 'completada' || estado === 'completada') return true;
  if (estadoSesion === 'cancelada' || estado === 'cancelada') return true;
  if (asistencia === 'asistio' || asistencia === 'completada') return true;
  if (data.completada === true) return true;

  return false;
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
  const [mode, setMode] = useState<'cliente' | 'plantilla'>('cliente');

  // Mode cliente state
  const [clientes, setClientes] = useState<{ id: string; name: string; search: string }[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<string>('');
  const [sesiones, setSesiones] = useState<any[]>([]);
  const [selectedSesion, setSelectedSesion] = useState<string>('');
  const [loadingSesiones, setLoadingSesiones] = useState(false);
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

  // Inicializar clientes y valores maestros al abrir
  useEffect(() => {
    if (!isOpen) return;

    setSelectedCliente('');
    setSelectedSesion('');
    setSesiones([]);
    setOverwriteMode('replace');
    setMode('cliente');
    setPlantillaIntensidad(normalizarIntensidad(defaultIntensity));

    // Cargar clientes
    getDocs(collection(db, 'clientes'))
      .then(snap => {
        const list: { id: string; name: string; search: string }[] = [];
        snap.forEach(d => {
          const data = d.data();
          const alias = String(data.Alias || '').trim();
          const fullName = String(data.Nombre_Cliente || data.Nombre || data.nombre || '').trim();
          const name = alias || fullName || 'Sin nombre';
          list.push({ id: d.id, name, search: `${alias} ${fullName}` });
        });
        list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
        setClientes(list);
      })
      .catch(err => console.warn('Error cargando clientes:', err));

    // Cargar maestros para plantillas
    getValoresMaestro('Sesiones', 'Tipo de Sesión').then(res => {
      setTiposSesion(res);
      if (res.length > 0 && !plantillaTipo) setPlantillaTipo(res[0]);
    });
    getValoresMaestro('Ejercicios', 'Niveles').then(res => {
      setNiveles(res);
      if (res.length > 0 && !plantillaNivel) setPlantillaNivel(res[0]);
    });
    getValoresMaestro('Sesiones', 'Intensidad de la Sesión').then(res => {
      if (res && res.length > 0) setIntensidades(res);
    });
  }, [isOpen, defaultIntensity]);

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
    const endOfTodayUTC = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
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

          // Solo permitir sesiones sin fecha o posteriores al día de hoy
          const esSinFecha = Boolean(data.sin_fecha === true || !data.fecha_hora_inicio);
          if (!esSinFecha) {
            const fechaObj = data.fecha_hora_inicio?.toDate
              ? data.fecha_hora_inicio.toDate()
              : new Date(data.fecha_hora_inicio);
            if (isNaN(fechaObj.getTime()) || fechaObj <= endOfTodayUTC) return;
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
          const tA = a.fecha_hora_inicio?.toMillis
            ? a.fecha_hora_inicio.toMillis()
            : (new Date(a.fecha_hora_inicio)).getTime() || 0;
          const tB = b.fecha_hora_inicio?.toMillis
            ? b.fecha_hora_inicio.toMillis()
            : (new Date(b.fecha_hora_inicio)).getTime() || 0;
          return tA - tB; // Ascendente: primero la más cercana
        });

        setSesiones(list);
        setSelectedSesion('');
      })
      .catch(err => console.error('Error cargando sesiones:', err))
      .finally(() => setLoadingSesiones(false));
  }, [selectedCliente, excludeSessionId]);

  if (!isOpen) return null;

  const currentTargetSession = sesiones.find(s => s.id === selectedSesion);
  const targetExercisesCount = currentTargetSession?.ejercicios ? currentTargetSession.ejercicios.length : 0;
  const targetHasExercises = targetExercisesCount > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ejercicios || ejercicios.length === 0) {
      alert('No hay ejercicios para enviar.');
      return;
    }

    setSaving(true);
    try {
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

        const prevEjercicios = dataDestino.ejercicios || [];
        const ejerciciosAClonar = JSON.parse(JSON.stringify(ejercicios));
        const finalEjercicios =
          overwriteMode === 'merge'
            ? [...prevEjercicios, ...ejerciciosAClonar]
            : ejerciciosAClonar;

        const author = localStorage.getItem('gym_user_name') || 'Usuario';
        const fechaEdicion = new Date();
        const tipoDest = String(dataDestino.tipo_sesion || '').toLowerCase();
        const targetClientObj = clientes.find(c => c.id === selectedCliente);
        const targetClientName = targetClientObj?.name || 'Cliente';

        if (tipoDest.includes('small') || tipoDest.includes('group')) {
          // Si es Small Group, actualizar a todos los participantes del slot horario
          const qGroup = query(
            collection(db, 'agenda_sesiones'),
            where('fecha_hora_inicio', '==', dataDestino.fecha_hora_inicio)
          );
          const snapGroup = await getDocs(qGroup);
          const batch = writeBatch(db);
          snapGroup.forEach(d => {
            const t = String(d.data().tipo_sesion || '').toLowerCase();
            if (t.includes('small') || t.includes('group')) {
              batch.update(doc(db, 'agenda_sesiones', d.id), {
                ejercicios: finalEjercicios,
                intensidad: defaultIntensity,
                Intensidad: defaultIntensity,
                intensidad_sesion: defaultIntensity,
                programado_por: author,
                ultimo_editor: author,
                fecha_programacion: fechaEdicion,
                fecha_ultima_edicion: fechaEdicion,
                orden_customizado: true
              });
            }
          });
          await batch.commit();
        } else {
          await updateDoc(doc(db, 'agenda_sesiones', selectedSesion), {
            ejercicios: finalEjercicios,
            intensidad: defaultIntensity,
            Intensidad: defaultIntensity,
            intensidad_sesion: defaultIntensity,
            programado_por: author,
            ultimo_editor: author,
            fecha_programacion: fechaEdicion,
            fecha_ultima_edicion: fechaEdicion,
            orden_customizado: true
          });
        }

        pushAction({
          label: `Enviar rutina a ${targetClientName}`,
          undoOps: [
            {
              type: 'set',
              collection: 'agenda_sesiones',
              id: selectedSesion,
              data: { ejercicios: prevEjercicios },
              merge: true
            }
          ],
          redoOps: [
            {
              type: 'set',
              collection: 'agenda_sesiones',
              id: selectedSesion,
              data: { ejercicios: finalEjercicios, orden_customizado: true },
              merge: true
            }
          ],
          showToast: true,
          toastMessage: `➡️ Rutina enviada exitosamente a ${targetClientName}`
        });

        showToast(`➡️ Rutina enviada exitosamente a ${targetClientName}`);
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
          ejercicios: JSON.parse(JSON.stringify(ejercicios)),
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

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 520, borderRadius: 14 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar modal">&times;</button>
        <div className="modal-header" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 5px 0', fontSize: '1.25rem' }}>➡️ Enviar Sesión / Rutina</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Copia los ejercicios a otra sesión pendiente de un cliente o guárdalos como plantilla predefinida.
          </p>
        </div>

        {/* Pestañas de Modo */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            background: '#f1f5f9',
            padding: 5,
            borderRadius: 10,
            marginBottom: 18
          }}
        >
          <button
            type="button"
            onClick={() => setMode('cliente')}
            style={{
              padding: '9px 12px',
              borderRadius: 7,
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              background: mode === 'cliente' ? 'var(--accent)' : 'transparent',
              color: mode === 'cliente' ? '#ffffff' : '#475569',
              transition: 'all 0.15s ease'
            }}
          >
            👤 Sesión de cliente
          </button>
          <button
            type="button"
            onClick={() => setMode('plantilla')}
            style={{
              padding: '9px 12px',
              borderRadius: 7,
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              background: mode === 'plantilla' ? 'var(--accent)' : 'transparent',
              color: mode === 'plantilla' ? '#ffffff' : '#475569',
              transition: 'all 0.15s ease'
            }}
          >
            📋 Guardar como plantilla
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
                      if (s.fecha_hora_inicio?.toDate) {
                        const d = s.fecha_hora_inicio.toDate();
                        dateStr = `${d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })} · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`;
                      } else if (s.fecha_hora_inicio) {
                        const d = new Date(s.fecha_hora_inicio);
                        dateStr = `${d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })} · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`;
                      }
                      const isSG =
                        String(s.tipo_sesion || '').toLowerCase().includes('small') ||
                        String(s.tipo_sesion || '').toLowerCase().includes('group');
                      const tipoLabel = isSG ? '[S.G.]' : '[PT]';

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

              {/* Si la sesión de destino ya tiene ejercicios, dar a elegir entre sobrescribir o fusionar */}
              {targetHasExercises && (
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
              )}
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
              disabled={saving || (mode === 'cliente' && (!selectedSesion || !selectedCliente))}
            >
              {saving ? 'Procesando...' : mode === 'cliente' ? 'Confirmar y Enviar' : 'Crear Plantilla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
