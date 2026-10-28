// nav-component.js
class GymNavbar extends HTMLElement {
    constructor() {
        super();
        this.activePage = this.getAttribute('active') || '';
    }

    connectedCallback() {
        const userName = localStorage.getItem('gym_user_name') || 'Usuario';
        const userRole = localStorage.getItem('userRole') || 'programador';
        const isAdmin = userRole === 'admin';

        this.innerHTML = `
      <style>
        .navbar { background: #ffffff; border-bottom: 1px solid #e5e7eb; padding: 0 5%; display: flex; justify-content: space-between; align-items: center; height: 65px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .nav-brand { display: flex; align-items: center; gap: 10px; font-weight: 900; font-size: 1.1rem; color: #1e293b; text-decoration: none; letter-spacing: -0.5px; }
        .nav-brand img { height: 28px; }
        .nav-links { display: flex; gap: 20px; }
        .nav-links a { text-decoration: none; color: #64748b; font-weight: 600; font-size: 0.9rem; padding: 8px 12px; border-radius: 6px; transition: all 0.2s; }
        .nav-links a:hover { background: #f1f5f9; color: #0f172a; }
        .nav-links a.active { background: #e0f2fe; color: #0369a1; }
        .nav-right-group { display: flex; align-items: center; gap: 14px; }
        .nav-undo-slot { display: flex; align-items: center; }
        .nav-user { display: flex; align-items: center; gap: 15px; font-size: 0.9rem; font-weight: 600; color: #334155; }
        .btn-logout { background: none; border: none; color: #ef4444; font-weight: bold; cursor: pointer; font-size: 0.85rem; padding: 6px 12px; border-radius: 6px; transition: 0.2s; }
        .btn-logout:hover { background: #fee2e2; }
        
        /* Menú Hamburguesa para Móvil */
        .hamburger { display: none; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #334155; }
        @media (max-width: 768px) {
          .nav-links { display: none; flex-direction: column; position: absolute; top: 65px; left: 0; width: 100%; background: #ffffff; padding: 15px 5%; box-sizing: border-box; border-bottom: 1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0,0,0,0.05); z-index: 1000; }
          .nav-links.show { display: flex; }
          .nav-user { display: none; }
          .hamburger { display: block; }
        }
      </style>
      <nav class="navbar">
        <a href="planificacion.html" class="nav-brand">
          <img src="assets/logo.png" alt="GO & train"> GO&Train
        </a>
        <div class="nav-links" id="navMenu">
          <a href="planificacion.html" class="${this.activePage === 'planificacion' ? 'active' : ''}">Planificación</a>
          <a href="agenda.html" class="${this.activePage === 'agenda' ? 'active' : ''}">Agenda</a>
          <a href="clientes.html" class="${this.activePage === 'clientes' ? 'active' : ''}">Clientes</a>
          <a href="ejercicios.html" class="${this.activePage === 'ejercicios' ? 'active' : ''}">Ejercicios</a>
          <a href="plantillas.html" class="${this.activePage === 'plantillas' ? 'active' : ''}">Plantillas</a>
          <a href="maestros.html" class="${this.activePage === 'maestros' ? 'active' : ''}">Maestros</a>
          <button class="btn-logout" id="btnLogoutMobile" style="display: none; margin-top: 10px; text-align: left; padding: 8px 12px;">Cerrar Sesión</button>
        </div>
        <div class="nav-right-group">
          <div id="navUndoContainer" class="nav-undo-slot"></div>
          <div class="nav-user">
            <span>Hola, ${userName}</span>
            <button class="btn-logout" id="btnLogoutDesktop">Cerrar Sesión</button>
          </div>
          <button class="hamburger" id="navToggle">☰</button>
        </div>
      </nav>
    `;

        const setupLogout = async (btnId) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', async () => {
                    if (confirm("¿Seguro que quieres cerrar sesión?")) {
                        try {
                            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js");
                            const auth = getAuth();
                            await signOut(auth);
                            localStorage.removeItem('userRole');
                            localStorage.removeItem('gym_user_name');
                            window.location.href = "index.html";
                        } catch (e) {
                            localStorage.clear();
                            window.location.href = "index.html";
                        }
                    }
                });
            }
        };

        setupLogout('btnLogoutDesktop');
        setupLogout('btnLogoutMobile');

        const toggleBtn = document.getElementById('navToggle');
        const menu = document.getElementById('navMenu');
        const logoutMobile = document.getElementById('btnLogoutMobile');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                menu.classList.toggle('show');
                logoutMobile.style.display = menu.classList.contains('show') ? 'block' : 'none';
            });
        }
    }
}

customElements.define('gym-navbar', GymNavbar);