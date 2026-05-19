async function submitLatestAttempt() {
    const submitBtn = document.getElementById("submitBtn");
    const stopBtn = document.getElementById("stopBtn");
    if (submitBtn) submitBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;

    // Zamkni AI kontejner pomocí nové hard-lock metody
    if (window.aiScenario && typeof window.aiScenario.setLock === 'function') {
        window.aiScenario.setLock(true);
    } else {
        const _aiContainer = document.getElementById('ai-scenario-container');
        if (_aiContainer) { _aiContainer.style.pointerEvents = 'none'; _aiContainer.style.opacity = '0.6'; }
    }

    const latestAttempt = latestAttemptMap[currentScenarioId];
    const attemptId = latestAttempt ? latestAttempt.attemptId : null;

    clearPageMessage();
    const scenario = currentScenarios.find(s => s.scenarioId === currentScenarioId);
    const _isEduSubmit = !!(scenario && (scenario.hints || '').includes('[TYPE:ai_education]'));
    showToast(_isEduSubmit ? "Ukládám výsledky..." : "Odesílám odevzdání...", false, true);

    window.syncInputsToSession();
    const variantNum = window.getScenarioVariantNumber
        ? window.getScenarioVariantNumber(scenario, latestAttempt?.runNumber || 1)
        : (latestAttempt?.runNumber || 1);
    const structuredConfig = window.resolveStructuredTaskConfig
        ? window.resolveStructuredTaskConfig(scenario, variantNum)
        : null;
    const isStructuredTask = Array.isArray(structuredConfig?.tasks) && structuredConfig.tasks.length > 0;
    const isStepTask = !isStructuredTask && /\[STEP\d+\]/.test(scenario?.instructions || '');

    let autoScore = null;
    let autoScoreHtml = '';

    const stepPoints = isStepTask ? (window._stepPoints || []) : [];
    const stepHashes = isStepTask ? (window._stepHashes || []) : [];
    const stepTexts = isStepTask ? (window._stepTexts || []) : [];
    const stepRubrics = isStepTask ? (window._stepRubrics || []) : [];
    const stepSolutionTexts = isStepTask ? (window._stepSolutionTexts || []) : [];

    const hasLocalExactValidation = Array.isArray(stepHashes) &&
    stepHashes.some(arr => Array.isArray(arr) ? arr.some(Boolean) : Boolean(arr));

    const _submitKey = getStepProgressKey();
    const _submitSaved = JSON.parse(sessionStorage.getItem(_submitKey) || 'null');

    if (isStepTask && hasLocalExactValidation && stepPoints.length > 0 && _submitSaved) {
    const totalPoints = stepPoints.reduce((a, b) => a + b, 0);
    let earned = 0;

    stepPoints.forEach((pts, i) => {
        const remaining = _submitSaved.pointsRemaining?.[i];
        const isCompleted = _submitSaved.completed?.includes(i);
        const isSkipped = _submitSaved.skipped?.includes(i);
        if (isCompleted && !isSkipped) {
        earned += (remaining !== undefined ? remaining : pts);
        }
    });

    autoScore = earned;
    const grading = parseGradingInfo(scenario?.hints);
    const grade = getGradeFromScore(earned, { ...grading, max: totalPoints });
    const gColor = grade === 'F' ? '#ef4444' : '#22c55e';

    autoScoreHtml = `
        <div style="margin-top:12px; padding:14px 18px; background:var(--bg-status); border:1px solid var(--border-color); border-radius:10px;">
        <div style="font-size:15px; font-weight:bold; color:var(--text-primary); margin-bottom:6px;">
            Váš výsledek: <strong>${earned} / ${totalPoints} b</strong>
            <span style="background:${gColor}; color:white; padding:2px 10px; border-radius:6px; font-size:14px; margin-left:8px;">${grade}</span>
        </div>
        <div style="font-size:13px; color:var(--text-muted);">Čeká na potvrzení učitelem.</div>
        </div>`;
    }

    try {
    let stepDetails = null;

    if (isStepTask && stepTexts.length > 0 && _submitSaved) {
        stepDetails = stepTexts.map((taskText, i) => {
        const rawAnswer = _submitSaved.answers?.[i] || '';
        const skipped = _submitSaved.skipped?.includes(i) || rawAnswer === '__SKIPPED__';
        const answered = skipped || (!!rawAnswer && rawAnswer !== '__SKIPPED__');

        let pointsEarned = null;
        if (hasLocalExactValidation) {
            pointsEarned = skipped
            ? 0
            : (_submitSaved.pointsRemaining?.[i] ?? (_submitSaved.completed?.includes(i) ? (stepPoints[i] || 0) : 0));
        }

        return {
            step: i + 1,
            task_text: taskText,
            rubric: stepRubrics[i] || '',
            solution_text: stepSolutionTexts[i] || '',
            points_max: stepPoints[i] || 0,
            points_earned: pointsEarned,
            completed: hasLocalExactValidation ? !!_submitSaved.completed?.includes(i) : answered,
            skipped: skipped,
            hints_used: _submitSaved.hintsUsed?.[i] || 0,
            answer: skipped ? '__SKIPPED__' : rawAnswer
        };
        });
    }

    let contentPayload = document.getElementById("submissionNote").value.trim();

    // Explicitní sync CM editorů do textarea před odevzdáním
    if (window._studentCmInstances) {
        Object.entries(window._studentCmInstances).forEach(([idx, cm]) => {
            const ta = document.getElementById(`structured-answer-${idx}`);
            if (ta && cm) ta.value = cm.getValue();
        });
    }

    if (isStructuredTask && window.collectStructuredTaskSubmission) {
        const structuredSubmission = window.collectStructuredTaskSubmission(scenario);

        if (structuredSubmission) {
            contentPayload = structuredSubmission.contentPayload;
            stepDetails = structuredSubmission.stepDetails;
            if (structuredSubmission.autoScore !== null) {
                autoScore = structuredSubmission.autoScore;
            }
        }
    } else if (stepDetails && stepDetails.length > 0) {
        const lines = stepDetails.map(d => {
        const answerText = d.skipped
            ? '(přeskočeno)'
            : (d.answer && d.answer !== '__SKIPPED__' ? d.answer : '(bez odpovědi)');

        const scoreSuffix = hasLocalExactValidation && d.points_earned !== null
            ? ` [${d.points_earned}/${d.points_max} b${d.hints_used > 0 ? `, nápovědy: ${d.hints_used}` : ''}]`
            : '';

        return `Krok ${d.step}: ${answerText}${scoreSuffix}`;
        });

        contentPayload = lines.join('\n');
    }

    const _submitScenarioHints = (typeof currentScenarios !== 'undefined' ? currentScenarios : [])
        ?.find?.(s => s.scenarioId === currentScenarioId)?.hints || '';
    const _submitIsEdu = _submitScenarioHints.includes('[TYPE:ai_education]');
    const _submitIsAiExercise = _submitScenarioHints.includes('[ADAPTIVE:true]');
    // Spusť buildPayload jen pokud odevzdáváme skutečně AI scénář/vzdělávání — ne jiné zadání
    const aiPayload = (_submitIsEdu || _submitIsAiExercise) && window.aiScenario?.isActive() ? window.aiScenario.buildPayload() : null;
    // Guard: pokud buildPayload vrátilo edu formát ale scénář je cvičení, ignoruj ho
    const _aiPayloadValid = aiPayload && !(!_submitIsEdu && aiPayload.trimStart().startsWith('[AI_EDUCATION]'));
    if (_aiPayloadValid) {
        contentPayload = aiPayload;
        if (aiPayload.trimStart().startsWith('[AI_EDUCATION]') && typeof window.aiScenario.buildStepDetails === 'function') {
            try { stepDetails = JSON.parse(window.aiScenario.buildStepDetails()); } catch {}
        } else if (window.aiScenario._state) {
            autoScore = window.aiScenario._state.earnedPoints;
            const aiHistory = window.aiScenario._state.subtaskHistory || [];
            if (aiHistory.length) {
                stepDetails = aiHistory.map((h, i) => ({
                    step_id: `ai-${i + 1}`,
                    step: i + 1,
                    task_type: h.qtype || 'open',
                    title: (h.question || '').split('\n')[0].trim().slice(0, 50),
                    task_text: h.question || '',
                    points_earned: h.points ?? 0,
                    max_points: h.maxPoints ?? 0,
                    points_max: h.maxPoints ?? 0,
                    answer: h.answer || '',
                    feedback: (h.feedback || '').split(/\n---\n/)[0].trim(),
                    reasoning: h.reasoning || '',
                }));
            }
        }
    } else if (!_submitIsEdu && _submitIsAiExercise && aiPayload && window.aiScenario?._state) {
        // Fallback: buildPayload vrátilo [AI_EDUCATION] pro cvičení — použij _state přímo
        const _st = window.aiScenario._state;
        autoScore = _st.earnedPoints;
        const aiHistory = _st.subtaskHistory || [];
        const lines = aiHistory.map((h, i) => {
            const pts = `[${h.points ?? 0}/${h.maxPoints ?? 0} b]`;
            return `Úkol ${i + 1} ${pts}:\nOtázka: ${h.question || ''}\nOdpověď: ${h.answer || ''}\n${h.correctAnswer ? `Správná odpověď: ${h.correctAnswer}\n` : ''}Zpětná vazba AI: ${(h.feedback || '').split(/\n---\n/)[0].trim()}\n---`;
        });
        contentPayload = `[AI_SCENARIO]\nCelkem bodů: ${_st.earnedPoints ?? 0} / ${_st.maxPoints ?? 0}\n\n${lines.join('\n')}`;
        if (aiHistory.length) {
            stepDetails = aiHistory.map((h, i) => ({
                step_id: `ai-${i + 1}`,
                step: i + 1,
                task_type: h.qtype || 'open',
                title: (h.question || '').split('\n')[0].trim().slice(0, 50),
                task_text: h.question || '',
                points_earned: h.points ?? 0,
                max_points: h.maxPoints ?? 0,
                points_max: h.maxPoints ?? 0,
                answer: h.answer || '',
                feedback: (h.feedback || '').split(/\n---\n/)[0].trim(),
                reasoning: h.reasoning || '',
            }));
        }
    }

    await apiPost(`/submissions`, {
        courseId: currentCourseId,
        scenarioId: currentScenarioId,
        attemptId: attemptId,
        submissionType: "text",
        contentPayload: contentPayload,
        ...(autoScore !== null ? { score: autoScore } : {}),
        ...(stepDetails ? { step_details: JSON.stringify(stepDetails) } : {})
    });

    currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
    currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
    buildLatestAttemptMap();

    window._pendingScoreMessage = null; // Nerenderujeme přes renderScenarioDetail

    if (window.aiScenario?.isActive && typeof window.aiScenario.lock === 'function') {
        window.aiScenario.lock();
    }

    // AUTO_SUBMIT — cvičení bez hodnocení učitele: hned archivuj pokus
    const _autoSubmitScenario = currentScenarios.find(s => s.scenarioId === currentScenarioId);
    const _isAdaptiveScenario = (_autoSubmitScenario?.hints || '').includes('[ADAPTIVE:true]') || _autoSubmitScenario?.difficulty === 'adaptive';
    const _isAutoSubmit = (_autoSubmitScenario?.hints || '').includes('[AUTO_SUBMIT:true]');
    // EXACT + PASS_THRESHOLD bez AUTO_SUBMIT → také auto-archivace
    const _scenarioHints = _autoSubmitScenario?.hints || '';
    const _hasPassThreshold = _scenarioHints.includes('[PASS_THRESHOLD:');
    const _hasExact = _scenarioHints.includes('[EXACT:true]') || _scenarioHints.includes('[SEQUENTIAL:true]');
    const _isExactAutoArchive = _hasExact && _hasPassThreshold && !_isAutoSubmit && !_isAdaptiveScenario;
    const submittedScenarioId = currentScenarioId;





    localStorage.removeItem('active_lab_course');

    const submissionNoteEl = document.getElementById("submissionNote");
    if (submissionNoteEl) {
        submissionNoteEl.value = "";
    }

    if (window.clearStructuredTaskDrafts) {
        window.clearStructuredTaskDrafts();
    }

    // Důležité:
    // U AUTO_SUBMIT, EXACT a ADAPTIVE auto-archivace nesmíme hned překreslit UI,
    // jinak si student na chvíli uvidí mezistav "pokus byl odevzdán".
    if (!_isAutoSubmit && !_isExactAutoArchive && !_isAdaptiveScenario) {
        renderScenarios();
        await renderScenarioDetail();
    }

    if (_isAutoSubmit) {
        const _startBtn = document.getElementById('startBtn');
        if (_startBtn) { _startBtn.disabled = true; _startBtn.style.opacity = '0.5'; _startBtn.style.cursor = 'not-allowed'; }

        if (currentScenarioId === submittedScenarioId) {
            hideToast();
            showToast('Ukládám výsledky…', false, true);
        }

        // Získej submissionId robustněji:
        // backend může vrátit submission se zpožděním, takže jednorázový fetch nestačí.
        let _mySub = null;
        for (let _retry = 0; _retry < 8; _retry++) {
            const _freshSubs = await apiGet(`/courses/${currentCourseId}/my-submissions`);
            _mySub = _freshSubs.find(s => s.attemptId === attemptId);

            if (_mySub?.submissionId) break;
            await new Promise(resolve => setTimeout(resolve, 350));
        }

        let _autoScore = autoScore;
        let _autoFeedback = "";

        if (!_mySub?.submissionId) {
            throw new Error("Odevzdání bylo uloženo, ale nepodařilo se dohledat submissionId pro automatické vyhodnocení a archivaci.");
        }

        if (_mySub?.submissionId) {
            // AI hodnocení per krok před archivací
            try {
                const _instr = _autoSubmitScenario?.instructions || "";
                const _hints = _autoSubmitScenario?.hints || "";
                const _gradingMatch = _hints.match(/\[GRADING:\s*[a-zA-Z]+\s*:?\s*(\d+)?\s*\]/i);
                
                if (!_gradingMatch || !_gradingMatch[1]) {
                    const _textMatch = _hints.match(/max(?:\.|im[áa]ln[íi])?\s*(?:po[čc]et\s*)?bod[uů]?\s*:?\s*(\d+)/i) || 
                                       _instr.match(/max(?:\.|im[áa]ln[íi])?\s*(?:po[čc]et\s*)?bod[uů]?\s*:?\s*(\d+)/i);
                    if (_textMatch) _totalMax = parseInt(_textMatch[1], 10);
                }

                // Rozbal správnou variantu podle runNumber
                const _runNum = latestAttemptMap[currentScenarioId]?.runNumber || 1;
                const _hintsForVariant = _autoSubmitScenario?.hints || "";
                const _mappedVariantM = _hintsForVariant.match(new RegExp(`\\[\\s*MAP${_runNum}\\s*:([\\s\\S]*?)\\]`));
                const _variantNum = _mappedVariantM ? parseInt(_mappedVariantM[1]) : _runNum;
                const _variantBlockM = _instr.match(new RegExp(`\\[VARIANT${_variantNum}\\]([\\s\\S]*?)\\[\\/VARIANT${_variantNum}\\]`));
                const _instrResolved = _variantBlockM ? _variantBlockM[1] : _instr;

                const _stepRx = /\[STEP(\d+)\s*\]([\s\S]*?)\[\/STEP\1\s*\]/gi;
                const _steps = [];
                let _sm;
                while ((_sm = _stepRx.exec(_instrResolved)) !== null) {
                    const _sNum = parseInt(_sm[1], 10);
                    const _stepId = _sm[1];
                    const _rubricM = _instrResolved.match(new RegExp(`\\[RUBRIC${_stepId}\\]([\\s\\S]*?)\\[\\/RUBRIC${_stepId}\\]`, 'i'));
                    const _solutionTextM = _instrResolved.match(new RegExp(`\\[SOLUTION_TEXT${_stepId}\\]([\\s\\S]*?)\\[\\/SOLUTION_TEXT${_stepId}\\]`, 'i'));
                    const _solExactM = _instrResolved.match(new RegExp(`\\[SOL${_stepId}\\]([\\s\\S]*?)\\[\\/SOL${_stepId}\\]`, 'i'));

                    let _expectedAnswer = '';
                    if (_solutionTextM && _solutionTextM[1]) {
                        _expectedAnswer = _solutionTextM[1].trim();
                    } else if (_solExactM && _solExactM[1]) {
                        _expectedAnswer = _solExactM[1]
                            .trim()
                            .replace(/^FLAG\[(.+)\]$/i, '$1');
                    }

                    _steps.push({
                        step: _sNum,
                        text: _sm[2].trim(),
                        rubric: _rubricM ? _rubricM[1].trim() : '',
                        expectedAnswer: _expectedAnswer
                    });
                }

                if (_steps.length > 0) {
                    const _payload = _mySub.contentPayload || "";
                    const _answerMap = {};
                    const _ansRx = /^Krok\s+(\d+):\s*/gm;
                    const _starts = [];
                    let _am;
                    while ((_am = _ansRx.exec(_payload)) !== null) _starts.push({ n: _am[1], s: _am.index + _am[0].length, marker: _am.index });
                    _starts.forEach((it, i) => {
                        const end = i + 1 < _starts.length ? _starts[i+1].marker : _payload.length;
                        _answerMap[it.n] = _payload.slice(it.s, end).replace(/\s*\[\d+\/\d+.*?\]\s*$/, '').trim();
                    });
                    if (_starts.length === 0 && _payload.trim()) _answerMap["1"] = _payload.trim();

                    const _base = Math.floor(_totalMax / _steps.length);
                    const _rem = _totalMax - _base * _steps.length;
                    const _ptsList = _steps.map((_, i) => _base + (i < _rem ? 1 : 0));

                    const _results = [];
                    for (let i = 0; i < _steps.length; i++) {
                        try {
                            let _rubricForStep = _steps[i].rubric || '';
                            if (_steps[i].expectedAnswer) {
                                _rubricForStep += `${_rubricForStep ? '\n\n' : ''}Správné řešení:\n${_steps[i].expectedAnswer}`;
                            }

                            const _evalPayload = {
                                question: _steps[i].text,
                                answer: _answerMap[String(_steps[i].step)] || '(bez odpovědi)',
                                maxPoints: _ptsList[i],
                                rubric: _rubricForStep
                            };

                            const _normalizeEvalText = (value) =>
                                String(value || '')
                                    .trim()
                                    .toLowerCase()
                                    .normalize('NFD')
                                    .replace(/[\u0300-\u036f]/g, '');

                            const _expectedNorm = _normalizeEvalText(_steps[i].expectedAnswer);
                            const _answerNorm = _normalizeEvalText(_evalPayload.answer);

                            // EXACT / SEQUENTIAL úloha s přesnou odpovědí:
                            // pokud se odpověď přesně shoduje se správným řešením,
                            // nečekáme na AI a uznáme plný počet bodů lokálně.
                            if (_expectedNorm && _answerNorm && _expectedNorm === _answerNorm) {
                                _results.push({
                                    step: _steps[i].step,
                                    points: _ptsList[i],
                                    maxPoints: _ptsList[i],
                                    feedback: 'Odpověď přesně odpovídá správnému řešení.',
                                    correctAnswer: _steps[i].expectedAnswer || null,
                                    explanation: null
                                });

                                continue;
                            }

                            const _r = await fetch(`${API_BASE}/api/ai/evaluate-step`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-Mock-User': currentUserEmail },
                                body: JSON.stringify(_evalPayload)
                            });

                            const _rawText = await _r.text();

                            if (_r.ok) {
                                let _d = {};
                                try {
                                    _d = JSON.parse(_rawText);
                                } catch {
                                    _d = {};
                                }

                                _results.push({
                                    step: _steps[i].step,
                                    points: Number(_d.points || 0),
                                    maxPoints: _ptsList[i],
                                    feedback: _d.feedback || '',
                                    correctAnswer: _d.correct_answer || _steps[i].expectedAnswer || null,
                                    explanation: _d.explanation || null
                                });
                            }
                        } catch { }
                    }

                    if (_results.length > 0) {
                        _autoScore = _results.reduce((s, r) => s + r.points, 0);
                        _autoFeedback = _results.map(r => {
                            let line = `Krok ${r.step} (${r.points}/${r.maxPoints} b): ${r.feedback}`;
                            if (r.correctAnswer) line += `\n[CORRECT_ANSWER]: ${r.correctAnswer}`;
                            if (r.explanation) line += `\n[EXPLANATION]: ${r.explanation}`;
                            return line;
                        }).join('\n\n');
                    }
                }
            } catch { }

            try {
                await apiPost(`/submissions/${_mySub.submissionId}/auto-archive`, {
                    score: _autoScore,
                    feedback_text: _autoFeedback || null
                });
            } catch (e) {
                throw new Error('Auto-archivace pokusu selhala: ' + (e?.message || e));
            }
        }

        // Znovu načti po archivaci a překresli až teď.
        // V tuhle chvíli už musí být pokus archivovaný a nový pokus se má povolit.
        currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
        currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
        buildLatestAttemptMap();
        renderScenarios();
        await renderScenarioDetail();

        if (currentScenarioId === submittedScenarioId) {
            hideToast();
            // PASS_THRESHOLD — zobraz výsledek splněno/nesplněno
            const _hints = _autoSubmitScenario?.hints || '';
            const _thresholdM = _hints.match(/\[PASS_THRESHOLD:(\d+)\]/);
            if (_thresholdM) {
                const _threshold = parseInt(_thresholdM[1]);
                const _gradingM = _hints.match(/\[GRADING:[a-zA-Z]+:(\d+)\]/);
                const _maxPts = _gradingM ? parseInt(_gradingM[1]) : 10;
                const _scoreFinal = _autoScore ?? 0;
                const _pct = _maxPts > 0 ? Math.round((_scoreFinal / _maxPts) * 100) : 0;
                const _passed = _pct >= _threshold;
                // Ulož výsledek do localStorage pro zobrazení v detailu
                localStorage.setItem(`pass_result_${attemptId}`, JSON.stringify({ passed: _passed, pct: _pct, threshold: _threshold, score: _scoreFinal, max: _maxPts }));
                showToast(_passed
                    ? `✅ Úkol splněn! Dosáhl jsi ${_pct} % (min. ${_threshold} %).`
                    : `❌ Úkol nesplněn. Dosáhl jsi ${_pct} % (min. ${_threshold} %). Zkus to znovu.`,
                    !_passed);
            } else {
                showToast('Cvičení dokončeno! Body byly uloženy. Můžeš začít nový pokus.');
            }
        }
        return;
    }

    if (_isExactAutoArchive) {
        const _freshSubsExact = await apiGet(`/courses/${currentCourseId}/my-submissions`);
        const _mySubExact = _freshSubsExact.find(s => s.attemptId === attemptId);
        const _thresholdMExact = _scenarioHints.match(/\[PASS_THRESHOLD:(\d+)\]/);
        const _thresholdExact = _thresholdMExact ? parseInt(_thresholdMExact[1]) : 70;
        const _gradingMExact = _scenarioHints.match(/\[GRADING:[a-zA-Z]+:(\d+)\]/);
        const _maxPtsExact = _gradingMExact ? parseInt(_gradingMExact[1]) : 10;
        const _scoreExact = autoScore ?? 0;
        const _pctExact = _maxPtsExact > 0 ? Math.round((_scoreExact / _maxPtsExact) * 100) : 0;
        const _passedExact = _pctExact >= _thresholdExact;

        if (_mySubExact?.submissionId) {
            try {
                await apiPost(`/submissions/${_mySubExact.submissionId}/auto-archive`, {
                    score: _scoreExact,
                    feedback_text: null
                });
            } catch { }
        }
        localStorage.setItem(`pass_result_${attemptId}`, JSON.stringify({ passed: _passedExact, pct: _pctExact, threshold: _thresholdExact, score: _scoreExact, max: _maxPtsExact }));

        currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
        currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
        buildLatestAttemptMap();
        renderScenarios();
        await renderScenarioDetail();

        if (currentScenarioId === submittedScenarioId) {
            hideToast();
            showToast(_passedExact
                ? `Úkol splněn! Dosáhl jsi ${_pctExact} % (min. ${_thresholdExact} %).`
                : `Úkol nesplněn. Dosáhl jsi ${_pctExact} % (min. ${_thresholdExact} %). Zkus to znovu.`,
                !_passedExact);
        }
        return;
    }

    if (_isAdaptiveScenario) {
        const _startBtn = document.getElementById('startBtn');
        if (_startBtn) { _startBtn.disabled = true; _startBtn.style.opacity = '0.5'; _startBtn.style.cursor = 'not-allowed'; }

        if (currentScenarioId === submittedScenarioId) {
            hideToast();
            showToast('Ukládám výsledky a generuji zpětnou vazbu…', false, true);
        }

        let _mySubAdaptive = null;
        for (let _retry = 0; _retry < 8; _retry++) {
            const _freshSubs = await apiGet(`/courses/${currentCourseId}/my-submissions`);
            _mySubAdaptive = _freshSubs.find(s => s.attemptId === attemptId);
            if (_mySubAdaptive?.submissionId) break;
            await new Promise(resolve => setTimeout(resolve, 350));
        }

        if (_mySubAdaptive?.submissionId) {
            try {
                // Převzatá logika tvorby textu z ai_evaluator.py
                const _maxPtsAI = window.aiScenario?._state?.maxPoints || 0;
                const _earnedAI = autoScore || 0;
                const _pctAI = _maxPtsAI > 0 ? Math.round((_earnedAI / _maxPtsAI) * 100) : 0;
                
                let summaryMsg = "";
                if (_pctAI >= 90) summaryMsg = `Výborně, dosáhli jste ${_earnedAI} bodů z ${_maxPtsAI}!`;
                else if (_pctAI >= 70) summaryMsg = `Gratuluji, dosáhli jste ${_earnedAI} bodů z ${_maxPtsAI}.`;
                else if (_pctAI >= 50) summaryMsg = `Dosáhli jste ${_earnedAI} bodů z ${_maxPtsAI}, což je průměrný výsledek.`;
                else summaryMsg = `Bohužel jste tentokrát dosáhli pouze ${_earnedAI} bodů z ${_maxPtsAI}.`;

                const _aiHistory = window.aiScenario?._state?.subtaskHistory || [];
                const _synthLines = [`Celkové skóre studenta: ${_earnedAI} / ${_maxPtsAI} bodů\n`]
                    .concat(_aiHistory.map((h, i) =>
                        `Úkol ${i+1} (${h.points ?? 0}/${h.maxPoints ?? 0} b): ${h.feedback || 'Bez zpětné vazby.'}`
                    )).join('\n');

                let finalFeedbackText = summaryMsg;
                try {
                    const _mockUser = (typeof getMockUser === 'function') ? getMockUser() : (currentUser?.email || '');
                    const _synthRes = await fetch(`${API_BASE}/api/ai/synthesize-feedback`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Mock-User': _mockUser },
                        body: JSON.stringify({ feedbacks: _synthLines })
                    });
                    if (_synthRes.ok) {
                        const _synthData = await _synthRes.json();
                        finalFeedbackText = _synthData.feedback || summaryMsg;
                    }
                } catch { }

                if (_isAutoSubmit) {
                    // AUTO_SUBMIT zapnutý → archivuj hned, student může pokračovat
                    await apiPost(`/submissions/${_mySubAdaptive.submissionId}/auto-archive`, {
                        score: _earnedAI,
                        feedback_text: finalFeedbackText
                    });
                } else {
                    // Bez AUTO_SUBMIT → jen ulož skóre a zpětnou vazbu, čeká na učitele
                    await apiPost(`/submissions/${_mySubAdaptive.submissionId}/save-score`, {
                        score: _earnedAI,
                        feedback_text: finalFeedbackText
                    });
                }
            } catch { }
        }

        currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
        currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
        buildLatestAttemptMap();
        renderScenarios();
        await renderScenarioDetail();

        if (currentScenarioId === submittedScenarioId) {
            hideToast();
            if (_isAutoSubmit) {
                showToast(`Cvičení dokončeno! Získali jste ${autoScore || 0} bodů.`);
            } else {
                showToast(`Cvičení odevzdáno! Výsledek zkontroluje učitel.`);
            }
        }
        return;
    }
    if (currentScenarioId === submittedScenarioId) {
        hideToast();
        showToast("Výsledek byl úspěšně odevzdán.");
        if (autoScoreHtml) {
        localStorage.setItem('score_html_' + attemptId, autoScoreHtml);
        setAttemptStatus(autoScoreHtml);
        }
    }
    } catch (err) {
    hideToast();
    showPageMessage(`Chyba při odevzdání: ${err.message}`, "error");
    
    if (submitBtn) submitBtn.disabled = false;
    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) stopBtn.disabled = false;

    if (window.aiScenario && typeof window.aiScenario.setLock === 'function') {
        window.aiScenario.setLock(false);
    } else {
        const _aiContainerErr = document.getElementById('ai-scenario-container');
        if (_aiContainerErr) { _aiContainerErr.style.pointerEvents = ''; _aiContainerErr.style.opacity = ''; }
    }
    }
}

async function loadArtifact() {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    if (!latestAttempt) return;

    try {
    const text = await apiGetText(`/attempts/${latestAttempt.attemptId}/artifact`);
    setArtifact(text);
    } catch (err) {
    setArtifact(`Chyba při načítání artefaktu: ${err.message}`);
    }
}

async function refreshSelectedScenario() {
    if (!currentCourseId || !currentScenarioId) return;

    try {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    if (latestAttempt) {
        await apiPost(`/attempts/${latestAttempt.attemptId}/refresh`, {});
    }

    currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
    currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
    buildLatestAttemptMap();
    renderScenarios();
    renderScenarioDetail();
    } catch (err) {
    setAttemptStatus("");
    showPageMessage(`Chyba při obnově: ${err.message}`, "error");
    }
}

async function pollAttempt(attemptId) {
        // Ochrana: pokud předchozí volání ještě běží, přeskoč tento tick
        if (window._pollInFlight) return;
        window._pollInFlight = true;
        try {
        const attempt = await apiGet(`/attempts/${attemptId}`);


        currentAttempts = currentAttempts.filter(a => a.attemptId !== attemptId);
        currentAttempts.unshift(attempt);
        
        currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
        
        buildLatestAttemptMap();
        
        // Pokud backend pošle URL pro GUI (guiUrl), uložíme si ji.
        // Nesmíme ukládat artifactPath, to je cesta k textovému souboru!
        if (attempt.status === "succeeded" && attempt.guiUrl) {
            localStorage.setItem('lab_url_' + attempt.attemptId, attempt.guiUrl);
        }

        renderScenarios();

        // KONTROLA STAVU PRO ZASTAVENÍ POLLINGU
        // "succeeded" bez URL potřebuje polling, "succeeded" s URL = hotovo → zastav
        const savedUrl = localStorage.getItem('lab_url_' + attemptId) || attempt.guiUrl;
        const hasUrl = (savedUrl && savedUrl.startsWith("http")) || savedUrl === 'skip';
        const activeStates = ["queued", "provisioning", "running", "started", ...(hasUrl ? [] : ["succeeded"])];

        // Překresli detail POUZE pokud se stav změnil — ne při každém ticku
        // Tím zachováme rozepsané odpovědi studenta
        const prevStatus = window._lastPollStatus?.[attemptId];
        const currStatus = attempt.status + (hasUrl ? '_url' : '');
        if (prevStatus !== currStatus) {
            if (!window._lastPollStatus) window._lastPollStatus = {};
            window._lastPollStatus[attemptId] = currStatus;

            await renderScenarioDetail();
        } else {
            // Stav se nezměnil — jen aktualizuj labLink a status bez překreslení DOM
            const labLink = document.getElementById("labLinkContainer");
            if (labLink && attempt.status === "succeeded" && hasUrl) {
                window.currentLabUrl = savedUrl;
                labLink.style.display = savedUrl === "skip" ? "none" : "block";
                hideToast();
            }
        }

        if (attempt.status === "succeeded" && !hasUrl) {
            // Azure nasadil kontejner ale URL ještě není v DB.
            // Zastavíme polling a za 5 sekund automaticky zavoláme /refresh.
            clearPolling();
            setTimeout(async () => {
                try {
                    await apiPost(`/attempts/${attemptId}/refresh`, {});
                    currentAttempts = await apiGet(`/courses/${currentCourseId}/my-attempts`);
                    currentSubmissions = await apiGet(`/courses/${currentCourseId}/my-submissions`);
                    buildLatestAttemptMap();
                    renderScenarios();
                    const savedUrlAfter = localStorage.getItem('lab_url_' + attemptId) || attempt.guiUrl;
                    if (!window._lastPollStatus) window._lastPollStatus = {};
                    window._lastPollStatus[attemptId] = ''; // Vynutí překreslení
                    renderScenarioDetail();
                } catch (e) {
                    LOG.error('Auto-refresh selhal:', e.message);
                }
            }, 5000);
        } else if (!activeStates.includes(attempt.status)) {
            clearPolling();
        }

        } catch (err) {
        LOG.error('chyba v pollAttempt:', err.message);
        clearPolling();
        setAttemptStatus("");
        showPageMessage(`Chyba při čtení stavu běhu: ${err.message}`, "error");
        } finally {
        window._pollInFlight = false;
        }
    }

    function startPolling(attemptId) {

    clearPolling();
    pollAttempt(attemptId);
    pollTimer = setInterval(() => pollAttempt(attemptId), 3000);
    }