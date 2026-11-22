import React, { useState } from 'react';
import {
  CATALOGO_MODULOS_FIJOS,
  CATALOGO_MODULOS_APP,
  ModuloAppId
} from '../services/maestrosService';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';

export const ModulosAppSuperAdminPanel: React.FC = () => {
  const { modulosActivos, actualizarModulosActivos, isSuperAdmin } = useAuth();
  const { pushAction } = useUndo();
  const [savingId, setSavingId] = useState<ModuloAppId | null>(null);

  if (!isSuperAdmin) return null;

  const handleToggleModulo = async (id: ModuloAppId, nombre: string, nextValue: boolean) => {
    const prevModulos = { ...modulosActivos };
    const nextModulos: Record<ModuloAppId, boolean> = {
      ...modulosActivos,
      [id]: nextValue
    };

    setSavingId(id);
    try {
      await actualizarModulosActivos(nextModulos);
      pushAction({
        label: `${nextValue ? 'Activar' : 'Desactivar'} módulo "${nombre}"`,
        undoOps: [
          {
            type: 'set',
            collection: 'maestros',
            id: 'config_modulos_app',
            data: {
              schema_version: 1,
              modulos: prevModulos,
              updated_at: new Date().toISOString()
            }
          }
        ],
        redoOps: [
          {
            type: 'set',
            collection: 'maestros',
            id: 'config_modulos_app',
            data: {
              schema_version: 1,
              modulos: nextModulos,
              updated_at: new Date().toISOString()
            }
          }
        ],
        showToast: true,
        toastMessage: nextValue
          ? `🟢 Módulo "${nombre}" activado en la aplicación`
          : `⚪ Módulo "${nombre}" desactivado en la aplicación`
      });
    } catch (e) {
      console.error('Error actualizando estado de módulo:', e);
      alert('No se pudo actualizar el estado del módulo.');
    } finally {
      setSavingId(null);
    }
  };

  const totalActivos = CATALOGO_MODULOS_APP.filter(m => modulosActivos[m.id] !== false).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          background: '#f0fdfa',
          border: '1px solid #99f6e4',
          color: '#0f766e',
          padding: '12px 16px',
          borderRadius: 10,
          fontSize: '0.86rem',
          lineHeight: 1.45
        }}
      >
        <span className="ui-icon" style={{ marginTop: 2 }}>🛡️</span>
        <div>
          <strong>Panel exclusivo SuperAdmin:</strong> Desde aquí puedes activar o desactivar
          funciones y módulos propios de la aplicación. Al desactivar un módulo, todas sus
          pestañas, botones y opciones desaparecen de inmediato para todos los usuarios.
        </div>
      </div>

      {/* Módulos Propios Activables */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)' }}>
              Módulos Propios de la Aplicación (Activables)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.83rem', color: 'var(--text-muted)' }}>
              Activa o desactiva cada módulo según las necesidades del centro.
            </p>
          </div>
          <span
            className="pill status-activo"
            style={{ fontSize: '0.78rem', fontWeight: 700, padding: '4px 10px' }}
          >
            {totalActivos} de {CATALOGO_MODULOS_APP.length} módulos activos
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14
          }}
        >
          {CATALOGO_MODULOS_APP.map(mod => {
            const activo = modulosActivos[mod.id] !== false;
            const isSaving = savingId === mod.id;

            return (
              <div
                key={mod.id}
                style={{
                  background: activo ? '#ffffff' : '#f8fafc',
                  border: activo ? '1.5px solid #0d9488' : '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                  opacity: isSaving ? 0.7 : 1,
                  transition: 'all 0.15s ease'
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 8
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1.25rem' }}>{mod.icono}</span>
                      <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
                        {mod.nombre}
                      </strong>
                    </div>

                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleToggleModulo(mod.id, mod.nombre, !activo)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 12px',
                        borderRadius: 999,
                        border: activo ? '1px solid #0d9488' : '1px solid #cbd5e1',
                        background: activo ? '#0d9488' : '#e2e8f0',
                        color: activo ? '#ffffff' : '#475569',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: isSaving ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{activo ? '● Activo' : '○ Inactivo'}</span>
                    </button>
                  </div>

                  <p
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '0.83rem',
                      color: 'var(--text-muted)',
                      lineHeight: 1.4
                    }}
                  >
                    {mod.descripcion}
                  </p>

                  <div
                    style={{
                      background: activo ? '#f0fdfa' : '#f1f5f9',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontSize: '0.76rem',
                      color: '#334155'
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4, color: '#0f172a' }}>
                      Funciones que incluye:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.45 }}>
                      {mod.alcance.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Módulos Base Fijos */}
      <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>
            Módulos Base Fijos (Siempre activos)
          </h3>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Estructura principal disponible de forma permanente para todos los clientes de la
            aplicación.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10
          }}
        >
          {CATALOGO_MODULOS_FIJOS.map(mod => (
            <div
              key={mod.id}
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{mod.icono}</span>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    {mod.nombre}
                  </strong>
                </div>
                <span
                  className="pill"
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    background: '#e0f2fe',
                    color: '#0369a1',
                    border: '1px solid #bae6fd'
                  }}
                >
                  Fijo
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                {mod.descripcion}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
