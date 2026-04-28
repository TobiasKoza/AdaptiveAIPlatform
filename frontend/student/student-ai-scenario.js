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
    _state: _ai,
  };

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

  function saveProgress() {
    if (!_ai.scenarioId || !_ai.attemptId) return;
    const key = progressKey(_ai.scenarioId, _ai.attemptId);
    localStorage.setItem(key, JSON.stringify({
      currentSubtask: _ai.currentSubtask,
      subtaskHistory: _ai.subtaskHistory,
      earnedPoints: _ai.earnedPoints,
      maxPoints: _ai.maxPoints,
      difficultyLevel: _ai.difficultyLevel,
      introHtml: _ai.introHtml,
    }));
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
    div.style.cssText = 'margin-top:0;';
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
    if (/___/.test(t)) return 'fill';
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
      const parts = fillSource ? fillSource.split('___') : [];
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

      // 1) Jsou všechny otázky vygenerovány?
      const totalGenerated = _ai.subtaskHistory.filter(h => h && h.question).length;
      if (totalGenerated < _ai.totalSubtasks) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showToast(`Nejprve si projděte všechny úkoly — vygenerováno ${totalGenerated} z ${_ai.totalSubtasks}.`, true);
        return;
      }

      // 2) Jsou nějaké úkoly bez odpovědi?
      const unanswered = _ai.subtaskHistory
        .map((h, i) => ({ i, answered: h && h.answer !== null && h.answer !== undefined }))
        .filter(x => !x.answered)
        .map(x => x.i + 1);

      if (unanswered.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const taskList = unanswered.map(n => `č. ${n}`).join(', ');
        const msg = unanswered.length === 1
          ? `U úkolu ${taskList} jste neodeslal odpověď. Určitě chcete odevzdat výsledek?`
          : `U úkolů ${taskList} jste neodeslal odpovědi. Určitě chcete odevzdat výsledek?`;
        window.customConfirm(msg, () => {
          window._aiSubmitConfirmed = true;
          btn.click();
        });
        return;
      }
    }, true);
  }

  // ─── Spinner CSS (injektuje se jednou) ──────────────────────────────────────
  function ensureSpinnerCss() {
    if (document.getElementById('ai-spinner-style')) return;
    const style = document.createElement('style');
    style.id = 'ai-spinner-style';
    style.textContent = `
      .ai-spinner {
        width: 20px; height: 20px;
        border: 3px solid var(--border-color,#e5e7eb);
        border-top-color: var(--primary,#1a3a6b);
        border-radius: 50%;
        animation: ai-spin 0.8s linear infinite;
        flex-shrink: 0;
      }
      @keyframes ai-spin { to { transform: rotate(360deg); } }
      .ai-step-hidden { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  // ─── Hlavní inicializace ─────────────────────────────────────────────────────
  async function initAiScenario(scenario, latestAttempt, state) {
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
${selectedQtype === 'A/B/C/D' ? 'Vypiš 4 možnosti A) B) C) D) přímo v textu otázky.' : ''}
${selectedQtype === 'doplňování slov' ? 'Vytvoř větu s PŘESNĚ 2 chybějícími odbornými termíny (ne spojky, předložky ani pomocná slovesa). Každé chybějící místo označ jako ___. Příklad: "Neuronová síť používá ___ k měření chyby a ___ k aktualizaci vah."' : ''}
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
      ? `- Otázka má ${fillBlanks} chybějící slova. Za každé správně doplněné slovo = ${ptsPerBlank} bodů (celkem max ${maxPts} b). Hodnoť každé slovo ZVLÁŠŤ a KONZISTENTNĚ — pokud uznáš slovo jako správné, musí se to odrazit v bodech. Správné slovo = ${ptsPerBlank} b, špatné = 0 b. V poli "correct_answer" uveď POUZE skutečně správné termíny oddělené lomítkem.`
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
  "feedback": "<1-2 věty hodnotící odpověď studenta, NEZOBRAZUJ ZDE SPRÁVNOU ODPOVĚĎ>",
  "correct_answer": "<POVINNÉ: vždy uveď správnou odpověď nebo správný kód, i když student odpověděl správně>",
  "explanation": "<1-2 věty vysvětlující proč je správná odpověď správná, nebo null pokud student odpověděl správně>"
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
                host.style.cssText = 'border:1px solid var(--border-color);border-radius:8px;overflow:hidden;margin:8px 0;min-height:100px;resize:vertical;';
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
            
            const cm = CodeMirror(_answerHost, {
                value: _ai.subtaskHistory[idx]?.answer || '',
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
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
        nextBtn.style.cursor = 'pointer';
        nextBtn.textContent = idx >= _ai.totalSubtasks - 1 ? 'Dokončit' : 'Další →';
      }
      if (existing.feedback) showInlineFeedback(existing.feedback, existing.points, existing.maxPoints, idx >= _ai.totalSubtasks - 1, idx, existing.correctAnswer || null, existing.explanation || null);
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
        feedbackDiv.style.cssText = 'margin-top:8px; font-size:13px; color:#dc2626; font-weight:bold; min-height:18px;';
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
    ['stopBtn', 'submitBtn', 'startBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._wasDisabled) {
        el.disabled = false;
        el.style.pointerEvents = '';
        el.style.opacity = '';
      }
      if (el) delete el._wasDisabled;
    });

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
        const looksLikeCode = /[\n]|[{};()=<>]|def |import |class |function |printf|echo /.test(correctAnswer);
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
          // Prostý text — renderuj přímo bez CodeMirror
          elCorr.style.removeProperty('height');
          elCorr.style.removeProperty('overflow');
          elCorr.innerHTML = `<div style="padding:10px 12px; font-size:14px; color:var(--text-primary); line-height:1.6; white-space:pre-wrap; font-family:inherit;">${esc(correctAnswer)}</div>`;
        }
      }
    }

    // Odemkni tlačítko Další
    const nextNavBtn = document.getElementById(`ai-next-btn-${idx}`);
    if (nextNavBtn) {
      nextNavBtn.disabled = false;
      nextNavBtn.style.opacity = '1';
      nextNavBtn.style.cursor = 'pointer';
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
          nextBtn.disabled = false;
          nextBtn.style.opacity = '1';
          nextBtn.style.cursor = 'pointer';
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
            el.disabled = false; el.style.opacity = '1'; el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer';
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
      
      // Odemkneme POUZE tlačítko "Ukončit lab" (stopBtn). Tlačítko "Odevzdat" (submitBtn) necháme zamčené!
      const stopBtn = document.getElementById('stopBtn');
      if (stopBtn) { stopBtn.disabled = false; stopBtn.style.opacity = '1'; stopBtn.style.pointerEvents = 'auto'; }
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
    }));
    return JSON.stringify(steps);
  }

})();
