import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { PermisoAccion } from '../types';
import {
  cargarMatrizPermisos,
  cargarModulosActivos,
  guardarModulosActivos,
  MODULOS_ACTIVOS_DEFAULT,
  ModuloAppId,
  esRolAdmin,
  esRolSuperAdmin,
  esRolProyectorSala,
  esCorreoSuperAdmin,
  esCorreoProyectorSala,
  PermisosPorDefectoParaRol,
  obtenerPermisosRolDesdeMatriz,
  asegurarUsuariosEspecialesApp,
  obtenerMapaUsuariosConfigurados,
  onCatalogoMaestrosChanged
} from '../services/maestrosService';

interface AuthContextType {
  user: User | null;
  userName: string;
  userAlias: string;
  role: string;
  permissions: Record<string, PermisoAccion>;
  isProyector: boolean;
  isSuperAdmin: boolean;
  modulosActivos: Record<ModuloAppId, boolean>;
  esModuloActivo: (moduloId: ModuloAppId) => boolean;
  actualizarModulosActivos: (nuevos: Record<ModuloAppId, boolean>) => Promise<void>;
  loading: boolean;
  login: (email: string, pass: string) => Promise<{ role: string }>;
  logout: () => Promise<void>;
  hasPermission: (moduloId: string, action?: keyof PermisoAccion) => boolean;
}

const obtenerNombreCortoOAlias = (nombre?: string, alias?: string, fallback = 'Usuario'): string => {
  const aliasLimpio = (alias || '').trim();
  const nombreLimpio = (nombre || '').trim();
  if (aliasLimpio && aliasLimpio.toLowerCase() !== nombreLimpio.toLowerCase()) {
    return aliasLimpio;
  }
  const base = aliasLimpio || nombreLimpio || fallback;
  return base.split(/\s+/)[0] || fallback;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userName, setUserName] = useState<string>(() => localStorage.getItem('gym_user_name') || 'Usuario');
  const [userAlias, setUserAlias] = useState<string>(() => {
    const savedAlias = localStorage.getItem('gym_user_alias');
    if (savedAlias) return savedAlias;
    const savedName = localStorage.getItem('gym_user_name') || 'Usuario';
    return obtenerNombreCortoOAlias(savedName);
  });
  const [role, setRole] = useState<string>(() => localStorage.getItem('userRole') || 'Básico');
  const [permissions, setPermissions] = useState<Record<string, PermisoAccion>>({});
  const [modulosActivos, setModulosActivos] = useState<Record<ModuloAppId, boolean>>(() => ({
    ...MODULOS_ACTIVOS_DEFAULT
  }));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const email = currentUser.email || '';
        const emailKey = email.trim().toLowerCase();
        const esTvSala = esCorreoProyectorSala(emailKey);
        const esSuper = esCorreoSuperAdmin(emailKey);

        const savedRole = localStorage.getItem('userRole');
        const savedName = localStorage.getItem('gym_user_name');
        const savedAlias = localStorage.getItem('gym_user_alias');

        let rolFinal = esTvSala
          ? 'Proyector Sala'
          : esSuper
          ? 'admin'
          : savedRole && savedRole !== 'Sin asignar'
          ? savedRole
          : 'Básico';
        let nombreFinal = esTvSala
          ? 'TV Sala'
          : savedName || (email ? email.split('@')[0] : 'Empleado');
        let aliasFinal = savedAlias || obtenerNombreCortoOAlias(nombreFinal);

        // Actualizar estado sincrónicamente antes de esperar a Firestore para evitar parpadeos o vistas indebidas
        setRole(rolFinal);
        setUserName(nombreFinal);
        setUserAlias(aliasFinal);
        setUser(currentUser);

        try {
          let userDoc = null;
          try {
            userDoc = await getDoc(doc(db, 'usuarios_app', emailKey));
            if (!userDoc.exists() && email !== emailKey) {
              userDoc = await getDoc(doc(db, 'usuarios_app', email));
            }
          } catch {
            userDoc = null;
          }

          if (userDoc && userDoc.exists()) {
            const data = userDoc.data();
            if (esTvSala) {
              rolFinal = 'Proyector Sala';
              nombreFinal =
                data.nombre && data.nombre.toLowerCase() !== 'tvsala' ? data.nombre : 'TV Sala';
              aliasFinal = obtenerNombreCortoOAlias(nombreFinal, data.alias, 'TV Sala');
            } else if (esSuper) {
              rolFinal = 'admin';
              nombreFinal = data.nombre || data.alias || nombreFinal;
              aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
            } else {
              const rolEnDoc = String(data.rol || '').trim();
              rolFinal =
                rolEnDoc && rolEnDoc.toLowerCase() !== 'sin asignar' ? rolEnDoc : 'Básico';
              nombreFinal = data.nombre || data.alias || nombreFinal;
              aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
            }
          }

          if (!esTvSala && !esSuper) {
            try {
              const usuariosCfg = await obtenerMapaUsuariosConfigurados();
              const uCfg = usuariosCfg[emailKey] || usuariosCfg[email];
              if (uCfg) {
                const rolEnCfg = String(uCfg.rol || '').trim();
                if (rolEnCfg && rolEnCfg.toLowerCase() !== 'sin asignar') {
                  rolFinal = rolEnCfg;
                }
                if (uCfg.nombre || uCfg.alias) {
                  nombreFinal = uCfg.nombre || uCfg.alias;
                  aliasFinal = obtenerNombreCortoOAlias(uCfg.nombre, uCfg.alias, nombreFinal);
                }
              }
            } catch {}
          }

          localStorage.setItem('userRole', rolFinal);
          localStorage.setItem('gym_user_name', nombreFinal);
          localStorage.setItem('gym_user_alias', aliasFinal);
          setRole(rolFinal);
          setUserName(nombreFinal);
          setUserAlias(aliasFinal);

          if (esSuper || esRolAdmin(rolFinal)) {
            await asegurarUsuariosEspecialesApp();
          }

          const [matriz, modulosCfg] = await Promise.all([
            cargarMatrizPermisos(),
            cargarModulosActivos(true)
          ]);
          setPermissions(obtenerPermisosRolDesdeMatriz(matriz, rolFinal));
          setModulosActivos(modulosCfg);
        } catch (err) {
          console.warn('Error cargando perfil de usuario:', err);
          setPermissions(PermisosPorDefectoParaRol(rolFinal));
        }
      } else {
        setUser(null);
        setRole('');
        setUserName('');
        setUserAlias('');
        setPermissions({});
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Sincronización inmediata al cambiar la caché compartida (misma pestaña u otras pestañas)
  useEffect(() => {
    return onCatalogoMaestrosChanged(async () => {
      try {
        const [matriz, modulosCfg] = await Promise.all([
          cargarMatrizPermisos(),
          cargarModulosActivos()
        ]);
        setModulosActivos(modulosCfg);
        if (role) {
          setPermissions(obtenerPermisosRolDesdeMatriz(matriz, role));
        }
      } catch (e) {
        console.warn('Error sincronizando permisos/módulos:', e);
      }
    });
  }, [role]);

  // Escucha en tiempo real (Firestore onSnapshot) para aplicar al instante cambios de permisos, módulos o rol de usuario
  useEffect(() => {
    if (!user) return;
    const email = user.email || '';
    const emailKey = email.trim().toLowerCase();
    const esTvSala = esCorreoProyectorSala(emailKey);
    const esSuper = esCorreoSuperAdmin(emailKey);

    const unsubPermisos = onSnapshot(
      doc(db, 'maestros', 'config_permisos_roles'),
      async () => {
        try {
          const matriz = await cargarMatrizPermisos(true);
          if (role) {
            setPermissions(obtenerPermisosRolDesdeMatriz(matriz, role));
          }
        } catch {
          // ignore snapshot error
        }
      },
      () => {}
    );

    const unsubModulos = onSnapshot(
      doc(db, 'maestros', 'config_modulos_app'),
      async () => {
        try {
          const modulosCfg = await cargarModulosActivos(true);
          setModulosActivos(modulosCfg);
        } catch {
          // ignore snapshot error
        }
      },
      () => {}
    );

    let unsubUserDoc: (() => void) | null = null;
    if (emailKey && !esTvSala && !esSuper) {
      unsubUserDoc = onSnapshot(
        doc(db, 'usuarios_app', emailKey),
        async (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          const nuevoRol = String(data.rol || '').trim();
          const rolResuelto =
            nuevoRol && nuevoRol.toLowerCase() !== 'sin asignar' ? nuevoRol : 'Básico';
          if (rolResuelto !== role) {
            localStorage.setItem('userRole', rolResuelto);
            setRole(rolResuelto);
            const matriz = await cargarMatrizPermisos();
            setPermissions(obtenerPermisosRolDesdeMatriz(matriz, rolResuelto));
          }
          if (data.nombre || data.alias) {
            const nuevoNombre = data.nombre || data.alias || userName;
            const nuevoAlias = obtenerNombreCortoOAlias(data.nombre, data.alias, nuevoNombre);
            localStorage.setItem('gym_user_name', nuevoNombre);
            localStorage.setItem('gym_user_alias', nuevoAlias);
            setUserName(nuevoNombre);
            setUserAlias(nuevoAlias);
          }
        },
        () => {}
      );
    }

    return () => {
      unsubPermisos();
      unsubModulos();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, [user, role, userName]);

  const login = async (email: string, pass: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const userEmail = (cred.user.email || email).trim();
    const emailKey = userEmail.toLowerCase();
    const esTvSala = esCorreoProyectorSala(emailKey);
    const esSuper = esCorreoSuperAdmin(emailKey);

    let rolFinal = esTvSala ? 'Proyector Sala' : esSuper ? 'admin' : 'Básico';
    let nombreFinal = esTvSala
      ? 'TV Sala'
      : userEmail
      ? userEmail.split('@')[0]
      : 'Empleado';
    let aliasFinal = obtenerNombreCortoOAlias(nombreFinal);

    try {
      let snap = null;
      try {
        snap = await getDoc(doc(db, 'usuarios_app', emailKey));
        if (!snap.exists() && userEmail !== emailKey) {
          snap = await getDoc(doc(db, 'usuarios_app', userEmail));
        }
      } catch {
        snap = null;
      }

      if (snap && snap.exists()) {
        const data = snap.data();
        if (esTvSala) {
          rolFinal = 'Proyector Sala';
          nombreFinal =
            data.nombre && data.nombre.toLowerCase() !== 'tvsala' ? data.nombre : 'TV Sala';
          aliasFinal = obtenerNombreCortoOAlias(nombreFinal, data.alias, 'TV Sala');
        } else if (esSuper) {
          rolFinal = 'admin';
          nombreFinal = data.nombre || data.alias || nombreFinal;
          aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
        } else {
          const rolEnDoc = String(data.rol || '').trim();
          rolFinal =
            rolEnDoc && rolEnDoc.toLowerCase() !== 'sin asignar' ? rolEnDoc : 'Básico';
          nombreFinal = data.nombre || data.alias || nombreFinal;
          aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
        }
      }

      if (!esTvSala && !esSuper) {
        try {
          const usuariosCfg = await obtenerMapaUsuariosConfigurados();
          const uCfg = usuariosCfg[emailKey] || usuariosCfg[userEmail];
          if (uCfg) {
            const rolEnCfg = String(uCfg.rol || '').trim();
            if (rolEnCfg && rolEnCfg.toLowerCase() !== 'sin asignar') {
              rolFinal = rolEnCfg;
            }
            if (uCfg.nombre || uCfg.alias) {
              nombreFinal = uCfg.nombre || uCfg.alias;
              aliasFinal = obtenerNombreCortoOAlias(uCfg.nombre, uCfg.alias, nombreFinal);
            }
          }
        } catch {}
      }

      localStorage.setItem('userRole', rolFinal);
      localStorage.setItem('gym_user_name', nombreFinal);
      localStorage.setItem('gym_user_alias', aliasFinal);
      setRole(rolFinal);
      setUserName(nombreFinal);
      setUserAlias(aliasFinal);

      if (esSuper || esRolAdmin(rolFinal)) {
        await asegurarUsuariosEspecialesApp();
      }

      const [matriz, modulosCfg] = await Promise.all([
        cargarMatrizPermisos(),
        cargarModulosActivos(true)
      ]);
      setPermissions(obtenerPermisosRolDesdeMatriz(matriz, rolFinal));
      setModulosActivos(modulosCfg);
    } catch (e) {
      console.warn('Error al resolver permisos tras login:', e);
    }

    return { role: rolFinal };
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Error en signOut:', e);
    } finally {
      localStorage.removeItem('userRole');
      localStorage.removeItem('gym_user_name');
      localStorage.removeItem('gym_user_alias');
      setUser(null);
      setRole('');
      setUserName('');
      setUserAlias('');
      setPermissions({});
    }
  };

  const esModuloActivo = useCallback(
    (moduloId: ModuloAppId): boolean => {
      return modulosActivos[moduloId] !== false;
    },
    [modulosActivos]
  );

  const actualizarModulosActivos = useCallback(
    async (nuevos: Record<ModuloAppId, boolean>) => {
      setModulosActivos(nuevos);
      await guardarModulosActivos(nuevos);
    },
    []
  );

  const isSuperAdmin = esCorreoSuperAdmin(user?.email) || esRolSuperAdmin(role);
  const isProyector = esCorreoProyectorSala(user?.email) || esRolProyectorSala(role);

  const hasPermission = (moduloId: string, action: keyof PermisoAccion = 'ver'): boolean => {
    if (!role) return false;
    // Si el módulo de la aplicación está desactivado por el SuperAdmin, queda deshabilitado para todos
    if (moduloId === 'plantillas' && !esModuloActivo('plantillas')) return false;
    if (moduloId === 'pantalla_sala' && !esModuloActivo('tv')) return false;

    if (isSuperAdmin || esRolAdmin(role)) return true;
    if (isProyector) {
      return moduloId === 'pantalla_sala' && action === 'ver';
    }
    const moduloPerm = permissions[moduloId] || PermisosPorDefectoParaRol(role)[moduloId];
    if (!moduloPerm) return false;
    return Boolean(moduloPerm[action]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userName,
        userAlias,
        role,
        permissions,
        isProyector,
        isSuperAdmin,
        modulosActivos,
        esModuloActivo,
        actualizarModulosActivos,
        loading,
        login,
        logout,
        hasPermission
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
