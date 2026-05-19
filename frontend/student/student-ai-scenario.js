/**
 * student-ai-scenario.js
 * Modul pro AI-řízená adaptivní zadání v studentském portálu.
 * 
 * Spustí se když zadání obsahuje [ADAPTIVE:true] v poli hints.
 * 
 * Tok:
 *   1. AI vygeneruje hezký úvod (vzdělávací cíl)
 *   2. AI vygeneruje 1. podúkol
 *   3. Student odpoví → AI ohodnotí bodově + slovně + (pokud adaptivita) upraví obtížnost dalšího
 *   4. Opakuje se pro všechny podúkoly definované v [SUBTASKS:N]
 *   5. Na konci student může odevzdat souhrn
 */

(function () {

  // ─── Stav AI scénáře ───────────────────────────────────────────────────────
  const _ai = {
    scenarioId: null,
    attemptId: null,
    scenario: null,
    totalSubtasks: 3,
    currentSubtask: 0,       // index 0-based
    subtaskHistory: [],       // [{question, answer, feedback, points, maxPoints}]
    earnedPoints: 0,
    maxPoints: 0,
    isAdaptive: false,
    difficultyLevel: 'medium', // low | medium | high
    introHtml: null,
    isRunning: false,
    isLocked: false,
    language: 'cs',
  };

  // ─── Veřejné API ────────────────────────────────────────────────────────────
  window.aiScenario = {
    init: initAiScenario,
    submitAnswer: submitAiAnswer,
    nextSubtask: nextAiSubtask,
    goToSubtask: goToAiSubtask,
    buildPayload: buildAiPayload,
    isActive: () => _ai.isRunning,
    lock: lockAiScenario,
    setLock: setAiLock,
    registerSubmitHook: _registerAiSubmitHook,
    saveProgress: saveProgress,
    _state: _ai,
    _eduStop: null,
  };

  // ─── Obnovení API na exercise mód (po edu nebo přepnutí scénáře) ─────────────
  const _origAiIsActive     = () => _ai.isRunning;
  const _origAiBuildPayload = buildAiPayload;
  const _origAiSaveProgress = saveProgress;

  function _restoreExerciseApi() {
    window.aiScenario.isActive     = _origAiIsActive;
    window.aiScenario.buildPayload = _origAiBuildPayload;
    window.aiScenario.saveProgress = _origAiSaveProgress;
    try {
      Object.defineProperty(window.aiScenario, '_state', { value: _ai, writable: true, configurable: true, enumerable: true });
    } catch {}
    window.aiScenario._state = _ai;
    window._aiAnswerDraft = '';
  }

  function deactivateAiScenario() {
    _ai.isRunning = false;
    _ai.isLocked  = false;
    if (typeof window.aiScenario._eduStop === 'function') {
      try { window.aiScenario._eduStop(); } catch {}
      window.aiScenario._eduStop = null;
    }
    _restoreExerciseApi();
  }

  window.aiScenario.deactivate = deactivateAiScenario;

  // ─── Dynamické přepínání vzhledu CodeMirror podle režimu aplikace ───────────
  if (typeof document !== 'undefined') {
    new MutationObserver(() => {
      const isDark = document.body.classList.contains('dark-mode');
      const newTheme = isDark ? 'dracula' : 'default';
      document.querySelectorAll('.CodeMirror').forEach(el => {
        if (el.CodeMirror) el.CodeMirror.setOption('theme', newTheme);
      });
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function setAiLock(locked) {
    _ai.isLocked = locked;
    const container = getContainer();
    if (!container) return;
    if (locked) {
      container.style.pointerEvents = 'none';
      container.style.opacity = '0.6';
      container.querySelectorAll('button, input, textarea, label').forEach(el => el.tabIndex = -1);
    } else {
      container.style.pointerEvents = 'auto';
      container.style.opacity = '1';
      container.querySelectorAll('button, input, textarea, label').forEach(el => el.removeAttribute('tabIndex'));
    }
  }
  
  // ─── Konstanta: URL AI API (přes vlastní backend) ───────────────────────────
  const AI_API_BASE = "http://127.0.0.1:8000";

  // Cache obsahu materiálů — načte se jednou při init
  let _materialsContent = "";

  async function loadMaterialsContent(scenarioTemplateId) {
    if (!scenarioTemplateId) return;
    try {
      const res = await fetch(`${AI_API_BASE}/api/ai/scenarios/${scenarioTemplateId}/materials/content`, {
        headers: { "X-Mock-User": getMockUser() }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.materials && data.materials.length > 0) {
        _materialsContent = data.materials
          .map(m => `=== ${m.fileName} ===\n${m.content}`)
          .join("\n\n");
      }
    } catch { }
  }

  // ─── Pomocné ────────────────────────────────────────────────────────────────
  function getTag(hints, tag) {
    const m = (hints || "").match(new RegExp(`\\[\\s*${tag}\\s*:([\\s\\S]*?)\\]`));
    return m ? m[1].trim() : null;
  }

  // Extrahuje strukturované sekce z gradingRubric + instructions scénáře
  function parseAiContext(s) {
    const rubric = String(s.gradingRubric || s.grading_rubric || '');
    const instructions = String(s.instructions || '');

    // Vzdělávací cíl — z AI_GLOBAL_CONTEXT nebo celý rubric (bez AI_ENABLED prefixu)
    const globalBlock = rubric.match(/\[AI_GLOBAL_CONTEXT\]([\s\S]*?)\[\/AI_GLOBAL_CONTEXT\]/i);
    const globalContext = globalBlock ? globalBlock[1].trim()
      : rubric.replace(/^AI_ENABLED\n?/i, '').replace(/^AI_DISABLED\n?/i, '').trim();

    // Sekce z globalContext (učitel může psát volně nebo se sekcemi)
    const extract = (label) => {
      const m = globalContext.match(new RegExp(`${label}[:\\s]+(.*?)(?=\\n[A-ZÁČĎÉĚÍŇÓŘŠŤŮÚÝŽ]|$)`, 'si'));
      return m ? m[1].trim() : '';
    };
    const learningGoal    = extract('Vzdělávací cíl') || extract('Cíl') || globalContext.split('\n')[0] || '';
    const masterPrompt    = extract('Master prompt') || extract('Systémový prompt') || '';
    const feedbackFocus   = extract('Co chcete ve zpětné vazbě') || extract('Zpětná vazba') || extract('Feedback') || '';
    const materialsHint   = extract('Studijní materiály') || '';

    // Extrakce kontextu kódu z instructions — jména proměnných, funkcí, importů
    const codeLines = [];
    instructions.split('\n').forEach(line => {
      const l = line.trim();
      if (/^(import|from|def |class |function |const |let |var |#)/.test(l)) codeLines.push(l);
    });
    // Také inline kód ve zpětných apostrofech nebo blok ```
    const inlineCode = [];
    (instructions.match(/```[\s\S]*?```/g) || []).forEach(b => {
      b.replace(/```[a-z]*/i, '').replace(/```/, '').trim().split('\n').slice(0, 8).forEach(l => inlineCode.push(l));
    });
    const codeContext = [...codeLines, ...inlineCode].slice(0, 20).join('\n');

    return { learningGoal, masterPrompt, feedbackFocus, materialsHint, codeContext, globalContext };
  }

  function esc(v) {
    return String(v || "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function getMockUser() {
    // 1. Globální proměnná z login.js (nejspolehlivější za runtime)
    if (typeof currentUserEmail !== 'undefined' && currentUserEmail) return currentUserEmail;
    // 2. Fallback: localStorage (funguje i po F5)
    try {
      const raw = localStorage.getItem('adaptiveAuth_student');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.email) return parsed.email;
      }
    } catch {}
    return "";
  }

  async function callAI(systemPrompt, userMessage) {
    const res = await fetch(`${AI_API_BASE}/api/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mock-User": getMockUser()
      },
      body: JSON.stringify({ 
        system: systemPrompt, 
        message: userMessage, 
        scenario_id: _ai.scenarioId 
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error("AI chat chyba: " + err);
    }
    const data = await res.json();
    return data.response || "";
  }

  async function callAIEval(systemPrompt, userMessage, maxPoints) {
    const res = await fetch(`${AI_API_BASE}/api/ai/evaluate-subtask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mock-User": getMockUser()
      },
      body: JSON.stringify({
        system: systemPrompt,
        message: userMessage,
        maxPoints: maxPoints,
        scenario_id: _ai.scenarioId
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error("AI eval chyba: " + err);
    }
    return await res.json(); // { points, feedback }
  }

  // ─── SessionStorage klíče ────────────────────────────────────────────────────
  function progressKey(scenarioId, attemptId) {
    return `ai_scenario_${scenarioId}_${attemptId}`;
  }

  // ─── Průběžné ukládání stavu do backendu (fire-and-forget) ─────────────────
  let _backendSaveTimer = null;

  // Debounced — pro exercise mode a keystroke saves (volá se z oninput, kde debounce je výše)
  function _saveToBackend(attemptId, stateJson) {
    if (!attemptId || !stateJson) return;
    clearTimeout(_backendSaveTimer);
    _backendSaveTimer = setTimeout(() => {
      fetch(`${API_BASE}/attempts/${attemptId}/ai-state`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ai_state: stateJson }),
      }).catch(() => {});
    }, 800);
  }

  // Okamžitý save — pro strukturální změny (po vygenerování vysvětlení, otázky, odeslání odpovědi)
  // Edu mode ho volá přímo — debounce pro keystrokes zajišťuje oninput handler výše.
  function _saveToBackendNow(attemptId, stateJson) {
    if (!attemptId || !stateJson) return;
    fetch(`${API_BASE}/attempts/${attemptId}/ai-state`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ai_state: stateJson }),
    }).catch(() => {});
  }

  function saveProgress() {
    if (!_ai.scenarioId || !_ai.attemptId) return;
    const key = progressKey(_ai.scenarioId, _ai.attemptId);
    // Přečti aktuální draft z textarea (spolehlivější než globální proměnná)
    const _draftInput = document.getElementById(`ai-answer-input-${_ai.currentSubtask}`)
      || document.querySelector(`#ai-scenario-container textarea:not([style*="display:none"])`
      ) || document.querySelector(`#ai-scenario-container textarea`);
    const _currentDraft = (_draftInput?.value?.trim() ? _draftInput.value : '') || window._aiAnswerDraft || '';
    const stateJson = JSON.stringify({
      currentSubtask: _ai.currentSubtask,
      subtaskHistory: _ai.subtaskHistory,
      earnedPoints: _ai.earnedPoints,
      maxPoints: _ai.maxPoints,
      difficultyLevel: _ai.difficultyLevel,
      introHtml: _ai.introHtml,
      currentDraft: _currentDraft,
    });
    localStorage.setItem(key, stateJson);
    _saveToBackend(_ai.attemptId, stateJson);
  }

  function loadProgress() {
    const key = progressKey(_ai.scenarioId, _ai.attemptId);
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      const p = JSON.parse(raw);
      _ai.currentSubtask = p.currentSubtask ?? 0;
      _ai.subtaskHistory = p.subtaskHistory ?? [];
      _ai.earnedPoints   = p.earnedPoints ?? 0;
      _ai.maxPoints      = p.maxPoints ?? 0;
      _ai.difficultyLevel = p.difficultyLevel ?? 'medium';
      _ai.introHtml      = p.introHtml ?? null;
      _ai.restoredDraft  = p.currentDraft || '';
      return true;
    } catch { return false; }
  }

  // ─── Render kontejneru ───────────────────────────────────────────────────────
  function getContainer() {
    return document.getElementById('ai-scenario-container');
  }

  function renderContainer() {
    const existing = getContainer();
    if (existing) return existing;

    // Vložíme za .scenario-description (nebo na konec detailEl)
    const detailEl = document.getElementById('scenarioDetail');
    if (!detailEl) return null;

    const div = document.createElement('div');
    div.id = 'ai-scenario-container';
    div.style.marginTop = '0';
    detailEl.appendChild(div);
    return div;
  }

  function setContainerHtml(html) {
    const c = renderContainer();
    if (c) c.innerHTML = html;
  }

  // ─── Šablona: Loading karta ──────────────────────────────────────────────────
  function loadingHtml(text) {
    return `
      <div style="display:flex; align-items:center; gap:12px; padding:18px 20px;
           border:1px solid var(--border-color); border-radius:12px;
           background:var(--bg-panel); margin:12px 0;">
        <div class="ai-spinner"></div>
        <span style="color:var(--text-muted); font-size:14px;">${esc(text)}</span>
      </div>`;
  }

  // ─── Šablona: Intro karta (schovaná, intro se zobrazuje uvnitř podúkolu) ─────
  function introCardHtml(html) {
    // Intro se nyní nevykresluje samostatně — je součástí subtaskCardHtml
    return `<div id="ai-intro-store" style="display:none;" data-intro="${html.replace(/"/g, '&quot;')}"></div>`;
  }

  // ─── Detekce typu otázky a render odpovídajícího inputu ─────────────────────
  function detectQuestionType(questionText, hintType) {
    // Priorita: explicitní typ z QTYPES hintu
    if (hintType) {
      const h = hintType.toLowerCase();
      if (h.includes('a/b/c/d') || h.includes('abcd') || h.includes('výběr')) return 'abcd';
      if (h.includes('pravda') || h.includes('nepravda') || h.includes('true/false')) return 'tf';
      if (h.includes('doplň') || h.includes('chybějící')) return 'fill';
      if (h.includes('oprava') || h.includes('analýza') || h.includes('chyby')) return 'error';
    }
    // Fallback: detekce z textu — hledáme A) B) C) D) kdekoliv v textu
    const t = questionText || '';
    if (/\bA\)/.test(t) && /\bB\)/.test(t) && /\bC\)/.test(t)) return 'abcd';
    if (/Pravda|Nepravda|True|False/i.test(t) && t.length < 400) return 'tf';
    if (/_{2,}/.test(t)) return 'fill';
    if (/```|`[^`]+`|chybný|oprav|chyba v|syntaktick/i.test(t)) return 'error';
    return 'open';
  }

  function renderAnswerInput(idx, questionText, hintType) {
    const type = detectQuestionType(questionText, hintType);

    if (type === 'abcd') {
      const options = [];
      // Použij původní otázku s možnostmi z historie (cleanQuestion je bez nich)
      const fullQuestion = _ai.subtaskHistory[idx]?.abcdOptions || questionText;
      const regexMulti = /\b([A-D])\)\s*(.+?)(?=\s+[B-D]\)|$)/gs;
      let m;
      while ((m = regexMulti.exec(fullQuestion)) !== null) {
        const text = m[2].trim().replace(/\s+/g, ' ');
        if (text) options.push({ letter: m[1], text });
      }
      if (options.length >= 2) {
        return `
          <div style="margin-bottom:6px;">
            <div style="font-size:13px; font-weight:bold; margin-bottom:10px; color:var(--text-primary);">Vyberte správnou odpověď:</div>
            <div style="display:flex; flex-direction:column; gap:8px;" id="ai-abcd-options-${idx}">
              ${options.map(o => `
                <label style="display:flex; align-items:center; gap:12px; padding:10px 14px;
                       border:1px solid var(--border-color); border-radius:8px; cursor:pointer;
                       background:var(--bg-status); transition:background 0.15s;"
                       onmouseover="this.style.background='var(--bg-card-hover)'"
                       onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'var(--border-color)'; this.style.background=this.querySelector('input').checked?'rgba(59,130,246,0.15)':'var(--bg-status)'">
                  <input type="radio" name="ai-abcd-${idx}" value="${o.letter}" 
                         style="width:16px; height:16px; accent-color:#3b82f6; flex-shrink:0;"
                         onchange="
                           document.querySelectorAll('#ai-abcd-options-${idx} label').forEach(l=>{l.style.borderColor='var(--border-color)';l.style.background='var(--bg-status)'});
                           this.closest('label').style.borderColor='#3b82f6';
                           this.closest('label').style.background='rgba(59,130,246,0.15)';
                           window._aiAnswerDraft = '${o.letter}) ' + this.closest('label').querySelector('span').textContent;
                         ">
                  <span style="font-size:14px; color:var(--text-primary);"><strong>${o.letter})</strong> ${esc(o.text)}</span>
                </label>`).join('')}
            </div>
          </div>
          <input type="hidden" id="ai-answer-input-${idx}" value="">`;
      }
    }

    if (type === 'tf') {
      return `
        <div style="margin-bottom:6px;">
          <div style="font-size:13px; font-weight:bold; margin-bottom:10px; color:var(--text-primary);">Vaše odpověď:</div>
          <div style="display:flex; gap:12px;">
            <label style="flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:12px;
                   border:2px solid var(--border-color); border-radius:8px; cursor:pointer; font-size:15px; font-weight:bold;
                   background:var(--bg-status); transition:all 0.15s;"
                   onmouseover="if(!this.querySelector('input').checked)this.style.borderColor='#10b981'"
                   onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='var(--border-color)'">
              <input type="radio" name="ai-tf-${idx}" value="Pravda" style="display:none;"
                     onchange="
                       document.querySelectorAll('[name=ai-tf-${idx}]').forEach(r=>{const l=r.closest('label');l.style.borderColor='var(--border-color)';l.style.background='var(--bg-status)';l.style.color='var(--text-primary)'});
                       this.closest('label').style.borderColor='#10b981';
                       this.closest('label').style.background='#f0fdf4';
                       this.closest('label').style.color='#16a34a';
                       window._aiAnswerDraft='Pravda';
                     ">
              ✓ Pravda
            </label>
            <label style="flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:12px;
                   border:2px solid var(--border-color); border-radius:8px; cursor:pointer; font-size:15px; font-weight:bold;
                   background:var(--bg-status); transition:all 0.15s;"
                   onmouseover="if(!this.querySelector('input').checked)this.style.borderColor='#ef4444'"
                   onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='var(--border-color)'">
              <input type="radio" name="ai-tf-${idx}" value="Nepravda" style="display:none;"
                     onchange="
                       document.querySelectorAll('[name=ai-tf-${idx}]').forEach(r=>{const l=r.closest('label');l.style.borderColor='var(--border-color)';l.style.background='var(--bg-status)';l.style.color='var(--text-primary)'});
                       this.closest('label').style.borderColor='#ef4444';
                       this.closest('label').style.background='#fef2f2';
                       this.closest('label').style.color='#dc2626';
                       window._aiAnswerDraft='Nepravda';
                     ">
              ✗ Nepravda
            </label>
          </div>
        </div>
        <input type="hidden" id="ai-answer-input-${idx}" value="">`;
    }

    if (type === 'fill') {
      const fillSource = _ai.subtaskHistory[idx]?.fillQuestion || questionText;
      const parts = fillSource ? fillSource.split(/_{2,}/) : [];
      if (parts.length >= 2) {
        const inlineHtml = parts.map((part, i) => {
          if (i === parts.length - 1) return esc(part);
          return esc(part) + `<input type="text" id="ai-fill-input-${idx}-${i}"
                 placeholder="…"
                 style="display:inline-block; width:110px; padding:3px 6px; font-size:14px;
                        border:0; border-bottom:2px solid #3b82f6; border-radius:0;
                        background:rgba(59,130,246,0.08); color:var(--text-primary); margin:0 4px; padding:3px 8px; border-radius:4px 4px 0 0;
                        outline:none; vertical-align:middle;"
                 oninput="
                   const vals=[];
                   for(let j=0;document.getElementById('ai-fill-input-${idx}-'+j);j++){vals.push(document.getElementById('ai-fill-input-${idx}-'+j).value.trim());}
                   window._aiAnswerDraft=vals.filter(Boolean).join(' / ');
                 ">`;
        }).join('');
        return `
          <div style="font-size:16px; line-height:2.2; color:var(--text-primary); margin-bottom:8px;">
            ${inlineHtml}
          </div>
          <input type="hidden" id="ai-answer-input-${idx}" value="">`;
      }
      // Fallback — zobraz celou otázku + jeden input
      const fallbackQ = fillSource || questionText;
      return `
        ${fallbackQ ? `<div style="font-size:16px; line-height:1.8; color:var(--text-primary); margin-bottom:12px;">${esc(fallbackQ)}</div>` : ''}
        <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:6px; color:var(--text-primary);">
          Doplňte chybějící výraz:
        </label>
        <input type="text" id="ai-answer-input-${idx}"
               placeholder="Napište chybějící slovo nebo výraz…"
               style="width:100%; padding:10px 14px; font-size:15px; border:2px solid var(--border-color);
                      border-radius:8px; box-sizing:border-box; background:var(--bg-status); color:var(--text-primary);"
               oninput="window._aiAnswerDraft = this.value"
               onkeydown="if(event.key==='Enter'){event.preventDefault(); window.aiScenario.submitAnswer(${idx});}">`;
    }

    if (type === 'error') {
      return `
        <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:6px; color:var(--text-primary);">
          Vaše odpověď (opravený kód):
        </label>
        <div id="ai-answer-cm-host-${idx}" 
             style="border:2px solid var(--border-color); border-radius:8px; overflow:hidden; margin:0 0 12px 0;"></div>
        <textarea id="ai-answer-input-${idx}" style="display:none;"></textarea>`;
    }

    // default — otevřená odpověď
    return `
      <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:6px; color:var(--text-primary);">
        Vaše odpověď:
      </label>
      <textarea id="ai-answer-input-${idx}"
                rows="5"
                placeholder="Zde napište svou odpověď…"
                style="width:100%; min-height:120px; resize:vertical; margin:0; box-sizing:border-box; font-size:14px;
                       background:var(--bg-status); border:2px solid var(--border-color); border-radius:8px; padding:12px 14px; color:var(--text-primary); outline:none;"
                onfocus="this.style.borderColor='#3b82f6'"
                onblur="this.style.borderColor='var(--border-color)'"
                oninput="window._aiAnswerDraft = this.value"></textarea>`;
  }

  // ─── Šablona: Podúkol ────────────────────────────────────────────────────────
  function subtaskCardHtml(idx, total, questionHtml, maxPts, diffLabel, introText) {
    const diffColor = { low:'#10b981', medium:'#3b82f6', high:'#ef4444' }[diffLabel] || '#6b7280';
    const diffText  = { low:'Lehká', medium:'Střední', high:'Těžká' }[diffLabel] || '';

    // introText přichází přímo jako parametr — žádné čtení z DOM
    introText = introText || '';
    const goalLabel = idx === 0
      ? 'Vzdělávací cíl tohoto cvičení'
      : `Cíl úkolu ${idx + 1}`;

    return `
      <div id="ai-subtask-card" style="
           border:2px solid var(--border-color);
           border-radius:12px;
           background:var(--bg-panel);
           padding:20px;
           margin:12px 0;">

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:var(--primary,#1a3a6b); color:white; border-radius:20px;
                         padding:3px 12px; font-size:12px; font-weight:bold; white-space:nowrap;">
              Úkol ${idx + 1} / ${total}
            </span>
          </div>
          ${diffText ? `<span style="font-size:11px; font-weight:bold; color:${diffColor}; border:1px solid ${diffColor};
                                     border-radius:6px; padding:2px 8px; white-space:nowrap;">● ${diffText}</span>` : ''}
        </div>

        ${introText ? `
        <div style="border-left:4px solid #3b82f6; padding:12px 16px; margin-bottom:18px;
                    background:var(--bg-status); border-radius:0 8px 8px 0;">
          <div style="font-size:16px; font-weight:700; color:#3b82f6; margin-bottom:8px;
                      font-family:inherit;">
            ${idx === 0 ? 'Vzdělávací cíl cvičení' : `Cíl úkolu ${idx + 1}`}
          </div>
          <div style="font-size:14px; line-height:1.7; color:var(--text-primary); font-weight:500;">${introText}</div>
        </div>` : ''}

        ${questionHtml ? `
        <div style="font-size:16px; font-weight:700; color:var(--text-muted); margin-bottom:8px; font-family:inherit;">Zadání:</div>
        <div id="ai-question-text" style="font-size:16px; line-height:1.8; color:var(--text-primary); margin-bottom:16px;">
          ${questionHtml}
        </div>` : ''}

        ${renderAnswerInput(idx, questionHtml.replace(/<[^>]*>/g, ''), _ai.subtaskHistory[idx]?.qtype || '')}

        <div id="ai-answer-feedback-${idx}" style="min-height:0; margin-top:0;"></div>

        <div style="display:flex; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap;">
          <button id="ai-submit-btn-${idx}"
                  onclick="window.aiScenario.submitAnswer(${idx})"
                  style="background:var(--btn-primary,#3b82f6); color:#fff; padding:9px 22px;
                         font-size:14px; border-radius:8px; border:none; cursor:pointer; font-weight:bold;">
            Odeslat odpověď
          </button>
          <div style="display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-muted);">
            <span>Celkem bodů:</span>
            <span id="ai-total-pts-${idx}" style="font-weight:bold; font-size:15px; color:var(--text-primary);">
              ${_ai.earnedPoints} / ${_ai.maxPoints} b
            </span>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap;">
          ${idx > 0 ? `
          <button onclick="window.aiScenario.goToSubtask(${idx - 1})"
                  style="font-size:12px; background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; cursor:pointer; margin:0; height:28px; box-sizing:border-box; line-height:1;">
            ← Zpět
          </button>` : ''}
          ${idx < total - 1 ? (() => {
            const _allowSkip = (_ai.scenario?.hints || '').includes('[ALLOW_SKIP:true]');
            const _nextDisabled = !_allowSkip;
            return `<button id="ai-next-btn-${idx}"
                  onclick="window.aiScenario.goToSubtask(${idx + 1})"
                  ${_nextDisabled ? 'disabled' : ''}
                  style="font-size:12px; background:var(--btn-primary,#3b82f6); color:var(--btn-primary-text,#ffffff); border:none; border-radius:6px; padding:3px 10px; margin:0; height:28px; box-sizing:border-box; line-height:1; ${_nextDisabled ? 'cursor:not-allowed; opacity:0.4;' : 'cursor:pointer; opacity:1;'}">
            Další →
          </button>`;
          })() : `<span id="ai-next-btn-${idx}" style="display:none;"></span>`}
        </div>
      </div>`;
  }

  // ─── Šablona: Feedback karta ─────────────────────────────────────────────────
  function feedbackCardHtml(feedbackHtml, earnedPts, maxPts, isLast) {
    const pct = maxPts > 0 ? Math.round((earnedPts / maxPts) * 100) : 0;
    const barColor = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
    const idx = _ai.currentSubtask;

    return `
      <div id="ai-feedback-card" style="
           border:2px solid var(--border-color);
           border-radius:12px;
           background:var(--bg-panel);
           padding:20px;
           margin:12px 0;">

        <div style="font-size:14px; line-height:1.7; color:var(--text-primary); margin-bottom:16px;">
          ${feedbackHtml}
        </div>

        ${maxPts > 0 ? `
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-muted); margin-bottom:4px;">
            <span>Body za tento úkol</span>
            <strong style="color:var(--text-primary);">${earnedPts} / ${maxPts}</strong>
          </div>
          <div style="background:var(--bg-status); border-radius:6px; height:8px; overflow:hidden;">
            <div style="background:${barColor}; height:100%; width:${pct}%; transition:width 0.5s ease; border-radius:6px;"></div>
          </div>
        </div>` : ''}

        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          ${idx > 0 ? `
          <button onclick="window.aiScenario.goToSubtask(${idx - 1})"
                  style="font-size:12px; background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; cursor:pointer; margin:0; height:28px; box-sizing:border-box; line-height:1;">
            ← Zpět
          </button>` : ''}
          <button onclick="window.aiScenario.goToSubtask(${idx + 1})"
                  style="font-size:12px; background:var(--btn-primary,#3b82f6); color:var(--btn-primary-text,#ffffff); border:none; border-radius:6px; padding:3px 10px; margin:0; height:28px; box-sizing:border-box; line-height:1; cursor:pointer;">
            ${isLast ? 'Dokončit' : 'Další →'}
          </button>
          <div style="display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-muted);">
            <span>Celkem:</span>
            <strong style="color:var(--text-primary);">${_ai.earnedPoints} / ${_ai.maxPoints} b</strong>
          </div>
        </div>
      </div>`;
  }

  // ─── Šablona: Souhrn (všechny podúkoly dokončeny) ───────────────────────────
  function summaryHtml(history, earned, max) {
    const pct = max > 0 ? Math.round((earned / max) * 100) : 0;
    const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : pct >= 50 ? 'E' : 'F';
    const gradeColor = grade === 'F' ? '#ef4444' : '#22c55e';

    const rows = history.map((h, i) => `
      <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px 14px; margin-bottom:8px; background:var(--bg-status);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
          <strong style="color:var(--text-primary); font-size:13px;">Úkol ${i + 1}</strong>
          ${h.maxPoints > 0 ? `<span style="font-size:12px; font-weight:bold; color:${h.points >= h.maxPoints * 0.7 ? '#10b981' : '#ef4444'};">${h.points} / ${h.maxPoints} b</span>` : ''}
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px; white-space:pre-wrap;">${esc(h.answer || '—').substring(0, 200)}${h.answer?.length > 200 ? '…' : ''}</div>
      </div>`).join('');

    return `
      <div id="ai-summary-card" style="
           border:2px solid #10b981;
           border-radius:12px;
           background:var(--bg-panel);
           padding:24px;
           margin:12px 0;">

        <div style="text-align:center; margin-bottom:20px;">
          <div style="font-size:36px; margin-bottom:8px;">🎉</div>
          <h3 style="margin:0 0 6px; color:var(--text-primary);">Všechny úkoly splněny!</h3>
          ${max > 0 ? `
          <div style="display:inline-flex; align-items:center; gap:12px; margin-top:8px;">
            <span style="font-size:22px; font-weight:bold; color:var(--text-primary);">${earned} / ${max} bodů</span>
            <span style="background:${gradeColor}; color:white; padding:4px 16px; border-radius:6px; font-size:18px; font-weight:bold;">${grade}</span>
          </div>` : ''}
        </div>

        <div style="margin-bottom:16px;">
          <strong style="color:var(--text-primary); font-size:14px;">Přehled vašich odpovědí:</strong>
          <div style="margin-top:10px;">${rows}</div>
        </div>

        <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:12px 14px; font-size:13px; color:#166534;">
          💡 Nyní klikněte na tlačítko <strong>Ukončit lab</strong>. Jakmile se laboratoř ukončí, odemkne se vám tlačítko pro <strong>Odevzdat výsledek</strong>.
        </div>
      </div>`;
    // Zaregistruj hook pro submitBtn — AI má vlastní logiku (viz student-scenarios.js který ho přeskočí)
    setTimeout(() => _registerAiSubmitHook(), 0);
  }










  // ─── Submit hook pro AI scénář ───────────────────────────────────────────────
  function _registerAiSubmitHook() {
    const btn = document.getElementById('submitBtn');
    if (!btn) return;
    // Po DOM překreslení je submitBtn nový element — data-ai-hook se resetuje automaticky
    if (btn.hasAttribute('data-ai-hook')) return;
    btn.setAttribute('data-ai-hook', 'true');
    window._aiSubmitConfirmed = false; // Reset při každé nové registraci
    btn.addEventListener('click', function(e) {
      if (!window.aiScenario?.isActive()) return; // Jde o jiný typ — nechej global hook
      if (window._aiSubmitConfirmed) return;

      // 1) Jsou všechny otázky vygenerovány / zodpovězeny?
      const totalGenerated = _ai.subtaskHistory.filter(h => h && h.question).length;
      const totalAnswered = _ai.subtaskHistory.filter(h => h && h.answer !== null && h.answer !== undefined).length;
      const totalMissing = _ai.totalSubtasks - totalAnswered;
      if (totalMissing > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        customConfirm(
          `Jste si jistý, že chcete odevzdat výsledek?\n\nZodpověděl jste pouze ${totalAnswered} otázek z ${_ai.totalSubtasks}.`,
          () => {
            window._aiSubmitConfirmed = true;
            btn.click();
          }
        );
        return;
      }

      // 2) vše zodpovězeno — pokračuj normálně
    }, true);
  }

  // ─── Spinner CSS (injektuje se jednou) ──────────────────────────────────────
  function ensureSpinnerCss() {
    // Styly jsou nyní v style.css
  }

  // ─── Hlavní inicializace ─────────────────────────────────────────────────────
  async function initAiScenario(scenario, latestAttempt, state) {
    _restoreExerciseApi(); // Obnov API po případném edu módu z předchozího scénáře
    ensureSpinnerCss();

    _ai.scenario   = scenario;
    _ai.scenarioId = scenario.scenarioId;
    _ai.attemptId  = latestAttempt?.attemptId || null;
    _ai.isRunning  = true;
    _ai.isLocked   = false;

    // Odemkni kontejner při každé nové inicializaci
    const _c = getContainer();
    if (_c) {
      _c.style.pointerEvents = 'auto';
      _c.style.opacity = '1';
    }

    const hints = scenario.hints || "";
    // [ADAPTIVE:false] v hints explicitně vypíná adaptivitu i pokud DB říká jinak
    const _adaptiveExplicitOff = hints.includes('[ADAPTIVE:false]');
    _ai.isAdaptive = !_adaptiveExplicitOff && (hints.includes('[ADAPTIVE:true]') || scenario.difficulty === 'adaptive');
    _ai.totalSubtasks = parseInt(getTag(hints, 'SUBTASKS') || '3', 10);
    // Načti počáteční obtížnost z [DIFFICULTY:easy/medium/hard]
    const _diffTag = getTag(hints, 'DIFFICULTY') || '';
    const _diffMap = { easy: 'low', medium: 'medium', hard: 'high', low: 'low', high: 'high' };
    _ai.difficultyLevel = _diffMap[_diffTag.toLowerCase()] || 'medium';
    // Načti obsah materiálů pro použití v promptech
    _materialsContent = "";
    await loadMaterialsContent(scenario.scenarioTemplateId);

    // Pokud je pokus odevzdaný/hodnocený nebo není aktivní → nepouštíme AI
    const isSubmittedOrEvaluated = state === 'submitted' || state === 'evaluated';
    if (isSubmittedOrEvaluated || !latestAttempt) {
      setContainerHtml(''); // Nic nevykreslujeme, historii zobrazuje hlavní modul
      _ai.isRunning = false;
      return;
    }

    // Synchronizuj stav z backendu do localStorage (spolehlivější zdroj po F5 nebo jiném zařízení)
    const _backendState = latestAttempt?.pausedAiState;
    if (_backendState && _ai.attemptId) {
      try { localStorage.setItem(progressKey(_ai.scenarioId, _ai.attemptId), _backendState); } catch {}
    }
    // Zkus obnovit progress
    const _initDiffLevel = _ai.difficultyLevel; // ulož správnou počáteční obtížnost před loadProgress
    const restored = _ai.attemptId ? loadProgress() : false;
    // loadProgress přepisuje difficultyLevel — u non-adaptive scénářů ho obnov na výchozí
    if (!_ai.isAdaptive) _ai.difficultyLevel = _initDiffLevel;

    if (restored && _ai.currentSubtask >= _ai.totalSubtasks) {
      // Všechny podúkoly dokončeny — zobraz souhrn
      renderSummary();
      return;
    }

    // Zobraz intro (z cache nebo vygeneruj)
    const container = renderContainer();
    if (!container) return;

    container.innerHTML = '';

    // Intro store (prázdný — intro je součástí každého kroku)
    container.insertAdjacentHTML('beforeend', introCardHtml(''));

    // Vytvoř placeholdery pro všechny kroky najednou — show/hide funguje od začátku
    for (let i = 0; i < _ai.totalSubtasks; i++) {
      const div = document.createElement('div');
      div.id = `ai-step-${i}`;
      if (i !== _ai.currentSubtask) div.classList.add('ai-step-hidden');
      div.innerHTML = loadingHtml(restored ? 'Načítám, kde jste naposledy skončili…' : 'Připravuji první úkol…');
      container.appendChild(div);
    }

    // Vygeneruj všechny kroky které jsou v cache (mají otázku) — ne jen do currentSubtask
    if (restored) {
      for (let i = 0; i < _ai.totalSubtasks; i++) {
        if (_ai.subtaskHistory[i]?.question) {
          await generateAndFillStep(i);
        }
      }
    } else {
      await generateAndFillStep(0);
    }

    // Zaregistruj submit hook hned po inicializaci — submitBtn může být enabled
    // ještě před zobrazením souhrnu (např. skip-lab scénář)
    setTimeout(() => _registerAiSubmitHook(), 0);
  }

  // ─── Generování Intro textu ──────────────────────────────────────────────────
  async function generateIntro(idx) {
    if (idx === undefined) idx = _ai.currentSubtask;
    const s = _ai.scenario;
    const isFirst = idx === 0;

    const system = isFirst
      ? `Jsi AI tutor kybernetické bezpečnosti. Odpovídáš vždy česky.
Napiš 1–2 věty vysvětlující co student tímto cvičením ZÍSKÁ — jakou konkrétní dovednost nebo znalost.
NEOPAKUJ popis zadání. Piš v druhé osobě ("Naučíš se...", "Získáš..."). Žádný markdown.`
      : `Jsi AI tutor kybernetické bezpečnosti. Odpovídáš vždy česky.
Napiš 1–2 věty propojující předchozí znalosti s novým úkolem číslo ${idx + 1}.
Začni slovy jako "V tomto kroku navážeme na..." nebo "Nyní využiješ...". Žádný markdown.`;

    const histPart = _ai.subtaskHistory.length > 0
      ? `Předchozí úkoly: ${_ai.subtaskHistory.slice(0, idx).map((h, i) => `${i+1}. "${h.question}"`).join('; ')}`
      : '';

    const user = `Název: "${s.title}"
Téma: "${s.description || ''}"
${histPart}`;

    return await callAI(system, user);
  }

  // ─── Generování podúkolu ─────────────────────────────────────────────────────
  async function generateSubtask(idx, diffLevel, historyContext, introText) {
    const s = _ai.scenario;

    // Vytáhni personu mentora z s.instructions za klíčem "OSOBNOST MENTORA:"
    const instructionsText = s.instructions || '';
    const personaMatch = instructionsText.match(/OSOBNOST MENTORA:\s*([\s\S]*?)(?:\n\n|$)/);
    const persona = personaMatch ? personaMatch[1].trim() : 'Jsi AI tutor kybernetické bezpečnosti.';

    // Vytáhni cíl mentora z s.instructions za klíčem "CÍL MENTORA:"
    const goalMatch = instructionsText.match(/CÍL MENTORA:\s*([\s\S]*?)(?:\n\n|$)/);
    const mentorGoal = goalMatch ? goalMatch[1].trim() : '';

    const diffInstruction = _ai.isAdaptive
      ? `Obtížnost tohoto podúkolu: ${diffLevel === 'low' ? 'LEHČÍ (základní pojmy, definice)' : diffLevel === 'high' ? 'TĚŽŠÍ (pokročilá analýza, aplikace)' : 'STŘEDNÍ'}.`
      : '';

    const tags  = getTag(s.hints, 'TAGS')  || '';
    const tools = getTag(s.hints, 'TOOLS') || '';
    const qtypes = getTag(s.hints, 'QTYPES') || 'otevřená odpověď';
    const qtypesRotate = (s.hints || '').includes('[QTYPES_ROTATE:true]');

    // Odstraň počty v závorkách např. "otevřená odpověď(2)" → "otevřená odpověď"
    const qtypesList = qtypes.split(',')
      .map(t => t.trim().replace(/\(\d+\)$/, '').trim())
      .filter(Boolean);

    // Rozviň seznam podle počtů — "otevřená odpověď(2)" = 2x otevřená odpověď
    const qtypesExpanded = [];
    qtypes.split(',').forEach(t => {
      const name = t.trim().replace(/\(\d+\)$/, '').trim();
      const count = parseInt(t.match(/\((\d+)\)$/)?.[1] || '1');
      for (let i = 0; i < count; i++) qtypesExpanded.push(name);
    });

    // Vždy použij expanded list podle indexu — QTYPES_ROTATE určuje jen zda se cykluje po vyčerpání
    const selectedQtype = qtypesExpanded.length > 0
      ? qtypesExpanded[idx % qtypesExpanded.length]
      : qtypesList[0] || 'otevřená odpověď';

    let errorComplexity = '';
    if (selectedQtype === 'oprava chyby') {
      if (diffLevel === 'low') {
        errorComplexity = 'Kód musí mít PŘIBLIŽNĚ 10-15 ŘÁDKŮ. Vytvoř 1 JEDNODUCHOU syntaktickou chybu (např. překlep v klíčovém slově, chybějící závorka). Zcela změň téma a operaci oproti předchozím úkolům.';
      } else if (diffLevel === 'high') {
        errorComplexity = 'Kód MUSÍ mít MINIMÁLNĚ 40 ŘÁDKŮ — to je POVINNÉ, kratší kód je CHYBA. Definuj třídu s konstruktorem a MINIMÁLNĚ 3 metodami, použij více vzájemně se volajících funkcí a netriviální datové struktury (slovníky, seznamy objektů). Vytvoř KOMPLEXNÍ LOGICKOU CHYBU (špatná podmínka, nekonečný cyklus, chyba indexování). PŘÍSNĚ ZAKÁZÁNO: chybějící dvojtečka, závorka nebo triviální syntaktická chyba. Zkontroluj délku před odesláním — pokud má kód méně než 40 řádků, přidej další metody nebo logiku.';
      } else {
        errorComplexity = 'Kód musí mít PŘIBLIŽNĚ 20–30 ŘÁDKŮ. Vytvoř 1–2 STŘEDNĚ TĚŽKÉ CHYBY (např. chybějící import, logická chyba v cyklu). Pokaždé použij úplně jiný kontext kódu.';
      }
    }
    const qtypeInstruction = `Formát tohoto podúkolu: "${selectedQtype}".
${selectedQtype === 'A/B/C/D' ? 'Vytvoř testovací otázku s výběrem z odpovědí. PRAVIDLA: (1) Otázka musí mít JEDNU SPRÁVNOU odpověď a tři plausibilní ale špatné návnady. (2) Přímo v textu otázky vypiš možnosti A) B) C) D), každou na samostatném řádku. (3) Otázka se ptá na konkrétní fakt, definici nebo princip — NESMÍ být výzvou k porovnání, výčtu nebo popisu všech možností najednou. (4) Odpovědi musí být přibližně stejně dlouhé a formátované. ZAKÁZÁNO: ptát se "Porovnej A, B, C a D" nebo "Popiš každý z nich" — to není testová otázka.' : ''}
${selectedQtype === 'doplňování slov' ? 'Vytvoř větu s PŘESNĚ 2 chybějícími odbornými termíny. KLÍČOVÉ PRAVIDLO: větu musíš sestavit tak, aby chybějící termíny šlo doplnit v ZÁKLADNÍM TVARU (1. pád, nominativ nebo infinitiv). ZAKÁZÁNO: konstruovat větu tak, aby blank byl ve skloňovaném tvaru (2.–7. pád). ZAKÁZÁNO: vynechávat spojky, předložky nebo pomocná slovesa — vynechávej pouze podstatná jména nebo slovesa v infinitivu. Každé chybějící místo označ jako ___. Příklad SPRÁVNĚ: "Algoritmus ___ kombinuje výhody metody ___ a adaptivního učícího kroku." Příklad ŠPATNĚ: "Síť minimalizuje ___ pomocí algoritmu ___." (druhý blank by vyžadoval 2. pád)' : ''}
${selectedQtype === 'Pravda/Nepravda' ? 'Předlož POUZE samotné tvrzení, o kterém student rozhodne, zda je pravdivé. ABSOLUTNĚ ZAKÁZÁNO je psát na konec věty "Pravda/Nepravda?", "Pravda nebo nepravda?" nebo přidávat možnosti typu "A) Pravda, B) Nepravda".' : ''}
${selectedQtype === 'oprava chyby' ? `Přímo do textu otázky VLOŽ ukázku chybného kódu, konfiguračního souboru nebo terminálového příkazu k analýze (použij markdown blok kódu). Kód MUSÍ být součástí tvé odpovědi. DŮLEŽITÉ: Každý příkaz nebo řádek kódu musí být na SAMOSTATNÉM ŘÁDKU. ${errorComplexity}` : ''}`.trim();

    const system = `${persona} Odpovídáš vždy česky.
Vytváříš podúkol číslo ${idx + 1} z celkem ${_ai.totalSubtasks} pro vzdělávací zadání.
${diffInstruction}
${qtypeInstruction}
Vrať POUZE samotné znění podúkolu (otázku nebo úkol) — žádný nadpis, žádné uvozovky. Markdown formátování nepoužívej s výjimkou ohraničení bloků kódu.
Podúkol musí být konkrétní a splnitelný textovou odpovědí.`;

    const histPart = historyContext.length > 0
      ? `\nUž zodpovězené podúkoly:\n${historyContext.map((h, i) => `${i + 1}. Otázka: "${h.question}" | Odpověď: "${(h.answer || '').substring(0, 100)}"`).join('\n')}\n`
      : '';

    const materialsPart = _materialsContent
      ? `\nREFERENČNÍ MATERIÁL PRO GENEROVÁNÍ OTÁZEK:\n${_materialsContent}`
      : '';

    const usedQuestions = _ai.subtaskHistory.slice(0, idx)
      .map((h, i) => `${i+1}. "${h.question || ''}"`)
      .filter(q => q.length > 5)
      .join('\n');
    const noRepeatPart = usedQuestions ? `\nUŽ POUŽITÉ OTÁZKY (NEOPAKUJ tyto ani podobné):\n${usedQuestions}\n` : '';

    const _ctx = parseAiContext(s);
    const learningGoalPart  = _ctx.learningGoal  ? `\nVZDĚLÁVACÍ CÍL ZADÁNÍ: "${_ctx.learningGoal}"\n` : '';
    const masterPromptPart  = _ctx.masterPrompt  ? `\nMASTER PROMPT UČITELE (dodržuj přesně): "${_ctx.masterPrompt}"\n` : '';
    const feedbackFocusPart = _ctx.feedbackFocus ? `\nFOKUS ZPĚTNÉ VAZBY: "${_ctx.feedbackFocus}"\n` : '';
    const codeContextPart   = _ctx.codeContext   ? `\nKONTEXT KÓDU (používej tato jména proměnných/funkcí/importů): \n${_ctx.codeContext}\n` : '';
    const introPart         = introText          ? `\nCÍL TOHOTO PODÚKOLU (zadání MUSÍ navazovat přesně na tento cíl): "${introText}"\n` : '';

    const user = `ZADÁNÍ: "${s.title}"
POPIS: "${s.description || ''}"
CÍL A PERSONA MENTORA: "${mentorGoal}"${learningGoalPart}${masterPromptPart}${feedbackFocusPart}${codeContextPart}
POVOLENÉ NÁSTROJE: "${tools}"
TÉMATA: "${tags}"${introPart}${histPart}${noRepeatPart}${materialsPart}`;

    return await callAI(system, user);
  }

  // ─── Hodnocení odpovědi ──────────────────────────────────────────────────────
  async function evaluateAnswer(question, answer, maxPts) {
    const s = _ai.scenario;

    // Vytáhni personu mentora z s.instructions za klíčem "OSOBNOST MENTORA:"
    const instructionsText = s.instructions || '';
    const personaMatch = instructionsText.match(/OSOBNOST MENTORA:\s*([\s\S]*?)(?:\n\n|$)/);
    const persona = personaMatch ? personaMatch[1].trim() : 'Jsi přísný učitel IT a kybernetické bezpečnosti.';

    const rubric = s.gradingRubric || s.grading_rubric || 'Hodnoť podle zadání a technické správnosti.';

    const idx = _ai.currentSubtask;
    const qtype = _ai.subtaskHistory[idx]?.qtype || '';
    const isBinary = /a\/b\/c\/d|abcd|výběr|pravda|nepravda|true\/false/i.test(qtype);
    const isFillType = /doplň|chybějící/i.test(qtype);
    const isErrorType = /oprava|chyb|kód/i.test(qtype);

    const qtypeHint = isBinary ? 'Jde o otázku s výběrem odpovědi (nebo Pravda/Nepravda) — hodnoť zda student vybral správnou možnost.'
      : isFillType ? 'Jde o doplňování chybějícího výrazu — hodnoť přesnost doplněného termínu.'
      : isErrorType ? 'Jde o opravu chyby v kódu/příkazu — hodnoť zda student správně identifikoval chybu A navrhl konkrétní opravu.'
      : 'Jde o otevřenou textovou odpověď.';

    const fillBlanks = (_ai.subtaskHistory[idx]?.fillQuestion?.split('___').length - 1) || 2;
    const ptsPerBlank = Math.round(maxPts / fillBlanks);
    const binaryRule = isBinary
      ? `- Toto je výběrová otázka. Správná odpověď = ${maxPts} bodů, špatná = 0 bodů. Žádné částečné body.`
      : isFillType
      ? `- Otázka má ${fillBlanks} chybějící slova. Za každé správně doplněné slovo = ${ptsPerBlank} bodů (celkem max ${maxPts} b). Hodnoť každé slovo ZVLÁŠŤ a KONZISTENTNĚ — pokud uznáš slovo jako správné, musí se to odrazit v bodech. Správné slovo = ${ptsPerBlank} b, špatné = 0 b. V poli \"correct_answer\" uveď správné termíny PŘESNĚ v tomto formátu (každé na nový řádek, očíslované): 1) první správný termín\n2) druhý správný termín\nPočet položek musí odpovídat počtu ___ v zadání. NIKDY nepoužívej lomítka.`
      : `- Správná ale neúplná odpověď = částečné body.`;

    const system = `${persona} Odpovídáš vždy česky.
Ohodnoť odpověď studenta na podúkol.
TYP OTÁZKY: ${qtypeHint}

HODNOTÍCÍ KRITÉRIA (rubrika):
${rubric}

PRAVIDLA HODNOCENÍ:
- Prázdná odpověď nebo "nevím" = 0 bodů, napiš proč a povzbuď ke studiu.
${binaryRule}
- Hodnoť věcně a konstruktivně, 2–3 věty.
- NEZOBRAZUJ správnou odpověď ani řešení v poli "feedback" — pouze zhodnoť a nasměruj studenta. Správné řešení vždy uveď v poli "correct_answer".

Vrať POUZE validní JSON objekt přesně v tomto formátu, bez jakéhokoliv dalšího textu:
{
  "points": <číslo 0 až ${maxPts}>,
  "reasoning": "<1 věta pro učitele: proč jsi udělil právě tolik bodů, co bylo správně/špatně>",
  "feedback": "<1-2 věty hodnotící odpověď studenta, NEZOBRAZUJ ZDE SPRÁVNOU ODPOVĚĎ>",
  "correct_answer": "<POVINNÉ: vždy uveď správnou odpověď nebo správný kód, i když student odpověděl správně>",
  "explanation": "<POUZE pokud points < ${maxPts}: 1-2 věty vysvětlující proč je správná odpověď správná. Pokud student odpověděl správně, MUSÍ být null>"
}`;

    const materialsPart = _materialsContent
      ? `\nREFERENČNÍ MATERIÁL:\n${_materialsContent}`
      : '';

    const user = `ZADÁNÍ: "${s.title}"
PODÚKOL: "${question}"
ODPOVĚĎ STUDENTA: "${answer}"
MAXIMUM BODŮ: ${maxPts}${materialsPart}`;

    return await callAIEval(system, user, maxPts);
  }

  // ─── Adaptivní změna obtížnosti ──────────────────────────────────────────────
  function adaptDifficulty(earnedPct) {
    if (!_ai.isAdaptive) return _ai.difficultyLevel;
    if (earnedPct >= 0.8) {
      _ai.difficultyLevel = 'high';
    } else if (earnedPct <= 0.4) {
      _ai.difficultyLevel = 'low';
    } else {
      _ai.difficultyLevel = 'medium';
    }
    return _ai.difficultyLevel;
  }

  // ─── Vygeneruj a vyplň krok (lazy, zachová DOM) ──────────────────────────────
  async function generateAndFillStep(idx) {
    const existing = _ai.subtaskHistory[idx];
    const hints = _ai.scenario?.hints || '';
    const gradingMatch = hints.match(/\[GRADING:\s*[a-zA-Z]+\s*:?\s*(\d+)?\s*\]/i);
    const _gradingInfo = typeof parseGradingInfo === 'function' ? parseGradingInfo(hints) : null;
    const _gradingInfoMax = _gradingInfo?.max > 0 && _gradingInfo?.max !== 10 ? _gradingInfo.max : 0;
    const tagPoints = gradingMatch && gradingMatch[1] ? parseInt(gradingMatch[1], 10) : null;
    
    // Záchrana: Pokud učitel napsal "max bodů 150" rovnou do textu (instructions) nebo hints
    const textPointsMatch = hints.match(/max(?:\.|im[áa]ln[íi])?\s*(?:po[čc]et\s*)?bod[uů]?\s*:?\s*(\d+)/i) || 
                            (_ai.scenario?.instructions || "").match(/max(?:\.|im[áa]ln[íi])?\s*(?:po[čc]et\s*)?bod[uů]?\s*:?\s*(\d+)/i);
    const textPoints = textPointsMatch ? parseInt(textPointsMatch[1], 10) : null;

    const fallbackFromAttempts = (_ai.scenario?.maxAttempts > 20) ? _ai.scenario.maxAttempts : null;
    
    const totalMaxPoints = Number(_ai.scenario?.maxPoints) || tagPoints || textPoints || (_gradingInfoMax > 0 ? _gradingInfoMax : fallbackFromAttempts) || (_ai.totalSubtasks * 10);
    
    const basePts = Math.floor(totalMaxPoints / _ai.totalSubtasks);
    const remainder = totalMaxPoints % _ai.totalSubtasks;
    const maxPts = basePts + (idx < remainder ? 1 : 0);
    _ai.maxPoints = totalMaxPoints;


    let question, introText;

    // Vypočítej qtype vždy (potřebuje se i při restore z cache)
    const _qtypesRaw = getTag(_ai.scenario?.hints || '', 'QTYPES') || 'otevřená odpověď';
    const _qtypesRotate = (_ai.scenario?.hints || '').includes('[QTYPES_ROTATE:true]');
    const _qtypesExp = [];
    _qtypesRaw.split(',').forEach(t => {
      const name = t.trim().replace(/\(\d+\)$/, '').trim();
      const count = parseInt(t.match(/\((\d+)\)$/)?.[1] || '1');
      for (let i = 0; i < count; i++) _qtypesExp.push(name);
    });
    const resolvedQtype = _qtypesExp.length > 0
      ? _qtypesExp[idx % _qtypesExp.length]
      : _qtypesExp[0] || 'otevřená odpověď';

    if (existing && existing.question) {
      question  = existing.question;
      introText = existing.intro || '';
    } else {
      try {
        introText = await generateIntro(idx);
        question  = await generateSubtask(idx, _ai.difficultyLevel, _ai.subtaskHistory.slice(0, idx), introText);
      } catch(e) {
        question = `<div style="padding:12px; background:#fef2f2; border:1px solid #f87171; border-radius:8px; color:#991b1b; margin-bottom:10px;"><strong>Úkol se nepodařilo načíst</strong><br>AI služba je přetížena. Krok byl automaticky označen jako přeskočený, abyste nezůstali zablokovaní a mohli laboratoř dokončit.</div>`;
        introText = '';
      }
      if (_ai.subtaskHistory.length <= idx) {
        _ai.subtaskHistory.push({ question, intro: introText, qtype: resolvedQtype, answer: null, feedback: null, points: 0, maxPoints: maxPts });
      } else {
        _ai.subtaskHistory[idx] = { ..._ai.subtaskHistory[idx], question, intro: introText, qtype: resolvedQtype };
      }
      
      // Záchranný fallback: Pokud AI selhalo, rovnou označíme za odpovězené
      if (question.includes('Úkol se nepodařilo načíst')) {
        _ai.subtaskHistory[idx].answer = "Automaticky přeskočeno (chyba služby AI)";
        _ai.subtaskHistory[idx].feedback = "Krok byl automaticky přeskočen. Bude nutná ruční kontrola učitelem.";
        _ai.subtaskHistory[idx].points = 0;
      }
      saveProgress();
    }

    // Aktualizuj intro-store (pro subtaskCardHtml)
    const introStore = document.getElementById('ai-intro-store');
    if (introStore) introStore.setAttribute('data-intro', introText || '');

    // Vyplň nebo vytvoř wrapper pro tento krok
    const wrapperId = `ai-step-${idx}`;
    let wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = wrapperId;
      if (idx !== _ai.currentSubtask) wrapper.classList.add('ai-step-hidden');
      const container = getContainer();
      if (container) container.appendChild(wrapper);
    }
    // Zachovej hidden stav — nepřepisuj ho
    const wasHidden = wrapper.classList.contains('ai-step-hidden');
    // Pro A/B/C/D otázky odstraň možnosti z textu — zobrazí se jako radio buttony
    const storedQtype = _ai.subtaskHistory[idx]?.qtype || '';
    const qTypeDetected = detectQuestionType(question, storedQtype);
    const isAbcd = qTypeDetected === 'abcd';
    const isFill = qTypeDetected === 'fill';
    const isTf = qTypeDetected === 'tf';
    let cleanQuestion = question;
    if (isAbcd) {
      const abcdStart = question.search(/\bA\)/);
      cleanQuestion = abcdStart > 0 ? question.slice(0, abcdStart).trim() : question;
      _ai.subtaskHistory[idx] = { ..._ai.subtaskHistory[idx], abcdOptions: question };
    } else if (isFill) {
      _ai.subtaskHistory[idx] = { ..._ai.subtaskHistory[idx], fillQuestion: question };
      cleanQuestion = ''; // otázka se zobrazí inline přes renderAnswerInput
    } else if (isTf) {
      // Vyřízneme tvrdé vypsání možností (např. "A) Pravda B) Nepravda") i zbytečné dotazy typu "Pravda/Nepravda?" na konci textu
      cleanQuestion = question
          .replace(/[A-D][.)]\s*(Pravda|Nepravda)\s*/gi, '')
          .replace(/\b(Pravda\s*[\/|]\s*Nepravda|Pravda\s*nebo\s*Nepravda)\b\s*\??\s*$/gi, '')
          .trim();
    }
    
        // Zpracuj code bloky PŘED escapováním, pak escapuj zbytek
    let formattedQuestion = cleanQuestion.replace(
      /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g,
      (_match, lang, code) => `\x00PRE\x00${lang||'python'}\x00${code.trim()}\x00ENDPRE\x00`
    );
    formattedQuestion = formattedQuestion.split('\x00PRE\x00').map((part, i) => {
      if (i === 0) return esc(part).replace(/\n/g, '<br>');
      const _marker = '\x00ENDPRE\x00';
      const endIdx = part.indexOf(_marker);
      const inner = part.slice(0, endIdx);
      const after = part.slice(endIdx + _marker.length);
      const sepIdx = inner.indexOf('\x00');
      const lang = inner.slice(0, sepIdx);
      const code = inner.slice(sepIdx + 1);
      return `<pre data-lang="${lang}" style="margin:8px 0;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;"><code>${esc(code)}</code></pre>${esc(after).replace(/\n/g, '<br>')}`;
    }).join('');

    // Odstraň zbytečné mezery kolem <pre>
    formattedQuestion = formattedQuestion
      .replace(/(<br>\s*)+(<pre\b)/g, '$2')
      .replace(/(<\/pre>)(\s*<br>)+/g, '$1');

    wrapper.innerHTML = subtaskCardHtml(
      idx,
      _ai.totalSubtasks,
      formattedQuestion,
      maxPts,
      _ai.difficultyLevel,
      introText
    );
    if (wasHidden) wrapper.classList.add('ai-step-hidden');

    // Obnov uložený draft (pozastavené cvičení) — pouze pro aktuální, ještě nezodpovězený krok
    if (idx === _ai.currentSubtask && _ai.restoredDraft && !(existing?.answer !== null && existing?.answer !== undefined)) {
      const _draftEl = document.getElementById(`ai-answer-input-${idx}`);
      if (_draftEl && !_draftEl.disabled) {
        _draftEl.value = _ai.restoredDraft;
        window._aiAnswerDraft = _ai.restoredDraft;
        _ai.restoredDraft = ''; // spotřebováno
      }
    }

    window._aiCurrentQuestion  = question;
    window._aiCurrentMaxPoints = maxPts;

    // Pokud došlo k výpadku AI, skryjeme odesílací prvky, ať to nemate
    if (_ai.subtaskHistory[idx].answer === "Automaticky přeskočeno (chyba služby AI)") {
        const inp = document.getElementById(`ai-answer-input-${idx}`);
        if (inp) inp.style.display = 'none';
        const btn = document.getElementById(`ai-submit-btn-${idx}`);
        if (btn) btn.style.display = 'none';
        const tfLabels = document.querySelectorAll(`[name="ai-tf-${idx}"]`);
        tfLabels.forEach(r => { if(r.closest('label')) r.closest('label').style.display = 'none'; });
        const abcdLabels = document.querySelectorAll(`[name="ai-abcd-${idx}"]`);
        abcdLabels.forEach(r => { if(r.closest('label')) r.closest('label').style.display = 'none'; });
        const host = document.getElementById(`ai-answer-cm-host-${idx}`);
        if (host) host.style.display = 'none';
    }

    // Společná funkce pro načtení CodeMirroru (pro zadání i odpověď)
    const _ensureCM = (cb) => {
        const runCb = () => {
            // Počkáme až bude existovat CodeMirror a jeho mód python
            if (window.CodeMirror && window.CodeMirror.modes && window.CodeMirror.modes.python) {
                cb();
            } else {
                setTimeout(runCb, 100);
            }
        };

        if (typeof window.ensureCodeMirrorLoaded === 'function') { 
            window.ensureCodeMirrorLoaded(() => {
                // Pojistka: pokud hlavní systém CM načetl, ale bez Pythonu
                if (!window.CodeMirror?.modes?.python) {
                    const py = document.createElement('script');
                    py.src = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/python/python.min.js';
                    py.onload = runCb;
                    document.head.appendChild(py);
                } else {
                    runCb();
                }
            }); 
            return; 
        }

        if (window.CodeMirror && window.CodeMirror.modes?.python) { cb(); return; }

        if (!document.getElementById('cm-script-student-core')) {
            [['stylesheet','https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.css'],
             ['stylesheet','https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/theme/dracula.min.css']
            ].forEach(([rel,href]) => { const l=document.createElement('link'); l.rel=rel; l.href=href; document.head.appendChild(l); });
            const s = document.createElement('script'); s.id='cm-script-student-core';
            s.src='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.js';
            s.onload = () => {
                const py = document.createElement('script'); 
                py.id='cm-script-student-python';
                py.src='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/python/python.min.js'; 
                py.onload = runCb;
                document.head.appendChild(py); 
            };
            document.head.appendChild(s);
        } else {
            runCb(); // Polling, dokud se to nestáhne odjinud
        }
    };

    // Nahraď <pre><code> bloky CodeMirror readonly editory
    const _codeBlocks = wrapper.querySelectorAll('pre code');
    if (_codeBlocks.length > 0) {
        _ensureCM(() => {
            const isDark = document.body.classList.contains('dark-mode');
            const theme = isDark ? 'dracula' : 'default';
            _codeBlocks.forEach(codeEl => {
                const pre = codeEl.parentElement;
                if (!pre || pre._cmDone) return;
                const code = codeEl.textContent || '';
                const _lang = pre.getAttribute('data-lang') || 'python';
                const _modeMap = { python:'python', javascript:'javascript', js:'javascript', php:'php', bash:'shell', sh:'shell', c:'clike', cpp:'clike', java:'clike' };
                const _mode = _modeMap[_lang.toLowerCase()] || 'python';
                const host = document.createElement('div');
                // overflow:hidden zamezí dvojitým scrollbarům, CM si řeší scroll sám
                host.className = 'code-editor-host';
                pre.parentNode.replaceChild(host, pre);
                // Normalizuj kód — escapované \n na skutečné newlines + strip čísel řádků které přidává AI (např. "1 import numpy")
                const _normalizedCode = code
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '    ')
                    .split('\n')
                    .map(l => l.replace(/^\s*\d+\s/, ''))
                    .join('\n');
                const _lines = _normalizedCode.split('\n').length;
                // Přidáno +4 řádky k výšce a zvýšeny limity (min 160px)
                const _height = Math.min(Math.max((_lines + 4) * 19 + 16, 160), 700);
                const cm = CodeMirror(host, {
                    value: _normalizedCode,
                    mode: _mode,
                    theme,
                    lineNumbers: true,
                    readOnly: true,
                    lineWrapping: false,
                    scrollbarStyle: 'native'
                });
                // 100 % výšky znamená, že CM bude kopírovat velikost parent divu při manuálním roztažení
                cm.setSize('100%', '100%');
                host.style.height = _height + 'px'; // Výchozí výška hostitele

                // Refresh CM při manuálním resize hostitelského divu
                if (window.ResizeObserver) {
                    new ResizeObserver(() => cm.refresh()).observe(host);
                }
                setTimeout(() => { cm.refresh(); }, 200);
                host._cmDone = true;
            });
        });
    }

    // Inicializace CodeMirror pro odpověď studenta (typ 'error')
    const _answerHost = wrapper.querySelector(`#ai-answer-cm-host-${idx}`);
    if (_answerHost && !_answerHost._cmDone) {
        _ensureCM(() => {
            const isDark = document.body.classList.contains('dark-mode');
            const theme = isDark ? 'dracula' : 'default';
            const _existingAnswer = _ai.subtaskHistory[idx]?.answer;
            const _isAnswered = _existingAnswer !== null && _existingAnswer !== undefined;
            _answerHost.style.height = 'auto'; 
            _answerHost.style.display = 'block'; 
            
            const _cmDraft = idx === _ai.currentSubtask && !_isAnswered ? (_ai.restoredDraft || '') : '';
            if (_cmDraft) { _ai.restoredDraft = ''; window._aiAnswerDraft = _cmDraft; }
            const _cmInitVal = _ai.subtaskHistory[idx]?.answer || _cmDraft;
            const cm = CodeMirror(_answerHost, {
                value: _cmInitVal,
                mode: 'python',
                theme,
                lineNumbers: true,
                readOnly: _isAnswered,
                lineWrapping: false,
                viewportMargin: Infinity, // Klíčové pro automatické roztahování výšky podle obsahu textu
                scrollbarStyle: 'native'
            });
            
            // Nastav výchozí výšku hostu a povol resize stejně jako u zadání
            _answerHost.style.height = '180px';
            _answerHost.style.minHeight = '150px';
            _answerHost.style.resize = 'vertical';
            _answerHost.style.overflow = 'hidden';
            _answerHost.style.border = '1px solid var(--border-color)';
            _answerHost.style.borderRadius = '8px';

            cm.setSize('100%', '100%');

            // Úprava wrapperu pro správné zobrazení a písmo
            const cmWrapper = cm.getWrapperElement();
            cmWrapper.style.height = '100%';
            cmWrapper.style.fontSize = '15px';
            cmWrapper.style.lineHeight = '1.6';

            const scroller = cm.getScrollerElement();
            scroller.style.overflowY = 'auto';

            cm.on('change', () => {
                const val = cm.getValue();
                window._aiAnswerDraft = val;
                const hidden = document.getElementById(`ai-answer-input-${idx}`);
                if (hidden) hidden.value = val;
            });
            if (window.ResizeObserver) {
                new ResizeObserver(() => cm.refresh()).observe(_answerHost);
            }
            _answerHost._cmDone = true;
            _answerHost._cmInstance = cm;
            setTimeout(() => { cm.refresh(); }, 200);
        });
    }

    // Pokud byl zodpovězen — obnov stav
    if (existing && existing.answer !== null) {
      const submit  = document.getElementById(`ai-submit-btn-${idx}`);
      const nextBtn = document.getElementById(`ai-next-btn-${idx}`);
      const qtype = existing.qtype || '';

      // Obnov ABCD radio
      const letter = existing.answer.match(/^([A-D])\)/)?.[1];
      if (letter) {
        const radio = document.querySelector(`input[name="ai-abcd-${idx}"][value="${letter}"]`);
        if (radio) {
          radio.checked = true;
          // Vizuální styl — označ vybranou labelu
          const label = radio.closest('label');
          if (label) { label.style.borderColor = '#3b82f6'; label.style.background = 'rgba(59,130,246,0.15)'; }
        }
        document.querySelectorAll(`input[name="ai-abcd-${idx}"]`).forEach(r => {
          r.disabled = true;
          const lbl = r.closest('label');
          if (lbl) { lbl.style.cursor = 'not-allowed'; lbl.style.pointerEvents = 'none'; lbl.onmouseover = null; lbl.onmouseout = null; }
        });
      }
      // Obnov Pravda/Nepravda radio
      if (existing.answer === 'Pravda' || existing.answer === 'Nepravda') {
        const radio = document.querySelector(`input[name="ai-tf-${idx}"][value="${existing.answer}"]`);
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          // Vizuální styl
          const label = radio.closest('label');
          const isTrue = existing.answer === 'Pravda';
          if (label) {
            label.style.borderColor = isTrue ? '#10b981' : '#ef4444';
            label.style.background = isTrue ? '#f0fdf4' : '#fef2f2';
            label.style.color = isTrue ? '#16a34a' : '#dc2626';
          }
        }
        document.querySelectorAll(`input[name="ai-tf-${idx}"]`).forEach(r => r.disabled = true);
      }
      // Obnov fill inputy — answer je "slovo1 / slovo2"
      const isFillRestore = /doplň|chybějící/i.test(qtype) || document.getElementById(`ai-fill-input-${idx}-0`);
      if (isFillRestore) {
        const parts = existing.answer.split('/').map(s => s.trim());
        parts.forEach((val, i) => {
          const inp = document.getElementById(`ai-fill-input-${idx}-${i}`);
          if (inp) { inp.value = val; inp.disabled = true; }
        });
      }
      // Obnov běžný textarea/input
      const input = document.getElementById(`ai-answer-input-${idx}`);
      if (input && !letter && existing.answer !== 'Pravda' && existing.answer !== 'Nepravda' && !isFillRestore) {
        input.value = existing.answer;
        input.disabled = true;
      }

      if (submit) { submit.disabled = true; submit.style.opacity = '0.4'; submit.style.cursor = 'not-allowed'; }
      if (nextBtn) {
        nextBtn.removeAttribute('disabled');
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
        nextBtn.style.cursor = 'pointer';
        nextBtn.style.pointerEvents = 'auto';
        nextBtn.textContent = idx >= _ai.totalSubtasks - 1 ? 'Dokončit' : 'Další →';
      }
      if (existing.feedback) {
        showInlineFeedback(existing.feedback, existing.points, existing.maxPoints, idx >= _ai.totalSubtasks - 1, idx, existing.correctAnswer || null, existing.explanation || null);
      }
    }
  }

  // ─── Show/hide jako goToStep v student.js ────────────────────────────────────
  function showStep(idx) {
    for (let i = 0; i < _ai.totalSubtasks; i++) {
      const el = document.getElementById(`ai-step-${i}`);
      if (el) el.classList.toggle('ai-step-hidden', i !== idx);
    }
    setTimeout(() => {
      const el = document.getElementById(`ai-step-${idx}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  // ─── Odeslání odpovědi studenta ──────────────────────────────────────────────
  async function submitAiAnswer(idx) {
    if (_ai.isLocked) return;
    if (idx === undefined) idx = _ai.currentSubtask;
    
    // Kritická pojistka: nelze odeslat již zodpovězený úkol
    if (_ai.subtaskHistory[idx] && _ai.subtaskHistory[idx].answer !== null) return;

    const answerInput = document.getElementById(`ai-answer-input-${idx}`);
    const submitBtn   = document.getElementById(`ai-submit-btn-${idx}`);
    const feedbackDiv = document.getElementById(`ai-answer-feedback-${idx}`);

    if (!answerInput) return;
    const answer = (answerInput.value || window._aiAnswerDraft || '').trim();

    if (!answer) {
      if (feedbackDiv) {
        feedbackDiv.className = 'feedback-error-inline';
        feedbackDiv.textContent = '✘ Zadejte odpověď.';
      }
      return;
    }

    // Zamrazíme tlačítko — text zůstane stejný
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.4';
      submitBtn.style.cursor = 'not-allowed';
    }
    if (answerInput) answerInput.disabled = true;

    // Zablokuj VŠECHNA tlačítka v AI kontejneru + globální tlačítka po dobu hodnocení
    const _container = getContainer();
    if (_container) {
      _container.querySelectorAll('button, input, textarea, label').forEach(el => {
        el._wasDisabled = el.disabled;
        el.disabled = true;
        el.style.pointerEvents = 'none';
      });
    }
    // Globální tlačítka — stopBtn, submitBtn, startBtn
    ['stopBtn', 'submitBtn', 'startBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el._wasDisabled = el.disabled; el.disabled = true; el.style.pointerEvents = 'none'; el.style.opacity = '0.4'; }
    });

    // Toast vpravo nahoře místo inline loadingu
    if (typeof showToast === 'function') showToast('Hodnotí se vaše řešení…', false, true);

    const question = _ai.subtaskHistory[idx]?.question || window._aiCurrentQuestion;
    const maxPts   = _ai.subtaskHistory[idx]?.maxPoints || window._aiCurrentMaxPoints || 10;

    let result;
    try {
      result = await evaluateAnswer(question, answer, maxPts);
    } catch (e) {
      result = { points: 0, feedback: `Chyba hodnocení: ${e.message}` };
    }

    // Ulož výsledek — zachovej intro a ostatní existující pole
    _ai.subtaskHistory[idx] = {
      ..._ai.subtaskHistory[idx],
      answer,
      feedback: (result.feedback || '').slice(0, 800),
      points: result.points,
      maxPoints: maxPts,
      correctAnswer: (result.correct_answer || '').slice(0, 400) || null,
      explanation: (result.explanation || '').slice(0, 600) || null,
      reasoning: (result.reasoning || '').slice(0, 600) || null,
    };
    _ai.earnedPoints = _ai.subtaskHistory.reduce((s, h) => s + (h.points || 0), 0);

    // Aktualizuj průběžné skóre
    const totalPtsEl = document.getElementById(`ai-total-pts-${idx}`);
    if (totalPtsEl) totalPtsEl.textContent = `${_ai.earnedPoints} / ${_ai.maxPoints} b`;

    // Adaptivita — upravíme obtížnost pro příští podúkol
    const earnedPct = maxPts > 0 ? result.points / maxPts : 0;
    adaptDifficulty(earnedPct);
    saveProgress();

    // Skryj toast
    if (typeof hideToast === 'function') hideToast();

    // Odemkni tlačítka — ale ne ty co mají být trvale zamčené
    if (_container) {
      _container.querySelectorAll('button, input, textarea, label').forEach(el => {
        if (!el._wasDisabled) {
          el.disabled = false;
          el.style.pointerEvents = '';
        }
        delete el._wasDisabled;
      });
    }
    // Odemkni globální tlačítka
    ['stopBtn', 'startBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._wasDisabled) {
        el.disabled = false;
        el.style.pointerEvents = '';
        el.style.opacity = '';
      }
      if (el) delete el._wasDisabled;
    });
    // submitBtn — odemkni pouze pokud lab už není aktivní (status archived/finished)
    const _submitEl = document.getElementById('submitBtn');
    if (_submitEl) {
      delete _submitEl._wasDisabled;
      const _labActive = ['succeeded', 'running', 'provisioning', 'started', 'queued']
        .includes((window._currentAttemptStatus || '').toLowerCase());
      if (!_labActive) {
        _submitEl.disabled = false;
        _submitEl.style.pointerEvents = '';
        _submitEl.style.opacity = '';
      }
    }

    // Zobraz feedback inline
    const isLast = idx >= _ai.totalSubtasks - 1;
    showInlineFeedback(result.feedback, result.points, maxPts, isLast, idx, result.correct_answer || null, result.explanation || null);
  }

  function showInlineFeedback(feedbackText, earnedPts, maxPts, isLast, idx, correctAnswer, explanation) {
    const pct = maxPts > 0 ? Math.round((earnedPts / maxPts) * 100) : 0;
    const barColor = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';

    const answerInput = document.getElementById(`ai-answer-input-${idx}`);
    const submitBtn   = document.getElementById(`ai-submit-btn-${idx}`);
    if (answerInput) answerInput.disabled = true;
    if (submitBtn)   { submitBtn.disabled = true; submitBtn.style.opacity = '0.4'; }
    // Zamkni fill inputy (doplň slovo)
    for (let _fi = 0; document.getElementById(`ai-fill-input-${idx}-${_fi}`); _fi++) {
        const _fillEl = document.getElementById(`ai-fill-input-${idx}-${_fi}`);
        _fillEl.disabled = true;
        _fillEl.style.cursor = 'not-allowed';
        _fillEl.style.opacity = '0.6';
    }
    // Zamkni ABCD radio buttony
    document.querySelectorAll(`input[name="ai-abcd-${idx}"]`).forEach(r => {
        r.disabled = true;
        const lbl = r.closest('label');
        if (lbl) { lbl.style.cursor = 'not-allowed'; lbl.style.pointerEvents = 'none'; lbl.onmouseover = null; lbl.onmouseout = null; }
    });
    // Zamkni TF radio buttony
    document.querySelectorAll(`input[name="ai-tf-${idx}"]`).forEach(r => {
        r.disabled = true;
        const lbl = r.closest('label');
        if (lbl) { lbl.style.cursor = 'not-allowed'; lbl.style.pointerEvents = 'none'; lbl.onmouseover = null; lbl.onmouseout = null; }
    });

    const feedbackDiv = document.getElementById(`ai-answer-feedback-${idx}`);
    if (feedbackDiv) {
      feedbackDiv.style.marginTop = '12px';
      feedbackDiv.innerHTML = `
        <div style="border:1px solid var(--border-color); border-radius:8px; padding:14px 16px; background:var(--bg-status);">
          <div style="font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px;">Hodnocení ${idx + 1}. úkolu:</div>
          <div style="font-size:14px; line-height:1.7; color:var(--text-primary); margin-bottom:12px;">
            ${esc((feedbackText || '').split(/\n---\n/)[0].replace(/^\s*---\s*Úkol\s+\d+[\s\S]*$/m, '').trim()).replace(/\n/g, '<br>')}
          </div>
          ${correctAnswer && earnedPts < maxPts ? `
          <div style="margin:8px 0 4px;">
            <div style="font-size:11px; font-weight:700; color:#10b981; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Správná odpověď:</div>
            <div id="ai-corr-cm-${idx}" style="border:1px solid rgba(16,185,129,0.4); border-radius:8px; overflow:hidden; resize:vertical; min-height:60px;"></div>
          </div>` : ''}
          ${explanation ? `
          <div style="margin:4px 0 12px; padding:10px 14px; background:var(--bg-panel); border-left:3px solid #3b82f6; border-radius:0 6px 6px 0; font-size:13px; color:var(--text-primary); line-height:1.6;">
            <strong>Vysvětlení:</strong> ${esc(explanation)}
          </div>` : ''}
          ${maxPts > 0 ? `
          <div style="margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-muted); margin-bottom:4px;">
              <span>Body za tento úkol</span>
              <strong style="color:var(--text-primary);">${earnedPts} / ${maxPts}</strong>
            </div>
            <div style="background:var(--border-color); border-radius:6px; height:8px; overflow:hidden;">
              <div style="background:${barColor}; height:100%; width:${pct}%; transition:width 0.5s ease; border-radius:6px;"></div>
            </div>
          </div>` : ''}
        </div>`;
    }

    // Zobraz správnou odpověď — pro kód CM editor, pro text prostý div
    if (correctAnswer && earnedPts < maxPts) {
      const elCorr = document.getElementById(`ai-corr-cm-${idx}`);
      if (elCorr) {
        const _qtype = _ai.subtaskHistory[idx]?.qtype || '';
        const looksLikeCode = _qtype === 'error'
          || /```|\bdef \w+\s*\(|\bimport \w|\bclass \w+[:\s{(]|\bfunction \w*\s*\(/.test(correctAnswer);
        if (looksLikeCode && typeof window.ensureCodeMirrorLoaded === 'function') {
          window.ensureCodeMirrorLoaded(() => {
            if (elCorr._cm) return;
            const _lines = correctAnswer.split('\n').length;
            elCorr.style.height = Math.min(Math.max(_lines * 19 + 32, 80), 300) + 'px';
            elCorr.style.overflow = 'hidden';
            const isDark = document.body.classList.contains('dark-mode');
            const cmCorr = CodeMirror(elCorr, { value: correctAnswer, mode: 'python', theme: isDark ? 'dracula' : 'default', lineNumbers: true, readOnly: true, lineWrapping: false, scrollbarStyle: 'native' });
            cmCorr.setSize('100%', '100%');
            if (window.ResizeObserver) new ResizeObserver(() => cmCorr.refresh()).observe(elCorr);
            setTimeout(() => cmCorr.refresh(), 100);
            elCorr._cm = cmCorr;
          });
        } else {
          // Prostý text — pokud jde o víceřádkovou odpověď bez číslování, přidej čísla
          elCorr.style.removeProperty('height');
          elCorr.style.removeProperty('overflow');
          const _lines = correctAnswer.split('\n').map(l => l.trim()).filter(Boolean);
          let _formatted = correctAnswer;
          if (_lines.length > 1 && !/^\d+[\.\)]/.test(_lines[0])) {
            _formatted = _lines.map((l, i) => `${i + 1}) ${l}`).join('\n');
          }
          elCorr.innerHTML = `<div style="padding:10px 12px; font-size:14px; color:var(--text-primary); line-height:1.6; white-space:pre-wrap; font-family:inherit;">${esc(_formatted)}</div>`;
        }
      }
    }

    // Odemkni tlačítko Další — explicitně odstraň disabled atribut kvůli !important CSS pravidlu
    const nextNavBtn = document.getElementById(`ai-next-btn-${idx}`);
    if (nextNavBtn) {
      nextNavBtn.removeAttribute('disabled');
      nextNavBtn.disabled = false;
      nextNavBtn.style.opacity = '1';
      nextNavBtn.style.cursor = 'pointer';
      nextNavBtn.style.pointerEvents = 'auto';
    }

    // Aktualizuj celkové body
    const totalPtsEl = document.getElementById(`ai-total-pts-${idx}`);
    if (totalPtsEl) totalPtsEl.textContent = `${_ai.earnedPoints} / ${_ai.maxPoints} b`;
  }

  // ─── Přechod na další podúkol ────────────────────────────────────────────────
  async function nextAiSubtask() {
    await goToAiSubtask(_ai.currentSubtask + 1);
  }

  // ─── Přechod na podúkol — show/hide jako goToStep v student.js ───────────────
  async function goToAiSubtask(targetIdx) {
    if (_ai.isLocked) return;
    if (targetIdx < 0) return;
    if (window._aiGenerating) return;

    // Vpřed jen pokud zodpovězeno — nebo pokud je povoleno přeskakování
    if (targetIdx > _ai.currentSubtask) {
      const cur = _ai.subtaskHistory[_ai.currentSubtask];
      const allowSkip = (_ai.scenario?.hints || '').includes('[ALLOW_SKIP:true]');
      if (!allowSkip && (!cur || cur.answer === null)) return;
    }

    // Dokončení
    if (targetIdx >= _ai.totalSubtasks) {
      _ai.currentSubtask = _ai.totalSubtasks;
      saveProgress();
      // Skryj všechny kroky
      for (let i = 0; i < _ai.totalSubtasks; i++) {
        const el = document.getElementById(`ai-step-${i}`);
        if (el) el.classList.add('ai-step-hidden');
      }
      renderSummary();
      return;
    }

    const prevIdx = _ai.currentSubtask; // index před změnou
    _ai.currentSubtask = targetIdx;
    saveProgress();

    // Aktualizuj celkové body ve všech krocích — vždy zobrazuj aktuální součet
    for (let _i = 0; _i < _ai.totalSubtasks; _i++) {
        const _ptsEl = document.getElementById(`ai-total-pts-${_i}`);
        if (_ptsEl) _ptsEl.textContent = `${_ai.earnedPoints} / ${_ai.maxPoints} b`;
    }

    // Zešedi Další jen při pohybu VPŘED (ne při Zpět)
    if (targetIdx > prevIdx) {
      const currentNextBtn = document.getElementById(`ai-next-btn-${prevIdx}`);
      if (currentNextBtn) {
        currentNextBtn.disabled = true;
        currentNextBtn.style.opacity = '0.4';
        currentNextBtn.style.cursor = 'not-allowed';
      }
    }

    // Při návratu Zpět — ujisti se že tlačítko Další je odemčené
    if (targetIdx < prevIdx) {
      const h = _ai.subtaskHistory[targetIdx];
      const allowSkip = (_ai.scenario?.hints || '').includes('[ALLOW_SKIP:true]');
      // Odemkni pokud: skip povolen, nebo krok zodpovězen, nebo jdeme na krok odkud jsme přišli (prevIdx existuje v historii)
      // Odemkni Další jen pokud skip povolen, NEBO cílový krok už byl zodpovězen
      const targetAnswered = h?.answer !== null && h?.answer !== undefined;
      if (allowSkip || targetAnswered) {
        const nextBtn = document.getElementById(`ai-next-btn-${targetIdx}`);
        if (nextBtn) {
          nextBtn.removeAttribute('disabled');
          nextBtn.disabled = false;
          nextBtn.style.opacity = '1';
          nextBtn.style.cursor = 'pointer';
          nextBtn.style.pointerEvents = 'auto';
        }
      }
    }
    // Pokud krok ještě nebyl vygenerován — vygeneruj ho na pozadí (zůstáváme na předchozím)
    const needsGeneration = !_ai.subtaskHistory[targetIdx]?.question;
    if (needsGeneration) {
      window._aiGenerating = true;
      const _lockEls = ['submitBtn', 'stopBtn'].map(id => document.getElementById(id)).filter(Boolean);
      const _navBtns = document.querySelectorAll('[onclick*="goToSubtask"]');
      const _submitAnswerBtns = document.querySelectorAll('[id^="ai-submit-btn-"]');
      
      _lockEls.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; });
      _navBtns.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; });
      _submitAnswerBtns.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; });
      
      if (typeof showToast === 'function') showToast('Připravuji další úlohu…', false, true);

      await generateAndFillStep(targetIdx);

      if (typeof hideToast === 'function') hideToast();

      window._aiGenerating = false;
      
      // Odemkni navigační tlačítka správně podle pravidel
      const allowSkip = (_ai.scenario?.hints || '').includes('[ALLOW_SKIP:true]');
      document.querySelectorAll('[onclick*="goToSubtask"]').forEach(el => {
        const isNextBtn = el.id && el.id.startsWith('ai-next-btn-');
        let shouldBeUnlocked = true;
        if (isNextBtn) {
            const btnIdx = parseInt(el.id.replace('ai-next-btn-', ''), 10);
            const isAnswered = _ai.subtaskHistory[btnIdx] && _ai.subtaskHistory[btnIdx].answer !== null && _ai.subtaskHistory[btnIdx].answer !== undefined;
            if (!allowSkip && !isAnswered) {
                shouldBeUnlocked = false;
            }
        }
        if (shouldBeUnlocked) {
            el.removeAttribute('disabled'); el.disabled = false; el.style.opacity = '1'; el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer';
        } else {
            el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; el.style.cursor = 'not-allowed';
        }
      });

      // Odemkni tlačítka pro odeslání POUZE u úkolů, které ještě NEJSOU zodpovězeny
      document.querySelectorAll('[onclick*="submitAnswer"]').forEach(el => {
          const btnIdxMatch = el.id ? el.id.match(/ai-submit-btn-(\d+)/) : null;
          if (btnIdxMatch) {
              const btnIdx = parseInt(btnIdxMatch[1], 10);
              const isAnswered = _ai.subtaskHistory[btnIdx] && _ai.subtaskHistory[btnIdx].answer !== null;
              if (!isAnswered) {
                  el.disabled = false; el.style.opacity = '1'; el.style.pointerEvents = 'auto';
              } else {
                  el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none';
              }
          }
      });
      
      // Odemkni stopBtn (a submitBtn pro none-lab — tam není VM, na co čekat)
      const stopBtn = document.getElementById('stopBtn');
      if (stopBtn) { stopBtn.disabled = false; stopBtn.style.opacity = '1'; stopBtn.style.pointerEvents = 'auto'; }
      const isNoLabScenario = (_ai.scenario?.requiredOs || '') === 'none';
      if (isNoLabScenario) {
        const _subEl = document.getElementById('submitBtn');
        if (_subEl) { _subEl.disabled = false; _subEl.style.opacity = '1'; _subEl.style.pointerEvents = 'auto'; _subEl.style.cursor = 'pointer'; }
      }
    }

    // Teprve teď přepni zobrazení
    for (let i = 0; i < _ai.totalSubtasks; i++) {
      const el = document.getElementById(`ai-step-${i}`);
      if (el) el.classList.toggle('ai-step-hidden', i !== targetIdx);
    }

    setTimeout(() => {
      const el = document.getElementById(`ai-step-${targetIdx}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // POJISTKA: Pokud je úkol již zodpovězen, tlačítko odeslat MUSÍ být zamčené
      const history = _ai.subtaskHistory[targetIdx];
      if (history && history.answer !== null) {
          const subBtn = document.getElementById(`ai-submit-btn-${targetIdx}`);
          if (subBtn) {
              subBtn.disabled = true;
              subBtn.style.opacity = '0.4';
              subBtn.style.cursor = 'not-allowed';
              subBtn.style.pointerEvents = 'none';
          }
      }
    }, 50);
  }

  // ─── Souhrn ──────────────────────────────────────────────────────────────────
  function renderSummary() {
    window._aiSubmitConfirmed = false; // Reset potvrzení při každém novém souhrnu
    const container = getContainer();
    if (!container) return;

    // Odstraň wrapper aktivního podúkolu pokud existuje
    const wrapper = document.getElementById('ai-subtask-wrapper');
    if (wrapper) wrapper.remove();

    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'ai-summary-wrapper';
    summaryDiv.innerHTML = summaryHtml(_ai.subtaskHistory, _ai.earnedPoints, _ai.maxPoints);
    container.appendChild(summaryDiv);

    // Všechny otázky jsou dokončeny — odemkni tlačítko Odevzdat výsledek
    const submitEl = document.getElementById('submitBtn');
    if (submitEl) {
      submitEl.disabled = false;
      submitEl.style.backgroundColor = '';
      submitEl.style.borderColor = '';
      submitEl.style.color = '';
      submitEl.style.opacity = '1';
      submitEl.style.cursor = 'pointer';
      submitEl.style.pointerEvents = 'auto';
    }

    setTimeout(() => {
      const card = document.getElementById('ai-summary-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  // ─── Render obnovených podúkolů (po F5) ─────────────────────────────────────
  function renderRestoredHistory(container) {
    const completed = _ai.subtaskHistory.slice(0, _ai.currentSubtask).filter(h => h.answer !== null);
    if (completed.length === 0) return;

    const hist = document.createElement('div');
    hist.id = 'ai-history-section';

    const rows = completed.map((h, i) => {
      const pct = h.maxPoints > 0 ? Math.round((h.points / h.maxPoints) * 100) : 0;
      const barColor = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
      return `
        <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px 14px; margin-bottom:8px; background:var(--bg-status); opacity:0.85;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:4px;">
            <strong style="font-size:13px; color:var(--text-primary);">✔ Úkol ${i + 1}</strong>
            ${h.maxPoints > 0 ? `<span style="font-size:12px; color:${barColor}; font-weight:bold;">${h.points} / ${h.maxPoints} b</span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--text-muted);">${esc((h.answer || '').substring(0, 120))}${(h.answer || '').length > 120 ? '…' : ''}</div>
        </div>`;
    }).join('');

    hist.innerHTML = `
      <div style="margin:8px 0 0 0;">
        <strong style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Dokončené úkoly</strong>
        <div style="margin-top:6px;">${rows}</div>
      </div>`;
    container.appendChild(hist);
  }

  // ─── buildPayload — pro odevzdání ───────────────────────────────────────────
  function lockAiScenario() {
    // Zamkni všechny interaktivní prvky v AI scénáři po odevzdání
    const container = getContainer();
    if (!container) return;
    // Disable všechna tlačítka
    container.querySelectorAll('button').forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
    });
    // Disable všechny inputy a textarea
    container.querySelectorAll('input, textarea').forEach(el => {
      el.disabled = true;
      el.style.cursor = 'not-allowed';
    });
    // Disable radio buttony
    container.querySelectorAll('label').forEach(el => {
      el.style.pointerEvents = 'none';
      el.style.cursor = 'not-allowed';
    });
  }

  function buildAiPayload() {
    if (!_ai.isRunning || !_ai.subtaskHistory.length) return null;

    const lines = _ai.subtaskHistory.map((h, i) => {
      const pts = h.maxPoints > 0 ? ` [${h.points}/${h.maxPoints} b]` : '';
      const correctLine = h.correctAnswer ? `\nSprávná odpověď: ${h.correctAnswer}` : '';
      const cleanFeedback = (h.feedback || '').split(/\n---\n/)[0].replace(/^\s*---\s*Úkol\s+\d+[\s\S]*$/m, '').trim();
      return `Úkol ${i + 1}${pts}:\nOtázka: ${h.question || ''}\nOdpověď: ${h.answer || '(bez odpovědi)'}${correctLine}\nZpětná vazba AI: ${cleanFeedback}\n`;
    }).join('\n---\n');

    return `[AI_SCENARIO]\nCelkem bodů: ${_ai.earnedPoints} / ${_ai.maxPoints}\n\n${lines}`;
  }

  function buildAiStepDetails() {
    if (!_ai.subtaskHistory.length) return null;
    const steps = _ai.subtaskHistory.map((h, i) => ({
      step: i + 1,
      task_type: h.qtype || 'open',
      task_text: h.question || '',
      points_earned: h.points ?? 0,
      points_max: h.maxPoints ?? 0,
      answer: h.answer || '',
      feedback: (h.feedback || '').split(/\n---\n/)[0].replace(/^\s*---\s*Úkol\s+\d+[\s\S]*$/m, '').trim(),
      reasoning: h.reasoning || '',
    }));
    return JSON.stringify(steps);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ─── AI VZDĚLÁVÁNÍ (Education mode) ─────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  const _edu = {
    scenarioId: null,
    attemptId: null,
    scenario: null,
    topics: [],
    currentTopicIdx: 0,
    currentPhase: 'explaining', // explaining | verifying | summary
    topicHistory: [],
    totalScore: 0,
    totalMaxScore: 0,
    isRunning: false,
    isLocked: false,
    _drafts: null,
    // Config parsed from hints
    verifyQ: 2,
    threshold: 75,
    maxRepeats: 3,
    verifyQtypes: 'combined',
    explainStyle: 'adaptive',
    presentation: 'combined',
  };

  function eduProgressKey() {
    return `ai_edu_${_edu.scenarioId}_${_edu.attemptId}`;
  }

  function _captureEduDrafts() {
    const drafts = {};
    document.querySelectorAll('#ai-scenario-container textarea, #ai-scenario-container input[type="text"]').forEach(el => {
      if (el.id && el.value && !el.disabled) drafts[el.id] = el.value;
    });
    return Object.keys(drafts).length ? drafts : null;
  }

  function eduSaveProgress() {
    if (!_edu.scenarioId || !_edu.attemptId) return;
    const _drafts = _captureEduDrafts();
    const stateJson = JSON.stringify({
      currentTopicIdx: _edu.currentTopicIdx,
      currentPhase: _edu.currentPhase,
      topicHistory: _edu.topicHistory,
      totalScore: _edu.totalScore,
      totalMaxScore: _edu.totalMaxScore,
      _drafts,
    });
    localStorage.setItem(eduProgressKey(), stateJson);
    // Zapsat i do ai_scenario_* klíče — pauseScenario() čte odtud a posílá backendu
    localStorage.setItem(`ai_scenario_${_edu.scenarioId}_${_edu.attemptId}`, stateJson);
    _saveToBackendNow(_edu.attemptId, stateJson);
  }

  function eduLoadProgress() {
    const raw = localStorage.getItem(eduProgressKey());
    if (!raw) return false;
    try {
      const p = JSON.parse(raw);
      _edu.currentTopicIdx = p.currentTopicIdx ?? 0;
      _edu.currentPhase    = p.currentPhase ?? 'explaining';
      _edu.topicHistory    = p.topicHistory ?? [];
      _edu.totalScore      = p.totalScore ?? 0;
      _edu.totalMaxScore   = p.totalMaxScore ?? 0;
      _edu._drafts         = p._drafts || null;
      return true;
    } catch { return false; }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────

  function eduEsc(v) { return esc(v); }

  function ensureEduStyles() {
    if (document.getElementById('edu-render-styles')) return;
    const s = document.createElement('style');
    s.id = 'edu-render-styles';
    s.textContent = `
      @keyframes eduPillPulse {
        0%,100% { outline-width:2px; outline-offset:2px; box-shadow:0 0 0 0 rgba(59,130,246,0); }
        50%      { outline-width:2px; outline-offset:3px; box-shadow:0 0 0 4px rgba(59,130,246,0.2); }
      }
      .edu-pill-active { animation: eduPillPulse 1.8s ease-in-out infinite !important; }
    `;
    document.head.appendChild(s);
  }

  function ensureMathJax() {
    if (window.MathJax?.typesetPromise) return Promise.resolve();
    if (window._mathJaxLoading) return window._mathJaxLoading;
    window.MathJax = {
      tex: { inlineMath: [['\\(','\\)']], displayMath: [['\\[','\\]']] },
      options: { skipHtmlTags: ['script','noscript','style','textarea','pre','code'] },
    };
    window._mathJaxLoading = new Promise(resolve => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
      sc.async = true;
      sc.onload = resolve;
      sc.onerror = resolve;
      document.head.appendChild(sc);
    });
    return window._mathJaxLoading;
  }

  function renderEduProgressBar() {
    ensureEduStyles();
    const total = _edu.topics.length;
    const done  = _edu.topicHistory.filter(h => h.mastered || h.skipped).length;
    const pct   = total > 0 ? Math.round(done / total * 100) : 0;
    const pills = _edu.topics.map((t, i) => {
      const hist  = _edu.topicHistory[i];
      const isCur = i === _edu.currentTopicIdx && _edu.currentPhase !== 'summary';
      const bg    = !hist ? 'var(--bg-status)' : hist.skipped ? '#fbbf24' : hist.mastered ? '#10b981' : '#3b82f6';
      const fg    = !hist ? 'var(--text-muted)' : '#fff';
      const label = eduEsc(t.length > 14 ? t.slice(0, 13) + '…' : t);
      return `<div title="${eduEsc(t)}"${isCur ? ' class="edu-pill-active"' : ''} style="flex:1;min-width:0;padding:4px 8px;border-radius:999px;background:${bg};color:${fg};font-size:10px;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;transition:background 0.3s;${isCur ? 'outline:2px solid #3b82f6;outline-offset:2px;' : ''}">${label}</div>`;
    }).join('');
    return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px;">
          <span>Průběh: <strong style="color:var(--text-primary);">${done} / ${total} témat</strong></span>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">${pills}</div>
        <div style="background:var(--bg-status);border-radius:4px;height:4px;overflow:hidden;">
          <div style="background:#3b82f6;height:100%;width:${pct}%;transition:width 0.5s ease;border-radius:4px;"></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);text-align:right;margin-top:3px;">${pct}% dokončeno</div>
      </div>`;
  }

  function renderEduContainer() {
    const existing = getContainer();
    if (existing) return existing;
    const detailEl = document.getElementById('scenarioDetail');
    if (!detailEl) return null;
    const div = document.createElement('div');
    div.id = 'ai-scenario-container';
    div.style.marginTop = '0';
    detailEl.appendChild(div);
    return div;
  }

  function setEduHtml(html) {
    const c = renderEduContainer();
    if (c) c.innerHTML = html;
  }

  // ─── AI calls for education mode ─────────────────────────────────────────────

  async function generateEduExplanation(topic, attemptNum, weakResults) {
    const s = _edu.scenario;
    const instructionsText = s.instructions || '';
    const personaMatch = instructionsText.match(/OSOBNOST MENTORA:\s*([\s\S]*?)(?:\n\n|$)/);
    const persona = personaMatch ? personaMatch[1].trim() : 'Jsi AI tutor.';

    const presentationInstr = {
      flowing:    'Vysvětli v plynulém textu 3–5 odstavců.',
      structured: 'Vysvětli ve strukturovaných sekcích s nadpisy (použij markdown ## pro nadpisy).',
      combined:   'Začni stručným úvodem, pak přejdi na strukturované sekce s příklady.',
    }[_edu.presentation] || 'Vysvětli téma srozumitelně.';

    const styleInstr = {
      analogy:   'Každý složitý pojem vysvětli pomocí analogie z reálného světa.',
      technical: 'Vysvětluj technicky přesně, používej odbornou terminologii.',
      code:      'Uváděj konkrétní příklady kódu nebo příkazů vždy, kdy je to relevantní.',
      adaptive:  'Přizpůsob styl tématu — pro abstraktní koncepty analogie, pro technická témata příklady kódu.',
    }[_edu.explainStyle] || '';

    let retryInstr = '';
    if (attemptNum > 0) {
      const weakPart = (weakResults && weakResults.length > 0)
        ? '\n\nCO STUDENT NEZVLÁDL — zaměř výklad PŘESNĚ na tato slabá místa:\n'
          + weakResults.map((r, i) =>
            `Otázka ${i + 1}: ${r.question}\nStudentova odpověď: ${r.answer}\nZpětná vazba z předchozího hodnocení: ${r.feedback}`
          ).join('\n\n')
        : '';
      retryInstr = `Student toto téma zatím nepochopil (pokus č. ${attemptNum + 1}). Vysvětli JINAK a CÍLENĚ — použij jiné analogie, příklady nebo úhel pohledu. Neopakuj předchozí výklad doslova.${weakPart}`;
    }

    const materialsPart = _materialsContent
      ? `\nSTUDIJNÍ MATERIÁL:\n${_materialsContent.substring(0, 6000)}`
      : '';

    const system = `${persona} Odpovídáš vždy česky.
Jsi tutor pro vzdělávací modul. Tvým úkolem je vysvětlit jedno konkrétní téma studentovi.
${presentationInstr}
${styleInstr}
${retryInstr}
Délka: přibližně 150–400 slov. Konči shrnutím v 1–2 větách.
Nepiš uvítací fráze jako "Ahoj!" ani "Samozřejmě!". Rovnou začni vysvětlením.`;

    const user = `VZDĚLÁVACÍ MODUL: "${s.title}"
TÉMA K VYSVĚTLENÍ: "${topic}"
CELKOVÝ KONTEXT MODULU: "${s.description || ''}"${materialsPart}`;

    return await callAI(system, user);
  }

  async function generateEduQuestion(topic, questionIdx, totalQ, existingQs) {
    const s = _edu.scenario;
    const instructionsText = s.instructions || '';
    const personaMatch = instructionsText.match(/OSOBNOST MENTORA:\s*([\s\S]*?)(?:\n\n|$)/);
    const persona = personaMatch ? personaMatch[1].trim() : 'Jsi AI tutor.';

    const noRepeat = existingQs.length > 0
      ? `\nUŽ POUŽITÉ OTÁZKY (neopakuj):\n${existingQs.map((q, i) => `${i+1}. "${q}"`).join('\n')}\n`
      : '';

    const materialsPart = _materialsContent
      ? `\nREFERENČNÍ MATERIÁL:\n${_materialsContent.substring(0, 4000)}`
      : '';

    const system = `${persona} Odpovídáš vždy česky.
Jsi tutor. Vytváříš ověřovací otázku číslo ${questionIdx + 1} z ${totalQ} pro TÉMA: "${topic}".
Polož OTEVŘENOU otázku, na kterou student odpoví vlastními slovy (1–3 věty).
Vrať POUZE samotné znění otázky — žádný nadpis, žádné uvozovky.
Otázka musí přímo ověřovat pochopení tématu "${topic}".`;

    const user = `VZDĚLÁVACÍ MODUL: "${s.title}"
TÉMA: "${topic}"${noRepeat}${materialsPart}`;

    return await callAI(system, user);
  }

  async function evaluateEduAnswer(topic, question, answer, maxPts) {
    const s = _edu.scenario;
    const instructionsText = s.instructions || '';
    const personaMatch = instructionsText.match(/OSOBNOST MENTORA:\s*([\s\S]*?)(?:\n\n|$)/);
    const persona = personaMatch ? personaMatch[1].trim() : 'Jsi přísný ale spravedlivý tutor.';

    const materialsPart = _materialsContent
      ? `\nREFERENČNÍ MATERIÁL:\n${_materialsContent.substring(0, 3000)}`
      : '';

    const system = `${persona} Odpovídáš vždy česky.
Ohodnoť odpověď studenta na ověřovací otázku z tématu "${topic}".
PRAVIDLA:
- Hodnoť POCHOPENÍ PODSTATY, ne délku ani formální úplnost. Krátká odpověď, která zachytí klíčový koncept, může dostat plný počet bodů.
- Prázdná odpověď nebo "nevím" = 0 bodů.
- Odpověď zachycující podstatu správně = vysoké body (80–100), i když je stručná.
- Odpověď s částečným pochopením = střední body (40–70).
- Věcně nesprávná odpověď = nízké body (0–30).
- Feedback piš na 1–2 věty, konstruktivně. NEZOBRAZUJ správnou odpověď v poli "feedback" — uveď ji v "correct_answer".
- Body zadávej přesně na celé číslo — např. 73, 85, 42. NEZAOKROUHLUJ na desítky (70, 80, 90). Každá odpověď si zaslouží přesné hodnocení.
Vrať POUZE validní JSON:
{"points":<0–100>,"reasoning":"<1 věta pro učitele>","feedback":"<1–2 věty pro studenta>","correct_answer":"<správná odpověď>","explanation":"<proč je to správně, nebo null>"}`;

    const user = `TÉMA: "${topic}"
OTÁZKA: "${question}"
ODPOVĚĎ STUDENTA: "${answer}"
MAXIMUM BODŮ: ${maxPts}${materialsPart}`;

    return await callAIEval(system, user, maxPts);
  }

  // ─── Main education flow ─────────────────────────────────────────────────────

  async function initEduMode(scenario, latestAttempt, state) {
    _edu.scenario   = scenario;
    _edu.scenarioId = scenario.scenarioId;
    _edu.attemptId  = latestAttempt?.attemptId || null;
    _edu.isRunning  = true;
    window.aiScenario._eduStop = () => { _edu.isRunning = false; };
    window._eduSummaryActive = false;

    const hints = scenario.hints || '';
    const topicsRaw = getTag(hints, 'TOPICS') || '';
    _edu.topics = topicsRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (_edu.topics.length === 0) _edu.topics = ['Obecné téma'];
    _edu.verifyQ     = parseInt(getTag(hints, 'VERIFY_Q') || '2', 10) || 2;
    _edu.threshold   = parseInt(getTag(hints, 'THRESHOLD') || '75', 10) || 75;
    _edu.maxRepeats  = parseInt(getTag(hints, 'MAX_REPEATS') || '3', 10) || 3;
    _edu.verifyQtypes = getTag(hints, 'VERIFY_QTYPES') || 'combined';
    _edu.explainStyle = getTag(hints, 'EXPLAIN_STYLE') || 'adaptive';
    _edu.presentation = getTag(hints, 'PRESENTATION') || 'combined';

    // Override saveProgress — deleguje na eduSaveProgress (ukládá full stav + drafty do LS i backendu)
    window.aiScenario.saveProgress = eduSaveProgress;

    // Auto-save drafts on input (debounced 800 ms)
    const _eduInputTarget = document.getElementById('ai-scenario-container');
    if (_eduInputTarget && !_eduInputTarget._hasEduInputListener) {
      _eduInputTarget._hasEduInputListener = true;
      _eduInputTarget.addEventListener('input', function(e) {
        if (!_edu.isRunning) return;
        if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
          clearTimeout(_eduInputTarget._eduDraftTimer);
          _eduInputTarget._eduDraftTimer = setTimeout(eduSaveProgress, 800);
        }
      }, { passive: true });
    }

    // Expose edu state as _state for student-submit.js compatibility
    Object.defineProperty(window.aiScenario, '_state', {
      get: () => {
        const qHistory = [];
        _edu.topicHistory.forEach((hist, ti) => {
          (hist.qHistory || []).forEach(q => {
            qHistory.push({
              question: `[${_edu.topics[ti] || ''}] ${q.question || ''}`,
              answer: q.answer || '',
              points: q.points ?? 0,
              maxPoints: q.maxPoints ?? 0,
              feedback: q.feedback || '',
              qtype: q.qtype || 'open',
              intro: _edu.topics[ti] || '',
              reasoning: '',
            });
          });
        });
        return {
          earnedPoints:   _edu.totalScore,
          maxPoints:      _edu.totalMaxScore,
          subtaskHistory: qHistory,
        };
      },
      configurable: true,
    });

    // Ensure exercise-mode hook doesn't block edu submission
    _ai.totalSubtasks = 0;
    window._aiSubmitConfirmed = true;

    const isSubmittedOrEvaluated = state === 'submitted' || state === 'evaluated';
    if (isSubmittedOrEvaluated || !latestAttempt) {
      setEduHtml('');
      _edu.isRunning = false;
      return;
    }

    _materialsContent = '';
    await loadMaterialsContent(scenario.scenarioTemplateId);

    // Sync backend state to localStorage before loading progress (F5 recovery)
    const _backendEduState = latestAttempt?.pausedAiState;
    if (_backendEduState && _edu.attemptId) {
      try { localStorage.setItem(eduProgressKey(), _backendEduState); } catch {}
    }

    const restored = _edu.attemptId ? eduLoadProgress() : false;

    console.log('[EDU_RESTORE] currentTopicIdx:', _edu.currentTopicIdx, 'phase:', _edu.currentPhase, 'restored:', restored, 'backendState:', !!_backendEduState, 'topicHistory:', JSON.stringify((_edu.topicHistory || []).map((h, i) => ({ i, mastered: h.mastered, skipped: h.skipped, repeats: h.repeats, answersLen: (h.answers || []).length }))));

    if (restored && _edu.currentPhase === 'summary') {
      renderEduSummaryView();
      setTimeout(() => _registerAiSubmitHook(), 0);
      return;
    }

    if (restored && _edu.currentTopicIdx >= _edu.topics.length) {
      _edu.currentPhase = 'summary';
      renderEduSummaryView();
      setTimeout(() => _registerAiSubmitHook(), 0);
      return;
    }

    await renderEduPhase();

    // Obnov draft odpovědi po pozastavení / F5 (stav načtený z backendu nebo LS)
    if (_edu._drafts) {
      Object.entries(_edu._drafts).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el && !el.disabled) el.value = val;
      });
      _edu._drafts = null; // spotřebováno
    }

    // Odblokuj tlačítka po dokončení načítání
    if (window._resumeLoadingActive) {
        window._resumeLoadingActive = false;
        const _pauseBtnE = document.getElementById("pauseBtn");
        if (_pauseBtnE && _pauseBtnE.style.display !== "none") {
            _pauseBtnE.disabled = false;
            _pauseBtnE.style.opacity = "";
            _pauseBtnE.style.cursor = "";
            _pauseBtnE.style.pointerEvents = "auto";
        }
    }

    setTimeout(() => _registerAiSubmitHook(), 0);
  }

  async function renderEduPhase() {
    const topicIdx  = _edu.currentTopicIdx;
    const topic     = _edu.topics[topicIdx];
    const hist      = _edu.topicHistory[topicIdx] || { explanations: [], questions: [], answers: [], scores: [], repeats: 0, mastered: false, skipped: false, qHistory: [], pointsEarned: 0, pointsMax: 0 };
    _edu.topicHistory[topicIdx] = hist;

    if (_edu.currentPhase === 'explaining') {
      await renderEduExplainingPhase(topicIdx, topic, hist);
    } else if (_edu.currentPhase === 'verifying') {
      await renderEduVerifyingPhase(topicIdx, topic, hist);
    } else if (_edu.currentPhase === 'summary') {
      renderEduSummaryView();
    }
  }

  async function renderEduExplainingPhase(topicIdx, topic, hist) {
    const container = renderEduContainer();
    if (!container) return;

    const attemptNum = hist.repeats;

    if (!hist.explanations) hist.explanations = [];
    let explanationText = hist.explanations[attemptNum];

    if (!explanationText) {
      // Show loading spinner only when generating a new explanation
      container.innerHTML = `
        ${renderEduProgressBar()}
        <div style="border:1px solid var(--border-color); border-radius:12px; background:var(--bg-panel); padding:20px; margin:12px 0;">
          <div style="font-size:13px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
            Téma ${topicIdx + 1} / ${_edu.topics.length}${attemptNum > 0 ? ` · Opakování ${attemptNum + 1}` : ''}
          </div>
          <div style="font-size:18px; font-weight:700; color:var(--text-primary); margin-bottom:16px;">${eduEsc(topic)}</div>
          <div style="display:flex; align-items:center; gap:10px; padding:14px; background:var(--bg-status); border-radius:8px;">
            <div class="ai-spinner"></div>
            <span style="color:var(--text-muted); font-size:14px;">${attemptNum > 0 ? 'Připravuji nové vysvětlení…' : 'Připravuji výklad…'}</span>
          </div>
        </div>`;

      // Collect weak results from previous attempt for adaptive re-explanation
      let _weakResults = [];
      if (attemptNum > 0) {
        const _prevNum    = attemptNum - 1;
        const _prevOffset = hist.questions.slice(0, _prevNum).reduce((s, a) => s + a.length, 0);
        const _prevCount  = (hist.questions[_prevNum] || []).length;
        const _prevAll    = (hist.qHistory || []).slice(_prevOffset, _prevOffset + _prevCount);
        _weakResults = _prevAll.filter(r => {
          const pct = (r.maxPoints || 100) > 0 ? Math.round((r.points || 0) / (r.maxPoints || 100) * 100) : 0;
          return pct < 71;
        });
        if (_weakResults.length === 0) _weakResults = _prevAll;
      }

      try {
        explanationText = await generateEduExplanation(topic, attemptNum, _weakResults);
      } catch (e) {
        explanationText = `Výklad se nepodařilo načíst (chyba AI). Zkuste stránku obnovit nebo pokračujte na další téma.`;
      }

      hist.explanations[attemptNum] = explanationText;
      eduSaveProgress();
    }

    // Format explanation — section cards, bullet lists, MathJax-safe
    const formatInline = t => t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

    const formatLines = raw => {
      const lines = raw.split('\n');
      let out = '', inList = false;
      for (const line of lines) {
        const tr = line.trim();
        if (!tr) {
          if (inList) { out += '</ul>'; inList = false; }
          out += '<br>';
        } else if (tr.startsWith('### ')) {
          if (inList) { out += '</ul>'; inList = false; }
          out += `<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin:8px 0 4px;">${formatInline(esc(tr.slice(4)))}</div>`;
        } else if (/^[-*] /.test(tr)) {
          if (!inList) { out += '<ul style="list-style:none;padding:0;margin:6px 0;">'; inList = true; }
          out += `<li style="padding:3px 0 3px 18px;position:relative;line-height:1.65;"><span style="position:absolute;left:0;color:#3b82f6;font-weight:bold;">›</span>${formatInline(esc(tr.slice(2)))}</li>`;
        } else {
          if (inList) { out += '</ul>'; inList = false; }
          out += `<span style="display:block;margin:2px 0;">${formatInline(esc(tr))}</span>`;
        }
      }
      if (inList) out += '</ul>';
      return out;
    };

    const formatEduText = (text) => {
      // Protect code blocks
      const codeBlocks = [];
      let t = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre style="background:var(--bg-status);border:1px solid var(--border-color);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:13px;margin:10px 0;font-family:monospace;"><code>${esc(code.trim())}</code></pre>`);
        return `\x01C${idx}\x01`;
      });
      // Protect math delimiters so they survive HTML escaping inside formatLines
      const mathBlocks = [];
      const escapeMath = m => m.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      t = t
        .replace(/\\\[[\s\S]*?\\\]/g, m => { const i = mathBlocks.length; mathBlocks.push(escapeMath(m)); return `\x01M${i}\x01`; })
        .replace(/\\\([\s\S]*?\\\)/g, m => { const i = mathBlocks.length; mathBlocks.push(escapeMath(m)); return `\x01M${i}\x01`; });

      // Split by ## sections and build card layout
      const secColors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4'];
      const parts = t.split(/(^## .+$)/m);
      let html = '';
      let secIdx = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (/^## /.test(part)) {
          const heading = part.replace(/^## /, '').trim();
          const col = secColors[secIdx++ % secColors.length];
          const content = parts[++i] || '';
          html += `<div style="border-left:3px solid ${col};background:${col}18;border-radius:0 8px 8px 0;padding:12px 16px;margin:12px 0;">` +
            `<div style="font-size:14px;font-weight:700;color:${col};margin-bottom:8px;">${formatInline(esc(heading))}</div>` +
            `<div style="font-size:14px;line-height:1.75;color:var(--text-primary);">${formatLines(content)}</div></div>`;
        } else if (part.trim()) {
          html += `<div style="font-size:15px;line-height:1.8;color:var(--text-primary);margin-bottom:12px;">${formatLines(part)}</div>`;
        }
      }

      // Restore code and math placeholders
      return html
        .replace(/\x01C(\d+)\x01/g, (_, i) => codeBlocks[+i])
        .replace(/\x01M(\d+)\x01/g, (_, i) => mathBlocks[+i]);
    };

    const retryBadge = attemptNum > 0
      ? `<div style="display:inline-block; background:#fef3c7; color:#92400e; border:1px solid #fcd34d; border-radius:6px; padding:3px 10px; font-size:12px; font-weight:bold; margin-bottom:12px;">Opakované vysvětlení (pokus ${attemptNum + 1})</div>`
      : '';

    container.innerHTML = `
      ${renderEduProgressBar()}
      <div style="border:2px solid #3b82f6; border-radius:12px; background:var(--bg-panel); padding:20px; margin:12px 0;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">
          Téma ${topicIdx + 1} / ${_edu.topics.length}
        </div>
        <div style="font-size:20px; font-weight:800; color:var(--text-primary); margin-bottom:12px;">${eduEsc(topic)}</div>
        ${retryBadge}
        <div style="margin-bottom:20px;">
          ${formatEduText(explanationText)}
        </div>
        <div style="border-top:1px solid var(--border-color); padding-top:16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <button onclick="window._eduStartVerification()"
                  style="background:var(--btn-primary,#3b82f6); color:#fff; padding:10px 24px;
                         font-size:14px; border-radius:8px; border:none; cursor:pointer; font-weight:bold;">
            Ověřit mé znalosti tématu
          </button>
        </div>
      </div>`;

    ensureMathJax().then(() => {
      if (window.MathJax?.typesetPromise) MathJax.typesetPromise([container]).catch(() => {});
    });

    // Prefetch ověřovacích otázek na pozadí — student čte výklad, otázky se generují
    if (!hist.questions[attemptNum]) {
      const _usedQs = hist.questions.flat();
      const _prefetched = [];
      (async () => {
        for (let qi = 0; qi < _edu.verifyQ; qi++) {
          try {
            const q = await generateEduQuestion(topic, qi, _edu.verifyQ, _usedQs.concat(_prefetched));
            _prefetched.push(q);
          } catch {
            _prefetched.push(`Otázka ${qi + 1}: Co je nejdůležitější aspekt tématu "${topic}"?`);
          }
        }
        if (!hist.questions[attemptNum]) {
          hist.questions[attemptNum] = _prefetched;
          eduSaveProgress();
        }
      })();
    }

    window._eduStartVerification = async function() {
      _edu.currentPhase = 'verifying';
      eduSaveProgress();
      await renderEduPhase();
    };
  }

  async function renderEduVerifyingPhase(topicIdx, topic, hist) {
    const container = renderEduContainer();
    if (!container) return;
    const attemptNum = hist.repeats;

    // Show loading for questions
    container.innerHTML = `
      ${renderEduProgressBar()}
      <div style="border:1px solid var(--border-color); border-radius:12px; background:var(--bg-panel); padding:20px; margin:12px 0;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">
          Ověření: ${eduEsc(topic)}
        </div>
        <div style="display:flex; align-items:center; gap:10px; padding:14px; background:var(--bg-status); border-radius:8px; margin-top:8px;">
          <div class="ai-spinner"></div>
          <span style="color:var(--text-muted); font-size:14px;">Připravuji ověřovací otázky…</span>
        </div>
      </div>`;

    // Generate questions (reuse cached ones if this is a re-render of same attempt)
    const attemptQs = hist.questions[attemptNum] || [];
    const questions = [];
    const usedQs = hist.questions.flat(); // avoid repeating from previous attempts

    for (let qi = 0; qi < _edu.verifyQ; qi++) {
      if (attemptQs[qi]) {
        questions.push(attemptQs[qi]);
      } else {
        try {
          const q = await generateEduQuestion(topic, qi, _edu.verifyQ, usedQs.concat(questions));
          questions.push(q);
        } catch {
          questions.push(`Otázka ${qi + 1}: Co je nejdůležitější aspekt tématu "${topic}"?`);
        }
      }
    }

    if (!hist.questions[attemptNum]) {
      hist.questions[attemptNum] = questions;
      eduSaveProgress();
    }

    // Render questions (all open-ended)
    const questionsHtml = questions.map((q, qi) => `
      <div style="border:1px solid var(--border-color); border-radius:8px; padding:16px; margin-bottom:12px; background:var(--bg-status);">
        <div style="font-size:12px; font-weight:bold; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">
          Otázka ${qi + 1} / ${questions.length}
        </div>
        <div style="font-size:15px; color:var(--text-primary); line-height:1.7;">${esc(q).replace(/\n/g, '<br>')}</div>
        <textarea id="edu-answer-${qi}" rows="3"
                  placeholder="Napište svou odpověď…"
                  style="width:100%; margin-top:8px; resize:vertical; box-sizing:border-box; font-size:14px;
                         background:var(--bg-status); border:2px solid var(--border-color); border-radius:8px;
                         padding:10px 12px; color:var(--text-primary); outline:none;"
                  onfocus="this.style.borderColor='#3b82f6'"
                  onblur="this.style.borderColor='var(--border-color)'"></textarea>
        <div id="edu-qfeedback-${qi}" style="min-height:0; margin-top:0;"></div>
      </div>`).join('');

    container.innerHTML = `
      ${renderEduProgressBar()}
      <div style="border:2px solid var(--border-color); border-radius:12px; background:var(--bg-panel); padding:20px; margin:12px 0;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">
          Ověření znalostí: ${eduEsc(topic)}
        </div>
        <div style="font-size:16px; font-weight:700; color:var(--text-primary); margin-bottom:16px;">
          Zodpovězte ${questions.length === 1 ? '1 otázku' : questions.length < 5 ? `${questions.length} otázky` : `${questions.length} otázek`}
        </div>
        ${questionsHtml}
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:4px;">
          <button id="edu-submit-verify-btn" onclick="window._eduSubmitVerification(${topicIdx}, ${attemptNum})"
                  style="background:#10b981; color:#fff; padding:10px 24px; font-size:14px; border-radius:8px; border:none; cursor:pointer; font-weight:bold;">
            Odeslat odpovědi
          </button>
          <span id="edu-verify-status" style="font-size:13px; color:var(--text-muted);"></span>
        </div>
      </div>`;

    function _renderEduTopicSummary(scoresPct, mastered, canRetry) {
      const _sumCol    = scoresPct >= 71 ? '#10b981' : scoresPct >= 51 ? '#f59e0b' : '#ef4444';
      const _sumBg     = scoresPct >= 71 ? 'rgba(16,185,129,0.1)' : scoresPct >= 51 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';
      const _sumBorder = scoresPct >= 71 ? 'rgba(16,185,129,0.4)' : scoresPct >= 51 ? 'rgba(245,158,11,0.4)' : 'rgba(239,68,68,0.4)';
      const _subText = mastered
        ? '<div style="font-size:13px; color:#10b981; margin-top:6px;">Výborně! Tématu „' + eduEsc(topic) + '" rozumíte na ' + scoresPct + ' %, můžete přejít na další téma.</div>'
        : canRetry
        ? '<div style="font-size:13px; color:#f59e0b; margin-top:6px;">Téma bude znovu vysvětleno.</div>'
        : '<div style="font-size:13px; color:#ef4444; margin-top:6px;">Téma si doporučuji projít individuálně.</div>';
      const passBadge = '<div style="text-align:center; padding:16px; background:' + _sumBg + '; border:1px solid ' + _sumBorder + '; border-radius:8px; margin-top:16px;">'
        + '<div style="font-size:15px; font-weight:bold; color:' + _sumCol + ';">Tématu „' + eduEsc(topic) + '" rozumíte přibližně na ' + scoresPct + ' %</div>'
        + _subText
        + '</div>';
      const nextBtnLabel = mastered || !canRetry
        ? (_edu.currentTopicIdx + 1 >= _edu.topics.length ? 'Zobrazit výsledky' : 'Přejít na další téma →')
        : 'Zkusit znovu (nové vysvětlení)';
      const nextBtnColor = mastered ? '#10b981' : canRetry ? '#f59e0b' : '#ef4444';
      const nextBtn = document.getElementById('edu-submit-verify-btn');
      if (nextBtn) {
        nextBtn.textContent = nextBtnLabel;
        nextBtn.style.background = nextBtnColor;
        nextBtn.style.opacity = '1';
        nextBtn.disabled = false;
        nextBtn.onclick = async function() {
          if (mastered || !canRetry) {
            _edu.currentTopicIdx++;
            if (_edu.currentTopicIdx >= _edu.topics.length) {
              _edu.currentPhase = 'summary';
            } else {
              _edu.currentPhase = 'explaining';
            }
          } else {
            hist.repeats++;
            _edu.currentPhase = 'explaining';
          }
          eduSaveProgress();
          await renderEduPhase();
        };
      }
      const verifyDiv = document.getElementById('edu-submit-verify-btn') && document.getElementById('edu-submit-verify-btn').parentElement;
      if (verifyDiv) verifyDiv.insertAdjacentHTML('beforebegin', passBadge);
    }

    function _showEduResults(cachedResults, scoresPct, mastered, canRetry) {
      cachedResults.forEach(function(result, qi) {
        const inp = document.getElementById('edu-answer-' + qi);
        if (inp) { inp.disabled = true; inp.value = result.answer || ''; }
        document.querySelectorAll('input[name="edu-q-' + qi + '"]').forEach(function(r) { r.disabled = true; });
        const fbEl = document.getElementById('edu-qfeedback-' + qi);
        if (fbEl) {
          const pct = Math.round((result.points || 0) / (result.maxPoints || 100) * 100);
          const col = pct >= 71 ? '#10b981' : pct >= 51 ? '#f59e0b' : '#ef4444';
          fbEl.style.marginTop = '10px';
          fbEl.innerHTML = '<div style="padding:10px 12px; background:var(--bg-panel); border-left:3px solid ' + col + '; border-radius:0 6px 6px 0; font-size:13px; color:var(--text-primary); line-height:1.6;">' + eduEsc(result.feedback || '') + '</div>';
        }
      });
      _renderEduTopicSummary(scoresPct, mastered, canRetry);
    }

    window._eduSubmitVerification = async function(tIdx, aNum, _cachedResults) {
      const btn = document.getElementById('edu-submit-verify-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

      const qs = hist.questions[aNum] || [];
      const maxPtsEach = 100;

      if (_cachedResults && _cachedResults.length > 0) {
        const _cEarned = _cachedResults.reduce(function(s, r) { return s + (r.points || 0); }, 0);
        const _cMax    = _cachedResults.reduce(function(s, r) { return s + (r.maxPoints || 100); }, 0);
        const _cPct    = _cMax > 0 ? Math.round(_cEarned / _cMax * 100) : 0;
        const _cAnyFailed = _cachedResults.some(r => (r.maxPoints > 0 ? r.points / r.maxPoints : 0) < 0.5);
        const _cMaster = !_cAnyFailed && _cPct >= _edu.threshold;
        const _cRetry  = !_cMaster && hist.repeats < _edu.maxRepeats - 1;
        _showEduResults(_cachedResults, _cPct, _cMaster, _cRetry);
        return;
      }

      let topicEarned = 0, topicMax = 0;
      const qResults = [];

      for (let qi = 0; qi < qs.length; qi++) {
        showPageMessage('Hodnotím odpověď k ' + (qi + 1) + '. otázce…', 'info');
        const ansEl = document.getElementById('edu-answer-' + qi);
        let answer = ansEl ? ansEl.value.trim() : '';
        if (!answer) answer = '(bez odpovědi)';

        let result;
        try {
          result = await evaluateEduAnswer(topic, qs[qi], answer, maxPtsEach);
        } catch {
          result = { points: 0, feedback: 'Chyba hodnocení.', correct_answer: null };
        }

        topicEarned += result.points || 0;
        topicMax    += maxPtsEach;
        qResults.push({ question: qs[qi], answer: answer, points: result.points || 0, maxPoints: maxPtsEach, feedback: result.feedback || '', correct_answer: result.correct_answer || null, qtype: 'open' });

        const fbEl = document.getElementById('edu-qfeedback-' + qi);
        if (fbEl) {
          const pct = Math.round((result.points || 0) / maxPtsEach * 100);
          const col = pct >= 71 ? '#10b981' : pct >= 51 ? '#f59e0b' : '#ef4444';
          fbEl.style.marginTop = '10px';
          fbEl.innerHTML = '<div style="padding:10px 12px; background:var(--bg-panel); border-left:3px solid ' + col + '; border-radius:0 6px 6px 0; font-size:13px; color:var(--text-primary); line-height:1.6;">' + eduEsc(result.feedback || '') + '</div>';
        }
        const inp = document.getElementById('edu-answer-' + qi);
        if (inp) { inp.disabled = true; }
        document.querySelectorAll('input[name="edu-q-' + qi + '"]').forEach(function(r) { r.disabled = true; });
      }

      clearPageMessage();

      if (!hist.qHistory) hist.qHistory = [];
      qResults.forEach(function(r) { hist.qHistory.push(r); });

      const scoresPct = topicMax > 0 ? Math.round(topicEarned / topicMax * 100) : 0;
      if (!hist.scores) hist.scores = [];
      hist.scores.push(scoresPct);
      if (!hist.answers) hist.answers = [];
      hist.answers[aNum] = qResults.map(function(r) { return r.answer; });

      const anyFailed = qResults.some(r => (r.maxPoints > 0 ? r.points / r.maxPoints : 0) < 0.5);
      const mastered = !anyFailed && scoresPct >= _edu.threshold;
      const canRetry = !mastered && hist.repeats < _edu.maxRepeats - 1;

      hist.pointsEarned = (hist.pointsEarned || 0) + topicEarned;
      hist.pointsMax    = topicMax;
      _edu.totalScore    += topicEarned;
      _edu.totalMaxScore += topicMax;

      if (mastered || !canRetry) {
        hist.mastered = mastered;
        hist.skipped  = !mastered;
      }

      eduSaveProgress();
      _renderEduTopicSummary(scoresPct, mastered, canRetry);
    };

    const _alreadyEvaluated = (hist.answers || [])[attemptNum];
    if (_alreadyEvaluated && _alreadyEvaluated.length > 0) {
      const _qOffset  = hist.questions.slice(0, attemptNum).reduce(function(s, a) { return s + a.length; }, 0);
      const _cachedRes = (hist.qHistory || []).slice(_qOffset, _qOffset + questions.length);
      if (_cachedRes.length > 0) {
        setTimeout(function() { window._eduSubmitVerification(topicIdx, attemptNum, _cachedRes); }, 0);
      }
    }
  }

  function renderEduSummaryView() {
    const container = renderEduContainer();
    if (!container) return;
    window._eduSummaryActive = true;

    // Ihned přepni pause button — nečekej na renderScenarioDetail
    const _pb = document.getElementById('pauseBtn');
    if (_pb) {
      _pb.style.display = 'inline-block';
      _pb.disabled = false;
      _pb.style.opacity = '1';
      _pb.style.cursor = 'pointer';
      _pb.style.pointerEvents = 'auto';
      _pb.style.background = '#3b82f6';
      _pb.textContent = 'Uložit výsledky';
      _pb.onclick = () => submitLatestAttempt();
    }

    const total    = _edu.topics.length;
    const mastered = _edu.topicHistory.filter(h => h.mastered).length;
    const skipped  = _edu.topicHistory.filter(h => h.skipped).length;
    const pct = _edu.totalMaxScore > 0 ? Math.round(_edu.totalScore / _edu.totalMaxScore * 100) : 0;
    const overallCol = pct >= _edu.threshold ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

    const chartRows = _edu.topics.map((topic, i) => {
      const h = _edu.topicHistory[i] || {};
      const score = (h.scores && h.scores.length > 0) ? h.scores[h.scores.length - 1] : null;
      const col = score === null ? '#6b7280' : score >= _edu.threshold ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
      const barPct = score !== null ? score : 0;
      const repeatsNote = h.repeats > 0 ? (' · ' + h.repeats + '× opakováno') : '';
      const thresholdMarker = (barPct < _edu.threshold)
        ? '<div style="position:absolute;top:0;left:' + _edu.threshold + '%;width:2px;height:100%;background:rgba(120,120,120,0.35);border-radius:1px;"></div>'
        : '';
      return '<div style="margin-bottom:14px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">'
        +   '<span style="font-size:13px;color:var(--text-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65%;">' + eduEsc(topic) + '</span>'
        +   '<span style="font-size:12px;color:' + col + ';font-weight:bold;white-space:nowrap;flex-shrink:0;margin-left:8px;">'
        +     (score !== null ? score + '%' : '—')
        +     (repeatsNote ? '<span style="font-weight:normal;color:var(--text-muted);font-size:11px;">' + eduEsc(repeatsNote) + '</span>' : '')
        +   '</span>'
        + '</div>'
        + '<div style="background:var(--bg-status);border-radius:6px;height:10px;overflow:hidden;position:relative;">'
        +   '<div style="background:' + col + ';width:' + barPct + '%;height:100%;border-radius:6px;transition:width 1s ease;"></div>'
        +   thresholdMarker
        + '</div>'
        + '</div>';
    }).join('');

    const statsRow = [
      { label: 'Zvládnuto', val: mastered, col: '#10b981' },
      { label: 'Nepřeskočeno', val: total - mastered - skipped, col: '#ef4444' },
      { label: 'Přeskočeno', val: skipped, col: '#f59e0b' },
    ].filter(s => s.val > 0).map(s =>
      '<div style="text-align:center;flex:1;">'
      + '<div style="font-size:22px;font-weight:900;color:' + s.col + ';">' + s.val + '</div>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + s.label + '</div>'
      + '</div>'
    ).join('<div style="width:1px;background:var(--border-color);"></div>');

    container.innerHTML =
      '<div id="ai-summary-card" style="border:1px solid var(--border-color);border-radius:12px;background:var(--bg-panel);margin:12px 0;overflow:hidden;">'

      // ── Header
      + '<div style="padding:20px 24px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:18px;">'
      +   '<div style="flex-shrink:0;width:68px;height:68px;border-radius:50%;border:3px solid ' + overallCol + ';display:flex;align-items:center;justify-content:center;background:' + overallCol + '18;">'
      +     '<span style="font-size:20px;font-weight:900;color:' + overallCol + ';">' + pct + '%</span>'
      +   '</div>'
      +   '<div>'
      +     '<div style="font-size:17px;font-weight:800;color:var(--text-primary);margin-bottom:3px;">Vzdělávání dokončeno!</div>'
      +     '<div style="font-size:13px;color:var(--text-muted);">' + mastered + ' z ' + total + ' témat zvládnuto' + (skipped > 0 ? ' · ' + skipped + ' přeskočeno' : '') + '</div>'
      +   '</div>'
      + '</div>'

      // ── Stats strip
      + '<div style="display:flex;border-bottom:1px solid var(--border-color);">' + statsRow + '</div>'

      // ── Chart
      + '<div style="padding:20px 20px 8px;">'
      +   '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:14px;">'
      +     'Úspěšnost po tématech'
      +     '<span style="font-size:10px;font-weight:normal;margin-left:8px;">(čárka = práh ' + _edu.threshold + ' %)</span>'
      +   '</div>'
      +   chartRows
      + '</div>'

      // ── Submit hint
      + '<div style="padding:13px 20px;border-top:1px solid var(--border-color);background:var(--bg-status);">'
      +   '<div style="font-size:13px;color:var(--text-muted);text-align:center;">'
      +     'Klikněte na <strong style="color:#3b82f6;">Uložit výsledky</strong> pro uložení výsledků.'
      +   '</div>'
      + '</div>'

      + '</div>';

    setTimeout(() => {
      const card = document.getElementById('ai-summary-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      _registerAiSubmitHook();
    }, 100);
  }

  // ─── Payload builder for education mode ─────────────────────────────────────

  function buildEduPayload() {
    if (!_edu.topics.length) return null;

    const topicLines = _edu.topics.map((topic, i) => {
      const hist = _edu.topicHistory[i] || {};
      const status = hist.mastered ? 'ZVLÁDNUTO' : hist.skipped ? 'PŘESKOČENO' : 'NEDOKONČENO';
      const lastScore = hist.scores?.[hist.scores.length - 1];
      const scoreStr = lastScore !== undefined ? `${lastScore}%` : '—';
      const repeatsStr = hist.repeats > 0 ? ` (${hist.repeats} opakování)` : '';
      return `Téma ${i + 1}: ${topic} — ${status}${repeatsStr}\nSkóre: ${scoreStr}\nBody: ${hist.pointsEarned || 0}/${hist.pointsMax || 0}`;
    }).join('\n\n');

    const pct = _edu.totalMaxScore > 0 ? Math.round(_edu.totalScore / _edu.totalMaxScore * 100) : 0;

    return `[AI_EDUCATION]\nCelkové skóre: ${_edu.totalScore} / ${_edu.totalMaxScore} b (${pct}%)\nPráh: ${_edu.threshold}\n\n${topicLines}`;
  }

  function buildEduStepDetails() {
    const steps = [];
    _edu.topics.forEach((topic, i) => {
      const hist = _edu.topicHistory[i] || {};
      (hist.qHistory || []).forEach((q, j) => {
        steps.push({
          step: steps.length + 1,
          topic,
          task_type: q.qtype || 'open',
          task_text: q.question || '',
          points_earned: q.points ?? 0,
          points_max: q.maxPoints ?? 0,
          answer: q.answer || '',
          feedback: q.feedback || '',
        });
      });
    });
    return JSON.stringify(steps);
  }

  // ─── Patch initAiScenario to detect education mode ───────────────────────────

  const _origInitAiScenario = initAiScenario;
  async function initAiScenarioPatched(scenario, latestAttempt, state) {
    // Vždy deaktivuj předchozí scénář (resetuje isActive, buildPayload, _state, _edu.isRunning)
    deactivateAiScenario();

    const hints = scenario.hints || '';
    if (hints.includes('[TYPE:ai_education]')) {
      // Nastav edu overrides — budou odstraněny příštím voláním deactivate()
      window.aiScenario.buildPayload     = buildEduPayload;
      window.aiScenario.buildStepDetails = buildEduStepDetails;
      window.aiScenario.isActive         = () => _edu.isRunning;
      await initEduMode(scenario, latestAttempt, state);
      return;
    }
    return _origInitAiScenario(scenario, latestAttempt, state);
  }
  window.aiScenario.init = initAiScenarioPatched;

})();
