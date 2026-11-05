import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useUndo } from '../context/UndoContext';

interface NavbarProps {
  activeTab: string;
  onNavigate: (tab: string, param?: string) => void;
  canGoBack?: boolean;
  onGoBack?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onNavigate,
  canGoBack = false,
  onGoBack
}) => {
  const { userName, userAlias, logout } = useAuth();
  const { canUndo, canRedo, undoCount, undo, redo } = useUndo();

  const displayShortName = (userAlias || userName || 'Usuario').trim().split(/\s+/)[0] || 'Usuario';

  const handleLogout = async () => {
    await logout();
  };

  const isPlanificacion = activeTab === 'planificacion';
  const isAgenda = activeTab === 'agenda' || activeTab === 'pendientes' || activeTab === 'programar_sesion';
  const isClientes = activeTab === 'clientes' || activeTab === 'ficha_cliente';
  const isEjercicios = activeTab === 'ejercicios' || activeTab === 'ficha_ejercicio';
  const isPlantillas = activeTab === 'plantillas' || activeTab === 'editar_plantilla';
  const isMaestros = activeTab === 'maestros';

  return (
    <>
      <nav className="navbar">
        <div className="nav-left-group">
          <button
            type="button"
            className="btn-nav-back"
            onClick={onGoBack}
            disabled={!canGoBack}
            title="Volver a la pantalla anterior (Retroceder)"
            aria-label="Volver a la pantalla anterior"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <a
            href="#planificacion"
            onClick={(e) => { e.preventDefault(); onNavigate('planificacion'); }}
            className="nav-brand"
          >
            <img src="/assets/logo.png" alt="GO & train" style={{ height: '28px' }} />
            <span className="nav-brand-title">GO&Train</span>
          </a>

          <div className="undo-toolbar" title="Historial de cambios en la sesión actual">
            <button
              type="button"
              className="btn-undo-bar"
              onClick={undo}
              disabled={!canUndo}
              title="Deshacer último cambio (Ctrl+Z)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
              </svg>
            </button>
            <button
              type="button"
              className="btn-undo-bar"
              onClick={redo}
              disabled={!canRedo}
              title="Rehacer cambio (Ctrl+Y)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
              </svg>
            </button>
            {undoCount > 0 && (
              <span className="undo-count-badge">{undoCount}</span>
            )}
          </div>
        </div>

        <div className="nav-links" id="navMenu">
          <a
            href="#planificacion"
            onClick={(e) => { e.preventDefault(); onNavigate('planificacion'); }}
            className={isPlanificacion ? 'active' : ''}
          >
            Hoy
          </a>
          <a
            href="#agenda"
            onClick={(e) => { e.preventDefault(); onNavigate('agenda'); }}
            className={isAgenda ? 'active' : ''}
          >
            Agenda
          </a>
          <a
            href="#clientes"
            onClick={(e) => { e.preventDefault(); onNavigate('clientes'); }}
            className={isClientes ? 'active' : ''}
          >
            Clientes
          </a>
          <a
            href="#ejercicios"
            onClick={(e) => { e.preventDefault(); onNavigate('ejercicios'); }}
            className={isEjercicios ? 'active' : ''}
          >
            Ejercicios
          </a>
          <a
            href="#plantillas"
            onClick={(e) => { e.preventDefault(); onNavigate('plantillas'); }}
            className={isPlantillas ? 'active' : ''}
          >
            Plantillas
          </a>
          <a
            href="#maestros"
            onClick={(e) => { e.preventDefault(); onNavigate('maestros'); }}
            className={isMaestros ? 'active' : ''}
          >
            Configuración
          </a>
        </div>

        <div className="nav-right-group">
          <div className="nav-user">
            <span className="nav-user-greeting">
              <span className="greeting-prefix">Hola, </span>{displayShortName}
            </span>
            <button
              type="button"
              className="btn-logout"
              onClick={handleLogout}
              title="Cerrar Sesión"
              aria-label="Cerrar Sesión"
            >
              <svg
                className="logout-icon"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Barra inferior de iconos para Tablet y Móvil */}
      <nav className="bottom-tab-bar" aria-label="Navegación principal móvil y tablet">
        <a
          href="#planificacion"
          onClick={(e) => { e.preventDefault(); onNavigate('planificacion'); }}
          className={`bottom-tab-item ${isPlanificacion ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="m9 14 2 2 4-4" />
            </svg>
          </span>
          <span className="bottom-tab-label">Hoy</span>
        </a>

        <a
          href="#agenda"
          onClick={(e) => { e.preventDefault(); onNavigate('agenda'); }}
          className={`bottom-tab-item ${isAgenda ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="M8 14h.01" />
              <path d="M12 14h.01" />
              <path d="M16 14h.01" />
              <path d="M8 18h.01" />
              <path d="M12 18h.01" />
              <path d="M16 18h.01" />
            </svg>
          </span>
          <span className="bottom-tab-label">Agenda</span>
        </a>

        <a
          href="#clientes"
          onClick={(e) => { e.preventDefault(); onNavigate('clientes'); }}
          className={`bottom-tab-item ${isClientes ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <span className="bottom-tab-label">Clientes</span>
        </a>

        <a
          href="#ejercicios"
          onClick={(e) => { e.preventDefault(); onNavigate('ejercicios'); }}
          className={`bottom-tab-item ${isEjercicios ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6.5 6.5 11 11" />
              <path d="m21 21-1-1" />
              <path d="m3 3 1 1" />
              <path d="m18 22 4-4" />
              <path d="m2 6 4-4" />
              <path d="m3 10 7-7" />
              <path d="m14 21 7-7" />
            </svg>
          </span>
          <span className="bottom-tab-label">Ejercicios</span>
        </a>

        <a
          href="#plantillas"
          onClick={(e) => { e.preventDefault(); onNavigate('plantillas'); }}
          className={`bottom-tab-item ${isPlantillas ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </span>
          <span className="bottom-tab-label">Plantillas</span>
        </a>

        <a
          href="#maestros"
          onClick={(e) => { e.preventDefault(); onNavigate('maestros'); }}
          className={`bottom-tab-item ${isMaestros ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </span>
          <span className="bottom-tab-label">Configuración</span>
        </a>
      </nav>
    </>
  );
};

