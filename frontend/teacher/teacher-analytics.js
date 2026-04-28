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
    const blacklist = new Set(
      (scenario?.assigned_to_groups || scenario?.assignedToGroups || '')
        .split(',').map(x => x.trim()).filter(Boolean)
    );

    const allGroups = _state.courseGroupsCache || [];
    const accessible = allGroups.filter(g => !blacklist.has(g.groupId));

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
    const isAiScenario = (scenario?.hints || '').includes('[ADAPTIVE:true]');

    let variantNos = [];
    if (!isAiScenario && scenario?.taskConfigJson) {
      try {
        const cfg = JSON.parse(scenario.taskConfigJson);
        if (Array.isArray(cfg.variants) && cfg.variants.length > 1) {
          variantNos = cfg.variants.map(v => Number(v.variantNo) || 1);
        }
      } catch (_) {}
    }
    return { isAiScenario, variantNos };
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
          style="width:16px;height:16px;accent-color:#3b82f6;cursor:pointer;">
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
              style="padding:8px 18px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:14px;font-weight:bold;">
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
    const { isAiScenario, variantNos } = detectScenarioMeta(_state.scenarioId);
    _state.scenarioType = isAiScenario ? 'ai' : 'classic';
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
    showToast(`Načítám data: ${scenarioLabel} | ${groupLabel}`);

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
        get(`/api/analytics/course/${_state.courseId}/at-risk?${params}`),
        get(`/courses/${_state.courseId}/members`),
      ];
      // Kroky per krok načítáme jen pro klasická zadání
      if (!isAiScenario) {
        promises.push(get(`/api/analytics/course/${_state.courseId}/scenario/${_state.scenarioId}/steps?${params}`));
      }

      const results = await Promise.all(promises);
      const summary = results[0];
      const students = results[1];
      const atRisk = results[2];
      const allMembers = results[3] || [];
      try {
        window._analyticsLoadedAttempts = await get(`/courses/${_state.courseId}/attempts`);
      } catch(_) { window._analyticsLoadedAttempts = []; }
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

      const headerEl = document.getElementById('analyticsDataHeader');
      if (headerEl) {
        const daysLabel = _state.days === 9999 ? 'vše' : `posledních ${_state.days} dní`;
        headerEl.textContent = `${scenarioLabel} — ${groupLabel} (${daysLabel})`;
        headerEl.style.display = 'block';
      }
      renderAtRiskTable([]);
      document.getElementById('analyticsAiSummary').innerHTML =
        '<span style="color:var(--text-muted);">Klikněte na „Generovat AI přehled".</span>';
      showToast(`Data načtena: ${students.length} studentů, ${summary.total_submissions ?? 0} odevzdání.`);
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
  function renderKPIs(data) {
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
    if (isAiScenario) {
      _showAiWeaknessPanel('<span style="color:var(--text-muted);">Načítám analýzu slabin studentů…</span>');
      _loadAiWeaknesses(_state.courseId, _state.scenarioId);
      renderQtypeChart(students);
    } else {
      _hideAiWeaknessPanel();
      renderRadarChart(stepsData || []);
      destroyChart('qtype');
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
        msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:180px;color:var(--text-muted);font-size:13px;text-align:center;padding:16px;';
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

  function renderQtypeChart(students) {
    destroyChart('qtype');
    const ctx = document.getElementById('chartQtype');
    if (!ctx) return;

    // Agreguj body per typ otázky ze step_details všech studentů
    const qtypeData = {}; // qtype -> {earned, max, count}
    (window._analyticsLoadedAttempts || []).forEach(a => {
      let sd = [];
      try { sd = JSON.parse(a.stepDetails || '[]'); } catch(_) {}
      if (!Array.isArray(sd)) return;
      sd.forEach(s => {
        const qt = s.task_type || s.qtype || 'open';
        if (!qtypeData[qt]) qtypeData[qt] = { earned: 0, max: 0, count: 0 };
        qtypeData[qt].earned += Number(s.points_earned ?? 0);
        qtypeData[qt].max += Number(s.points_max ?? s.max_points ?? 0);
        qtypeData[qt].count++;
      });
    });

    if (Object.keys(qtypeData).length === 0) {
      ctx.style.display = 'none';
      return;
    }
    ctx.style.display = '';

    const labels = Object.keys(qtypeData).map(qt => QTYPE_LABELS[qt] || qt);
    const successRates = Object.values(qtypeData).map(d => d.max > 0 ? Math.round(d.earned / d.max * 100) : 0);
    const colors = successRates.map(r => r >= 70 ? '#10b981' : r >= 40 ? '#f59e0b' : '#ef4444');

    _state.charts.qtype = new Chart(ctx, {
      type: 'bar',
      indexAxis: 'y',
      data: {
        labels,
        datasets: [{
          label: 'Úspěšnost (%)',
          data: successRates,
          backgroundColor: colors,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: item => `${item.raw} % úspěšnost (${Object.values(qtypeData)[item.dataIndex].count} odpovědí)` } }
        },
        scales: {
          x: { beginAtZero: true, max: 100, ticks: { color: '#fff', callback: v => `${v} %` }, title: { display: true, text: 'Úspěšnost (%)', color: '#fff' } },
          y: { ticks: { color: '#fff' } }
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
          backgroundColor: '#3b82f6',
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

    // Každý pruh musí mít délku rovnou celkovému počtu pokusů.
    // Zelená = plný počet bodů, žlutá = částečné body, červená = 0 bodů nebo chybějící krok.
    const full    = sorted.map(g => g.full_score_students ?? g.successful_students ?? 0);
    const partial = sorted.map(g => g.partial_students ?? 0);
    const zero    = sorted.map(g => g.zero_students ?? 0);
    const totalAttempts = Math.max(
      0,
      ...sorted.map(g => Number(g.total_attempts ?? g.total_students ?? 0))
    );

    _state.charts.radar = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Max body',
            data: full,
            backgroundColor: '#10b981',
            borderRadius: 4,
            barThickness: 20,
          },
          {
            label: 'Částečné body',
            data: partial,
            backgroundColor: '#eab308',
            borderRadius: 4,
            barThickness: 20,
          },
          {
            label: '0 bodů',
            data: zero,
            backgroundColor: '#ef4444',
            borderRadius: 4,
            barThickness: 20,
          },
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
            title: { display: true, text: 'Počet pokusů', color: '#ffffff' },
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
   * Vykreslí tabulku rizikových studentů (#atRiskTableBody).
   * @param {Array<object>} atRisk - Pole rizikových studentů z backendu.
   */
  function renderAtRiskTable(atRisk) {
    const tbody = document.getElementById('atRiskTableBody');
    if (!tbody) return;
    if (!atRisk.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Žádní rizikoví studenti.</td></tr>';
      return;
    }
    tbody.innerHTML = atRisk.map(s => {
      const riskBadge = s.risk_level === 'high'
        ? '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">VYSOKÉ</span>'
        : '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">STŘEDNÍ</span>';
      const trendColor = s.trend === '↑' ? '#10b981' : (s.trend === '↓' ? '#ef4444' : '#9ca3af');
      return `<tr>
        <td>${escHtml(s.displayName || s.userId)}</td>
        <td>${s.avg_score != null ? s.avg_score + ' b.' : '—'}</td>
        <td>${s.attempts}</td>
        <td style="color:${trendColor};font-weight:bold;">${s.trend}</td>
        <td>${s.last_activity ? s.last_activity.slice(0, 10) : '—'}</td>
        <td>${riskBadge}</td>
      </tr>`;
    }).join('');
  }

  /**
   * Zavolá backend endpoint /api/analytics/ai-summary a zobrazí vygenerovaný
   * AI přehled (markdown → HTML) v boxu #analyticsAiSummary.
   */
  async function generateAiSummary() {
    if (!_state.courseId) { showToast('Nejprve načtěte data.', true); return; }
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

  /**
   * Stáhne analytická data kurzu jako CSV soubor přes GET /export-csv endpoint.
   */
  function exportCSV() {
    if (!_state.courseId) { showToast('Nejprve načtěte data.', true); return; }
    const params = new URLSearchParams({ days: _state.days });
    if (_state.scenarioId) params.set('scenario_id', _state.scenarioId);
    const url = `${API_BASE}/api/analytics/course/${_state.courseId}/export-csv?${params}`;
    showToast('Připravuji CSV export…');
    fetch(url, { headers: getHeaders() })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `analytika_${_state.courseId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        showToast('CSV exportováno.');
      })
      .catch(e => showToast('Export selhal: ' + e.message, true));
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

  // Expose callbacks used in HTML
  window.analyticsOnCourseChange = onCourseChange;
  window.analyticsOnScenarioChange = onScenarioChange;
  window.analyticsLoadAll = loadAll;
  window.analyticsGenerateAI = generateAiSummary;
  window.analyticsExportCSV = exportCSV;
})();
