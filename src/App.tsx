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
import { esRolProyectorSala, esRolBasico } from './services/maestrosService';
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
  const { user, role, isProyector, loading } = useAuth();
  const isBasico = esRolBasico(role);
  const [initialRoute] = useState<{ tab: string; param: string }>(() => leerRutaInicial());
  const [activeTab, setActiveTab] = useState<string>(initialRoute.tab);
  const [routeParam, setRouteParam] = useState<string>(initialRoute.param);
  const [historyStack, setHistoryStack] = useState<Array<{ tab: string; param: string }>>([]);

  useEffect(() => {
    if (!user) return;
    // Precargar datos en caché local IndexedDB para uso sin WiFi
    precargarDatosOfflineEnSegundoPlano();
    // Verificar/ejecutar backup diario automático a Google Drive en segundo plano
    asegurarBackupDiarioAutomaticoEnDrive();
  }, [user]);

  useEffect(() => {
    if (isProyector) {
      setActiveTab('pantalla_sala');
    } else if (isBasico && activeTab !== 'planificacion') {
      setActiveTab('planificacion');
      setRouteParam('');
      guardarRutaActiva('planificacion', '');
    }
  }, [isProyector, isBasico, activeTab]);

  useEffect(() => {
    const tabInicial = isProyector ? 'pantalla_sala' : isBasico ? 'planificacion' : activeTab;
    const paramInicial = isProyector || isBasico ? '' : routeParam;
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
      if (isBasico) {
        setActiveTab('planificacion');
        setRouteParam('');
        return;
      }
      if (event.state && event.state.tab && VALID_TABS.has(event.state.tab)) {
        const nextTab = event.state.tab;
        const nextParam = event.state.param || '';
        setActiveTab(nextTab);
        setRouteParam(nextParam);
        guardarRutaActiva(nextTab, nextParam);
        setHistoryStack(prev => (prev.length > 0 ? prev.slice(0, -1) : []));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const fromHash = leerRutaInicial();
        setActiveTab(fromHash.tab);
        setRouteParam(fromHash.param);
        guardarRutaActiva(fromHash.tab, fromHash.param);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isProyector, isBasico]);

  const handleNavigate = (tab: string, param = '') => {
    if (isProyector && tab !== 'pantalla_sala') {
      setActiveTab('pantalla_sala');
      return;
    }
    if (isBasico && tab !== 'planificacion') {
      setActiveTab('planificacion');
      setRouteParam('');
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
          } else if (esRolBasico(loggedInRole)) {
            setActiveTab('planificacion');
            setRouteParam('');
            guardarRutaActiva('planificacion', '');
          } else {
            const rutaPrevia = leerRutaInicial();
            setActiveTab(rutaPrevia.tab);
            setRouteParam(rutaPrevia.param);
            guardarRutaActiva(rutaPrevia.tab, rutaPrevia.param);
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
