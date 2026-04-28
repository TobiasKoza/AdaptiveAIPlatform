
function stripStoredAiEvaluation(feedbackText) {
    return String(feedbackText || "")
    .replace(/\s*\[__AI_STEP_EVAL__\][\s\S]*?\[\/__AI_STEP_EVAL__\]\s*/g, "")
    .trim();
}

function buildSubmittedStepsHtml(contentPayload, isAutoSubmit = false) {
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
    
    const bgColor = type === "error" ? "var(--error, #ef4444)" : (type === "success" ? "var(--success, #10b981)" : "var(--primary, #1a3a6b)");
    
    box.style.cssText = `
    display: block;
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 9999;
    min-width: 300px;
    max-width: 450px;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    color: #ffffff;
    background: ${bgColor};
    border: 1px solid rgba(255,255,255,0.15);
    transition: opacity 0.3s ease-in-out;
    opacity: 1;
    `;

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
    document.getElementById("submissionNote").value = "";

    document.getElementById("startBtn").disabled = true;
    document.getElementById("submitBtn").disabled = true;

    setAttemptStatus("Zatím bez pokusu.");
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

    const currentDate = new Date(attempt.createdAt || 0).getTime();
    const savedDate = new Date(latestAttemptMap[scenarioId].createdAt || 0).getTime();
    if (currentDate > savedDate) {
        latestAttemptMap[scenarioId] = attempt;
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
            || atm.learningStatus === "submitted" || atm.learningStatus === "evaluated";
        if (!isSubmitted) return true;
    }
    return false;
}

function updateMaterialsLockState() {
    const listEl = document.getElementById("studentMatList");
    if (!listEl) return;
    const isLocked = isAnyLabActive();
    
    const items = listEl.children;
    for (let item of items) {
        if (isLocked) {
            item.style.opacity = "0.45";
            item.style.cursor = "not-allowed";
            item.setAttribute("title", "Materiály jsou během plnění úkolu uzamčeny.");
        } else {
            item.style.opacity = "1";
            item.style.cursor = "pointer";
            item.removeAttribute("title");
        }
    }
}

function updateCoursesLockState() {
    const isLocked = isAnyLabActive();
    document.querySelectorAll("#coursesList [data-id]").forEach(card => {
        const isActive = card.dataset.id === currentCourseId;
        if (isLocked && !isActive) {
            card.style.opacity = "0.45";
            card.style.pointerEvents = "none";
            card.style.cursor = "not-allowed";
            card.title = "Nelze přepnout kurz během plnění úkolu.";
        } else {
            card.style.opacity = "1";
            card.style.pointerEvents = "auto";
            card.style.cursor = "pointer";
            card.title = "";
        }
    });
}

function updateCoursesLockState() {
    const isLocked = isAnyLabActive();
    document.querySelectorAll("#coursesList [data-id]").forEach(card => {
        const isActive = card.dataset.id === currentCourseId;
        if (isLocked && !isActive) {
            card.style.opacity = "0.45";
            card.style.pointerEvents = "none";
            card.style.cursor = "not-allowed";
            card.title = "Nelze přepnout kurz během plnění úkolu.";
        } else {
            card.style.opacity = "1";
            card.style.pointerEvents = "auto";
            card.style.cursor = "pointer";
            card.title = "";
        }
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
