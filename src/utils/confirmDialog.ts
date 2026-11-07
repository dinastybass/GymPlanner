export interface ConfirmDialogOptions {
  titulo?: string;
  textoConfirmar?: string;
  textoCancelar?: string;
  danger?: boolean;
}

export function confirmarDialogo(
  mensaje: string,
  options?: ConfirmDialogOptions
): Promise<boolean> {
  if (typeof document === 'undefined') {
    return Promise.resolve(true);
  }

  const titulo = options?.titulo || 'Confirmar acción';
  const textoConfirmar = options?.textoConfirmar || 'Confirmar';
  const textoCancelar = options?.textoCancelar || 'Cancelar';
  const danger = options?.danger !== undefined ? options.danger : true;

  return new Promise<boolean>(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(15, 23, 42, 0.55)',
      'backdrop-filter: blur(2px)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 99999',
      'padding: 16px',
      'font-family: Inter, system-ui, -apple-system, sans-serif'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background: #ffffff',
      'border-radius: 14px',
      'max-width: 440px',
      'width: 100%',
      'padding: 22px 24px',
      'box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.18), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
      'border: 1px solid #e2e8f0',
      'color: #0f172a'
    ].join(';');

    const titleEl = document.createElement('div');
    titleEl.style.cssText = [
      'font-size: 1.05rem',
      'font-weight: 700',
      'color: #0f172a',
      'margin-bottom: 10px',
      'display: flex',
      'align-items: center',
      'gap: 8px'
    ].join(';');
    titleEl.textContent = titulo;

    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = [
      'font-size: 0.9rem',
      'line-height: 1.5',
      'color: #475569',
      'white-space: pre-line',
      'margin-bottom: 20px'
    ].join(';');
    bodyEl.textContent = mensaje;

    const actionsEl = document.createElement('div');
    actionsEl.style.cssText = [
      'display: flex',
      'justify-content: flex-end',
      'gap: 10px'
    ].join(';');

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.textContent = textoCancelar;
    btnCancel.style.cssText = [
      'padding: 8px 16px',
      'border-radius: 8px',
      'border: 1px solid #cbd5e1',
      'background: #ffffff',
      'color: #334155',
      'font-size: 0.875rem',
      'font-weight: 600',
      'cursor: pointer'
    ].join(';');

    const btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.textContent = textoConfirmar;
    btnConfirm.style.cssText = [
      'padding: 8px 16px',
      'border-radius: 8px',
      'border: none',
      `background: ${danger ? '#dc2626' : '#0d9488'}`,
      'color: #ffffff',
      'font-size: 0.875rem',
      'font-weight: 600',
      'cursor: pointer'
    ].join(';');

    let settled = false;
    const cleanup = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKeyDown);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      resolve(result);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(true);
      }
    };

    btnCancel.addEventListener('click', () => cleanup(false));
    btnConfirm.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', e => {
      if (e.target === overlay) cleanup(false);
    });
    window.addEventListener('keydown', onKeyDown);

    actionsEl.appendChild(btnCancel);
    actionsEl.appendChild(btnConfirm);
    card.appendChild(titleEl);
    card.appendChild(bodyEl);
    card.appendChild(actionsEl);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    btnConfirm.focus();
  });
}
