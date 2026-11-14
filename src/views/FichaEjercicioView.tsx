import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface FichaEjercicioViewProps {
  exerciseId: string;
  onNavigate: (tab: string, param?: string) => void;
}

export const FichaEjercicioView: React.FC<FichaEjercicioViewProps> = ({
  exerciseId,
  onNavigate
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!exerciseId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'ejercicios', exerciseId));
        if (snap.exists()) {
          setData(snap.data());
        } else {
          setData(null);
        }
      } catch (e) {
        console.error('Error cargando ficha de ejercicio:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [exerciseId]);

  const formatTags = (val: any, isHighlight = false) => {
    if (!val || (Array.isArray(val) && val.length === 0)) {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No especificado</span>;
    }
    const arr = Array.isArray(val)
      ? val
      : String(val)
          .split(',')
          .map(x => x.trim())
          .filter(Boolean);
    const tagClass = isHighlight ? 'tag tag-highlight' : 'tag';
    return arr.map((item, idx) => (
      <span key={idx} className={tagClass}>
        {item}
      </span>
    ));
  };

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
        Cargando ficha del ejercicio...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: 50 }}>
        <h2>El ejercicio no existe en el catálogo</h2>
        <button type="button" className="btn-primary" onClick={() => onNavigate('ejercicios')}>
          Volver a Ejercicios
        </button>
      </div>
    );
  }

  const nombre = data.Nombre_Ejercicio || data.nombre_ejercicio || data.nombre || 'Sin nombre';
  const acronimo = data.Acrónimo || data.Acronimo || data.acronimo || 'EJ';
  const videoUrl =
    data.Video_URL || data.URL_Video || data['Video / Enlace'] || data.Video_Enlace || '';

  return (
    <div className="container">
      <div className="breadcrumb">
        <a
          href="#ejercicios"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={e => {
            e.preventDefault();
            onNavigate('ejercicios');
          }}
        >
          <span className="ui-icon">←</span>
          <span>Volver a Ejercicios</span>
        </a>{' '}
        &gt; <span>Ficha de Ejercicio</span>
      </div>

      <div className="page-header">
        <div className="ficha-ej-title-group">
          <span className="acronimo-badge">{acronimo}</span>
          <h1>{nombre}</h1>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
          ID: {exerciseId}
        </span>
      </div>

      <div className="ficha-ej-grid">
        <div className="card ficha-ej-card">
          <h3>
            <span className="ui-icon">📋</span>
            <span>Clasificación</span>
          </h3>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Bloque Recomendado</span>
            <div className="ficha-ej-info-val">{formatTags(data.Bloque || data.Fase_Bloque, true)}</div>
          </div>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Nivel de Dificultad</span>
            <div className="ficha-ej-info-val">{formatTags(data.Nivel_Dificultad || data.Nivel || data.nivel)}</div>
          </div>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Subcategoría</span>
            <div className="ficha-ej-info-val">{formatTags(data['Subcategoría'] || data.Subcategoria)}</div>
          </div>
        </div>

        <div className="card ficha-ej-card">
          <h3>
            <span className="ui-icon">⚙️</span>
            <span>Detalles de Ejecución</span>
          </h3>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Material Sugerido</span>
            <div className="ficha-ej-info-val">{formatTags(data.Material, true)}</div>
          </div>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Posición Inicial</span>
            <div className="ficha-ej-info-val">{formatTags(data['Posición'] || data.Posicion)}</div>
          </div>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Series y Repeticiones por defecto</span>
            <div className="ficha-ej-info-val">
              <span className="tag" style={{ background: '#dcfce7', borderColor: '#bbf7d0', color: '#166534' }}>
                {data.Series_Reps || data.Series_Defecto || data.Volumen_Series_Reps || 'No especificado'}
              </span>
            </div>
          </div>
          {(data.Precauciones || data.Precauciones_Lesion) &&
            String(data.Precauciones || data.Precauciones_Lesion).trim() !== '' && (
              <div className="warning-box" style={{ marginTop: 15 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="ui-icon">⚠️</span>
                  <span>Precauciones / Lesiones a vigilar</span>
                </span>
                <p>{data.Precauciones || data.Precauciones_Lesion}</p>
              </div>
            )}
        </div>

        <div className="card ficha-ej-card">
          <h3>
            <span className="ui-icon">💪</span>
            <span>Anatomía y Biomecánica</span>
          </h3>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Patrón de Movimiento</span>
            <div className="ficha-ej-info-val">{formatTags(data.Patron_Movimiento || data.Patron_Motor)}</div>
          </div>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Grupo Muscular Principal</span>
            <div className="ficha-ej-info-val">{formatTags(data.Grupo_Muscular, true)}</div>
          </div>
          <div className="ficha-ej-info-row">
            <span className="ficha-ej-info-label">Zona / Articulación</span>
            <div className="ficha-ej-info-val">{formatTags(data['Zona Articulación'] || data.Zona_Articulacion)}</div>
          </div>
        </div>

        <div className="card ficha-ej-card">
          <h3>
            <span className="ui-icon">🎥</span>
            <span>Multimedia</span>
          </h3>
          <div className="ficha-ej-info-row" style={{ borderBottom: 'none' }}>
            <span className="ficha-ej-info-label">Vídeo Demostrativo</span>
            <div>
              {videoUrl && String(videoUrl).trim() !== '' ? (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="video-btn"
                >
                  <span className="ui-icon">▶</span>
                  <span>Ver Vídeo del Ejercicio en YouTube</span>
                </a>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '5px 0 0 0' }}>
                  No hay ningún vídeo enlazado para este ejercicio.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
