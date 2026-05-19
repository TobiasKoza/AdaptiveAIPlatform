async function initApp() {

    clearPolling();

    // Zachovej stav stejného uživatele přes F5 (jiný uživatel jeho IDs v datech nenajde)
    const _preservePrefixes = ['ai_scenario_', 'lab_start_', 'lab_url_', 'pass_result_', 'score_html_'];
    const _preserveExact = ['last_course_id', 'last_scenario_id'];
    const _savedState = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (_preserveExact.includes(k) || _preservePrefixes.some(p => k.startsWith(p))) {
            _savedState[k] = localStorage.getItem(k);
        }
    }

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !k.startsWith('adaptiveAuth_') && !k.startsWith('theme')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    Object.entries(_savedState).forEach(([k, v]) => { if (v != null) localStorage.setItem(k, v); });

    // Okamžité synchronní vyčištění veškerého UI — před jakýmkoli await
    currentCourseId = null;
    currentScenarioId = null;
    currentScenarios = [];
    currentAttempts = [];
    currentSubmissions = [];
    latestAttemptMap = {};
    const _elClear = id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; };
    const coursesList = document.getElementById('coursesList');
    if (coursesList) coursesList.innerHTML = '<div class="muted" style="padding:12px 16px;">Načítám kurzy...</div>';
    _elClear('studentMatList');
    const materialsSection = document.getElementById('materialsSection');
    if (materialsSection) materialsSection.style.display = 'none';
    _elClear('ai-scenario-container');
    document.getElementById("scenariosList").innerHTML = "Vyber kurz vlevo.";
    document.getElementById("courseInfo").innerHTML = "Vyber kurz.";
    clearPageMessage();
    resetScenarioPanel("Vyber úlohu ze seznamu.");

    await loadProfile();
    await loadCustomTemplatesForStudents();
    await loadCourses();

}

async function loadCustomTemplatesForStudents() {
    try {
        const res = await apiGet(`/labtemplates`); 
        if (Array.isArray(res)) {
            res.filter(t => t.isCustom).forEach(t => {
                customLabTemplatesMap[`custom:${t.templateId}`] = t.title;
            });
        }
    } catch { }
}

async function loadProfile() {
    try {
    currentUser = await apiGet(`/me?t=${Date.now()}`);
    // Profilový box jsme z UI smazali, takže už jen tiše načteme data na pozadí
    } catch { }
}

async function loadCourses() {
    const listEl = document.getElementById("coursesList");
    listEl.innerHTML = `<div class="muted" style="padding: 12px 16px;">Načítám vaše kurzy...</div>`;

    try {
    const courses = await apiGet("/courses");
    let myCourses = [];

    if (currentUser.globalRole === "student") {
        // Studenti z backendu dostávají přirozeně vyfiltrovaný osobní seznam
        myCourses = courses;
    } else if (currentUser.globalRole === "admin") {
        // Admin vidí úplně všechny kurzy — backend je vrátí bez filtru
        myCourses = courses;
    } else {
        // Učitel dostane z backendu úplně všechny kurzy.
        // Musíme si stáhnout jeho detailní záznam z /users (kam má přístup) a zjistit jeho kurzy.
        let explicitCourseIds = [];
        try {
            const allUsers = await apiGet("/users");
            const meInDb = allUsers.find(u => u.email === currentUser.email);

            if (meInDb) {
                explicitCourseIds = meInDb.course_ids || meInDb.courseIds || [];

                // Bezpečnostní ošetření, pokud by to backend náhodou poslal jako text
                if (typeof explicitCourseIds === 'string') {
                    try { explicitCourseIds = JSON.parse(explicitCourseIds); }
                    catch(e) { explicitCourseIds = [explicitCourseIds]; }
                }
            }
        } catch { }

        myCourses = courses.filter(c => explicitCourseIds.includes(c.courseId));
    }

    if (!myCourses.length) {
        listEl.innerHTML = "<div class='muted'>Zatím nemáte přiřazené žádné kurzy pro testování.</div>";
        return;
    }

    listEl.innerHTML = "";
    myCourses.forEach(course => {
        const card = document.createElement("div");
        card.className = "sidebar-card";
        card.dataset.id = course.courseId;
        card.innerHTML = `
        <div class="sidebar-card-title">${escapeHtml(course.title || "Bezejmenný kurz")}</div>
        ${course.description ? `<div class="sidebar-card-desc">${escapeHtml(course.description)}</div>` : ""}
        `;
        card.addEventListener("click", () => {
            const hasActiveLab = isAnyLabActive() || localStorage.getItem('active_lab_course') !== null;
            if (hasActiveLab && course.courseId !== currentCourseId) {
                showToast("Nelze přepnout kurz během aktivního úkolu.", true);
                return;
            }
            selectCourse(course.courseId, course.title);
        });
        listEl.appendChild(card);
    });

    const savedCourseId = localStorage.getItem("last_course_id");
    const courseToSelect = myCourses.find(c => c.courseId === savedCourseId) || myCourses[0];

    // Okamžitě zamkneme karty kurzů ještě před načtením dat, pokud je lab aktivní
    if (localStorage.getItem('active_lab_course') !== null) {
        const activeCourseId = savedCourseId || (courseToSelect?.courseId);
        document.querySelectorAll("#coursesList [data-id]").forEach(card => {
            if (card.dataset.id !== activeCourseId) {
                card.classList.add("locked");
                card.title = "Nelze přepnout kurz během plnění úkolu.";
            }
        });
    }

    if (courseToSelect) {
        await selectCourse(courseToSelect.courseId, courseToSelect.title, true);
    }
    } catch (err) {
    listEl.innerHTML = `<div class="warning">Chyba při načítání kurzů: ${err.message}</div>`;
    }
}

async function selectCourse(courseId, courseTitle, skipLockCheck = false) {
    // Guard proti race condition — zpracuj jen poslední klik
    window._lastSelectedCourseId = courseId;

    if (!skipLockCheck && localStorage.getItem('active_lab_course') !== null && courseId !== currentCourseId) {
        showToast("Nelze přepnout kurz během aktivního úkolu.", true);
        return;
    }

    clearPolling();
    clearPageMessage();
    if (typeof window.aiScenario?.deactivate === 'function') window.aiScenario.deactivate();
    currentCourseId = courseId;
    currentScenarioId = null;
    localStorage.setItem("last_course_id", courseId);
    document.getElementById("scenarioDetail").innerHTML = `
        <div class="scenario-loading">
            <div class="scenario-spinner"></div>
            <div class="muted">Načítám úlohy...</div>
        </div>`;

    const matSection = document.getElementById("materialsSection");
    const matList = document.getElementById("studentMatList");
    const matHeading = document.getElementById("materialsHeading");
    if (matSection) matSection.style.display = "flex";
    if (matList) matList.innerHTML = `<div class="muted" style="font-size:13px; padding:6px 4px;">Načítám...</div>`;
    if (matHeading) matHeading.textContent = `Studijní materiály — ${courseTitle || ''}`;

    document.querySelectorAll("#coursesList [data-id]").forEach(el => {
        el.classList.toggle("active", el.dataset.id === courseId);
    });

    document.getElementById("courseInfo").innerHTML = `
    <div style="font-size: 15px;"><strong>Vybraný kurz:</strong> ${courseTitle || "Neznámý kurz"}</div>
    `;

    document.getElementById("scenariosList").innerHTML = `<div class="muted" style="padding: 10px;">Načítám vaše úlohy...</div>`;

    try {
    currentScenarios = await apiGet(`/courses/${courseId}/scenarios`);
    if (window._lastSelectedCourseId !== courseId) return; // Uživatel přepnul jinam
    currentAttempts = await apiGet(`/courses/${courseId}/my-attempts`);
    if (window._lastSelectedCourseId !== courseId) return;
    currentSubmissions = await apiGet(`/courses/${courseId}/my-submissions`);
    if (window._lastSelectedCourseId !== courseId) return;
    buildLatestAttemptMap();
    renderScenarios();

    if (currentScenarios.length) {
        const savedScenarioId = localStorage.getItem("last_scenario_id");
        const scenarioToSelect = currentScenarios.find(s => s.scenarioId === savedScenarioId) || currentScenarios[0];
        selectScenario(scenarioToSelect.scenarioId);
        // Pokud byl výběr zablokován (jiné zadání má aktivní pokus), vyber to aktivní
        if (!currentScenarioId) {
            const activeSc = currentScenarios.find(s => {
                const atm = latestAttemptMap[s.scenarioId];
                return atm && atm.status !== 'archived' && atm.learningStatus === 'started';
            }) || currentScenarios[0];
            selectScenario(activeSc.scenarioId);
        }
    } else {
        resetScenarioPanel("V kurzu zatím nejsou žádné publikované úlohy.");
    }

    loadStudentMaterials(courseId, courseTitle);

    } catch (err) {
    LOG.error('chyba v selectCourse:', err.message);
    document.getElementById("scenariosList").innerHTML = `<div class="warning">Chyba: ${err.message}</div>`;
    }
}

async function loadStudentMaterials(courseId, courseTitle) {
    const listEl = document.getElementById("studentMatList");
    const heading = document.getElementById("materialsHeading");
    const section = document.getElementById("materialsSection");
    if (!listEl || !heading) return;

    listEl.style.display = "block";
    listEl.innerHTML = '<div class="muted" style="font-size:13px; padding:6px 4px;">Načítám...</div>';
    if (section) section.style.display = "flex";
    heading.textContent = "Studijní materiály — " + (courseTitle || "");

    try {
    const materials = await apiGet(`/courses/${courseId}/materials`);
    if (!materials || materials.length === 0) {
        listEl.innerHTML = `<div class="muted" style="font-size:13px; padding:6px 4px;">K tomuto kurzu nejsou přidané žádné soubory.</div>`;
        listEl.style.display = "block";
        if (section) section.style.display = "flex";
        return;
    }

    const iconColors = { pdf:'#ef4444', docx:'#3b82f6', pptx:'#f97316', png:'#10b981', jpg:'#10b981', jpeg:'#10b981', mp4:'#8b5cf6', txt:'#6b7280', md:'#6b7280', xlsx:'#10b981', csv:'#10b981' };
    const iconLabels = { pdf:'PDF', docx:'DOC', pptx:'PPT', png:'PNG', jpg:'JPG', jpeg:'JPG', mp4:'MP4', txt:'TXT', md:'MD', xlsx:'XLSX', csv:'CSV' };

    function matIcon(ext) {
        const color = iconColors[ext] || '#6b7280';
        const label = iconLabels[ext] || (ext ? ext.toUpperCase() : '?');
        return `<svg width="28" height="34" viewBox="0 0 42 50" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="${color}" opacity="0.15"/>
        <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="none" stroke="${color}" stroke-width="2"/>
        <path d="M28 0 L28 14 L42 14" fill="none" stroke="${color}" stroke-width="2"/>
        <text x="21" y="34" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${label}</text>
        </svg>`;
    }

    listEl.style.display = "flex";
    listEl.innerHTML = materials.map(m => {
        const ext = (m.extension || '').toLowerCase();
        const name = m.originalName || 'Soubor';
        const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<div class="material-item" onclick="downloadStudentMaterial('${courseId}', '${m.fileId}', '${safeName}')">
        ${matIcon(ext)}
        <div class="material-item-name" title="${name}">${name}</div>
        <span class="material-item-dl">⬇</span>
        </div>`;
    }).join('');

    updateMaterialsLockState();

    } catch (err) {
    listEl.style.display = "none";
    if (section) section.style.display = "none";
    }
}

async function downloadStudentMaterial(courseId, fileId, originalName) {
    if (isAnyLabActive()) {
    showToast("Materiály jsou během aktivního úkolu uzamčeny. Nejprve úkol dokončete a odevzdejte.", true);
    return;
    }
    try {
    const data = await apiGet(`/courses/${courseId}/materials/${fileId}/download`);
    
    if (!data || !data.downloadUrl) {
        showToast("URL pro stažení není k dispozici.", true);
        return;
    }

    // Backend nyní posílá správný název přímo v URL (content-disposition: attachment),
    // takže můžeme stahovat napřímo bez fetch/blobu a bez otevírání nové karty.
    const a = document.createElement("a");
    a.href = data.downloadUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    } catch (err) {
    showToast("Chyba při stahování: " + err.message, true);
    }
}