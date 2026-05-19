
function stripStoredAiEvaluation(feedbackText) {
    return String(feedbackText || "")
    .replace(/\s*\[__AI_STEP_EVAL__\][\s\S]*?\[\/__AI_STEP_EVAL__\]\s*/g, "")
    .trim();
}

function buildSubmittedStepsHtml(contentPayload, isAutoSubmit = false, stepDetailsJson = null) {
    const raw = String(contentPayload || "").replace(/\r\n/g, "\n").trim();

    if (!raw) {
    return `<div style="white-space: pre-wrap;">Bez textového řešení.</div>`;
    }

    // ── AI scénář ──────────────────────────────────────────────────────────
    if (raw.startsWith('[AI_SCENARIO]')) {
    const totalMatch = raw.match(/Celkem bodů:\s*(\d+)\s*\/\s*(\d+)/);
    const totalEarned = totalMatch ? totalMatch[1] : null;
    const totalMax    = totalMatch ? totalMatch[2] : null;
    const pct = totalEarned && totalMax ? Math.round((parseInt(totalEarned) / parseInt(totalMax)) * 100) : null;
    const grade = (!isAutoSubmit && pct !== null) ? (pct>=90?'A':pct>=80?'B':pct>=70?'C':pct>=60?'D':pct>=50?'E':'F') : null;
    const gradeColor = grade === 'F' ? '#ef4444' : '#22c55e';
    const taskRegex = /Úkol\s+(\d+)(?:\s*\[(\d+)\/(\d+)\s*b\])?:\nOtázka:\s*([\s\S]*?)\nOdpověď:\s*([\s\S]*?)\n(?:Správná odpověď:\s*([\s\S]*?)\n)?Zpětná vazba AI:\s*([\s\S]*?)(?=\n---\n|$)/g;
    const tasks = [];
    let m;
    while ((m = taskRegex.exec(raw)) !== null) {
        tasks.push({
        num:      m[1],
        earned:   m[2] || null,
        max:      m[3] || null,
        question: (m[4] || '').trim(),
        answer:        (m[5] || '').trim().replace(/^([A-D])\)\s*\1\)/, '$1)'),
        correctAnswer: (m[6] || '').trim() || null,
        feedback:      (m[7] || '').trim(),
        });
    }

    if (tasks.length === 0) {
        return `<div style="white-space:pre-wrap; font-size:13px; color:var(--text-primary);">${escapeHtml(raw)}</div>`;
    }

    const headerHtml = '';
    const tasksHtml = tasks.map(t => {
        const ep = t.earned ? Math.round((parseInt(t.earned) / parseInt(t.max)) * 100) : null;
        const barColor = ep === null ? '#6b7280' : ep >= 70 ? '#10b981' : ep >= 40 ? '#f59e0b' : '#ef4444';
        const scoreHtml = t.earned ? `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <span style="font-size:12px; font-weight:bold; color:${barColor};">${t.earned} / ${t.max} b</span>
            <div style="flex:1; background:var(--border-color); border-radius:4px; height:5px; overflow:hidden;">
            <div style="background:${barColor}; height:100%; width:${ep}%; border-radius:4px;"></div>
            </div>
        </div>` : '';

        return `
        <div style="border:1px solid var(--border-color); border-radius:10px; overflow:hidden; margin-bottom:12px;">
            <div style="background:var(--bg-status); padding:10px 14px; border-bottom:1px solid var(--border-color);
                        display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; font-size:13px; color:var(--text-primary);">Úkol ${t.num}</span>
            ${t.earned ? `<span style="font-size:15px; font-weight:bold; color:${barColor};
                border:2px solid ${barColor}; border-radius:8px; padding:2px 12px;
                background:${barColor}22;">${t.earned} / ${t.max} b</span>` : ''}
            </div>
            <div style="padding:12px 14px;">
            <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;
                        letter-spacing:0.6px; margin-bottom:4px;">Otázka</div>
            <div style="font-size:13px; color:var(--text-primary); line-height:1.6; margin-bottom:12px;">
                ${escapeHtml(t.question)}
            </div>
            <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;
                        letter-spacing:0.6px; margin-bottom:4px;">Odpověď</div>
            <div style="font-size:13px; color:var(--text-primary); line-height:1.6; white-space:pre-wrap;
                        background:var(--bg-status); border-radius:8px; padding:10px 12px;
                        border:1px solid var(--border-color); margin-bottom:${t.correctAnswer ? '6px' : '12px'};">${escapeHtml((t.answer || '(bez odpovědi)').trim().replace(/\*\*(.+?)\*\*/g, '$1'))}</div>
            ${t.correctAnswer ? `<div style="font-size:12px; padding:6px 10px; margin-bottom:12px; background:rgba(16,185,129,0.1); border-left:3px solid #10b981; border-radius:0 6px 6px 0; color:#10b981;"><strong>Správná odpověď:</strong> ${escapeHtml(t.correctAnswer)}</div>` : ''}
            <div style="font-size:11px; font-weight:700; color:#3b82f6; text-transform:uppercase;
                        letter-spacing:0.6px; margin-bottom:4px;">Zpětná vazba</div>
            <div style="font-size:13px; color:var(--text-primary); line-height:1.6;
                        border-left:3px solid #3b82f6; padding-left:10px;">
                ${escapeHtml(t.feedback || '—')}
            </div>
            </div>
        </div>`;
    }).join('');

    return headerHtml + tasksHtml;
    }
    // ── AI vzdělávání ──────────────────────────────────────────────────────
    if (raw.startsWith('[AI_EDUCATION]')) {
    const totalMatch   = raw.match(/Celkové skóre:\s*[\d]+\s*\/\s*[\d]+\s*b\s*\((\d+)%\)/);
    const pct          = totalMatch ? parseInt(totalMatch[1]) : null;
    const threshMatch  = raw.match(/Práh:\s*(\d+)/);
    const threshold    = threshMatch ? parseInt(threshMatch[1]) : 75;
    const masteredCnt  = (raw.match(/— ZVLÁDNUTO/g) || []).length;
    const skippedCnt   = (raw.match(/— PŘESKOČENO/g) || []).length;
    const totalCnt     = (raw.match(/^Téma \d+:/mg) || []).length;
    const overallCol   = pct === null ? '#6b7280' : pct >= threshold ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

    // Parsuj step_details — seskup otázky per téma
    let stepsByTopic = {};
    try {
        const _sd = JSON.parse(stepDetailsJson || '[]');
        if (Array.isArray(_sd)) {
            _sd.forEach(q => {
                // topic může být přímo, nebo schovaný v task_text jako "[Název tématu] Otázka..."
                let t = q.topic || '';
                if (!t) {
                    const _tm = (q.task_text || q.title || '').match(/^\[([^\]]+)\]/);
                    if (_tm) t = _tm[1].trim();
                }
                if (!stepsByTopic[t]) stepsByTopic[t] = [];
                stepsByTopic[t].push(q);
            });
        }
    } catch {}

    const topicRegex = /^Téma \d+:\s*(.*?)\s*— (ZVLÁDNUTO|PŘESKOČENO|NEDOKONČENO)(.*?)\nSkóre:\s*([0-9—]+%?)/mg;
    const bars = [];
    let tm;
    while ((tm = topicRegex.exec(raw)) !== null) {
        const name     = tm[1].trim();
        const extra    = tm[3] || '';
        const scoreRaw = tm[4].replace('%', '').trim();
        const score    = scoreRaw === '—' ? null : parseInt(scoreRaw);
        const col      = score === null ? '#6b7280' : score >= threshold ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
        const barPct   = score !== null ? score : 0;
        const repeats  = extra.match(/(\d+) opakování/);
        const repeatNote = repeats ? ` · ${repeats[1]}× opakováno` : '';
        const thresholdMarker = (barPct < threshold)
        ? `<div style="position:absolute;top:0;left:${threshold}%;width:2px;height:100%;background:rgba(120,120,120,0.35);border-radius:1px;"></div>`
        : '';

        // Accordion s otázkami pro toto téma
        const topicSteps = stepsByTopic[name] || [];
        let accordionHtml = '';
        if (topicSteps.length > 0) {
            const verifyQ = parseInt((raw.match(/\[VERIFY_Q:(\d+)\]/) || [])[1] || '3', 10) || 3;
            const qParts = [];
            for (let j = 0; j < topicSteps.length; j++) {
                const q = topicSteps[j];
                const setNum = Math.floor(j / verifyQ) + 1;
                if (j % verifyQ === 0) {
                    const sadaQuestions = topicSteps.slice(j, j + verifyQ);
                    const sadaEarned = sadaQuestions.reduce((s, x) => s + (x.points_earned || 0), 0);
                    const sadaMax    = sadaQuestions.reduce((s, x) => s + (x.points_max || 100), 0);
                    const sadaPct    = sadaMax > 0 ? Math.round(sadaEarned / sadaMax * 100) : 0;
                    const sadaCol    = sadaPct >= 75 ? '#10b981' : sadaPct >= 50 ? '#f59e0b' : '#ef4444';
                    const topMargin  = setNum > 1 ? '14px' : '0';
                    qParts.push(`
                    <div style="display:flex;align-items:center;gap:8px;margin:${topMargin} 0 8px;padding-bottom:4px;border-bottom:2px solid var(--border-color);">
                      <span style="font-size:12px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.5px;">${setNum}. sada ověřovacích otázek</span>
                      <span style="font-size:12px;font-weight:700;color:${sadaCol};">${sadaPct} %</span>
                    </div>`);
                }
                const qPct = q.points_max > 0 ? (q.points_earned / q.points_max) : null;
                const qCol = qPct === null ? '#6b7280' : qPct >= 0.7 ? '#10b981' : qPct >= 0.4 ? '#f59e0b' : '#ef4444';
                const qText = (q.task_text || '—').replace(/^\[[^\]]+\]\s*/, '');
                qParts.push(`
                <div style="border-left:3px solid ${qCol};padding:8px 12px;margin-bottom:8px;border-radius:0 6px 6px 0;background:${qCol}12;">
                  <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:3px;">Otázka ${j + 1}</div>
                  <div style="font-size:13px;color:var(--text-primary);font-weight:500;margin-bottom:6px;line-height:1.5;">${escapeHtml(qText)}</div>
                  <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:2px;">Odpověď</div>
                  <div style="font-size:13px;color:var(--text-primary);background:var(--bg-status);border-radius:5px;padding:6px 10px;margin-bottom:6px;white-space:pre-wrap;">${escapeHtml(q.answer || '—')}</div>
                  <div style="font-size:11px;font-weight:700;color:#3b82f6;margin-bottom:2px;">Zpětná vazba</div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="font-size:13px;color:var(--text-primary);border-left:2px solid #3b82f6;padding-left:8px;line-height:1.5;flex:1;">${escapeHtml(q.feedback || '—')}</div>
                    <span style="font-size:12px;font-weight:bold;color:${qCol};white-space:nowrap;">${q.points_earned} / ${q.points_max} b</span>
                  </div>
                </div>`);
            }
            accordionHtml = `
            <details style="margin-top:6px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">
              <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);padding:8px 12px;list-style:none;display:flex;align-items:center;gap:5px;user-select:none;background:var(--bg-status);">
                <span style="font-size:10px;">▶</span> ${topicSteps.length} otázek
              </summary>
              <div style="padding:12px;">
                ${qParts.join('')}
              </div>
            </details>`;
        }

        bars.push(`
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">
            <span style="font-size:13px;color:var(--text-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65%;">${escapeHtml(name)}</span>
            <span style="font-size:12px;color:${col};font-weight:bold;white-space:nowrap;flex-shrink:0;margin-left:8px;">
              ${score !== null ? score + '%' : '—'}${repeatNote ? `<span style="font-weight:normal;color:var(--text-muted);font-size:11px;"> ${escapeHtml(repeatNote)}</span>` : ''}
            </span>
          </div>
          <div style="background:var(--bg-status);border-radius:6px;height:10px;overflow:hidden;position:relative;">
            <div style="background:${col};width:${barPct}%;height:100%;border-radius:6px;"></div>
            ${thresholdMarker}
          </div>
          ${accordionHtml}
        </div>`);
    }

    const statsRow = [
        { label: 'Zvládnuto',    val: masteredCnt,                    col: '#10b981' },
        { label: 'Nezvládnuto',  val: totalCnt - masteredCnt - skippedCnt, col: '#ef4444' },
        { label: 'Přeskočeno',   val: skippedCnt,                     col: '#f59e0b' },
    ].filter(s => s.val > 0).map(s =>
        `<div style="text-align:center;flex:1;">
          <div style="font-size:20px;font-weight:900;color:${s.col};">${s.val}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${s.label}</div>
        </div>`
    ).join('<div style="width:1px;background:var(--border-color);"></div>');

    return `
      <div style="border:1px solid var(--border-color);border-radius:12px;background:var(--bg-panel);overflow:hidden;">
        <div style="padding:18px 20px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:16px;">
          <div style="flex-shrink:0;width:60px;height:60px;border-radius:50%;border:3px solid ${overallCol};display:flex;align-items:center;justify-content:center;background:${overallCol}18;">
            <span style="font-size:17px;font-weight:900;color:${overallCol};">${pct !== null ? pct + '%' : '—'}</span>
          </div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:3px;">Vzdělávání dokončeno</div>
            <div style="font-size:13px;color:var(--text-muted);">${masteredCnt} z ${totalCnt} témat zvládnuto${skippedCnt > 0 ? ` · ${skippedCnt} přeskočeno` : ''}</div>
          </div>
        </div>
        <div style="display:flex;border-bottom:1px solid var(--border-color);">${statsRow}</div>
        <div style="padding:18px 20px 8px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:14px;">
            Úspěšnost po tématech <span style="font-size:10px;font-weight:normal;">(čárka = práh ${threshold} %)</span>
          </div>
          ${bars.join('')}
        </div>
      </div>`;
    }
    // ── Klasické kroky ─────────────────────────────────────────────────────
    const stepRegex = /(?:^|\n)Krok\s+(\d+):([\s\S]*?)(?=\nKrok\s+\d+:|$)/g;
    const blocks = [];
    let match;

    while ((match = stepRegex.exec(raw)) !== null) {
    blocks.push({
        step: match[1],
        answer: String(match[2] || "").trim()
    });
    }

    if (blocks.length === 0) {
    return `<div style="white-space: pre-wrap;">${escapeHtml(raw)}</div>`;
    }

    return blocks.map(block => `
    <div style="margin-bottom: 14px;">
        <div style="font-weight: bold; color: #3b82f6; margin-bottom: 6px;">Krok ${block.step}:</div>
        <div style="white-space: pre-wrap; background: var(--bg-status); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; color: var(--text-primary); line-height: 1.6;">${escapeHtml(String(block.answer || "Bez odpovědi.").trim())}</div>
    </div>
    `).join("");
}

function setAttemptStatus(html) {
    const el = document.getElementById("attemptStatus");
    if (el) {
        el.innerHTML = html;
        // Pokud je text prázdný, schováme i samotný šedý rámeček
        el.style.display = html ? "block" : "none";
    }
}

function setArtifact(text) {
    document.getElementById("artifactOutput").textContent = text;
}

function setFeedback(html) {
    document.getElementById("feedbackBox").innerHTML = html;
}

function showPageMessage(message, type = "info") {
    const box = document.getElementById("pageMessage");
    box.className = `page-message ${type}`;
    box.innerHTML = message; // Použití innerHTML pro případné skóre a formátování
    
    box.style.display = 'block';
    box.style.opacity = '1';

    if (window._pageMessageTimer) clearTimeout(window._pageMessageTimer);
    window._pageMessageTimer = setTimeout(() => {
    box.style.opacity = "0";
    setTimeout(() => clearPageMessage(), 300);
    }, 7000); // Zmizí po 7 vteřinách
}

function clearPageMessage() {
    const box = document.getElementById("pageMessage");
    if (box) {
        box.innerHTML = "";
        box.className = "page-message";
        box.style.display = "none";
        box.style.opacity = "1";
    }
}

function clearPolling() {

    if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    }
}

function startLabCountdown(startTimeValue, timeLimitMinutes) {
    if (window._labCountdownInterval) clearInterval(window._labCountdownInterval);

    const display = document.getElementById("labCountdownDisplay");
    if (!display) return;

    // 0 = neomezeno — nezahajuj odpočet
    if (!timeLimitMinutes) {
        display.innerText = "Neomezeně";
        display.style.color = "";
        return;
    }

    // Podpora pro textový datum z DB i přímé milisekundy z paměti
    const startTime = typeof startTimeValue === "number" ? startTimeValue : new Date(startTimeValue).getTime();
    const limitMs = timeLimitMinutes * 60 * 1000;

    const updateTimer = async () => {
        const now = new Date().getTime();
        const elapsed = now - startTime;
        const remaining = limitMs - elapsed;

        if (remaining <= 0) {
            clearInterval(window._labCountdownInterval);
            display.innerText = "00:00 (Čas vypršel)";
            display.style.color = "red";
            
            // AUTOMATICKÉ UKONČENÍ A ODEVZDÁNÍ — čekáme na stop před odevzdáním
            showPageMessage("Čas vypršel! Prostředí se ukončuje a vaše řešení bylo automaticky odevzdáno.", "error");
            await stopScenario(true);
            await submitLatestAttempt();
        } else {
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            display.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            
            if (remaining < 300000) { 
                display.style.color = "#dc2626";
            } else {
                display.style.color = "#1d4ed8";
            }
        }
    };

    updateTimer(); // Okamžité zavolání zabrání problikávání
    window._labCountdownInterval = setInterval(updateTimer, 1000);
}

function resetScenarioPanel(detailMessage = "Vyber úlohu ze seznamu.") {
    if (window._labCountdownInterval) clearInterval(window._labCountdownInterval);
    document.getElementById("scenarioDetail").innerHTML = detailMessage;
    const _body = document.getElementById("scenarioDetailBody");
    if (_body) _body.style.display = "none";
    document.getElementById("submissionNote").value = "";

    document.getElementById("startBtn").disabled = true;
    document.getElementById("submitBtn").disabled = true;

    setAttemptStatus("");
    setFeedback("<div class='status-box'>Zatím není dostupná žádná zpětná vazba.</div>");

    // Resetuj AI modul při přepnutí kurzu/scénáře
    if (window.aiScenario?._state) {
        window.aiScenario._state.isRunning = false;
        window.aiScenario._state.scenarioId = null;
        window.aiScenario._state.attemptId = null;
    }
    window._aiInitRunning = null;
}

function buildLatestAttemptMap() {
    latestAttemptMap = {};
    currentAttempts.forEach((attempt) => {
        const scenarioId = attempt.scenarioId;
        if (!scenarioId) return;

        if (!latestAttemptMap[scenarioId]) {
            latestAttemptMap[scenarioId] = attempt;
            return;
        }

        const existing = latestAttemptMap[scenarioId];
        const existingArchived = existing.status === 'archived';
        const currentArchived = attempt.status === 'archived';

        // Non-archived always beats archived
        if (!currentArchived && existingArchived) { latestAttemptMap[scenarioId] = attempt; return; }
        if (currentArchived && !existingArchived) return;

        // Same archival status: prefer higher runNumber, then newer createdAt
        const currentRun = Number(attempt.runNumber || 0);
        const existingRun = Number(existing.runNumber || 0);
        if (currentRun > existingRun) { latestAttemptMap[scenarioId] = attempt; return; }
        if (currentRun === existingRun) {
            const currentDate = new Date(attempt.createdAt || 0).getTime();
            const savedDate = new Date(existing.createdAt || 0).getTime();
            if (currentDate > savedDate) latestAttemptMap[scenarioId] = attempt;
        }
    });
}

function isAnyLabActive() {
    const activeStatesForLock = ["queued", "provisioning", "running", "started", "succeeded", "finished"];
    for (const s of currentScenarios) {
        const hints = s.hints || '';
        // Nezamykej materiály pro: AUTO_SUBMIT cvičení, practice typ nebo adaptive (AI cvičení bez zkoušky)
        const isAutoSubmit = hints.includes('[AUTO_SUBMIT:true]');
        const typeMatch = hints.match(/\[TYPE:(\w+)\]/);
        const taskType = typeMatch ? typeMatch[1] : 'practice';
        const isAdaptive = hints.includes('[ADAPTIVE:true]') || s.difficulty === 'adaptive';
        const shouldLock = !isAutoSubmit && !isAdaptive && (taskType === 'exam' || taskType === 'graded');
        if (!shouldLock) continue;

        const atm = latestAttemptMap[s.scenarioId];
        if (!atm || atm.status === "archived") continue;
        if (!activeStatesForLock.includes(atm.status)) continue;
        const sub = currentSubmissions.find(sub => sub.attemptId === atm.attemptId);
        const isSubmitted = (sub && (sub.status === "submitted" || sub.status === "evaluated"))
            || atm.learningStatus === "submitted" || atm.learningStatus === "evaluated"
            || atm.learningStatus === "paused";
        if (!isSubmitted) return true;
    }
    return false;
}

function updateMaterialsLockState() {
    const listEl = document.getElementById("studentMatList");
    if (!listEl) return;
    const isLocked = isAnyLabActive();
    for (const item of listEl.children) {
        item.classList.toggle("locked", isLocked);
        if (isLocked) {
            item.setAttribute("title", "Materiály jsou během plnění úkolu uzamčeny.");
        } else {
            item.removeAttribute("title");
        }
    }
}

function updateCoursesLockState() {
    const isLocked = isAnyLabActive();
    document.querySelectorAll("#coursesList [data-id]").forEach(card => {
        const shouldLock = isLocked && card.dataset.id !== currentCourseId;
        card.classList.toggle("locked", shouldLock);
        card.title = shouldLock ? "Nelze přepnout kurz během plnění úkolu." : "";
    });
}

function computeStudentState(scenarioId) {
    const latestAttempt = latestAttemptMap[scenarioId];
    if (!latestAttempt) return "available";

    // Pokud učitel pokus archivoval (povolil další), smaž uložené skóre a vrať "available"
    if (latestAttempt.status === "archived") {
        localStorage.removeItem('score_html_' + latestAttempt.attemptId);
        return "available";
    }

    const sub = currentSubmissions.find(s => s.attemptId === latestAttempt.attemptId);
    
    if (sub && sub.status === "evaluated") return "evaluated";
    if (sub && sub.status === "submitted") return "submitted";
    
    if (latestAttempt.learningStatus === "evaluated") return "evaluated";
    if (latestAttempt.learningStatus === "submitted") return "submitted";
    if (latestAttempt.learningStatus === "paused") return "paused";
    if (latestAttempt.learningStatus === "started" || latestAttempt.status === "running" || latestAttempt.status === "succeeded" || latestAttempt.status === "provisioning" || latestAttempt.status === "queued") return "started";
    if (["finished", "deleting", "stopped", "failed"].includes(latestAttempt.status)) return "pending_submission";
    
    return "available";
}



sharedCheckAutoLogin(["student", "teacher", "admin"], initApp, "student");

window.openAccordionIds = new Set();

document.addEventListener("click", function(event) {
    const header = event.target.closest(".accordion-header");
    if (!header) return; 
    
    const item = header.closest(".accordion-item");
    if (!item) return;
    
    item.classList.toggle("open");

    //Uložení stavu, aby ho automatický refresh nepřepsal
    const attemptId = item.getAttribute("data-attempt-id");
    if (attemptId) {
        if (item.classList.contains("open")) {
            window.openAccordionIds.add(attemptId);
        } else {
            window.openAccordionIds.delete(attemptId);
        }
    }
});
