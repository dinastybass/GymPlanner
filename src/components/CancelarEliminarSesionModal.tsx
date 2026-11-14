import React, { useEffect, useState } from 'react';
import { useUndo } from '../context/UndoContext';
import {
  cancelarSesionConCascadaAdelante,
  eliminarSesionDefinitivamente,
  enviarSesionDirectamenteASinFecha,
  listarSesionesPendientesConFechaDeCliente,
  SesionPendienteElegible,
  ubicarProgramacionDeSesionCanceladaEnExistente
} from '../services/sessionCascadeService';
import { confirmarDialogo } from '../utils/confirmDialog';

export interface CancelarEliminarSesionModalProps {
  isOpen: boolean;
  sessionId: string;
  clientId: string;
  clientName: string;
  fechaStr: string;
  horaStr: string;
  tieneProgramacion: boolean;
  numEjercicios?: number;
  puedeMoverProgramacion: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export const CancelarEliminarSesionModal: React.FC<CancelarEliminarSesionModalProps> = ({
  isOpen,
  sessionId,
  clientId,
  clientName,
  fechaStr,
  horaStr,
  tieneProgramacion,
  numEjercicios = 0,
  puedeMoverProgramacion,
  onClose,
  onSuccess
}) => {
  const { pushAction } = useUndo();
  const [step, setStep] = useState<'main' | 'elegir_existente'>('main');
  const [loadingSesiones, setLoadingSesiones] = useState(false);
  const [sesionesElegibles, setSesionesElegibles] = useState<SesionPendienteElegible[]>([]);
  const [idSesionDestino, setIdSesionDestino] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const mostrarOpcionesProgramacion = Boolean(tieneProgramacion && puedeMoverProgramacion);

  useEffect(() => {
    if (isOpen) {
      setStep('main');
      setSesionesElegibles([]);
      setIdSesionDestino('');
      setSaving(false);
    }
  }, [isOpen, sessionId]);

  if (!isOpen || !sessionId) return null;

  const autor = localStorage.getItem('gym_user_name') || 'Entrenador';
  const nombreCli = clientName || 'Cliente';

  // 1. Borrar definitivamente (Eliminar)
  const handleOpcion1Eliminar = async () => {
    if (saving) return;
    const okConfirm = await confirmarDialogo(
      `¿Seguro que deseas eliminar definitivamente la sesión de ${nombreCli} (${fechaStr} · ${horaStr})?\n\nPodrás deshacer la acción desde la barra superior.`,
      {
        titulo: 'Eliminar sesión definitivamente',
        textoConfirmar: 'Sí, eliminar definitivamente',
        danger: true
      }
    );
    if (!okConfirm) return;

    setSaving(true);
    try {
      const res = await eliminarSesionDefinitivamente({
        idSesion: sessionId,
        usuario: autor
      });
      onClose();
      await onSuccess();
      if (res.ok) {
        pushAction({
          label: `Eliminar sesión definitivamente (${nombreCli})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error('Error al eliminar sesión:', err);
      alert('No se pudo eliminar la sesión.');
    } finally {
      setSaving(false);
    }
  };

  // 2. Cancelar y cascada hacia delante
  const handleOpcion2CascadaAdelante = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await cancelarSesionConCascadaAdelante({
        idSesion: sessionId,
        esAutomatico: false,
        usuario: autor
      });
      onClose();
      await onSuccess();
      if (res.ok) {
        pushAction({
          label: `Cancelar sesión con cascada (${nombreCli})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error('Error al cancelar con cascada:', err);
      alert('No se pudo cancelar la sesión en cascada.');
    } finally {
      setSaving(false);
    }
  };

  // 3. Abrir paso de selección de sesión existente
  const handleAbrirOpcion3ElegirExistente = async () => {
    if (saving) return;
    setStep('elegir_existente');
    setLoadingSesiones(true);
    try {
      const lista = await listarSesionesPendientesConFechaDeCliente({
        idCliente: clientId,
        excluirIdSesion: sessionId
      });
      setSesionesElegibles(lista);
      if (lista.length > 0) {
        setIdSesionDestino(lista[0].id);
      } else {
        setIdSesionDestino('');
      }
    } catch (err) {
      console.error('Error cargando sesiones del cliente:', err);
    } finally {
      setLoadingSesiones(false);
    }
  };

  // Ejecutar Opción 3 (Machacar o Cascada hacia delante desde la sesión elegida)
  const handleEjecutarOpcion3 = async (modo: 'MACHACAR' | 'CASCADA_ADELANTE') => {
    if (!idSesionDestino || saving) return;
    setSaving(true);
    try {
      const res = await ubicarProgramacionDeSesionCanceladaEnExistente({
        idSesionOrigen: sessionId,
        idSesionDestino,
        modo,
        usuario: autor
      });
      onClose();
      await onSuccess();
      if (res.ok) {
        pushAction({
          label:
            modo === 'MACHACAR'
              ? `Ubicar programación machacando en sesión existente (${nombreCli})`
              : `Ubicar programación con cascada desde sesión existente (${nombreCli})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error('Error ubicando programación en sesión existente:', err);
      alert('No se pudo ubicar la programación en la sesión seleccionada.');
    } finally {
      setSaving(false);
    }
  };

  // 4. Ubicar directamente en Sin Fecha
  const handleOpcion4UbicarEnSinFecha = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await enviarSesionDirectamenteASinFecha({
        idSesion: sessionId,
        usuario: autor
      });
      onClose();
      await onSuccess();
      if (res.ok) {
        pushAction({
          label: `Ubicar sesión en Sin Fecha (${nombreCli})`,
          undoOps: res.undoOps,
          redoOps: res.redoOps,
          showToast: true,
          toastMessage: res.toastMessage
        });
      }
    } catch (err) {
      console.error('Error ubicando sesión en sin fecha:', err);
      alert('No se pudo ubicar la sesión en Sin Fecha.');
    } finally {
      setSaving(false);
    }
  };

  const sesionDestinoSeleccionada = sesionesElegibles.find(s => s.id === idSesionDestino) || null;

  return (
    <div
      className="modal-overlay"
      style={{ display: 'flex', zIndex: 2350 }}
      onClick={() => !saving && onClose()}
    >
      <div
        className="modal-content"
        style={{ maxWidth: 520 }}
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

        {step === 'main' ? (
          <>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>
                <span className="ui-icon">🗑️</span>
                <span>Cancelar o Eliminar Sesión</span>
              </h2>
              <p>
                Sesión de <strong>{nombreCli}</strong> del <strong>{fechaStr}</strong>
                {horaStr && horaStr !== '--:--' ? (
                  <>
                    {' '}
                    a las <strong>{horaStr}</strong>
                  </>
                ) : null}
                {tieneProgramacion ? (
                  <>
                    {' '}
                    · <strong>{numEjercicios} ej. programados</strong>
                  </>
                ) : (
                  <> · Sin ejercicios programados</>
                )}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* OPCIÓN 1: BORRAR DEFINITIVAMENTE */}
              <button
                type="button"
                className="modal-choice-btn choice-danger"
                disabled={saving}
                onClick={handleOpcion1Eliminar}
              >
                <span className="modal-choice-icon">🗑️</span>
                <div className="modal-choice-body">
                  <div className="modal-choice-title">
                    {mostrarOpcionesProgramacion
                      ? '1. Borrar definitivamente (Eliminar)'
                      : 'Borrar definitivamente (Eliminar)'}
                  </div>
                  <div className="modal-choice-desc">
                    Elimina por completo esta sesión de la agenda sin desplazar ni modificar las demás sesiones.
                  </div>
                </div>
              </button>

              {mostrarOpcionesProgramacion && (
                <>
                  {/* OPCIÓN 2: CANCELAR Y CASCADA HACIA DELANTE */}
                  <button
                    type="button"
                    className="modal-choice-btn choice-info"
                    disabled={saving}
                    onClick={handleOpcion2CascadaAdelante}
                  >
                    <span className="modal-choice-icon">⏩</span>
                    <div className="modal-choice-body">
                      <div className="modal-choice-title">
                        2. Cancelar y cascada hacia delante
                      </div>
                      <div className="modal-choice-desc">
                        Libera este hueco del calendario y desplaza su programación en cascada hacia las siguientes sesiones del cliente.
                      </div>
                    </div>
                  </button>

                  {/* OPCIÓN 3: UBICAR PROGRAMACIÓN EN SESIÓN EXISTENTE A ELEGIR */}
                  <button
                    type="button"
                    className="modal-choice-btn choice-success"
                    disabled={saving}
                    onClick={handleAbrirOpcion3ElegirExistente}
                  >
                    <span className="modal-choice-icon">🎯</span>
                    <div className="modal-choice-body">
                      <div className="modal-choice-title">
                        3. Ubicar programación en sesión existente a elegir
                      </div>
                      <div className="modal-choice-desc">
                        Elige otra sesión del cliente donde llevar esta programación y decide si machacar lo que haya o hacer cascada hacia delante desde esa ubicación.
                      </div>
                    </div>
                  </button>

                  {/* OPCIÓN 4: UBICAR EN SIN FECHA */}
                  <button
                    type="button"
                    className="modal-choice-btn choice-warn"
                    disabled={saving}
                    onClick={handleOpcion4UbicarEnSinFecha}
                  >
                    <span className="modal-choice-icon">📌</span>
                    <div className="modal-choice-body">
                      <div className="modal-choice-title">
                        4. Ubicar en Sin Fecha
                      </div>
                      <div className="modal-choice-desc">
                        Libera este hueco de la agenda y guarda esta sesión directamente en "Sesiones Sin Fecha" sin mover ninguna otra sesión.
                      </div>
                    </div>
                  </button>
                </>
              )}
            </div>

            <div className="modal-footer" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn-outline"
                disabled={saving}
                onClick={onClose}
              >
                Cerrar
              </button>
            </div>
          </>
        ) : (
          /* PASO OPCIÓN 3: ELEGIR SESIÓN EXISTENTE Y MODO (MACHACAR O CASCADA ADELANTE) */
          <>
            <div className="modal-header" style={{ marginBottom: 14 }}>
              <h2>
                <span className="ui-icon">🎯</span>
                <span>Ubicar programación en sesión existente</span>
              </h2>
              <p>
                Selecciona la sesión de <strong>{nombreCli}</strong> donde quieres llevar la programación del{' '}
                <strong>{fechaStr}</strong>. Las sesiones intermedias quedarán intactas.
              </p>
            </div>

            {loadingSesiones ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                Cargando sesiones disponibles del cliente...
              </div>
            ) : sesionesElegibles.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 10,
                  color: '#92400e',
                  fontSize: '0.88rem',
                  marginBottom: 14
                }}
              >
                Este cliente no tiene otras sesiones pendientes con fecha en la agenda. Puedes usar la opción{' '}
                <strong>Ubicar en Sin Fecha</strong>.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontWeight: 700, marginBottom: 6, display: 'block', fontSize: '0.86rem' }}>
                    Sesión destino donde ubicar la programación:
                  </label>
                  <select
                    className="form-control"
                    value={idSesionDestino}
                    disabled={saving}
                    onChange={e => setIdSesionDestino(e.target.value)}
                    style={{ width: '100%', fontWeight: 600 }}
                  >
                    {sesionesElegibles.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.fechaHumana} — {s.tieneEjercicios ? `Con programación (${s.numEjercicios} ej.)` : 'Vacía (0 ej.)'}
                      </option>
                    ))}
                  </select>
                </div>

                {sesionDestinoSeleccionada && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                    {sesionDestinoSeleccionada.tieneEjercicios ? (
                      <>
                        <div style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>
                          La sesión elegida ya tiene {sesionDestinoSeleccionada.numEjercicios} ejercicio
                          {sesionDestinoSeleccionada.numEjercicios === 1 ? '' : 's'}. ¿Cómo quieres ubicar la programación?
                        </div>

                        <button
                          type="button"
                          className="modal-choice-btn choice-info"
                          disabled={saving}
                          onClick={() => handleEjecutarOpcion3('CASCADA_ADELANTE')}
                        >
                          <span className="modal-choice-icon">🔄</span>
                          <div className="modal-choice-body">
                            <div className="modal-choice-title">
                              Hacer cascada hacia delante desde esa ubicación
                            </div>
                            <div className="modal-choice-desc">
                              Ubica la programación en el {sesionDestinoSeleccionada.fechaHumana} y desplaza lo que había en esa sesión hacia las siguientes sesiones posteriores.
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          className="modal-choice-btn choice-warn"
                          disabled={saving}
                          onClick={() => handleEjecutarOpcion3('MACHACAR')}
                        >
                          <span className="modal-choice-icon">⚡</span>
                          <div className="modal-choice-body">
                            <div className="modal-choice-title">
                              Machacar lo que hay en esa sesión
                            </div>
                            <div className="modal-choice-desc">
                              Sustituye los ejercicios del {sesionDestinoSeleccionada.fechaHumana} por esta programación sin mover las sesiones posteriores.
                            </div>
                          </div>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="modal-choice-btn choice-success"
                        disabled={saving}
                        onClick={() => handleEjecutarOpcion3('MACHACAR')}
                      >
                        <span className="modal-choice-icon">✅</span>
                        <div className="modal-choice-body">
                          <div className="modal-choice-title">
                            Ubicar programación en esta sesión vacía
                          </div>
                          <div className="modal-choice-desc">
                            La sesión del {sesionDestinoSeleccionada.fechaHumana} está vacía. Se colocará ahí la programación y se liberará el hueco original.
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="modal-footer" style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn-outline"
                disabled={saving}
                onClick={() => setStep('main')}
              >
                <span className="ui-icon">←</span>
                <span>Volver a las 4 opciones</span>
              </button>
              <button
                type="button"
                className="btn-outline"
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
