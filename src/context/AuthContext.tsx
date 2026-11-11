import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { PermisoAccion } from '../types';
import {
  cargarMatrizPermisos,
  esRolProyectorSala,
  PermisosPorDefectoParaRol
} from '../services/maestrosService';

interface AuthContextType {
  user: User | null;
  userName: string;
  userAlias: string;
  role: string;
  permissions: Record<string, PermisoAccion>;
  isProyector: boolean;
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
  const [role, setRole] = useState<string>(() => localStorage.getItem('userRole') || 'programador');
  const [permissions, setPermissions] = useState<Record<string, PermisoAccion>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const email = currentUser.email || '';
        const emailKey = email.trim().toLowerCase();
        const esInvitado = emailKey === 'invitado@goandtrain.com';

        const savedRole = localStorage.getItem('userRole');
        const savedName = localStorage.getItem('gym_user_name');
        const savedAlias = localStorage.getItem('gym_user_alias');

        let rolFinal = esInvitado ? 'Proyector Sala' : (savedRole || 'programador');
        let nombreFinal = esInvitado ? 'Invitado Sala' : (savedName || (email ? email.split('@')[0] : 'Empleado'));
        let aliasFinal = savedAlias || obtenerNombreCortoOAlias(nombreFinal);

        try {
          let userDoc = await getDoc(doc(db, "usuarios_app", emailKey));
          if (!userDoc.exists() && email !== emailKey) {
            userDoc = await getDoc(doc(db, "usuarios_app", email));
          }

          if (userDoc.exists()) {
            const data = userDoc.data();
            if (esInvitado) {
              rolFinal = 'Proyector Sala';
              nombreFinal = (data.nombre && data.nombre !== 'invitado') ? data.nombre : 'Invitado Sala';
              aliasFinal = obtenerNombreCortoOAlias(nombreFinal, data.alias, 'Invitado');
            } else {
              rolFinal = data.rol || rolFinal;
              nombreFinal = data.nombre || data.alias || nombreFinal;
              aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
            }
          }

          localStorage.setItem('userRole', rolFinal);
          localStorage.setItem('gym_user_name', nombreFinal);
          localStorage.setItem('gym_user_alias', aliasFinal);
          setRole(rolFinal);
          setUserName(nombreFinal);
          setUserAlias(aliasFinal);

          // Cargar matriz de permisos
          const matriz = await cargarMatrizPermisos();
          setPermissions(matriz[rolFinal] || PermisosPorDefectoParaRol(rolFinal));
        } catch (err) {
          console.warn("Error cargando perfil de usuario:", err);
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
    const esInvitado = emailKey === 'invitado@goandtrain.com';

    let rolFinal = esInvitado ? 'Proyector Sala' : 'programador';
    let nombreFinal = esInvitado ? 'Invitado Sala' : (userEmail ? userEmail.split('@')[0] : 'Empleado');
    let aliasFinal = obtenerNombreCortoOAlias(nombreFinal);

    try {
      let snap = await getDoc(doc(db, "usuarios_app", emailKey));
      if (!snap.exists() && userEmail !== emailKey) {
        snap = await getDoc(doc(db, "usuarios_app", userEmail));
      }

      if (snap.exists()) {
        const data = snap.data();
        if (esInvitado) {
          rolFinal = 'Proyector Sala';
          nombreFinal = (data.nombre && data.nombre !== 'invitado') ? data.nombre : 'Invitado Sala';
          aliasFinal = obtenerNombreCortoOAlias(nombreFinal, data.alias, 'Invitado');
        } else {
          rolFinal = data.rol || rolFinal;
          nombreFinal = data.nombre || data.alias || nombreFinal;
          aliasFinal = obtenerNombreCortoOAlias(data.nombre, data.alias, nombreFinal);
        }
      } else {
        await setDoc(doc(db, "usuarios_app", emailKey), {
          email: emailKey,
          nombre: nombreFinal,
          alias: esInvitado ? 'Invitado' : aliasFinal,
          rol: rolFinal,
          es_programador: !esRolProyectorSala(rolFinal)
        }, { merge: true });
      }

      localStorage.setItem('userRole', rolFinal);
      localStorage.setItem('gym_user_name', nombreFinal);
      localStorage.setItem('gym_user_alias', aliasFinal);
      setRole(rolFinal);
      setUserName(nombreFinal);
      setUserAlias(aliasFinal);

      const matriz = await cargarMatrizPermisos();
      setPermissions(matriz[rolFinal] || PermisosPorDefectoParaRol(rolFinal));
    } catch (e) {
      console.warn("Error al resolver permisos tras login:", e);
    }

    return { role: rolFinal };
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Error en signOut:", e);
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

  const hasPermission = (moduloId: string, action: keyof PermisoAccion = 'ver'): boolean => {
    if (!role) return false;
    const rNorm = role.trim().toLowerCase();
    if (rNorm === 'admin' || rNorm === 'administrador' || rNorm === 'direccion') return true;
    if (esRolProyectorSala(role)) {
      return moduloId === 'pantalla_sala' && action === 'ver';
    }
    const moduloPerm = permissions[moduloId] || PermisosPorDefectoParaRol(role)[moduloId];
    if (!moduloPerm) return false;
    return Boolean(moduloPerm[action]);
  };

  const isProyector = esRolProyectorSala(role);

  return (
    <AuthContext.Provider
      value={{
        user,
        userName,
        userAlias,
        role,
        permissions,
        isProyector,
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
