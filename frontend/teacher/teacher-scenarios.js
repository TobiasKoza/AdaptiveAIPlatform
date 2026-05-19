async function openScenarioDetail(scenarioId, courseId, title, description, instructions, deadline, maxAttempts, assignedBy, additionalManagers, hints, assignedToGroups, difficulty) {
      activeDetailScenarioId = scenarioId;
      activeDetailScenarioCourseId = courseId;
      
      // Dočasné uložení původních parametrů
      currentOpenScenarioParams = { scenarioId, courseId, title, description, instructions, deadline, maxAttempts, assignedBy, additionalManagers, hints, assignedToGroups, difficulty };

      // Reset všeho před otevřením — žádná stará data
      document.getElementById("detailScenarioTitleInput").value = title || "";
      document.getElementById("scenarioDetailStatus").innerText = "";
      document.getElementById("detailScenarioManagers").innerHTML = "Načítám...";
      document.getElementById("detailScenarioGroupsSimple").innerHTML = "Načítám...";
      const _addGroupRow = document.getElementById('addScenarioGroupRow');
      if (_addGroupRow) _addGroupRow.style.display = 'none';
      document.getElementById("scenarioDetailModal").style.display = "flex";

      try {
          // Stažení čerstvých dat, aby se propsaly změny z databáze
          const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios`, { headers: getHeaders() });
          if (res.ok) {
              const scenarios = await res.json();
              const freshScenario = scenarios.find(s => s.scenarioId === scenarioId);
              
              if (freshScenario) {
                  // Přepíšeme argumenty čerstvými daty
                  assignedBy = freshScenario.assignedBy;
                  additionalManagers = freshScenario.additionalManagers;
                  assignedToGroups = freshScenario.assigned_to_groups;
                  
                  // Uložíme čerstvá data i pro budoucí úpravy v rámci okna
                  currentOpenScenarioParams.assignedBy = assignedBy;
                  currentOpenScenarioParams.additionalManagers = additionalManagers;
                  currentOpenScenarioParams.assignedToGroups = assignedToGroups;
                  currentOpenScenarioParams.hints = freshScenario.hints;
              }
          }
      } catch { }

      document.getElementById("scenarioDetailStatus").innerText = "";

      // Načtení UI dat s garantovaně čerstvými hodnotami
      loadScenarioManagersUI(courseId, assignedBy, additionalManagers);
      loadScenarioGroupsSimpleUI(courseId, assignedToGroups).catch(() => {});
}

    function loadScenarioManagersUI(courseId, assignedBy, additionalManagers) {
        const managersDiv = document.getElementById('detailScenarioManagers');
        const addSelect = document.getElementById('scenarioDetailAddTeacherSelect');
        const courseTeachers = allLoadedUsers.filter(u => u.course_ids && u.course_ids.includes(courseId) && ['teacher', 'admin'].includes(u.global_role));
        const addedManagersArr = (additionalManagers || "").split(',').map(x => x.trim()).filter(x => x.length > 0);
        const extraManagers = allLoadedUsers.filter(u => addedManagersArr.includes(u.user_id) && !courseTeachers.includes(u));
        const allManagers = courseTeachers.concat(extraManagers);
        
        managersDiv.innerHTML = allManagers.map(m => {
            const isCreator = m.user_id === assignedBy;
            const isCourseTeacher = courseTeachers.includes(m);
            const badgeHtml = isCreator ? `<span class="badge" style="background:#fef3c7; color:#d97706; border:1px solid #f59e0b; font-size:10px;">Autor</span>` 
                                       : (isCourseTeacher ? `<span class="badge" style="background:#f3f4f6; color:#4b5563; border:1px solid #d1d5db; font-size:10px;">Správce kurzu</span>` : "");
            let actionHtml = (!isCreator && !isCourseTeacher) ? `<button class="btn-small" style="background:#dc2626; padding:2px 8px;" onclick="removeTeacherFromScenario('${m.user_id}')">Odebrat</button>` : "";
            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span>• <strong>${m.display_name || m.email}</strong> ${badgeHtml}</span>${actionHtml}</div>`;
        }).join("") || "Žádní dodateční správci.";

        const alreadyManagersIds = allManagers.map(m => m.user_id);
        const others = allLoadedUsers.filter(u => ['teacher', 'admin'].includes(u.global_role) && !alreadyManagersIds.includes(u.user_id));
        addSelect.innerHTML = '<option value="">— Vyberte učitele —</option>' + others.map(t => `<option value="${t.user_id}">${t.display_name || t.email}</option>`).join("");
    }

    async function updateScenarioManagers(newManagersArray) {
        try {
            const res = await fetch(`${API_BASE}/courses/${activeDetailScenarioCourseId}/scenarios/${activeDetailScenarioId}`, {
                method: "PUT", headers: getHeaders(),
                body: JSON.stringify({ additionalManagers: newManagersArray.join(",") })
            });
            if (!res.ok) throw new Error(await res.text());

            await loadScenarios();
            currentOpenScenarioParams.additionalManagers = newManagersArray.join(",");

            // OPRAVA: Otevřeme znovu jen pokud to uživatel mezitím křížkem nezavřel.
            // Navíc sem posíláme VŠECH 12 parametrů, aby se při přidání správce nesmazal AI štítek!
            if (document.getElementById("scenarioDetailModal").style.display !== "none") {
                openScenarioDetail(
                    currentOpenScenarioParams.scenarioId,
                    currentOpenScenarioParams.courseId,
                    currentOpenScenarioParams.title,
                    currentOpenScenarioParams.description,
                    currentOpenScenarioParams.instructions,
                    currentOpenScenarioParams.deadline,
                    currentOpenScenarioParams.maxAttempts,
                    currentOpenScenarioParams.assignedBy,
                    currentOpenScenarioParams.additionalManagers,
                    currentOpenScenarioParams.hints,
                    currentOpenScenarioParams.assignedToGroups,
                    currentOpenScenarioParams.difficulty
                );
            }
        } catch (err) { showToast("Chyba: " + err.message, true); }
    }

    function addTeacherToScenarioFromDetail() {
        const userId = document.getElementById('scenarioDetailAddTeacherSelect').value;
        if (!userId) return;
        let arr = (currentOpenScenarioParams.additionalManagers || "").split(",").map(s => s.trim()).filter(x => x);
        if (!arr.includes(userId)) arr.push(userId);
        updateScenarioManagers(arr);
    }

    function removeTeacherFromScenario(userId) {
        customConfirm("Odebrat správce", "Odebrat tohoto učitele ze správy tohoto zadání?", "Ano, odebrat", () => {
            let arr = (currentOpenScenarioParams.additionalManagers || "").split(",").map(s => s.trim()).filter(x => x);
            arr = arr.filter(id => id !== userId);
            updateScenarioManagers(arr);
            showToast("Správce byl úspěšně odebrán.");
        });
    }

    async function toggleScenarioStatus(courseId, scenarioId, newStatus) {
        try {
            // 1. Okamžitě změníme barvu selectu pro lepší odezvu (UX)
            const selectEl = event.target;
            const isActive = newStatus !== "inactive";
            selectEl.classList.remove('status-select-active', 'status-select-inactive');
            selectEl.classList.add(isActive ? 'status-select-active' : 'status-select-inactive');
            selectEl.style.background = '';
            selectEl.style.border = '';

            // 2. Pošleme požadavek na backend
            const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios/${scenarioId}`, {
                method: "PUT",
                headers: getHeaders(),
                body: JSON.stringify({ status: newStatus })
            });
            
            if (!res.ok) throw new Error(await res.text());
        } catch (err) { 
            showToast("Chyba při změně stavu: " + err.message, true);
            await loadScenarios(); // V případě chyby tabulku raději reloadneme do původního stavu
        }
    }

    async function saveScenarioDetail() {
      if (!activeDetailScenarioId || !activeDetailScenarioCourseId) {
        showToast("Chybí identifikace zadání.", true);
        return;
      }

      const title = document.getElementById("detailScenarioTitleInput").value.trim();
      const description = document.getElementById("detailScenarioDescriptionInput").value.trim();
      const instructions = document.getElementById("detailScenarioInstructionsInput").value.trim();
      const deadline = document.getElementById("detailScenarioDeadlineInput").value;
      const attemptMode = document.getElementById("detailScenarioAttemptsInput").value;
      const maxAttempts = attemptMode === "custom" ? (parseInt(document.getElementById("detailScenarioCustomAttemptsInput").value, 10) || 1) : 0;
      const timeLimit = parseInt(document.getElementById("detailScenarioTimeLimitInput").value, 10) || 60;
      const targetGroup = Array.from(document.querySelectorAll("#detailScenarioTargetGroupList input:checked")).map(cb => cb.value).join(",");
      const gStyle = document.getElementById("detailScenarioGradingStyleInput").value;
      const gMax = parseInt(document.getElementById("detailScenarioMaxPointsInput").value, 10) || 10;
      const taskTypeEl = document.getElementById("detailScenarioTaskTypeInput");
      const taskType = taskTypeEl ? taskTypeEl.value : "practice";

      if (!title) {
        showToast("Název zadání nesmí být prázdný.", true);
        return;
      }

      showToast("Ukládám změny...");

      try {
        // Kontrola, zda původní zadání mělo příznak adaptivního AI mentora
        const oldHints = currentOpenScenarioParams?.hints || "";
        const isAdaptive = oldHints.includes("[ADAPTIVE:true]") || currentOpenScenarioParams?.difficulty === "adaptive";

        let updatedHints = `[TIME_LIMIT:${timeLimit}][GRADING:${gStyle}${gStyle === 'points' ? ':' + gMax : ''}]`;
        if (!isAdaptive) {
            updatedHints += `[TYPE:${taskType}]`;
        }
        
        if (isAdaptive) {
            // Teď už máme na počet podúkolů políčko v UI, takže si ho při uložení rovnou přečteme
            const newSubtasks = document.getElementById("detailScenarioSubtasksInput").value || 3;
            updatedHints += `[ADAPTIVE:true][SUBTASKS:${newSubtasks}]`;

            // ZACHRÁNA OSTATNÍCH AI TAGŮ: Musíme přenést vše, co definuje AI chování
            const getOldTag = (tag) => {
                const m = oldHints.match(new RegExp(`\\[\\s*${tag}\\s*:([\\s\\S]*?)\\]`));
                return m ? m[1].trim() : null;
            };

            const diff = getOldTag('DIFFICULTY'); if (diff) updatedHints += `[DIFFICULTY:${diff}]`;
            const tags = getOldTag('TAGS');       if (tags) updatedHints += `[TAGS:${tags}]`;
            const tools = getOldTag('TOOLS');     if (tools) updatedHints += `[TOOLS:${tools}]`;
            const skip = getOldTag('ALLOW_SKIP'); if (skip) updatedHints += `[ALLOW_SKIP:${skip}]`;
            const qtypes = getOldTag('QTYPES');   if (qtypes) updatedHints += `[QTYPES:${qtypes}]`;
        }
        document.querySelectorAll(".extra-attempt-block").forEach(block => {
            const num = block.getAttribute("data-num");
            const desc = block.querySelector(".ex-desc").value.trim();
            const inst = block.querySelector(".ex-inst").value.trim();
            const rub = block.querySelector(".ex-rub").value.trim();
            const exp = block.querySelector(".ex-exp").value.trim();
            const dl = block.querySelector(".ex-dl").value;
            if (desc) updatedHints += `[DESC${num}:${desc}]`;
            if (inst) updatedHints += `[INST${num}:${inst}]`;
            if (rub) updatedHints += `[RUB${num}:${rub}]`;
            if (exp) updatedHints += `[EXP${num}:${exp}]`;
            if (dl) updatedHints += `[DL${num}:${dl}]`;
        });

        const res = await fetch(`${API_BASE}/courses/${activeDetailScenarioCourseId}/scenarios/${activeDetailScenarioId}`, {
          method: "PUT",
          headers: getHeaders(),
          body: JSON.stringify({
            title: title,
            description: description,
            instructions: instructions, 
            deadline: deadline || null,
            maxAttempts: maxAttempts,
            hints: updatedHints,
            assigned_to_groups: targetGroup ? targetGroup : null // NOVÉ
          })
        });

        if (!res.ok) throw new Error(await res.text());

        await loadScenarios();
        await loadAttempts(); // OPRAVA: Dá signál i spodní tabulce, ať si nahraje nové texty

        // Okamžité zavření okna a zobrazení úspěšné bubliny (žádné otravné čekání)
        document.getElementById("scenarioDetailModal").style.display = "none";
        showToast("Změny v zadání byly úspěšně uloženy.");

      } catch (err) {
        showToast(`Chyba: ${err.message}`, true);
      }
    }

    window.deleteScenarioFromSelectedCourse = function(courseId, scenarioId, title) {
      customConfirm("Smazat zadání", `Opravdu chcete smazat zadání "${title}" z tohoto kurzu?`, "Ano, smazat", async () => {
          // Okamžitě zamkni tlačítko Smazat a uprav vizuál přes CSS proměnné
          const deleteBtn = document.querySelector('#scenarioDetailModal button[onclick*="deleteScenario"]');
          if (deleteBtn) { 
              deleteBtn.disabled = true; 
              deleteBtn.style.background = "var(--bg-status, #e5e7eb)"; 
              deleteBtn.style.color = "var(--text-muted, #6b7280)";
              deleteBtn.style.pointerEvents = "none"; 
              deleteBtn.textContent = "Mažu..."; 
          }
          
          showToast(`Mažu zadání "${title}"...`);

          try {
            const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios/${scenarioId}`, {
              method: "DELETE", headers: getHeaders()
            });

            if (!res.ok) throw new Error(await res.text());

            // Okamžité zavření modálního okna
            document.getElementById('scenarioDetailModal').style.display = 'none';
            
            // Finální hláška o úspěšném smazání
            showToast(`Zadání "${title}" bylo úspěšně smazáno.`);
            
            // Obnovení tabulky se zadáními
            await loadScenarios();
            
            // Očištění tlačítka (aby bylo funkční pro případné další otevření modalu)
            if (deleteBtn) { 
                deleteBtn.disabled = false; 
                deleteBtn.style.background = "var(--error, #dc2626)"; 
                deleteBtn.style.color = "#ffffff";
                deleteBtn.style.pointerEvents = "auto"; 
                deleteBtn.textContent = "Smazat celé zadání"; 
            }
          } catch (err) {
            // V případě chyby tlačítko vrátíme do původního stavu
            if (deleteBtn) { 
                deleteBtn.disabled = false; 
                deleteBtn.style.background = "var(--error, #dc2626)"; 
                deleteBtn.style.color = "#ffffff";
                deleteBtn.style.pointerEvents = "auto"; 
                deleteBtn.textContent = "Smazat celé zadání"; 
            }
            showToast("Chyba při mazání zadání: " + err.message, true);
          }
      });
    }






    let attemptsSearchDebounce = null;
const attemptsDataCache = {};

// Uložení filtrů do localStorage
function saveAttemptsFilters() {
    const courseId = document.getElementById("attemptsCourseSelect")?.value || "";
    const scenarioId = document.getElementById("attemptsScenarioSelect")?.value || "";
    const userSearch = document.getElementById("attemptsUserSearch")?.value || "";
    const groupFilter = document.getElementById("attemptsGroupFilter")?.value || "";
    localStorage.setItem('attemptsFilters', JSON.stringify({ courseId, scenarioId, userSearch, groupFilter }));
}

// Obnovení filtrů z localStorage
window.restoreAttemptsFilters = async function() {
    const saved = localStorage.getItem('attemptsFilters');
    if (!saved) return;
    try {
        const f = JSON.parse(saved);
        const courseSelect = document.getElementById("attemptsCourseSelect");
        const userSearch = document.getElementById("attemptsUserSearch");
        const groupFilter = document.getElementById("attemptsGroupFilter");

        if (f.courseId && courseSelect) {
            courseSelect.value = f.courseId;
            if (courseSelect.value === f.courseId) {
                await loadAttemptsScenarios(false); // false = použij cache, nespouštěj znovu
                const scenarioSelect = document.getElementById("attemptsScenarioSelect");
                if (f.scenarioId && scenarioSelect) scenarioSelect.value = f.scenarioId;
            }
        }
        if (userSearch && f.userSearch) userSearch.value = f.userSearch;
        if (groupFilter && f.groupFilter) groupFilter.value = f.groupFilter;

        // Načti data jen pokud cache ještě neexistuje
        if (f.courseId && !attemptsDataCache[f.courseId]) {
            await loadAttempts(true);
        } else if (f.courseId) {
            filterAttemptsLocally();
        }
    } catch { }
};

function debounceLoadAttempts() {
  clearTimeout(attemptsSearchDebounce);
  attemptsSearchDebounce = setTimeout(() => {
    saveAttemptsFilters();
    filterAttemptsLocally();
  }, 350);
}

function renderAttemptsTable(attempts, submissions, scenarios) {
  const courseId = document.getElementById("attemptsCourseSelect").value;
  const scenarioFilter = document.getElementById("attemptsScenarioSelect").value;
  const userSearch = (document.getElementById("attemptsUserSearch")?.value || "").toLowerCase().trim();
  const groupFilter = document.getElementById("attemptsGroupFilter")?.value || "";
  const tbody = document.getElementById("attemptsTableBody");

  if (!courseId) return;

  window.allLoadedScenariosForAttempts = scenarios;

  const scenarioTitleMap = new Map(scenarios.map(s => [s.scenarioId, s.title]));
  const emailPrefix = (email) => email ? email.split('@')[0] : '';
  const userNameMap = new Map(allLoadedUsers.map(u => [u.user_id, emailPrefix(u.email) || u.user_id]));
  const userGroupMap = new Map(
    allLoadedUsers.map(u => [
      u.user_id,
      Array.isArray(u.group_ids)
        ? u.group_ids
        : (u.group_ids ? String(u.group_ids).split(',').map(s => s.trim()) : [])
    ])
  );

  const formatDateTime = (v) => v ? new Date(v).toLocaleString("cs-CZ") : "-";

  const getLabRunState = (status) => {
    switch ((status || "").toLowerCase()) {
      case "succeeded": return { text: "Prostředí běží", badgeClass: "status-succeeded" };
      case "failed": return { text: "Chyba", badgeClass: "status-failed" };
      case "started":
      case "running":
      case "provisioning": return { text: "Spouští se", badgeClass: "status-queued" };
      case "queued": return { text: "Ve frontě", badgeClass: "status-queued" };
      case "finished":
      case "archived": return { text: "Ukončeno", badgeClass: "badge" };
      default: return { text: status || "-", badgeClass: "badge" };
    }
  };

  const getEvaluationState = (learningStatus) => {
    switch ((learningStatus || "").toLowerCase()) {
      case "evaluated": return "Vyhodnoceno";
      case "submitted": return "Čeká na hodnocení";
      case "started": return "Rozpracováno";
      case "created": return "Založeno";
      case "archived": return "Dokončeno";
      case "completed":
      case "finished": return "Čeká na odevzdání";
      default: return learningStatus || "Nehodnoceno";
    }
  };

  let filtered = attempts;

  if (scenarioFilter) {
    filtered = filtered.filter(a => a.scenarioId === scenarioFilter);
  }

  if (userSearch) {
    filtered = filtered.filter(a => {
      const name = (userNameMap.get(a.userId) || "").toLowerCase();
      return name.includes(userSearch) || String(a.userId || "").toLowerCase().includes(userSearch);
    });
  }

  if (groupFilter) {
    filtered = filtered.filter(a => {
      const gIds = userGroupMap.get(a.userId) || [];
      return gIds.includes(groupFilter);
    });
  }

  if (!filtered.length) {
    tbody.innerHTML = "<tr><td colspan='8'>Žádné pokusy neodpovídají filtrům.</td></tr>";
    loadedAttempts = [];
    loadedSubmissions = submissions;
    return;
  }

  const groupedAttempts = new Map();
  attempts.forEach(a => {
    const key = `${a.userId}__${a.scenarioId}`;
    if (!groupedAttempts.has(key)) groupedAttempts.set(key, []);
    groupedAttempts.get(key).push(a);
  });

  const attemptOrderMap = new Map();
  const totalAttemptsMap = new Map();
  const latestAttemptIds = new Set();

  groupedAttempts.forEach((group, key) => {
    totalAttemptsMap.set(key, group.length);

    group
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .forEach((a, i) => {
          const runNum = a.runNumber || (i + 1);
          const scenario = window.allLoadedScenariosForAttempts?.find(s => s.scenarioId === a.scenarioId);
          const hintsStr = scenario?.hints || "";
          const getTag = (tag) => {
              const m = hintsStr.match(new RegExp(`\\[\\s*${tag}\\s*:([\\s\\S]*?)\\]`));
              return m ? m[1].trim() : null;
          };
          const mappedVariant = getTag("MAP" + runNum);
          const variantNum = mappedVariant ? parseInt(mappedVariant, 10) : null;
          const variantLabel = variantNum !== null
              ? `<br><span style="font-size:11px; color:var(--text-muted);">Varianta ${variantNum}</span>`
              : '';
          attemptOrderMap.set(a.attemptId, `${runNum}. pokus${variantLabel}`);
      });

    if (group.length > 0) {
      latestAttemptIds.add(group[group.length - 1].attemptId);
    }
  });

  tbody.innerHTML = filtered
    .sort((a, b) => new Date(b.submittedAt || b.createdAt).getTime() - new Date(a.submittedAt || a.createdAt).getTime())
    .map(a => {
      const labRun = getLabRunState(a.status);
      const totalForStudent = totalAttemptsMap.get(`${a.userId}__${a.scenarioId}`) || 0;
      const nextAttemptNum = totalForStudent + 1;

      const scenario = window.allLoadedScenariosForAttempts?.find(s => s.scenarioId === a.scenarioId);
      const maxAttempts = scenario ? (scenario.maxAttempts || 0) : 0;

      const isLatest = latestAttemptIds.has(a.attemptId);
      let allowNextBtnHtml = '';

      if (isLatest) {
        if (a.status === 'archived') {
          allowNextBtnHtml = `<button class="btn-small" style="background:#059669; cursor:default; opacity: 1; color: white;" disabled>Povolen ${nextAttemptNum}. pokus</button>`;
        } else if (maxAttempts === 0 || nextAttemptNum <= maxAttempts) {
          const _isAiBtnScenario = (scenario?.difficulty === 'adaptive') || (scenario?.hints || '').includes('[ADAPTIVE:true]');
          allowNextBtnHtml = `<button class="btn-small" style="background:#f59e0b; transition: filter 0.15s, transform 0.1s;" onmouseover="this.style.filter='brightness(1.15)'" onmouseout="this.style.filter=''" onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'" data-allow-btn="${escapeJsString(a.scenarioId)}-${escapeJsString(a.userId)}" onclick="allowNextAttempt('${escapeJsString(a.scenarioId)}', '${escapeJsString(a.userId)}', '${escapeJsString(userNameMap.get(a.userId) || a.userId)}', ${nextAttemptNum}, ${_isAiBtnScenario})" title="Povolit studentovi další pokus.">Povolit ${nextAttemptNum}. pokus</button>`;
        }
      }

      let evalBtnHtml = "";
      const isEvaluated = a.learningStatus === "evaluated" || (a.score != null && a.score !== "") || (a.feedbackText && a.feedbackText.trim() !== "");
      if (!isEvaluated) allowNextBtnHtml = '';

      let evalStateText = getEvaluationState(a.learningStatus);
      let gradeBadgeHtml = "-";

      if (isEvaluated) {
        const _isEduType = (scenario?.hints || '').includes('[TYPE:ai_education]');
        evalStateText = "Vyhodnoceno";

        if (_isEduType) {
            gradeBadgeHtml = `<span class="badge" style="background:#10b981; color:white;">Dokončeno</span>`;
        } else {
            let gStyle = 'points';
            let gMax = 10;
            const gm = (scenario?.hints || "").match(/\[GRADING:\s*([a-zA-Z]+)\s*:?\s*(\d+)?\s*\]/i);
            if (gm) {
              gStyle = gm[1];
              if (gm[2]) gMax = parseInt(gm[2], 10);
            }
            if (!gm || !gm[2]) {
              const _fallback = Number(scenario?.maxPoints) || (scenario?.maxAttempts > 20 ? scenario.maxAttempts : 0);
              if (_fallback > 0) gMax = _fallback;
            }
            let effectiveScore = a.score;
            if (gStyle !== 'none' && (effectiveScore === null || effectiveScore === undefined || effectiveScore === "")) {
                effectiveScore = 0;
            }
            const _threshM = (scenario?.hints || '').match(/\[PASS_THRESHOLD:(\d+)\]/);
            const _thresh = _threshM ? parseInt(_threshM[1], 10) : null;
            if (_thresh !== null && effectiveScore !== null && effectiveScore !== undefined) {
                const _pct = gStyle === 'percent' ? Number(effectiveScore) : (gMax > 0 ? Math.round((Number(effectiveScore) / gMax) * 100) : 0);
                const _passed = _pct >= _thresh;
                gradeBadgeHtml = `<span class="badge" style="background:${_passed ? '#22c55e' : '#ef4444'}; color:white; font-size:14px;">${_passed ? '✓' : '✗'}</span>`;
            } else {
                const _gradeFromScore = window.getGradeFromScore || function(score, info) {
                    if (score === null || score === undefined || score === "") return "-";
                    const s = Number(score);
                    const pct = info.style === 'percent' ? s : (info.max > 0 ? (s / info.max) * 100 : 0);
                    if (pct >= 90) return "A"; if (pct >= 80) return "B"; if (pct >= 70) return "C";
                    if (pct >= 60) return "D"; if (pct >= 50) return "E"; return "F";
                };
                const grade = _gradeFromScore(effectiveScore, { style: gStyle, max: gMax });
                const gColor = grade === '-' ? '#6b7280' : (grade === 'F' ? '#ef4444' : '#22c55e');
                gradeBadgeHtml = `<span class="badge" style="background:${gColor}; color:white;">${grade}</span>`;
            }
        }
        evalBtnHtml = `<button class="btn-small" style="background:var(--btn-primary); transition: filter 0.15s, transform 0.1s;" onmouseover="this.style.filter='brightness(1.15)'" onmouseout="this.style.filter=''" onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'" onclick="openEvaluation('${a.attemptId}')">Upravit hodnocení</button>`;
      } else if (evalStateText === "Čeká na odevzdání" || evalStateText === "Rozpracováno" || evalStateText === "Založeno") {
        // Tlačítko skryjeme, dokud student neodevzdá řešení
        evalBtnHtml = ``; 
      } else {
        evalBtnHtml = `<button class="btn-small" style="background:#16a34a; transition: filter 0.15s, transform 0.1s;" onmouseover="this.style.filter='brightness(1.15)'" onmouseout="this.style.filter=''" onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'" onclick="openEvaluation('${a.attemptId}')">Hodnotit</button>`;
      }

      return `
        <tr>
          <td>${escapeHtml(userNameMap.get(a.userId) || a.userId)}</td>
          <td><strong>${escapeHtml(scenarioTitleMap.get(a.scenarioId) || a.scenarioId)}</strong></td>
          <td>${attemptOrderMap.get(a.attemptId) || "-"}</td>
          <td><span class="badge ${labRun.badgeClass}">${escapeHtml(labRun.text)}</span></td>
          <td>${escapeHtml(evalStateText)}</td>
          <td style="text-align:center;">${gradeBadgeHtml}</td>
          <td>${escapeHtml(formatDateTime(a.submittedAt || a.updatedAt || a.createdAt))}</td>
          <td style="white-space: nowrap;">
            ${evalBtnHtml}
            ${allowNextBtnHtml}
          </td>
        </tr>`;
    }).join("");

  loadedAttempts = filtered;
  loadedSubmissions = submissions;
}

function filterAttemptsLocally() {
  const courseId = document.getElementById("attemptsCourseSelect").value;
  const tbody = document.getElementById("attemptsTableBody");

  if (!courseId) return;

  const cached = attemptsDataCache[courseId];
  // BUG FIX: cache může existovat jen se scenarios (z loadAttemptsScenarios), bez attempts
  if (!cached || !cached.attempts) {
    tbody.innerHTML = "<tr><td colspan='8'>Klikněte na Aktualizovat pro načtení dat.</td></tr>";
    return;
  }

  renderAttemptsTable(cached.attempts, cached.submissions, cached.scenarios);
}

async function loadAttemptsScenarios(forceRefresh = false) {
  const courseId = document.getElementById("attemptsCourseSelect").value;
  const select = document.getElementById("attemptsScenarioSelect");
  const groupSel = document.getElementById("attemptsGroupFilter");

  select.innerHTML = '<option value="">— Vyberte kurz —</option>';
  if (groupSel) groupSel.innerHTML = '<option value="">— Vyberte kurz —</option>';
  if (!courseId || courseId === '__all__') return;

  select.innerHTML = '<option value="">Načítám zadání…</option>';
  select.disabled = true;
  if (groupSel) { groupSel.innerHTML = '<option value="">— Vyberte zadání —</option>'; groupSel.disabled = false; }

  try {
    let scenarios = attemptsDataCache[courseId]?.scenarios;

    if (!scenarios || forceRefresh) {
      const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios`, { headers: getHeaders() });
      if (!res.ok) throw new Error("Nepodařilo se načíst zadání.");
      scenarios = await res.json();

      attemptsDataCache[courseId] = {
        ...(attemptsDataCache[courseId] || {}),
        scenarios
      };
    }

    select.innerHTML = '<option value="">— Všechna zadání —</option>' +
      scenarios.map(s => `<option value="${s.scenarioId}">${s.title || s.scenarioId}</option>`).join("");
  } catch (e) {
    select.innerHTML = '<option value="">— Všechna zadání —</option>';
  } finally {
    select.disabled = false;
  }
}

async function populateAttemptsGroups() {
  const courseId = document.getElementById("attemptsCourseSelect").value;
  const scenarioId = document.getElementById("attemptsScenarioSelect").value;
  const groupSel = document.getElementById("attemptsGroupFilter");
  if (!groupSel) return;

  if (!scenarioId) {
    groupSel.innerHTML = '<option value="">— Vyberte zadání —</option>';
    return;
  }

  groupSel.innerHTML = '<option value="">Načítám skupiny…</option>';
  groupSel.disabled = true;

  try {
    const [groups, scenarios] = await Promise.all([
      fetch(`${API_BASE}/courses/${courseId}/groups`, { headers: getHeaders() }).then(r => r.ok ? r.json() : []),
      Promise.resolve(attemptsDataCache[courseId]?.scenarios || []),
    ]);

    const scenario = scenarios.find(s => s.scenarioId === scenarioId);
    const blacklist = new Set(
      (scenario?.assigned_to_groups || scenario?.assignedToGroups || '')
        .split(',').map(x => x.trim()).filter(Boolean)
    );

    const accessible = (groups || []).filter(g => !blacklist.has(g.groupId));
    groupSel.innerHTML = '<option value="">— Všechny skupiny —</option>' +
      accessible.map(g => `<option value="${g.groupId}">${escapeHtml(g.title || g.groupId)}</option>`).join("");
  } catch (e) {
    groupSel.innerHTML = '<option value="">— Všechny skupiny —</option>';
  } finally {
    groupSel.disabled = false;
  }
}

async function loadAttempts(forceRefresh = false) {
  const courseId = document.getElementById("attemptsCourseSelect").value;
  const tbody = document.getElementById("attemptsTableBody");

  if (!courseId) return;

  // Všechny kurzy najednou
  if (courseId === '__all__') {
    if (!forceRefresh && attemptsDataCache['__all__']?.attempts) {
      renderAttemptsTable(
        attemptsDataCache['__all__'].attempts,
        attemptsDataCache['__all__'].submissions,
        attemptsDataCache['__all__'].scenarios
      );
      return;
    }
    tbody.innerHTML = "<tr><td colspan='8'>Načítám pokusy ze všech kurzů...</td></tr>";
    try {
      const courseIds = allLoadedCourses.map(c => c.courseId);
      const results = await Promise.all(courseIds.map(cid =>
        Promise.all([
          fetch(`${API_BASE}/courses/${cid}/attempts`, { headers: getHeaders() }).then(r => r.ok ? r.json() : []),
          fetch(`${API_BASE}/courses/${cid}/submissions`, { headers: getHeaders() }).then(r => r.ok ? r.json() : []),
          fetch(`${API_BASE}/courses/${cid}/scenarios`, { headers: getHeaders() }).then(r => r.ok ? r.json() : [])
        ])
      ));
      const attempts = results.flatMap(r => r[0]);
      const submissions = results.flatMap(r => r[1]);
      const scenarios = results.flatMap(r => r[2]);
      attemptsDataCache['__all__'] = { attempts, submissions, scenarios };
      renderAttemptsTable(attempts, submissions, scenarios);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan='8'>Chyba: ${err.message}</td></tr>`;
    }
    return;
  }

  if (!forceRefresh && attemptsDataCache[courseId]?.attempts && attemptsDataCache[courseId]?.submissions && attemptsDataCache[courseId]?.scenarios) {
    renderAttemptsTable(
      attemptsDataCache[courseId].attempts,
      attemptsDataCache[courseId].submissions,
      attemptsDataCache[courseId].scenarios
    );
    return;
  }

  tbody.innerHTML = "<tr><td colspan='8'>Načítám...</td></tr>";

  try {
    const [attemptsRes, submissionsRes, scenariosRes] = await Promise.all([
      fetch(`${API_BASE}/courses/${courseId}/attempts`, { headers: getHeaders() }),
      fetch(`${API_BASE}/courses/${courseId}/submissions`, { headers: getHeaders() }),
      fetch(`${API_BASE}/courses/${courseId}/scenarios`, { headers: getHeaders() })
    ]);

    if (!attemptsRes.ok || !submissionsRes.ok || !scenariosRes.ok) {
      throw new Error("Chyba při komunikaci s API.");
    }

    const attempts = await attemptsRes.json();
    const submissions = await submissionsRes.json();
    const scenarios = await scenariosRes.json();

    attemptsDataCache[courseId] = { attempts, submissions, scenarios };

    renderAttemptsTable(attempts, submissions, scenarios);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan='8'>Chyba: ${err.message}</td></tr>`;
  }
}

    async function viewArtifact(attemptId) {
      const panel = document.getElementById("artifactPanel");
      const output = document.getElementById("artifactOutput");
      document.getElementById("artifactMetadata").innerText = `Attempt ID: ${attemptId}`;
      panel.style.display = "block";
      output.innerText = "Načítám soubor z Azure File Share...";
      try {
        const res = await fetch(`${API_BASE}/attempts/${attemptId}/artifact`, { headers: getHeaders() });
        if (!res.ok) throw new Error(await res.text());
        output.innerText = await res.text();
      } catch (err) { output.innerText = `Nepodařilo se načíst artefakt.\n\nDůvod: ${err.message}`; }
    }


    // === SCENARIO GROUP MANAGEMENT (CLEAN APPROACH) ===

    async function loadScenarioGroupsSimpleUI(courseId, assignedToGroups) {
        const groupsDiv = document.getElementById('detailScenarioGroupsSimple');
        const addRow = document.getElementById('addScenarioGroupRow');
        if (addRow) addRow.style.display = 'none';

        // 1. Načteme živá data členů kurzu
        let allCourseGroups = [];
        try {
            const membersRes = await fetch(`${API_BASE}/courses/${courseId}/members`, { headers: getHeaders() });
            const members = await membersRes.json();
            const studentMemberIds = members
                .filter(m => m.role === 'student')
                .map(m => String(m.userId || '').trim().toLowerCase());

            const courseGroupIds = new Set();
            allLoadedUsers.forEach(u => {
                const uid = String(u.user_id || u.email || '').trim().toLowerCase();
                if (u.global_role === 'student' && studentMemberIds.includes(uid)) {
                    if (u.group_ids) {
                        const gIds = Array.isArray(u.group_ids) ? u.group_ids : String(u.group_ids).split(',');
                        gIds.forEach(gid => { const c = String(gid).trim(); if (c) courseGroupIds.add(c); });
                    }
                }
            });
            allCourseGroups = Array.from(courseGroupIds);
        } catch { }

        // Uložíme seznam skupin pro use v remove/restore funkcích
        currentOpenScenarioParams.allCourseGroupIds = allCourseGroups;

        // 2. WHITELIST: prázdné = všichni vidí, HIDDEN_FROM_ALL = nikdo nevidí
        const isHiddenFromAll = (assignedToGroups || "") === "HIDDEN_FROM_ALL";
        const allowedArr = isHiddenFromAll ? [] : (assignedToGroups || "").split(',')
            .map(x => x.trim()).filter(x => x.length > 0);
        const everyoneSeesIt = !isHiddenFromAll && allowedArr.length === 0;

        // 3. Zobrazíme VŠECHNY skupiny kurzu s tlačítky
        if (allCourseGroups.length === 0) {
            groupsDiv.innerHTML = `<div class="muted" style="padding:8px;">V kurzu nejsou žádné skupiny.</div>`;
        } else {
            groupsDiv.innerHTML = allCourseGroups.map(gid => {
                const g = allLoadedGroups.find(gr => getGroupId(gr) === gid);
                const gName = g ? getGroupTitle(g) : gid;
                const hasAccess = everyoneSeesIt || allowedArr.includes(gid);

                return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border-color); background:var(--bg-panel);">
                    <span style="color:var(--text-primary);">• <strong>${escapeHtml(gName)}</strong></span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${hasAccess
                            ? `<button class="btn-small" style="background:#dc2626; padding:4px 10px; font-size:11px;"
                                onclick="removeGroupAccessFromScenario('${escapeJsString(gid)}')">Odebrat přístup</button>`
                            : `<button class="btn-small" style="background:#10b981; padding:4px 10px; font-size:11px;"
                                onclick="restoreGroupAccessToScenario('${escapeJsString(gid)}')">Přidat přístup</button>`
                        }
                    </div>
                </div>`;
            }).join("");
        }
    }

    async function updateScenarioGroupsSimple(newGroupsStr, successMessage) {
        try {
            const res = await fetch(`${API_BASE}/courses/${activeDetailScenarioCourseId}/scenarios/${activeDetailScenarioId}`, {
                method: "PUT", headers: getHeaders(),
                body: JSON.stringify({ assigned_to_groups: newGroupsStr })
            });
            if (!res.ok) throw new Error(await res.text());
            currentOpenScenarioParams.assignedToGroups = newGroupsStr;
            await loadScenarios();
            if (document.getElementById("scenarioDetailModal").style.display !== "none") {
                loadScenarioGroupsSimpleUI(activeDetailScenarioCourseId, newGroupsStr);
            }
            if (successMessage) showToast(successMessage);
        } catch (err) {
            showToast("Chyba při úpravě skupin: " + err.message, true);
        }
    }

    window.removeGroupAccessFromScenario = function(groupId) {
        const g = allLoadedGroups.find(gr => getGroupId(gr) === groupId);
        const gName = g ? getGroupTitle(g) : groupId;
        showToast(`Měním přístup pro skupinu ${gName}...`);
        const current = currentOpenScenarioParams.assignedToGroups || "";
        const allGroupIds = currentOpenScenarioParams.allCourseGroupIds || [];
        let arr;
        if (current === "" || current === "HIDDEN_FROM_ALL") {
            // "" = všichni vidí → odebrání = všichni ostatní
            arr = allGroupIds.filter(id => id !== groupId);
        } else {
            arr = current.split(",").map(s => s.trim()).filter(x => x && x !== groupId);
        }
        const finalStr = arr.length === 0 ? "HIDDEN_FROM_ALL" : arr.join(",");
        updateScenarioGroupsSimple(finalStr, `Přístup skupiny ${gName} k zadání byl odebrán.`);
    };

    window.restoreGroupAccessToScenario = function(groupId) {
        const g = allLoadedGroups.find(gr => getGroupId(gr) === groupId);
        const gName = g ? getGroupTitle(g) : groupId;
        showToast(`Měním přístup pro skupinu ${gName}...`);
        const current = currentOpenScenarioParams.assignedToGroups || "";
        const allGroupIds = currentOpenScenarioParams.allCourseGroupIds || [];
        let arr;
        if (current === "HIDDEN_FROM_ALL") {
            arr = [groupId];
        } else if (current === "") {
            arr = []; // Tlačítko by nemělo být viditelné, ale zachováme stav
        } else {
            arr = current.split(",").map(s => s.trim()).filter(x => x);
            if (!arr.includes(groupId)) arr.push(groupId);
        }
        // Pokud jsou nyní povoleny všechny skupiny, zjednodušíme na "" (všichni vidí)
        const allIncluded = allGroupIds.length > 0 && allGroupIds.every(id => arr.includes(id));
        const finalStr = allIncluded ? "" : arr.join(",");
        updateScenarioGroupsSimple(finalStr, `Přístup skupiny ${gName} k zadání byl obnoven.`);
    };

    function filterCourses() {
        const term = document.getElementById("courseTableSearch").value.toLowerCase();
        const rows = document.querySelectorAll("#coursesTableBody .course-row");
        rows.forEach(row => { 
            row.style.display = row.innerText.toLowerCase().includes(term) ? "" : "none"; 
        });
    }
