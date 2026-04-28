

function startScenario() {
    if (!currentScenarioId) return;

    // Zamrazíme tlačítko ihned preventivně (ochrana proti double-clicku před vyskočením modalu)
    const startBtn = document.getElementById("startBtn");
    if (startBtn) startBtn.disabled = true;

    let modal = document.getElementById('startConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'startConfirmModal';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:500; display:flex; justify-content:center; align-items:center;">
            <div style="background:var(--bg-panel); border:2px solid var(--border-color); border-radius:12px; padding:24px; width:380px; max-width:95%; box-shadow:0 8px 32px rgba(0,0,0,0.25);">
                <h3 style="margin:0 0 12px 0; color:var(--text-primary); font-size:16px;">Opravdu chcete spustit prostředí?</h3>
                <p style="margin:0 0 20px 0; font-size:14px; color:var(--text-primary); line-height:1.6;">
                    Opravdu chcete spustit laboratorní prostředí pro tuto úlohu? Čas se spustí jakmile se objeví vstup do grafického prostředí.
                </p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button onclick="document.getElementById('startConfirmModal').innerHTML=''; document.getElementById('startBtn').disabled = false;"
                        style="padding:8px 18px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-status); color:var(--text-primary); cursor:pointer; font-size:14px;">
                        Zrušit
                    </button>
                    <button onclick="document.getElementById('startConfirmModal').innerHTML=''; window._handleStartConfirmed();"
                        style="padding:8px 18px; border-radius:6px; border:none; background:var(--btn-primary); color:white; cursor:pointer; font-size:14px; font-weight:bold;">
                        Ano, spustit
                    </button>
                </div>
            </div>
        </div>`;

// Definuj handler — pokud je lab selector zapnutý, zobraz výběr, jinak rovnou spusť
window._handleStartConfirmed = function() {
    if (window.LAB_SELECTOR_ENABLED && typeof window.showLabSelectorModal === 'function') {
        window.showLabSelectorModal((selectedTemplate) => {
            window.executeStartScenario(selectedTemplate);
        });
    } else {
        window.executeStartScenario();
    }
};
}

window.executeStartScenario = async function(overrideTemplate = null) {
    if (!currentScenarioId) return;
    
    // Pokud overrideTemplate je null, znamená to, že uživatel vybral "Přeskočit spuštění labu" v modalu
    const skipLab = (overrideTemplate === null);
    
    // Tlačítko zůstává zamrazené
    const startBtn = document.getElementById("startBtn");
    if (startBtn) startBtn.disabled = true;

    setAttemptStatus("");
    clearPageMessage();
    showToast("Spouštím prostředí...", false, true);

    // Okamžitě zamkni ostatní úlohy — vždy přepiš na dočasný aktivní záznam
    // aby renderScenarios() okamžitě zablokoval ostatní karty
    const _previousAttemptRecord = latestAttemptMap[currentScenarioId];
    latestAttemptMap[currentScenarioId] = {
        attemptId: `pending-${Date.now()}`,
        scenarioId: currentScenarioId,
        status: "queued",
        learningStatus: "started"
    };
    localStorage.setItem('active_lab_course', currentCourseId);
    renderScenarios();
    updateMaterialsLockState(); // OKAMŽITÉ ZAMČENÍ MATERIÁLŮ PO POTVRZENÍ
    updateCoursesLockState();   // OKAMŽITÉ ZAMČENÍ KURZŮ PO POTVRZENÍ
    
    window.syncInputsToSession(); // Uloží rozepsaný text do starého klíče ("none")

    // Uložíme čas kliknutí — odpočet ho pak použije jako offset, aby se čekání na lab nepočítalo
    window._labClickTime = Date.now();

    try {
        if (skipLab) {
            showToast("Testovací režim: lab se nespustí, zadání se načte.", false, true);
        }

        const uniqueId = Math.random().toString(16).slice(2, 10);
        const data = await apiPost(`/scenarios/${currentScenarioId}/start`, {
            attemptId: `pokus-${uniqueId}`,
            labImage: skipLab ? "skip" : (overrideTemplate?.labImage || null),
            overrideTemplateId: skipLab ? null : (overrideTemplate?.overrideTemplateId || null),
        });
        // Nejprve aktualizujeme pokusy, abychom měli jistotu správného attemptId z backendu
        currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
        buildLatestAttemptMap();
        
        // Nyní máme jistotu, že latestAttemptMap obsahuje správné ID pro migraci
        const actualAttemptId = latestAttemptMap[currentScenarioId]?.attemptId || data.attemptId;

        // Přesuň rozpracované odpovědi z klíče 'none' pod nový attemptId
        const oldKey = `step_progress_${currentScenarioId}_none`;
        const newKey = `step_progress_${currentScenarioId}_${actualAttemptId}`;
        const oldData = sessionStorage.getItem(oldKey);
        
        // Zachráníme aktuálně rozepsané texty přímo do objektu před migrací (pojistka)
        let progressObj = oldData ? JSON.parse(oldData) : {completed:[], current:0, answers:{}, skipped:[], hintsUsed:{}, pointsRemaining:{}};
        if (!progressObj.answers) progressObj.answers = {};
        document.querySelectorAll('input[id^="step-answer-"]').forEach(inp => {
            if (!inp.disabled) {
                const idx = parseInt(inp.id.replace('step-answer-', ''), 10);
                if (inp.value) progressObj.answers[idx] = inp.value;
            }
        });
        
        sessionStorage.setItem(newKey, JSON.stringify(progressObj));
        sessionStorage.removeItem(oldKey);

        // Smaž záznamy jiných starých pokusů (ne aktuální nový)
        Object.keys(sessionStorage)
            .filter(k => k.startsWith(`step_progress_${currentScenarioId}_`) && k !== newKey && k !== oldKey)
            .forEach(k => sessionStorage.removeItem(k));

        // Uložíme URL do paměti, ale ZELENÉ TLAČÍTKO ZATÍM NEUKAZUJEME (čekáme na polling)
        if (data.guiUrl) {
            localStorage.setItem('lab_url_' + actualAttemptId, data.guiUrl);
        } else if (skipLab) {
            // Skip mode — žádný lab, ale označíme jako hotovo aby polling nezasekl
            localStorage.setItem('lab_url_' + actualAttemptId, 'skip');
        }

        renderScenarios();
        await renderScenarioDetail(); // Automaticky obnoví texty z nového klíče
        startPolling(actualAttemptId);
    } catch (err) {
        LOG.error('chyba v startScenario:', err.message);
        setAttemptStatus(""); // Vyčistíme inline status
        showPageMessage(`Chyba při spuštění: ${err.message}`, "error");
        // Obnov původní záznam v mapě aby se karty odblokly
        if (_previousAttemptRecord) {
            latestAttemptMap[currentScenarioId] = _previousAttemptRecord;
        } else {
            delete latestAttemptMap[currentScenarioId];
        }
        localStorage.removeItem('active_lab_course');
        renderScenarios();
        updateMaterialsLockState(); // ODBLOKOVÁNÍ MATERIÁLŮ POKUD START SELŽE
        updateCoursesLockState();   // ODBLOKOVÁNÍ KURZŮ POKUD START SELŽE
        document.getElementById("startBtn").disabled = false;
    }
}

function stopScenario(force = false) {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    if (!latestAttempt) return Promise.resolve();

    // Pokud vypršel čas (force=true), přeskočíme potvrzení a vrátíme Promise
    if (force) {
        return window.executeStopScenario();
    }

    // Preventivně zamrazíme tlačítko ihned po kliknutí (proti double clicku)
    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.style.pointerEvents = "none";
    }

    let modal = document.getElementById('stopConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'stopConfirmModal';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:500; display:flex; justify-content:center; align-items:center;">
            <div style="background:var(--bg-panel); border:2px solid var(--border-color); border-radius:12px; padding:24px; width:380px; max-width:95%; box-shadow:0 8px 32px rgba(0,0,0,0.25);">
                <h3 style="margin:0 0 12px 0; color:var(--text-primary); font-size:16px;">🛑 Ukončit laboratorní prostředí?</h3>
                <p style="margin:0 0 20px 0; font-size:14px; color:var(--text-primary); line-height:1.6;">
                    Opravdu chcete lab ukončit? Všechna data v něm budou nenávratně smazána.
                </p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button onclick="document.getElementById('stopConfirmModal').innerHTML=''; document.getElementById('stopBtn').disabled = false; document.getElementById('stopBtn').style.pointerEvents = 'auto';"
                        style="padding:8px 18px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-status); color:var(--text-primary); cursor:pointer; font-size:14px;">
                        Zrušit
                    </button>
                    <button onclick="document.getElementById('stopConfirmModal').innerHTML=''; window.executeStopScenario();"
                        style="padding:8px 18px; border-radius:6px; border:none; background:#ef4444; color:white; cursor:pointer; font-size:14px; font-weight:bold;">
                        Ano, ukončit lab
                    </button>
                </div>
            </div>
        </div>`;
}

window.executeStopScenario = async function() {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    if (!latestAttempt) return;

    // Okamžitě schovat tlačítko Vstoupit a URL
    const labLinkContainerImmediate = document.getElementById("labLinkContainer");
    if (labLinkContainerImmediate) labLinkContainerImmediate.style.display = "none";
    window.currentLabUrl = null;

    // Zamkni všechna tlačítka během mazání labu
    window._stopInProgress = true;
    const _lockBtns = ['startBtn','stopBtn','submitBtn'].map(id => document.getElementById(id)).filter(Boolean);
    _lockBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; b.style.cursor = 'not-allowed'; b.style.pointerEvents = 'none'; });
    
    if (window.aiScenario && typeof window.aiScenario.setLock === 'function') {
        window.aiScenario.setLock(true);
    } else {
        const _aiContainer = document.getElementById('ai-scenario-container');
        if (_aiContainer) { _aiContainer.style.pointerEvents = 'none'; _aiContainer.style.opacity = '0.6'; }
    }

    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.style.opacity = "0.5";
        stopBtn.style.cursor = "not-allowed";
        stopBtn.style.pointerEvents = "none";
    }

    try {
    setAttemptStatus(""); // Skryje rámeček dole
    showPageMessage("Ukončuji a mažu prostředí v Azure...", "info");
    
    await apiPost(`/attempts/${latestAttempt.attemptId}/stop`, {});

    // Vyčistíme UI a mezipaměť prohlížeče
    const labLinkContainer = document.getElementById("labLinkContainer");
    if (labLinkContainer) labLinkContainer.style.display = "none";
    
    // stopBtn NESCHOVÁVÁME — zůstane šedý disabled dokud renderScenarioDetail() nepřekreslí DOM
    window.currentLabUrl = null;
    localStorage.removeItem('lab_url_' + latestAttempt.attemptId);

    setAttemptStatus("");

    // Po úspěšném stopu — nastav flag aby se AI znovu nezamkl při refreshi
    window._stopJustCompleted = true;
    await refreshSelectedScenario();
    window._stopInProgress = false;
    window._stopJustCompleted = false;
    // Odemkni AI container po refreshi
    if (window.aiScenario && typeof window.aiScenario.setLock === 'function') {
        window.aiScenario.setLock(false);
    }
    showPageMessage("Lab byl úspěšně ukončen a smazán.", "success");
    } catch (err) {
    window._stopInProgress = false;
    showPageMessage(`Chyba při ukončování: ${err.message}`, "error");
    // Obnov interaktivitu při chybě
    if (window.aiScenario && typeof window.aiScenario.setLock === 'function') {
        window.aiScenario.setLock(false);
    } else {
        const _aiContainerErr = document.getElementById('ai-scenario-container');
        if (_aiContainerErr) { _aiContainerErr.style.pointerEvents = ''; _aiContainerErr.style.opacity = ''; }
    }
    const _submitBtnErr = document.getElementById('submitBtn');
    if (_submitBtnErr) { _submitBtnErr.disabled = false; _submitBtnErr.style.opacity = ''; _submitBtnErr.style.cursor = ''; }
    
    const _startBtnErr = document.getElementById('startBtn');
    if (_startBtnErr) { _startBtnErr.disabled = false; _startBtnErr.style.opacity = ''; _startBtnErr.style.cursor = ''; }
    
    if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.style.background = "#ef4444";
        stopBtn.style.color = "white";
        stopBtn.style.opacity = "1";
        stopBtn.style.cursor = "pointer";
        stopBtn.style.pointerEvents = "auto";
        stopBtn.innerText = "Ukončit lab";
    }
    }
};

function openLabTab() {
    if (window.currentLabUrl) {
        window.open(window.currentLabUrl, '_blank');
        
        const latestAttempt = latestAttemptMap[currentScenarioId];
        if (latestAttempt && !localStorage.getItem('lab_start_' + latestAttempt.attemptId)) {
            // Čas startu = čas kliknutí na "Spustit prostředí" (ne teď),
            // aby se čekání na přípravu labu nepočítalo do limitu studenta
            const effectiveStart = window._labClickTime || Date.now();
            localStorage.setItem('lab_start_' + latestAttempt.attemptId, effectiveStart);
            renderScenarioDetail();
        }
    }
}

function updateStatusAndFeedback(latestAttempt, sub, state, currentRunNumber, scenario) {
        let statusHtml = "";
        
        if (!latestAttempt) {
            statusHtml = "Zatím bez pokusu.";
        } else {
            const savedUrl = localStorage.getItem('lab_url_' + latestAttempt.attemptId) || latestAttempt.guiUrl;
            const hasUrl = savedUrl && (savedUrl.startsWith("http") || savedUrl === "skip");
            const isProvisioning = ["queued", "provisioning", "running", "started"].includes(latestAttempt.status)
                || (latestAttempt.status === "succeeded" && !hasUrl);

            if (isProvisioning) {
                statusHtml = `<span style="color:var(--text-muted); font-size:13px;">⏳ Spouštím prostředí, čekejte prosím...</span>`;
                showToast("Spouštím prostředí...", false, true);
            } else {
                hideToast();
                // Zobraz uložené skóre pokud bylo odevzdáno a ještě není nový pokus
                const savedScoreHtml = localStorage.getItem('score_html_' + latestAttempt.attemptId);
                if (savedScoreHtml && (latestAttempt.learningStatus === "submitted" || latestAttempt.learningStatus === "evaluated")) {
                    statusHtml = savedScoreHtml;
                }
            }

            // Čas běží i po ukončení labu, dokud student neodevzdá řešení
            const isSubmitted = sub && (sub.status === "submitted" || sub.status === "evaluated" || latestAttempt.learningStatus === "submitted" || latestAttempt.learningStatus === "evaluated");
            const activeStates = ["provisioning", "running", "succeeded", "finished", "started", "deleting", "stopped", "failed"];
            
            if (!isSubmitted && activeStates.includes(latestAttempt.status)) {
                const startTime = localStorage.getItem('lab_start_' + latestAttempt.attemptId);
                let timeLimit = 60;
                const m = scenario.hints ? scenario.hints.match(/\[TIME_LIMIT:(\d+)\]/) : null;
                if (m) timeLimit = parseInt(m[1], 10);
                if (startTime) startLabCountdown(Number(startTime), timeLimit);
            } else {
                // Pokud už je odevzdáno, odpočet natvrdo zastavíme
                if (window._labCountdownInterval) clearInterval(window._labCountdownInterval);
            }
        }
        setAttemptStatus(statusHtml);
    }
