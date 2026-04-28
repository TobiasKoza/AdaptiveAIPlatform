// theme.js - Modul pro správu motivu aplikace

function initThemeModal() {
    if (document.getElementById('themeModal')) return;

    const modalHtml = `
      <div id="themeModal" class="theme-settings-container" style="display: none; position: fixed; top: 56px; right: 16px; z-index: 10000; background: var(--bg-panel); color: var(--text-primary); border-radius: 12px; padding: 20px; width: 280px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); border: 1px solid var(--border-color);">
        <div style="position: relative;">
          <button onclick="document.getElementById('themeModal').style.display='none'" style="position: absolute; top: -8px; right: -8px; background: transparent; color: var(--text-muted); border: none; cursor: pointer; font-size: 16px; padding: 0; margin: 0;">✖</button>
          
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
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function openThemeModal() {
    initThemeModal();
    document.getElementById('themeModal').style.display = 'block';
    
    const savedTheme = localStorage.getItem('app-theme') || 'system';
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.theme-btn[data-theme="${savedTheme}"]`);
    if (activeBtn) activeBtn.classList.add('active');
}

function setTheme(themeName, save = true) {
    if (save) {
        localStorage.setItem('app-theme', themeName); // Uložíme jako "cookie"
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
const savedTheme = localStorage.getItem('app-theme') || 'system';
setTheme(savedTheme, false);

// Posluchač na změnu systémového motivu (když má uživatel zapnuto "Systém")
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('app-theme') === 'system') {
        setTheme('system', false);
    }
});