import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
  asegurarUsuariosEspecialesApp
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
          ? 'SuperAdmin'
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
          let userDoc = await getDoc(doc(db, 'usuarios_app', emailKey));
          if (!userDoc.exists() && email !== emailKey) {
            userDoc = await getDoc(doc(db, 'usuarios_app', email));
          }

          if (userDoc.exists()) {
            const data = userDoc.data();
            if (esTvSala) {
              rolFinal = 'Proyector Sala';
              nombreFinal =
                data.nombre && data.nombre.toLowerCase() !== 'tvsala' ? data.nombre : 'TV Sala';
              aliasFinal = obtenerNombreCortoOAlias(nombreFinal, data.alias, 'TV Sala');
              if (data.rol !== 'Proyector Sala' || data.es_programador !== false) {
                await setDoc(
                  doc(db, 'usuarios_app', emailKey),
                  {
                    email: emailKey,
                    nombre: nombreFinal,
                    alias: aliasFinal,
                    rol: 'Proyector Sala',
                    es_programador: false
                  },
                  { merge: true }
                );
              }
            } else if (esSuper) {
              rolFinal = 'SuperAdmin';
              nombreFinal = data.nombre || data.alias || nombreFinal;
              aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
              if (data.rol !== 'SuperAdmin') {
                await setDoc(
                  doc(db, 'usuarios_app', emailKey),
                  { rol: 'SuperAdmin' },
                  { merge: true }
                );
              }
            } else {
              const rolEnDoc = String(data.rol || '').trim();
              rolFinal =
                rolEnDoc && rolEnDoc.toLowerCase() !== 'sin asignar' ? rolEnDoc : 'Básico';
              nombreFinal = data.nombre || data.alias || nombreFinal;
              aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
            }
          } else {
            await setDoc(
              doc(db, 'usuarios_app', emailKey),
              {
                email: emailKey,
                nombre: nombreFinal,
                alias: esTvSala ? 'TV Sala' : aliasFinal,
                rol: rolFinal,
                es_programador: esSuper
              },
              { merge: true }
            );
          }

          localStorage.setItem('userRole', rolFinal);
          localStorage.setItem('gym_user_name', nombreFinal);
          localStorage.setItem('gym_user_alias', aliasFinal);
          setRole(rolFinal);
          setUserName(nombreFinal);
          setUserAlias(aliasFinal);

          const [matriz, modulosCfg] = await Promise.all([
            cargarMatrizPermisos(),
            cargarModulosActivos(true),
            esSuper || esRolAdmin(rolFinal) ? asegurarUsuariosEspecialesApp() : Promise.resolve()
          ]);
          setPermissions(matriz[rolFinal] || PermisosPorDefectoParaRol(rolFinal));
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

  const login = async (email: string, pass: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const userEmail = (cred.user.email || email).trim();
    const emailKey = userEmail.toLowerCase();
    const esTvSala = esCorreoProyectorSala(emailKey);
    const esSuper = esCorreoSuperAdmin(emailKey);

    let rolFinal = esTvSala ? 'Proyector Sala' : esSuper ? 'SuperAdmin' : 'Básico';
    let nombreFinal = esTvSala
      ? 'TV Sala'
      : userEmail
      ? userEmail.split('@')[0]
      : 'Empleado';
    let aliasFinal = obtenerNombreCortoOAlias(nombreFinal);

    try {
      let snap = await getDoc(doc(db, 'usuarios_app', emailKey));
      if (!snap.exists() && userEmail !== emailKey) {
        snap = await getDoc(doc(db, 'usuarios_app', userEmail));
      }

      if (snap.exists()) {
        const data = snap.data();
        if (esTvSala) {
          rolFinal = 'Proyector Sala';
          nombreFinal =
            data.nombre && data.nombre.toLowerCase() !== 'tvsala' ? data.nombre : 'TV Sala';
          aliasFinal = obtenerNombreCortoOAlias(nombreFinal, data.alias, 'TV Sala');
          if (data.rol !== 'Proyector Sala' || data.es_programador !== false) {
            await setDoc(
              doc(db, 'usuarios_app', emailKey),
              {
                email: emailKey,
                nombre: nombreFinal,
                alias: aliasFinal,
                rol: 'Proyector Sala',
                es_programador: false
              },
              { merge: true }
            );
          }
        } else if (esSuper) {
          rolFinal = 'SuperAdmin';
          nombreFinal = data.nombre || data.alias || nombreFinal;
          aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
          if (data.rol !== 'SuperAdmin') {
            await setDoc(
              doc(db, 'usuarios_app', emailKey),
              { rol: 'SuperAdmin' },
              { merge: true }
            );
          }
        } else {
          const rolEnDoc = String(data.rol || '').trim();
          rolFinal =
            rolEnDoc && rolEnDoc.toLowerCase() !== 'sin asignar' ? rolEnDoc : 'Básico';
          nombreFinal = data.nombre || data.alias || nombreFinal;
          aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
        }
      } else {
        await setDoc(
          doc(db, 'usuarios_app', emailKey),
          {
            email: emailKey,
            nombre: nombreFinal,
            alias: esTvSala ? 'TV Sala' : aliasFinal,
            rol: rolFinal,
            es_programador: !esRolProyectorSala(rolFinal) && rolFinal !== 'Básico'
          },
          { merge: true }
        );
      }

      localStorage.setItem('userRole', rolFinal);
      localStorage.setItem('gym_user_name', nombreFinal);
      localStorage.setItem('gym_user_alias', aliasFinal);
      setRole(rolFinal);
      setUserName(nombreFinal);
      setUserAlias(aliasFinal);

      const [matriz, modulosCfg] = await Promise.all([
        cargarMatrizPermisos(),
        cargarModulosActivos(true)
      ]);
      setPermissions(matriz[rolFinal] || PermisosPorDefectoParaRol(rolFinal));
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
