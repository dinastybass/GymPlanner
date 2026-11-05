import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface LoginViewProps {
  onSuccess: (role: string) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await login(email.trim(), password);
      onSuccess(res.role);
    } catch (err: any) {
      console.error("Login error:", err);
      const msg = err.message || '';
      if (msg.includes("user-not-found") || msg.includes("wrong-password") || msg.includes("invalid-credential")) {
        setErrorMsg("Credenciales incorrectas.");
      } else {
        setErrorMsg("Error al iniciar sesión: " + (err.message || 'Verifica tus datos'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '20px'
    }}>
      <div className="login-card" style={{
        background: 'var(--surface)',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
        width: '100%',
        maxWidth: '360px',
        border: '1px solid #e5e7eb',
        textAlign: 'center'
      }}>
        <div className="logo-container" style={{ marginBottom: '25px' }}>
          <img src="/assets/logo.png" alt="GO & train" style={{ width: '180px', height: 'auto' }} />
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '20px', color: '#1e293b' }}>
          Acceso a GymPlanner
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="input-group" style={{ marginBottom: '18px', textAlign: 'left' }}>
            <label htmlFor="email" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
              Correo electrónico
            </label>
            <input
              type="email"
              id="email"
              placeholder="usuario@gogym.com"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
                fontSize: '0.95rem'
              }}
            />
          </div>

          <div className="input-group" style={{ marginBottom: '22px', textAlign: 'left' }}>
            <label htmlFor="password" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
              Contraseña
            </label>
            <input
              type="password"
              id="password"
              placeholder="••••••••"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
                fontSize: '0.95rem'
              }}
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '12px', fontSize: '1rem' }}
          >
            {loading ? 'Verificando...' : 'Iniciar Sesión'}
          </button>
        </form>

        {errorMsg && (
          <div style={{
            color: '#dc2626',
            fontSize: '0.85rem',
            marginTop: '15px',
            padding: '10px',
            background: '#fef2f2',
            borderRadius: '6px',
            border: '1px solid #fecaca',
            textAlign: 'left'
          }}>
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
};
