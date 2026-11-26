import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UndoProvider } from './context/UndoContext';
import { Navbar } from './components/Navbar';
import { OfflineStatusBanner } from './components/OfflineStatusBanner';
import { ToastNotification } from './components/ToastNotification';
import { LoginView } from './views/LoginView';
import { PlanificacionView } from './views/PlanificacionView';
import { ProgramarSesionView } from './views/ProgramarSesionView';
import { AgendaView } from './views/AgendaView';
import { ClientesView } from './views/ClientesView';
import { FichaClienteView } from './views/FichaClienteView';
import { EjerciciosView } from './views/EjerciciosView';
import { FichaEjercicioView } from './views/FichaEjercicioView';
import { PlantillasView } from './views/PlantillasView';
import { EditarPlantillaView } from './views/EditarPlantillaView';
import { MaestrosView } from './views/MaestrosView';
import { ProgramacionesPendientesView } from './views/ProgramacionesPendientesView';
import { PantallaSalaView } from './views/PantallaSalaView';
import { esRolProyectorSala } from './services/maestrosService';
import { precargarDatosOfflineEnSegundoPlano } from './services/offlineSyncService';
import { asegurarBackupDiarioAutomaticoEnDrive } from './services/backupService';

const VALID_TABS = new Set([
  'planificacion',
  'programar_sesion',
  'agenda',
  'clientes',
  'ficha_cliente',
  'ejercicios',
  'ficha_ejercicio',
  'plantillas',
  'editar_plantilla',
  'maestros',
  'pendientes',
  'pantalla_sala'
]);

const ROUTE_STORAGE_KEY = 'gym_active_route_v1';

function leerRutaInicial(): { tab: string; param: string } {
  try {
    const rawHash = (window.location.hash || '').replace(/^#/, '').trim();
    if (rawHash) {
      const slashIdx = rawHash.indexOf('/');
      const tabFromHash = slashIdx === -1 ? rawHash : rawHash.slice(0, slashIdx);
      const paramFromHash =
        slashIdx === -1 ? '' : decodeURIComponent(rawHash.slice(slashIdx + 1));

      if (VALID_TABS.has(tabFromHash)) {
        return { tab: tabFromHash, param: paramFromHash };
      }
    }

    const stored = sessionStorage.getItem(ROUTE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.tab === 'string' && VALID_TABS.has(parsed.tab)) {
        return { tab: parsed.tab, param: String(parsed.param || '') };
      }
    }
  } catch {
    // Fallback below
  }
  return { tab: 'planificacion', param: '' };
}

function guardarRutaActiva(tab: string, param: string) {
  try {
    sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ tab, param }));
  } catch {
    // Ignore storage errors
  }
}

const AppContent: React.FC = () => {
  const { user, role, permissions, isProyector, esModuloActivo, hasPermission, loading } = useAuth();
  const [initialRoute] = useState<{ tab: string; param: string }>(() => leerRutaInicial());
  const [activeTab, setActiveTab] = useState<string>(initialRoute.tab);
  const [routeParam, setRouteParam] = useState<string>(initialRoute.param);
  const [historyStack, setHistoryStack] = useState<Array<{ tab: string; param: string }>>([]);

  const canAccessTab = React.useCallback(
    (tab: string): boolean => {
      if (isProyector) return tab === 'pantalla_sala';
      switch (tab) {
        case 'planificacion':
          return hasPermission('planificacion', 'ver');
        case 'programar_sesion':
          return hasPermission('programar_sesiones', 'ver');
        case 'agenda':
          return hasPermission('agenda', 'ver');
        case 'pendientes':
          return hasPermission('programaciones_pendientes', 'ver');
        case 'clientes':
        case 'ficha_cliente':
          return hasPermission('clientes', 'ver');
        case 'ejercicios':
        case 'ficha_ejercicio':
          return hasPermission('ejercicios', 'ver');
        case 'plantillas':
        case 'editar_plantilla':
          return esModuloActivo('plantillas') && hasPermission('plantillas', 'ver');
        case 'maestros':
          return (
            hasPermission('maestros', 'ver') ||
            hasPermission('perfiles_roles', 'ver') ||
            hasPermission('copias_seguridad', 'ver')
          );
        case 'pantalla_sala':
          return esModuloActivo('tv') && hasPermission('pantalla_sala', 'ver');
        default:
          return false;
      }
    },
    [isProyector, hasPermission, esModuloActivo, permissions, role]
  );

  const obtenerTabPermitidaPorDefecto = React.useCallback((): string => {
    if (isProyector) return 'pantalla_sala';
    const ordenCandidatas = [
      'planificacion',
      'agenda',
      'clientes',
      'ejercicios',
      'plantillas',
      'maestros',
      'pantalla_sala'
    ];
    for (const candidata of ordenCandidatas) {
      if (canAccessTab(candidata)) return candidata;
    }
    return 'planificacion';
  }, [isProyector, canAccessTab]);

  useEffect(() => {
    if (!user || isProyector) return;
    // Precargar datos en caché local IndexedDB para uso sin WiFi
    precargarDatosOfflineEnSegundoPlano();
    // Verificar/ejecutar backup diario automático a Google Drive en segundo plano si tiene permiso
    if (hasPermission('copias_seguridad', 'crear')) {
      asegurarBackupDiarioAutomaticoEnDrive();
    }
  }, [user, isProyector, hasPermission]);

  useEffect(() => {
    if (!user || loading) return;
    if (isProyector) {
      if (activeTab !== 'pantalla_sala') {
        setActiveTab('pantalla_sala');
        setRouteParam('');
      }
      return;
    }
    if (!canAccessTab(activeTab)) {
      const fallbackTab = obtenerTabPermitidaPorDefecto();
      if (activeTab !== fallbackTab) {
        setActiveTab(fallbackTab);
        setRouteParam('');
        guardarRutaActiva(fallbackTab, '');
        window.history.replaceState({ tab: fallbackTab, param: '' }, '', `#${fallbackTab}`);
      }
    }
  }, [user, loading, isProyector, activeTab, canAccessTab, obtenerTabPermitidaPorDefecto]);

  useEffect(() => {
    const tabInicial = isProyector
      ? 'pantalla_sala'
      : canAccessTab(activeTab)
      ? activeTab
      : obtenerTabPermitidaPorDefecto();
    const paramInicial = isProyector || tabInicial !== activeTab ? '' : routeParam;
    const hashInicial = paramInicial
      ? `#${tabInicial}/${encodeURIComponent(paramInicial)}`
      : `#${tabInicial}`;

    window.history.replaceState({ tab: tabInicial, param: paramInicial }, '', hashInicial);
    guardarRutaActiva(tabInicial, paramInicial);

    const handlePopState = (event: PopStateEvent) => {
      if (isProyector) {
        setActiveTab('pantalla_sala');
        return;
      }
      if (event.state && event.state.tab && VALID_TABS.has(event.state.tab)) {
        const nextTab = event.state.tab;
        const nextParam = event.state.param || '';
        if (!canAccessTab(nextTab)) {
          const fallback = obtenerTabPermitidaPorDefecto();
          setActiveTab(fallback);
          setRouteParam('');
          guardarRutaActiva(fallback, '');
          return;
        }
        setActiveTab(nextTab);
        setRouteParam(nextParam);
        guardarRutaActiva(nextTab, nextParam);
        setHistoryStack(prev => (prev.length > 0 ? prev.slice(0, -1) : []));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const fromHash = leerRutaInicial();
        const targetTab = canAccessTab(fromHash.tab)
          ? fromHash.tab
          : obtenerTabPermitidaPorDefecto();
        const targetParam = targetTab === fromHash.tab ? fromHash.param : '';
        setActiveTab(targetTab);
        setRouteParam(targetParam);
        guardarRutaActiva(targetTab, targetParam);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isProyector, canAccessTab, obtenerTabPermitidaPorDefecto]);

  const handleNavigate = (tab: string, param = '') => {
    if (isProyector && tab !== 'pantalla_sala') {
      setActiveTab('pantalla_sala');
      return;
    }
    if (!canAccessTab(tab)) {
      return;
    }
    if (tab === activeTab && param === routeParam) return;

    setHistoryStack(prev => [...prev, { tab: activeTab, param: routeParam }]);
    setActiveTab(tab);
    setRouteParam(param);
    guardarRutaActiva(tab, param);

    const hash = param ? `#${tab}/${encodeURIComponent(param)}` : `#${tab}`;
    window.history.pushState({ tab, param }, '', hash);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoBack = () => {
    if (historyStack.length > 0) {
      window.history.back();
    }
  };

  if (loading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 15,
          color: '#64748b'
        }}
      >
        <img src="/assets/logo.png" alt="GO & train" style={{ height: 42 }} />
        <div>Cargando GymPlanner...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onSuccess={loggedInRole => {
          if (esRolProyectorSala(loggedInRole)) {
            setActiveTab('pantalla_sala');
            setRouteParam('');
            guardarRutaActiva('pantalla_sala', '');
          } else {
            const rutaPrevia = leerRutaInicial();
            setActiveTab(rutaPrevia.tab || 'planificacion');
            setRouteParam(rutaPrevia.param || '');
            guardarRutaActiva(rutaPrevia.tab || 'planificacion', rutaPrevia.param || '');
          }
        }}
      />
    );
  }

  if (activeTab === 'pantalla_sala' || isProyector) {
    return (
      <>
        <OfflineStatusBanner />
        <PantallaSalaView onBack={() => handleNavigate('planificacion')} />
      </>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <OfflineStatusBanner />
      <Navbar
        activeTab={activeTab}
        onNavigate={handleNavigate}
        canGoBack={historyStack.length > 0}
        onGoBack={handleGoBack}
      />

      <main style={{ flexGrow: 1 }}>
        {activeTab === 'planificacion' && <PlanificacionView onNavigate={handleNavigate} />}
        {activeTab === 'programar_sesion' && (
          <ProgramarSesionView sessionId={routeParam} onNavigate={handleNavigate} />
        )}
        {activeTab === 'agenda' && <AgendaView onNavigate={handleNavigate} />}
        {activeTab === 'clientes' && <ClientesView onNavigate={handleNavigate} />}
        {activeTab === 'ficha_cliente' && (
          <FichaClienteView clientId={routeParam} onNavigate={handleNavigate} />
        )}
        {activeTab === 'ejercicios' && <EjerciciosView onNavigate={handleNavigate} />}
        {activeTab === 'ficha_ejercicio' && (
          <FichaEjercicioView exerciseId={routeParam} onNavigate={handleNavigate} />
        )}
        {activeTab === 'plantillas' && <PlantillasView onNavigate={handleNavigate} />}
        {activeTab === 'editar_plantilla' && (
          <EditarPlantillaView plantillaId={routeParam} onNavigate={handleNavigate} />
        )}
        {activeTab === 'maestros' && <MaestrosView />}
        {activeTab === 'pendientes' && (
          <ProgramacionesPendientesView onNavigate={handleNavigate} />
        )}
      </main>

      <footer className="app-legal-footer">
        <div className="app-legal-footer-inner">
          <span>GO&amp;Train · GymPlanner - 2026</span>
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="legal-footer-link"
          >
            Política de Privacidad
          </a>
        </div>
      </footer>

      <ToastNotification />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <UndoProvider>
        <AppContent />
      </UndoProvider>
    </AuthProvider>
  );
};

export default App;
