async function createAdaptiveScenario() {
    const courseId = document.getElementById("scenarioCourseSelect").value;
    const title = document.getElementById("aiScenarioTitle").value.trim();
    const description = document.getElementById("aiScenarioDescription").value.trim();
    const goal = document.getElementById("aiScenarioGoal").value.trim();
    const persona = document.getElementById("aiScenarioPersona").value.trim();
    const rubric = document.getElementById("aiScenarioGradingRubric").value.trim();
    const os = document.getElementById("aiScenarioRequiredOs").value;
    const timeLimitRaw = parseInt(document.getElementById("aiScenarioTimeLimit").value);
    const timeLimit = isNaN(timeLimitRaw) ? 60 : timeLimitRaw;
    const subtasks = parseInt(document.getElementById("aiScenarioSubtasks").value) || 3;
    const deadline = document.getElementById("aiScenarioDeadline").value;
    const gradingStyle = document.getElementById("aiScenarioGradingStyle").value;
    const maxPoints = parseInt(document.getElementById("aiScenarioMaxPoints").value) || 10;
    const difficulty = document.getElementById("aiScenarioDifficulty").value;
    const adaptive = document.getElementById("aiScenarioAdaptive").value;
    const tags = document.getElementById("aiScenarioTags").value.trim();
    const tools = document.getElementById("aiScenarioTools").value.trim();
    const maxAttempts = parseInt(document.getElementById("aiScenarioMaxAttempts").value) || 0;
    const allowSkip = document.getElementById("aiScenarioAllowSkip").value;
    const autoSubmitCreate = document.getElementById("aiScenarioAutoSubmit")?.checked ? '[AUTO_SUBMIT:true]' : '';
    const statusDiv = document.getElementById("aiScenarioStatus");
    const scenarioSubType = document.getElementById("scenarioTaskType")?.value || 'adaptive';
    const isEduType = scenarioSubType === 'ai_education';

    // Získání vybraných typů otázek a režimu střídání
    const isRotateCreate = document.getElementById("aiScenario_qtypesRotate").checked;
    const cbsCreate = Array.from(document.querySelectorAll('.qtype-cb-create:checked'));
    let selectedTypesCreate = [];
    if (isRotateCreate) {
        selectedTypesCreate = cbsCreate.map(cb => cb.value);
    } else {
        selectedTypesCreate = cbsCreate.map(cb => {
            const countInput = cb.closest('label').querySelector('.qtype-count-create');
            const count = countInput ? (parseInt(countInput.value) || 1) : 1;
            return `${cb.value}(${count})`;
        });
    }
    if (selectedTypesCreate.length === 0) selectedTypesCreate.push("otevřená odpověď");
    const qtypesTagCreate = `[QTYPES:${selectedTypesCreate.join(', ')}][QTYPES_ROTATE:${isRotateCreate}]`;

    const topics = document.getElementById("aiEdu_topics")?.value.trim() || '';
    const validationErrors = [];
    if (!courseId)     validationErrors.push({ msg: "Vyberte kurz.", id: "scenarioCourseSelect" });
    if (!title)        validationErrors.push({ msg: "Vyplňte název zadání.", id: "aiScenarioTitle" });
    if (!description)  validationErrors.push({ msg: "Vyplňte obecný popis.", id: "aiScenarioDescription" });
    if (!persona)      validationErrors.push({ msg: "Vyplňte master prompt (personu AI).", id: "aiScenarioPersona" });
    if (isEduType && !topics) validationErrors.push({ msg: "Vyplňte témata / kapitoly.", id: "aiEdu_topics" });
    if (!isEduType && !goal)  validationErrors.push({ msg: "Vyplňte vzdělávací cíl.", id: "aiScenarioGoal" });

    if (validationErrors.length > 0) {
        showToast(validationErrors[0].msg, true);
        const el = document.getElementById(validationErrors[0].id);
        if (el) { el.focus(); el.style.borderColor = '#ef4444'; setTimeout(() => el.style.borderColor = '', 2000); }
        return;
    }

    showToast("Zakládám adaptivního AI mentora...");
    statusDiv.innerText = "";

    try {
        // Zabalíme goal a personu do "instructions" pro backend
        const aiPrompt = `CÍL MENTORA:\n${goal}\n\nOSOBNOST MENTORA:\n${persona}`;

        // Sestavení štítku pro hodnocení
        let gradingHint = `[GRADING:${gradingStyle}`;
        if (gradingStyle !== 'none') gradingHint += `:${maxPoints}`;
        gradingHint += `]`;

        let hintsStr;
        if (isEduType) {
            const topics = document.getElementById("aiEdu_topics")?.value.trim() || '';
            const presentation = document.getElementById("aiEdu_presentation")?.value || 'combined';
            const verifyQ = parseInt(document.getElementById("aiEdu_verifyQ")?.value) || 2;
            const threshold = parseInt(document.getElementById("aiEdu_threshold")?.value) || 75;
            const maxRepeats = parseInt(document.getElementById("aiEdu_maxRepeats")?.value) || 3;
            const verifyQtypes = document.getElementById("aiEdu_verifyQtypes")?.value || 'combined';
            const explainStyle = document.getElementById("aiEdu_explainStyle")?.value || 'adaptive';
            hintsStr = `[TYPE:ai_education][TOPICS:${topics}][PRESENTATION:${presentation}][VERIFY_Q:${verifyQ}][THRESHOLD:${threshold}][MAX_REPEATS:${maxRepeats}][VERIFY_QTYPES:${verifyQtypes}][EXPLAIN_STYLE:${explainStyle}][TIME_LIMIT:${timeLimit}]${gradingHint}${autoSubmitCreate}`;
        } else {
            hintsStr = `[ADAPTIVE:${adaptive}][SUBTASKS:${subtasks}][TIME_LIMIT:${timeLimit}][DIFFICULTY:${difficulty}][TAGS:${tags}][TOOLS:${tools}][ALLOW_SKIP:${allowSkip}]${gradingHint}${qtypesTagCreate}${autoSubmitCreate}`;
        }
        const _createPrereqIds = window.getPrereqIds?.('prereqsCreateContainer') || '';
        if (_createPrereqIds) hintsStr += `[PREREQS:${_createPrereqIds}]`;

        const payload = {
            title: title,
            description: description,
            instructions: aiPrompt,
            grading_rubric: rubric || "Ohodnoť studenta podle toho, jak úspěšně splnil zadání.",
            required_os: os,
            time_limit: timeLimit,
            deadline: deadline || null,
            max_attempts: maxAttempts,
            hints: hintsStr
        };

        const res = await fetch(`${API_BASE}/api/ai/courses/${courseId}/ai-scenarios`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        const newScenarioId = data.scenarioTemplateId;

        // Nahraj čekající materiály
        if (newScenarioId && window._pendingAiMaterials?.length > 0) {
            showToast("Nahrávám materiály...");
            await uploadAiMaterials(newScenarioId);
        }

        showToast(isEduType
            ? `AI Vzdělávání '${title}' bylo úspěšně vytvořeno!`
            : `Adaptivní AI scénář '${title}' byl úspěšně vytvořen!`);
        setTimeout(() => {
            window._pendingAiMaterials = [];
            renderPendingAiFiles();

            // Vyčištění všech polí
            document.getElementById("aiScenarioTitle").value = "";
            document.getElementById("aiScenarioDescription").value = "";
            document.getElementById("aiScenarioGoal").value = "";
            document.getElementById("aiScenarioPersona").value = "";
            document.getElementById("aiScenarioGradingRubric").value = "";
            document.getElementById("aiScenarioSubtasks").value = "3";
            document.getElementById("aiScenarioDeadline").value = "";
            document.getElementById("aiScenarioGradingStyle").value = "points";
            document.getElementById("aiScenarioMaxPoints").value = "10";
            document.getElementById("aiScenarioMaxPointsWrapper").style.display = "block";
            document.getElementById("aiScenarioDifficulty").value = "medium";
            document.getElementById("aiScenarioAdaptive").value = "true";
            document.getElementById("aiScenarioTags").value = "";
            document.getElementById("aiScenarioTools").value = "";
            document.getElementById("aiScenarioMaxAttempts").value = "0";
            document.getElementById("aiScenarioAllowSkip").value = "true";

            // Edu-specific field reset
            const eduTopics = document.getElementById("aiEdu_topics");
            if (eduTopics) eduTopics.value = "";
            const eduPresentation = document.getElementById("aiEdu_presentation");
            if (eduPresentation) eduPresentation.value = "combined";
            const eduExplainStyle = document.getElementById("aiEdu_explainStyle");
            if (eduExplainStyle) eduExplainStyle.value = "adaptive";
            const eduVerifyQ = document.getElementById("aiEdu_verifyQ");
            if (eduVerifyQ) eduVerifyQ.value = "2";
            const eduThreshold = document.getElementById("aiEdu_threshold");
            if (eduThreshold) eduThreshold.value = "75";
            const eduMaxRepeats = document.getElementById("aiEdu_maxRepeats");
            if (eduMaxRepeats) eduMaxRepeats.value = "3";
            const eduVerifyQtypes = document.getElementById("aiEdu_verifyQtypes");
            if (eduVerifyQtypes) eduVerifyQtypes.value = "combined";

            // Clear prereq rows from create form
            const _prereqCreateCont = document.getElementById('prereqsCreateContainer');
            if (_prereqCreateCont) _prereqCreateCont.innerHTML = '';

            // Reset form type back to exercise mode
            const typeSelect = document.getElementById("scenarioTaskType");
            if (typeSelect) {
                typeSelect.value = "adaptive";
                if (typeof toggleScenarioFormType === 'function') toggleScenarioFormType();
            }

            }, 3000);

    } catch (err) {
        statusDiv.style.color = "red";
        statusDiv.innerText = `Chyba: ${err.message}`;
    }
}

async function loadAiScenarioLabTemplates() {
    try {
        const res = await fetch(`${API_BASE}/labtemplates`, { headers: getHeaders() });
        if (!res.ok) return;
        const all = await res.json();
        if (typeof _populateCustomLabOptions === 'function') _populateCustomLabOptions(all);
    } catch (_) {}
}

function renderAiPersonaTemplateButtons() {
    const container = document.getElementById('aiPersonaTemplateButtons');
    if (!container || !window.AI_PERSONA_TEMPLATES) return;

    container.innerHTML = window.AI_PERSONA_TEMPLATES.map(t => `
        <button type="button"
            onclick="applyAiPersonaTemplate('${t.id}')"
            title="${t.description}"
            style="padding:5px 12px; font-size:12px; border-radius:6px; border:1px solid var(--border-color);
                   background:var(--bg-status); color:var(--text-primary); cursor:pointer;
                   transition:background 0.15s, border-color 0.15s; white-space:nowrap;"
            onmouseover="this.style.background='var(--bg-card-hover)'; this.style.borderColor='#3e67a8';"
            onmouseout="this.style.background='var(--bg-status)'; this.style.borderColor='var(--border-color)';"
            id="persona-btn-${t.id}">
            ${t.label}
        </button>
    `).join('');
}

function applyAiPersonaTemplate(templateId) {
    const template = window.AI_PERSONA_TEMPLATES?.find(t => t.id === templateId);
    if (!template) return;

    const textarea = document.getElementById('aiScenarioPersona');
    if (!textarea) return;

    // Zvýrazni aktivní tlačítko
    document.querySelectorAll('[id^="persona-btn-"]').forEach(btn => {
        btn.style.background = 'var(--bg-status)';
        btn.style.borderColor = 'var(--border-color)';
        btn.style.fontWeight = 'normal';
    });
    const activeBtn = document.getElementById(`persona-btn-${templateId}`);
    if (activeBtn) {
        activeBtn.style.background = '#eff6ff';
        activeBtn.style.borderColor = '#3e67a8';
        activeBtn.style.fontWeight = 'bold';
    }

    textarea.value = template.text;
    textarea.style.borderColor = '#3e67a8';
    setTimeout(() => { textarea.style.borderColor = '#d1d5db'; }, 1000);

    showToast(`Šablona "${template.label}" načtena.`);
}

// ── AI Materiály ──────────────────────────────────────────────────────────────

window.toggleQtypesRotate = function(mode) {
    const isRotate = document.getElementById(mode === 'create' ? 'aiScenario_qtypesRotate' : 'aiEdit_qtypesRotate').checked;
    const subtasksInput = document.getElementById(mode === 'create' ? 'aiScenarioSubtasks' : 'aiEdit_subtasks');
    const countInputs = document.querySelectorAll(`.qtype-count-${mode}`);

    if (isRotate) {
        countInputs.forEach(inp => inp.style.display = 'none');
        if (subtasksInput) {
            subtasksInput.readOnly = false;
            subtasksInput.style.background = '';
            subtasksInput.style.color = '';
        }
    } else {
        countInputs.forEach(inp => inp.style.display = 'block');
        if (subtasksInput) {
            subtasksInput.readOnly = true;
            subtasksInput.style.background = 'var(--bg-status)';
            subtasksInput.style.color = 'var(--text-muted)';
        }
        window.recalcQtypesTotal(mode);
    }
    window._updateQtypeHint(mode);
};

window.recalcQtypesTotal = function(mode) {
    const isRotate = document.getElementById(mode === 'create' ? 'aiScenario_qtypesRotate' : 'aiEdit_qtypesRotate').checked;
    if (isRotate) return;

    const subtasksInput = document.getElementById(mode === 'create' ? 'aiScenarioSubtasks' : 'aiEdit_subtasks');
    const cbs = document.querySelectorAll(`.qtype-cb-${mode}`);
    let total = 0;
    cbs.forEach(cb => {
        const countInput = cb.closest('label').querySelector(`.qtype-count-${mode}`);
        if (!cb.checked) { if (countInput) countInput.value = 0; return; }
        if (countInput) total += parseInt(countInput.value) || 1;
    });
    if (subtasksInput) subtasksInput.value = total || 1;
};

window._updateQtypeHint = function(mode) {
    const isRotate = document.getElementById(mode === 'create' ? 'aiScenario_qtypesRotate' : 'aiEdit_qtypesRotate')?.checked;
    const hintId = mode === 'create' ? 'aiQtypesHint' : 'aiEditQtypesHint';
    let hintEl = document.getElementById(hintId);
    if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = hintId;
        hintEl.className = 'warn-hint';
        const subtasksInput = document.getElementById(mode === 'create' ? 'aiScenarioSubtasks' : 'aiEdit_subtasks');
        subtasksInput?.parentNode?.appendChild(hintEl);
    }
    if (!isRotate) { hintEl.textContent = ''; return; }
    const n = parseInt(document.getElementById(mode === 'create' ? 'aiScenarioSubtasks' : 'aiEdit_subtasks')?.value) || 1;
    const types = document.querySelectorAll(`.qtype-cb-${mode}:checked`).length;
    const typLabel = types === 1 ? 'typ' : types < 5 ? 'typy' : 'typů';
    hintEl.textContent = types > 0
        ? `AI střídá ${types} ${typLabel} přes ${n} podúkolů`
        : 'Vyberte alespoň jeden formát otázky';
};

window.updateQtypesLabel = function(mode) {
    // Nastav count na 1 pro nově zaškrtnuté (count=0), na 0 pro odškrtnuté
    document.querySelectorAll(`.qtype-cb-${mode}`).forEach(cb => {
        const countInput = cb.closest('label')?.querySelector(`.qtype-count-${mode}`);
        if (!countInput) return;
        if (cb.checked && (parseInt(countInput.value) || 0) === 0) countInput.value = 1;
        if (!cb.checked) countInput.value = 0;
    });
    const cbs = Array.from(document.querySelectorAll(`.qtype-cb-${mode}:checked`));
    const labelEl = document.getElementById(mode === 'create' ? 'aiScenario_qtypesLabel' : 'aiEdit_qtypesLabel');
    if (!labelEl) return;
    
    if (cbs.length === 0) {
        labelEl.innerText = "Vyberte formáty...";
        labelEl.style.color = "var(--text-muted)";
    } else if (cbs.length === 5) {
        labelEl.innerText = "Všechny formáty";
        labelEl.style.color = "var(--text-primary)";
    } else {
        labelEl.innerText = cbs.map(cb => cb.value).join(', ');
        labelEl.style.color = "var(--text-primary)";
    }
    
    // Automaticky přepočítá úkoly, pokud se přidá nebo odebere formát
    window.recalcQtypesTotal(mode);
    window._updateQtypeHint(mode);
};
window._pendingAiMaterials = [];

function handleAiMatSelect(event) {
    const files = Array.from(event.target.files || []);
    addPendingAiFiles(files);
    event.target.value = "";
}

function handleAiMatDrop(event) {
    event.preventDefault();
    const dropZone = document.getElementById("aiMatDropZone");
    if (dropZone) { dropZone.style.background = ""; dropZone.style.borderColor = "var(--border-color)"; }
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) addPendingAiFiles(files);
}

function addPendingAiFiles(files) {
    const allowed = ['pdf', 'txt', 'md', 'docx'];
    files.forEach(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        if (!allowed.includes(ext)) {
            showToast(`Soubor "${f.name}" není podporován. Povoleno: PDF, TXT, MD, DOCX.`, true);
            return;
        }
        if (f.size > 10 * 1024 * 1024) {
            showToast(`Soubor "${f.name}" je příliš velký (max 10 MB).`, true);
            return;
        }
        window._pendingAiMaterials.push(f);
    });
    renderPendingAiFiles();
}

function removePendingAiFile(index) {
    window._pendingAiMaterials.splice(index, 1);
    renderPendingAiFiles();
}

function renderPendingAiFiles() {
    const listEl = document.getElementById("aiMatPendingList");
    if (!listEl) return;
    if (window._pendingAiMaterials.length === 0) { listEl.innerHTML = ""; return; }

    const colors = { pdf:'#ef4444', docx:'#3e67a8', txt:'#6b7280', md:'#6b7280' };
    const labels = { pdf:'PDF', docx:'DOC', txt:'TXT', md:'MD' };

    listEl.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px;">'
        + window._pendingAiMaterials.map((f, i) => {
            const ext = f.name.split('.').pop().toLowerCase();
            const color = colors[ext] || '#6b7280';
            const label = labels[ext] || ext.toUpperCase();
            const sizeStr = f.size < 1024*1024 ? `${(f.size/1024).toFixed(1)} KB` : `${(f.size/1024/1024).toFixed(1)} MB`;
            return `<div style="display:flex; flex-direction:column; align-items:center; gap:6px; width:80px; position:relative;">
                <button onclick="removePendingAiFile(${i})" style="position:absolute; top:-6px; right:-6px; background:#ef4444; border:none; color:white; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; line-height:1; display:flex; align-items:center; justify-content:center; padding:0; z-index:1;">×</button>
                <svg width="42" height="50" viewBox="0 0 42 50" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="${color}" opacity="0.15"/>
                    <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="none" stroke="${color}" stroke-width="2"/>
                    <path d="M28 0 L28 14 L42 14" fill="none" stroke="${color}" stroke-width="2"/>
                    <text x="21" y="34" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${label}</text>
                </svg>
                <div style="font-size:11px; color:var(--text-primary); text-align:center; word-break:break-all; line-height:1.3; max-width:80px;">${f.name}</div>
                <div style="font-size:10px; color:var(--text-muted);">${sizeStr}</div>
            </div>`;
        }).join('')
        + '</div>';
}

async function uploadAiMaterials(scenarioId) {
    if (!window._pendingAiMaterials || window._pendingAiMaterials.length === 0) return;
    for (const file of window._pendingAiMaterials) {
        const formData = new FormData();
        formData.append("file", file);
        try {
            const res = await fetch(`${API_BASE}/api/ai/scenarios/${scenarioId}/materials`, {
                method: "POST",
                headers: { "X-Mock-User": currentUserEmail || "" },
                body: formData
            });
            if (!res.ok) showToast(`Chyba u "${file.name}": ${await res.text()}`, true);
        } catch (err) {
            showToast(`Chyba: ${err.message}`, true);
        }
    }
    window._pendingAiMaterials = [];
    renderPendingAiFiles();
}

async function loadAiScenarioMaterials(scenarioId) {
    const container = document.getElementById("aiEditMatList");
    if (!container) return;
    container.innerHTML = '<div class="muted" style="font-size:13px;">Načítám...</div>';
    try {
        const res = await fetch(`${API_BASE}/api/ai/scenarios/${scenarioId}/materials`, { headers: getHeaders() });
        if (!res.ok) throw new Error(await res.text());
        const materials = await res.json();
        if (materials.length === 0) {
            container.innerHTML = '<div class="muted" style="font-size:13px;">Žádné materiály.</div>';
            return;
        }
        const colors = { pdf:'#ef4444', docx:'#3e67a8', txt:'#6b7280', md:'#6b7280' };
        const labels = { pdf:'PDF', docx:'DOC', txt:'TXT', md:'MD' };
        container.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:8px;">'
            + materials.map(m => {
            const name = m.originalName || m.filename || 'soubor';
            const ext = m.extension || name.split('.').pop().toLowerCase();
            const color = colors[ext] || '#6b7280';
            const label = labels[ext] || ext.toUpperCase();
            const size = m.sizeBytes || m.size || 0;
            const sizeStr = size < 1024*1024 ? `${(size/1024).toFixed(1)} KB` : `${(size/1024/1024).toFixed(1)} MB`;
            return `<div style="display:flex; flex-direction:column; align-items:center; gap:6px; width:80px; position:relative;">
                <button onclick="deleteAiMaterial('${scenarioId}', '${m.fileId}', this)" style="position:absolute; top:-6px; right:-6px; background:#ef4444; border:none; color:white; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; line-height:1; display:flex; align-items:center; justify-content:center; padding:0; z-index:1;">×</button>
                <svg width="42" height="50" viewBox="0 0 42 50" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="${color}" opacity="0.15"/>
                    <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="none" stroke="${color}" stroke-width="2"/>
                    <path d="M28 0 L28 14 L42 14" fill="none" stroke="${color}" stroke-width="2"/>
                    <text x="21" y="34" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${label}</text>
                </svg>
                <div style="font-size:11px; color:var(--text-primary); text-align:center; word-break:break-all; line-height:1.3; max-width:80px;">${name}</div>
                <div style="font-size:10px; color:var(--text-muted);">${sizeStr}</div>
            </div>`;
        }).join('') + '</div>';
    } catch (err) {
        container.innerHTML = `<div class="warning" style="font-size:13px;">Chyba: ${err.message}</div>`;
    }
}

async function deleteAiMaterial(scenarioId, fileId, btn) {
    btn.disabled = true; btn.textContent = "Mažu…";
    try {
        const res = await fetch(`${API_BASE}/api/ai/scenarios/${scenarioId}/materials/${fileId}`, {
            method: "DELETE", headers: getHeaders()
        });
        if (!res.ok) throw new Error(await res.text());
        showToast("Soubor smazán.");
        await loadAiScenarioMaterials(scenarioId);
    } catch (err) {
        btn.disabled = false; btn.textContent = "Smazat";
        showToast("Chyba: " + err.message, true);
    }
}

// ── Edit panel: šablony persony ──────────────────────────────────────────────

function renderAiEditPersonaTemplateButtons() {
    const container = document.getElementById('aiEditPersonaTemplateButtons');
    if (!container || !window.AI_PERSONA_TEMPLATES) return;
    container.innerHTML = window.AI_PERSONA_TEMPLATES.map(t => `
        <button type="button"
            onclick="applyAiEditPersonaTemplate('${t.id}')"
            title="${t.description}"
            style="padding:5px 12px; font-size:12px; border-radius:6px; border:1px solid var(--border-color);
                   background:var(--bg-status); color:var(--text-primary); cursor:pointer; white-space:nowrap;"
            onmouseover="this.style.background='var(--bg-card-hover)'; this.style.borderColor='#3e67a8';"
            onmouseout="this.style.background='var(--bg-status)'; this.style.borderColor='var(--border-color)';"
            id="edit-persona-btn-${t.id}">
            ${t.label}
        </button>
    `).join('');
}

function applyAiEditPersonaTemplate(templateId) {
    const template = window.AI_PERSONA_TEMPLATES?.find(t => t.id === templateId);
    if (!template) return;
    const textarea = document.getElementById('aiEdit_persona');
    if (!textarea) return;
    document.querySelectorAll('[id^="edit-persona-btn-"]').forEach(btn => {
        btn.style.background = 'var(--bg-status)';
        btn.style.borderColor = 'var(--border-color)';
        btn.style.fontWeight = 'normal';
    });
    const activeBtn = document.getElementById(`edit-persona-btn-${templateId}`);
    if (activeBtn) {
        activeBtn.style.background = '#eff6ff';
        activeBtn.style.borderColor = '#3e67a8';
        activeBtn.style.fontWeight = 'bold';
    }
    textarea.value = template.text;
    showToast(`Šablona "${template.label}" načtena.`);
}

// ── Edit panel: materiály ────────────────────────────────────────────────────

window._pendingAiEditMaterials = [];

function handleAiEditMatSelect(event) {
    const files = Array.from(event.target.files || []);
    addPendingAiEditFiles(files);
    event.target.value = "";
}

function handleAiEditMatDrop(event) {
    event.preventDefault();
    const dropZone = document.getElementById("aiEditMatDropZone");
    if (dropZone) { dropZone.style.background = ""; dropZone.style.borderColor = "var(--border-color)"; }
    addPendingAiEditFiles(Array.from(event.dataTransfer?.files || []));
}

function addPendingAiEditFiles(files) {
    const allowed = ['pdf', 'txt', 'md', 'docx'];
    files.forEach(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        if (!allowed.includes(ext)) { showToast(`"${f.name}" není podporován.`, true); return; }
        if (f.size > 10 * 1024 * 1024) { showToast(`"${f.name}" je příliš velký (max 10 MB).`, true); return; }
        window._pendingAiEditMaterials.push(f);
    });
    renderPendingAiEditFiles();
}

function removePendingAiEditFile(index) {
    window._pendingAiEditMaterials.splice(index, 1);
    renderPendingAiEditFiles();
}

function renderPendingAiEditFiles() {
    const listEl = document.getElementById("aiEditMatPendingList");
    if (!listEl) return;
    if (window._pendingAiEditMaterials.length === 0) { listEl.innerHTML = ""; return; }
    const colors = { pdf:'#ef4444', docx:'#3e67a8', txt:'#6b7280', md:'#6b7280' };
    const labels = { pdf:'PDF', docx:'DOC', txt:'TXT', md:'MD' };
    listEl.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px;">'
        + window._pendingAiEditMaterials.map((f, i) => {
            const ext = f.name.split('.').pop().toLowerCase();
            const color = colors[ext] || '#6b7280';
            const label = labels[ext] || ext.toUpperCase();
            const sizeStr = f.size < 1024*1024 ? `${(f.size/1024).toFixed(1)} KB` : `${(f.size/1024/1024).toFixed(1)} MB`;
            return `<div style="display:flex; flex-direction:column; align-items:center; gap:6px; width:80px; position:relative;">
                <button onclick="removePendingAiEditFile(${i})" style="position:absolute; top:-6px; right:-6px; background:#ef4444; border:none; color:white; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; line-height:1; display:flex; align-items:center; justify-content:center; padding:0; z-index:1;">×</button>
                <svg width="42" height="50" viewBox="0 0 42 50" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="${color}" opacity="0.15"/>
                    <path d="M6 0 H28 L42 14 V44 Q42 50 36 50 H6 Q0 50 0 44 V6 Q0 0 6 0Z" fill="none" stroke="${color}" stroke-width="2"/>
                    <path d="M28 0 L28 14 L42 14" fill="none" stroke="${color}" stroke-width="2"/>
                    <text x="21" y="34" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${label}</text>
                </svg>
                <div style="font-size:11px; color:var(--text-primary); text-align:center; word-break:break-all; line-height:1.3; max-width:80px;">${f.name}</div>
                <div style="font-size:10px; color:var(--text-muted);">${sizeStr}</div>
            </div>`;
        }).join('') + '</div>';
}

async function uploadAiEditMaterials(scenarioId) {
    if (!window._pendingAiEditMaterials || window._pendingAiEditMaterials.length === 0) return;
    const statusEl = document.getElementById('aiEditMatUploadStatus');
    if (statusEl) statusEl.innerText = 'Nahrávám nové soubory...';
    for (const file of window._pendingAiEditMaterials) {
        const formData = new FormData();
        formData.append("file", file);
        try {
            const res = await fetch(`${API_BASE}/api/ai/scenarios/${scenarioId}/materials`, {
                method: "POST",
                headers: { "X-Mock-User": currentUserEmail || "" },
                body: formData
            });
            if (!res.ok) showToast(`Chyba u "${file.name}": ${await res.text()}`, true);
        } catch (err) {
            showToast(`Chyba: ${err.message}`, true);
        }
    }
    window._pendingAiEditMaterials = [];
    renderPendingAiEditFiles();
    if (statusEl) statusEl.innerText = '';
    await loadAiScenarioMaterials(scenarioId);
}

async function saveEditedAiScenario() {
    const statusDiv = document.getElementById('aiEdit_status');
    const title = document.getElementById('aiEdit_title').value.trim();
    const description = document.getElementById('aiEdit_description').value.trim();
    const goal = document.getElementById('aiEdit_goal').value.trim();
    const persona = document.getElementById('aiEdit_persona').value.trim();
    const rubric = document.getElementById('aiEdit_rubric').value.trim();
    const os = document.getElementById('aiEdit_os').value;
    const timeLimitRaw = parseInt(document.getElementById('aiEdit_timeLimit').value);
    const timeLimit = isNaN(timeLimitRaw) ? 60 : timeLimitRaw;
    const subtasks = parseInt(document.getElementById('aiEdit_subtasks').value) || 3;
    const deadline = document.getElementById('aiEdit_deadline').value;
    const gradingStyle = document.getElementById('aiEdit_gradingStyle').value;
    const maxPoints = parseInt(document.getElementById('aiEdit_maxPoints').value) || 10;
    const difficulty = document.getElementById('aiEdit_difficulty').value;
    const adaptive = document.getElementById('aiEdit_adaptive').value;
    const tags = document.getElementById('aiEdit_tags').value.trim();
    const tools = document.getElementById('aiEdit_tools').value.trim();
    const maxAttempts = parseInt(document.getElementById('aiEdit_maxAttempts').value) || 0;
    const allowSkip = document.getElementById('aiEdit_allowSkip').value;
    const autoSubmit = document.getElementById('aiEdit_autoSubmit')?.checked ? '[AUTO_SUBMIT:true]' : '';

    // Získání vybraných typů otázek a režimu střídání
    const isRotateEdit = document.getElementById("aiEdit_qtypesRotate").checked;
    const cbsEdit = Array.from(document.querySelectorAll('.qtype-cb-edit:checked'));
    let selectedTypesEdit = [];
    if (isRotateEdit) {
        selectedTypesEdit = cbsEdit.map(cb => cb.value);
    } else {
        selectedTypesEdit = cbsEdit.map(cb => {
            const countInput = cb.closest('label').querySelector('.qtype-count-edit');
            const count = countInput ? (parseInt(countInput.value) || 1) : 1;
            return `${cb.value}(${count})`;
        });
    }
    if (selectedTypesEdit.length === 0) selectedTypesEdit.push("otevřená odpověď");
    const qtypesTagEdit = `[QTYPES:${selectedTypesEdit.join(', ')}][QTYPES_ROTATE:${isRotateEdit}]`;

    if (!title || !description || !goal || !persona) {
        statusDiv.style.color = 'red';
        statusDiv.innerText = 'Vyplňte prosím název, popis, vzdělávací cíl i personu AI.';
        return;
    }

    const scenarioId = activeDetailScenarioId;
    const courseId = activeDetailScenarioCourseId;
    if (!scenarioId || !courseId) {
        statusDiv.style.color = 'red';
        statusDiv.innerText = 'Chyba: neznámé ID zadání.';
        return;
    }

    const saveBtn = document.querySelector('#panel-ai-edit button[onclick="saveEditedAiScenario()"]');
    if (saveBtn) saveBtn.disabled = true;
    showToast('Ukládám změny...', false);
    statusDiv.innerText = '';

    const aiPrompt = `CÍL MENTORA:\n${goal}\n\nOSOBNOST MENTORA:\n${persona}`;
    let gradingHint = `[GRADING:${gradingStyle}`;
    if (gradingStyle !== 'none') gradingHint += `:${maxPoints}`;
    gradingHint += ']';

    // Determine if this is an education scenario (from existing hints in the table or from visible edu fields)
    const currentHints = document.getElementById('aiEditEdu_topics') ? (() => {
        const eduEl = document.getElementById('aiEditEdu_fields');
        return eduEl && eduEl.style.display !== 'none';
    })() : false;
    const isEduEdit = currentHints;

    let editHintsStr;
    if (isEduEdit) {
        const topicsEdit = document.getElementById('aiEditEdu_topics')?.value.trim() || '';
        const presEdit = document.getElementById('aiEditEdu_presentation')?.value || 'combined';
        const verifyQEdit = parseInt(document.getElementById('aiEditEdu_verifyQ')?.value) || 2;
        const threshEdit = parseInt(document.getElementById('aiEditEdu_threshold')?.value) || 75;
        const maxRepEdit = parseInt(document.getElementById('aiEditEdu_maxRepeats')?.value) || 3;
        const vqtypesEdit = document.getElementById('aiEditEdu_verifyQtypes')?.value || 'combined';
        const explainEdit = document.getElementById('aiEditEdu_explainStyle')?.value || 'adaptive';
        editHintsStr = `[TYPE:ai_education][TOPICS:${topicsEdit}][PRESENTATION:${presEdit}][VERIFY_Q:${verifyQEdit}][THRESHOLD:${threshEdit}][MAX_REPEATS:${maxRepEdit}][VERIFY_QTYPES:${vqtypesEdit}][EXPLAIN_STYLE:${explainEdit}][TIME_LIMIT:${timeLimit}]${gradingHint}${autoSubmit}`;
    } else {
        editHintsStr = `[ADAPTIVE:${adaptive}][SUBTASKS:${subtasks}][TIME_LIMIT:${timeLimit}][DIFFICULTY:${difficulty}][TAGS:${tags}][TOOLS:${tools}][ALLOW_SKIP:${allowSkip}]${gradingHint}${qtypesTagEdit}${autoSubmit}`;
    }
    const _aiEditPrereqIds = window.getPrereqIds?.('prereqsAiEditContainer') || '';
    if (_aiEditPrereqIds) editHintsStr += `[PREREQS:${_aiEditPrereqIds}]`;

    try {
        const res = await fetch(`${API_BASE}/api/ai/scenarios/${scenarioId}/update`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({
                title,
                description,
                instructions: aiPrompt,
                grading_rubric: rubric || 'Ohodnoť studenta podle toho, jak úspěšně splnil zadání.',
                required_os: os,
                time_limit: timeLimit,
                deadline: deadline || null,
                max_attempts: maxAttempts,
                hints: editHintsStr
            })
        });
        if (!res.ok) throw new Error(await res.text());

        showToast('Změny byly uloženy.');
        if (window._pendingAiEditMaterials?.length > 0) {
            await uploadAiEditMaterials(scenarioId);
        }

        // Immediately patch local cache so reopening edit form shows correct prereqs/hints
        if (window._scenarioCache && window._scenarioCache[scenarioId]) {
            window._scenarioCache[scenarioId].hints = editHintsStr;
            window._scenarioCache[scenarioId].title = title;
            window._scenarioCache[scenarioId].description = description;
        }

        // Obnov cache — znovu načti zadání z API
        if (typeof loadScenarios === 'function') await loadScenarios();

        if (saveBtn) saveBtn.disabled = false;
    } catch (err) {
        showToast(`Chyba: ${err.message}`, true);
        if (saveBtn) saveBtn.disabled = false;
    }
}

