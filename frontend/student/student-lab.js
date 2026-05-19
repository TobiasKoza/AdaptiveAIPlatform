

function startScenario() {
    if (!currentScenarioId) return;

    // Zamrazíme tlačítko ihned preventivně (ochrana proti double-clicku před vyskočením modalu)
    const startBtn = document.getElementById("startBtn");
    if (startBtn) startBtn.disabled = true;

    const _scen = (typeof currentScenarios !== 'undefined' && currentScenarios)
        ? currentScenarios.find(s => s.scenarioId === currentScenarioId) : null;
    const isNoLab = _scen?.requiredOs === 'none';

    let modal = document.getElementById('startConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'startConfirmModal';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:500; display:flex; justify-content:center; align-items:center;">
            <div style="background:var(--bg-panel); border:2px solid var(--border-color); border-radius:12px; padding:24px; width:380px; max-width:95%; box-shadow:0 8px 32px rgba(0,0,0,0.25);">
                <h3 style="margin:0 0 12px 0; color:var(--text-primary); font-size:16px;">${isNoLab ? 'Opravdu chcete spustit úlohu?' : 'Opravdu chcete spustit prostředí?'}</h3>
                <p style="margin:0 0 20px 0; font-size:14px; color:var(--text-primary); line-height:1.6;">
                    ${isNoLab ? 'Opravdu chcete spustit tuto úlohu? Čas se spustí ihned po potvrzení.' : 'Opravdu chcete spustit laboratorní prostředí pro tuto úlohu? Čas se spustí jakmile se objeví vstup do grafického prostředí.'}
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

window._handleStartConfirmed = function() {
    window.executeStartScenario();
};
}

window.executeStartScenario = async function(overrideTemplate = null) {
    if (!currentScenarioId) return;

    const _scen2 = (typeof currentScenarios !== 'undefined' && currentScenarios)
        ? currentScenarios.find(s => s.scenarioId === currentScenarioId) : null;
    const _isNoLab = _scen2?.requiredOs === 'none';

    // overrideTemplate === "skip" = explicitní přeskočení; _isNoLab = none OS (žádný lab)
    const skipLab = (overrideTemplate === "skip") || _isNoLab;

    const startBtn = document.getElementById("startBtn");
    if (startBtn) startBtn.disabled = true;

    setAttemptStatus("");
    clearPageMessage();
    showToast(_isNoLab ? "Spouštím úlohu..." : "Spouštím prostředí...", false, true);

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
    updateMaterialsLockState();
    updateCoursesLockState();
    
    window.syncInputsToSession(); // Uloží rozepsaný text do starého klíče ("none")

    // Uložíme čas kliknutí — odpočet ho pak použije jako offset, aby se čekání na lab nepočítalo
    window._labClickTime = Date.now();

    try {
        if (skipLab && !_isNoLab) {
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
        updateMaterialsLockState();
        updateCoursesLockState();
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

    const labLinkContainerImmediate = document.getElementById("labLinkContainer");
    if (labLinkContainerImmediate) labLinkContainerImmediate.style.display = "none";
    window.currentLabUrl = null;

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
    if (window.aiScenario && typeof window.aiScenario.setLock === 'function') {
        window.aiScenario.setLock(false);
    }
    showPageMessage("Lab byl úspěšně ukončen a smazán.", "success");
    } catch (err) {
    window._stopInProgress = false;
    showPageMessage(`Chyba při ukončování: ${err.message}`, "error");
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

async function pauseScenario() {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    if (!latestAttempt) return;

    const pauseBtn = document.getElementById("pauseBtn");
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.style.opacity = "0.5";
        pauseBtn.style.cursor = "not-allowed";
        pauseBtn.style.pointerEvents = "none";
    }

    try {
        // Ulož aktuální stav do LS — musí proběhnout před čtením aiState níže
        if (typeof window.aiScenario?.saveProgress === 'function') {
            await window.aiScenario.saveProgress();
        }

        // Počkej na dokončení in-flight /ai-state fire-and-forget requestů, aby /pause
        // nesoupeřil s pozdě doručeným starším stavem a nepřepsal ho v Azure.
        await new Promise(r => setTimeout(r, 500));

        const aiStateKey = `ai_scenario_${currentScenarioId}_${latestAttempt.attemptId}`;
        const aiState = localStorage.getItem(aiStateKey) || null;

        await apiPost(`/attempts/${latestAttempt.attemptId}/pause`, { ai_state: aiState });

        // Okamžitě zaktualizuj lokální mapu (bez čekání na polling)
        latestAttemptMap[currentScenarioId] = { ...latestAttempt, learningStatus: "paused" };

        // Zastav AI modul — deactivate() zastaví jak exercise (_ai) tak edu (_edu) mód
        if (typeof window.aiScenario?.deactivate === 'function') {
            window.aiScenario.deactivate();
        } else if (window.aiScenario?._state) {
            window.aiScenario._state.isRunning = false;
        }

        renderScenarios();
        await renderScenarioDetail();
        showPageMessage("Cvičení bylo pozastaveno. Všechny vaše odpovědi jsou uloženy.", "success");
    } catch (err) {
        showPageMessage(`Chyba při pozastavení: ${err.message}`, "error");
        if (pauseBtn) {
            pauseBtn.disabled = false;
            pauseBtn.style.opacity = "";
            pauseBtn.style.cursor = "";
            pauseBtn.style.pointerEvents = "auto";
        }
    }
}

async function resumePausedScenario() {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    if (!latestAttempt) return;

    const startBtn = document.getElementById("startBtn");
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.style.opacity = "0.5";
        startBtn.style.cursor = "not-allowed";
        startBtn.style.pointerEvents = "none";
    }

    const _placeholder = document.getElementById("task-box-placeholder");
    if (_placeholder) {
        _placeholder.style.cssText = "display:flex;align-items:center;gap:12px;padding:18px 20px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-panel);margin:12px 0;";
        _placeholder.innerHTML = `<div class="ai-spinner"></div><span style="color:var(--text-muted);font-size:14px;">Načítám, kde jste naposledy skončili…</span>`;
    }

    // Okamžitě zablokuj ostatní scénáře a kurzy — ještě před API voláním
    latestAttemptMap[currentScenarioId] = { ...latestAttempt, learningStatus: "started" };
    renderScenarios();
    updateCoursesLockState();

    try {
        const data = await apiPost(`/attempts/${latestAttempt.attemptId}/resume`, {});

        // Backend je autoritativní — vždy přepiš localStorage
        if (data.pausedAiState) {
            const aiStateKey = `ai_scenario_${currentScenarioId}_${latestAttempt.attemptId}`;
            localStorage.setItem(aiStateKey, data.pausedAiState);
        }

        latestAttemptMap[currentScenarioId] = { ...latestAttempt, learningStatus: "started", ...(data.pausedAiState ? { pausedAiState: data.pausedAiState } : {}) };

        // Příznak pro renderScenarioDetail: zobrazit "Načítám, kde jste skončili…" místo "Připravuji první úkol…"
        window._resumingFromPause = latestAttempt.attemptId;

        renderScenarios();
        await renderScenarioDetail();

        // Zablokuj tlačítka dokud se obsah reálně nenačte
        window._resumeLoadingActive = true;
        const _pauseBtnLoad = document.getElementById("pauseBtn");
        const _submitBtnLoad = document.getElementById("submitBtn");
        if (_pauseBtnLoad) { _pauseBtnLoad.disabled = true; _pauseBtnLoad.style.opacity = "0.5"; _pauseBtnLoad.style.cursor = "not-allowed"; _pauseBtnLoad.style.pointerEvents = "none"; }
        if (_submitBtnLoad) { _submitBtnLoad.disabled = true; _submitBtnLoad.style.opacity = "0.5"; _submitBtnLoad.style.cursor = "not-allowed"; _submitBtnLoad.style.pointerEvents = "none"; }
    } catch (err) {
        // Vrať optimistický update zpět na paused
        latestAttemptMap[currentScenarioId] = latestAttempt;
        renderScenarios();
        updateCoursesLockState();
        await renderScenarioDetail();
        showPageMessage(`Chyba při obnovení: ${err.message}`, "error");
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.style.opacity = "";
            startBtn.style.cursor = "";
            startBtn.style.pointerEvents = "auto";
        }
    }
}

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
            statusHtml = "";
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
                if (startTime && timeLimit > 0) startLabCountdown(Number(startTime), timeLimit);
            } else {
                // Pokud už je odevzdáno, odpočet natvrdo zastavíme
                if (window._labCountdownInterval) clearInterval(window._labCountdownInterval);
            }
        }
        setAttemptStatus(statusHtml);
    }
