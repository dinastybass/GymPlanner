import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { EjercicioSesion } from '../types';
import { CustomDropdown } from './CustomDropdown';
import { getValoresMaestro } from '../services/maestrosService';
import { useUndo } from '../context/UndoContext';

interface SendRoutineModalProps {
  isOpen: boolean;
  onClose: () => void;
  ejercicios: EjercicioSesion[];
  defaultIntensity?: 'LOW' | 'MED' | 'HIGH';
  defaultTipoSesion?: string;
  onSuccess?: () => void;
}

export const SendRoutineModal: React.FC<SendRoutineModalProps> = ({
  isOpen,
  onClose,
  ejercicios,
  defaultIntensity = 'MED',
  defaultTipoSesion = '',
  onSuccess
}) => {
  const { pushAction, showToast } = useUndo();
  const [mode, setMode] = useState<'cliente' | 'plantilla'>('cliente');

  // Mode cliente state
  const [clientes, setClientes] = useState<{ id: string; name: string }[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<string>('');
  const [sesiones, setSesiones] = useState<any[]>([]);
  const [selectedSesion, setSelectedSesion] = useState<string>('');
  const [loadingSesiones, setLoadingSesiones] = useState(false);

  // Mode plantilla state
  const [tiposSesion, setTiposSesion] = useState<string[]>([]);
  const [niveles, setNiveles] = useState<string[]>([]);
  const [plantillaTipo, setPlantillaTipo] = useState<string>(defaultTipoSesion);
  const [plantillaNombre, setPlantillaNombre] = useState<string>('');
  const [plantillaNivel, setPlantillaNivel] = useState<string>('');
  const [plantillaIntensidad, setPlantillaIntensidad] = useState<'LOW' | 'MED' | 'HIGH'>(defaultIntensity);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Load clients
    getDocs(collection(db, "clientes")).then(snap => {
      const list: { id: string; name: string }[] = [];
      snap.forEach(d => {
        const data = d.data();
        const name = data.Alias || data.Nombre_Cliente || data.Nombre || data.nombre || 'Sin nombre';
        list.push({ id: d.id, name });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setClientes(list);
    }).catch(err => console.warn("Error cargando clientes:", err));

    // Load master types
    getValoresMaestro("Sesiones", "Tipo de Sesión").then(res => {
      setTiposSesion(res);
      if (res.length > 0 && !plantillaTipo) setPlantillaTipo(res[0]);
    });
    getValoresMaestro("Ejercicios", "Niveles").then(res => {
      setNiveles(res);
      if (res.length > 0 && !plantillaNivel) setPlantillaNivel(res[0]);
    });
  }, [isOpen]);

  useEffect(() => {
    if (!selectedCliente) {
      setSesiones([]);
      setSelectedSesion('');
      return;
    }

    setLoadingSesiones(true);
    const q = query(collection(db, "agenda_sesiones"), where("id_cliente", "==", selectedCliente));
    getDocs(q).then(snap => {
      const list: any[] = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));

      list.sort((a, b) => {
        const aSin = Boolean(a.sin_fecha || !a.fecha_hora_inicio);
        const bSin = Boolean(b.sin_fecha || !b.fecha_hora_inicio);
        if (aSin && !bSin) return -1;
        if (!aSin && bSin) return 1;
        const tA = a.fecha_hora_inicio?.toMillis ? a.fecha_hora_inicio.toMillis() : 0;
        const tB = b.fecha_hora_inicio?.toMillis ? b.fecha_hora_inicio.toMillis() : 0;
        return tB - tA;
      });

      setSesiones(list);
      if (list.length > 0) setSelectedSesion(list[0].id);
    }).finally(() => setLoadingSesiones(false));
  }, [selectedCliente]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ejercicios || ejercicios.length === 0) {
      alert("No hay ejercicios para enviar.");
      return;
    }

    setSaving(true);
    try {
      if (mode === 'cliente') {
        if (!selectedSesion) {
          alert("Por favor selecciona una sesión destino.");
          setSaving(false);
          return;
        }

        const sesionDestino = sesiones.find(s => s.id === selectedSesion);
        const prevEjercicios = sesionDestino?.ejercicios || [];
        const nextEjercicios = JSON.parse(JSON.stringify(ejercicios));
        const author = localStorage.getItem('gym_user_name') || 'Usuario';

        await updateDoc(doc(db, "agenda_sesiones", selectedSesion), {
          ejercicios: nextEjercicios,
          intensidad: defaultIntensity,
          Intensidad: defaultIntensity,
          programado_por: author,
          fecha_programacion: new Date(),
          orden_customizado: true
        });

        pushAction({
          label: "Enviar rutina a otra sesión",
          undoOps: [{ type: 'set', collection: 'agenda_sesiones', id: selectedSesion, data: { ejercicios: prevEjercicios }, merge: true }],
          redoOps: [{ type: 'set', collection: 'agenda_sesiones', id: selectedSesion, data: { ejercicios: nextEjercicios, orden_customizado: true }, merge: true }],
          showToast: true,
          toastMessage: "➡️ Rutina enviada a la sesión seleccionada"
        });

        onClose();
        if (onSuccess) onSuccess();
      } else {
        if (!plantillaNombre.trim() || !plantillaTipo || !plantillaNivel) {
          alert("Completa todos los campos de la plantilla.");
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

        await setDoc(doc(db, "plantillas_sesiones", idPlantilla), newPlantilla);

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
      console.error("Error al exportar rutina:", err);
      alert("Error al procesar la exportación: " + (err.message || 'Error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <div className="modal-header" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 5px 0' }}>Enviar / Exportar Sesión</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Envía los ejercicios a otra sesión de un cliente o genera una plantilla predefinida.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#f1f5f9', padding: 5, borderRadius: 10, marginBottom: 18 }}>
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
              color: mode === 'cliente' ? '#ffffff' : '#475569'
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
              color: mode === 'plantilla' ? '#ffffff' : '#475569'
            }}
          >
            📋 Crear plantilla
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'cliente' ? (
            <div>
              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Seleccionar Cliente Destino *</label>
                <CustomDropdown
                  options={clientes.map(c => ({ value: c.id, label: c.name }))}
                  value={selectedCliente}
                  onChange={setSelectedCliente}
                  placeholder="Elige un cliente..."
                  searchPlaceholder="Buscar cliente..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Seleccionar Sesión Destino *</label>
                <select
                  value={selectedSesion}
                  onChange={e => setSelectedSesion(e.target.value)}
                  disabled={!selectedCliente || loadingSesiones}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                >
                  {!selectedCliente ? (
                    <option value="">Primero selecciona un cliente...</option>
                  ) : loadingSesiones ? (
                    <option value="">Buscando sesiones...</option>
                  ) : sesiones.length === 0 ? (
                    <option value="">Este cliente no tiene sesiones agendadas</option>
                  ) : (
                    sesiones.map(s => {
                      const numEj = s.ejercicios ? s.ejercicios.length : 0;
                      const textEj = numEj > 0 ? `(${numEj} ej. - SE SOBRESCRIBIRÁ)` : '(Vacía)';
                      let dateStr = '📌 Sin fecha asignada';
                      if (s.fecha_hora_inicio?.toDate) {
                        const d = s.fecha_hora_inicio.toDate();
                        dateStr = `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
                      }
                      return (
                        <option key={s.id} value={s.id}>
                          {dateStr} {textEj}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Tipo de Sesión (Sección) *</label>
                <select
                  value={plantillaTipo}
                  onChange={e => setPlantillaTipo(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                >
                  {tiposSesion.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Nombre de la plantilla *</label>
                <input
                  type="text"
                  value={plantillaNombre}
                  onChange={e => setPlantillaNombre(e.target.value)}
                  placeholder="Ej. Tren Inferior - Día 1"
                  required
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Nivel Objetivo *</label>
                <select
                  value={plantillaNivel}
                  onChange={e => setPlantillaNivel(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                >
                  {niveles.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Intensidad *</label>
                <select
                  value={plantillaIntensidad}
                  onChange={e => setPlantillaIntensidad(e.target.value as any)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                >
                  <option value="LOW">LOW</option>
                  <option value="MED">MED</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </div>
            </div>
          )}

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Procesando...' : mode === 'cliente' ? 'Enviar Ejercicios' : 'Crear Plantilla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
