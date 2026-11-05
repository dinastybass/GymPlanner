import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UndoProvider } from './context/UndoContext';
import { Navbar } from './components/Navbar';
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

const AppContent: React.FC = () => {
  const { user, isProyector, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('planificacion');
  const [routeParam, setRouteParam] = useState<string>('');
  const [historyStack, setHistoryStack] = useState<Array<{ tab: string; param: string }>>([]);

  useEffect(() => {
    if (isProyector) {
      setActiveTab('pantalla_sala');
    }
  }, [isProyector]);

  useEffect(() => {
    window.history.replaceState({ tab: 'planificacion', param: '' }, '', '#planificacion');

    const handlePopState = (event: PopStateEvent) => {
      if (isProyector) {
        setActiveTab('pantalla_sala');
        return;
      }
      if (event.state && event.state.tab) {
        setActiveTab(event.state.tab);
        setRouteParam(event.state.param || '');
        setHistoryStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : []));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isProyector]);

  const handleNavigate = (tab: string, param = '') => {
    if (isProyector && tab !== 'pantalla_sala') {
      setActiveTab('pantalla_sala');
      return;
    }
    if (tab === activeTab && param === routeParam) return;

    setHistoryStack((prev) => [...prev, { tab: activeTab, param: routeParam }]);
    setActiveTab(tab);
    setRouteParam(param);

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
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 15,
        color: '#64748b'
      }}>
        <img src="/assets/logo.png" alt="GO & train" style={{ height: 42 }} />
        <div>Cargando GymPlanner...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onSuccess={(role) => {
          if (esRolProyectorSala(role)) {
            setActiveTab('pantalla_sala');
          } else {
            setActiveTab('planificacion');
          }
        }}
      />
    );
  }

  if (activeTab === 'pantalla_sala' || isProyector) {
    return <PantallaSalaView onBack={() => handleNavigate('planificacion')} />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Navbar
        activeTab={activeTab}
        onNavigate={handleNavigate}
        canGoBack={historyStack.length > 0}
        onGoBack={handleGoBack}
      />

      <main style={{ flexGrow: 1 }}>
        {activeTab === 'planificacion' && <PlanificacionView onNavigate={handleNavigate} />}
        {activeTab === 'programar_sesion' && <ProgramarSesionView sessionId={routeParam} onNavigate={handleNavigate} />}
        {activeTab === 'agenda' && <AgendaView onNavigate={handleNavigate} />}
        {activeTab === 'clientes' && <ClientesView onNavigate={handleNavigate} />}
        {activeTab === 'ficha_cliente' && <FichaClienteView clientId={routeParam} onNavigate={handleNavigate} />}
        {activeTab === 'ejercicios' && <EjerciciosView onNavigate={handleNavigate} />}
        {activeTab === 'ficha_ejercicio' && <FichaEjercicioView exerciseId={routeParam} onNavigate={handleNavigate} />}
        {activeTab === 'plantillas' && <PlantillasView onNavigate={handleNavigate} />}
        {activeTab === 'editar_plantilla' && <EditarPlantillaView plantillaId={routeParam} onNavigate={handleNavigate} />}
        {activeTab === 'maestros' && <MaestrosView />}
        {activeTab === 'pendientes' && <ProgramacionesPendientesView onNavigate={handleNavigate} />}
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
