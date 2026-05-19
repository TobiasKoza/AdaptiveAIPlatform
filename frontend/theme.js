// theme.js - Modul pro správu motivu aplikace

// Oddělené klíče pro student a teacher, aby se jejich volba nepřekrývala
const _themeKey = window.location.pathname.includes('teacher') ? 'teacher-theme' : 'student-theme';

function initThemeModal() {
    if (document.getElementById('themeModal')) return;

    const modalHtml = `
      <div id="themeModal" class="theme-settings-container" style="display: none;">
        <button onclick="closeThemeModal()" class="theme-close-btn">✖</button>

        <h3 class="theme-settings-title">Nastavení přehledu</h3>
        <hr class="theme-divider">

        <div class="theme-options">
          <button class="theme-btn" data-theme="system" onclick="setTheme('system')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5" fill="currentColor" clip-path="url(#half-clip)"></circle>
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              <defs><clipPath id="half-clip"><rect x="0" y="0" width="12" height="24"></rect></clipPath></defs>
            </svg>
            <span>Systém</span>
          </button>

          <button class="theme-btn" data-theme="light" onclick="setTheme('light')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <span>Světlé</span>
          </button>

          <button class="theme-btn" data-theme="dark" onclick="setTheme('dark')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
            <span>Tmavé</span>
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeThemeModal() {
    const modal = document.getElementById('themeModal');
    if (!modal) return;
    modal.style.display = 'none';
    if (modal._outsideClickHandler) {
        document.removeEventListener('click', modal._outsideClickHandler);
        modal._outsideClickHandler = null;
    }
}

function openThemeModal() {
    initThemeModal();
    const modal = document.getElementById('themeModal');
    modal.style.display = 'block';

    const savedTheme = localStorage.getItem(_themeKey) || 'system';
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.theme-btn[data-theme="${savedTheme}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (modal._outsideClickHandler) {
        document.removeEventListener('click', modal._outsideClickHandler);
    }
    setTimeout(() => {
        modal._outsideClickHandler = (e) => {
            if (!modal.contains(e.target)) {
                closeThemeModal();
            }
        };
        document.addEventListener('click', modal._outsideClickHandler);
    }, 0);
}

function setTheme(themeName, save = true) {
    if (save) {
        localStorage.setItem(_themeKey, themeName); // Uložíme jako "cookie"
    }
    
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.theme-btn[data-theme="${themeName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (themeName === 'light') { 
        document.body.classList.remove('dark-mode'); 
        document.body.classList.add('light-mode'); 
    } else if (themeName === 'dark') { 
        document.body.classList.remove('light-mode'); 
        document.body.classList.add('dark-mode'); 
    } else if (themeName === 'system') {
        document.body.classList.remove('light-mode', 'dark-mode');
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.add('light-mode');
        }
    }
}

// IHNED PŘI NAČTENÍ SOUBORU ZJISTÍME ULOŽENÝ MOTIV A APLIKUJEME HO (aby to po F5 neprobliklo)
const savedTheme = localStorage.getItem(_themeKey) || 'system';
setTheme(savedTheme, false);

// Posluchač na změnu systémového motivu (když má uživatel zapnuto "Systém")
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem(_themeKey) === 'system') {
        setTheme('system', false);
    }
});