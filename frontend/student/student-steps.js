if (typeof window.customConfirm !== 'function') {
    window.customConfirm = function(msg, onConfirm) {
        let modal = document.getElementById('_customConfirmModal');
        if (!modal) { modal = document.createElement('div'); modal.id = '_customConfirmModal'; document.body.appendChild(modal); }
        modal.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;">
                <div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:24px;width:400px;max-width:95%;box-shadow:0 8px 32px rgba(0,0,0,0.25);">
                    <p style="margin:0 0 20px 0;font-size:14px;color:var(--text-primary);line-height:1.6;">${msg}</p>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button onclick="document.getElementById('_customConfirmModal').innerHTML=''"
                            style="padding:8px 18px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-status);color:var(--text-primary);cursor:pointer;font-size:14px;">
                            Zrušit
                        </button>
                        <button id="_customConfirmOk"
                            style="padding:8px 18px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:14px;font-weight:bold;">
                            Pokračovat
                        </button>
                    </div>
                </div>
            </div>`;
        document.getElementById('_customConfirmOk').onclick = () => { modal.innerHTML = ''; onConfirm(); };
    };
}

window.goToStep = function(index) {
    document.querySelectorAll('[id^="lab-step-"]').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`lab-step-${index}`);
    if (target) target.classList.remove('hidden');
    
    if (currentScenarioId) {
        sessionStorage.setItem(`last_viewed_step_${currentScenarioId}`, index);
    }
};

function getStepProgressKey() {
    const attemptId = latestAttemptMap[currentScenarioId]?.attemptId || 'none';
    return `step_progress_${currentScenarioId}_${attemptId}`;
}

window.saveDraftAnswer = function(stepIndex) {
    const key = getStepProgressKey();
    const existing = JSON.parse(sessionStorage.getItem(key) || '{"completed":[],"current":0,"answers":{},"skipped":[],"hintsUsed":{},"pointsRemaining":{}}');
    const input = document.getElementById(`step-answer-${stepIndex}`);
    if (input) {
        if (!existing.answers) existing.answers = {};
        existing.answers[stepIndex] = input.value;
        sessionStorage.setItem(key, JSON.stringify(existing));
    }
};

function saveStepProgress(stepIndex) {
    if (!latestAttemptMap[currentScenarioId]?.attemptId) return;
    const key = getStepProgressKey();
    const existing = JSON.parse(sessionStorage.getItem(key) || '{"completed":[],"current":0,"answers":{},"skipped":[],"hintsUsed":{},"pointsRemaining":{}}');
    if (!existing.completed.includes(stepIndex)) existing.completed.push(stepIndex);
    existing.current = stepIndex + 1;
    const input = document.getElementById(`step-answer-${stepIndex}`);
    if (!existing.answers) existing.answers = {};
    if (input) existing.answers[stepIndex] = input.value;

    if (!existing.skipped) existing.skipped = [];
    if (input && input.value === '__SKIPPED__' && !existing.skipped.includes(stepIndex)) {
        existing.skipped.push(stepIndex);
    }

    if (!existing.hintsUsed) existing.hintsUsed = {};
    if (!existing.pointsRemaining) existing.pointsRemaining = {};
    if (window._stepHintsUsed) existing.hintsUsed[stepIndex] = window._stepHintsUsed[stepIndex] || 0;
    const currentEl = document.getElementById(`step-points-current-${stepIndex}`);
    if (currentEl) {
        const parsed = parseInt(currentEl.textContent);
        // Ukládáme jen pokud element existuje a má smysluplnou hodnotu
        // Nikdy nepřepíšeme existující kladnou hodnotu nulou kvůli skrytému DOM
        if (!isNaN(parsed) && (parsed > 0 || existing.pointsRemaining[stepIndex] === undefined)) {
            existing.pointsRemaining[stepIndex] = parsed;
        }
    } else if (existing.pointsRemaining[stepIndex] === undefined && window._stepPoints) {
        // Element neexistuje (zadání skryté) — spočítej z aktuálního stavu nápověd
        const maxPts = window._stepPoints[stepIndex] || 0;
        const hintsUsed = window._stepHintsUsed?.[stepIndex] || 0;
        const hints = (window._stepHints || [])[stepIndex] || [];
        const hintCost = hints.slice(0, hintsUsed).reduce((a, h) => a + h.cost, 0);
        existing.pointsRemaining[stepIndex] = Math.max(0, maxPts - hintCost);
    }

    sessionStorage.setItem(key, JSON.stringify(existing));
}

// Volá se po každém použití nápovědy (mimo saveStepProgress)
function saveHintProgress(stepIndex) {
    if (!latestAttemptMap[currentScenarioId]?.attemptId) return;
    const key = getStepProgressKey();
    const existing = JSON.parse(sessionStorage.getItem(key) || '{"completed":[],"current":0,"answers":{},"skipped":[],"hintsUsed":{},"pointsRemaining":{}}');
    if (!existing.hintsUsed) existing.hintsUsed = {};
    if (!existing.pointsRemaining) existing.pointsRemaining = {};
    existing.hintsUsed[stepIndex] = (window._stepHintsUsed || [])[stepIndex] || 0;
    const currentEl = document.getElementById(`step-points-current-${stepIndex}`);
    if (currentEl) {
        const parsed = parseInt(currentEl.textContent);
        if (!isNaN(parsed) && (parsed > 0 || existing.pointsRemaining[stepIndex] === undefined)) {
            existing.pointsRemaining[stepIndex] = parsed;
        }
    } else if (existing.pointsRemaining[stepIndex] === undefined && window._stepPoints) {
        const maxPts = window._stepPoints[stepIndex] || 0;
        const hintsUsed = window._stepHintsUsed?.[stepIndex] || 0;
        const hints = (window._stepHints || [])[stepIndex] || [];
        const hintCost = hints.slice(0, hintsUsed).reduce((a, h) => a + h.cost, 0);
        existing.pointsRemaining[stepIndex] = Math.max(0, maxPts - hintCost);
    }
    sessionStorage.setItem(key, JSON.stringify(existing));
}

window.syncInputsToSession = function() {
    if (!currentScenarioId) return;
    const key = getStepProgressKey();
    const existingStr = sessionStorage.getItem(key);
    const existing = JSON.parse(existingStr || '{"completed":[],"current":0,"answers":{},"skipped":[],"hintsUsed":{},"pointsRemaining":{}}');
    if (!existing.answers) existing.answers = {};
    let changed = false;
    
    document.querySelectorAll('input[id^="step-answer-"], textarea[id^="step-answer-"]').forEach(inp => {
        if (!inp.disabled) {
            const idx = parseInt(inp.id.replace('step-answer-', ''), 10);
            if (existing.answers[idx] !== inp.value) {
                existing.answers[idx] = inp.value;
                changed = true;
            }
        }
    });
    if (changed) sessionStorage.setItem(key, JSON.stringify(existing));
};

function restoreStepProgress() {
    const latestAttempt = latestAttemptMap[currentScenarioId];
    const attemptId = latestAttempt?.attemptId;
    if (!attemptId) return;
    // Neobnov stav pokud je pokus archivován (učitel povolil nový pokus)
    if (latestAttempt.status === 'archived') return;
    const key = getStepProgressKey();
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!saved) return;

    if (saved.hintsUsed && window._stepHintsUsed) {
        Object.entries(saved.hintsUsed).forEach(([i, count]) => {
            window._stepHintsUsed[parseInt(i)] = count;
        });
    }

    if (saved.answers) {
        Object.keys(saved.answers).forEach(iStr => {
            const i = parseInt(iStr, 10);
            const input = document.getElementById(`step-answer-${i}`);
            // Pokud krok není označen jako hotový ani přeskočený, doplníme uložený text
            if (input && !saved.completed.includes(i) && !(saved.skipped && saved.skipped.includes(i))) {
                input.value = saved.answers[i];
            }
        });
    }

    saved.completed.forEach(i => {
        const input = document.getElementById(`step-answer-${i}`);
        const feedbackEl = document.getElementById(`step-feedback-${i}`);
        const submitBtn = document.getElementById(`step-btn-${i}`);
        const nextBtn = document.getElementById(`step-next-btn-${i}`);
        const hintBtn = document.getElementById(`step-hint-btn-${i}`);
        const skipBtn = document.getElementById(`step-skip-btn-${i}`);

        const isSkipped = saved.skipped && saved.skipped.includes(i);

        if (input) { input.disabled = true; input.value = saved.answers?.[i] || (isSkipped ? '__SKIPPED__' : '✔'); }

        if (isSkipped) {
            if (feedbackEl) { feedbackEl.style.color = '#6b7280'; feedbackEl.textContent = `⏭ Krok ${i + 1} přeskočen.`; }
        } else {
            if (feedbackEl) { feedbackEl.style.color = '#059669'; feedbackEl.textContent = `✔ Krok ${i + 1} úspěšně splněn!`; }
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.4'; submitBtn.style.pointerEvents = 'none'; }
        if (skipBtn) { skipBtn.disabled = true; skipBtn.style.opacity = '0.4'; skipBtn.style.pointerEvents = 'none'; }
        if (hintBtn) { hintBtn.disabled = true; hintBtn.style.opacity = '0.4'; hintBtn.style.pointerEvents = 'none'; hintBtn.style.cursor = 'not-allowed'; }
        if (nextBtn) { nextBtn.disabled = false; nextBtn.style.cursor = 'pointer'; nextBtn.style.opacity = '1'; }

        const remaining = saved.pointsRemaining?.[i];
        if (remaining !== undefined) {
            const currentEl = document.getElementById(`step-points-current-${i}`);
            if (currentEl) currentEl.textContent = remaining;
        }

        const usedCount = saved.hintsUsed?.[i] || 0;
        const hints = (window._stepHints || [])[i] || [];
        if (usedCount > 0 && hints.length > 0) {
            const log = document.getElementById(`step-hints-log-${i}`);
            if (log) {
                log.innerHTML = '';
                hints.slice(0, usedCount).forEach((hint, hi) => {
                    const div = document.createElement('div');
                    div.style.cssText = 'background:#fef9c3; border:1px solid #f59e0b; border-radius:6px; padding:8px 12px; font-size:13px; color:#78350f; margin-bottom:6px;';
                    div.innerHTML = `<strong>💡 Nápověda ${hi + 1}:</strong> ${escapeHtml(hint.text)}`;
                    log.appendChild(div);
                });
            }
            const remaining_hints = hints.length - usedCount;
            if (hintBtn) {
                if (remaining_hints === 0) {
                    hintBtn.disabled = true; hintBtn.style.opacity = '0.4'; hintBtn.textContent = '💡 Nápověda (vyčerpána)';
                } else {
                    hintBtn.textContent = `💡 Nápověda (${remaining_hints})`;
                }
            }
        }
    });

    // Obnov stav nápověd i pro nesplněné kroky (použité nápovědy ale krok ještě nesplněn)
    if (saved.hintsUsed) {
        Object.entries(saved.hintsUsed).forEach(([iStr, usedCount]) => {
            const i = parseInt(iStr, 10);
            if (saved.completed.includes(i)) return;
            if (usedCount <= 0) return;
            const hints = (window._stepHints || [])[i] || [];
            if (hints.length === 0) return;

            const log = document.getElementById(`step-hints-log-${i}`);
            if (log) {
                log.innerHTML = '';
                hints.slice(0, usedCount).forEach((hint, hi) => {
                    const div = document.createElement('div');
                    div.style.cssText = 'background:#fef9c3; border:1px solid #f59e0b; border-radius:6px; padding:8px 12px; font-size:13px; color:#78350f; margin-bottom:6px;';
                    div.innerHTML = `<strong>💡 Nápověda ${hi + 1}:</strong> ${escapeHtml(hint.text)}`;
                    log.appendChild(div);
                });
            }

            const hintBtn = document.getElementById(`step-hint-btn-${i}`);
            if (hintBtn) {
                const remaining_hints = hints.length - usedCount;
                if (remaining_hints === 0) {
                    hintBtn.disabled = true; hintBtn.style.opacity = '0.4'; hintBtn.style.cursor = 'not-allowed';
                    hintBtn.textContent = '💡 Nápověda (vyčerpána)';
                } else {
                    hintBtn.disabled = false; hintBtn.style.opacity = '1'; hintBtn.style.cursor = 'pointer';
                    hintBtn.textContent = `💡 Nápověda (${remaining_hints})`;
                }
            }

            const pointsRemaining = saved.pointsRemaining?.[i];
            if (pointsRemaining !== undefined) {
                const currentEl = document.getElementById(`step-points-current-${i}`);
                if (currentEl) currentEl.textContent = pointsRemaining;
            }
        });
    }

    // U ne-sekvenčních otevřených úloh necháme všechny kroky viditelné najednou
    const totalSteps = document.querySelectorAll('[id^="lab-step-"]').length;

    const strictMaxAllowedStep = Math.min(
        saved.current,
        saved.completed.length > 0 ? saved.completed[saved.completed.length - 1] + 1 : 0,
        totalSteps > 0 ? totalSteps - 1 : 0
    );

    const maxAllowedStep = window._isStrictSequential
        ? strictMaxAllowedStep
        : (totalSteps > 0 ? totalSteps - 1 : 0);

    const lastViewedStr = sessionStorage.getItem(`last_viewed_step_${currentScenarioId}`);
    let targetStep = window._isStrictSequential ? strictMaxAllowedStep : 0;

    if (lastViewedStr !== null) {
        const viewedIdx = parseInt(lastViewedStr, 10);
        if (!isNaN(viewedIdx) && viewedIdx <= maxAllowedStep) {
            targetStep = viewedIdx;
        }
    }

    window.goToStep(targetStep);
}
window.checkStepAnswer = async function(stepIndex, isLast = false) {
    const input = document.getElementById(`step-answer-${stepIndex}`);
    const feedbackEl = document.getElementById(`step-feedback-${stepIndex}`);
    if (!input || !feedbackEl) return;

    // Blokuj opakované kliknutí — krok už byl splněn nebo přeskočen
    const stepBtn = document.getElementById(`step-btn-${stepIndex}`);
    if (stepBtn && stepBtn.disabled) return;

    // Přeskočený krok — ignorujeme
    if (input.value === '__SKIPPED__') return;

    const userAnswer = input.value.trim().toLowerCase();
    if (!userAnswer) {
        feedbackEl.style.color = "#dc2626";
        feedbackEl.textContent = `✘ Zadejte odpověď.`;
        return;
    }

    const correctHashes = (window._stepHashes || [])[stepIndex] || [];
    // _stepHashes[i] je pole hashů (pro alternativní odpovědi)
    const hashList = Array.isArray(correctHashes) ? correctHashes.flat() : [correctHashes];

    const hashText = async (text) => {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    };

    let isCorrect;
    if (hashList.length > 0 && hashList.some(h => h !== '')) {
        const extractFlag = (s) => s.replace(/^flag[\[{](.+)[\]}]$/i, '$1').toLowerCase();
        const clean = extractFlag(userAnswer);

        const userHash    = await hashText(userAnswer);
        const cleanHash   = await hashText(clean);
        const bracketHash = await hashText(`flag[${clean}]`);
        const braceHash   = await hashText(`flag{${clean}}`);

        const userVariants = [userHash, cleanHash, bracketHash, braceHash];
        isCorrect = hashList.some(h => h && userVariants.includes(h));
    } else {
        isCorrect = true;
    }

    if (isCorrect) {
        feedbackEl.style.color = "#059669";
        feedbackEl.textContent = `✔ Krok ${stepIndex + 1} úspěšně splněn!`;
        input.disabled = true;
        const submitBtn = document.getElementById(`step-btn-${stepIndex}`);
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.4'; submitBtn.style.pointerEvents = 'none'; }
        const skipBtnEl = document.getElementById(`step-skip-btn-${stepIndex}`);
        if (skipBtnEl) { skipBtnEl.disabled = true; skipBtnEl.style.opacity = '0.4'; skipBtnEl.style.pointerEvents = 'none'; }
        const hintBtnEl = document.getElementById(`step-hint-btn-${stepIndex}`);
        if (hintBtnEl) { hintBtnEl.disabled = true; hintBtnEl.style.opacity = '0.4'; hintBtnEl.style.pointerEvents = 'none'; }
        saveStepProgress(stepIndex);
        if (!isLast) {
            setTimeout(() => {
                const nextBtn = document.getElementById(`step-next-btn-${stepIndex}`);
                if (nextBtn) {
                    nextBtn.disabled = false;
                    nextBtn.style.cursor = 'pointer';
                    nextBtn.style.opacity = '1';
                }
            }, 600);
        } else {
            setTimeout(() => {
                feedbackEl.innerHTML += `<div style="margin-top: 8px; color: #059669;">✔ Všechny kroky splněny! Nezapomeňte odevzdat řešení níže po ukončení laboratorního prostředí.</div>`;
            }, 800);
        }
    } else {
        feedbackEl.style.color = "#dc2626";
        feedbackEl.textContent = `✘ Odpověď není správná, zkuste to znovu.`;
        input.focus();
    }
};

// === NÁPOVĚDY ===
window.showHintConfirm = function(stepIndex) {
    const hints = (window._stepHints || [])[stepIndex] || [];
    const used = (window._stepHintsUsed || [])[stepIndex] || 0;
    if (used >= hints.length) return;

    const hint = hints[used];
    const isLast = used === hints.length - 1;
    const pts = (window._stepPoints || [])[stepIndex] || 0;
    const totalHintCostSoFar = hints.slice(0, used + 1).reduce((a, h) => a + h.cost, 0);
    const pointsAfter = Math.max(0, pts - totalHintCostSoFar);

    const title = isLast ? '⚠️ Zobrazit řešení?' : '💡 Použít nápovědu?';
    const body = isLast
        ? `Toto je poslední nápověda — odhalí řešení kroku. Ztratíte <strong>${hint.cost} bod${hint.cost === 1 ? '' : hint.cost < 5 ? 'y' : 'ů'}</strong>. Po použití zbyde za krok <strong>${pointsAfter} bod${pointsAfter === 1 ? '' : pointsAfter < 5 ? 'y' : 'ů'}</strong>.`
        : `Za použití této nápovědy ztratíte <strong>${hint.cost} bod${hint.cost === 1 ? '' : hint.cost < 5 ? 'y' : 'ů'}</strong>. Po použití zbyde za krok <strong>${pointsAfter} bod${pointsAfter === 1 ? '' : pointsAfter < 5 ? 'y' : 'ů'}</strong>.`;
    const confirmText = isLast ? 'Ano, zobrazit řešení' : 'Ano, zobrazit nápovědu';

    let modal = document.getElementById('hintConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'hintConfirmModal';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:500; display:flex; justify-content:center; align-items:center;">
            <div style="background:var(--bg-panel); border:2px solid var(--border-color); border-radius:12px; padding:24px; width:380px; max-width:95%; box-shadow:0 8px 32px rgba(0,0,0,0.25);">
                <h3 style="margin:0 0 12px 0; color:var(--text-primary); font-size:16px;">${title}</h3>
                <p style="margin:0 0 20px 0; font-size:14px; color:var(--text-primary); line-height:1.6;">${body}</p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button onclick="document.getElementById('hintConfirmModal').innerHTML=''"
                        style="padding:8px 18px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-status); color:var(--text-primary); cursor:pointer; font-size:14px;">
                        Zrušit
                    </button>
                    <button onclick="window.useHint(${stepIndex})"
                        style="padding:8px 18px; border-radius:6px; border:none; background:${isLast ? '#dc2626' : '#f59e0b'}; color:white; cursor:pointer; font-size:14px; font-weight:bold;">
                        ${confirmText}
                    </button>
                </div>
            </div>
        </div>`;
};

window.useHint = function(stepIndex) {
    const modal = document.getElementById('hintConfirmModal');
    if (modal) modal.innerHTML = '';

    const hints = (window._stepHints || [])[stepIndex] || [];
    const used = (window._stepHintsUsed || [])[stepIndex] || 0;
    if (used >= hints.length) return;

    const hint = hints[used];
    window._stepHintsUsed[stepIndex] = used + 1;

    const pts = (window._stepPoints || [])[stepIndex] || 0;
    const totalUsedCost = hints.slice(0, used + 1).reduce((a, h) => a + h.cost, 0);
    const remaining = Math.max(0, pts - totalUsedCost);
    const currentEl = document.getElementById(`step-points-current-${stepIndex}`);
    if (currentEl) currentEl.textContent = remaining;

    saveHintProgress(stepIndex);

    const log = document.getElementById(`step-hints-log-${stepIndex}`);
    if (log) {
        const div = document.createElement('div');
        div.style.cssText = 'background:#fef9c3; border:1px solid #f59e0b; border-radius:6px; padding:8px 12px; font-size:13px; color:#78350f; margin-bottom:6px;';
        div.innerHTML = `<strong>💡 Nápověda ${used + 1}:</strong> ${escapeHtml(hint.text)}`;
        log.appendChild(div);
    }

    const remaining_hints = hints.length - (used + 1);
    const btn = document.getElementById(`step-hint-btn-${stepIndex}`);
    if (btn) {
        if (remaining_hints === 0) {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.textContent = '💡 Nápověda (vyčerpána)';
        } else {
            btn.textContent = `💡 Nápověda (${remaining_hints})`;
        }
    }
};

window.showSkipConfirm = function(stepIndex) {
    const pts = (window._stepPoints || [])[stepIndex] || 0;
    const ptsText = pts > 0
        ? `Za přeskočení ztratíte všechny body za tento krok (<strong>${pts} bod${pts === 1 ? '' : pts < 5 ? 'y' : 'ů'}</strong>).`
        : `Za tento krok nejsou žádné body.`;

    let modal = document.getElementById('hintConfirmModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'hintConfirmModal'; document.body.appendChild(modal); }
    modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:500; display:flex; justify-content:center; align-items:center;">
            <div style="background:var(--bg-panel); border:2px solid var(--border-color); border-radius:12px; padding:24px; width:380px; max-width:95%; box-shadow:0 8px 32px rgba(0,0,0,0.25);">
                <h3 style="margin:0 0 12px 0; color:var(--text-primary); font-size:16px;">⏭ Přeskočit krok?</h3>
                <p style="margin:0 0 20px 0; font-size:14px; color:var(--text-primary); line-height:1.6;">
                    Opravdu chcete přeskočit tento krok? ${ptsText}
                </p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button onclick="document.getElementById('hintConfirmModal').innerHTML=''"
                        style="padding:8px 18px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-status); color:var(--text-primary); cursor:pointer; font-size:14px;">
                        Zrušit
                    </button>
                    <button onclick="window.skipStep(${stepIndex})"
                        style="padding:8px 18px; border-radius:6px; border:none; background:#dc2626; color:white; cursor:pointer; font-size:14px; font-weight:bold;">
                        Ano, přeskočit
                    </button>
                </div>
            </div>
        </div>`;
};

window.skipStep = function(stepIndex) {
    const modal = document.getElementById('hintConfirmModal');
    if (modal) modal.innerHTML = '';

    const steps = window._stepHashes || [];
    const isLast = stepIndex === steps.length - 1;

    // Vložíme správnou odpověď do inputu (prázdný string = backend akceptuje jako přeskočeno)
    // Použijeme speciální sentinel hodnotu __SKIPPED__ kterou checkStepAnswer rozpozná
    const input = document.getElementById(`step-answer-${stepIndex}`);
    if (input) {
        input.value = '__SKIPPED__';
        input.disabled = true;
    }

    const pts = (window._stepPoints || [])[stepIndex] || 0;
    if (pts > 0) {
        const currentEl = document.getElementById(`step-points-current-${stepIndex}`);
        if (currentEl) currentEl.textContent = '0';
    }

    const feedbackEl = document.getElementById(`step-feedback-${stepIndex}`);
    if (feedbackEl) {
        feedbackEl.style.color = '#6b7280';
        feedbackEl.textContent = `⏭ Krok ${stepIndex + 1} přeskočen.`;
    }

    const submitBtn = document.getElementById(`step-btn-${stepIndex}`);
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.4'; submitBtn.style.pointerEvents = 'none'; }
    const skipBtn = document.getElementById(`step-skip-btn-${stepIndex}`);
    if (skipBtn) { skipBtn.disabled = true; skipBtn.style.opacity = '0.4'; skipBtn.style.pointerEvents = 'none'; }
    const hintBtn = document.getElementById(`step-hint-btn-${stepIndex}`);
    if (hintBtn) { hintBtn.disabled = true; hintBtn.style.opacity = '0.4'; hintBtn.style.pointerEvents = 'none'; }

    saveStepProgress(stepIndex);

    if (!isLast) {
        setTimeout(() => {
            const nextBtn = document.getElementById(`step-next-btn-${stepIndex}`);
            if (nextBtn) { nextBtn.disabled = false; nextBtn.style.cursor = 'pointer'; nextBtn.style.opacity = '1'; }
        }, 400);
    } else {
        setTimeout(() => {
            if (feedbackEl) feedbackEl.innerHTML += `<div style="margin-top:8px; color:#6b7280;">Všechny kroky dokončeny. Nezapomeňte odevzdat řešení.</div>`;
        }, 600);
    }
};