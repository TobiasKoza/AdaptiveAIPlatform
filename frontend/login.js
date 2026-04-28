// Globální stav přihlášení (sdílený pro všechny skripty)
let currentUserEmail = "";
let currentDisplayName = "";
// --- MODUL PRO ÚPRAVU JMÉNA (PROFILU) ---

// 1. Inicializace modulu (vytvoří HTML strukturu pro editační okno)
function initProfileEditor() {
    // Pokud už modal existuje, nic neděláme
    if (document.getElementById('editProfileModal')) return;

    // Vytvoříme CSS pro modal
    const styles = `
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; justify-content: center; align-items: center; }
        .modal-box { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); width: 350px; text-align: left; }
        .modal-box h3 { margin-top: 0; margin-bottom: 15px; color: #1f2937; }
        .modal-box label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 13px; color: #4b5563; }
        .modal-box input { width: 100%; padding: 10px; margin-bottom: 20px; border: 1px solid #d1d5db; border-radius: 4px; box-sizing: border-box; }
        .modal-buttons { display: flex; justify-content: flex-end; gap: 10px; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // Vytvoříme HTML strukturu modalu
    const modalHtml = `
        <div id="editProfileModal" class="modal-overlay">
            <div class="modal-box">
                <h3>Upravit jméno</h3>
                <label for="editDisplayName">Zobrazované jméno:</label>
                <input type="text" id="editDisplayName" placeholder="Jan Novák">
                <div id="profileEditError" style="color: red; font-size: 12px; margin-bottom: 10px;"></div>
                <div class="modal-buttons">
                    <button class="btn-small" style="background: #9ca3af;" onclick="closeProfileModal()">Zrušit</button>
                    <button class="btn-small" id="saveProfileBtn" onclick="saveProfileName()">Uložit</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// 2. Funkce pro otevření okna
function openProfileModal() {
    initProfileEditor(); // Ujistíme se, že je modal vytvořený
    document.getElementById('editDisplayName').value = currentDisplayName;
    document.getElementById('profileEditError').innerText = '';
    document.getElementById('editProfileModal').style.display = 'flex';
}

// 3. Funkce pro zavření okna
function closeProfileModal() {
    document.getElementById('editProfileModal').style.display = 'none';
}

// 4. Funkce pro uložení jména (volání backendu)
async function saveProfileName() {
    const newName = document.getElementById('editDisplayName').value.trim();
    const errEl = document.getElementById('profileEditError');
    const saveBtn = document.getElementById('saveProfileBtn');

    if (!newName) { errEl.innerText = 'Jméno nesmí být prázdné.'; return; }
    if (newName === currentDisplayName) { closeProfileModal(); return; } // Beze změny

    errEl.style.color = "#1d4ed8";
    errEl.innerText = "Ukládám...";
    saveBtn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/users/update-profile`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Mock-User": currentUserEmail
            },
            body: JSON.stringify({ display_name: newName })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ detail: "Chyba při ukládání." }));
            throw new Error(errData.detail || "Chyba serveru.");
        }

        // Úspěch - aktualizujeme lokální stav
        currentDisplayName = newName;
        
        // Aktualizujeme zobrazení v horní liště
        const displayEl = document.getElementById("loggedInUserDisplay");
        if (displayEl) {
            const roleEl = displayEl.querySelector('.profile-role');
            const roleText = roleEl ? roleEl.innerText : '';
            updateProfileDisplay(newName, roleText);
        }

        closeProfileModal();

    } catch (error) {
        errEl.style.color = "red";
        errEl.innerText = error.message;
    } finally {
        saveBtn.disabled = false;
    }
}

// 5. Pomocná funkce pro vygenerování HTML horní lišty
function generateProfileHtml(name, role) {
    return `
        <span class="profile-clicker" onclick="openProfileModal()" title="Upravit profil" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 16px; height: 16px; color: #9ca3af;">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
            <span style="color: #e5e7eb; font-weight: normal;">Přihlášen:</span>
            <span class="profile-name" style="color: white; font-weight: bold;">${name}</span>
        </span>
    `;
}

// 6. Pomocná funkce pro aktualizaci horní lišty
function updateProfileDisplay(name, role) {
    const displayEl = document.getElementById("loggedInUserDisplay");
    if (displayEl) {
        // Slovo "Přihlášen:" jsme přesunuli přímo do generátoru, ať je to celé v jednom bloku
        displayEl.innerHTML = generateProfileHtml(name, role);
    }
}

async function sharedPerformLogin(allowedRoles, initFunction, portalName = "app") {
    const email = document.getElementById("loginEmail").value.trim();
    const pwd = document.getElementById("loginPassword").value.trim();
    const err = document.getElementById("loginError");

    if (!email || !pwd) { err.innerText = "Vyplňte e-mail i heslo."; return; }

    err.style.color = "#1d4ed8";
    err.innerText = "Ověřuji uživatele na serveru...";

    try {
        const res = await fetch(`${API_BASE}/me?t=${Date.now()}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "X-Mock-User": email }
        });

        if (!res.ok) throw new Error("Uživatel s tímto loginem v databázi neexistuje.");
        const userData = await res.json();

        // Klíčová kontrola - pustíme jen povolené role
        if (!allowedRoles.includes(userData.globalRole)) {
            throw new Error("Přístup odepřen. Nemáte oprávnění pro tento portál.");
        }

        const expectedPassword = userData.mockPassword || email.split('@')[0];
        if (pwd !== expectedPassword) {
            throw new Error("Nesprávné heslo.");
        }

        currentUserEmail = email;
        currentDisplayName = userData.displayName;
        err.innerText = "";
        document.getElementById("loginScreen").style.display = "none";

        // Reset sessionStorage při každém novém přihlášení
        // Zabrání zobrazení dat předchozího uživatele
        sessionStorage.clear();

        if (userData.accountStatus === "pending_activation") {
            document.getElementById("forcePasswordScreen").style.display = "flex";
        } else {
            const rememberMe = document.getElementById("rememberMe");
            if (rememberMe && rememberMe.checked) {
                const expiry = new Date().getTime() + (30 * 24 * 60 * 60 * 1000);
                // TADY JE ZMĚNA: Ukládáme pod specifickým klíčem
                localStorage.setItem("adaptiveAuth_" + portalName, JSON.stringify({ email: currentUserEmail, expiry: expiry }));
            }
            document.getElementById("mainApp").style.display = "block";
            updateProfileDisplay(currentDisplayName, userData.globalRole);
            
            if (initFunction) initFunction(); 
        }

    } catch (error) {
        err.style.color = "red";
        err.innerText = error.message;
    }
}

async function sharedChangeMockPassword(initFunction, portalName = "app") {
    const newPwd = document.getElementById("newMockPassword").value.trim();
    const err = document.getElementById("pwdError");
    
    if (newPwd.length < 4) { err.innerText = "Heslo musí mít alespoň 4 znaky."; return; }

    err.style.color = "#1d4ed8";
    err.innerText = "Měním heslo...";
    
    try {
        const res = await fetch(`${API_BASE}/users/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Mock-User": currentUserEmail },
            body: JSON.stringify({ new_password: newPwd })
        });
        if (!res.ok) throw new Error("Chyba při komunikaci se serverem.");

        const expiry = new Date().getTime() + (30 * 24 * 60 * 60 * 1000);
        localStorage.setItem("adaptiveAuth_" + portalName, JSON.stringify({ email: currentUserEmail, expiry: expiry }));

        document.getElementById("forcePasswordScreen").style.display = "none";
        document.getElementById("mainApp").style.display = "block";
        const displayEl = document.getElementById("loggedInUserDisplay");
        const roleEl = displayEl ? displayEl.querySelector('.profile-role') : null;
        const roleText = roleEl ? roleEl.innerText : '';
        updateProfileDisplay(currentDisplayName, roleText);
        
        if (initFunction) initFunction();
        
    } catch(error) {
        err.style.color = "red";
        err.innerText = error.message;
    }
}

async function sharedCheckAutoLogin(allowedRoles, initFunction, portalName = "app") {
    // TADY JE ZMĚNA: Čteme specifický klíč
    const storedAuth = localStorage.getItem("adaptiveAuth_" + portalName);
    const loginScreen = document.getElementById("loginScreen");

    if (!storedAuth) {
        if(loginScreen) loginScreen.style.display = "flex";
        return; 
    }

    try {
        const authData = JSON.parse(storedAuth);
        
        if (new Date().getTime() > authData.expiry) {
            // TADY JE ZMĚNA
            localStorage.removeItem("adaptiveAuth_" + portalName);
            if(loginScreen) loginScreen.style.display = "flex";
            return;
        }

        const res = await fetch(`${API_BASE}/me?t=${Date.now()}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "X-Mock-User": authData.email }
        });

        if (!res.ok) throw new Error("Platnost uživatele vypršela.");
        const userData = await res.json();

        if (!allowedRoles.includes(userData.globalRole)) {
            throw new Error("Neoprávněný přístup.");
        }

        currentUserEmail = authData.email;
        currentDisplayName = userData.displayName;
        if (loginScreen) loginScreen.style.display = "none";
        
        if (userData.accountStatus === "pending_activation") {
            document.getElementById("forcePasswordScreen").style.display = "flex";
        } else {
            document.getElementById("mainApp").style.display = "block";
            updateProfileDisplay(currentDisplayName, userData.globalRole);
            
            if (initFunction) initFunction();
        }

    } catch (e) {
        localStorage.removeItem("adaptiveAuth_" + portalName);
        if(loginScreen) loginScreen.style.display = "flex";
    }
}

function sharedLogout(cleanupFunction, portalName = "app") {
    if (!confirm("Opravdu se chcete odhlásit?")) return;
    
    currentUserEmail = "";
    currentDisplayName = "";
    document.getElementById("loginEmail").value = "";
    document.getElementById("loginPassword").value = "";
    
    const err = document.getElementById("loginError");
    if(err) err.innerText = "";
    
    // Mažeme auth klíč daného portálu
    localStorage.removeItem("adaptiveAuth_" + portalName);

    // KRITICKÉ: Vymazat sessionStorage — obsahuje rozpracované odpovědi kroků
    // a další data předchozího studenta
    sessionStorage.clear();
    
    document.getElementById("mainApp").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
    
    if (cleanupFunction) cleanupFunction();
}

function togglePasswordVisibility(inputId, iconId) {
    const passwordInput = document.getElementById(inputId);
    const iconSpan = document.getElementById(iconId);
    const eyeOpenSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.644C3.67 8.55 7.42 6 12 6c4.58 0 8.33 2.55 9.964 5.678a1.012 1.012 0 010 .644C20.33 15.45 16.58 18 12 18c-4.58 0-8.33-2.55-9.964-5.678z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>`;
    const eyeClosedSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.893 7.893L21 21m-6.228-6.228l-3.65-3.65m0 0a3 3 0 104.243 4.243m-4.243-4.243L9.878 9.878" /></svg>`;

    if (passwordInput.type === "password") {
        passwordInput.type = "text";
        iconSpan.innerHTML = eyeClosedSvg;
    } else {
        passwordInput.type = "password";
        iconSpan.innerHTML = eyeOpenSvg;
    }
}