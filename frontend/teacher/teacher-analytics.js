(function () {
  'use strict';

  let _state = {
    courseId: null,
    scenarioId: null,
    groupId: null,
    days: 30,
    summaryData: null,
    studentsData: null,
    charts: {},
    initialized: false,
    scenariosCache: [],
    courseGroupsCache: [],
    scenarioType: null,      // 'ai' | 'classic' | null
    scenarioVariants: [],    // [1, 2, 3, ...]
    selectedVariants: null,  // null = not yet chosen; [] = all; [1,2] = specific
  };

  window.teacherAnalytics = {
    init: initAnalytics,
    refresh: function () { loadAll(); },
  };

  /**
   * Inicializuje analytickou záložku — resetuje selecty zadání a skupin,
   * vyčistí cache a spustí načtení kurzů. Volá se při každém přepnutí na záložku.
   */
  let _filtersRestored = false;

  async function initAnalytics() {
    if (!currentUserEmail) return;
    const scenSel = document.getElementById('analyticsScenarioSel');
    const grpSel = document.getElementById('analyticsGroupSel');
    if (scenSel) scenSel.innerHTML = '<option value="">— Vyberte kurz —</option>';
    if (grpSel) grpSel.innerHTML = '<option value="">— Vyberte kurz —</option>';
    _state.scenariosCache = [];
    _state.courseGroupsCache = [];
    _state.scenarioType = null;
    _state.scenarioVariants = [];
    _state.selectedVariants = null;
    await populateCourseSelect();
    if (!_filtersRestored) {
      _filtersRestored = true;
      await _restoreAnalyticsFilters();
    }
    _state.initialized = true;
  }

  const GRADE_META = [
    { label: 'A', color: '#10b981', min: 0.90 },
    { label: 'B', color: '#22c55e', min: 0.80 },
    { label: 'C', color: '#eab308', min: 0.70 },
    { label: 'D', color: '#f59e0b', min: 0.60 },
    { label: 'E', color: '#f97316', min: 0.50 },
    { label: 'F', color: '#ef4444', min: 0.00 },
  ];

  function scoreToGrade(score, maxPts) {
    const pct = maxPts > 0 ? score / maxPts : 0;
    // GRADE_META je seřazeno od nejvyšší, find vrátí první g kde pct >= min
    return (GRADE_META.find(g => pct >= g.min) || GRADE_META[GRADE_META.length - 1]);
  }

  function getScenarioMaxPts() {
    const scenario = _state.scenariosCache.find(
      s => (s.scenarioId || s.id || s.RowKey) === _state.scenarioId
    );
    if (!scenario?.taskConfigJson) return null;
    try {
      const cfg = JSON.parse(scenario.taskConfigJson);
      const variantNo = (_state.selectedVariants && _state.selectedVariants.length > 0)
        ? _state.selectedVariants[0] : 1;
      const variant = (cfg.variants || []).find(v => Number(v.variantNo) === variantNo)
        || (cfg.variants || [])[0];
      if (!variant?.tasks) return null;
      const total = variant.tasks.reduce((sum, t) => {
        return sum + Number(t.maxPoints || t.max_points || t.points || t.maxPts || 0);
      }, 0);
      return total > 0 ? total : null;
    } catch (_) { return null; }
  }

  function _saveAnalyticsFilters() {
    const courseId = document.getElementById('analyticsCourseSel')?.value || '';
    const scenarioId = document.getElementById('analyticsScenarioSel')?.value || '';
    const groupId = document.getElementById('analyticsGroupSel')?.value || '';
    const days = document.getElementById('analyticsDaysSel')?.value || '30';
    localStorage.setItem('analyticsFilters', JSON.stringify({ courseId, scenarioId, groupId, days }));
  }

  async function _restoreAnalyticsFilters() {
    const saved = localStorage.getItem('analyticsFilters');
    if (!saved) return;
    try {
      const f = JSON.parse(saved);
      const courseSel = document.getElementById('analyticsCourseSel');
      const daysSel = document.getElementById('analyticsDaysSel');

      if (f.courseId && courseSel) {
        courseSel.value = f.courseId;
        if (courseSel.value === f.courseId) {
          await onCourseChange();
          const scenSel = document.getElementById('analyticsScenarioSel');
          if (f.scenarioId && scenSel) {
            scenSel.value = f.scenarioId;
            if (scenSel.value === f.scenarioId) {
              await onScenarioChange();
              const grpSel = document.getElementById('analyticsGroupSel');
              if (f.groupId && grpSel) grpSel.value = f.groupId;
            }
          }
        }
      }
      if (f.days && daysSel) daysSel.value = f.days;
      if (f.scenarioId && f.courseId) await loadAll();
    } catch {
    }
  }

  /**
   * Provede autentizovaný GET požadavek na API.
   * @param {string} path - Cesta k endpointu (bez API_BASE).
   * @returns {Promise<any>} Odpověď jako JSON.
   */
  async function get(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Provede autentizovaný POST požadavek na API.
   * @param {string} path - Cesta k endpointu (bez API_BASE).
   * @param {object} body - Tělo požadavku jako objekt (serializuje se na JSON).
   * @returns {Promise<any>} Odpověď jako JSON.
   */
  async function post(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  /**
   * Načte seznam kurzů z API a naplní select #analyticsCourseSel.
   * Během načítání zobrazí placeholder text; při chybě zobrazí toast.
   */
  async function populateCourseSelect() {
    const sel = document.getElementById('analyticsCourseSel');
    if (!sel) return;
    sel.innerHTML = '<option value="">Načítám kurzy…</option>';
    try {
      const courses = await get('/courses');
      sel.innerHTML = '<option value="">— Vyberte kurz —</option>';
      (courses || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.courseId;
        opt.textContent = c.title || c.courseId;
        sel.appendChild(opt);
      });
      if (!courses || !courses.length) showToast('Nenalezeny žádné kurzy.', true);
    } catch (e) {
      sel.innerHTML = '<option value="">— Chyba načítání —</option>';
      showToast('Chyba při načítání kurzů: ' + e.message, true);
    }
  }

  /**
   * Obsluha změny kurzu — resetuje závislé selecty, načte zadání kurzu
   * do #analyticsScenarioSel a uloží skupiny kurzu do cache pro filtrování skupin.
   */
  async function onCourseChange() {
    const courseId = document.getElementById('analyticsCourseSel').value;
    const scenSel = document.getElementById('analyticsScenarioSel');
    const grpSel = document.getElementById('analyticsGroupSel');

    scenSel.innerHTML = '<option value="">— Vyberte kurz —</option>';
    grpSel.innerHTML = '<option value="">— Vyberte kurz —</option>';
    _state.scenariosCache = [];
    _state.courseGroupsCache = [];
    _state.selectedVariants = null;
    _state.scenarioType = null;
    if (!courseId) return;

    scenSel.innerHTML = '<option value="">Načítám zadání…</option>';
    grpSel.innerHTML = '<option value="">— Vyberte zadání —</option>';

    try {
      const scenarios = await get(`/courses/${courseId}/scenarios`);
      _state.scenariosCache = scenarios || [];
      scenSel.innerHTML = '<option value="">— Vyberte zadání —</option>';
      _state.scenariosCache.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.scenarioId || s.id || s.RowKey;
        opt.textContent = s.title || opt.value;
        scenSel.appendChild(opt);
      });
    } catch (_) {
      scenSel.innerHTML = '<option value="">— Vyberte zadání —</option>';
    }

    try {
      _state.courseGroupsCache = await get(`/courses/${courseId}/groups`);
    } catch (_) {
      _state.courseGroupsCache = [];
    }
  }

  /**
   * Obsluha změny zadání — naplní #analyticsGroupSel skupinami s přístupem
   * a resetuje výběr variant (nové zadání = nová volba variant).
   */
  async function onScenarioChange() {
    const scenarioId = document.getElementById('analyticsScenarioSel').value;
    const grpSel = document.getElementById('analyticsGroupSel');

    // Reset variant výběru při změně zadání
    _state.selectedVariants = null;
    _state.scenarioType = null;

    if (!scenarioId) {
      grpSel.innerHTML = '<option value="">— Vyberte zadání —</option>';
      return;
    }

    grpSel.innerHTML = '<option value="">Načítám skupiny…</option>';
    grpSel.disabled = true;

    const scenario = _state.scenariosCache.find(
      s => (s.scenarioId || s.id || s.RowKey) === scenarioId
    );
    const assignedGroupsStr = (scenario?.assigned_to_groups || scenario?.assignedToGroups || '').trim();
    const allGroups = _state.courseGroupsCache || [];
    let accessible;
    if (!assignedGroupsStr) {
        accessible = allGroups;
    } else if (assignedGroupsStr === 'HIDDEN_FROM_ALL') {
        accessible = [];
    } else {
        const whitelist = new Set(assignedGroupsStr.split(',').map(x => x.trim()).filter(Boolean));
        accessible = allGroups.filter(g => whitelist.has(g.groupId));
    }

    grpSel.innerHTML = '<option value="">— Všechny skupiny —</option>';
    accessible.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.groupId;
      opt.textContent = g.title || g.groupId;
      grpSel.appendChild(opt);
    });
    grpSel.disabled = false;
  }

  /**
   * Detekuje typ zadání (AI adaptivní vs. klasické) a seznam variant z cache scénářů.
   * @param {string} scenarioId - ID zadání.
   * @returns {{ isAiScenario: boolean, variantNos: number[] }}
   */
  function detectScenarioMeta(scenarioId) {
    const scenario = _state.scenariosCache.find(
      s => (s.scenarioId || s.id || s.RowKey) === scenarioId
    );
    const isAiScenario = scenario?.difficulty === 'adaptive'
      || (scenario?.hints || '').includes('[ADAPTIVE:true]');
    const isAiEducation = (scenario?.hints || '').includes('[TYPE:ai_education]');

    let variantNos = [];
    if (!isAiScenario && !isAiEducation && scenario?.taskConfigJson) {
      try {
        const cfg = JSON.parse(scenario.taskConfigJson);
        if (Array.isArray(cfg.variants) && cfg.variants.length > 1) {
          variantNos = cfg.variants.map(v => Number(v.variantNo) || 1);
        }
      } catch (_) {}
    }
    return { isAiScenario, isAiEducation, variantNos };
  }

  /**
   * Merguje data kroků z API se VŠEMI kroky definovanými v taskConfigJson zadání.
   * Kroky bez odevzdání (0 studentů) jsou doplněny s nulovými hodnotami.
   * @param {Array<object>} stepsData - Kroky vrácené z /steps endpointu.
   * @param {string} scenarioId - ID zadání.
   * @param {number[]|null} selectedVariants - Vybrané varianty (první použita pro výběr kroků).
   * @returns {Array<object>} Kompletní seznam kroků setříděný numericky.
   */
  function _mergeWithAllScenarioSteps(stepsData, scenarioId, selectedVariants) {
    const scenario = _state.scenariosCache.find(
      s => (s.scenarioId || s.id || s.RowKey) === scenarioId
    );
    if (!scenario?.taskConfigJson) return stepsData;

    let allStepMetas = [];
    try {
      const cfg = JSON.parse(scenario.taskConfigJson);
      const variantNo = (selectedVariants && selectedVariants.length > 0) ? selectedVariants[0] : 1;
      const variant = (cfg.variants || []).find(v => Number(v.variantNo) === variantNo) || (cfg.variants || [])[0];
      if (variant?.tasks) {
        allStepMetas = variant.tasks.map((t, i) => ({
          step_id: String(i + 1),
          label: (t.prompt || `Krok ${i + 1}`).split('\n')[0].trim().slice(0, 60),
        }));
      }
    } catch (_) {
      return stepsData;
    }

    if (!allStepMetas.length) return stepsData;

    const stepsMap = new Map((stepsData || []).map(s => [String(s.step_id), s]));
    return allStepMetas.map(meta => {
      const existing = stepsMap.get(meta.step_id);
      if (existing) {
        // Vždy přepiš label textem z taskConfigJson (backend vrací jen "Krok X")
        return { ...existing, label: meta.label };
      }
      return {
        step_id: meta.step_id,
        label: meta.label,
        successful_students: 0,
        full_score_students: 0,
        partial_students: 0,
        zero_students: 0,
        total_students: 0,
        success_rate: 0,
      };
    });
  }

  /**
   * Zobrazí dialog pro výběr variant zadání (multi-checkbox).
   * Vizuálně odpovídá customConfirm z student-steps.js.
   * @param {number[]} variantNos - Čísla dostupných variant.
   * @param {function(number[]): void} onConfirm - Callback volaný po potvrzení se seznamem vybraných variant.
   */
  function showVariantSelectDialog(variantNos, onConfirm) {
    let modal = document.getElementById('_variantSelectModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = '_variantSelectModal';
      document.body.appendChild(modal);
    }

    const checkboxHtml = variantNos.map(n =>
      `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:5px 0;font-size:14px;color:var(--text-primary);">
        <input type="checkbox" id="_vsel_${n}" value="${n}" checked
          style="width:16px;height:16px;accent-color:#3e67a8;cursor:pointer;">
        Varianta ${n}
      </label>`
    ).join('');

    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;">
        <div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:24px;width:420px;max-width:95%;box-shadow:0 8px 32px rgba(0,0,0,0.25);">
          <p style="margin:0 0 16px 0;font-size:14px;font-weight:bold;color:var(--text-primary);">Které varianty chcete zobrazit?</p>
          <div style="margin-bottom:20px;">${checkboxHtml}</div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button onclick="document.getElementById('_variantSelectModal').innerHTML=''"
              style="padding:8px 18px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-status);color:var(--text-primary);cursor:pointer;font-size:14px;">
              Zrušit
            </button>
            <button id="_variantSelOk"
              style="padding:8px 18px;border-radius:6px;border:none;background:var(--btn-primary);color:white;cursor:pointer;font-size:14px;font-weight:bold;">
              Zobrazit
            </button>
          </div>
        </div>
      </div>`;

    document.getElementById('_variantSelOk').onclick = () => {
      const selected = variantNos.filter(n => {
        const cb = document.getElementById(`_vsel_${n}`);
        return cb ? cb.checked : true;
      });
      modal.innerHTML = '';
      onConfirm(selected.length ? selected : variantNos);
    };
  }

  /**
   * Načte a vykreslí veškerá analytická data pro aktuálně vybraný kurz,
   * zadání a skupinu. Pro AI adaptivní zadání zobrazí panel slabin místo kroků.
   * Pro zadání s variantami zobrazí dialog výběru variant při prvním načtení.
   */
  async function loadAll() {
    const courseId = document.getElementById('analyticsCourseSel').value;
    if (!courseId) { showToast('Vyberte kurz.', true); return; }
    _saveAnalyticsFilters();
    _state.courseId = courseId;
    _state.scenarioId = document.getElementById('analyticsScenarioSel').value || null;
    if (!_state.scenarioId) { showToast('Nelze zobrazit data pro kurz bez vybraného zadání.', true); return; }
    _state.groupId = document.getElementById('analyticsGroupSel').value || null;
    _state.days = parseInt(document.getElementById('analyticsDaysSel').value, 10) || 30;

    // Detekuj typ zadání a varianty
    const { isAiScenario, isAiEducation, variantNos } = detectScenarioMeta(_state.scenarioId);
    _state.scenarioType = isAiEducation ? 'ai_education' : isAiScenario ? 'ai' : 'classic';
    _state.isAiEducation = isAiEducation;
    _state.scenarioVariants = variantNos;

    // Pokud má varianty a ještě nebyly vybrány, zobraz dialog a počkej
    if (variantNos.length > 0 && _state.selectedVariants === null) {
      showVariantSelectDialog(variantNos, selected => {
        _state.selectedVariants = selected;
        loadAll();
      });
      return;
    }

    const scenarioLabel = _state.scenariosCache.find(
      s => (s.scenarioId || s.id || s.RowKey) === _state.scenarioId
    )?.title || _state.scenarioId;
    const groupLabel = _state.groupId
      ? (_state.courseGroupsCache.find(g => g.groupId === _state.groupId)?.title || _state.groupId)
      : 'všechny skupiny';
    if (localStorage.getItem('teacherActiveTab') === 'analytics') {
      showToast(`Načítám data: ${scenarioLabel} | ${groupLabel}`);
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ days: _state.days });
      if (_state.scenarioId) params.set('scenario_id', _state.scenarioId);
      if (_state.groupId) params.set('group_id', _state.groupId);
      if (_state.selectedVariants && _state.selectedVariants.length > 0) {
        params.set('variant_ids', _state.selectedVariants.join(','));
      }

      const promises = [
        get(`/api/analytics/course/${_state.courseId}/summary?${params}`),
        get(`/api/analytics/course/${_state.courseId}/students?${params}`),
        Promise.resolve([]),
        get(`/courses/${_state.courseId}/members`),
      ];
      // Kroky per krok načítáme jen pro klasická zadání
      if (!isAiScenario) {
        promises.push(get(`/api/analytics/course/${_state.courseId}/scenario/${_state.scenarioId}/steps?${params}`));
      }

      const results = await Promise.all(promises);
      const summary = results[0];
      const students = results[1];
      const allMembers = results[3] || [];
      try {
        window._analyticsLoadedAttempts = await get(`/courses/${_state.courseId}/attempts`);
      } catch(_) { window._analyticsLoadedAttempts = []; }

      // Pro AI vzdělávání načti všechna odevzdání kurzu
      let _eduSubmissions = [];
      if (isAiEducation) {
        try {
          const _allSubs = await get(`/courses/${_state.courseId}/submissions`);
          _eduSubmissions = (_allSubs || []).filter(s =>
            (s.scenarioId === _state.scenarioId || s.scenario_id === _state.scenarioId) &&
            String(s.contentPayload || s.content_payload || '').trimStart().startsWith('[AI_EDUCATION]')
          );
        } catch(e) { }
      }

      // Počet studentů v kurzu (role student nebo bez role = member)
      const totalCourseStudents = allMembers.filter(m => !m.role || m.role === 'student').length;
      let stepsData = (!isAiScenario && results.length > 4) ? results[4] : [];

      // Doplň kroky ze zadání, které nemají žádné odevzdání (stepsData neobsahuje kroky bez dat)
      if (!isAiScenario && _state.scenarioId) {
        stepsData = _mergeWithAllScenarioSteps(stepsData, _state.scenarioId, _state.selectedVariants);
      }
      _state.totalCourseStudents = totalCourseStudents;
      _state.allCourseMembers = allMembers.filter(m => !m.role || m.role === 'student');

      // Přepočítej avg_time z doby posledního pokusu každého studenta
      const lastDurations = students.map(s => s.last_duration_minutes).filter(d => d != null && d > 0);
      if (lastDurations.length > 0) {
        summary.avg_time_minutes = Math.round(lastDurations.reduce((a, b) => a + b, 0) / lastDurations.length * 10) / 10;
      }

      _state.summaryData = summary;
      _state.studentsData = students;
      _state.stepsData = stepsData || [];

      // Přepočítej success_rate podle nastavení zadání (PASS_THRESHOLD nebo GRADING)
      const _scenario = _state.scenariosCache.find(s => (s.scenarioId || s.id || s.RowKey) === _state.scenarioId);
      const _hintsStr = _scenario?.hints || '';
      const _gmMatch = _hintsStr.match(/\[GRADING:\s*([a-zA-Z]+)\s*:?\s*(\d+)?\s*\]/i);
      const _gStyle = _gmMatch ? _gmMatch[1] : 'points';
      const _gMax = _gmMatch?.[2] ? parseInt(_gmMatch[2], 10) : (Number(_scenario?.maxPoints) || 100);
      const _threshMatch = _hintsStr.match(/\[PASS_THRESHOLD:(\d+)\]/);
      const _passThreshold = _threshMatch ? parseInt(_threshMatch[1], 10) : null; // null = není pass/fail

      if (students.length > 0) {
        const _threshold = _passThreshold ?? 50; // pass/fail threshold nebo default 50 %
        const _successCount = students.filter(s => {
          const sc = s.last_score ?? s.avg_score;
          if (sc === null || sc === undefined) return false;
          const pct = _gStyle === 'percent' ? Number(sc) : (_gMax > 0 ? (Number(sc) / _gMax) * 100 : 0);
          return pct >= _threshold;
        }).length;
        summary.success_rate = Math.round(_successCount / students.length * 100);
      }

      _state.gStyle = _gStyle;
      _state.passThreshold = _passThreshold;
      renderKPIs(summary);
      renderCharts(summary, students, stepsData, isAiScenario, summary.max_score || 100);
      if (isAiEducation) {
        _hideStandardChartsForEdu();
        const _scenario = _state.scenariosCache.find(s => (s.scenarioId || s.id || s.RowKey) === _state.scenarioId);
        renderAiEducationAnalytics(_eduSubmissions, window._analyticsLoadedAttempts || [], students, _scenario, allMembers);
      }

      const headerEl = document.getElementById('analyticsDataHeader');
      if (headerEl) {
        const daysLabel = _state.days === 9999 ? 'vše' : `posledních ${_state.days} dní`;
        headerEl.textContent = `${scenarioLabel} — ${groupLabel} (${daysLabel})`;
        headerEl.style.display = 'block';
      }
      document.getElementById('analyticsAiSummary').innerHTML =
        `<span style="color:var(--text-muted);">Klikněte na „Generovat AI přehled"${isAiEducation ? ' pro pedagogický přehled třídy' : ''}.</span>`;
      if (localStorage.getItem('teacherActiveTab') === 'analytics') {
        showToast(`Data načtena: ${students.length} studentů, ${summary.total_submissions ?? 0} odevzdání.`);
      }
    } catch (e) {
      showToast('Chyba při načítání analytiky: ' + e.message, true);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Přepne stav načítání — zablokuje/odblokuje tlačítko a zobrazí/skryje spinner.
   * @param {boolean} on - true = načítání probíhá, false = načítání skončilo.
   */
  function setLoading(on) {
    const btn = document.getElementById('analyticsLoadBtn');
    if (btn) btn.disabled = on;
    const spinner = document.getElementById('analyticsSpinner');
    if (spinner) spinner.style.display = on ? 'inline-block' : 'none';
  }

  /**
   * Vyplní KPI karty hodnotami ze souhrnných dat kurzu.
   * @param {object} data - Objekt summary z backendu (avg_score, success_rate, atd.).
   */
  function _restoreStandardKpis() {
    const _labels = {
      kpiAvgScore: 'Průměrné skóre', kpiSuccessRate: 'Úspěšnost',
      kpiTotalSubs: 'Odevzdání celkem', kpiEvaluated: 'Ohodnoceno',
      kpiMedianScore: 'Medián skóre', kpiAvgTime: 'Prům. čas splnění',
    };
    Object.entries(_labels).forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const card = el.closest('.stat-card');
      if (card) card.style.display = '';
      const lbl = card?.querySelector('.stat-card-label');
      if (lbl) lbl.textContent = label;
    });
    const grid = document.getElementById('analyticsChartsGrid');
    if (grid) grid.style.display = 'grid';
    const title = document.getElementById('stepsPanelTitle');
    if (title) title.style.display = '';
    const stepsSection = document.getElementById('stepsChartSection');
    if (stepsSection) stepsSection.style.display = '';
    const wrapper = document.getElementById('stepsPanelWrapper');
    if (wrapper) {
      wrapper.style.maxHeight = '500px';
      wrapper.style.overflow = 'auto';
      wrapper.style.height = '';
    }
    const radarCanvas = document.getElementById('chartRadar');
    if (radarCanvas) radarCanvas.style.display = '';
  }

  function _hideStandardChartsForEdu() {
    const grid = document.getElementById('analyticsChartsGrid');
    if (grid) grid.style.display = 'none';
    const title = document.getElementById('stepsPanelTitle');
    if (title) title.style.display = 'none';
    ['kpiAvgScore', 'kpiSuccessRate', 'kpiMedianScore', 'kpiAvgTime'].forEach(id => {
      const card = document.getElementById(id)?.closest('.stat-card');
      if (card) card.style.display = 'none';
    });
  }

  function renderKPIs(data) {
    _restoreStandardKpis();
    setText('kpiAvgScore', data.avg_score != null ? data.avg_score + ' b.' : '—');
    setText('kpiSuccessRate', data.success_rate != null ? data.success_rate + '%' : '—');
    setText('kpiTotalSubs', data.total_submissions ?? '—');
    setText('kpiEvaluated', data.evaluated_count ?? '—');
    setText('kpiMedianScore', data.median_score != null ? data.median_score + ' b.' : '—');
    setText('kpiAvgTime', data.avg_time_minutes != null ? data.avg_time_minutes + ' min' : '—');
  }

  /**
   * Nastaví textový obsah elementu podle id.
   * @param {string} id - ID DOM elementu.
   * @param {string|number} val - Hodnota k zobrazení.
   */
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /**
   * Zničí existující Chart.js instanci uloženou pod daným klíčem.
   * @param {string} key - Klíč grafu v _state.charts (např. 'bar', 'line').
   */
  function destroyChart(key) {
    if (_state.charts[key]) {
      _state.charts[key].destroy();
      delete _state.charts[key];
    }
  }

  /**
   * Vykreslí všechny grafy analytické záložky.
   * Pro AI zadání zobrazí panel slabin místo grafu kroků.
   * @param {object} summary - Souhrnná data kurzu.
   * @param {Array<object>} students - Per-student výkonnostní data.
   * @param {Array<object>} stepsData - Data kroků (prázdné pro AI zadání).
   * @param {boolean} isAiScenario - Příznak AI adaptivního zadání.
   */
  function renderCharts(summary, students, stepsData, isAiScenario) {
    // Pro AI scénář: max z GRADING tagu nebo maxPoints na scénáři
    let maxPts = getScenarioMaxPts();
    if (!maxPts) {
      const _sc = _state.scenariosCache.find(s => (s.scenarioId || s.id || s.RowKey) === _state.scenarioId);
      const _gmM = (_sc?.hints || '').match(/\[GRADING:\s*[a-zA-Z]+\s*:?\s*(\d+)\s*\]/i);
      maxPts = _gmM ? parseInt(_gmM[1], 10) : (Number(_sc?.maxPoints) || _state.gMax || summary.max_score || 100);
    }
    renderBarChart(students, maxPts, _state.gStyle, _state.passThreshold);
    renderTimeChart(students);
    renderAttemptsChart(students, _state.totalCourseStudents || 0, _state.allCourseMembers || []);
    renderPieChart(students, maxPts, _state.gStyle, _state.passThreshold);
    if (_state.isAiEducation) {
      _showAiWeaknessPanel('<span style="color:var(--text-muted);">Načítám vzdělávací analytiku…</span>');
      destroyChart('radar');
      destroyChart('qtype');
    } else if (isAiScenario) {
      _hideAiWeaknessPanel();
      const radarCanvas = document.getElementById('chartRadar');
      if (radarCanvas) radarCanvas.style.display = 'none';
      renderQtypeChart(students);
    } else {
      _hideAiWeaknessPanel();
      renderRadarChart(stepsData || []);
      destroyChart('qtype');
    }
    const stepsPanelTitle = document.getElementById('stepsPanelTitle');
    if (stepsPanelTitle) {
      if (_state.isAiEducation) {
        stepsPanelTitle.style.display = 'none';
      } else if (isAiScenario) {
        stepsPanelTitle.textContent = 'Úspěšnost per typ úkolu';
        stepsPanelTitle.style.display = '';
      } else {
        stepsPanelTitle.textContent = 'Úspěšnost per krok';
        stepsPanelTitle.style.display = '';
      }
    }
  }

  /**
   * Zobrazí panel slabin AI a skryje plátno grafu kroků.
   * @param {string} html - HTML obsah k zobrazení v panelu.
   */
  function _showAiWeaknessPanel(html) {
    destroyChart('radar');
    const canvas = document.getElementById('chartRadar');
    const panel = document.getElementById('aiWeaknessPanel');
    if (canvas) canvas.style.display = 'none';
    if (panel) { panel.style.display = 'block'; panel.innerHTML = html; }
  }

  /**
   * Skryje panel slabin AI a zobrazí plátno grafu kroků.
   */
  function _hideAiWeaknessPanel() {
    const canvas = document.getElementById('chartRadar');
    const panel = document.getElementById('aiWeaknessPanel');
    if (panel) panel.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
  }

  /**
   * Zavolá backend POST /api/analytics/ai-weakness a zobrazí výsledek v panelu slabin.
   * @param {string} courseId - ID kurzu.
   * @param {string} scenarioId - ID AI zadání.
   */
  async function _loadAiWeaknesses(courseId, scenarioId) {
    try {
      const res = await post('/api/analytics/ai-weakness', { course_id: courseId, scenario_id: scenarioId });
      _showAiWeaknessPanel(markdownToHtml(res.analysis || 'Analýza není k dispozici.'));
    } catch (e) {
      _showAiWeaknessPanel(
        `<span style="color:var(--error-color,#ef4444);">Chyba načtení analýzy slabin: ${escHtml(e.message)}</span>`
      );
    }
  }

  /**
   * Vykreslí sloupcový graf skóre z posledního pokusu studentů seřazených vzestupně.
   * Sloupce jsou zelené (≥50 b.) nebo červené (<50 b.).
   * Tooltip zobrazuje i průměrné skóre ze všech pokusů.
   * @param {Array<object>} students - Pole studentů s poli last_score, avg_score, displayName/userId.
   */
  function renderBarChart(students, maxPts, gStyle, passThreshold) {
    destroyChart('bar');
    const ctx = document.getElementById('chartBar');
    if (!ctx || !students.length) return;
    const mx = maxPts || 100;
    const isPassFail = passThreshold !== null && passThreshold !== undefined;
    const sorted = [...students].sort((a, b) => (a.last_score ?? a.avg_score ?? -1) - (b.last_score ?? b.avg_score ?? -1));

    // V pass/fail režimu zobraz procenta místo bodů
    const getData = s => {
      const sc = s.last_score ?? s.avg_score ?? 0;
      return isPassFail ? (mx > 0 ? Math.round((sc / mx) * 100) : 0) : sc;
    };
    const getColor = s => {
      if (!isPassFail) return scoreToGrade(s.last_score ?? s.avg_score ?? 0, mx).color;
      const pct = mx > 0 ? Math.round(((s.last_score ?? s.avg_score ?? 0) / mx) * 100) : 0;
      return pct >= passThreshold ? '#10b981' : '#ef4444';
    };

    _state.charts.bar = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(s => s.displayName || s.userId),
        datasets: [{
          label: 'Poslední pokus',
          data: sorted.map(s => getData(s)),
          backgroundColor: sorted.map(s => getColor(s)),
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const s = sorted[item.dataIndex];
                if (isPassFail) {
                  const passed = item.raw >= passThreshold;
                  return [`${item.raw} % (${passed ? '✓ Splněno' : '✗ Nesplněno'})`, `Hranice: ${passThreshold} %`];
                }
                const grade = scoreToGrade(item.raw, mx).label;
                const lines = [`Poslední pokus: ${item.raw} b. (${grade})`];
                if (s.avg_score != null && s.avg_score !== item.raw) lines.push(`Průměr: ${s.avg_score} b.`);
                return lines;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: isPassFail ? 100 : mx,
            ticks: { color: '#ffffff', callback: v => isPassFail ? `${v} %` : v },
            title: { display: true, text: isPassFail ? 'Procenta (%)' : 'Body', color: '#ffffff' },
          },
          x: { ticks: { color: '#ffffff' } },
        }
      }
    });
  }

  /**
   * Vykreslí histogram rozložení posledních skóre studentů do 6 kategorií podle školních známek (A–F).
   * Hranice kategorií se počítají relativně k maxScore.
   * @param {Array<number>} scores - Pole skóre posledního pokusu per student.
   * @param {number} maxScore - Maximální možné skóre zadání.
   */
  function renderTimeChart(students) {
    destroyChart('line');
    const ctx = document.getElementById('chartLine');
    if (!ctx) return;

    // Zkus různé názvy pole které backend může posílat
    const getTime = s => s.last_duration_minutes ?? s.avg_time_minutes ?? s.time_minutes ?? s.avg_time ?? s.duration_minutes ?? null;

    const valid = [...students]
      .filter(s => getTime(s) != null)
      .sort((a, b) => getTime(a) - getTime(b));

    if (!valid.length) {
      const maxPts = (_state.summaryData && _state.summaryData.max_score) || 100;
      ctx.style.display = 'none';
      const wrapper = ctx.parentElement;
      if (wrapper && !wrapper.querySelector('.no-time-msg')) {
        const msg = document.createElement('div');
        msg.className = 'no-time-msg';
        msg.textContent = 'Backend neposílá data o čase — přidej avg_time_minutes do compute_student_performance.';
        wrapper.appendChild(msg);
      }
      return;
    }

    ctx.style.display = '';
    const wrapper = ctx.parentElement;
    const msg = wrapper && wrapper.querySelector('.no-time-msg');
    if (msg) msg.remove();

    const _sc2 = _state.scenariosCache.find(s => (s.scenarioId || s.id || s.RowKey) === _state.scenarioId);
    const _gmM2 = (_sc2?.hints || '').match(/\[GRADING:\s*[a-zA-Z]+\s*:?\s*(\d+)\s*\]/i);
    const maxPts = getScenarioMaxPts() || (_gmM2 ? parseInt(_gmM2[1], 10) : (Number(_sc2?.maxPoints) || _state.gMax || 100));

    _state.charts.line = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: valid.map(s => s.displayName || s.userId),
        datasets: [{
          label: 'Průměrný čas',
          data: valid.map(s => getTime(s)),
          backgroundColor: valid.map(s => scoreToGrade(s.last_score ?? s.avg_score ?? 0, maxPts).color),
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const s = valid[item.dataIndex];
                const grade = scoreToGrade(s.last_score ?? s.avg_score ?? 0, maxPts).label;
                return `${item.raw} min (${grade})`;
              },
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#ffffff' },
            title: { display: true, text: 'Čas (min)', color: '#ffffff' },
          },
          x: { ticks: { color: '#ffffff', font: { size: 11 } } },
        }
      }
    });
  }

  const QTYPE_LABELS = {
    'open': 'Otevřená odpověď', 'code': 'Analýza kódu', 'flag': 'Přesná odpověď',
    'abcd': 'Výběr z možností', 'tf': 'Pravda / Nepravda', 'multi': 'Více správných',
    'sort': 'Seřazení', 'image': 'Práce s obrázkem', 'fill': 'Doplňování',
  };

  function _guessTaskType(step) {
    if (step.task_type) return step.task_type;
    const text = (step.task_text || step.title || '').toLowerCase();
    if (/vyberte správnou odpověď|vybírejte z|a\)|b\)|c\)|d\)/.test(text)) return 'A/B/C/D';
    if (/pravda|nepravda|true|false/.test(text)) return 'tf';
    if (/doplňte|doplň|___/.test(text)) return 'fill';
    if (/opravte|oprav|chyba v kódu|syntaktickou chybu/.test(text)) return 'code';
    if (/seřaďte|seřaď/.test(text)) return 'sort';
    return 'open';
  }

  function renderQtypeChart(students) {
    destroyChart('qtype');
    const ctx = document.getElementById('chartQtype');
    if (!ctx) return;

    // Agreguj per krok ze POSLEDNÍHO pokusu každého studenta
    const stepMap = {}; // stepNum -> { task_type, full, partial, zero, total }
    const sid = _state.scenarioId || '';
    const filtered = (window._analyticsLoadedAttempts || []).filter(a => {
      const aSid = a.scenarioId || a.scenario_id || '';
      return aSid === sid || aSid.replace(/-ai$/, '-cs') === sid || aSid.replace(/-cs$/, '-ai') === sid;
    });

    // Pro každého studenta vyber pouze poslední pokus (podle createdAt)
    const lastAttemptPerUser = {};
    filtered.forEach(a => {
      const uid = a.userId || a.user_id || '';
      if (!uid) return;
      const prev = lastAttemptPerUser[uid];
      if (!prev || (a.createdAt || '') > (prev.createdAt || '')) {
        lastAttemptPerUser[uid] = a;
      }
    });

    let studentsWithSteps = 0;
    Object.values(lastAttemptPerUser).forEach(a => {
      let sd = [];
      try { sd = JSON.parse(a.stepDetails || '[]'); } catch(_) {}
      if (!Array.isArray(sd) || sd.length === 0) return;
      studentsWithSteps++;
      sd.forEach(s => {
        const stepNum = Number(s.step) || Number((s.step_id || '').replace(/\D/g, '')) || 0;
        if (!stepNum) return;
        const earned = Number(s.points_earned ?? 0);
        const maxPts = Number(s.points_max ?? s.max_points ?? 0);
        if (!stepMap[stepNum]) {
          stepMap[stepNum] = { task_type: s.task_type || '—', full: 0, partial: 0, zero: 0, skipped: 0, total: 0 };
        }
        stepMap[stepNum].total++;
        if (maxPts > 0 && earned >= maxPts) stepMap[stepNum].full++;
        else if (earned > 0) stepMap[stepNum].partial++;
        else stepMap[stepNum].zero++;
      });
    });

    // Studenti co měli stepDetails ale konkrétní krok vynechali → šedá
    Object.values(stepMap).forEach(d => {
      d.skipped = Math.max(0, studentsWithSteps - d.total);
    });

    if (Object.keys(stepMap).length === 0) {
      ctx.style.display = 'none';
      return;
    }
    ctx.style.display = '';

    const sorted = Object.entries(stepMap).sort((a, b) => Number(a[0]) - Number(b[0]));
    const labels = sorted.map(([num, d]) => `${num}. ${d.task_type}`);
    const full    = sorted.map(([, d]) => d.full);
    const partial = sorted.map(([, d]) => d.partial);
    const zero    = sorted.map(([, d]) => d.zero);
    const skipped = sorted.map(([, d]) => d.skipped || 0);
    const totalAttempts = studentsWithSteps || Math.max(0, ...sorted.map(([, d]) => d.total));

    const _qtypeH = Math.max(220, sorted.length * 60) + 'px';
    ctx.style.height = _qtypeH;
    const wrapper = document.getElementById('stepsPanelWrapper');
    if (wrapper) {
      wrapper.style.maxHeight = 'none';
      wrapper.style.overflow = 'hidden';
      wrapper.style.height = _qtypeH;
    }

    _state.charts.qtype = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Max body',      data: full,    backgroundColor: '#10b981', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9 },
          { label: 'Částečné body', data: partial,  backgroundColor: '#eab308', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9 },
          { label: '0 bodů',        data: zero,     backgroundColor: '#ef4444', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9 },
          { label: 'Bez odpovědi',  data: skipped,  backgroundColor: '#6b7280', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.9 },
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#ffffff' } },
          tooltip: {
            callbacks: {
              label: (item) => {
                const n = item.raw;
                const total = sorted[item.dataIndex][1].total;
                const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                return ` ${item.dataset.label}: ${n} student${n === 1 ? '' : n >= 5 ? 'ů' : 'i'} (${pct} %)`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            stacked: true,
            max: totalAttempts > 0 ? totalAttempts : undefined,
            ticks: { color: '#ffffff', stepSize: 1, precision: 0 },
            title: { display: true, text: 'Počet studentů', color: '#ffffff' },
          },
          y: {
            stacked: true,
            ticks: { color: '#ffffff', font: { size: 11 } },
          },
        }
      }
    });
  }

  function renderAttemptsChart(students, totalCourseStudents, allMembers) {
    destroyChart('attempts');
    const ctx = document.getElementById('chartAttempts');
    if (!ctx) return;
    const freq = {};
    // Mapa: počet pokusů → seznam studentů
    const freqStudents = {};
    students.forEach(s => {
      const n = s.attempts ?? 0;
      freq[n] = (freq[n] || 0) + 1;
      if (!freqStudents[n]) freqStudents[n] = [];
      freqStudents[n].push(s.displayName || s.userId || '?');
    });
    const studentsWithAttempts = students.length;
    const studentsWithZero = Math.max(0, totalCourseStudents - studentsWithAttempts);
    if (studentsWithZero > 0) {
      freq[0] = (freq[0] || 0) + studentsWithZero;
      if (!freqStudents[0]) freqStudents[0] = [];
      // Zjisti kteří členové kurzu nejsou v students[] (nemají žádný pokus)
      const studentUserIds = new Set(students.map(s => s.userId));
      (allMembers || []).forEach(m => {
        const uid = m.userId || m.user_id || m.RowKey || '';
        if (!studentUserIds.has(uid)) {
          freqStudents[0].push(m.displayName || m.display_name || m.email || uid || '?');
        }
      });
    }
    const maxAttempts = Object.keys(freq).length > 0 ? Math.max(...Object.keys(freq).map(Number)) : 0;
    const labels = Array.from({ length: maxAttempts + 1 }, (_, i) => i);
    const data = labels.map(i => freq[i] || 0);

    _state.charts.attempts = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.map(String),
        datasets: [{
          label: 'Počet studentů',
          data,
          backgroundColor: '#3e67a8',
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].label} pokus${Number(items[0].label) === 1 ? '' : 'ů'}`,
              label: (item) => `${item.raw} student${item.raw === 1 ? '' : item.raw >= 5 ? 'ů' : 'i'} — klikněte pro detail`,
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#ffffff' },
            title: { display: true, text: 'Počet studentů', color: '#ffffff' },
          },
          x: {
            ticks: { color: '#ffffff' },
            title: { display: true, text: 'Počet pokusů', color: '#ffffff' },
          },
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const n = labels[idx];
          const names = freqStudents[n] || [];
          if (!names.length) return;
          // Popup
          let modal = document.getElementById('_attemptsDetailModal');
          if (!modal) { modal = document.createElement('div'); modal.id = '_attemptsDetailModal'; document.body.appendChild(modal); }
          modal.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;" onclick="if(event.target===this)this.parentElement.innerHTML=''">
              <div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:24px;width:380px;max-width:95%;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-height:80vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                  <span style="font-size:15px;font-weight:bold;color:var(--text-primary);">Studenti s ${n} pokus${n === 1 ? 'em' : n >= 5 ? 'y' : 'y'}</span>
                  <button onclick="document.getElementById('_attemptsDetailModal').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <ul style="margin:0;padding:0;list-style:none;">
                  ${names.map(name => `<li style="padding:8px 10px;border-bottom:1px solid var(--border-color);font-size:14px;color:var(--text-primary);">${escHtml(name)}</li>`).join('')}
                </ul>
              </div>
            </div>`;
        },
        cursor: 'pointer',
      }
    });
    ctx.style.cursor = 'pointer';
  }
  /**
   * Vykreslí horizontální skupinový sloupcový graf úspěšnosti per krok.
   * Zelený sloupec = úspěšní studenti (≥50 % bodů), červený = neúspěšní.
   * Kroky jsou seřazeny numericky, popisky mají formát "Krok X: label".
   * Výška canvasu se dynamicky přizpůsobuje počtu kroků.
   * Pokud jsou data prázdná, zobrazí informační text.
   * @param {Array<object>} gaps - Pole záznamů z /steps endpointu (step_id, label, successful_students, total_students).
   */
  function renderRadarChart(gaps) {
    destroyChart('radar');
    const ctx = document.getElementById('chartRadar');
    if (!ctx) return;

    const wrapper = document.getElementById('stepsPanelWrapper');
    if (!gaps.length) {
      if (wrapper) wrapper.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:220px;color:var(--text-muted);font-size:13px;text-align:center;padding:16px;">' +
        'Žádná data — studenti zatím neodevzdali nebo zadání nemá step_details.</div>';
      return;
    }

    // Seřaď numericky; ne-numerické na konec
    const sorted = [...gaps].sort((a, b) => {
      const na = parseInt(a.step_id || a.stepId, 10);
      const nb = parseInt(b.step_id || b.stepId, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1;
      if (!isNaN(nb)) return 1;
      return String(a.step_id || a.stepId).localeCompare(String(b.step_id || b.stepId));
    });

    ctx.style.height = Math.max(220, sorted.length * 45) + 'px';

    const labels = sorted.map(g => {
      const sid = g.step_id || g.stepId || '';
      const num = parseInt(sid, 10);
      let lbl = (g.label || '').trim();
      // Odstraň prefix "Krok X" nebo "Krok X:" pokud už label začíná tímto prefixem
      lbl = lbl.replace(/^Krok\s+\d+\s*:?\s*/i, '').trim();
      // Zkrať na první 8 slov + tři tečky
      const words = lbl.split(/\s+/).filter(Boolean);
      const shortLbl = words.length > 8 ? words.slice(0, 8).join(' ') + '…' : lbl;
      return isNaN(num) ? shortLbl : `Krok ${num}: ${shortLbl}`;
    });

    // Zelená = plný počet bodů, žlutá = částečné, červená = 0 bodů, šedá = bez odpovědi
    const full    = sorted.map(g => g.full_score_students ?? g.successful_students ?? 0);
    const partial = sorted.map(g => g.partial_students ?? 0);
    const zero    = sorted.map(g => g.zero_students ?? 0);
    const skipped = sorted.map(g => g.skipped_students ?? 0);
    const totalAttempts = Math.max(
      0,
      ...sorted.map(g => Number(g.total_attempts ?? g.total_students ?? 0))
    );

    _state.charts.radar = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Max body',      data: full,    backgroundColor: '#10b981', borderRadius: 4, barThickness: 20 },
          { label: 'Částečné body', data: partial,  backgroundColor: '#eab308', borderRadius: 4, barThickness: 20 },
          { label: '0 bodů',        data: zero,     backgroundColor: '#ef4444', borderRadius: 4, barThickness: 20 },
          { label: 'Bez odpovědi',  data: skipped,  backgroundColor: '#6b7280', borderRadius: 4, barThickness: 20 },
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#ffffff' } },
          tooltip: {
            callbacks: {
              label: (item) => {
                const n = item.raw;
                const step = sorted[item.dataIndex];
                const total = Number(step.total_attempts ?? step.total_students ?? 0);
                const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                return ` ${item.dataset.label}: ${n} pokus${n === 1 ? '' : n >= 5 ? 'ů' : 'y'} (${pct} %)`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            stacked: true,
            max: totalAttempts > 0 ? totalAttempts : undefined,
            ticks: { color: '#ffffff', stepSize: 1, precision: 0 },
            title: { display: true, text: 'Počet studentů', color: '#ffffff' },
          },
          y: {
            stacked: true,
            ticks: { color: '#ffffff', font: { size: 11 } },
          },
        }
      }
    });
  }

  /**
   * Vykreslí sloupcový graf rozložení studentů podle školní známky (A–F)
   * z jejich posledního pokusu. A=zelená, B=oranžová, C=žlutá, D=modrá, E=fialová, F=červená.
   * @param {Array<object>} students - Pole studentů s poli last_score, avg_score.
   * @param {number} maxPts - Maximální počet bodů zadání (pro výpočet procent).
   */
  function renderPieChart(students, maxPts, gStyle, passThreshold) {
    destroyChart('pie');
    const ctx = document.getElementById('chartPie');
    if (!ctx || !students.length) return;
    const mx = maxPts || 100;
    const _threshold = passThreshold ?? 50;
    const isPassFail = passThreshold !== null && passThreshold !== undefined;

    // --- PASS/FAIL režim ---
    if (isPassFail) {
      const pfCounts = { 'Prospěl': 0, 'Neprospěl': 0 };
      const pfStudents = { 'Prospěl': [], 'Neprospěl': [] };
      students.forEach(s => {
        const score = s.last_score ?? s.avg_score;
        if (score == null) return;
        const pct = mx > 0 ? (Number(score) / mx) * 100 : 0;
        const key = pct >= _threshold ? 'Prospěl' : 'Neprospěl';
        pfCounts[key]++;
        pfStudents[key].push(s.displayName || s.userId || '?');
      });
      const pfLabels = ['Prospěl', 'Neprospěl'];
      const pfColors = ['#10b981', '#ef4444'];
      _state.charts.pie = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: pfLabels,
          datasets: [{ data: pfLabels.map(l => pfCounts[l]), backgroundColor: pfColors, borderWidth: 2, borderColor: '#1e293b' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'right', labels: { color: '#ffffff', font: { size: 13 }, padding: 14 } },
            tooltip: { callbacks: { label: (item) => { const n = item.raw; const pct = students.length > 0 ? Math.round(n / students.length * 100) : 0; return ` ${n} student${n === 1 ? '' : n >= 5 ? 'ů' : 'i'} (${pct} %) — klikněte pro detail`; } } }
          },
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const key = pfLabels[elements[0].index];
            const names = pfStudents[key] || [];
            if (!names.length) return;
            let modal = document.getElementById('_pieDetailModal');
            if (!modal) { modal = document.createElement('div'); modal.id = '_pieDetailModal'; document.body.appendChild(modal); }
            modal.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;" onclick="if(event.target===this)this.parentElement.innerHTML=''"><div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:24px;width:380px;max-width:95%;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-height:80vh;overflow-y:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span style="font-size:15px;font-weight:bold;color:var(--text-primary);">Studenti — ${key}</span><button onclick="document.getElementById('_pieDetailModal').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button></div><ul style="margin:0;padding:0;list-style:none;">${names.map(name => `<li style="padding:8px 10px;border-bottom:1px solid var(--border-color);font-size:14px;color:var(--text-primary);">${escHtml(name)}</li>`).join('')}</ul></div></div>`;
          },
        }
      });
      ctx.style.cursor = 'pointer';
      return;
    }

    // --- Standardní režim (A–F) ---
    const counts = Object.fromEntries(GRADE_META.map(g => [g.label, 0]));
    const gradeStudents = Object.fromEntries(GRADE_META.map(g => [g.label, []]));
    students.forEach(s => {
      const score = s.last_score ?? s.avg_score;
      if (score != null) {
        const grade = scoreToGrade(score, mx).label;
        counts[grade]++;
        gradeStudents[grade].push(s.displayName || s.userId || '?');
      }
    });
    const gradeLabels = GRADE_META.map(g => g.label);
    const pieSliceLabelPlugin = {
      id: 'pieSliceLabels',
      afterDraw(chart) {
        const { ctx: c, data } = chart;
        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((arc, i) => {
          const val = data.datasets[0].data[i];
          if (!val) return;
          const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
          if (val / total < 0.05) return; // příliš malá výseč — nepsat
          const angle = (arc.startAngle + arc.endAngle) / 2;
          const r = (arc.innerRadius + arc.outerRadius) / 2;
          const x = arc.x + Math.cos(angle) * r;
          const y = arc.y + Math.sin(angle) * r;
          c.save();
          c.fillStyle = '#ffffff';
          c.font = 'bold 13px sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.shadowColor = 'rgba(0,0,0,0.6)';
          c.shadowBlur = 4;
          c.fillText(gradeLabels[i], x, y);
          c.restore();
        });
      }
    };

    _state.charts.pie = new Chart(ctx, {
      type: 'pie',
      plugins: [pieSliceLabelPlugin],
      data: {
        labels: gradeLabels.map(l => {
          const idx = GRADE_META.findIndex(x => x.label === l);
          const g = GRADE_META[idx];
          const minB = Math.round(g.min * mx);
          const maxB = idx === 0 ? mx : Math.round(GRADE_META[idx - 1].min * mx) - 1;
          return `${l} (${minB}–${maxB} b.)`;
        }),
        datasets: [{
          data: gradeLabels.map(l => counts[l]),
          backgroundColor: GRADE_META.map(g => g.color),
          borderWidth: 2,
          borderColor: '#1e293b',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: { color: '#ffffff', font: { size: 12 }, padding: 12 },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const n = item.raw;
                const pct = students.length > 0 ? Math.round(n / students.length * 100) : 0;
                return ` ${n} student${n === 1 ? '' : n >= 5 ? 'ů' : 'i'} (${pct} %) — klikněte pro detail`;
              },
            }
          }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const grade = GRADE_META[idx].label;
          const names = gradeStudents[grade] || [];
          if (!names.length) return;
          let modal = document.getElementById('_pieDetailModal');
          if (!modal) { modal = document.createElement('div'); modal.id = '_pieDetailModal'; document.body.appendChild(modal); }
          modal.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;" onclick="if(event.target===this)this.parentElement.innerHTML=''">
              <div style="background:var(--bg-panel);border:2px solid var(--border-color);border-radius:12px;padding:24px;width:380px;max-width:95%;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-height:80vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                  <span style="font-size:15px;font-weight:bold;color:var(--text-primary);">Studenti se známkou ${grade}</span>
                  <button onclick="document.getElementById('_pieDetailModal').innerHTML=''" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <ul style="margin:0;padding:0;list-style:none;">
                  ${names.map(name => `<li style="padding:8px 10px;border-bottom:1px solid var(--border-color);font-size:14px;color:var(--text-primary);">${escHtml(name)}</li>`).join('')}
                </ul>
              </div>
            </div>`;
        },
      }
    });
    ctx.style.cursor = 'pointer';
  }
  /**
   * Zavolá backend endpoint /api/analytics/ai-summary a zobrazí vygenerovaný
   * AI přehled (markdown → HTML) v boxu #analyticsAiSummary.
   */
  async function generateAiSummary() {
    if (!_state.courseId) { showToast('Nejprve načtěte data.', true); return; }
    if (_state.isAiEducation) { return _generateEduAiSummary(); }
    const box = document.getElementById('analyticsAiSummary');
    const btn = document.getElementById('analyticsAiBtn');
    if (box) box.innerHTML = '<span style="color:var(--text-muted);">Generuji přehled...</span>';
    if (btn) btn.disabled = true;
    showToast('Generuji AI přehled, může to chvíli trvat…');
    try {
      const res = await post('/api/analytics/ai-summary', {
        course_id: _state.courseId,
        scenario_id: _state.scenarioId || null,
        days: _state.days,
      });
      if (box) box.innerHTML = markdownToHtml(res.summary || '');
      showToast('AI přehled byl vygenerován.');
    } catch (e) {
      showToast('Chyba AI přehledu: ' + e.message, true);
      if (box) box.innerHTML = '';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _generateEduAiSummary() {
    const box = document.getElementById('analyticsAiSummary');
    const btn = document.getElementById('analyticsAiBtn');
    if (box) box.innerHTML = '<span style="color:var(--text-muted);">Generuji pedagogický přehled…</span>';
    if (btn) btn.disabled = true;
    showToast('Generuji AI pedagogický přehled…');
    try {
      const topicStats = _state._eduTopicStats || [];
      const studentData = _state._eduStudentData || [];
      const threshold = _state._eduThreshold || 75;
      const numTopics = topicStats.length;
      const badTopics = topicStats.filter(t => t.avgPct < threshold);
      const badTopicsStr = badTopics.length
        ? badTopics.map(t => `${t.name} (${t.avgPct}%, zvládlo ${t.masteredCount}/${t.totalStudents} studentů)`).join('; ')
        : 'Žádná témata pod prahem.';
      const atRiskStr = studentData
        .filter(s => s.masteredTopics < numTopics * 0.7 || s.skipped > 0 || s.totalRepeats > 2)
        .slice(0, 6)
        .map(s => `${s.name} — přeskočeno: ${s.skipped}, opakování: ${s.totalRepeats}, pod prahem: ${s.belowThresholdTopics.slice(0, 3).join(', ') || '—'}`)
        .join('\n') || 'Žádní studenti nevyžadují zvláštní pozornost.';
      const context = `Vzdělávací modul: ${_state._eduScenarioTitle || 'Vzdělávací modul'}
Počet studentů: ${_state._eduNumStudents || 0}, Průměrné skóre: ${_state._eduAvgPct || 0}%
Práh zvládnutí: ${threshold}%

Nejproblematičtější témata (pod prahem):
${badTopicsStr}

Rizikoví studenti:
${atRiskStr}

Napiš pedagogický přehled třídy v tomto formátu:
## Celkové hodnocení
[1-2 věty o celkovém výkonu třídy]

## Problematická témata
[bullet list témat pod prahem s konkrétním doporučením pro každé]

## Studenti vyžadující podporu
[bullet list rizikových studentů s konkrétním doporučením na co se zaměřit]

## Doporučení pro učitele
[3-4 konkrétní kroky jak upravit výuku]

Piš česky, stručně a konkrétně. Nevypisuj zpětnou vazbu pro studenty — pouze pro učitele.

STOP: Pokud jsi vygeneroval jakýkoliv text začínající "Bohužel", "Dosáhli jste", "Vaše skóre" nebo podobně — SMAŽ ho. Výstup nesmí obsahovat ŽÁDNOU zpětnou vazbu pro studenta. Pouze přehled pro učitele ve výše uvedeném formátu. Nic jiného.`;
      const res = await post('/api/ai/synthesize-feedback', { feedbacks: context });
      if (box) box.innerHTML = _renderEduAiHtml(res.feedback || '');
      showToast('Pedagogický přehled vygenerován.');
    } catch(e) {
      showToast('Chyba AI přehledu: ' + e.message, true);
      if (box) box.innerHTML = '';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function _renderEduAiHtml(markdown) {
    const studentPrefixes = [
      'bohužel', 'dosáhli', 'dosáhl', 'vaše skóre', 'doporučuji, abyste',
      'výborně', 'váš výkon', 'váš výsledek', 'doporučuji se', 'gratuluji',
      'celkově jste', 'získal', 'získali',
    ];
    const rawLines = markdown.split('\n');
    const cutIdx = rawLines.findIndex(l => l.trim() === '---');
    const beforeCut = cutIdx !== -1 ? rawLines.slice(0, cutIdx) : rawLines;
    const filtered = beforeCut.filter(line => {
      const t = line.trim().toLowerCase();
      return !studentPrefixes.some(p => t.startsWith(p));
    }).join('\n');
    const lines = filtered.split('\n');
    let html = '';
    let inSection = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('## ')) {
        if (inSection) html += '</div>';
        const heading = escHtml(trimmed.slice(3));
        html += `<div style="background:var(--bg-status);border:1px solid var(--border-color);border-radius:8px;padding:12px 16px;margin-bottom:10px;">`;
        html += `<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">${heading}</div>`;
        inSection = true;
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const text = escHtml(trimmed.slice(2));
        html += `<div style="display:flex;gap:6px;margin-bottom:4px;font-size:13px;color:var(--text-primary);line-height:1.5;"><span style="color:var(--accent-color);flex-shrink:0;">›</span><span>${text}</span></div>`;
      } else {
        html += `<p style="font-size:13px;color:var(--text-primary);line-height:1.6;margin:4px 0;">${escHtml(trimmed)}</p>`;
      }
    }
    if (inSection) html += '</div>';
    return html;
  }

  /**
   * Stáhne analytická data kurzu jako CSV soubor přes GET /export-csv endpoint.
   */
  function exportExcel() {
    if (!_state.courseId) { showToast('Nejprve načtěte data.', true); return; }
    if (typeof XLSX === 'undefined') { showToast('Knihovna XLSX se nenačetla.', true); return; }

    const wb = XLSX.utils.book_new();

    if (_state.isAiEducation) {
      const eduTopics  = _state._eduTopicStats  || [];
      const eduStudents = _state._eduStudentData || [];
      const threshold  = _state._eduThreshold   || 75;

      // Souhrn
      const wsSouhrn = XLSX.utils.aoa_to_sheet([
        ['Modul', 'Počet studentů', 'Průměrné skóre (%)', 'Práh zvládnutí (%)', 'Počet témat'],
        [_state._eduScenarioTitle || '', eduStudents.length, _state._eduAvgPct || 0, threshold, eduTopics.length],
      ]);
      wsSouhrn['!cols'] = [35, 16, 20, 20, 14].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, wsSouhrn, 'Souhrn');

      // Témata
      const topicRows = [['Téma', 'Průměrné skóre (%)', 'Zvládnuto studentů', 'Celkem studentů', 'Pod prahem']];
      [...eduTopics].sort((a, b) => a.avgPct - b.avgPct).forEach(t => {
        topicRows.push([t.name, t.avgPct, t.masteredCount, t.totalStudents, t.avgPct < threshold ? 'ANO' : 'NE']);
      });
      const wsTopics = XLSX.utils.aoa_to_sheet(topicRows);
      wsTopics['!cols'] = [35, 20, 20, 16, 12].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, wsTopics, 'Témata');

      // Studenti
      const stuRows = [['Student', 'Skóre (%)', 'Zvládnuto témat', 'Přeskočeno', 'Opakování', 'Témata pod prahem']];
      [...eduStudents].sort((a, b) => a.masteredTopics - b.masteredTopics || b.skipped - a.skipped).forEach(s => {
        stuRows.push([s.name, s.pct, `${s.masteredTopics} / ${s.numTopics}`, s.skipped, s.totalRepeats, s.belowThresholdTopics.join(', ') || '—']);
      });
      const wsStu = XLSX.utils.aoa_to_sheet(stuRows);
      wsStu['!cols'] = [30, 12, 16, 12, 12, 45].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, wsStu, 'Studenti');

      // AI přehled (pokud vygenerován)
      const aiText = document.getElementById('analyticsAiSummary')?.innerText?.trim();
      if (aiText && !aiText.includes('Klikněte na') && aiText.length > 20) {
        const aiRows = [['AI Pedagogický přehled'], []];
        aiText.split('\n').forEach(line => { const t = line.trim(); aiRows.push(t ? [t] : []); });
        const wsAi = XLSX.utils.aoa_to_sheet(aiRows);
        wsAi['!cols'] = [{ wch: 100 }];
        XLSX.utils.book_append_sheet(wb, wsAi, 'AI přehled');
      }

      const filename = `analytika_edu_${_state.scenarioId || _state.courseId}.xlsx`;
      XLSX.writeFile(wb, filename);
      showToast('Excel exportován.');
      return;
    }

    const s = _state.summaryData || {};

    // ── List 1: Souhrn ────────────────────────────────────────────────────────
    const summaryData = [
      ['Průměrné skóre', 'Medián skóre', 'Úspěšnost (%)', 'Odevzdání celkem', 'Ohodnoceno', 'Prům. čas (min)'],
      [s.avg_score ?? '', s.median_score ?? '', s.success_rate ?? '', s.total_submissions ?? '', s.evaluated_count ?? '', s.avg_time_minutes ?? ''],
    ];
    const wsSouhrn = XLSX.utils.aoa_to_sheet(summaryData);
    wsSouhrn['!cols'] = [130, 130, 130, 130, 130, 130].map(w => ({ wch: w / 7 }));
    XLSX.utils.book_append_sheet(wb, wsSouhrn, 'Souhrn');

    // ── List 2: Studenti ──────────────────────────────────────────────────────
    const studentRows = [['Student', 'Průměrné skóre', 'Poslední skóre', 'Počet pokusů', 'Trend', 'Poslední aktivita', 'Čas splnění (min)']];
    (_state.studentsData || []).forEach(st => {
      studentRows.push([st.displayName || st.userId, st.avg_score ?? '', st.last_score ?? '', st.attempts ?? '', st.trend ?? '', st.last_activity ? st.last_activity.slice(0, 10) : '', st.last_duration_minutes ?? '']);
    });
    const wsStudenti = XLSX.utils.aoa_to_sheet(studentRows);
    wsStudenti['!cols'] = [25, 15, 15, 12, 8, 15, 15].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsStudenti, 'Studenti');

    // ── List 2b: Rozložení skóre ──────────────────────────────────────────────
    const _totalMax = _state.gMax || getScenarioMaxPts() || (_state.stepsData || []).reduce((sum, st) => sum + (st.avg_max || 0), 0) || (_state.summaryData?.max_score) || 0;
    const _gradeLabel = pct => {
      if (pct >= 90) return 'A';
      if (pct >= 75) return 'B';
      if (pct >= 60) return 'C';
      if (pct >= 50) return 'D';
      if (pct >= 30) return 'E';
      return 'F';
    };
    const scoreRows = [['max_points:', _totalMax], [], ['Student', 'Body', 'Úspěšnost (%)', 'Známka']];
    (_state.studentsData || []).forEach(st => {
      const score = st.last_score ?? null;
      const pct = (score !== null && _totalMax > 0) ? Math.round((score / _totalMax) * 100) : null;
      const grade = pct !== null ? _gradeLabel(pct) : '';
      scoreRows.push([st.displayName || st.userId, score ?? '', pct !== null ? pct : '', grade]);
    });
    const wsScore = XLSX.utils.aoa_to_sheet(scoreRows);
    wsScore['!cols'] = [{ wch: 25 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsScore, 'Rozložení skóre');

    // ── List 3: Úspěšnost per krok ────────────────────────────────────────────
    if ((_state.stepsData || []).length > 0) {
      const stepRows = [['Krok', 'Název', 'Plný počet studentů', 'Částečné', '0 bodů', 'Celkem studentů', 'Úspěšnost (%)']];
      _state.stepsData.forEach(st => {
        stepRows.push([st.step_id ?? '', st.label ?? '', st.full_score_students ?? '', st.partial_students ?? '', st.zero_students ?? '', st.total_students ?? '', st.success_rate != null ? Math.round(st.success_rate) : '']);
      });
      const wsKroky = XLSX.utils.aoa_to_sheet(stepRows);
      wsKroky['!cols'] = [8, 40, 20, 12, 10, 15, 14].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, wsKroky, 'Kroky');
    }

    // ── List 4: AI přehled ────────────────────────────────────────────────────
    const aiEl = document.getElementById('analyticsAiSummary');
    const aiText = aiEl?.innerText?.trim();
    if (aiText && !aiText.includes('Klikněte na') && aiText.length > 20) {
      const aiRows = [['AI Přehled třídy'], []];
      aiText.split('\n').forEach(line => {
        const t = line.trim();
        if (!t) { aiRows.push([]); return; }
        aiRows.push([t]);
      });
      const wsAi = XLSX.utils.aoa_to_sheet(aiRows);
      wsAi['!cols'] = [{ wch: 100 }];
      XLSX.utils.book_append_sheet(wb, wsAi, 'AI přehled');
    }
    // ── List 5: Slabiny AI cvičení ────────────────────────────────────────────
    const aiWeakText = document.getElementById('analyticsAiWeakness')?.innerText?.trim();
    if (aiWeakText && aiWeakText.length > 10 && !aiWeakText.includes('Klikněte')) {
      const weakRows = aiWeakText.split('\n').filter(l => l.trim()).map(l => [l]);
      const wsWeak = XLSX.utils.aoa_to_sheet(weakRows);
      wsWeak['!cols'] = [{ wch: 80 }];
      XLSX.utils.book_append_sheet(wb, wsWeak, 'Slabiny AI');
    }

    // ── Stažení ───────────────────────────────────────────────────────────────
    const filename = `analytika_${_state.courseId}${_state.scenarioId ? '_' + _state.scenarioId : ''}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast('Excel exportován.');
  }
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [];

    // ── SEKCE 1: Souhrn ──────────────────────────────────────────────────────
    const s = _state.summaryData || {};
    rows.push(['SOUHRN KURZU']);
    rows.push(['Průměrné skóre', 'Medián skóre', 'Úspěšnost (%)', 'Odevzdání celkem', 'Ohodnoceno', 'Prům. čas (min)']);
    rows.push([s.avg_score ?? '', s.median_score ?? '', s.success_rate ?? '', s.total_submissions ?? '', s.evaluated_count ?? '', s.avg_time_minutes ?? '']);
    rows.push([]);

    // ── SEKCE 2: Studenti ─────────────────────────────────────────────────────
    rows.push(['STUDENTI']);
    rows.push(['Student', 'Průměrné skóre', 'Poslední skóre', 'Počet pokusů', 'Trend', 'Poslední aktivita', 'Čas splnění (min)']);
    (_state.studentsData || []).forEach(st => {
      rows.push([st.displayName || st.userId, st.avg_score ?? '', st.last_score ?? '', st.attempts ?? '', st.trend ?? '', st.last_activity ? st.last_activity.slice(0, 10) : '', st.last_duration_minutes ?? '']);
    });
    rows.push([]);

    // ── SEKCE 3: Úspěšnost per krok ──────────────────────────────────────────
    if ((_state.stepsData || []).length > 0) {
      rows.push(['ÚSPĚŠNOST PER KROK']);
      rows.push(['Krok', 'Název', 'Plný počet studentů', 'Částečné', '0 bodů', 'Celkem studentů', 'Úspěšnost (%)']);
      _state.stepsData.forEach(st => {
        rows.push([st.step_id ?? '', st.label ?? '', st.full_score_students ?? '', st.partial_students ?? '', st.zero_students ?? '', st.total_students ?? '', st.success_rate != null ? Math.round(st.success_rate) : '']);
      });
      rows.push([]);
    }

    // ── SEKCE 4: AI přehled ───────────────────────────────────────────────────
    const aiText = document.getElementById('analyticsAiSummary')?.innerText?.trim();
    if (aiText && !aiText.includes('Klikněte na')) {
      rows.push(['AI PŘEHLED TŘÍDY']);
      aiText.split('\n').forEach(line => { if (line.trim()) rows.push([line]); });
      rows.push([]);
    }

    // ── SEKCE 5: Slabiny AI cvičení ───────────────────────────────────────────
    const aiWeakEl = document.getElementById('analyticsAiWeakness');
    const aiWeakText = aiWeakEl?.innerText?.trim();
    if (aiWeakText && aiWeakText.length > 10 && !aiWeakText.includes('Klikněte')) {
      rows.push(['SLABINY AI CVIČENÍ']);
      aiWeakText.split('\n').forEach(line => { if (line.trim()) rows.push([line]); });
    }

  /**
   * Převede jednoduchý markdown (## nadpisy, - odrážky, **tučné**) na HTML string.
   * @param {string} md - Vstupní markdown text.
   * @returns {string} HTML string vhodný pro innerHTML.
   */
  function markdownToHtml(md) {
    return md
      .replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 6px;color:var(--text-primary);">$1</h3>')
      .replace(/^- (.+)$/gm, '<li style="margin:3px 0;">$1</li>')
      .replace(/(<li[\s\S]*?<\/li>)/g, '<ul style="margin:4px 0 8px 18px;">$1</ul>')
      .replace(/\n\n/g, '<br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  /**
   * Escapuje HTML speciální znaky v řetězci pro bezpečné vložení do DOM.
   * @param {string} str - Vstupní řetězec.
   * @returns {string} Escapovaný řetězec.
   */
  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── AI VZDĚLÁVÁNÍ ANALYTIKA ────────────────────────────────────────────────

  function _parseThreshold(hints) {
    const m = (hints || '').match(/\[THRESHOLD:(\d+)\]/);
    return m ? parseInt(m[1], 10) : 75;
  }

  function _parseEduPayload(contentPayload) {
    const raw = String(contentPayload || '');
    const topics = {};
    const rx = /Téma \d+:\s+(.+?)\s+—\s+(?:ZVLÁDNUTO|PŘESKOČENO|NEDOKONČENO)[^T]*?Skóre:\s+(\d+)%/g;
    let m;
    while ((m = rx.exec(raw)) !== null) topics[m[1].trim()] = parseInt(m[2], 10);

    const skippedRx = /Téma \d+:\s+(.+?)\s+— PŘESKOČENO/g;
    const skipped = [];
    let sm;
    while ((sm = skippedRx.exec(raw)) !== null) skipped.push(sm[1].trim());

    const repeatRx = /Téma \d+:\s+(.+?)\s+— (?:ZVLÁDNUTO|PŘESKOČENO|NEDOKONČENO)[^\n]*?\((\d+) opakování\)/g;
    const repeats = {};
    let rm;
    while ((rm = repeatRx.exec(raw)) !== null) repeats[rm[1].trim()] = parseInt(rm[2], 10);

    const totalM = raw.match(/Celkové skóre: (\d+) \/ (\d+) b/);
    return {
      topics,
      skipped,
      repeats,
      totalEarned: totalM ? parseInt(totalM[1], 10) : null,
      totalMax:    totalM ? parseInt(totalM[2], 10) : null,
    };
  }

  function _setKpiEdu(id, label, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.closest('.stat-card');
    if (card) card.style.display = '';
    const lbl = card?.querySelector('.stat-card-label');
    if (lbl) lbl.textContent = label;
    el.textContent = value;
  }

  function renderAiEducationAnalytics(subs, allAttempts, students, scenario, members) {
    const hints = scenario?.hints || '';
    const threshold = _parseThreshold(hints);
    const scenarioId = _state.scenarioId;

    // Group filter set
    let groupSet = null;
    if (_state.groupId) {
      groupSet = new Set(
        (members || [])
          .filter(m => m.groupId === _state.groupId || m.group_id === _state.groupId)
          .map(m => m.userId || m.user_id || m.RowKey || '')
          .filter(Boolean)
      );
    }

    // Edu attempts per student (count all archived/submitted/evaluated attempts for this scenario)
    const attemptsPerStudent = {};
    (allAttempts || []).forEach(a => {
      if ((a.scenarioId !== scenarioId) && (a.scenario_id !== scenarioId)) return;
      const uid = a.userId || a.user_id || '';
      if (!uid || (groupSet && !groupSet.has(uid))) return;
      attemptsPerStudent[uid] = (attemptsPerStudent[uid] || 0) + 1;
    });

    // Latest submission per student (by submittedAt)
    const latestSub = {};
    (subs || []).forEach(s => {
      const uid = s.userId || s.user_id || '';
      if (!uid || (groupSet && !groupSet.has(uid))) return;
      const dateA = new Date(s.submittedAt || s.submitted_at || 0).getTime();
      const dateB = new Date(latestSub[uid]?.submittedAt || latestSub[uid]?.submitted_at || 0).getTime();
      if (!latestSub[uid] || dateA > dateB) {
        latestSub[uid] = s;
      }
    });

    // Collect all topic names
    const allTopicNamesSet = new Set();
    Object.values(latestSub).forEach(sub => {
      const { topics } = _parseEduPayload(sub.contentPayload || sub.content_payload || '');
      Object.keys(topics).forEach(t => allTopicNamesSet.add(t));
    });
    const topicNames = Array.from(allTopicNamesSet);
    const numTopics = topicNames.length || 1;

    // Per-student computed data
    const studentData = Object.entries(latestSub).map(([uid, sub]) => {
      const name = sub.displayName || sub.display_name || sub.userId || uid;
      const parsed = _parseEduPayload(sub.contentPayload || sub.content_payload || '');
      const { topics, totalEarned, totalMax } = parsed;
      const masteredTopics = Object.values(topics).filter(pct => pct >= threshold).length;
      const skipped = parsed.skipped.length;
      const totalRepeats = Object.values(parsed.repeats).reduce((s, x) => s + x, 0);
      const attempts = attemptsPerStudent[uid] || 1;
      const belowThresholdTopics = Object.entries(topics)
        .filter(([, pct]) => pct < threshold)
        .sort(([, a], [, b]) => a - b)
        .map(([n]) => n);
      const pct = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : 0;
      return { uid, name, topics, masteredTopics, skipped, attempts, totalRepeats, belowThresholdTopics, pct, numTopics };
    });

    // Per-topic aggregated stats, worst first
    const topicStats = topicNames.map(name => {
      let pctSum = 0, pctCount = 0, masteredCount = 0;
      studentData.forEach(s => {
        if (s.topics[name] !== undefined) {
          pctSum += s.topics[name]; pctCount++;
          if (s.topics[name] >= threshold) masteredCount++;
        }
      });
      const avgPct = pctCount > 0 ? Math.round(pctSum / pctCount) : 0;
      return { name, avgPct, masteredCount, totalStudents: pctCount };
    }).sort((a, b) => a.avgPct - b.avgPct);

    // Aggregate stats
    const numStudents = studentData.length;
    const avgPct = numStudents > 0 ? Math.round(studentData.reduce((s, x) => s + x.pct, 0) / numStudents) : 0;
    const avgMastered = numStudents > 0
      ? Math.round(studentData.reduce((s, x) => s + x.masteredTopics, 0) / numStudents * 10) / 10 : 0;
    const allRepeatVals = studentData.map(s => s.totalRepeats);
    const avgAttempts = allRepeatVals.length > 0
      ? Math.round(allRepeatVals.reduce((s, x) => s + x, 0) / allRepeatVals.length * 10) / 10 : 0;

    // Override KPI cards
    _setKpiEdu('kpiAvgScore',    'Zvládnuto průměrně', `${avgMastered} / ${numTopics}`);
    _setKpiEdu('kpiSuccessRate', 'Průměrné skóre',     `${avgPct} %`);
    _setKpiEdu('kpiTotalSubs',   'Odevzdáno celkem',   numStudents);
    _setKpiEdu('kpiEvaluated',   'Prům. opakování',    avgAttempts);
    const _hideCard = id => { const c = document.getElementById(id)?.closest('.stat-card'); if (c) c.style.display = 'none'; };
    _hideCard('kpiMedianScore'); _hideCard('kpiAvgTime');

    // Topic table rows (already sorted worst→best)
    const topicTableRows = topicStats.map(t => {
      const col = t.avgPct >= 75 ? '#10b981' : t.avgPct >= 50 ? '#f59e0b' : '#ef4444';
      return `<tr style="${t.avgPct < threshold ? 'background:rgba(239,68,68,0.06);' : ''}">
        <td style="padding:8px 12px;font-size:13px;color:var(--text-primary);border-bottom:1px solid var(--border-color);">${escHtml(t.name)}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:bold;color:${col};border-bottom:1px solid var(--border-color);text-align:right;">${t.avgPct} %</td>
        <td style="padding:8px 12px;font-size:13px;color:var(--text-muted);border-bottom:1px solid var(--border-color);text-align:right;">${t.masteredCount} / ${t.totalStudents}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="3" style="padding:12px;color:var(--text-muted);text-align:center;">Žádná data — studenti zatím neodevzdali.</td></tr>';

    // All students sorted by worst performance first
    const atRiskRows = [...studentData]
      .sort((a, b) => a.masteredTopics - b.masteredTopics || b.skipped - a.skipped || b.totalRepeats - a.totalRepeats)
      .map(s => {
        const doporuceni = s.belowThresholdTopics.length > 0 || s.skipped > 0
          ? `Zaměřit se na: ${s.belowThresholdTopics.slice(0, 4).join(', ') || '—'}`
          : '✓ Bez problémů';
        const isRisk = s.masteredTopics < numTopics * 0.6 || s.skipped > 0 || s.totalRepeats > Math.max(2, avgAttempts * 1.5);
        return `<tr style="${isRisk ? 'background:rgba(239,68,68,0.06);' : ''}">
          <td style="padding:8px 12px;font-size:13px;color:var(--text-primary);border-bottom:1px solid var(--border-color);">${escHtml(s.name)}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:center;border-bottom:1px solid var(--border-color);color:${s.masteredTopics >= numTopics ? '#10b981' : '#f59e0b'};">${s.masteredTopics} / ${numTopics}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:center;border-bottom:1px solid var(--border-color);color:${s.skipped > 0 ? '#ef4444' : 'var(--text-muted)'};">${s.skipped}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:center;border-bottom:1px solid var(--border-color);color:var(--text-primary);">${s.totalRepeats}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--text-muted);border-bottom:1px solid var(--border-color);">${escHtml(doporuceni)}</td>
        </tr>`;
      }).join('');

    const chartId = 'chartEduTopics';
    const chartH = Math.max(180, topicStats.length * 38);

    const eduHtml = `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Průměrné skóre per téma</div>
        <div style="position:relative;height:${chartH}px;"><canvas id="${chartId}"></canvas></div>
      </div>
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Přehled témat — seřazeno od nejhoršího</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid var(--border-color);">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Téma</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Průměr %</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Zvládnuto studentů</th>
            </tr></thead>
            <tbody>${topicTableRows}</tbody>
          </table>
        </div>
      </div>
      ${atRiskRows ? `<div>
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Přehled studentů</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid var(--border-color);">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Student</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Zvládnuto témat</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Přeskočeno</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Opakování</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Doporučení</th>
            </tr></thead>
            <tbody>${atRiskRows}</tbody>
          </table>
        </div>
      </div>` : ''}`;

    _showAiWeaknessPanel(eduHtml);

    // Store for AI summary generation
    _state._eduTopicStats    = topicStats;
    _state._eduStudentData   = studentData;
    _state._eduThreshold     = threshold;
    _state._eduScenarioTitle = scenario?.title || scenarioId;
    _state._eduAvgPct        = avgPct;
    _state._eduNumStudents   = numStudents;

    // Render chart after DOM paint
    requestAnimationFrame(() => _renderEduTopicChart(chartId, topicStats, threshold));
  }

  function _renderEduTopicChart(canvasId, topicStats, threshold) {
    destroyChart('eduTopics');
    const ctx = document.getElementById(canvasId);
    if (!ctx || !topicStats.length) return;
    const colors = topicStats.map(t => t.avgPct >= 75 ? '#10b981' : t.avgPct >= 50 ? '#f59e0b' : '#ef4444');
    const labels = topicStats.map(t => t.name.length > 22 ? t.name.slice(0, 22) + '…' : t.name);
    _state.charts.eduTopics = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '',
            data: topicStats.map(t => t.avgPct),
            backgroundColor: colors,
            borderRadius: 4,
            barThickness: 22,
            order: 1,
          },
          {
            label: 'Průměrné skóre (%)',
            data: [],
            type: 'line',
            borderColor: '#ef4444',
            borderWidth: 2,
            pointRadius: 0,
          },
          {
            label: `Práh (${threshold} %)`,
            data: [],
            type: 'line',
            borderColor: '#f59e0b',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#ffffff',
              boxHeight: 2,
              filter: (item) => item.text !== '',
            },
            onClick: (e, legendItem, legend) => {
              Chart.defaults.plugins.legend.onClick(e, legendItem, legend);
            },
          },
          tooltip: {
            callbacks: {
              label: (item) => item.datasetIndex === 0
                ? `${item.raw} % (${topicStats[item.dataIndex].masteredCount}/${topicStats[item.dataIndex].totalStudents} studentů zvládlo)`
                : `Práh: ${item.raw} %`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true, max: 100,
            ticks: { color: '#fff', callback: v => `${v} %` },
            title: { display: true, text: 'Průměrné skóre (%)', color: '#fff' },
          },
          y: { ticks: { color: '#fff', font: { size: 11 } } },
        },
      },
      plugins: [{
        id: 'avgPctLines',
        afterDatasetsDraw(chart) {
          const { ctx, scales: { x }, chartArea } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save();

          // Červené svislé čáry per téma
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          meta.data.forEach((bar, i) => {
            const xPos = x.getPixelForValue(topicStats[i].avgPct);
            ctx.beginPath();
            ctx.moveTo(xPos, bar.y - bar.height / 2 - 3);
            ctx.lineTo(xPos, bar.y + bar.height / 2 + 3);
            ctx.stroke();
          });

          // Oranžová threshold čára přes celou chartArea
          const xThresh = x.getPixelForValue(threshold);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(xThresh, chartArea.top);
          ctx.lineTo(xThresh, chartArea.bottom);
          ctx.stroke();

          ctx.restore();
        },
      }],
    });
  }

  // Expose callbacks used in HTML
  window.analyticsOnCourseChange = onCourseChange;
  window.analyticsOnScenarioChange = onScenarioChange;
  window.analyticsLoadAll = loadAll;
  window.analyticsGenerateAI = generateAiSummary;
  window.analyticsExportExcel = exportExcel;
})();

