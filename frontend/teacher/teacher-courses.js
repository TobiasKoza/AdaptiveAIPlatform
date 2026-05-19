function checkScenarioCoursePermissions() {
    const courseId = document.getElementById("scenarioCourseSelect").value;
    const warningDiv = document.getElementById("scenarioCourseWarning");
    const btn = document.getElementById("btnCreateScenario");

    if (!courseId) return;

    const safeCurrentEmail = (currentUserEmail || "").trim().toLowerCase();
    const me = allLoadedUsers.find(u => u.email && u.email.trim().toLowerCase() === safeCurrentEmail);
    
    // ABSOLUTNÍ GOD MODE PRO ADMINA I PRO VYTVÁŘENÍ ZADÁNÍ
    const amIAdmin = (me && String(me.global_role).toLowerCase() === 'admin') || safeCurrentEmail === 'admin@unob.cz';
    const isTeacherInCourse = me && me.course_ids && me.course_ids.includes(courseId);
    const amIManager = amIAdmin || isTeacherInCourse;

    if (!amIManager) {
        warningDiv.style.display = "block";
        btn.disabled = true;
        btn.style.background = "#9ca3af";
        btn.style.cursor = "not-allowed";
    } else {
        warningDiv.style.display = "none";
        btn.disabled = false;
        btn.style.background = "var(--btn-primary)";
        btn.style.cursor = "pointer";
    }
}
async function loadMyCourses(forceRefresh = true) {
  const tbody = document.getElementById("coursesTableBody");
  const sSelect = document.getElementById("scenarioCourseSelect");
  const lsSelect = document.getElementById("listScenariosCourseSelect");
  const aSelect = document.getElementById("attemptsCourseSelect");
  const userFormCourseList = document.getElementById("courseList");

  let savedFilters = {};
  try { savedFilters = JSON.parse(localStorage.getItem('attemptsFilters') || '{}'); } catch(e){}
  const previousAttemptsCourse = aSelect.value || savedFilters.courseId || "";
  const previousScenarioCourse = sSelect.value || localStorage.getItem('lastScenarioCourseId') || "";
  const previousListCourse = lsSelect.value || localStorage.getItem('lastListScenarioCourseId') || "";

  try {
    if (forceRefresh || allLoadedCourses.length === 0) {
        aSelect.innerHTML = `<option value="" disabled selected>Načítám kurzy...</option>`;
        const res = await fetch(`${API_BASE}/courses`, { headers: getHeaders() });
        allLoadedCourses = await res.json();
    }
    const courses = allLoadedCourses;

    if (userFormCourseList) {
      userFormCourseList.innerHTML = courses.length
        ? courses.map(c =>
            `<div class="custom-item" data-value="${c.courseId}" onclick="toggleSelection(this, 'courseSearchInput', 'courseList')">${c.title}</div>`
          ).join("")
        : `<div class="muted" style="padding:6px;">Žádné existující kurzy.</div>`;
    }

    if (courses.length === 0) {
      tbody.innerHTML = "<tr><td colspan='5'>Zatím nemáte žádné kurzy.</td></tr>";
      sSelect.innerHTML = "";
      lsSelect.innerHTML = "";
      aSelect.innerHTML = "";
      return;
    }

    // --- OPRAVA: Stáhneme stavy členů pro všechny kurzy najednou ---
    const memberPromises = courses.map(c => 
        fetch(`${API_BASE}/courses/${c.courseId}/members`, { headers: getHeaders() })
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    );
    const allCourseMembersData = await Promise.all(memberPromises); //

    let rowsHtml = "";
    let optionHtml = "";

    courses.forEach((c, index) => { // Přidán index pro párování dat
      const isActive = c.status !== "inactive";
      
      // OPRAVA: Počítáme pouze studenty, kteří mají v tabulce členů status jiný než 'inactive'
      const members = allCourseMembersData[index] || [];
      const studentCount = members.filter(m => m.role === 'student' && m.status !== 'inactive').length; //

      const courseTeachers = allLoadedUsers
        .filter(u => u.course_ids.includes(c.courseId) && ['teacher', 'admin'].includes(u.global_role))
        .map(u => u.display_name || u.email)
        .join("<br>") || "Nikdo";

      rowsHtml += `
        <tr class="course-row">
          <td><strong>${c.title}</strong></td>
          <td style="font-size: 12px; color: #4b5563;">${courseTeachers}</td>
          <td>
            <select onchange="toggleCourseStatus('${c.courseId}', this.value)"
                    class="${isActive ? 'status-select-active' : 'status-select-inactive'}"
                    style="margin:0; padding:4px; font-size:12px; width:auto; border-radius:4px;">
              <option value="active" ${isActive ? 'selected' : ''}>Active</option>
              <option value="inactive" ${!isActive ? 'selected' : ''}>Inactive</option>
            </select>
          </td>
          <td style="text-align:center; font-weight:bold;">${studentCount}</td>
          <td style="white-space: nowrap;">
            <button class="btn-small" style="background:var(--btn-primary);" onclick="openCourseDetail('${c.courseId}')">Správa kurzu</button>
          </td>
        </tr>`;

      if (['teacher', 'admin'].includes(c.roleInCourse)) {
        const isSelected = (c.courseId === previousAttemptsCourse) ? 'selected' : '';
        optionHtml += `<option value="${c.courseId}" ${isSelected}>${c.title}</option>`;
      }
    });

    tbody.innerHTML = rowsHtml;
    // sSelect a lsSelect potřebují vlastní optionHtml bez selected (ten patří jen attempts)
    const neutralOptionHtml = optionHtml.replace(/ selected/g, '');
    sSelect.innerHTML = neutralOptionHtml;
    lsSelect.innerHTML = neutralOptionHtml;
    const placeholderOption = previousAttemptsCourse && previousAttemptsCourse !== '__all__' ? '' : `<option value="" disabled selected>— Vyberte kurz —</option>`;
    const allSelected = previousAttemptsCourse === '__all__' ? 'selected' : '';
    aSelect.innerHTML = placeholderOption + optionHtml + `<option value="__all__" ${allSelected}>— Všechny kurzy —</option>`;

    if (previousScenarioCourse && neutralOptionHtml.includes(`value="${previousScenarioCourse}"`)) {
      sSelect.value = previousScenarioCourse;
    }
    if (previousListCourse && neutralOptionHtml.includes(`value="${previousListCourse}"`)) {
      lsSelect.value = previousListCourse;
      // Automaticky načti zadání po F5/reload — jen při prvním volání (forceRefresh)
      if (forceRefresh) {
        setTimeout(() => loadScenarios(), 100);
      }
    }

    checkScenarioCoursePermissions();
    // Překreslení skupin pro formulář vytváření po načtení/výběru kurzu
    if (typeof window.refreshCreateScenarioGroups === 'function') {
        window.refreshCreateScenarioGroups();
    }

    // Uložení vybraného kurzu při změně
    sSelect.addEventListener('change', () => {
        localStorage.setItem('lastScenarioCourseId', sSelect.value);
    });
    lsSelect.addEventListener('change', () => {
        localStorage.setItem('lastListScenarioCourseId', lsSelect.value);
    });

    // Načti scénáře pouze při prvním načtení (forceRefresh=true), ne při překreslení jmen správců
    if (forceRefresh && aSelect.value && aSelect.value !== "") {
      setTimeout(() => {
        loadAttemptsScenarios(true);
        loadAttempts(true);
      }, 0);
    }

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan='5'>Chyba: ${err.message}</td></tr>`;
  }
}
/*
    function filterCourses() {
        const term = document.getElementById("courseTableSearch").value.toLowerCase();
        const rows = document.querySelectorAll("#coursesTableBody .course-row");
        rows.forEach(row => { row.style.display = row.innerText.toLowerCase().includes(term) ? "" : "none"; });
    }
*/
    async function createCourse() {
      const title = document.getElementById("courseTitle").value.trim();
      const description = document.getElementById("courseDescription").value.trim();
      const statusDiv = document.getElementById("courseStatus");
      if (!title) { showToast("Zadejte název kurzu.", true); return; }

      const autoId = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]/g, "") + "-" + Math.floor(Math.random() * 1000);
      const hasPendingFiles = window._pendingCourseFiles && window._pendingCourseFiles.length > 0;

      statusDiv.innerText = "";
      showToast('Zakládám kurz "' + title + '"...');

      try {
        const res = await fetch(`${API_BASE}/courses`, {
          method: "POST", headers: getHeaders(),
          body: JSON.stringify({ courseId: autoId, title: title, description: description, status: "active" })
        });
        if (!res.ok) throw new Error(await res.text());

        let uploadError = null;
        if (hasPendingFiles) {
          uploadError = await uploadPendingMaterials(autoId);
        }

        // Až teď smažeme pole a soubory
        document.getElementById("courseTitle").value = "";
        document.getElementById("courseDescription").value = "";
        window._pendingCourseFiles = [];
        renderPendingFiles();

        if (uploadError) {
          showToast('Kurz "' + title + '" vytvořen, ale některý soubor se nenahrál: ' + uploadError, true);
        } else {
          showToast('Kurz "' + title + '" úspěšně vytvořen' + (hasPendingFiles ? ' včetně materiálů.' : '.'));
        }
        await loadMyCourses();
      } catch (err) {
        showToast("Chyba při zakládání kurzu: " + err.message, true);
      }
    }

    // ── CodeMirror 5 — lazy loader a inicializace per-row ──────────────────
    window._cmInstances = window._cmInstances || new WeakMap();

    window.ensureCodeMirrorLoaded = function(callback) {
        if (window._cmLoaded) { callback(); return; }
        const alreadyLoading = document.getElementById('cm-script');
        if (alreadyLoading) { alreadyLoading.addEventListener('load', callback); return; }

        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.css';
        document.head.appendChild(css);

        const themeCss = document.createElement('link');
        themeCss.rel = 'stylesheet';
        themeCss.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/theme/dracula.min.css';
        document.head.appendChild(themeCss);

        const script = document.createElement('script');
        script.id = 'cm-script';
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.js';
        script.onload = () => {
            const modes = ['python','javascript','php','clike','shell'];
            let loaded = 0;
            modes.forEach(m => {
                const s = document.createElement('script');
                s.src = `https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/${m}/${m}.min.js`;
                s.onload = () => { if (++loaded === modes.length) { window._cmLoaded = true; callback(); } };
                document.head.appendChild(s);
            });
        };
        document.head.appendChild(script);
    };

    const _cmBuildEditor = function(host, textarea, heightPx, showLangSel) {
        if (!host || !textarea || window._cmInstances.get(host)) return;
        window.ensureCodeMirrorLoaded(() => {
            const isDark = document.body.classList.contains('dark-mode');
            const cm = CodeMirror(host, {
                value: textarea.value || '',
                mode: 'python',
                theme: isDark ? 'dracula' : 'default',
                lineNumbers: true,
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                lineWrapping: true,
                scrollbarStyle: 'native',
                autofocus: false,
                extraKeys: { Tab: cm => cm.execCommand('indentMore') }
            });
            cm.setSize('100%', heightPx + 'px');
            cm.on('change', () => { textarea.value = cm.getValue(); });
            window._cmInstances.set(host, cm);
            // Refresh mode po načtení — zajistí syntax highlighting i při první inicializaci
            setTimeout(() => { cm.setOption('mode', cm.getOption('mode')); cm.refresh(); }, 150);

            if (showLangSel) {
                const langSel = document.createElement('select');
                langSel.className = 'lang-selector-floating';
                ['python','javascript','php','text/x-csrc','text/x-sh'].forEach((mode, i) => {
                    const opt = document.createElement('option');
                    opt.value = mode;
                    opt.textContent = ['Python','JavaScript','PHP','C/C++','Bash'][i];
                    langSel.appendChild(opt);
                });
                langSel.onchange = () => cm.setOption('mode', langSel.value);
                host.style.position = 'relative';
                host.appendChild(langSel);
            }
        });
    };

    window.initCodeMirrorInRow = function(rowEl) {
        const host = rowEl.querySelector('.code-mirror-host');
        const textarea = rowEl.querySelector('.code-input');

        // Language select — nad správné řešení, ne uvnitř CM boxu
        if (host && !rowEl.querySelector('.cm-lang-select')) {
            const langWrap = document.createElement('div');
            langWrap.className = 'lang-row';
            const langLabel = document.createElement('span');
            langLabel.className = 'lang-label-sm';
            langLabel.textContent = 'Jazyk kódu:';
            const langSel = document.createElement('select');
            langSel.className = 'cm-lang-select lang-sel-inline';
            ['python','javascript','php','text/x-csrc','text/x-sh'].forEach((mode, i) => {
                const opt = document.createElement('option');
                opt.value = mode;
                opt.textContent = ['Python','JavaScript','PHP','C/C++','Bash'][i];
                langSel.appendChild(opt);
            });
            langWrap.appendChild(langLabel);
            langWrap.appendChild(langSel);
            // Vlož PŘED sol-text-wrapper (tedy nad správné řešení)
            const solWrapper = rowEl.querySelector('.task-solution-text-wrapper');
            if (solWrapper) {
                solWrapper.parentNode.insertBefore(langWrap, solWrapper);
            } else {
                host.parentNode.insertBefore(langWrap, host);
            }
            // Propoj s oběma CM instancemi po jejich inicializaci
            langSel.onchange = () => {
                const h1 = rowEl.querySelector('.code-mirror-host');
                const h2 = rowEl.querySelector('.sol-text-mirror-host');
                if (h1 && window._cmInstances.get(h1)) window._cmInstances.get(h1).setOption('mode', langSel.value);
                if (h2 && window._cmInstances.get(h2)) window._cmInstances.get(h2).setOption('mode', langSel.value);
            };
        }

        _cmBuildEditor(host, textarea, 220, false);
    };

    window.initSolTextMirrorInRow = function(rowEl) {
        const wrapper = rowEl.querySelector('.task-solution-text-wrapper');
        const host = rowEl.querySelector('.sol-text-mirror-host');
        const textarea = rowEl.querySelector('.task-solution-text');
        if (!wrapper || !host || !textarea) return;
        host.style.display = 'block';
        textarea.style.display = 'none';
        // Synchronizuj jazyk s hlavním editorem pokud už je vybrán
        _cmBuildEditor(host, textarea, 160, false);
        const langSel = rowEl.querySelector('.cm-lang-select');
        if (langSel) {
            window.ensureCodeMirrorLoaded(() => {
                const cmHost = rowEl.querySelector('.sol-text-mirror-host');
                const cm = window._cmInstances?.get(cmHost);
                if (cm) cm.setOption('mode', langSel.value);
            });
        }
    };

    window.buildTaskConfigFromForm = function(containerId) {
        const variants = [];
        const variantBlocks = Array.from(document.querySelectorAll(`#${containerId} .variant-block`));
        variantBlocks.forEach((vBlock, vIndex) => {
            const tasks = [];
            // Per-variant grading
            const vGradingStyle = vBlock.querySelector('.variant-grading-style')?.value || 'points';
            const vMaxPoints = parseInt(vBlock.querySelector('.variant-max-points-input')?.value || '10') || 10;
            const taskRows = Array.from(vBlock.querySelectorAll('.task-row'));
            taskRows.forEach((row, tIndex) => {
                const type = window.getTaskTypeFromRow(row);
                const prompt = (row.querySelector('.task-input')?.value || '').trim();
                const points = parseInt(row.querySelector('.task-points')?.value || '0');
                const skippable = row.querySelector('.task-skippable')?.checked || false;
                const rubric = (row.querySelector('.task-rubric')?.value || '').trim();
                const solutionText = (row.querySelector('.task-solution-text')?.value || '').trim();

                const hints = Array.from(row.querySelectorAll('.hints-list > div')).map(hDiv => ({
                    text: (hDiv.querySelector('.hint-text')?.value || '').trim(),
                    cost: parseInt(hDiv.querySelector('.hint-cost')?.value || '0')
                })).filter(h => h.text);

                const taskObj = { type, prompt, points, skippable, rubric, solutionText, hints };

                if (type === 'flag') {
                    taskObj.solution = (row.querySelector('.task-solution')?.value || '').trim();
                    taskObj.alternatives = Array.from(row.querySelectorAll('.task-solution-alt')).map(i => i.value.trim()).filter(v => v);
                } else if (type === 'tf') {
                    const checked = row.querySelector('input[type="radio"]:checked');
                    taskObj.correctValue = checked ? checked.value : 'true';
                } else if (type === 'abcd') {
                    const options = [];
                    const rows = row.querySelectorAll('.abcd-option-row');
                    rows.forEach((r, i) => {
                        const isCorrect = r.querySelector('input[type="radio"]')?.checked || false;
                        const text = r.querySelector('.abcd-input')?.value || '';
                        options.push({ id: window.getAbcdLetter(i), text, correct: isCorrect });
                    });
                    taskObj.options = options;
                } else if (type === 'multi') {
                    const options = [];
                    const rows = row.querySelectorAll('.multi-option-row');
                    rows.forEach((r, i) => {
                        const isCorrect = r.querySelector('.multi-checkbox')?.checked || false;
                        const text = r.querySelector('.multi-input')?.value || '';
                        options.push({ id: String(i+1), text, correct: isCorrect });
                    });
                    taskObj.options = options;
                } else if (type === 'sort') {
                    const options = [];
                    const rows = row.querySelectorAll('.sort-options-container > div');
                    rows.forEach((r, i) => {
                        const text = r.querySelector('.sort-input')?.value || '';
                        options.push({ id: String(i+1), text });
                    });
                    taskObj.options = options;
                } else if (type === 'code') {
                    const codeHost = row.querySelector('.code-mirror-host');
                    const codeCm = codeHost ? window._cmInstances?.get(codeHost) : null;
                    taskObj.codeSnippet = codeCm ? codeCm.getValue() : (row.querySelector('.code-input')?.value || '');
                    const solHost = row.querySelector('.sol-text-mirror-host');
                    const solCm = solHost ? window._cmInstances?.get(solHost) : null;
                    if (solCm) taskObj.solutionText = solCm.getValue();
                } else if (type === 'image') {
                    const previewDiv = row.querySelector('.task-image-preview');
                    const imgEl = previewDiv ? previewDiv.querySelector('img') : null;
                    if (imgEl && imgEl.src) {
                        taskObj.imageUrl = imgEl.src;
                    } else if (previewDiv && previewDiv.dataset.savedImage) {
                        taskObj.imageUrl = previewDiv.dataset.savedImage;
                    } else {
                        taskObj.imageUrl = "";
                    }
                    const ansTypeSel = row.querySelector('.image-answer-type');
                    taskObj.imageAnswerType = ansTypeSel ? ansTypeSel.value : 'open';
                    if (taskObj.imageAnswerType === 'strict') {
                        taskObj.solution = (row.querySelector('.task-solution-text')?.value || '').trim();
                    }
                }

                tasks.push(taskObj);
            });
            variants.push({ variantNo: vIndex + 1, tasks, gradingStyle: vGradingStyle, maxPoints: vMaxPoints });
        });
        return {
            version: 1,
            variants: variants
        };
    };

    async function createScenario() {
      const courseId = document.getElementById("scenarioCourseSelect").value;
      const title = document.getElementById("scenarioTitle").value.trim();
      const description = document.getElementById("scenarioDescription").value.trim();
      const requiredOs = document.getElementById("scenarioRequiredOs").value;

      // Zpracování dynamických úkolů a jejich řešení s podporou variant
      const activeForm = document.getElementById("standardScenarioFields");
      const seqCb = activeForm.querySelector('.scenarioSequential-cb');
      const exactCb = activeForm.querySelector('.scenarioExactSolution-cb');
      const isSequential = seqCb && seqCb.checked;
      const isExact = exactCb && exactCb.checked;
      let seqHint = isSequential ? "[SEQUENTIAL:true]" : "";
      
      const variantBlocks = Array.from(activeForm.querySelectorAll('#variantsContainerCreate .variant-block'));
      
      let instructions = variantBlocks.map((variantEl, variantIndex) => {
          const taskRows = Array.from(variantEl.querySelectorAll('.task-row'));
          const variantSolution = (variantEl.querySelector('.variant-solution-input')?.value || '').trim();

          const stepParts = taskRows.map((row, taskIndex) => {
              const taskText = (row.querySelector('.task-input')?.value || '').trim();
              
              const taskSolPrimary = (row.querySelector('.task-solution')?.value || '').trim();
              const altSols = Array.from(row.querySelectorAll('.task-solution-alt')).map(input => input.value.trim()).filter(val => val !== '');
              const combinedSols = [taskSolPrimary, ...altSols].filter(Boolean).join('||');

              const hintsStr = Array.from(row.querySelectorAll('.hints-list > div')).map(hDiv => {
                  const text = (hDiv.querySelector('.hint-text')?.value || '').trim();
                  const cost = parseInt(hDiv.querySelector('.hint-cost')?.value || '0');
                  return text ? `[HINT:${text}:${cost}]` : '';
              }).filter(Boolean).join('');
              
              const taskPts = parseInt(row.querySelector('.task-points')?.value || '0');
              const isSkip = row.querySelector('.task-skippable')?.checked ? 'true' : 'false';
              const taskRubric = (row.querySelector('.task-rubric')?.value || '').trim();
              const taskSolText = (row.querySelector('.task-solution-text')?.value || '').trim();

              if (!taskText) return '';

              let part = `[STEP${taskIndex + 1}]\n${taskText}\n[/STEP${taskIndex + 1}]`;
              if (combinedSols && isExact) {
                  part += `\n[SOL${taskIndex + 1}]${combinedSols}[/SOL${taskIndex + 1}]`;
              } else if (taskSolText && !isExact) {
                  part += `\n[SOLUTION_TEXT${taskIndex + 1}]\n${taskSolText}\n[/SOLUTION_TEXT${taskIndex + 1}]`;
              }
              
              if (taskRubric && document.getElementById("scenarioUseAI").checked) {
                  part += `\n[RUBRIC${taskIndex + 1}]\n${taskRubric}\n[/RUBRIC${taskIndex + 1}]`;
              }
              if (hintsStr) {
                  part += `\n[HINTS${taskIndex + 1}]${hintsStr}[/HINTS${taskIndex + 1}]`;
              }
              part += `\n[PTS${taskIndex + 1}]${taskPts}[/PTS${taskIndex + 1}]\n[SKIP${taskIndex + 1}]${isSkip}[/SKIP${taskIndex + 1}]`;
              
              return part;
          }).filter(Boolean).join('\n\n');

          if (!stepParts) return '';

          return `[VARIANT${variantIndex + 1}]\n${stepParts}\n[/VARIANT${variantIndex + 1}]`;
      }).filter(Boolean).join('\n\n');

      if (!instructions) {
          instructions = "Žádné specifické zadání.";
      }

      const useAI = document.getElementById("scenarioUseAI").checked;
      const aiGlobalContext = document.getElementById("aiGlobalContext")?.value.trim() || "";
      const rubric = window.buildScenarioGradingRubric(useAI, aiGlobalContext);
      
      // BEZPEČNÉ NAČTENÍ EXPECTED OUTPUTS
      const expectedEl = document.getElementById("scenarioExpectedOutputs");
      const expected = expectedEl ? expectedEl.value.trim() : "";
      
      const deadline = document.getElementById("scenarioDeadline").value;
      const attemptMode = document.getElementById("scenarioAttempts").value;
      const maxAttempts = attemptMode === "custom" ? (parseInt(document.getElementById("scenarioCustomAttempts").value, 10) || 1) : 0;
      const timeLimit = parseInt(document.getElementById("scenarioTimeLimit").value) || 60;
      const statusDiv = document.getElementById("scenarioStatus");
      // gradingStyle/maxPoints se nyní čtou per-varianta z taskConfig při ukládání
      const taskType = document.getElementById("scenarioTaskType").value;

      if (!courseId || !title) {
        showToast("Vyplňte alespoň kurz a název zadání.", true);
        return;
      }

      if (!window.validateTaskConfig('variantsContainerCreate')) return;

      const isCustomTemplate = requiredOs.startsWith("custom:");
      const isNone = requiredOs === "none";

      if (!isCustomTemplate && !isNone && requiredOs === "windows") {
        showToast("Windows prostředí zatím není v MVP podporováno.", true);
        return;
      }

      // Pro MVP si ID vygenerujeme automaticky z názvu, abys ho nemusel psát
      const autoId = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]/g, "") + "-" + Math.floor(Math.random() * 1000);
      const scenarioTemplateId = `${autoId}-template`;
      const courseScenarioId = autoId;

      const templateMap = {
        kali: {
          templateTitle: "Kali Linux Desktop (GUI)",
          labImage: "adaptivekoza01.azurecr.io/adaptive-lab-kali:v3"
        },
        ubuntu: {
          templateTitle: "Ubuntu Desktop (GUI)",
          labImage: "adaptivekoza01.azurecr.io/adaptive-lab-kali:ubuntu-v1"
        },
        none: {
          templateTitle: "Žádné virtuální prostředí",
          labImage: "skip"
        },
        windows: {
          templateTitle: "Standardní Windows Lab",
          labImage: "windows-placeholder"
        }
      };

      // Resolve lab template ID — custom/none reuse fixed templates, ostatní vytvoří unikátní
      let uniqueLabTemplateId;
      let effectiveRequiredOs = requiredOs;
      if (isCustomTemplate) {
        uniqueLabTemplateId = requiredOs.replace("custom:", "");
        const selOpt = document.querySelector(`#scenarioRequiredOs option[value="${CSS.escape(requiredOs)}"]`);
        effectiveRequiredOs = selOpt?.dataset.baseImage || "kali";
      } else if (isNone) {
        uniqueLabTemplateId = "base-none";
      } else {
        uniqueLabTemplateId = `${autoId}-tech`;
      }
      const selectedTemplate = (isCustomTemplate || isNone) ? null : templateMap[requiredOs];

      const createBtn = document.getElementById("btnCreateScenario");
      if (createBtn) {
          createBtn.disabled = true;
          createBtn.style.background = "var(--bg-status, #e5e7eb)";
          createBtn.style.color = "var(--text-muted, #6b7280)";
          createBtn.style.pointerEvents = "none";
          createBtn.textContent = "Vytvářím...";
      }

      showToast(`Vytvářím zadání "${title}"...`);

      try {
        // 1) Vytvoření technické šablony
        if (!isCustomTemplate && !isNone) {
          // Kali, Ubuntu: unikátní šablona per-zadání (kvůli samostatnému timeoutu)
          await fetch(`${API_BASE}/labtemplates`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({
              templateId: uniqueLabTemplateId,
              title: selectedTemplate.templateTitle + " (" + title + ")",
              labImage: selectedTemplate.labImage,
              fileShareName: "labs",
              mountPath: "/mnt/output",
              timeoutSeconds: timeLimit * 60
            })
          });
        } else if (isNone) {
          // Sdílená base šablona — idempotentní, 409 se ignoruje
          await fetch(`${API_BASE}/labtemplates`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({
              templateId: "base-none",
              title: "Žádné virtuální prostředí",
              labImage: "skip",
              fileShareName: "labs",
              mountPath: "/mnt/output",
              timeoutSeconds: 0
            })
          }).catch(() => {});
        }

        // 2) Vytvoření scénářové šablony s AI pravidly
        const _autoSubmitChecked = taskType === 'practice' && document.getElementById('scenarioAutoSubmit')?.checked;
        const _thresholdCbChecked = document.getElementById('scenarioPassThresholdCb')?.checked;
        const _thresholdVal = document.getElementById('scenarioPassThreshold')?.value;
        const _thresholdTag = (_thresholdCbChecked && _thresholdVal) ? `[PASS_THRESHOLD:${parseInt(_thresholdVal)}]` : '';
        const _taskConfig = window.buildTaskConfigFromForm('variantsContainerCreate');
        // Vezmi grading z první varianty jako globální default pro hints tag
        const _firstVariant = _taskConfig?.variants?.[0];
        const gradingStyle = _firstVariant?.gradingStyle || document.getElementById("scenarioGradingStyle").value || 'points';
        const maxPoints = _firstVariant?.maxPoints || parseInt(document.getElementById("scenarioMaxPoints").value) || 10;
        const gradingStyleNeedsMax = ['points', 'equal'].includes(gradingStyle);
        const taskConfigJsonStr = JSON.stringify(_taskConfig);

        const resTemplate = await fetch(`${API_BASE}/scenario-templates`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            scenarioTemplateId: scenarioTemplateId,
            linkedTemplateId: uniqueLabTemplateId,
            title: title,
            description: description || "Praktické cvičení",
            instructions: instructions || "Postupujte podle zadání.",
            hints: `[TIME_LIMIT:${timeLimit}][GRADING:${gradingStyle}${gradingStyleNeedsMax ? ':' + maxPoints : ''}][TYPE:${taskType}]${seqHint}${_autoSubmitChecked ? '[AUTO_SUBMIT:true]' : ''}${_thresholdTag}${(ids => ids ? `[PREREQS:${ids}]` : '')(window.getPrereqIds('prereqsCreateContainer'))}`,
            difficulty: "medium",
            expectedOutputs: expected,
            gradingRubric: rubric,
            requiredOs: effectiveRequiredOs,
            taskConfigJson: taskConfigJsonStr
          })
        });

        if (!resTemplate.ok) throw new Error(await resTemplate.text());

      // Whitelist UI → blacklist DB (nobody = blacklist všech skupin kurzu)
      const createList = document.getElementById("scenarioTargetGroupList");
      const allCourseGroups = window.getGroupsForCourse(courseId).map(g => getGroupId(g));
      let targetGroup;
      if (createList && createList.dataset.nobody === "true") {
          targetGroup = allCourseGroups.join(",");
      } else {
          const checkedGroups = Array.from(document.querySelectorAll("#scenarioTargetGroupList input:checked")).map(cb => cb.value);
          targetGroup = allCourseGroups.filter(gid => !checkedGroups.includes(gid)).join(",");
      }

        // 3) Přiřazení do kurzu
        const resCourseScenario = await fetch(`${API_BASE}/course-scenarios`, {
          method: "POST", headers: getHeaders(),
          body: JSON.stringify({
            courseScenarioId: courseScenarioId,
            courseId: courseId,
            scenarioTemplateId: scenarioTemplateId,
            deadline: deadline,
            maxAttempts: maxAttempts,
            assigned_to_groups: targetGroup,
            status: "active"
          })
        });

        if (!resCourseScenario.ok) throw new Error(await resCourseScenario.text());

        // NEJPRVE počkáme na znovunačtení tabulky zadání, než cokoliv smažeme z formuláře
        await loadScenarios();

        // Plynulé zobrazení úspěšné hlášky (bez druhého parametru, aby to nebylo červené)
        showToast(`Zadání "${title}" úspěšně vytvořeno!`);

        // Vrácení tlačítka do původního funkčního stavu
        if (createBtn) { 
            createBtn.disabled = false; 
            createBtn.style.background = ""; 
            createBtn.style.color = "";
            createBtn.style.pointerEvents = "auto"; 
            createBtn.textContent = "Vytvořit zadání"; 
        }

        // A AŽ NYNÍ bezpečně vyčistíme všechna pole formuláře
        if (document.getElementById("scenarioTitle")) document.getElementById("scenarioTitle").value = "";
        if (document.getElementById("scenarioDescription")) document.getElementById("scenarioDescription").value = "";
        if (document.getElementById("scenarioUseAI")) document.getElementById("scenarioUseAI").checked = true;
        if (document.getElementById("aiGlobalContext")) document.getElementById("aiGlobalContext").value = "";
        window.syncAiContextVisibility('create');
        
        // Vyčištění dynamických úkolů a variant
        const activeFormEl = document.getElementById("standardScenarioFields");
        if (activeFormEl) {
            const vContainer = document.getElementById("variantsContainerCreate");
            if (vContainer) {
                vContainer.innerHTML = `
                  <div class="variant-block" data-variant="1" style="background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                      <h4 class="variant-title" style="margin: 0; color: var(--text-primary);">Varianta 1</h4>
                      <button type="button" class="delete-variant-btn" onclick="window.confirmDeleteVariant(this, 'variantsContainerCreate')" style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 13px; display: none;">✖ Smazat variantu</button>
                    </div>
                    <div class="scenario-tasks-scroll">
                      <div class="tasks-container-dynamic">
                        <div class="task-row" style="margin-bottom: 10px; background: var(--bg-status); padding: 10px; border: 1px solid var(--border-color); border-radius: 6px;">
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span class="task-number" style="font-weight: bold; color: var(--text-primary);">Úkol:</span>
                            <button type="button" class="delete-task-btn" onclick="var cEl = this.closest('.tasks-container-dynamic'); this.closest('.task-row').remove(); window.renumberTasks(null, cEl);" style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 18px; padding: 0; line-height: 1; display: none;" title="Smazat úkol">×</button>
                          </div>
                          <label style="font-size:11px; color:var(--text-muted); font-weight:bold; display:block; margin-bottom:4px;">Zadání úkolu:</label>
                          <textarea class="task-input" rows="2" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background: var(--bg-panel); color: var(--text-primary);" placeholder="Popište, co má student udělat..."></textarea>
                          <div class="task-solution-wrapper" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                            <label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Vyžadované řešení (Flag / IP / Přesná odpověď):</label>
                            <div style="display:flex; gap:4px; margin-top:4px;">
                              <input type="text" class="task-solution" placeholder="Např. flag{splneno} nebo 192.168.1.5" style="flex:1; padding:6px; border-radius:4px; border:1px solid var(--border-color); box-sizing:border-box; background:var(--bg-panel); color:var(--text-primary);" />
                              <button type="button" onclick="window.addAlternativeSolution(this);" style="background:var(--btn-primary); color:white; border:none; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px; white-space:nowrap;">+ další odpověď</button>
                            </div>
                            <div class="alt-solutions-container"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                      <button type="button" class="btn-add-task" onclick="window.addTaskField(this)">Přidat další úkol</button>
                      <div class="variant-max-points-display" style="display: none; font-size: 13px; font-weight: bold; color: var(--text-primary); background: var(--bg-panel); border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 6px;">Maximum bodů: <span class="variant-sum">0</span></div>
                    </div>
                  </div>`;
                window.prepareTaskAccordions(vContainer);
            }
            const cbSeq = activeFormEl.querySelector('.scenarioSequential-cb');
            if (cbSeq) cbSeq.checked = false;
            const cbExact = activeFormEl.querySelector('.scenarioExactSolution-cb');
            if (cbExact) {
                cbExact.checked = false;
                cbExact.disabled = false;
            }
        }
        if (document.getElementById("scenarioGradingRubric")) document.getElementById("scenarioGradingRubric").value = "";
        if (document.getElementById("scenarioExpectedOutputs")) document.getElementById("scenarioExpectedOutputs").value = "";
        if (document.getElementById("scenarioDeadline")) document.getElementById("scenarioDeadline").value = "";
        if (document.getElementById("scenarioTimeLimit")) document.getElementById("scenarioTimeLimit").value = "60";
        if (document.getElementById("scenarioMaxPoints")) document.getElementById("scenarioMaxPoints").value = "10";
        if (document.getElementById("scenarioTargetGroupList")) {
            document.querySelectorAll("#scenarioTargetGroupList input[type='checkbox']").forEach(cb => cb.checked = false);
            window.updateMultiSelectLabels(); // Resetuje i nápis roletky
        }
        if (document.getElementById("scenarioAttempts")) {
            document.getElementById("scenarioAttempts").value = "0";
            document.getElementById("scenarioCustomAttempts").style.display = "none";
            document.getElementById("scenarioCustomAttempts").value = "1";
        }
        
        // Návrat formuláře do výchozího stavu (schová všechny podrobné volby)
        const taskTypeSelect = document.getElementById("scenarioTaskType");
        if (taskTypeSelect) {
            taskTypeSelect.value = "";
        }
        const prereqCreateCont = document.getElementById('prereqsCreateContainer');
        if (prereqCreateCont) prereqCreateCont.innerHTML = '';
        toggleScenarioFormType();
        
      } catch (err) {
        showToast(`Chyba: ${err.message}`, true);
        if (createBtn) { 
            createBtn.disabled = false; 
            createBtn.style.background = ""; 
            createBtn.style.color = "";
            createBtn.style.pointerEvents = "auto"; 
            createBtn.textContent = "Vytvořit zadání"; 
        }
      }
    }

    async function loadScenarios() {
  const courseId = document.getElementById("listScenariosCourseSelect").value;
  const tbody = document.getElementById("scenariosTableBody");
  if (!courseId) return;

  // Zobrazení načítacího stavu ihned po kliknutí (s colspan 7 pro pokrytí všech sloupců)
  tbody.innerHTML = "<tr><td colspan='7' style='color: var(--text-muted);'>Načítám zadání...</td></tr>";

  const selectedCourse = allLoadedCourses.find(c => c.courseId === courseId);
  const courseStatus = selectedCourse?.status ?? "-";

  try {
    const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios`, { headers: getHeaders() });
    if (!res.ok) throw new Error(await res.text());

    const scenarios = await res.json();

    if (!scenarios.length) {
      tbody.innerHTML = "<tr><td colspan='7' style='text-align: center;'>V tomto kurzu nejsou žádná zadání.</td></tr>";
      return;
    }

    window._scenarioCache = window._scenarioCache || {};
    window._scenariosByCourse = window._scenariosByCourse || {};
    scenarios.forEach(s => { window._scenarioCache[s.scenarioId] = s; });
    window._scenariosByCourse[courseId] = scenarios;

    tbody.innerHTML = scenarios.map(s => {
      const scenarioId = s.scenarioId ?? "";
      const title = s.title ?? "-";
      const deadline = formatScenarioDeadlineForDisplay(s.deadline);
      const attempts = s.maxAttempts === 0 ? "Neomezeně" : (s.maxAttempts ?? "-");
      const isActive = s.status !== "inactive";
      
      let timeLimitStr = "60 min";
      const limitMatch = (s.hints || "").match(/\[TIME_LIMIT:(\d+)\]/);
      if (limitMatch) timeLimitStr = parseInt(limitMatch[1]) > 0 ? limitMatch[1] + " min" : "Neomezeně";
      
      // LOGIKA PRO NOVÝ SLOUPEC: Vytažení správců
      const courseTeachers = allLoadedUsers.filter(u => u.course_ids && u.course_ids.includes(courseId) && ['teacher', 'admin'].includes(u.global_role));
      const addedManagersArr = (s.additionalManagers || "").split(',').map(x => x.trim()).filter(x => x.length > 0);
      const extraManagers = allLoadedUsers.filter(u => addedManagersArr.includes(u.user_id) && !courseTeachers.includes(u));
      const allScenarioManagers = courseTeachers.concat(extraManagers);
      const managersHtml = allScenarioManagers.map(m => m.display_name || m.email).join("<br>") || "Nikdo";
      
      // Zjištění typu zadání a barvy štítku (bere z DB ze sloupce difficulty)
      const isAdaptive = s.difficulty === "adaptive" || (s.hints || "").includes("[ADAPTIVE:true]");
      
      let tType = 'practice';
      const tm = (s.hints || "").match(/\[TYPE:([a-zA-Z]+)\]/);
      if (tm) tType = tm[1];

      let taskType = "Cvičení";
      let badgeStyle = "background:#f3f4f6; color:#374151; border: 1px solid #d1d5db;"; // Výchozí šedá

      if (tType === 'ai_education' || (isAdaptive && (s.hints || '').includes('[TYPE:ai_education]'))) {
          taskType = "AI vzdělávání";
          badgeStyle = "background:#fef3c7; color:#92400e; border:1px solid #fcd34d;";
      } else if (isAdaptive) {
          taskType = "AI cvičení";
          badgeStyle = "background:#e0f2fe; color:#0369a1; border: 1px solid #7dd3fc;"; // Světle modrá
      } else if (tType === 'exam' || (s.maxAttempts === 1 && !tm)) { // (podpora i pro staré zkoušky)
          taskType = "Zkouška";
          badgeStyle = "background:#fee2e2; color:#991b1b; border: 1px solid #fca5a5;"; // Světle červená
      } else if (tType === 'credit') {
          taskType = "Klasifikovaný zápočet";
          badgeStyle = "background:#f3e8ff; color:#6b21a8; border: 1px solid #d8b4fe;"; // Světle fialová
      }

      return `
        <tr>
          <td><strong>${escapeHtml(title)}</strong></td>
          <td><span class="badge" style="${badgeStyle}">${taskType}</span></td>
          <td>${managersHtml}</td>
          <td>${escapeHtml(deadline)}</td>
          <td>${escapeHtml(attempts)}</td>
          <td>${escapeHtml(timeLimitStr)}</td>
          <td style="white-space: nowrap;">
            <button class="btn-small" style="background:var(--btn-primary); margin-right:5px;"
              onclick="openScenarioDetail('${escapeJsString(scenarioId)}', '${escapeJsString(courseId)}', '${escapeJsString(title)}', '${escapeJsString(s.description || '')}', '${escapeJsString(s.instructions || '')}', '${escapeJsString(s.deadline || '')}', '${escapeJsString(String(s.maxAttempts ?? 0))}', '${escapeJsString(s.assignedBy || '')}', '${escapeJsString(s.additionalManagers || '')}', '${escapeJsString(s.hints || '')}', '${escapeJsString(s.assigned_to_groups || '')}', '${escapeJsString(s.difficulty || '')}')">
              Správa zadání
            </button>
            <button class="btn-small" style="background:#10b981; margin-right:5px;"
              onclick="fillEditFormFromCache('${escapeJsString(courseId)}', '${escapeJsString(scenarioId)}')">
              Upravit zadání
            </button>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan='7' style='text-align: center; color: var(--color-danger, #ef4444);'>Chyba: ${err.message}</td></tr>`;
  }
}

    // Změna stavu Active / Inactive
    async function toggleCourseStatus(courseId, newStatus) {
        try {
            // 1. Okamžitá změna UI
            const selectEl = event.target;
            const isActive = newStatus !== "inactive";
            
            selectEl.classList.remove('status-select-active', 'status-select-inactive');
            selectEl.classList.add(isActive ? 'status-select-active' : 'status-select-inactive');
            selectEl.style.background = ''; // Vyčištění případných starých inline stylů
            selectEl.style.border = '';

            const countTd = selectEl.closest('td').nextElementSibling;
            if (countTd) {
                if (!isActive) {
                    countTd.innerText = "0";
                } else {
                    const realCount = allLoadedUsers.filter(u => u.course_ids.includes(courseId) && u.global_role === 'student').length;
                    countTd.innerText = realCount;
                }
            }

            // 2. Update kurzu na serveru
            const res = await fetch(`${API_BASE}/courses/${courseId}`, {
                method: "PUT", headers: getHeaders(), body: JSON.stringify({ status: newStatus })
            });
            if (!res.ok) throw new Error("Chyba při změně stavu na backendu.");
            
            const course = allLoadedCourses.find(c => c.courseId === courseId);
            if (course) course.status = newStatus;
            
            // --- AUTOMATICKÁ DEAKTIVACE / AKTIVACE SKUPIN A STUDENTŮ PŘI PŘEPNUTÍ KURZU ---
            const studentsToUpdate = allLoadedUsers.filter(u => u.course_ids && u.course_ids.includes(courseId) && u.global_role === 'student');
            if (!isActive) {
                showToast("Deaktivuji přístup všem studentům v kurzu...");
                for (const s of studentsToUpdate) {
                    await fetch(`${API_BASE}/courses/${courseId}/members`, {
                        method: "POST", headers: getHeaders(),
                        body: JSON.stringify({ user_id: s.user_id, role_in_course: "student", status: "inactive" })
                    });
                }
                showToast("Kurz i všechny skupiny byly deaktivovány.");
            } else {
                showToast("Aktivuji přístup všem studentům v kurzu...");
                for (const s of studentsToUpdate) {
                    await fetch(`${API_BASE}/courses/${courseId}/members`, {
                        method: "POST", headers: getHeaders(),
                        body: JSON.stringify({ user_id: s.user_id, role_in_course: "student", status: "active" })
                    });
                }
                showToast("Kurz i všechny skupiny byly plně aktivovány.");
            }

            // Aktualizujeme data, aby seděly počty studentů v tabulce
            await loadMyCourses(true); 

        } catch (err) { 
            showToast(err.message, true); 
            await loadMyCourses(); 
        }
    }

    // Změna stavu pro konkrétní skupinu v kurzu
    async function toggleGroupCourseStatus(courseId, groupId, newStatus, selectEl) {
        const isActive = newStatus !== "inactive";
        
        // 1. Okamžitá změna barvy UI
        selectEl.classList.remove('status-select-active', 'status-select-inactive');
        selectEl.classList.add(isActive ? 'status-select-active' : 'status-select-inactive');
        selectEl.style.background = '';
        selectEl.style.border = '';
        
        // 2. Najdeme všechny studenty z této skupiny a propíšeme jim stav 
        // (pokud v kurzu ještě nejsou, backend je tímto rovnou založí)
        const cleanGid = String(groupId).trim();
        const membersToUpdate = allLoadedUsers.filter(u => 
            u.group_ids && u.group_ids.map(id => String(id).trim()).includes(cleanGid) && 
            u.global_role === "student"
        );

        if (membersToUpdate.length === 0) {
            showToast("Skupina v tomto kurzu nemá žádné studenty k aktualizaci.", true);
            return;
        }

        let successCount = 0;
        showToast(`Aktualizuji přístup pro ${membersToUpdate.length} studentů...`);

        // 3. Pošleme požadavek paralelně pro všechny studenty najednou
        await Promise.all(membersToUpdate.map(async (user) => {
            try {
                // OPRAVA: Azure potřebuje primárně E-MAIL, aby přepsal existující záznam a nevytvářel duplikáty
                const correctUserId = user.email || user.user_id;
                const res = await fetch(`${API_BASE}/courses/${courseId}/members`, {
                    method: "POST", headers: getHeaders(),
                    body: JSON.stringify({ 
                        user_id: correctUserId, 
                        role_in_course: "student",
                        status: newStatus
                    })
                });
                if (res.ok) {
                    successCount++;
                }
            } catch { }
        }));
        
        showToast(`Skupina ${isActive ? 'aktivována' : 'deaktivována'} pro ${successCount} studentů.`);





        // 4. Propsat stav skupiny do všech zadání kurzu
        // inactive skupina v kurzu = skupina nesmí být active v žádném zadání
        try {
            const scenariosRes = await fetch(`${API_BASE}/courses/${courseId}/scenarios`, { headers: getHeaders() });
            const scenarios = await scenariosRes.json();

            // Zjistíme všechny skupiny v kurzu
            const studentsInCourse = allLoadedUsers.filter(u =>
                u.course_ids && u.course_ids.includes(courseId) && u.global_role === 'student'
            );
            const courseGroupIds = new Set();
            studentsInCourse.forEach(u => {
                if (u.group_ids) u.group_ids.forEach(g => courseGroupIds.add(String(g).trim()));
            });
            const allGroups = Array.from(courseGroupIds);

            await Promise.all(scenarios.map(async (s) => {
                const assigned = (s.assigned_to_groups || '').split(',').map(x => x.trim()).filter(Boolean);
                
                let explicitAssigned;
                if (assigned.includes('HIDDEN_FROM_ALL')) {
                    explicitAssigned = [];
                } else if (assigned.length === 0) {
                    explicitAssigned = [...allGroups];
                } else {
                    explicitAssigned = assigned;
                }

                if (!isActive) {
                    const updated = explicitAssigned.filter(g => g !== cleanGid);
                    const finalStr = updated.length === 0 ? 'HIDDEN_FROM_ALL' : updated.join(',');
                    await fetch(`${API_BASE}/courses/${courseId}/scenarios/${s.scenarioId}`, {
                        method: 'PUT', headers: getHeaders(),
                        body: JSON.stringify({ assigned_to_groups: finalStr })
                    });
                } else {
                    if (!explicitAssigned.includes(cleanGid)) {
                        const updated = [...explicitAssigned, cleanGid];
                        const allActive = allGroups.every(g => updated.includes(g));
                        await fetch(`${API_BASE}/courses/${courseId}/scenarios/${s.scenarioId}`, {
                            method: 'PUT', headers: getHeaders(),
                            body: JSON.stringify({ assigned_to_groups: allActive ? null : updated.join(',') })
                        });
                    }
                }
            }));
        } catch { }

        // 5. Na pozadí obnovíme data kurzů — bez znovuotevírání okna
        setTimeout(async () => {
            await loadMyCourses(true);
            showToast(`Změny skupiny byly uloženy v databázi.`);
        }, 1500);
    }

    // Univerzální funkce pro hezké potvrzování
    function customConfirm(title, text, confirmBtnText, onConfirm, extraBtnText, onExtra) {
        document.getElementById('ucmTitle').innerText = title;
        document.getElementById('ucmText').innerHTML = text;
        const btnYes = document.getElementById('ucmBtnYes');
        btnYes.innerText = confirmBtnText;
        btnYes.style.background = '';
        btnYes.onclick = () => {
            document.getElementById('universalConfirmModal').style.display = 'none';
            onConfirm();
        };

        // Druhé volitelné tlačítko
        let btnExtra = document.getElementById('ucmBtnExtra');
        if (!btnExtra) {
            btnExtra = document.createElement('button');
            btnExtra.id = 'ucmBtnExtra';
            btnYes.parentNode.insertBefore(btnExtra, btnYes);
        }
        if (extraBtnText && onExtra) {
            btnExtra.innerText = extraBtnText;
            btnExtra.className = 'btn btn-danger';
            btnExtra.onclick = () => {
                document.getElementById('universalConfirmModal').style.display = 'none';
                onExtra();
            };
            btnExtra.style.display = 'inline-block';
            btnYes.style.background = '#f59e0b';
        } else {
            btnExtra.style.display = 'none';
        }

        document.getElementById('universalConfirmModal').style.display = 'flex';
    }
    // Smazání kurzu
    function deleteCourse(courseId) {
        customConfirm("Smazat kurz", "Opravdu smazat celý kurz? Všechna zadání a výsledky studentů budou nenávratně ztraceny.", "Ano, smazat kurz", async () => {
            try {
                const res = await fetch(`${API_BASE}/courses/${courseId}`, { method: "DELETE", headers: getHeaders() });
                if (!res.ok) throw new Error(await res.text());
                await loadMyCourses();
                showToast("Kurz byl úspěšně smazán.");
            } catch (err) { showToast("Chyba při mazání.", true); }
        });
    }

    function deleteCourseFromDetail() {
        if (!activeDetailCourseId) return;
        const course = allLoadedCourses.find(c => c.courseId === activeDetailCourseId);
        const courseTitle = course ? course.title : activeDetailCourseId;
        customConfirm("Smazat kurz", "Opravdu smazat celý kurz? Všechna zadání, výsledky studentů a nahrané materiály budou nenávratně ztraceny.", "Ano, smazat kurz", async () => {
            showToast('Mažu kurz "' + courseTitle + '"...');
            try {
                const res = await fetch(`${API_BASE}/courses/${activeDetailCourseId}`, { method: "DELETE", headers: getHeaders() });
                if (!res.ok) throw new Error(await res.text());
                document.getElementById('courseDetailModal').style.display = 'none';
                await loadMyCourses();
                showToast('Kurz "' + courseTitle + '" byl úspěšně smazán.');
            } catch (err) { showToast("Chyba při mazání kurzu: " + err.message, true); }
        });
    }
    
    // Funkce pro odstranění zadání z kurzu
    function removeScenarioFromCourse(courseId, scenarioId, scenarioTitle) {
        customConfirm("Smazat zadání", `Opravdu chcete zadání "${scenarioTitle}" kompletně smazat? Studenti ztratí přístup i historii pokusů.`, "Ano, smazat", async () => {
            showToast(`Mažu zadání "${scenarioTitle}"...`);
            try {
                const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios/${scenarioId}`, {
                    method: "DELETE", headers: getHeaders()
                });
                if (!res.ok) throw new Error(await res.text());
                showToast(`Zadání "${scenarioTitle}" bylo smazáno.`);
                await loadScenarios();
            } catch (err) { showToast("Chyba při mazání: " + err.message, true); }
        });
    }

    // Otevře modal s volbou: přesunout nebo smazat
    window.openScenarioActionModal = function(courseId, scenarioId, scenarioTitle) {
        const otherCourses = allLoadedCourses.filter(c => c.courseId !== courseId);
        const options = otherCourses.map(c => `<option value="${c.courseId}">${escapeHtml(c.title)}</option>`).join('');

        const modalHtml = `
            <div id="scenarioActionOverlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:200; display:flex; justify-content:center; align-items:center;">
                <div class="panel" style="width:480px; max-width:95%; border:2px solid #3e67a8; padding:24px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <h3 style="margin:0; color:var(--text-primary);">Správa zadání: <em>${escapeHtml(scenarioTitle)}</em></h3>
                        <span onclick="document.getElementById('scenarioActionOverlay').remove()" style="cursor:pointer; font-size:26px; color:#6b7280; line-height:1;">&times;</span>
                    </div>
                    <p style="font-size:13px; color:var(--text-muted); margin-top:0;">Vyberte akci pro toto zadání:</p>

                    <div style="border:1px solid var(--border-color); border-radius:8px; padding:15px; margin-bottom:15px;">
                        <strong style="font-size:13px; color:var(--text-primary);">Přesunout do jiného kurzu</strong>
                        <p style="font-size:12px; color:var(--text-muted); margin:6px 0 10px 0;">Zadání se přesune i s nastavením. Historie pokusů studentů zůstane zachována.</p>
                        <div style="display:flex; gap:10px;">
                            <select id="scenarioMoveTargetCourse" style="margin:0; flex:1; font-size:13px;">
                                <option value="">— Vyberte cílový kurz —</option>
                                ${options}
                            </select>
                            <button class="btn-small" style="background:var(--btn-primary);" onclick="executeScenarioMove('${escapeJsString(courseId)}', '${escapeJsString(scenarioId)}', '${escapeJsString(scenarioTitle)}')">Přesunout</button>
                        </div>
                    </div>

                    <div style="border:1px solid #fca5a5; border-radius:8px; padding:15px; margin-bottom:20px; background:var(--bg-status);">
                        <strong style="font-size:13px; color:#dc2626;">Smazat zadání</strong>
                        <p style="font-size:12px; color:var(--text-muted); margin:6px 0 10px 0;">Zadání bude nenávratně smazáno včetně všech výsledků a pokusů studentů.</p>
                        <button class="btn-small" style="background:#dc2626; width:100%;" onclick="executeScenarioDelete('${escapeJsString(courseId)}', '${escapeJsString(scenarioId)}', '${escapeJsString(scenarioTitle)}')">Smazat zadání</button>
                    </div>

                    </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    window.executeScenarioMove = async function(fromCourseId, scenarioId, scenarioTitle) {
        const targetCourseId = document.getElementById('scenarioMoveTargetCourse').value;
        if (!targetCourseId) { showToast('Vyberte cílový kurz.', true); return; }
        const targetCourse = allLoadedCourses.find(c => c.courseId === targetCourseId);
        const targetName = targetCourse ? targetCourse.title : targetCourseId;
        document.getElementById('scenarioActionOverlay').remove();
        showToast(`Přesouvám zadání "${scenarioTitle}" do kurzu "${targetName}"...`);
        try {
            // 1. Přidáme zadání do cílového kurzu
            const scenariosRes = await fetch(`${API_BASE}/courses/${fromCourseId}/scenarios`, { headers: getHeaders() });
            const scenarios = await scenariosRes.json();
            const scenario = scenarios.find(s => s.scenarioId === scenarioId);
            if (!scenario) throw new Error('Zadání nenalezeno.');

            const addRes = await fetch(`${API_BASE}/course-scenarios`, {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({
                    courseScenarioId: scenarioId,
                    courseId: targetCourseId,
                    scenarioTemplateId: scenario.scenarioTemplateId,
                    deadline: scenario.deadline || null,
                    maxAttempts: scenario.maxAttempts ?? 0,
                    assigned_to_groups: scenario.assigned_to_groups || null,
                    status: 'active'
                })
            });
            if (!addRes.ok) throw new Error(await addRes.text());

            // 2. Smažeme ze starého kurzu
            const delRes = await fetch(`${API_BASE}/courses/${fromCourseId}/scenarios/${scenarioId}`, {
                method: 'DELETE', headers: getHeaders()
            });
            if (!delRes.ok) throw new Error(await delRes.text());

            showToast(`Zadání "${scenarioTitle}" bylo přesunuto do kurzu "${targetName}".`);
            await loadScenarios();
            if (document.getElementById('courseDetailModal').style.display !== 'none') {
                openCourseDetail(fromCourseId, 2);
            }
        } catch (err) { showToast(`Chyba při přesunu: ${err.message}`, true); }
    };

    window.executeScenarioDelete = function(courseId, scenarioId, scenarioTitle) {
        document.getElementById('scenarioActionOverlay').remove();
        removeScenarioFromCourse(courseId, scenarioId, scenarioTitle);
    };

    function switchCourseTab(tabIndex) {
        [1,2,3,4].forEach(i => {
            document.getElementById("courseTab" + i).style.display = "none";
            document.getElementById("tabBtn" + i).classList.remove("active-tab");
        });
        document.getElementById("courseTab" + tabIndex).style.display = "block";
        document.getElementById("tabBtn" + tabIndex).classList.add("active-tab");

        // Při přepnutí na záložku materiálů načti seznam
        if (tabIndex === 4 && window.activeDetailCourseId) {
            loadCourseMaterials(window.activeDetailCourseId);
        }
    }
    window.switchCourseTab = switchCourseTab; // Pojistka pro všechny případy

// Otevření detailu kurzu pro přejmenování a správu scénářů
async function openCourseDetail(courseId, targetTab = 1) {
    const course = allLoadedCourses.find(c => c.courseId === courseId);
    if (!course) return;
    activeDetailCourseId = courseId;
    window.activeDetailCourseId = courseId;
    
    // 1. BEZPEČNÉ NAJITÍ UŽIVATELE (IGNORUJE VELIKOST PÍSMEN)
    const safeCurrentEmail = (currentUserEmail || "").trim().toLowerCase();
    const meUser = allLoadedUsers.find(u => u.email && u.email.trim().toLowerCase() === safeCurrentEmail);
    
    // 2. KONTROLA ROLE ADMINA
    const amIAdmin = meUser && String(meUser.global_role).toLowerCase() === 'admin' || (currentUserEmail || "").trim().toLowerCase() === 'admin@unob.cz';
    const isOwner = course.ownerUserId === (meUser ? meUser.user_id : null);
    const isTeacherInCourse = meUser && meUser.course_ids && meUser.course_ids.includes(courseId);

    // 3. ADMIN JE VŽDY MANAŽER, I KDYŽ NENÍ V KURZU ZAPSANÝ
    const amIManager = amIAdmin || isOwner || isTeacherInCourse;

    // ODEMKNUTÍ UI PRVKŮ
    document.getElementById('detailCourseNameInput').value = course.title;
    const descInput = document.getElementById('detailCourseDescriptionInput');
    if (descInput) descInput.value = course.description || '';
    document.getElementById('detailCourseNameInput').disabled = !amIManager;
    document.getElementById('courseRenameStatus').innerText = "";
    document.getElementById('btnRenameCourse').style.display = amIManager ? 'block' : 'none';
    document.getElementById('addManagerRow').style.display = amIManager ? 'flex' : 'none';
    document.getElementById('deleteCourseRow').style.display = amIManager ? 'flex' : 'none';

    // RESET — jeden čistý stav před načtením
    document.getElementById('detailCourseManagers').innerHTML = '<div class="muted" style="padding:6px;">Načítám správce kurzu...</div>';
    document.getElementById('detailCourseScenarios').innerHTML = '<div class="muted" style="padding:6px;">Načítám zadání...</div>';
    document.getElementById('detailCourseGroups').innerHTML = '<div class="muted" style="padding:6px;">Načítám skupiny v kurzu...</div>';
    document.getElementById('detailCourseStudents').innerHTML = '<div class="muted" style="padding:6px;">Načítám seznam studentů...</div>';
    document.getElementById('addGroupRow').style.display = 'flex';
    document.getElementById('addStudentRow').style.display = 'flex';
    document.getElementById('courseDetailAddGroupSelect').innerHTML = '<option value="">Načítám skupiny...</option>';
    document.getElementById('courseDetailAddStudentSelect').innerHTML = '<option value="">Načítám studenty...</option>';

    // OTEVŘEME MODAL NA POŽADOVANÉ ZÁLOŽCE
    document.getElementById('courseDetailModal').style.display = 'flex';
    switchCourseTab(targetTab);

    // 1. ZÁLOŽKA: Správci kurzu — načteme živá data
    const managersDiv = document.getElementById('detailCourseManagers');
    if (amIManager) {
        document.getElementById('addManagerRow').style.display = 'flex';
        document.getElementById('courseDetailAddTeacherSelect').innerHTML = '<option value="">Načítám učitele...</option>';
    }
    try {
        await loadUsers();
        const courseTeachers = allLoadedUsers.filter(u => u.course_ids && u.course_ids.includes(courseId) && ['teacher', 'admin'].includes(u.global_role));

        managersDiv.innerHTML = courseTeachers.length ? courseTeachers.map(t => {
            const isMe = t.email === currentUserEmail;
            const isOwnerT = t.user_id === course.ownerUserId;

            let actionHtml = "";
            if (isMe) actionHtml = "";
            else if (isOwnerT && !amIAdmin) actionHtml = "";
            else if (amIManager) actionHtml = `<button class="btn-small" style="background: #dc2626; color: white; padding: 2px 8px; font-size: 11px;" onclick="removeMemberFromCourseContext('${courseId}', '${t.user_id}', '${escapeJsString(t.display_name || t.email)}', 1)">Odebrat</button>`;

            const badgeHtml = isOwnerT ? `<span class="badge" style="background: #fef3c7; color: #d97706; margin-left: 8px; font-size: 10px; border: 1px solid #f59e0b;">Majitel</span>` : "";

            return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span>• <strong>${t.display_name || t.email}</strong> ${badgeHtml}</span>
                ${actionHtml}
            </div>`;
        }).join("") : '<div class="muted" style="padding:6px;">Žádní správci.</div>';

        if (amIManager) {
            const availableTeachers = allLoadedUsers.filter(u => ['teacher', 'admin'].includes(u.global_role) && (!u.course_ids || !u.course_ids.includes(courseId)));
            const addSelect = document.getElementById('courseDetailAddTeacherSelect');
            addSelect.innerHTML = '<option value="">— Vyberte učitele k přidání —</option>' +
                availableTeachers.map(t => `<option value="${t.user_id}">${t.display_name || t.email}</option>`).join("");
        }
    } catch (err) {
        managersDiv.innerHTML = '<div class="muted" style="padding:6px;">Chyba při načítání správců.</div>';
    }
        
    // 2. ZÁLOŽKA: Vykreslení zadání v kurzu
    const scenariosDiv = document.getElementById('detailCourseScenarios');
    try {
        const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios`, { headers: getHeaders() });
        const scenarios = await res.json();
        scenariosDiv.innerHTML = scenarios.length ? scenarios.map(s => {
            const btnHtml = amIManager ? `<button class="btn-small" style="background: #6b7280;" onclick="openScenarioActionModal('${escapeJsString(courseId)}', '${escapeJsString(s.scenarioId)}', '${escapeJsString(s.title)}')">Přesunout / Smazat</button>` : ``;
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span>• <strong>${escapeHtml(s.title)}</strong></span>
                ${btnHtml}
            </div>`;
        }).join("") : '<div class="muted" style="padding:6px;">V tomto kurzu nejsou žádná zadání.</div>';
    } catch (err) { scenariosDiv.innerHTML = "Chyba při načítání."; }

    // 3. ZÁLOŽKA: Vykreslení skupin a studentů v kurzu
    const groupsDiv = document.getElementById('detailCourseGroups');
    const studentsDiv = document.getElementById('detailCourseStudents');
    // Reset už proběhl výše — rovnou fetchujeme

    try {
        // NOVINKA: Musíme se zeptat serveru na reálné stavy členství (active/inactive)
        const statusRes = await fetch(`${API_BASE}/courses/${courseId}/members`, { headers: getHeaders() });
        const memberStatuses = await statusRes.json(); // Seznam {userId, role, status}

        const studentsInCourse = allLoadedUsers.filter(u => u.course_ids && u.course_ids.includes(courseId) && u.global_role === 'student');
        const courseGroupIds = new Set();
        // Zajistíme, že ID skupiny je vždy čistý string bez mezer
        studentsInCourse.forEach(u => { if (u.group_ids) u.group_ids.forEach(gid => courseGroupIds.add(String(gid).trim())); });

        groupsDiv.innerHTML = courseGroupIds.size ? Array.from(courseGroupIds).map(gid => {
            const cleanGid = String(gid).trim();
            // 1. Spolehlivé dohledání přes centrální funkce
            const g = allLoadedGroups.find(gr => getGroupId(gr) === cleanGid);
            const gName = g ? getGroupTitle(g) : cleanGid;
            
            // 2. Najdeme přímo objekty studentů, kteří jsou v této skupině
            const groupStudents = studentsInCourse.filter(s => 
                s.group_ids && s.group_ids.map(id => String(id).trim()).includes(cleanGid)
            );
            
            // 3. Neprůstřelné spárování s daty z backendu (porovnáme vůči ID i E-mailu bez ohledu na velká/malá písmena)
            const groupMembersData = memberStatuses.filter(ms => {
                const msId = String(ms.userId || ms.user_id || "").trim().toLowerCase();
                return groupStudents.some(s => 
                    String(s.user_id).trim().toLowerCase() === msId || 
                    String(s.email).trim().toLowerCase() === msId
                );
            });
            
            // 4. Skupina je Active, pokud v ní je aspoň jeden student spárován a má aktivní stav
            const isActive = groupMembersData.length > 0 && groupMembersData.some(ms => ms.status !== 'inactive');

            const selectHtml = amIManager ? `
                <select onchange="toggleGroupCourseStatus('${courseId}', '${gid}', this.value, this)"
                        class="${isActive ? 'status-select-active' : 'status-select-inactive'}"
                        style="margin:0 10px 0 auto; padding:2px 4px; font-size:11px; width:auto; border-radius:4px;">
                    <option value="active" ${isActive ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${!isActive ? 'selected' : ''}>Inactive</option>
                </select>` : "";

            const btnHtml = amIManager ? `<button class="btn-small" style="background: #dc2626; color: white; padding: 2px 8px; font-size: 11px;" onclick="promptRemoveGroupFromCourse('${courseId}', '${gid}', '${escapeJsString(gName)}')">Odebrat</button>` : "";
            
            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span style="flex: 1;">• <strong>${escapeHtml(gName)}</strong></span>${selectHtml}${btnHtml}
            </div>`;
        }).join("") : "<div class='muted'>V kurzu nejsou zapsány žádné skupiny.</div>";

        // OPRAVA: Vyfiltrujeme pouze studenty, kteří jsou v tomto kurzu reálně ACTIVE
        const activeStudentsInCourse = studentsInCourse.filter(s => {
            const statusEntry = memberStatuses.find(ms => 
                String(ms.userId || ms.user_id || "").toLowerCase() === String(s.email || s.user_id || "").toLowerCase()
            );
            return statusEntry && statusEntry.status !== 'inactive';
        });

        studentsDiv.innerHTML = activeStudentsInCourse.length ? activeStudentsInCourse.map(s => {
            const btnHtml = amIManager ? `<button class="btn-small" style="background: #dc2626; color: white; padding: 2px 8px; font-size: 11px;" onclick="removeMemberFromCourseContext('${courseId}', '${s.user_id}', '${escapeJsString(s.display_name || s.email)}', 3)">Odebrat</button>` : "";
            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span>• <strong>${escapeHtml(s.display_name || s.email)}</strong></span>${btnHtml}
            </div>`;
        }).join("") : "<div class='muted'>V kurzu nejsou zapsáni žádní aktivní studenti.</div>";
    // Naplnění roletek — uvnitř try kde je memberStatuses dostupné
        if (amIManager) {
            const addGroupSelect = document.getElementById('courseDetailAddGroupSelect');
            const addStudentSelect = document.getElementById('courseDetailAddStudentSelect');
            document.getElementById('addGroupRow').style.display = 'flex';
            document.getElementById('addStudentRow').style.display = 'flex';

            addGroupSelect.innerHTML = '<option value="">— Vyberte skupinu —</option>' +
                allLoadedGroups.map(g => `<option value="${getGroupId(g)}">${escapeHtml(getGroupTitle(g))}</option>`).join("");

            const memberIds = memberStatuses.map(m => String(m.userId || '').trim().toLowerCase());
            const availableStudents = allLoadedUsers.filter(u =>
                u.global_role === 'student' &&
                !memberIds.includes(String(u.user_id || u.email || '').trim().toLowerCase())
            );
            addStudentSelect.innerHTML = '<option value="">— Vyberte studenta —</option>' +
                availableStudents.map(s => `<option value="${s.user_id}">${escapeHtml(s.display_name || s.email)}</option>`).join("");
        } else {
            document.getElementById('addGroupRow').style.display = 'none';
            document.getElementById('addStudentRow').style.display = 'none';
        }
    } catch (err) { groupsDiv.innerHTML = "Chyba při načítání stavů členů."; }
}
    

    async function addStudentToCourseFromDetail() {
        const userId = document.getElementById('courseDetailAddStudentSelect').value;
        if (!userId || !activeDetailCourseId) return;
        
        const btn = document.querySelector('#addStudentRow button');
        const originalText = btn.innerText;
        btn.innerText = "Přidávám...";
        btn.disabled = true;
        
        try {
            const res = await fetch(`${API_BASE}/courses/${activeDetailCourseId}/members`, {
                method: "POST", headers: getHeaders(), 
                body: JSON.stringify({ user_id: userId, role_in_course: "student" })
            });
            if (!res.ok) throw new Error(await res.text());
            const user = allLoadedUsers.find(u => u.user_id === userId);
            if (user) {
                if (!user.course_ids) user.course_ids = [];
                user.course_ids.push(activeDetailCourseId);
                // Nastavíme výchozí status, aby UI nemělo prázdnou hodnotu
                if (!user.course_statuses) user.course_statuses = {};
                user.course_statuses[activeDetailCourseId] = 'active';
            }
            
            btn.innerText = "Úspěšně přidán";
            btn.style.background = "#10b981"; // Zelená barva
            
            openCourseDetail(activeDetailCourseId, 3); 
            loadMyCourses(); 
            
            setTimeout(() => { btn.innerText = originalText; btn.style.background = "var(--btn-primary)"; btn.disabled = false; }, 3000);
        } catch (err) { 
            btn.innerText = "Chyba při přidání";
            btn.style.background = "#dc2626"; // Červená barva
            setTimeout(() => { btn.innerText = originalText; btn.style.background = "var(--btn-primary)"; btn.disabled = false; }, 3000);
        }
    }

    async function addGroupToCourseFromDetail() {
        const groupId = document.getElementById('courseDetailAddGroupSelect').value;
        if (!groupId || !activeDetailCourseId) return;
        
        const btn = document.querySelector('#addGroupRow button');
        const originalText = btn.innerText;
        btn.innerText = "Zpracovávám...";
        btn.disabled = true;

        const members = allLoadedUsers.filter(u => u.group_ids && u.group_ids.includes(groupId) && u.global_role === "student");
        if (members.length === 0) {
            btn.innerText = "Skupina je prázdná";
            btn.style.background = "#dc2626"; // Červená
            setTimeout(() => { btn.innerText = originalText; btn.style.background = "var(--btn-primary)"; btn.disabled = false; }, 3000);
            return;
        }

        let successCount = 0;
        let skippedCount = 0;
        
        for (const user of members) {
            if (user.course_ids && user.course_ids.includes(activeDetailCourseId)) {
                skippedCount++;
                continue;
            }
            try {
                const res = await fetch(`${API_BASE}/courses/${activeDetailCourseId}/members`, {
                    method: "POST", headers: getHeaders(),
                    body: JSON.stringify({ user_id: user.user_id, role_in_course: "student" })
                });
                if (res.ok) {
                    successCount++;
                    if (!user.course_ids) user.course_ids = [];
                    user.course_ids.push(activeDetailCourseId);
                }
            } catch (e) {}
        }
        
        btn.innerText = `Přidáno: ${successCount} | Již v kurzu: ${skippedCount}`;
        btn.style.background = "#10b981"; // Zelená
        
        openCourseDetail(activeDetailCourseId, 3);
        loadMyCourses();
        
        setTimeout(() => { 
            btn.innerText = originalText; 
            btn.style.background = "var(--btn-primary)"; 
            btn.disabled = false; 
        }, 4000);
    }

    async function addTeacherToCourseFromDetail() {
        const select = document.getElementById('courseDetailAddTeacherSelect');
        const userId = select.value;
        if (!userId || !activeDetailCourseId) return;
        const user = allLoadedUsers.find(u => u.user_id === userId);
        const uName = user ? (user.display_name || user.email) : userId;
        showToast(`Přidávám učitele "${uName}" do správy kurzu...`);
        try {
            const res = await fetch(`${API_BASE}/courses/${activeDetailCourseId}/members`, {
                method: "POST", headers: getHeaders(),
                body: JSON.stringify({ user_id: userId, role_in_course: "teacher" })
            });
            if (!res.ok) throw new Error(await res.text());
            showToast(`Učitel "${uName}" byl úspěšně přidán do správy kurzu.`);
            loadMyCourses();
        } catch (err) {
            showToast(`Nepodařilo se přidat učitele "${uName}": ${err.message}`, true);
        }
    }

    function removeMemberFromCourseContext(courseId, userId, userName, targetTab = 1) {
        const userToRemove = allLoadedUsers.find(u => u.user_id === userId);
        if (userToRemove && userToRemove.email === currentUserEmail) {
            showToast("Nemůžete z kurzu odebrat sami sebe.", true);
            return;
        }

        customConfirm("Odebrat uživatele", `Opravdu chcete odebrat uživatele "${userName}" z tohoto kurzu?`, "Ano, odebrat", async () => {
            showToast(`Odebírám "${userName}" z kurzu...`);
            try {
                const res = await fetch(`${API_BASE}/courses/${courseId}/members/${userId}`, {
                    method: "DELETE", headers: getHeaders()
                });
                if (!res.ok) throw new Error(await res.text());
                await loadUsers();
                await loadMyCourses();
                showToast(`Uživatel "${userName}" byl úspěšně odebrán z kurzu.`);
            } catch (err) { showToast(`Nepodařilo se odebrat "${userName}": ${err.message}`, true); }
        });
    }

    async function saveCourseSettings() {
        const nameInput = document.getElementById("detailCourseNameInput");
        const descInput = document.getElementById("detailCourseDescriptionInput");
        const btn = document.getElementById("btnRenameCourse");
        const newTitle = nameInput.value.trim();
        const newDescription = descInput ? descInput.value.trim() : null;

        if (!activeDetailCourseId) return;
        if (!newTitle) { showToast("Zadejte název kurzu.", true); return; }

        if (btn) { btn.disabled = true; btn.style.background = "#9ca3af"; btn.style.pointerEvents = "none"; btn.textContent = "Ukládám..."; }
        showToast("Ukládám změny...");

        try {
            const res = await fetch(`${API_BASE}/courses/${activeDetailCourseId}`, {
                method: "PUT",
                headers: getHeaders(),
                body: JSON.stringify({ title: newTitle, description: newDescription })
            });
            if (!res.ok) throw new Error(await res.text());

            const localCourse = allLoadedCourses.find(c => c.courseId === activeDetailCourseId);
            if (localCourse) { localCourse.title = newTitle; if (newDescription !== null) localCourse.description = newDescription; }

            await loadMyCourses();
            showToast("Změny byly uloženy.");
        } catch (err) {
            showToast(`Chyba: ${err.message}`, true);
        } finally {
            if (btn) { btn.disabled = false; btn.style.background = ""; btn.style.pointerEvents = ""; btn.textContent = "Uložit změny"; }
        }
    }


    async function allowNextAttempt(scenarioId, userId, userName, nextAttemptNum, isAiScenario = false) {
        // Pro AI scénáře (ADAPTIVE) rovnou povol bez modalu — varianty nejsou relevantní
        if (!isAiScenario) {
            const scenarioQuick = window.allLoadedScenariosForAttempts?.find(s => s.scenarioId === scenarioId);
            const hintsQuick = scenarioQuick?.hints || '';
            isAiScenario = hintsQuick.includes('[ADAPTIVE:true]') || scenarioQuick?.difficulty === 'adaptive';
        }
        if (isAiScenario) {
            customConfirm(
                'Povolit další pokus',
                `Přejete si povolit ${nextAttemptNum}. pokus pro studenta <strong>${escapeHtml(userName)}</strong>?<br><span style="font-size:12px;color:var(--text-muted);">AI zadání nemá varianty — nový pokus začne automaticky s novou sadou otázek.</span>`,
                'Potvrdit a povolit',
                async () => {
                    showToast(`Povoluji ${nextAttemptNum}. pokus pro studenta "${userName}"...`);
                    document.querySelectorAll('[data-allow-btn]').forEach(btn => { btn.disabled = true; btn.style.opacity = '0.4'; });
                    try {
                        const res = await fetch(`${API_BASE}/attempts/${scenarioId}/users/${userId}/allow-next`, {
                            method: "POST", headers: getHeaders()
                        });
                        if (!res.ok) throw new Error(await res.text());
                        showToast(`${nextAttemptNum}. pokus pro studenta "${userName}" byl úspěšně povolen.`);
                        const btn = document.querySelector(`[data-allow-btn="${escapeJsString(scenarioId)}-${escapeJsString(userId)}"]`);
                        if (btn) { btn.innerText = `Povolen ${nextAttemptNum}. pokus`; btn.style.background = '#059669'; btn.disabled = true; btn.style.cursor = 'default'; btn.removeAttribute('onclick'); }
                        await loadAttempts(true);
                    } catch (err) { showToast(`Nepodařilo se povolit pokus: ${err.message}`, true); }
                }
            );
            return;
        }

        // 1. Okamžitě zobraz modal s načítáním
        document.getElementById('allowAttemptText').innerHTML = `Povolení <strong>${nextAttemptNum}. pokusu</strong> pro studenta <strong>${escapeHtml(userName)}</strong>`;
        const copySection = document.getElementById('allowAttemptCopySection');
        const sourceSelect = document.getElementById('allowAttemptSourceSelect');
        copySection.style.display = 'block';
        sourceSelect.innerHTML = '<option value="">Načítám varianty...</option>';
        document.getElementById('btnConfirmAllow').disabled = true;
        document.getElementById('allowAttemptModal').style.display = 'flex';

        // 2. Na pozadí načti čerstvá data
        let scenario = window.allLoadedScenariosForAttempts?.find(s => s.scenarioId === scenarioId);
        try {
            if (scenario) {
                const res = await fetch(`${API_BASE}/courses/${scenario.courseId}/scenarios`, { headers: getHeaders() });
                if (res.ok) {
                    const freshScenarios = await res.json();
                    window.allLoadedScenariosForAttempts = freshScenarios;
                    scenario = freshScenarios.find(s => s.scenarioId === scenarioId) || scenario;
                }
            }
        } catch { }

        const hints = scenario?.hints || "";

        // 3. Zjisti varianty
        const existingInstNums = [1];
        const matches = hints.match(/\[INST(\d+):/g);
        if (matches) matches.forEach(m => existingInstNums.push(parseInt(m.match(/\d+/)[0])));
        const variantMatches = (scenario?.instructions || "").matchAll(/\[VARIANT(\d+)\]/g);
        for (const vm of variantMatches) existingInstNums.push(parseInt(vm[1]));
        const sortedSources = [...new Set(existingInstNums)].sort((a, b) => a - b);

        // hasMappingOrText = pokus má již přiřazenou variantu v hints → nepřepisujeme
        const hasMappingOrText = hints.includes(`[MAP${nextAttemptNum}:`);

        // 4. Naplň select variantami — vždy zobraz výběr pokud existuje více variant
        if (sortedSources.length > 1) {
            sourceSelect.innerHTML = sortedSources.map(num => `<option value="${num}">Varianta ${num}</option>`).join("");
            copySection.style.display = 'block';
        } else {
            sourceSelect.innerHTML = `<option value="1">Varianta 1</option>`;
            copySection.style.display = 'none';
            document.getElementById('allowAttemptText').innerHTML =
                `Povolení <strong>${nextAttemptNum}. pokusu</strong> pro studenta <strong>${escapeHtml(userName)}</strong><br>
                <span style="font-size:12px; color:var(--text-muted);">Zadání má pouze 1 variantu — bude přiřazena automaticky.</span>`;
        }
        document.getElementById('btnConfirmAllow').disabled = false;

        // 5. Potvrzení
        const confirmBtn = document.getElementById('btnConfirmAllow');
        confirmBtn.onclick = async function() {
            document.getElementById('allowAttemptModal').style.display = 'none';
            // Okamžitě zablokuj a zešedni všechna "Povolit X. pokus" tlačítka
            document.querySelectorAll('[data-allow-btn]').forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.4';
            });
            // Toast okamžitě po kliknutí
            const variantNum = parseInt(sourceSelect.value) || 1;
            const variantInfo = sortedSources.length > 1 ? ` s Variantou ${variantNum}` : '';
            showToast(`Povoluji ${nextAttemptNum}. pokus pro studenta "${userName}"${variantInfo}...`);

            {
                const sNum = variantNum;
                if (sNum) {
                    const newHints = hints + `[MAP${nextAttemptNum}:${sNum}]`;
                    try {
                        const res = await fetch(`${API_BASE}/courses/${scenario.courseId}/scenarios/${scenarioId}`, {
                            method: "PUT", headers: getHeaders(),
                            body: JSON.stringify({
                                title: scenario.title,
                                description: scenario.description || "",
                                instructions: scenario.instructions || "",
                                deadline: scenario.deadline || null,
                                maxAttempts: scenario.maxAttempts || 0,
                                hints: newHints
                            })
                        });
                        if (!res.ok) throw new Error(await res.text());
                        scenario.hints = newHints;
                    } catch (e) {
                        showToast("Uložení varianty selhalo: " + e.message, true);
                        return;
                    }
                }
            }

            try {
                const res = await fetch(`${API_BASE}/attempts/${scenarioId}/users/${userId}/allow-next`, {
                    method: "POST", headers: getHeaders()
                });
                if (!res.ok) throw new Error(await res.text());
                showToast(`${nextAttemptNum}. pokus pro studenta "${userName}"${variantInfo} byl úspěšně povolen.`);
                // Okamžitě přepíšeme tlačítko bez čekání na reload
                const btn = document.querySelector(`[data-allow-btn="${scenarioId}-${userId}"]`);
                if (btn) {
                    btn.innerText = `Povolen ${nextAttemptNum}. pokus`;
                    btn.style.background = '#059669';
                    btn.disabled = true;
                    btn.style.cursor = 'default';
                    btn.removeAttribute('onclick');
                }
                await loadAttempts(true);
            } catch (err) { showToast(`Nepodařilo se povolit pokus: ${err.message}`, true); }
        };
    }

    // --- LOGIKA PRO ODEBÍRÁNÍ SKUPIN Z KURZU ---
    let rgcCurrentCourse = null;
    let rgcCurrentGroup = null;

    function promptRemoveGroupFromCourse(courseId, groupId, groupName) {
        rgcCurrentCourse = courseId;
        rgcCurrentGroup = groupId;
        
        // Obnovíme původní stav okna
        document.getElementById('rgcStep1').style.display = 'block';
        document.getElementById('rgcStep2').style.display = 'none';
        
        document.getElementById('rgcQuestion').innerHTML = `Přejete si odstranit <strong>všechny studenty</strong> patřící do skupiny <strong>${escapeHtml(groupName)}</strong> z tohoto kurzu?`;
        document.getElementById('removeGroupCourseModal').style.display = 'flex';
    }

    async function executeRemoveWholeGroup() {
        const courseId = rgcCurrentCourse;
        const groupId = rgcCurrentGroup;
        
        const members = allLoadedUsers.filter(u => u.group_ids && u.group_ids.includes(groupId) && u.course_ids && u.course_ids.includes(courseId));
        
        document.getElementById('rgcStep1').innerHTML = "<p style='color:#1d4ed8; font-weight:bold;'>Odstraňuji všechny členy skupiny...</p>";
        
        for (const user of members) {
            try {
                await fetch(`${API_BASE}/courses/${courseId}/members/${user.user_id}`, { method: "DELETE", headers: getHeaders() });
            } catch(e) {}
        }
        
        document.getElementById('removeGroupCourseModal').style.display = 'none';
        showToast("Celá skupina byla z kurzu odebrána."); // <-- NAŠE BUBLINA
        await loadUsers();
        await loadMyCourses();
        openCourseDetail(courseId, 3); // Návrat na 3. záložku
    }

    function showSelectiveGroupRemove() {
        const courseId = rgcCurrentCourse;
        const groupId = rgcCurrentGroup;
        
        // Najdeme studenty z této skupiny, kteří jsou aktuálně v kurzu
        const studentsInGroupAndCourse = allLoadedUsers.filter(u => u.group_ids && u.group_ids.includes(groupId) && u.course_ids && u.course_ids.includes(courseId) && u.global_role === 'student');
        
        const listDiv = document.getElementById('rgcStudentList');
        listDiv.innerHTML = studentsInGroupAndCourse.map(s => `
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; padding: 4px; border-radius: 4px; transition: 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="rgc-checkbox" value="${s.user_id}" checked style="width: 16px; height: 16px; margin: 0;" />
                <span>${escapeHtml(s.display_name || s.email)}</span>
            </label>
        `).join("");
        
        document.getElementById('rgcStep1').style.display = 'none';
        document.getElementById('rgcStep2').style.display = 'block';
    }

    async function executeSelectiveGroupRemove() {
        const courseId = rgcCurrentCourse;
        const checkboxes = document.querySelectorAll('.rgc-checkbox');
        
        const usersToRemove = [];
        checkboxes.forEach(cb => {
            if (!cb.checked) usersToRemove.push(cb.value); // Nezaškrtnuté chceme odstranit
        });
        
        if (usersToRemove.length === 0) {
            document.getElementById('removeGroupCourseModal').style.display = 'none';
            return;
        }

        const originalBtnHtml = document.getElementById('rgcStep2').innerHTML;
        document.getElementById('rgcStep2').innerHTML = "<p style='color:#1d4ed8; font-weight:bold; text-align:center;'>Odstraňuji vybrané studenty...</p>";
        
        for (const userId of usersToRemove) {
            try {
                await fetch(`${API_BASE}/courses/${courseId}/members/${userId}`, { method: "DELETE", headers: getHeaders() });
            } catch(e) {}
        }
        
        document.getElementById('rgcStep2').innerHTML = originalBtnHtml;
        document.getElementById('removeGroupCourseModal').style.display = 'none';
        
        showToast(`Odstraněno ${usersToRemove.length} studentů ze skupiny.`); // <-- NAŠE BUBLINA
        await loadUsers();
        await loadMyCourses();
        openCourseDetail(courseId, 3); // Návrat na 3. záložku
    }

    function _syncAiSubTypeCreate(isEdu) {
        const exIds = ['aiEx_row2', 'aiEx_qtypes', 'aiEx_rubric', 'aiEx_skipCell', 'aiEx_subtasksCell', 'aiEx_gradingStyleCell', 'aiScenarioMaxPointsWrapper', 'aiEx_deadlineCell'];
        exIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = isEdu ? 'none' : '';
        });
        // row1 contains title+OS (shared) and difficulty+adaptive (exercise-only) — hide only the exercise cells
        const diffEl = document.getElementById('aiScenarioDifficulty');
        const adaptEl = document.getElementById('aiScenarioAdaptive');
        if (diffEl) diffEl.closest('.grow-1').style.display = isEdu ? 'none' : '';
        if (adaptEl) adaptEl.closest('.grow-1').style.display = isEdu ? 'none' : '';
        const eduEl = document.getElementById('aiEdu_fields');
        if (eduEl) eduEl.style.display = isEdu ? 'block' : 'none';
        const btn = document.getElementById('aiScenarioCreateBtn');
        if (btn) btn.textContent = isEdu ? 'Vytvořit AI Vzdělávání' : 'Vytvořit AI Scénář';
    }

    function toggleScenarioFormType() {
        const type = document.getElementById("scenarioTaskType").value;

        const prereqSection = document.getElementById("prereqsCreateSection");

        // Pokud ještě není vybrán typ zadání, schováme vše
        if (!type) {
            document.getElementById("standardScenarioFields").style.display = "none";
            document.getElementById("aiScenarioFields").style.display = "none";
            if (prereqSection) prereqSection.style.display = "none";
        }
        else if (type === "adaptive") {
            document.getElementById("standardScenarioFields").style.display = "none";
            document.getElementById("aiScenarioFields").style.display = "block";
            if (prereqSection) prereqSection.style.display = "block";
            _syncAiSubTypeCreate(false);
        }
        else if (type === "ai_education") {
            document.getElementById("standardScenarioFields").style.display = "none";
            document.getElementById("aiScenarioFields").style.display = "block";
            if (prereqSection) prereqSection.style.display = "block";
            _syncAiSubTypeCreate(true);
        }
        else {
            document.getElementById("standardScenarioFields").style.display = "block";
            document.getElementById("aiScenarioFields").style.display = "none";
            if (prereqSection) prereqSection.style.display = "block";

            // Drobné UX vylepšení: Pokud učitel vybere Zkoušku, automaticky přepneme na 1 pokus
            if (type === "exam") {
                document.getElementById("scenarioAttempts").value = "custom";
                document.getElementById("scenarioCustomAttempts").style.display = "block";
                document.getElementById("scenarioCustomAttempts").value = "1";
            } else if (type === "practice") {
                document.getElementById("scenarioAttempts").value = "0"; // Neomezeně
                document.getElementById("scenarioCustomAttempts").style.display = "none";
            }

            window.syncScenarioFormLocks(false);
        }
    }

    
    window.syncAiContextVisibility = function(mode = 'create') {
        const isEdit = mode === 'edit';
        const aiCb = document.getElementById(isEdit ? 'edit_useAICb' : 'scenarioUseAI');
        const wrapper = document.getElementById(isEdit ? 'edit_aiGlobalContextWrapper' : 'aiGlobalContextWrapper');

        if (!wrapper) return;
        wrapper.style.display = aiCb?.checked ? 'block' : 'none';
    };

    window.extractAiGlobalContext = function(gradingRubric) {
        const raw = String(gradingRubric || '').trim();
        if (!raw) return '';
        const blockMatch = raw.match(/\[AI_GLOBAL_CONTEXT\]([\s\S]*?)\[\/AI_GLOBAL_CONTEXT\]/i);
        if (blockMatch) return blockMatch[1].trim();
        if (raw === 'AI_ENABLED' || raw === 'AI_DISABLED') return '';
        return raw;
    };

    window.buildScenarioGradingRubric = function(useAI, aiGlobalContext) {
        if (!useAI) return 'AI_DISABLED';
        const context = String(aiGlobalContext || '').trim();
        if (!context) return 'AI_ENABLED';
        return `AI_ENABLED\n[AI_GLOBAL_CONTEXT]\n${context}\n[/AI_GLOBAL_CONTEXT]`;
    };

    window.togglePassThreshold = function(inputId) {
        const w = document.getElementById(inputId);
        const cb = document.getElementById(inputId.replace('Input','Cb'));
        if (w) w.style.display = cb?.checked ? 'flex' : 'none';
    };

    function syncEditAutoSubmitAiLock() {
        window.syncScenarioFormLocks(true);
    }
    window.syncEditAutoSubmitAiLock = syncEditAutoSubmitAiLock;

    window.onEditScenarioTaskTypeChange = function() {
        const type = document.getElementById('edit_scenarioTaskType')?.value || 'practice';

        // Přepnutí na Zkoušku → 1 pokus (stejné chování jako v create formu)
        if (type === 'exam') {
            const attemptsEl = document.getElementById('edit_scenarioAttempts');
            const customEl = document.getElementById('edit_scenarioCustomAttempts');
            if (attemptsEl) attemptsEl.value = 'custom';
            if (customEl) { customEl.style.display = 'block'; if (!customEl.value || customEl.value === '0') customEl.value = '1'; }
        } else if (type === 'practice') {
            const attemptsEl = document.getElementById('edit_scenarioAttempts');
            const customEl = document.getElementById('edit_scenarioCustomAttempts');
            if (attemptsEl && attemptsEl.value === 'custom' && customEl?.value === '1') {
                attemptsEl.value = '0';
                customEl.style.display = 'none';
            }
        }

        // Aktualizuj viditelnost polí závislých na typu (AutoSubmit, PassThreshold, AI lock)
        window.syncScenarioFormLocks(true);
    };

    window.toggleTaskAccordion = function(headerEl) {
        const row = headerEl?.closest('.task-row');
        if (!row) return;
        row.classList.toggle('task-row-collapsed');
        // Refresh CM editorů po otevření — jinak se zobrazí prázdné pole
        if (!row.classList.contains('task-row-collapsed')) {
            row.querySelectorAll('.code-mirror-host, .sol-text-mirror-host').forEach(host => {
                const cm = window._cmInstances?.get(host);
                if (cm) setTimeout(() => cm.refresh(), 0);
            });
        }
    };

    window.prepareTaskAccordion = function(taskRow, shouldExpand = false) {
        if (!taskRow) return;

        if (taskRow.dataset.accordionReady === 'true') {
            taskRow.classList.toggle('task-row-collapsed', !shouldExpand);
            return;
        }

        const header = taskRow.firstElementChild;
        if (!header) return;

        header.classList.add('task-accordion-header');

        const label = header.querySelector('.task-number');
        if (label && !header.querySelector('.task-accordion-title')) {
            const titleWrap = document.createElement('div');
            titleWrap.className = 'task-accordion-title';

            const arrow = document.createElement('span');
            arrow.className = 'task-accordion-arrow';
            arrow.textContent = '▼';

            titleWrap.appendChild(arrow);
            titleWrap.appendChild(label);
            header.insertBefore(titleWrap, header.firstChild);
        }

        const body = document.createElement('div');
        body.className = 'task-accordion-body';

        while (header.nextSibling) {
            body.appendChild(header.nextSibling);
        }

        taskRow.appendChild(body);

        header.addEventListener('click', function(e) {
            if (e.target.closest('.delete-task-btn')) return;
            window.toggleTaskAccordion(header);
        });

        taskRow.dataset.accordionReady = 'true';
        taskRow.classList.toggle('task-row-collapsed', !shouldExpand);
    };

    window.prepareTaskAccordions = function(scope) {
        const root = scope || document;
        root.querySelectorAll('.task-row').forEach(row => {
            window.prepareTaskAccordion(row, false);
        });
        if (typeof window.bindTaskDeleteConfirm === 'function') {
            window.bindTaskDeleteConfirm(root);
        }
    };

    document.addEventListener('DOMContentLoaded', function() {
        window.prepareTaskAccordions(document.getElementById('standardScenarioFields') || document);
        window.prepareTaskAccordions(document.getElementById('panel-scenario-edit') || document);
    });

    // --- FUNKCE PRO DYNAMICKÉ PŘIDÁVÁNÍ ÚKOLŮ S ŘEŠENÍM ---
    window._baseAddTaskField = function(btnElement) {
        const container = btnElement ? btnElement.closest('.variant-block').querySelector('.tasks-container-dynamic') : document.querySelector('#variantsContainerCreate .tasks-container-dynamic');
        if (!container) return;

        const exactCb = document.querySelector('.scenarioExactSolution-cb');
        const isExact = !!(exactCb && exactCb.checked);

        const div = document.createElement('div');
        div.className = 'task-row';
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="task-number" style="font-weight: bold; color: var(--text-primary);"></span>
                    <select class="task-type-select" onchange="window.handleTaskTypeChange(this)" style="padding: 2px 6px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); cursor: pointer;">
                        <optgroup label="Striktní (Sekvence / Automatické vyhodnocení)">
                            <option value="flag" selected>Přesný text (Flag, IP, Příkaz...)</option>
                            <option value="tf">Pravda / Nepravda</option>
                            <option value="abcd">Výběr z možnosti (A/B/C/D)</option>
                            <option value="multi">Vícenásobný výběr (Checkbox)</option>
                            <option value="sort">Seřazení kroků (Drag & Drop)</option>
                        </optgroup>
                        <optgroup label="Otevřené (Vyžaduje Učitele / AI)">
                            <option value="open">Otevřená odpověď (Report / Text)</option>
                            <option value="code">Oprava kódu (Code Review)</option>
                            <option value="image">Analýza obrázku / Záznamu</option>
                        </optgroup>
                    </select>
                </div>
                <button type="button" class="delete-task-btn" onclick="window.confirmDeleteTask(this)" style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 18px; padding: 0; line-height: 1;" title="Smazat úkol">×</button>
            </div>
            <label style="font-size:11px; color:var(--text-muted); font-weight:bold; display:block; margin-bottom:4px;">Zadání úkolu:</label>
            <textarea class="task-input" rows="2" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background: var(--bg-panel); color: var(--text-primary);" placeholder="Popište, co má student udělat..."></textarea>

            <div class="task-rubric-wrapper" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <label class="rubric-label" style="font-size:11px; color:var(--text-primary); font-weight:bold;">Kritéria bodování pro AI:</label>
                <textarea class="task-rubric" rows="2" style="width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-panel); color: var(--text-primary);" placeholder="Napište pravidla pro AI hodnocení tohoto úkolu..."></textarea>
            </div>

            <div class="task-solution-text-wrapper" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <label class="task-sol-text-label" style="font-size:11px; color:var(--text-primary); font-weight:bold;">Správné řešení (pro učitele / AI):</label>
                <div class="sol-text-mirror-host" style="display:none; margin-top:4px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden; font-size:13px;"></div>
                <textarea class="task-solution-text" rows="2" style="width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-status); color: var(--text-primary);" placeholder="Jak vypadá správné řešení tohoto úkolu..."></textarea>
            </div>

            <div class="task-config-wrapper" style="display: block; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <div class="task-type-config-container"></div>

                <div class="task-hints-container" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-color);">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
                        <label style="font-size:11px; color:var(--text-muted); font-weight:bold; white-space:nowrap;">Body za úkol:</label>
                        <input type="number" class="task-points" min="0" max="100" value="0" style="width:48px; padding:4px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary); font-size:12px; text-align:center;" />
                        <label style="display:none; align-items:center; gap:4px; cursor:pointer; font-size:11px; color:var(--text-muted); white-space:nowrap;">
                            <input type="checkbox" class="task-skippable" style="width:13px; height:13px; margin:0; cursor:pointer;" />
                            <span>Povolit přeskočení (student ztratí všechny body za úkol)</span>
                        </label>
                        <button type="button" onclick="window.addHintField(this);" style="background:var(--color-warning, #f59e0b); color:white; border:none; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:11px; white-space:nowrap; margin-left:auto;">+ nápověda</button>
                    </div>
                    <div class="hints-list"></div>
                </div>
            </div>
        `;

        container.appendChild(div);
        window.handleTaskTypeChange(div.querySelector('.task-type-select'));
        window.prepareTaskAccordion(div, true);
        window.renumberTasks(null, container);

        if (isExact) {
            const select = div.querySelector('.task-type-select');
            if (select) {
                const openGroup = Array.from(select.querySelectorAll('optgroup')).find(g => (g.label || '').includes('Otevřené'));
                if (openGroup) openGroup.disabled = true;
            }
        }
    };

    window.getTaskTypeLabel = function(type) {
        const labels = {
            flag: 'Přesný text (Flag, IP, Příkaz...)',
            tf: 'Pravda / Nepravda',
            abcd: 'Výběr z možnosti (A/B/C/D)',
            multi: 'Vícenásobný výběr (Checkbox)',
            sort: 'Seřazení kroků (Drag & Drop)',
            open: 'Otevřená odpověď (Report / Text)',
            code: 'Oprava kódu (Code Review)',
            image: 'Analýza obrázku / Záznamu'
        };
        return labels[type] || labels.flag;
    };

    window.lockTaskTypeVisual = function(taskRow, forcedType) {
        if (!taskRow) return;

        const select = taskRow.querySelector('.task-type-select');
        if (!select) return;

        const type = forcedType || select.value || 'flag';
        select.value = type;
        window.handleTaskTypeChange(select);

        let badge = taskRow.querySelector('.task-type-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'task-type-badge';
            select.parentElement.insertBefore(badge, select);
        }

        badge.textContent = window.getTaskTypeLabel(type);

        select.dataset.lockedType = type;
        select.disabled = true;
        select.tabIndex = -1;
        select.style.display = 'none';
        select.style.pointerEvents = 'none';
        select.style.opacity = '0';
        select.style.width = '0';
        select.style.minWidth = '0';
        select.style.padding = '0';
        select.style.margin = '0';
        select.style.border = '0';
    };

    window.addTaskField = function(btnElement, forcedType = null) {
        if (!forcedType) {
            window.openTaskTypePicker(btnElement, false);
            return;
        }

        if (typeof window._baseAddTaskField === 'function') {
            window._baseAddTaskField(btnElement);
        }

        const container = btnElement
            ? btnElement.closest('.variant-block')?.querySelector('.tasks-container-dynamic')
            : document.querySelector('#variantsContainerCreate .tasks-container-dynamic');

        const newRow = container?.querySelector('.task-row:last-child');
        if (!newRow) return;

        window.lockTaskTypeVisual(newRow, forcedType);
        window.bindTaskDeleteConfirm(newRow);
        if (forcedType === 'code') {
            window.initCodeMirrorInRow?.(newRow);
            window.initSolTextMirrorInRow?.(newRow);
        }
        const vBlock = newRow.closest('.variant-block');
        if (vBlock) setTimeout(() => window.recalcVariantPoints(vBlock), 0);
    };

    window.addEditTaskField = function(btnElement, forcedType = null) {
        if (!forcedType) {
            window.openTaskTypePicker(btnElement, true);
            return;
        }

        if (typeof window._baseAddEditTaskField === 'function') {
            window._baseAddEditTaskField(btnElement);
        }

        const container = btnElement
            ? btnElement.closest('.variant-block')?.querySelector('.tasks-container-dynamic')
            : document.querySelector('#variantsContainerEdit .tasks-container-dynamic');

        const newRow = container?.querySelector('.task-row:last-child');
        if (!newRow) return;

        window.lockTaskTypeVisual(newRow, forcedType);
        window.bindTaskDeleteConfirm(newRow);
        if (forcedType === 'code') {
            window.initCodeMirrorInRow?.(newRow);
            window.initSolTextMirrorInRow?.(newRow);
        }
        const vBlockEdit = newRow.closest('.variant-block');
        if (vBlockEdit) setTimeout(() => window.recalcVariantPoints(vBlockEdit), 0);
    };

    // Funkce, která hlídá sekvenční režim
    window.setTaskPointInputsState = function(taskInputs, locked, title = '') {
        taskInputs.forEach(inp => {
            inp.readOnly = locked;
            inp.style.background = locked ? 'var(--bg-status)' : 'var(--bg-panel)';
            inp.style.color = locked ? 'var(--text-muted)' : 'var(--text-primary)';
            inp.style.opacity = locked ? '0.5' : '';
            inp.style.cursor = locked ? 'not-allowed' : '';
            inp.style.pointerEvents = locked ? 'none' : '';
            inp.style.userSelect = locked ? 'none' : '';
            inp.tabIndex = locked ? -1 : 0;
            inp.title = title;
        });
    };

    window.distributePointsFromEnd = function(totalPoints, taskCount) {
        const safeTotal = Math.max(0, parseInt(totalPoints, 10) || 0);
        const safeCount = Math.max(1, parseInt(taskCount, 10) || 1);
        const base = Math.floor(safeTotal / safeCount);
        const remainder = safeTotal % safeCount;
        const result = new Array(safeCount).fill(base);

        for (let i = safeCount - 1; i >= safeCount - remainder; i -= 1) {
            result[i] += 1;
        }
        return result;
    };

    window.recalcMaxPoints = function(containerSelector, maxPointsId, exactCbSelector, seqCbSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const isEdit = containerSelector.includes('Edit');
        const exactCb = document.querySelector(exactCbSelector);
        const seqCb = document.querySelector(seqCbSelector);
        const isStrict = (exactCb && exactCb.checked) || (seqCb && seqCb.checked);
        const maxEl = document.getElementById(maxPointsId);
        const styleEl = document.getElementById(isEdit ? 'edit_scenarioGradingStyle' : 'scenarioGradingStyle');

        const gradingMode = isStrict ? 'points' : String(styleEl?.value || '').trim().toLowerCase();
        const usesPoints = isStrict || gradingMode === 'points' || gradingMode === 'equal';

        let overallMax = 0;

        container.querySelectorAll('.variant-block').forEach(vBlock => {
            const taskInputs = Array.from(vBlock.querySelectorAll('.task-points'));
            const variantDisplay = vBlock.querySelector('.variant-max-points-display');
            let variantTotal = 0;

            if (gradingMode === 'none') {
                taskInputs.forEach(inp => {
                    inp.value = 0;
                    inp.style.display = 'none';
                    
                    const prevLabel = inp.previousElementSibling;
                    if (prevLabel && prevLabel.tagName === 'LABEL') prevLabel.style.display = 'none';
                    
                    const skipLabel = inp.nextElementSibling;
                    if (skipLabel && skipLabel.tagName === 'LABEL' && skipLabel.querySelector('.task-skippable')) {
                        skipLabel.style.display = 'none';
                        skipLabel.querySelector('.task-skippable').checked = false;
                    }
                });
                window.setTaskPointInputsState(taskInputs, true, 'Úloha je bez bodů.');
                variantTotal = 0;
            } else {
                taskInputs.forEach(inp => {
                    inp.style.display = '';
                    
                    const prevLabel = inp.previousElementSibling;
                    if (prevLabel && prevLabel.tagName === 'LABEL') prevLabel.style.display = '';
                    
                    const skipLabel = inp.nextElementSibling;
                    if (skipLabel && skipLabel.tagName === 'LABEL' && skipLabel.querySelector('.task-skippable')) {
                        const inEdit = !!inp.closest('#variantsContainerEdit');
                        const seqCb = document.querySelector(inEdit ? '#edit_sequentialCb' : '.scenarioSequential-cb');
                        skipLabel.style.display = (seqCb && seqCb.checked) ? 'flex' : 'none';
                    }
                });

                if (gradingMode === 'equal') {
                    const distributed = window.distributePointsFromEnd(maxEl?.value || 0, taskInputs.length);
                    taskInputs.forEach((inp, idx) => {
                        inp.value = distributed[idx] ?? 0;
                    });
                    variantTotal = distributed.reduce((sum, val) => sum + val, 0);
                    window.setTaskPointInputsState(taskInputs, true, 'Body jsou rozděleny automaticky podle celkového počtu bodů.');
                } else if (gradingMode === 'points' || gradingMode === 'percent' || isStrict) {
                    variantTotal = taskInputs.reduce((sum, inp) => sum + (parseInt(inp.value, 10) || 0), 0);
                    window.setTaskPointInputsState(taskInputs, false, '');
                } else {
                    variantTotal = taskInputs.reduce((sum, inp) => sum + (parseInt(inp.value, 10) || 0), 0);
                    window.setTaskPointInputsState(taskInputs, true, 'Tento styl hodnocení body za úkol nepoužívá.');
                }
            }

            if (variantDisplay) {
                // Nový grading row má vlastní display — starý recalc přeskočíme
                const hasNewGradingRow = vBlock.querySelector('.variant-grading-row');
                if (!hasNewGradingRow) {
                    variantDisplay.style.display = usesPoints ? 'block' : 'none';
                    variantDisplay.innerHTML = `Součet bodů varianty: <span class="variant-sum">${variantTotal}</span>`;
                } else {
                    variantDisplay.style.display = 'none';
                }
            }

            if (variantTotal > overallMax) overallMax = variantTotal;
        });

        if (!maxEl) return;

        if (isStrict || gradingMode === 'points') {
            maxEl.value = overallMax;
            maxEl.readOnly = true;
            maxEl.style.background = 'var(--bg-status)';
            maxEl.style.color = 'var(--text-muted)';
            maxEl.style.cursor = 'not-allowed';
            maxEl.title = 'Zablokováno: hodnota se počítá automaticky jako součet bodů úkolů ve variantě.';
        } else if (gradingMode === 'equal') {
            maxEl.readOnly = false;
            maxEl.style.background = '';
            maxEl.style.color = '';
            maxEl.style.cursor = '';
            maxEl.title = 'Zadejte celkový počet bodů. Body se rozdělí rovnoměrně mezi úkoly v každé variantě.';
        } else {
            maxEl.readOnly = false;
            maxEl.style.background = '';
            maxEl.style.color = '';
            maxEl.style.cursor = '';
            maxEl.title = '';
        }
    };

    // Event delegation pro Povolit přeskočení (deaktivace a zálohování nápověd)
    document.addEventListener('change', function(e) {
        if (e.target.classList.contains('task-skippable')) {
            const container = e.target.closest('.task-hints-container');
            const hintBtn = container.querySelector('button[onclick*="addHintField"]');
            const hintsList = container.querySelector('.hints-list');

            if (e.target.checked) {
                // Deaktivace tlačítka
                if (hintBtn) {
                    hintBtn.disabled = true;
                    hintBtn.style.opacity = '0.5';
                    hintBtn.style.cursor = 'not-allowed';
                    hintBtn.title = "Nápovědy nelze kombinovat s přeskočením úkolu.";
                }
                // Zálohování a smazání existujících řádků nápověd v UI
                if (hintsList) {
                    const currentHints = Array.from(hintsList.querySelectorAll('div')).map(div => {
                        return {
                            text: div.querySelector('.hint-text')?.value || '',
                            cost: div.querySelector('.hint-cost')?.value || 1
                        };
                    });
                    if (currentHints.length > 0) {
                        hintsList.dataset.savedHints = JSON.stringify(currentHints);
                    }
                    hintsList.innerHTML = '';
                }
            } else {
                // Opětovná aktivace tlačítka
                if (hintBtn) {
                    hintBtn.disabled = false;
                    hintBtn.style.opacity = '1';
                    hintBtn.style.cursor = 'pointer';
                    hintBtn.title = "";
                }
                // Obnova zálohovaných nápověd
                if (hintsList && hintsList.dataset.savedHints) {
                    try {
                        const savedHints = JSON.parse(hintsList.dataset.savedHints);
                        savedHints.forEach(h => {
                            if (hintBtn) window.addHintField(hintBtn, h.text, h.cost);
                        });
                        hintsList.dataset.savedHints = ''; // Vyčištění zálohy po úspěšné obnově
                    } catch { }
                }
            }
        }
    });
    // Event delegation pro task-points inputy a celkové body
    document.addEventListener('input', function(e) {
        if (e.target.classList.contains('task-points')) {
            const vBlock = e.target.closest('.variant-block');
            if (vBlock && vBlock.querySelector('.variant-grading-style')) {
                window.recalcVariantPoints(vBlock);
            } else {
                const inEdit = !!e.target.closest('#variantsContainerEdit');
                if (inEdit) {
                    window.recalcMaxPoints('#variantsContainerEdit', 'edit_scenarioMaxPoints', '#edit_exactSolutionCb', '#edit_sequentialCb');
                } else {
                    window.recalcMaxPoints('#variantsContainerCreate', 'scenarioMaxPoints', '.scenarioExactSolution-cb', '.scenarioSequential-cb');
                }
            }
            return;
        }

        if (e.target.id === 'scenarioMaxPoints') {
            window.recalcMaxPoints('#variantsContainerCreate', 'scenarioMaxPoints', '.scenarioExactSolution-cb', '.scenarioSequential-cb');
            return;
        }

        if (e.target.id === 'edit_scenarioMaxPoints') {
            window.recalcMaxPoints('#variantsContainerEdit', 'edit_scenarioMaxPoints', '#edit_exactSolutionCb', '#edit_sequentialCb');
        }
    });

    document.addEventListener('change', function(e) {
        if (e.target.id === 'scenarioGradingStyle') {
            window.syncScenarioFormLocks(false);
            return;
        }

        if (e.target.id === 'edit_scenarioGradingStyle') {
            window.syncScenarioFormLocks(true);
        }
    });

    window.buildTaskTypeConfigMarkup = function(type) {
        if (type === 'flag') {
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Vyžadované řešení (Flag / IP / Přesný text):</label>
                    <div style="display:flex; gap:4px; margin-top:4px;">
                        <input type="text" class="task-solution flag-input" placeholder="Např. flag{splneno} nebo 192.168.1.5" style="flex:1; padding:6px; border-radius:4px; border:1px solid var(--border-color); box-sizing:border-box; background:var(--bg-panel); color:var(--text-primary);" />
                        <button type="button" onclick="window.addAlternativeSolution(this);" style="background:var(--primary); color:white; border:none; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px; white-space:nowrap;">+ další odpověď</button>
                    </div>
                    <div class="alt-solutions-container"></div>`;
        }

        if (type === 'tf') {
            const uid = Date.now() + Math.random().toString(36).slice(2, 7);
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Správná odpověď:</label>
                    <div style="display:flex; gap:16px; margin-top:6px; align-items:center; justify-content:flex-start; flex-wrap:wrap;">
                        <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; margin:0;">
                            <input type="radio" name="tf_${uid}" value="true" checked style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                            <span>Pravda</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; margin:0;">
                            <input type="radio" name="tf_${uid}" value="false" style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                            <span>Nepravda</span>
                        </label>
                    </div>`;
        }

        if (type === 'abcd') {
            const uid = Date.now() + Math.random().toString(36).slice(2, 7);
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Možnosti (označte správnou):</label>
                    <div class="abcd-options-container" data-radio-name="abcd_${uid}" style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">
                        ${['A','B','C','D'].map((letter, i) => `
                        <div class="abcd-option-row" style="display:flex; align-items:center; justify-content:flex-start; gap:10px; width:100%;">
                            <label style="display:flex; align-items:center; gap:6px; margin:0; min-width:48px; flex:0 0 48px; cursor:pointer;">
                                <input type="radio" name="abcd_${uid}" value="${i}" ${i === 0 ? 'checked' : ''} style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                                <span class="abcd-letter" style="font-size:13px; color:var(--text-primary); font-weight:bold;">${letter})</span>
                            </label>
                            <input type="text" class="abcd-input" placeholder="Text možnosti ${letter}" style="flex:1; min-width:0; width:auto; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                            <button type="button" class="abcd-remove-btn" onclick="window.removeAbcdOption(this)" style="visibility:hidden; color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0 4px;">×</button>
                        </div>`).join('')}
                    </div>
                    <button type="button" onclick="window.addAbcdOption(this)" style="margin-top:6px; background:var(--bg-status); border:1px solid var(--border-color); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; color:var(--text-primary);">+ přidat možnost</button>`;
        }

        if (type === 'multi') {
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Více možností (označte všechny správné):</label>
                    <div class="multi-options-container" style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">
                        ${[1,2].map((num) => `
                        <div class="multi-option-row" style="display:flex; align-items:center; justify-content:flex-start; gap:10px; width:100%;">
                            <input type="checkbox" class="multi-checkbox" style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                            <input type="text" class="multi-input" placeholder="Možnost ${num}" style="flex:1; min-width:0; width:auto; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                            <button type="button" class="multi-remove-btn" onclick="window.removeMultiOption(this)" style="visibility:hidden; color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0 4px;">×</button>
                        </div>`).join('')}
                    </div>
                    <button type="button" onclick="window.addMultiOption(this)" style="margin-top:6px; background:var(--bg-status); border:1px solid var(--border-color); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; color:var(--text-primary);">+ přidat možnost</button>`;
        }

        if (type === 'sort') {
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Kroky ve správném pořadí:</label>
                    <div class="sort-options-container" style="margin-top:4px; display:flex; flex-direction:column; gap:4px;">
                        ${[1,2,3].map((num) => `
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="sort-num" style="font-size:12px; color:var(--text-muted); font-weight:bold; width:15px;">${num}.</span>
                            <input type="text" class="sort-input" placeholder="Krok ${num}" style="flex:1; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                            <button type="button" onclick="this.parentElement.remove(); window.updateSortNumbers(this);" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold;">×</button>
                        </div>`).join('')}
                    </div>
                    <button type="button" onclick="window.addSortOption(this)" style="margin-top:4px; background:var(--bg-status); border:1px solid var(--border-color); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; color:var(--text-primary);">+ přidat krok</button>`;
        }

        if (type === 'code') {
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Zranitelný kód (výchozí stav pro studenta):</label>
                    <div class="code-mirror-host" style="margin-top:4px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden; font-size:13px;"></div>
                    <textarea class="code-input" style="display:none;"></textarea>`;
        }

        if (type === 'image') {
            return `<label style="font-size:11px; color:var(--text-muted); font-weight:bold;">Obrázek k úkolu:</label>
                    <div class="task-image-dropzone drop-zone" style="min-height:120px; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--bg-status);"
                         ondragover="event.preventDefault(); this.classList.add('drag-over');"
                         ondragleave="this.classList.remove('drag-over');"
                         ondrop="event.preventDefault(); this.classList.remove('drag-over'); const input = this.nextElementSibling; if(event.dataTransfer.files && event.dataTransfer.files.length > 0) { input.files = event.dataTransfer.files; window.handleTaskImageSelect(input); }"
                         onclick="this.nextElementSibling.click()">
                        <div class="dropzone-placeholder drop-zone-icon">
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--btn-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <div class="drop-zone-title">Přetáhněte obrázek sem nebo klikněte pro výběr</div>
                            <div class="drop-zone-hint">Podporované formáty: JPG, JPEG, PNG, GIF, WEBP, BMP</div>
                        </div>
                        <div class="task-image-preview" style="display:none; width:100%;"></div>
                    </div>
                    <input type="file" class="task-image-input" accept=".jpg,.jpeg,.png,.gif,.webp,.bmp" style="display:none;" onchange="window.handleTaskImageSelect(this)" />`;
        }

        return '';
    };

    window.handleImageAnswerTypeChange = function(selectEl) {
        const row = selectEl.closest('.task-row');
        if (!row) return;
        const isStrict = selectEl.value === 'strict';
        const solWrapper = row.querySelector('.task-solution-text-wrapper');
        const solLabel = row.querySelector('.task-sol-text-label');
        const solTextarea = row.querySelector('.task-solution-text');
        if (solWrapper) solWrapper.style.display = 'block';
        if (solLabel) solLabel.textContent = isStrict ? 'Správná odpověď (přesné řešení):' : 'Správné řešení (pro učitele / AI):';
        if (solTextarea) solTextarea.placeholder = isStrict
            ? 'Zde uveďte přesné řešení...'
            : 'Jak vypadá správné řešení tohoto úkolu...';
    };

    window.ensureImageAnswerTypeToggle = function(taskRow) {
        if (taskRow.querySelector('.image-answer-type-wrapper')) return;
        const solutionTextWrapper = taskRow.querySelector('.task-solution-text-wrapper');
        if (!solutionTextWrapper) return;

        const wrap = document.createElement('div');
        wrap.className = 'image-answer-type-wrapper';
        wrap.style.marginBottom = '4px';
        wrap.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center;">
                <label style="font-size:11px; color:var(--text-muted); font-weight:bold; white-space:nowrap;">Typ odpovědi:</label>
                <select class="image-answer-type" onchange="window.handleImageAnswerTypeChange(this)" style="font-size:12px; padding:3px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary); cursor:pointer;">
                    <option value="open">Otevřená</option>
                    <option value="strict">Striktní — přesná odpověď (text, číslo, příznak...)</option>
                </select>
            </div>`;
        solutionTextWrapper.parentNode.insertBefore(wrap, solutionTextWrapper);
    };

    window.handleTaskTypeChange = function(selectEl) {
        const type = selectEl.value;
        const taskRow = selectEl.closest('.task-row');
        if (!taskRow) return;

        const typeConfigContainer = taskRow.querySelector('.task-type-config-container');
        const rubricWrapper = taskRow.querySelector('.task-rubric-wrapper');
        const solutionTextWrapper = taskRow.querySelector('.task-solution-text-wrapper');

        if (typeConfigContainer) {
            // Guard: Přepíšeme HTML pouze pokud se typ skutečně změnil, abychom nesmazali uživatelský vstup
            if (typeConfigContainer.dataset.renderedType !== type) {
                const html = window.buildTaskTypeConfigMarkup(type);
                typeConfigContainer.innerHTML = html;
                typeConfigContainer.dataset.renderedType = type;
                // Po vložení HTML pro code typ inicializuj CodeMirror editory
                if (type === 'code') {
                    window.initCodeMirrorInRow?.(taskRow);
                    window.initSolTextMirrorInRow?.(taskRow);
                }
            }
            typeConfigContainer.style.display = type === 'open' ? 'none' : 'block';
        }

        const isEdit = !!taskRow.closest('#panel-scenario-edit');
        const exactMode = document.querySelector(isEdit ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb')?.checked;
        const aiMode = document.querySelector(isEdit ? '#edit_useAICb' : '#scenarioUseAI')?.checked;
        const isOpenType = ['open', 'code', 'image'].includes(type);

        if (type === 'image') window.ensureImageAnswerTypeToggle(taskRow);

        if (isOpenType && !exactMode) {
            if (rubricWrapper) rubricWrapper.style.display = aiMode ? 'block' : 'none';
            // Image — solutionTextWrapper zobraz vždy (otevřená i striktní ho může použít)
            if (solutionTextWrapper) solutionTextWrapper.style.display = 'block';
        } else {
            if (rubricWrapper) rubricWrapper.style.display = 'none';
            if (solutionTextWrapper) solutionTextWrapper.style.display = 'none';
        }
    };

    window.getAbcdLetter = function(index) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (index >= 0 && index < alphabet.length) return alphabet[index];
        return 'X' + (index - alphabet.length + 1);
    };

    window.updateAbcdOptionState = function(container) {
        Array.from(container.querySelectorAll('.abcd-option-row')).forEach((row, idx) => {
            const letter = window.getAbcdLetter(idx);
            const letterSpan = row.querySelector('.abcd-letter');
            const textInput = row.querySelector('.abcd-input');
            const radio = row.querySelector('input[type="radio"]');
            const removeBtn = row.querySelector('.abcd-remove-btn');

            if (letterSpan) letterSpan.textContent = `${letter})`;
            if (textInput) textInput.placeholder = `Text možnosti ${letter}`;
            if (radio) radio.value = idx;
            if (removeBtn) removeBtn.style.visibility = idx < 4 ? 'hidden' : 'visible';
        });
    };

    window.addAbcdOption = function(btn) {
        const container = btn.previousElementSibling;
        if (!container) return;

        const count = container.querySelectorAll('.abcd-option-row').length;
        const letter = window.getAbcdLetter(count);
        const radioName = container.dataset.radioName || ('abcd_' + Date.now());

        const div = document.createElement('div');
        div.className = 'abcd-option-row';
        div.style = "display:flex; align-items:center; justify-content:flex-start; gap:10px; width:100%;";
        div.innerHTML = `<label style="display:flex; align-items:center; gap:6px; margin:0; min-width:48px; flex:0 0 48px; cursor:pointer;">
                            <input type="radio" name="${radioName}" value="${count}" style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                            <span class="abcd-letter" style="font-size:13px; color:var(--text-primary); font-weight:bold;">${letter})</span>
                         </label>
                         <input type="text" class="abcd-input" placeholder="Text možnosti ${letter}" style="flex:1; min-width:0; width:auto; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                         <button type="button" class="abcd-remove-btn" onclick="window.removeAbcdOption(this)" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0 4px;">×</button>`;
        container.appendChild(div);
        window.updateAbcdOptionState(container);
    };

    window.removeAbcdOption = function(btn) {
        const row = btn.closest('.abcd-option-row');
        const container = row?.parentElement;
        if (!row || !container) return;

        row.remove();
        window.updateAbcdOptionState(container);
    };

    window.updateMultiOptionState = function(container) {
        Array.from(container.querySelectorAll('.multi-option-row')).forEach((row, idx) => {
            const input = row.querySelector('.multi-input');
            const removeBtn = row.querySelector('.multi-remove-btn');

            if (input) input.placeholder = `Možnost ${idx + 1}`;
            if (removeBtn) removeBtn.style.visibility = idx < 2 ? 'hidden' : 'visible';
        });
    };

    window.addMultiOption = function(btn) {
        const container = btn.previousElementSibling;
        if (!container) return;

        const count = container.querySelectorAll('.multi-option-row').length + 1;
        const div = document.createElement('div');
        div.className = 'multi-option-row';
        div.style = "display:flex; align-items:center; justify-content:flex-start; gap:10px; width:100%;";
        div.innerHTML = `<input type="checkbox" class="multi-checkbox" style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                         <input type="text" class="multi-input" placeholder="Možnost ${count}" style="flex:1; min-width:0; width:auto; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                         <button type="button" class="multi-remove-btn" onclick="window.removeMultiOption(this)" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0 4px;">×</button>`;
        container.appendChild(div);
        window.updateMultiOptionState(container);
    };

    window.removeMultiOption = function(btn) {
        const row = btn.closest('.multi-option-row');
        const container = row?.parentElement;
        if (!row || !container) return;

        row.remove();
        window.updateMultiOptionState(container);
    };

    window.addSortOption = function(btn) {
        const container = btn.previousElementSibling;
        const count = container.children.length + 1;
        const div = document.createElement('div');
        div.style = "display:flex; align-items:center; gap:8px;";
        div.innerHTML = `<span class="sort-num" style="font-size:12px; color:var(--text-muted); font-weight:bold; width:15px;">${count}.</span>
                         <input type="text" class="sort-input" placeholder="Krok ${count}" style="flex:1; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                         <button type="button" onclick="this.parentElement.remove(); window.updateSortNumbers(this);" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold;">×</button>`;
        container.appendChild(div);
    };

    window.updateSortNumbers = function() {
        setTimeout(() => {
            document.querySelectorAll('.sort-options-container').forEach(cont => {
                Array.from(cont.children).forEach((child, idx) => {
                    const span = child.querySelector('.sort-num');
                    if (span) span.textContent = (idx + 1) + ".";
                    const inp = child.querySelector('.sort-input');
                    if (inp) inp.placeholder = 'Krok ' + (idx + 1);
                });
            });
        }, 10);
    };

    window.handleTaskImageSelect = async function(input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];
        
        const courseSelect = document.getElementById("scenarioCourseSelect");
        const courseId = (courseSelect && courseSelect.value) ? courseSelect.value : window.activeDetailScenarioCourseId;
        
        if (!courseId) {
            showToast("Nejprve vyberte kurz, ke kterému zadání patří.", true);
            return;
        }

        const dropzone = input.previousElementSibling;
        const placeholder = dropzone ? dropzone.querySelector('.dropzone-placeholder') : null;
        const previewContainer = dropzone ? dropzone.querySelector('.task-image-preview') : null;
        const originalPlaceholderHtml = placeholder ? placeholder.innerHTML : '';

        // Vizuální indikace nahrávání pro uživatele
        if (placeholder) {
            placeholder.innerHTML = `<div style="color:var(--primary); font-weight:bold; margin-top:20px;">Nahrávám obrázek na server...</div>`;
        }

        // Připravíme soubor k odeslání (multipart/form-data)
        const formData = new FormData();
        formData.append("file", file);

        // Vytáhneme hlavičky, ale odstraníme Content-Type, protože u souborů si ho prohlížeč musí nastavit sám (boundary)
        const uploadHeaders = typeof getHeaders === 'function' ? getHeaders() : { "X-Mock-User": currentUserEmail };
        delete uploadHeaders["Content-Type"]; 

        try {
            const res = await fetch(`${API_BASE}/courses/${courseId}/scenarios/upload-image`, {
                method: "POST",
                headers: uploadHeaders,
                body: formData
            });

            if (!res.ok) throw new Error(await res.text());
            
            const data = await res.json();
            const fullImageUrl = `${API_BASE}${data.imageUrl}`;
            
            if (placeholder) placeholder.style.display = 'none';
            if (previewContainer) {
                previewContainer.style.display = 'block';
                previewContainer.innerHTML = `<img src="${fullImageUrl}" style="max-width:100%; max-height:200px; border-radius:6px; display:block; margin:0 auto; border: 1px solid var(--border-color);" />`;
                
                // Do datasetu uložíme kratičké URL (např. /api/courses/course1/scenarios/images/xyz.jpg), které se s přehledem vejde do 64 KB!
                previewContainer.dataset.savedImage = fullImageUrl;
            }
        } catch (err) {
            showToast("Chyba při nahrávání obrázku: " + err.message, true);
            if (placeholder) {
                placeholder.innerHTML = originalPlaceholderHtml; // Vrátíme původní vzhled při chybě
            }
        }
    };

    window.syncScenarioFormLocks = function(inEdit) {
        const exactCb = document.querySelector(inEdit ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb');
        const seqCb = document.querySelector(inEdit ? '#edit_sequentialCb' : '.scenarioSequential-cb');
        const aiCb = document.querySelector(inEdit ? '#edit_useAICb' : '#scenarioUseAI');
        const autoSubmitCb = document.getElementById(inEdit ? 'edit_scenarioAutoSubmit' : 'scenarioAutoSubmit');
        const autoSubmitWrapper = document.getElementById(inEdit ? 'edit_scenarioAutoSubmitWrapper' : 'scenarioAutoSubmitWrapper');
        const thresholdWrapper = document.getElementById(inEdit ? 'edit_scenarioPassThresholdWrapper' : 'scenarioPassThresholdWrapper');
        const taskTypeEl = document.getElementById(inEdit ? 'edit_scenarioTaskType' : 'scenarioTaskType');
        const styleSelect = document.getElementById(inEdit ? 'edit_scenarioGradingStyle' : 'scenarioGradingStyle');
        const maxPointsWrapper = document.getElementById(inEdit ? 'edit_scenarioMaxPointsWrapper' : 'scenarioMaxPointsWrapper');
        const container = document.querySelector(inEdit ? '#variantsContainerEdit' : '#variantsContainerCreate');

        const taskType = taskTypeEl?.value || 'practice';
        const isPractice = taskType === 'practice';
        
        // Zjištění stavů
        const isSeq = seqCb && seqCb.checked;
        if (isSeq && exactCb && !exactCb.checked) {
            exactCb.checked = true; // Seq requires Exact
        }
        const isExact = exactCb && exactCb.checked;
        
        // AutoSubmit visibility (viditelné pro Practice u všech typů úloh)
        if (autoSubmitWrapper) {
            autoSubmitWrapper.style.display = isPractice ? 'flex' : 'none';
        }
        if (!isPractice && autoSubmitCb) {
            autoSubmitCb.checked = false;
        }
        
        const isAutoSubmit = autoSubmitCb && autoSubmitCb.checked;

        // Pokud zapínáme autoSubmit, zkontroluj otevřené image úkoly
        if (isAutoSubmit && container) {
            const openImageRows = Array.from(container.querySelectorAll('.task-row')).filter(row => {
                if (window.getTaskTypeFromRow(row) !== 'image') return false;
                const sel = row.querySelector('.image-answer-type');
                return !sel || sel.value === 'open';
            });
            if (openImageRows.length > 0) {
                const labels = openImageRows.map((row, idx) => {
                    const num = row.querySelector('.task-number')?.textContent || `Úkol ${idx+1}`;
                    return num.replace(/:\s*$/, '').trim();
                });
                customConfirm(
                    'Zapnout automatické hodnocení?',
                    `Otevřené otázky s obrázkem nelze automaticky hodnotit bez učitele.\n\nChcete je přepnout na striktní, nebo smazat?\n\nDotčené úkoly:\n${labels.join('\n')}`,
                    'Smazat otevřené otázky s obrázkem?',
                    () => {
                        openImageRows.forEach(row => row.remove());
                        container.querySelectorAll('.variant-block').forEach(vb => window.renumberTasks(null, vb.querySelector('.tasks-container-dynamic')));
                        if (autoSubmitCb) autoSubmitCb.checked = true;
                        window.syncScenarioFormLocks(inEdit);
                    },
                    'Přepnout na striktní',
                    () => {
                        openImageRows.forEach(row => {
                            const sel = row.querySelector('.image-answer-type');
                            if (sel) { sel.value = 'strict'; window.handleImageAnswerTypeChange(sel); }
                        });
                        if (autoSubmitCb) autoSubmitCb.checked = true;
                        window.syncScenarioFormLocks(inEdit);
                    }
                );
                // Revert autosubmit dokud uživatel nepotvrdí
                if (autoSubmitCb) { autoSubmitCb.checked = false; return; }
            }
        }

        // AI Logic
        if (aiCb) {
            const aiLabel = aiCb.closest('label');
            const aiHintSpan = aiLabel?.querySelector('.options-hint-muted');
            
            if (isExact) {
                // Pokud je Exact/Seq, AI je zablokované a vypnuté
                aiCb.checked = false;
                aiCb.disabled = true;
                aiCb.style.opacity = '0.5';
                if (aiLabel) aiLabel.title = "AI není dostupné pro přesné/sekvenční úlohy.";
                if (aiHintSpan) aiHintSpan.textContent = "(AI hodnocení nelze použít u přesných textových výsledků)";
            } else {
                // Otevřená úloha
                if (isAutoSubmit) {
                    // Pokud je auto submit a není exact, AI MUSÍ být zapnuté
                    aiCb.checked = true;
                    aiCb.disabled = true;
                    aiCb.style.opacity = '0.6';
                    if (aiLabel) aiLabel.title = "AI hodnocení je povinné při cvičení bez hodnocení učitele u otevřených úloh.";
                    if (aiHintSpan) aiHintSpan.textContent = "(AI bude hodnotit každý krok studenta a napíše mu zpětnou vazbu)";
                } else {
                    // Volitelné AI
                    aiCb.disabled = false;
                    aiCb.style.opacity = '';
                    if (aiLabel) aiLabel.title = "";
                    if (aiHintSpan) aiHintSpan.textContent = "(Budete mít možnost nechat AI zkontrolovat výsledek a napsat vám odhadovanou známku)";
                }
            }
        }

        // Exact checkbox logic
        if (exactCb) {
            if (isSeq) {
                exactCb.disabled = true; // Seq locks Exact ON
            } else if (aiCb && aiCb.checked) {
                exactCb.disabled = true; // AI locks Exact OFF
                exactCb.checked = false;
            } else {
                exactCb.disabled = false;
            }
        }

        // Seq checkbox logic
        if (seqCb) {
            if (aiCb && aiCb.checked) {
                seqCb.disabled = true;
                seqCb.checked = false;
            } else {
                seqCb.disabled = false;
            }
        }

        // UI Updates pro bloky a dropdowny
        if (container) {
            container.querySelectorAll('.task-type-select').forEach(select => {
                const openGroup = Array.from(select.querySelectorAll('optgroup')).find(g => (g.label || '').includes('Otevřené'));

                if (isExact) {
                    if (openGroup) openGroup.disabled = true;
                    if (['open', 'code', 'image'].includes(select.value)) {
                        select.value = 'flag';
                    }
                } else {
                    if (openGroup) openGroup.disabled = false;
                }

                if (typeof window.handleTaskTypeChange === 'function') {
                    window.handleTaskTypeChange(select);
                }
            });

            container.querySelectorAll('.task-config-wrapper').forEach(el => {
                el.style.display = 'block';
            });

            container.querySelectorAll('.task-skippable').forEach(skipCb => {
                const label = skipCb.closest('label');
                if (label) label.style.display = isSeq ? 'flex' : 'none';
            });
        }
        
        const globalBox = document.getElementById(inEdit ? 'edit_globalExpectedOutputsWrapper' : 'globalExpectedOutputsWrapper');
        if (globalBox) globalBox.style.display = isExact ? 'none' : 'block';

        // Grading style logic
        const currentGradingMode = isExact ? 'points' : String(styleSelect?.value || '').trim().toLowerCase();

        if (isExact) {
            if (styleSelect) {
                styleSelect.value = 'points';
                styleSelect.disabled = true;
                styleSelect.style.opacity = '0.6';
            }
        } else if (styleSelect) {
            styleSelect.disabled = false;
            styleSelect.style.opacity = '';
        }

        if (maxPointsWrapper) {
            // Globální max points wrapper je skrytý — grading je per-varianta
            maxPointsWrapper.style.display = 'none';
            const inp = maxPointsWrapper.querySelector('input');
            const shouldShowMaxPoints = false;

            if (inp) {
                if (isExact || currentGradingMode === 'points') {
                    inp.readOnly = true;
                    inp.style.opacity = '0.6';
                    inp.style.cursor = 'not-allowed';
                    inp.title = 'Zablokováno: hodnota se počítá automaticky z bodů jednotlivých úkolů.';
                } else if (currentGradingMode === 'equal') {
                    inp.readOnly = false;
                    inp.style.opacity = '';
                    inp.style.cursor = '';
                    inp.title = 'Zadejte celkový počet bodů. Body se rozdělí rovnoměrně mezi úkoly.';
                } else {
                    inp.readOnly = false;
                    inp.style.opacity = '';
                    inp.style.cursor = '';
                    inp.title = '';
                }
            }
        }

        // Threshold wrapper
        if (thresholdWrapper) thresholdWrapper.style.display = 'flex';

        // Image úkoly — při autoSubmit skryj toggle a nastav striktní
        if (container) {
            container.querySelectorAll('.task-row').forEach(row => {
                if (window.getTaskTypeFromRow(row) !== 'image') return;
                const sel = row.querySelector('.image-answer-type');
                const typeWrap = row.querySelector('.image-answer-type-wrapper');
                if (isAutoSubmit) {
                    if (sel) { sel.value = 'strict'; window.handleImageAnswerTypeChange(sel); }
                    if (typeWrap) typeWrap.style.display = 'none';
                } else {
                    if (typeWrap) typeWrap.style.display = 'block';
                    if (sel) window.handleImageAnswerTypeChange(sel);
                }
            });
        }

        // Přepočet bodů
        window.recalcMaxPoints(inEdit ? '#variantsContainerEdit' : '#variantsContainerCreate', inEdit ? 'edit_scenarioMaxPoints' : 'scenarioMaxPoints', inEdit ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb', inEdit ? '#edit_sequentialCb' : '.scenarioSequential-cb');
        
        window.syncAiContextVisibility(inEdit ? 'edit' : 'create');
    };

    window.getTaskTypeFromRow = function(taskRow) {
        if (!taskRow) return 'flag';

        const fixedInput = taskRow.querySelector('.task-type-fixed-input');
        if (fixedInput && fixedInput.value) {
            return String(fixedInput.value).trim().toLowerCase();
        }

        const select = taskRow.querySelector('.task-type-select');
        if (select?.dataset?.lockedType) {
            return String(select.dataset.lockedType).trim().toLowerCase();
        }

        if (select?.value) {
            return String(select.value).trim().toLowerCase();
        }

        return 'flag';
    };

    window.isOpenTaskType = function(type) {
        return ['open', 'code', 'image'].includes(String(type || '').trim().toLowerCase());
    };

    window.getStrictModeOpenRows = function(inEdit) {
        const root = document.querySelector(inEdit ? '#variantsContainerEdit' : '#variantsContainerCreate');
        if (!root) return [];

        return Array.from(root.querySelectorAll('.task-row')).filter(row => {
            return window.isOpenTaskType(window.getTaskTypeFromRow(row));
        });
    };

    window.getStrictModeOpenRowLabels = function(rows) {
        return rows.map(row => {
            const rawNumber = (row.querySelector('.task-number')?.textContent || 'Úkol').replace(/\s+/g, ' ').trim();
            const safeNumber = rawNumber.endsWith(':') ? rawNumber.slice(0, -1) : rawNumber;
            const typeLabel = window.getTaskTypeLabel(window.getTaskTypeFromRow(row));
            return `${safeNumber} – ${typeLabel}`;
        });
    };

    window.removeStrictModeOpenRows = function(rows) {
        const touchedContainers = new Set();

        rows.forEach(row => {
            const container = row.closest('.tasks-container-dynamic');
            if (container) touchedContainers.add(container);
            row.remove();
        });

        touchedContainers.forEach(container => {
            window.renumberTasks(null, container);
        });
    };

    window.revertStrictModeCheckboxUi = function(cb, inEdit) {
        cb.checked = false;

        // Pokud revertujeme sekvenční, musíme vrátit i exact (byl automaticky zaškrtnut)
        const isSeqCb = cb.id === 'edit_sequentialCb' || cb.classList.contains('scenarioSequential-cb');
        if (isSeqCb) {
            const exactCb = inEdit
                ? document.getElementById('edit_exactSolutionCb')
                : document.querySelector('.scenarioExactSolution-cb');
            if (exactCb) {
                exactCb.checked = false;
                if (inEdit && typeof window.toggleEditTaskSolutions === 'function') {
                    window.toggleEditTaskSolutions(false);
                } else if (!inEdit && typeof window.toggleTaskSolutions === 'function') {
                    window.toggleTaskSolutions(false);
                }
            }
        } else {
            if (inEdit) {
                if (cb.id === 'edit_exactSolutionCb' && typeof window.toggleEditTaskSolutions === 'function') {
                    window.toggleEditTaskSolutions(false);
                }
            } else {
                if (cb.classList.contains('scenarioExactSolution-cb') && typeof window.toggleTaskSolutions === 'function') {
                    window.toggleTaskSolutions(false);
                }
            }
        }

        window.syncScenarioFormLocks(inEdit);
    };

    window.confirmStrictModeSwitch = function(cb) {
        const inEdit = !!cb.closest('#panel-scenario-edit');

        if (!cb.checked) {
            window.syncScenarioFormLocks(inEdit);
            return;
        }

        const openRows = window.getStrictModeOpenRows(inEdit);
        if (!openRows.length) {
            window.syncScenarioFormLocks(inEdit);
            return;
        }

        const isSequentialToggle = cb.id === 'edit_sequentialCb' || cb.classList.contains('scenarioSequential-cb');
        const modeLabel = isSequentialToggle
            ? 'sekvenční režim'
            : 'režim přesného textového výsledku';

        const openTaskLabels = window.getStrictModeOpenRowLabels(openRows);
        const confirmText =
            `Opravdu chcete zapnout ${modeLabel}?\n\n` +
            `Následující otevřené úkoly budou smazány:\n` +
            openTaskLabels.join('\n');

        customConfirm(
            'Přepnutí režimu smaže otevřené úkoly',
            confirmText,
            'Ano, smazat otevřené úkoly',
            () => {
                window.removeStrictModeOpenRows(openRows);

                if (inEdit) {
                    const exactCb = document.getElementById('edit_exactSolutionCb');
                    if (exactCb && typeof window.toggleEditTaskSolutions === 'function') {
                        window.toggleEditTaskSolutions(!!exactCb.checked);
                    }
                } else {
                    const exactCb = document.querySelector('.scenarioExactSolution-cb');
                    if (exactCb && typeof window.toggleTaskSolutions === 'function') {
                        window.toggleTaskSolutions(!!exactCb.checked);
                    }
                }

                window.syncScenarioFormLocks(inEdit);
            }
        );

        window.revertStrictModeCheckboxUi(cb, inEdit);
    };

    window.handleAIToggle = function(cb) {
        const inEdit = !!cb.closest('#panel-scenario-edit');
        window.syncScenarioFormLocks(inEdit);
    };

    window.onExactOrSeqToggle = function(cb) {
        window.confirmStrictModeSwitch(cb);
    };

    window.handleSequentialToggle = function(cb) {
        return;
    };
    window.closeAllEditPanels = function() {
        ['panel-scenario-edit', 'panel-ai-edit', 'standardScenarioFields'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    };

    window.fillEditFormFromData = function() {
        const d = window._editScenarioData;
        if (!d) return;
        window.fillEditForm(d.courseId, d.scenarioId, d.title, d.description, d.instructions, d.deadline, d.maxAttempts, d.hints, d.assignedToGroups, d.difficulty, d.gradingRubric, d.expectedOutputs);
    };

    window.fillEditFormFromCache = function(courseId, scenarioId) {
        const s = (window._scenarioCache || {})[scenarioId];
        if (!s) return;

        const isAdaptive = s.difficulty === "adaptive" || (s.hints || "").includes("[ADAPTIVE:true]");
        if (isAdaptive) {
            window.fillEditAiForm(
                courseId, s.scenarioTemplateId || scenarioId, s.title || '', s.description || '',
                s.instructions || '', s.hints || '', s.deadline || '',
                String(s.maxAttempts ?? 0), s.gradingRubric || '', s.requiredOs || 'kali'
            );
            return;
        }

        // Nastav OS select okamžitě (standardní volby existují hned)
        const _editOsVal = s.requiredOs || 'kali';
        const _editOsSel = document.getElementById('edit_scenarioRequiredOs');
        if (_editOsSel) _editOsSel.value = _editOsVal;

        window.fillEditForm(
            courseId, scenarioId, s.title || '', s.description || '',
            s.instructions || '', s.deadline || '', String(s.maxAttempts ?? 0),
            s.hints || '', s.assigned_to_groups || '', s.difficulty || '',
            s.gradingRubric || '', s.expectedOutputs || '', s.taskConfigJson || ''
        );

        // Pro custom images počkej na načtení options — standardní hodnoty nikdy nepřepisuj
        if (_editOsVal.startsWith('custom:') && typeof loadAiScenarioLabTemplates === 'function') {
            window._fillEditRegToken = (window._fillEditRegToken || 0) + 1;
            const _regToken = window._fillEditRegToken;
            loadAiScenarioLabTemplates().then(() => {
                if (window._fillEditRegToken !== _regToken) return;
                if (_editOsSel) _editOsSel.value = _editOsVal;
            });
        } else if (typeof loadAiScenarioLabTemplates === 'function') {
            loadAiScenarioLabTemplates(); // načti custom options na pozadí, ale hodnotu neměň
        }
    };

    window.fillEditForm = function(courseId, scenarioId, title, description, instructions, deadline, maxAttempts, hints, assignedToGroups, difficulty, gradingRubric, expectedOutputs, taskConfigJson) {
        activeDetailScenarioId = scenarioId;
        activeDetailScenarioCourseId = courseId;

        document.getElementById('edit_scenarioTitle').value = title || '';
        document.getElementById('edit_scenarioDescription').value = description || '';

        const editAiGlobalContextEl = document.getElementById('edit_aiGlobalContext');
        if (editAiGlobalContextEl) {
            editAiGlobalContextEl.value = window.extractAiGlobalContext(gradingRubric || '');
        }

        const editExpectedOutputsEl = document.getElementById('edit_scenarioExpectedOutputs');
        if (editExpectedOutputsEl) editExpectedOutputsEl.value = expectedOutputs || '';
        document.getElementById('edit_scenarioDeadline').value = formatScenarioDeadlineForInput(deadline);

        // Kurz select
        const courseSelect = document.getElementById('edit_scenarioCourseSelect');
        courseSelect.innerHTML = allLoadedCourses.map(c =>
            `<option value="${c.courseId}" ${c.courseId === courseId ? 'selected' : ''}>${escapeHtml(c.title)}</option>`
        ).join('');

        // Typ zadání
        const tType = (hints.match(/\[TYPE:([a-zA-Z]+)\]/) || [])[1] || difficulty || 'practice';
        document.getElementById('edit_scenarioTaskType').value = tType;

        // Hodnocení
        const gm = hints.match(/\[GRADING:([a-zA-Z]+):?(\d+)?\]/);
        const gStyle = gm ? gm[1] : 'points';
        const gMax = gm && gm[2] ? parseInt(gm[2]) : 10;
        document.getElementById('edit_scenarioGradingStyle').value = gStyle;
        document.getElementById('edit_scenarioMaxPoints').value = gMax;
        document.getElementById('edit_scenarioMaxPointsWrapper').style.display = ['points', 'equal'].includes(String(gStyle || '').toLowerCase()) ? 'block' : 'none';

        // Time limit
        const tlMatch = hints.match(/\[TIME_LIMIT:(\d+)\]/);
        document.getElementById('edit_scenarioTimeLimit').value = tlMatch ? parseInt(tlMatch[1]) : 60;

        // AUTO_SUBMIT — jen pro practice
        const _editAsEl = document.getElementById('edit_scenarioAutoSubmit');
        const _editAsWrapper = document.getElementById('edit_scenarioAutoSubmitWrapper');

        // Checkbox AI musíme nastavit DŘÍV než zavoláme syncEditAutoSubmitAiLock(),
        // jinak se správný lock přepíše starou hodnotou z gradingRubric.
        const aiCbEl = document.getElementById('edit_useAICb');
        if (aiCbEl) aiCbEl.checked = (gradingRubric || '') !== 'AI_DISABLED';

        if (_editAsEl) {
            _editAsEl.checked = (tType === 'practice') && hints.includes('[AUTO_SUBMIT:true]');
        }
        if (_editAsWrapper) {
            _editAsWrapper.style.display = (tType === 'practice') ? 'flex' : 'none';
        }

        // PASS_THRESHOLD
        const _editThEl = document.getElementById('edit_scenarioPassThreshold');
        const _editThWrapper = document.getElementById('edit_scenarioPassThresholdWrapper');
        const _editThMatch = hints.match(/\[PASS_THRESHOLD:(\d+)\]/);
        if (_editThEl) _editThEl.value = _editThMatch ? _editThMatch[1] : '70';
        const _editThCb = document.getElementById('edit_scenarioPassThresholdCb');
        if (_editThCb) _editThCb.checked = !!_editThMatch;
        const _editThInputDiv = document.getElementById('edit_scenarioPassThresholdInput');
        if (_editThInputDiv) _editThInputDiv.style.display = _editThMatch ? 'flex' : 'none';
        if (_editThWrapper) _editThWrapper.style.display = 'flex';

        // Tohle musí přijít až po nastavení AI + AUTO_SUBMIT.
        syncEditAutoSubmitAiLock();
        window.syncAiContextVisibility('edit');

        // Pokusy
        const parsedMax = parseInt(maxAttempts) || 0;
        if (parsedMax > 0) {
            document.getElementById('edit_scenarioAttempts').value = 'custom';
            document.getElementById('edit_scenarioCustomAttempts').style.display = 'block';
            document.getElementById('edit_scenarioCustomAttempts').value = parsedMax;
        } else {
            document.getElementById('edit_scenarioAttempts').value = '0';
            document.getElementById('edit_scenarioCustomAttempts').style.display = 'none';
        }

        // Skupiny — zobrazíme pouze skupiny z daného kurzu
        const blacklistArr = (assignedToGroups || '').split(',').map(x => x.trim()).filter(x => x);
        if (typeof window.refreshEditScenarioGroups === 'function') {
            const allCourseGroupIds = window.getGroupsForCourse(courseId).map(g => getGroupId(g));
            const isNobody = allCourseGroupIds.length > 0 && allCourseGroupIds.every(gid => blacklistArr.includes(gid));
            const checkedIds = isNobody ? [] : allCourseGroupIds.filter(gid => !blacklistArr.includes(gid));
            window.refreshEditScenarioGroups(courseId, checkedIds);
            // Pokud nobody, aktivujeme příznak po renderování
            if (isNobody) {
                setTimeout(() => {
                    const listEl = document.getElementById("edit_scenarioTargetGroupList");
                    const noBtnEl = document.getElementById("edit_scenarioTargetGroupList_noBtn");
                    const labelEl = document.getElementById("edit_scenarioTargetGroupLabel");
                    if (listEl) listEl.dataset.nobody = "true";
                    if (noBtnEl) { noBtnEl.innerText = "✓ Nikdo v kurzu"; noBtnEl.style.background = "#fee2e2"; noBtnEl.style.color = "#dc2626"; }
                    if (labelEl) labelEl.innerText = "Nikdo v kurzu";
                }, 0);
            }
        }

        // Úkoly a Varianty
        const exactCbEl = document.getElementById('edit_exactSolutionCb');
        const sequentialCbEl = document.getElementById('edit_sequentialCb');

        const isSequential = /\[SEQUENTIAL:true\]/.test(hints || '');
        const isExact = /\[EXACT:true\]/.test(hints || '') || /\[SOL\d+\]/.test(instructions || '');

        if (exactCbEl) exactCbEl.checked = isExact;
        if (sequentialCbEl) {
            sequentialCbEl.checked = isSequential;
            exactCbEl.disabled = isSequential;
        }

        const container = document.getElementById('variantsContainerEdit');
        if (container) {
            container.innerHTML = '';
            const sourceText = instructions || '';

            let variantsData = [];
            
            if (taskConfigJson) {
                try {
                    const parsedConfig = JSON.parse(taskConfigJson);
                    if (parsedConfig && parsedConfig.variants) {
                        variantsData = parsedConfig.variants.map(v => ({
                            variantNo: v.variantNo,
                            gradingStyle: v.gradingStyle || 'points',
                            maxPoints: v.maxPoints ?? 0,
                            tasks: v.tasks.map(t => ({
                                text: t.prompt || '',
                                sol: t.solution ? (t.solution + (t.alternatives && t.alternatives.length ? '||' + t.alternatives.join('||') : '')) : '',
                                solText: t.solutionText || '',
                                hints: t.hints || [],
                                pts: t.points || 0,
                                skip: t.skippable || false,
                                rubric: t.rubric || '',
                                type: t.type || 'flag',
                                options: t.options || [],
                                correctValue: t.correctValue || 'true',
                                codeSnippet: t.codeSnippet || '',
                                imageUrl: t.imageUrl || ''
                            })),
                            variantSolution: ''
                        }));
                    }
                } catch { }
            }

            if (variantsData.length === 0) {
                const variantMatches = [...sourceText.matchAll(/\[VARIANT(\d+)\]([\s\S]*?)\[\/VARIANT\1\]/g)];

                if (variantMatches.length > 0) {
                variantsData = variantMatches.map(match => {
                    const body = match[2] || '';
                    // Najdeme pouze základní bloky STEP pro zjištění počtu a textu úkolů
                    const stepMatches = [...body.matchAll(/\[STEP(\d+)\]([\s\S]*?)\[\/STEP\1\]/g)];
                    const variantSolutionMatch = body.match(/\[VARIANT_SOLUTION\]([\s\S]*?)\[\/VARIANT_SOLUTION\]/);

                    return {
                        variantNo: parseInt(match[1], 10),
                        tasks: stepMatches.length
                            ? stepMatches.map(sm => {
                                const stepNum = sm[1];
                                
                                // Hledáme ostatní tagy nezávisle na jejich pořadí v textu varianty
                                const solMatch = body.match(new RegExp(`\\[SOL${stepNum}\\]([\\s\\S]*?)\\[\\/SOL${stepNum}\\]`));
                                const sol = solMatch ? solMatch[1].trim() : '';

                                const solTextMatch = body.match(new RegExp(`\\[SOLUTION_TEXT${stepNum}\\]([\\s\\S]*?)\\[\\/SOLUTION_TEXT${stepNum}\\]`));
                                const solText = solTextMatch ? solTextMatch[1].trim() : '';

                                const rubricMatch = body.match(new RegExp(`\\[RUBRIC${stepNum}\\]([\\s\\S]*?)\\[\\/RUBRIC${stepNum}\\]`));
                                const rubric = rubricMatch ? rubricMatch[1].trim() : '';

                                const hintsMatch = body.match(new RegExp(`\\[HINTS${stepNum}\\]([\\s\\S]*?)\\[\\/HINTS${stepNum}\\]`));
                                const hintsRaw = hintsMatch ? hintsMatch[1] : '';
                                const hints = [];
                                const hintRx = /\[HINT:(.*?):(\d+)\]/g;
                                let hm;
                                while ((hm = hintRx.exec(hintsRaw)) !== null) hints.push({ text: hm[1], cost: parseInt(hm[2]) });
                                
                                const ptsMatch = body.match(new RegExp(`\\[PTS${stepNum}\\](\\d+)\\[\\/PTS${stepNum}\\]`));
                                const pts = ptsMatch ? parseInt(ptsMatch[1]) : 0;
                                
                                const skipMatch = body.match(new RegExp(`\\[SKIP${stepNum}\\](true|false)\\[\\/SKIP${stepNum}\\]`));
                                const skip = skipMatch ? skipMatch[1] === 'true' : false;

                                return { text: (sm[2] || '').trim(), sol: sol, solText: solText, hints, pts, skip, rubric };
                            })
                            : [{ text: body.trim(), sol: '', solText: '', hints: [], rubric: '' }],
                        variantSolution: variantSolutionMatch ? (variantSolutionMatch[1] || '').trim() : ''
                    };
                });
            } else {
                const fallbackTasks = sourceText.split('\n').map(t => t.trim()).filter(t => t);
                variantsData = [{
                    variantNo: 1,
                    tasks: fallbackTasks.length ? fallbackTasks.map(t => ({ text: t, sol: '' })) : [{ text: '', sol: '' }],
                    variantSolution: ''
                }];
                }
            }

            variantsData.forEach((variantData, variantIndex) => {
                const divVar = document.createElement('div');
                divVar.className = 'variant-block';
                divVar.setAttribute('data-variant', String(variantIndex + 1));

                divVar.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h4 class="variant-title" style="margin: 0; color: var(--text-primary);">Varianta ${variantIndex + 1}</h4>
                        <button type="button" class="delete-variant-btn" onclick="window.confirmDeleteVariant(this, 'variantsContainerEdit')"style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 13px; ${variantsData.length === 1 ? 'display:none;' : ''}">✖ Smazat variantu</button>
                    </div>
                    <div class="scenario-tasks-scroll">
                        <div class="tasks-container-dynamic"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                        <button type="button" class="btn-add-task" onclick="window.addEditTaskField(this)">Přidat další úkol</button>
                    </div>
                `;
                // Přidej per-variant grading UI s načtenými hodnotami
                divVar.innerHTML += window.buildVariantGradingHtml(variantData.gradingStyle || gStyle, variantData.maxPoints || gMax);

                container.appendChild(divVar);

                const tasksDyn = divVar.querySelector('.tasks-container-dynamic');
                variantData.tasks.forEach((taskObj, taskIndex) => {
                    const div = document.createElement('div');
                    div.className = 'task-row';
                                div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span class="task-number" style="font-weight:bold; color:var(--text-primary);"></span>
                                <select class="task-type-select" onchange="window.handleTaskTypeChange(this)" style="padding: 2px 6px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); cursor: pointer;">
                                    <optgroup label="Striktní (Sekvence / Automatické vyhodnocení)">
                                        <option value="flag" selected>Přesný text (Flag, IP, Příkaz...)</option>
                                        <option value="tf">Pravda / Nepravda</option>
                                        <option value="abcd">Výběr z možnosti (A/B/C/D)</option>
                                        <option value="multi">Vícenásobný výběr (Checkbox)</option>
                                        <option value="sort">Seřazení kroků (Drag & Drop)</option>
                                    </optgroup>
                                    <optgroup label="Otevřené (Vyžaduje Učitele / AI)">
                                        <option value="open">Otevřená odpověď (Report / Text)</option>
                                        <option value="code">Oprava kódu (Code Review)</option>
                                        <option value="image">Analýza obrázku / Záznamu</option>
                                    </optgroup>
                                </select>
                            </div>
                            <button type="button" class="delete-task-btn" onclick="var cEl = this.closest('.tasks-container-dynamic'); this.closest('.task-row').remove(); window.renumberTasks(null, cEl);" style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 18px; padding: 0; line-height: 1; display: ${taskIndex > 0 ? 'inline-block' : 'none'};" title="Smazat úkol">×</button>
                        </div>
                        <label style="font-size:11px; color:var(--text-muted); font-weight:bold; display:block; margin-bottom:4px;">Zadání úkolu:</label>
                        <textarea class="task-input" rows="2" style="width:100%; padding:8px; border:1px solid var(--border-color); border-radius:6px; box-sizing:border-box; background: var(--bg-panel); color: var(--text-primary);"></textarea>
                        
                        <div class="task-rubric-wrapper" style="display: ${aiCbEl && aiCbEl.checked ? 'block' : 'none'}; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                            <label class="rubric-label" style="font-size:11px; color:var(--text-primary); font-weight:bold;">Kritéria bodování pro AI:</label>
                            <textarea class="task-rubric" rows="2" style="width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-panel); color: var(--text-primary);" placeholder="Napište pravidla pro AI hodnocení tohoto úkolu..."></textarea>
                        </div>

                        <div class="task-solution-text-wrapper" style="display: ${isExact ? 'none' : 'block'}; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                            <label class="task-sol-text-label" style="font-size:11px; color:var(--text-primary); font-weight:bold;">Správné řešení (pro učitele / AI):</label>
                            <div class="sol-text-mirror-host" style="display:none; margin-top:4px; border:1px solid var(--border-color); border-radius:6px; overflow:hidden; font-size:13px;"></div>
                            <textarea class="task-solution-text" rows="2" style="width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-status); color: var(--text-primary);" placeholder="Jak vypadá správné řešení tohoto úkolu..."></textarea>
                        </div>

                        <div class="task-config-wrapper" style="display: block; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                            <div class="task-type-config-container"></div>
                            <div class="task-hints-container" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-color);">
                                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
                                    <label style="font-size:11px; color:var(--text-muted); font-weight:bold; white-space:nowrap;">Body za úkol:</label>
                                    <input type="number" class="task-points" min="0" max="100" value="0" style="width:48px; padding:4px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary); font-size:12px; text-align:center;" />
                                    <label style="display:none; align-items:center; gap:4px; cursor:pointer; font-size:11px; color:var(--text-muted); white-space:nowrap;">
                                        <input type="checkbox" class="task-skippable" style="width:13px; height:13px; margin:0; cursor:pointer;" />
                                        <span>Povolit přeskočení (student ztratí všechny body za úkol)</span>
                                    </label>
                                    <button type="button" onclick="window.addHintField(this);" style="background:var(--color-warning, #f59e0b); color:white; border:none; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:11px; white-space:nowrap; margin-left:auto;">+ nápověda</button>
                                </div>
                                <div class="hints-list"></div>
                            </div>
                        </div>`;
                    
                    tasksDyn.appendChild(div);

                    const selectEl = div.querySelector('.task-type-select');
                    if (selectEl) {
                        selectEl.value = taskObj.type || 'flag';
                        window.handleTaskTypeChange(selectEl);
                    }

                    // Obnova specifických dat podle typu úkolu
                    const currentType = taskObj.type || 'flag';
                    if (currentType === 'flag') {
                        const sols = (taskObj.sol || '').split('||').map(s => s.trim());
                        if (sols.length > 0 && sols[0] !== '') {
                            const solInput = div.querySelector('.task-solution');
                            if (solInput) solInput.value = sols[0];
                            const altContainer = div.querySelector('.alt-solutions-container');
                            if (altContainer) {
                                for (let i = 1; i < sols.length; i++) {
                                    if (!sols[i]) continue;
                                    const altDiv = document.createElement('div');
                                    altDiv.className = 'alt-row';
                                    altDiv.innerHTML = `
                                        <input type="text" class="task-solution-alt" value="${escapeHtml(sols[i])}" placeholder="Další možná odpověď..." style="flex:1; padding:6px; border-radius:4px; border:1px solid var(--border-color); box-sizing:border-box; background:var(--bg-panel); color:var(--text-primary);" />
                                        <button type="button" onclick="this.parentElement.remove();" style="background:#ef4444; color:white; border:none; border-radius:4px; padding:0 8px; cursor:pointer; font-size:16px; line-height:1;">×</button>`;
                                    altContainer.appendChild(altDiv);
                                }
                            }
                        }
                    } else if (currentType === 'tf') {
                        const radios = div.querySelectorAll('input[type="radio"]');
                        radios.forEach(r => {
                            if (r.value === String(taskObj.correctValue)) r.checked = true;
                        });
                    } else if (currentType === 'abcd') {
                        const container = div.querySelector('.abcd-options-container');
                        if (container && taskObj.options && taskObj.options.length) {
                            container.innerHTML = '';
                            taskObj.options.forEach((opt, idx) => {
                                const radioName = container.dataset.radioName || ('abcd_' + Date.now() + Math.random().toString(36).slice(2, 7));
                                container.dataset.radioName = radioName;
                                const divOpt = document.createElement('div');
                                divOpt.className = 'abcd-option-row';
                                divOpt.style = "display:flex; align-items:center; justify-content:flex-start; gap:10px; width:100%;";
                                divOpt.innerHTML = `<label style="display:flex; align-items:center; gap:6px; margin:0; min-width:48px; flex:0 0 48px; cursor:pointer;">
                                                    <input type="radio" name="${radioName}" value="${idx}" ${opt.correct ? 'checked' : ''} style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                                                    <span class="abcd-letter" style="font-size:13px; color:var(--text-primary); font-weight:bold;">${opt.id})</span>
                                                 </label>
                                                 <input type="text" class="abcd-input" placeholder="Text možnosti ${opt.id}" value="${escapeHtml(opt.text)}" style="flex:1; min-width:0; width:auto; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                                                 <button type="button" class="abcd-remove-btn" onclick="window.removeAbcdOption(this)" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0 4px; visibility:${idx < 4 ? 'hidden' : 'visible'};">×</button>`;
                                container.appendChild(divOpt);
                            });
                            if (typeof window.updateAbcdOptionState === 'function') window.updateAbcdOptionState(container);
                        }
                    } else if (currentType === 'multi') {
                        const container = div.querySelector('.multi-options-container');
                        if (container && taskObj.options && taskObj.options.length) {
                            container.innerHTML = '';
                            taskObj.options.forEach((opt, idx) => {
                                const divOpt = document.createElement('div');
                                divOpt.className = 'multi-option-row';
                                divOpt.style = "display:flex; align-items:center; justify-content:flex-start; gap:10px; width:100%;";
                                divOpt.innerHTML = `<input type="checkbox" class="multi-checkbox" ${opt.correct ? 'checked' : ''} style="width:16px; height:16px; margin:0; cursor:pointer; flex:0 0 16px;">
                                                 <input type="text" class="multi-input" placeholder="Možnost ${idx + 1}" value="${escapeHtml(opt.text)}" style="flex:1; min-width:0; width:auto; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                                                 <button type="button" class="multi-remove-btn" onclick="window.removeMultiOption(this)" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold; font-size:14px; padding:0 4px; visibility:${idx < 2 ? 'hidden' : 'visible'};">×</button>`;
                                container.appendChild(divOpt);
                            });
                            if (typeof window.updateMultiOptionState === 'function') window.updateMultiOptionState(container);
                        }
                    } else if (currentType === 'sort') {
                        const container = div.querySelector('.sort-options-container');
                        if (container && taskObj.options && taskObj.options.length) {
                            container.innerHTML = '';
                            taskObj.options.forEach((opt, idx) => {
                                const divOpt = document.createElement('div');
                                divOpt.style = "display:flex; align-items:center; gap:8px;";
                                divOpt.innerHTML = `<span class="sort-num" style="font-size:12px; color:var(--text-muted); font-weight:bold; width:15px;">${idx + 1}.</span>
                                                 <input type="text" class="sort-input" placeholder="Krok ${idx + 1}" value="${escapeHtml(opt.text)}" style="flex:1; padding:6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary);" />
                                                 <button type="button" onclick="this.parentElement.remove(); window.updateSortNumbers();" style="color:var(--text-muted); background:none; border:none; cursor:pointer; font-weight:bold;">×</button>`;
                                container.appendChild(divOpt);
                            });
                            if (typeof window.updateSortNumbers === 'function') window.updateSortNumbers();
                        }
                    } else if (currentType === 'code') {
                        const codeInput = div.querySelector('.code-input');
                        if (codeInput) codeInput.value = taskObj.codeSnippet || '';
                        const cmHost = div.querySelector('.code-mirror-host');
                        if (cmHost && window._cmInstances?.get(cmHost)) {
                            window._cmInstances.get(cmHost).setValue(taskObj.codeSnippet || '');
                        } else {
                            // CM ještě není inicializován — inicializuj s hodnotou
                            if (codeInput) codeInput.value = taskObj.codeSnippet || '';
                            window.ensureCodeMirrorLoaded?.(() => window.initCodeMirrorInRow?.(div));
                        }
                    } else if (currentType === 'image') {
                        // Restore image answer type toggle
                        const ansTypeSel = div.querySelector('.image-answer-type');
                        if (ansTypeSel && taskObj.imageAnswerType) {
                            ansTypeSel.value = taskObj.imageAnswerType;
                            window.handleImageAnswerTypeChange(ansTypeSel);
                        }
                        const previewDiv = div.querySelector('.task-image-preview');
                        const dropzone = div.querySelector('.task-image-dropzone');
                        const placeholder = dropzone ? dropzone.querySelector('.dropzone-placeholder') : null;
                        
                        if (previewDiv && taskObj.imageUrl) {
                            if (placeholder) placeholder.style.display = 'none';
                            previewDiv.style.display = 'block';
                            previewDiv.innerHTML = `<img src="${taskObj.imageUrl}" style="max-width:100%; max-height:200px; border-radius:6px; display:block; margin:0 auto;" />`;
                            previewDiv.dataset.savedImage = taskObj.imageUrl;
                        }
                    }

                    // Uzamknutí zobrazení na vizuální "badge" a skrytí selectu
                    if (typeof window.lockTaskTypeVisual === 'function') {
                        window.lockTaskTypeVisual(div, currentType);
                    }
                    if (currentType === 'code') {
                        setTimeout(() => {
                            window.initCodeMirrorInRow?.(div);
                            window.initSolTextMirrorInRow?.(div);
                            // Restore solutionText hodnoty do CM
                            const solHost = div.querySelector('.sol-text-mirror-host');
                            if (solHost) {
                                const solCm = window._cmInstances?.get(solHost);
                                if (solCm && taskObj.solutionText) solCm.setValue(taskObj.solutionText);
                            }
                        }, 0);
                    }

                    const ta = div.querySelector('.task-input');
                    if (ta) ta.value = taskObj.text || '';
                    
                    const rub = div.querySelector('.task-rubric');
                    if (rub) rub.value = taskObj.rubric || '';
                    
                    const textSol = div.querySelector('.task-solution-text');
                    if (textSol) textSol.value = taskObj.solText || '';
                    
                    // Obnova bodů a přeskočení
                    const ptsInput = div.querySelector('.task-points');
                    if (ptsInput) ptsInput.value = taskObj.pts || 0;
                    const skipInput = div.querySelector('.task-skippable');
                    let isSkipped = false;
                    if (skipInput) {
                        skipInput.checked = !!taskObj.skip;
                        if (taskObj.skip) {
                            isSkipped = true;
                            const hintBtn = div.querySelector('button[onclick*="addHintField"]');
                            if (hintBtn) {
                                hintBtn.disabled = true;
                                hintBtn.style.opacity = '0.5';
                                hintBtn.style.cursor = 'not-allowed';
                                hintBtn.title = "Nápovědy nelze kombinovat s přeskočením úkolu.";
                            }
                        }
                    }

                    // Obnova nápověd (pouze pokud úkol není přeskočitelný)
                    if (!isSkipped && taskObj.hints && taskObj.hints.length > 0) {
                        const addHintBtn = div.querySelector('button[onclick*="addHintField"]');
                        taskObj.hints.forEach(h => {
                            if (addHintBtn) window.addHintField(addHintBtn, h.text, h.cost);
                        });
                    }
                });

                window.renumberTasks(null, tasksDyn);
                window.prepareTaskAccordions(divVar);
            });

            window.renumberVariants('variantsContainerEdit');
            window.toggleEditTaskSolutions(isExact);
            
            // Finální synchronizace všech locků po kompletním načtení edit formuláře.
            // Tohle je důležité hlavně pro kombinace:
            // - otevřená úloha + AI + bez hodnocení učitele
            // - exact/sekvenční úloha + bez hodnocení učitele bez AI
            setTimeout(() => {
                if (typeof window.syncScenarioFormLocks === 'function') {
                    window.syncScenarioFormLocks(true);
                }
                document.querySelectorAll('#variantsContainerEdit .variant-block').forEach(vb => {
                    window.recalcVariantPoints(vb);
                });
            }, 50);
        }

        // AI zadání (cvičení i vzdělávání) má vlastní edit formulář
        const isAdaptiveType = tType === 'adaptive' || tType === 'ai_education';
        if (isAdaptiveType) {
            const _sForOs = (window._scenarioCache || {})[scenarioId];
            fillEditAiForm(courseId, scenarioId, title, description, instructions, hints, deadline, maxAttempts, gradingRubric, _sForOs?.requiredOs || 'kali');
            return;
        }

        // Prerekvizity
        const prereqsEditCont = document.getElementById('prereqsEditContainer');
        if (prereqsEditCont) { prereqsEditCont.dataset.courseId = courseId; prereqsEditCont.dataset.excludeId = scenarioId; }
        const prereqEditM = (hints || '').match(/\[PREREQS:([^\]]+)\]/);
        if (prereqEditM) window.fillPrereqContainer('prereqsEditContainer', courseId, prereqEditM[1], scenarioId);
        else if (prereqsEditCont) prereqsEditCont.innerHTML = '';

        window.closeAllEditPanels();
        const editPanel = document.getElementById('panel-scenario-edit');
        editPanel.style.display = 'block';
        setTimeout(() => editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    };
    window.fillEditAiForm = function(courseId, scenarioId, title, description, instructions, hints, deadline, maxAttempts, gradingRubric, requiredOs) {
        activeDetailScenarioId = scenarioId;
        activeDetailScenarioCourseId = courseId;

        const goalMatch = instructions.match(/CÍL MENTORA:\n([\s\S]*?)\n\nOSOBNOST MENTORA:/);
        const personaMatch = instructions.match(/OSOBNOST MENTORA:\n([\s\S]*)$/);

        document.getElementById('aiEdit_title').value = title || '';
        document.getElementById('aiEdit_description').value = description || '';
        document.getElementById('aiEdit_goal').value = goalMatch ? goalMatch[1].trim() : '';
        document.getElementById('aiEdit_persona').value = personaMatch ? personaMatch[1].trim() : '';
        document.getElementById('aiEdit_deadline').value = formatScenarioDeadlineForInput(deadline);
        document.getElementById('aiEdit_maxAttempts').value = parseInt(maxAttempts) || 0;
        document.getElementById('aiEdit_rubric').value = gradingRubric || '';

        const tlMatch = hints.match(/\[TIME_LIMIT:(\d+)\]/);
        if (tlMatch) document.getElementById('aiEdit_timeLimit').value = tlMatch[1];
        const subMatch = hints.match(/\[SUBTASKS:(\d+)\]/);
        if (subMatch) document.getElementById('aiEdit_subtasks').value = subMatch[1];
        const diffMatch = hints.match(/\[DIFFICULTY:(\w+)\]/);
        if (diffMatch) document.getElementById('aiEdit_difficulty').value = diffMatch[1];
        const adaptMatch = hints.match(/\[ADAPTIVE:(true|false)\]/);
        if (adaptMatch) document.getElementById('aiEdit_adaptive').value = adaptMatch[1];
        const tagsMatch = hints.match(/\[TAGS:([^\]]*)\]/);
        if (tagsMatch) document.getElementById('aiEdit_tags').value = tagsMatch[1];
        const toolsMatch = hints.match(/\[TOOLS:([^\]]*)\]/);
        if (toolsMatch) document.getElementById('aiEdit_tools').value = toolsMatch[1];
        const skipMatch = hints.match(/\[ALLOW_SKIP:(true|false)\]/);
        if (skipMatch) document.getElementById('aiEdit_allowSkip').value = skipMatch[1];
        const autoSubmitEl = document.getElementById('aiEdit_autoSubmit');
        if (autoSubmitEl) autoSubmitEl.checked = hints.includes('[AUTO_SUBMIT:true]');
        const gm = hints.match(/\[GRADING:([a-zA-Z]+):?(\d+)?\]/);
        if (gm) {
            document.getElementById('aiEdit_gradingStyle').value = gm[1];
            if (gm[2]) document.getElementById('aiEdit_maxPoints').value = gm[2];
            document.getElementById('aiEdit_maxPointsWrapper').style.display = gm[1] !== 'none' ? 'block' : 'none';
        }

        // Obnova QTYPES checkboxů a count inputů
        const qtypesMatch = hints.match(/\[QTYPES:([^\]]*)\]/);
        const qtypesRotateMatch = hints.match(/\[QTYPES_ROTATE:(true|false)\]/);
        const isRotate = qtypesRotateMatch ? qtypesRotateMatch[1] === 'true' : true;
        const rotateEl = document.getElementById('aiEdit_qtypesRotate');
        if (rotateEl) rotateEl.checked = isRotate;

        if (qtypesMatch) {
            const savedTypes = qtypesMatch[1].split(',').map(t => t.trim());
            document.querySelectorAll('.qtype-cb-edit').forEach(cb => {
                // Hodnota může být "otevřená odpověď(3)" — extrahuj název a count
                const entry = savedTypes.find(t => t.replace(/\(\d+\)$/, '').trim() === cb.value);
                cb.checked = !!entry;
                // Obnov count input
                const countInput = cb.closest('label')?.querySelector('.qtype-count-edit');
                if (countInput) {
                    const countMatch = entry?.match(/\((\d+)\)$/);
                    countInput.value = countMatch ? countMatch[1] : '1';
                    countInput.style.display = isRotate ? 'none' : (cb.checked ? 'block' : 'none');
                }
            });
        }
        // Aplikuj stav rotate na subtasks input
        if (typeof window.toggleQtypesRotate === 'function') window.toggleQtypesRotate('edit');

        window.closeAllEditPanels();
        const panel = document.getElementById('panel-ai-edit');
        panel.style.display = 'block';
        setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        document.getElementById('aiEdit_status').innerText = '';

        // Detect education type from hints and toggle sub-sections
        const isEduEdit = hints.includes('[TYPE:ai_education]');
        const editExIds = ['aiEditEx_row2', 'aiEditEx_qtypes', 'aiEditEx_rubric', 'aiEditEx_skipCell', 'aiEditEx_subtasksCell', 'aiEditEx_gradingStyleCell', 'aiEdit_maxPointsWrapper', 'aiEditEx_deadlineCell'];
        editExIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = isEduEdit ? 'none' : '';
        });
        const editDiffEl = document.getElementById('aiEdit_difficulty');
        const editAdaptEl = document.getElementById('aiEdit_adaptive');
        if (editDiffEl) editDiffEl.closest('.grow-1').style.display = isEduEdit ? 'none' : '';
        if (editAdaptEl) editAdaptEl.closest('.grow-1').style.display = isEduEdit ? 'none' : '';
        const editEduEl = document.getElementById('aiEditEdu_fields');
        if (editEduEl) editEduEl.style.display = isEduEdit ? 'block' : 'none';

        if (isEduEdit) {
            const topicsM = hints.match(/\[TOPICS:([^\]]*)\]/);
            if (topicsM) { const el = document.getElementById('aiEditEdu_topics'); if (el) el.value = topicsM[1]; }
            const presM = hints.match(/\[PRESENTATION:([^\]]*)\]/);
            if (presM) { const el = document.getElementById('aiEditEdu_presentation'); if (el) el.value = presM[1]; }
            const explainM = hints.match(/\[EXPLAIN_STYLE:([^\]]*)\]/);
            if (explainM) { const el = document.getElementById('aiEditEdu_explainStyle'); if (el) el.value = explainM[1]; }
            const verifyQM = hints.match(/\[VERIFY_Q:(\d+)\]/);
            if (verifyQM) { const el = document.getElementById('aiEditEdu_verifyQ'); if (el) el.value = verifyQM[1]; }
            const threshM = hints.match(/\[THRESHOLD:(\d+)\]/);
            if (threshM) { const el = document.getElementById('aiEditEdu_threshold'); if (el) el.value = threshM[1]; }
            const repeatsM = hints.match(/\[MAX_REPEATS:(\d+)\]/);
            if (repeatsM) { const el = document.getElementById('aiEditEdu_maxRepeats'); if (el) el.value = repeatsM[1]; }
            const vqtypesM = hints.match(/\[VERIFY_QTYPES:([^\]]*)\]/);
            if (vqtypesM) { const el = document.getElementById('aiEditEdu_verifyQtypes'); if (el) el.value = vqtypesM[1]; }
        }

        // Obnov OS z parametru
        const _osValue = requiredOs || 'kali';
        const _osSelect = document.getElementById('aiEdit_os');
        if (_osSelect) _osSelect.value = _osValue; // nastav hned (standardní volby existují okamžitě)

        // Načti materiály a šablony persony
        window._pendingAiEditMaterials = [];
        if (typeof renderPendingAiEditFiles === 'function') renderPendingAiEditFiles();
        if (typeof renderAiEditPersonaTemplateButtons === 'function') renderAiEditPersonaTemplateButtons();
        if (typeof loadAiScenarioMaterials === 'function') loadAiScenarioMaterials(scenarioId);
        // Pro custom images načti options a nastav až po načtení — standardní hodnoty nikdy nepřepisuj
        if (_osValue.startsWith('custom:') && typeof loadAiScenarioLabTemplates === 'function') {
            window._fillEditAiToken = (window._fillEditAiToken || 0) + 1;
            const _myToken = window._fillEditAiToken;
            loadAiScenarioLabTemplates().then(() => {
                if (window._fillEditAiToken !== _myToken) return;
                if (_osSelect) _osSelect.value = _osValue;
            });
        } else if (typeof loadAiScenarioLabTemplates === 'function') {
            loadAiScenarioLabTemplates(); // načti custom options na pozadí, ale hodnotu neměň
        }

        // Prerekvizity
        const prereqsAiCont = document.getElementById('prereqsAiEditContainer');
        if (prereqsAiCont) { prereqsAiCont.dataset.courseId = courseId; prereqsAiCont.dataset.excludeId = scenarioId; }
        const prereqAiM = (hints || '').match(/\[PREREQS:([^\]]+)\]/);
        if (prereqAiM) window.fillPrereqContainer('prereqsAiEditContainer', courseId, prereqAiM[1], scenarioId);
        else if (prereqsAiCont) prereqsAiCont.innerHTML = '';
    };

    // ── Prerekvizity — pomocné funkce ────────────────────────────────────────
    window._prereqOpts = function(courseId, excludeId) {
        const scenarios = (window._scenariosByCourse || {})[courseId] || Object.values(window._scenarioCache || {}).filter(s => s.courseId === courseId);
        return '<option value="">— Vyberte zadání —</option>' +
            scenarios
                .filter(s => !excludeId || s.scenarioId !== excludeId)
                .map(s => `<option value="${s.scenarioId}">${escapeHtml(s.title || s.scenarioId)}</option>`)
                .join('');
    }

    window.addPrereqRow = function(containerId, courseId, value, excludeId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'prereq-row';
        row.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px;';
        const sel = document.createElement('select');
        sel.className = 'prereq-select';
        sel.style.cssText = 'flex:1; margin-bottom:0; font-size:13px;';
        sel.innerHTML = window._prereqOpts(courseId, excludeId);
        if (value) {
            sel.value = value;
            if (sel.value !== value) {
                // Option not found — cache may be stale or scenario not loaded yet.
                // Add a temporary placeholder option so the value is preserved on save.
                const placeholder = document.createElement('option');
                placeholder.value = value;
                placeholder.textContent = value;
                sel.appendChild(placeholder);
                sel.value = value;
            }
        }
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'margin:0; padding:3px 10px; background:var(--bg-status); border:1px solid var(--border-color); border-radius:6px; color:var(--text-muted); cursor:pointer; font-size:13px; flex-shrink:0;';
        removeBtn.onclick = () => row.remove();
        row.appendChild(sel);
        row.appendChild(removeBtn);
        container.appendChild(row);
    };

    window.getPrereqIds = function(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return '';
        const ids = Array.from(container.querySelectorAll('.prereq-select'))
            .map(s => s.value.trim()).filter(Boolean);
        return ids.length ? ids.join(',') : '';
    };

    window.reloadPrereqSelects = function(containerId, courseId, excludeId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const opts = window._prereqOpts(courseId, excludeId);
        Array.from(container.querySelectorAll('.prereq-select')).forEach(sel => {
            const cur = sel.value;
            sel.innerHTML = opts;
            if (cur) sel.value = cur;
        });
    };

    window.fillPrereqContainer = function(containerId, courseId, idsStr, excludeId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        if (!idsStr) return;
        idsStr.split(',').map(s => s.trim()).filter(Boolean)
            .forEach(id => window.addPrereqRow(containerId, courseId, id, excludeId));
        // After a short delay, refresh dropdown options in case cache was still loading.
        setTimeout(() => window.reloadPrereqSelects(containerId, courseId, excludeId), 300);
    };

    window.renumberVariants = function(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const variants = container.querySelectorAll('.variant-block');
        const isEdit = containerId.includes('Edit');
        const exactCb = document.getElementById(isEdit ? 'edit_exactSolutionCb' : 'scenarioExactSolution-cb');
        const isExact = exactCb ? exactCb.checked : false;

        variants.forEach((v, i) => {
            v.querySelector('.variant-title').innerText = `Varianta ${i + 1}`;
            v.setAttribute('data-variant', i + 1);
            
            // Logika číslování správného řešení varianty
            const solLabel = v.querySelector('.variant-sol-label');
            if (solLabel) {
                solLabel.innerText = variants.length === 1 ? "Správné řešení:" : `Správné řešení pro variantu ${i + 1}:`;
            }

            const delBtn = v.querySelector('.delete-variant-btn');
            if (delBtn) delBtn.style.display = variants.length === 1 ? 'none' : 'block';
        });
    };

    window._taskTypePickerState = null;

    window.getAvailableTaskTypesForCurrentForm = function(isEdit = false) {
        const exactCb = document.querySelector(isEdit ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb');
        const seqCb = document.querySelector(isEdit ? '#edit_sequentialCb' : '.scenarioSequential-cb');
        const strictOnly = !!(exactCb?.checked || seqCb?.checked);

        const strictItems = [
            {
                value: 'flag',
                badge: 'Striktní',
                title: 'Přesný text',
                description: 'Flag, IP, MAC, port, hash, příkaz, číselná hodnota nebo jiný přesný výsledek.'
            },
            {
                value: 'tf',
                badge: 'Striktní',
                title: 'Pravda / Nepravda',
                description: 'Rychlé ověření pochopení teorie před dalším krokem.'
            },
            {
                value: 'abcd',
                badge: 'Striktní',
                title: 'Výběr z možnosti (A/B/C/D)',
                description: 'Jedna správná odpověď A/B/C/D pomocí radio buttonu.'
            },
            {
                value: 'multi',
                badge: 'Striktní',
                title: 'Vícenásobný výběr',
                description: 'Více správných možností pomocí checkboxů.'
            },
            {
                value: 'sort',
                badge: 'Striktní',
                title: 'Seřazení kroků',
                description: 'Seřazení fází postupu nebo útoku do správného pořadí.'
            }
        ];

        const openItems = [
            {
                value: 'open',
                badge: 'Otevřené',
                title: 'Otevřená odpověď',
                description: 'Report, popis postupu, vysvětlení nálezu nebo slovní odpověď.'
            },
            {
                value: 'code',
                badge: 'Otevřené',
                title: 'Oprava kódu',
                description: 'Učitel vloží zranitelný kód a student napíše opravenou verzi.'
            },
            {
                value: 'image',
                badge: 'Otevřené',
                title: 'Analýza obrázku / záznamu',
                description: 'Screenshot Wiresharku, topologie, logu nebo jiného vizuálního podkladu.'
            }
        ];

        return strictOnly ? strictItems : [...strictItems, ...openItems];
    };

    window.closeTaskTypePicker = function() {
        const modal = document.getElementById('taskTypePickerModal');
        if (modal) modal.style.display = 'none';
        window._taskTypePickerState = null;
    };

    window.openTaskTypePicker = function(btnElement, isEdit = false) {
        const modal = document.getElementById('taskTypePickerModal');
        const list = document.getElementById('taskTypePickerList');
        const title = document.getElementById('taskTypePickerTitle');
        const subtitle = document.getElementById('taskTypePickerSubtitle');

        if (!modal || !list) return;

        const items = window.getAvailableTaskTypesForCurrentForm(isEdit);
        const strictOnly = items.every(item => item.badge === 'Striktní');

        window._taskTypePickerState = { btnElement, isEdit };

        if (title) {
            title.textContent = isEdit ? 'Vyberte typ nového úkolu pro úpravu zadání' : 'Vyberte typ nového úkolu';
        }

        if (subtitle) {
            subtitle.textContent = strictOnly
                ? 'Aktuálně je aktivní přesné nebo sekvenční řešení, proto lze vložit jen striktní typy úkolů.'
                : 'Zobrazují se typy úkolů povolené pro aktuální stav formuláře.';
        }

        list.innerHTML = items.map(item => `
            <button
                type="button"
                onclick="window.confirmTaskTypePicker('${item.value}')"
                style="text-align:left; background:var(--bg-status); border:1px solid var(--border-color); border-radius:10px; padding:14px; cursor:pointer; color:var(--text-primary);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
                    <strong style="font-size:14px; color:var(--text-primary);">${item.title}</strong>
                    <span style="font-size:11px; color:var(--text-muted); background:var(--bg-panel); border:1px solid var(--border-color); border-radius:999px; padding:2px 8px;">${item.badge}</span>
                </div>
                <div style="font-size:12px; line-height:1.5; color:var(--text-muted);">${item.description}</div>
            </button>
        `).join('');

        modal.style.display = 'flex';
    };

    window.confirmTaskTypePicker = function(type) {
        const state = window._taskTypePickerState;
        if (!state) return;

        const { btnElement, isEdit } = state;
        window.closeTaskTypePicker();

        if (isEdit) {
            window.addEditTaskField(btnElement, type);
        } else {
            window.addTaskField(btnElement, type);
        }
    };

    window.bindTaskDeleteConfirm = function(scope) {
        const root = scope || document;
        root.querySelectorAll('.delete-task-btn').forEach(btn => {
            if (btn.dataset.confirmBound === 'true') return;
            btn.dataset.confirmBound = 'true';

            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();

                const row = this.closest('.task-row');
                const container = this.closest('.tasks-container-dynamic');
                if (!row || !container) return false;

                const numEl = row.querySelector('.task-number');
                const taskNum = numEl?.textContent?.replace(/:\s*$/, '').trim() || 'úkol';
                customConfirm(
                    `Smazat ${taskNum}?`,
                    'Pokud tento úkol smažete a potom uložíte změny, nepůjde to vrátit.',
                    'Ano, smazat',
                    () => {
                        row.remove();
                        window.renumberTasks(null, container);
                        const vBlock = container?.closest('.variant-block');
                        if (vBlock) window.recalcVariantPoints(vBlock);
                        showToast('Úkol byl odebrán z formuláře. Změna se projeví po uložení.');
                    }
                );

                return false;
            };
        });
    };

    window.buildVariantGradingHtml = function(gStyle, gMax) {
        const style = gStyle || 'points';
        const max = gMax ?? 0;
        const showMax = ['points','equal'].includes(style);
        return `
            <div class="variant-grading-row" style="display:flex; gap:10px; align-items:center; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color); flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <label style="font-size:11px; color:var(--text-muted); font-weight:bold; white-space:nowrap;">Styl hodnocení:</label>
                    <select class="variant-grading-style" onchange="window.onVariantGradingStyleChange(this)" style="font-size:12px; padding:3px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary); cursor:pointer;">
                        <option value="points" ${style==='points'?'selected':''}>Body zvlášť</option>
                        <option value="equal" ${style==='equal'?'selected':''}>Rovnoměrně</option>
                        <option value="percent" ${style==='percent'?'selected':''}>Procenta (%)</option>
                        <option value="none" ${style==='none'?'selected':''}>Bez bodů</option>
                    </select>
                </div>
                <div class="variant-max-points-wrapper" style="display:${showMax?'flex':'none'}; align-items:center; gap:6px;">
                    <label style="font-size:11px; color:var(--text-muted); font-weight:bold; white-space:nowrap;">Maximum bodů:</label>
                    <input type="number" class="variant-max-points-input" min="1" value="${max}" style="width:60px; padding:3px 6px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary); font-size:12px;"
                        oninput="window.recalcVariantPoints(this.closest('.variant-block'))">
                </div>
                <div class="variant-max-points-display" style="font-size:13px; font-weight:bold; color:var(--text-primary); background:var(--bg-panel); border:1px solid var(--border-color); padding:4px 10px; border-radius:6px; display:none;">Součet bodů: <span class="variant-sum">0</span></div>
            </div>`;
    };

    window.onVariantGradingStyleChange = function(selectEl) {
        const vBlock = selectEl.closest('.variant-block');
        if (!vBlock) return;
        const style = selectEl.value;
        const maxWrapper = vBlock.querySelector('.variant-max-points-wrapper');
        if (maxWrapper) maxWrapper.style.display = ['points','equal'].includes(style) ? 'flex' : 'none';
        window.recalcVariantPoints(vBlock);
        // Sync globální select pro zpětnou kompatibilitu při ukládání
        const isEdit = !!vBlock.closest('#variantsContainerEdit');
        const globalStyle = document.getElementById(isEdit ? 'edit_scenarioGradingStyle' : 'scenarioGradingStyle');
        if (globalStyle) globalStyle.value = style;
    };

    window.recalcVariantPoints = function(vBlock) {
        if (!vBlock) return;
        const styleSel = vBlock.querySelector('.variant-grading-style');
        const maxInp = vBlock.querySelector('.variant-max-points-input');
        const maxWrapper = vBlock.querySelector('.variant-max-points-wrapper');
        const display = vBlock.querySelector('.variant-max-points-display');
        const taskInputs = Array.from(vBlock.querySelectorAll('.task-points'));
        const style = styleSel ? styleSel.value : 'points';
        const _rawMax = parseInt(maxInp?.value, 10);
        const maxVal = maxInp ? (isNaN(_rawMax) ? 10 : _rawMax) : 10;
        const isEdit = !!vBlock.closest('#variantsContainerEdit');

        const showTaskPoints = (inp, show) => {
            inp.style.display = show ? '' : 'none';
            const pl = inp.previousElementSibling;
            if (pl?.tagName === 'LABEL') pl.style.display = show ? '' : 'none';
        };

        if (style === 'none') {
            taskInputs.forEach(inp => { inp.value = 0; showTaskPoints(inp, false); });
            window.setTaskPointInputsState(taskInputs, true, 'Úloha je bez bodů.');
            if (maxWrapper) maxWrapper.style.display = 'none';
            if (display) display.style.display = 'none';

        } else if (style === 'equal') {
            if (maxWrapper) maxWrapper.style.display = 'flex';
            if (maxInp) {
                maxInp.readOnly = false;
                maxInp.style.opacity = '';
                maxInp.style.cursor = '';
                maxInp.title = 'Zadejte celkový počet bodů. Body se rozdělí rovnoměrně mezi úkoly.';
            }
            const dist = window.distributePointsFromEnd(maxVal, taskInputs.length);
            taskInputs.forEach((inp, idx) => { inp.value = dist[idx] ?? 0; showTaskPoints(inp, true); });
            window.setTaskPointInputsState(taskInputs, true, 'Body jsou rozděleny automaticky.');
            if (display) display.style.display = 'none';

        } else if (style === 'points') {
            if (maxWrapper) maxWrapper.style.display = 'flex';
            taskInputs.forEach(inp => showTaskPoints(inp, true));
            window.setTaskPointInputsState(taskInputs, false, '');
            const total = taskInputs.reduce((s, inp) => s + (parseInt(inp.value) || 0), 0);
            if (maxInp) {
                maxInp.value = total;
                maxInp.readOnly = true;
                maxInp.style.opacity = '0.6';
                maxInp.style.cursor = 'not-allowed';
                maxInp.title = 'Zamčeno — počítá se automaticky jako součet bodů úkolů.';
            }
            if (display) display.style.display = 'none';
            const globalMax = document.getElementById(isEdit ? 'edit_scenarioMaxPoints' : 'scenarioMaxPoints');
            if (globalMax) globalMax.value = total;

        } else {
            // percent — stejné jako points, max zamčený součet
            if (maxWrapper) maxWrapper.style.display = 'flex';
            taskInputs.forEach(inp => showTaskPoints(inp, true));
            window.setTaskPointInputsState(taskInputs, false, '');
            const total = taskInputs.reduce((s, inp) => s + (parseInt(inp.value) || 0), 0);
            if (maxInp) {
                maxInp.value = total;
                maxInp.readOnly = true;
                maxInp.style.opacity = '0.6';
                maxInp.style.cursor = 'not-allowed';
                maxInp.title = 'Zamčeno — počítá se automaticky jako součet bodů úkolů.';
            }
            if (display) display.style.display = 'none';
        }
    };

    window.confirmDeleteTask = function(btn) {
        const row = btn.closest('.task-row');
        const container = btn.closest('.tasks-container-dynamic');
        const numEl = row?.querySelector('.task-number');
        const taskNum = numEl?.textContent?.replace(/:\s*$/, '').trim() || 'tento úkol';
        customConfirm(
            `Smazat ${taskNum}?`,
            'Tato akce je nevratitelná.',
            'Ano, smazat',
            () => {
                row.remove();
                window.renumberTasks(null, container);
                const vBlock = container?.closest('.variant-block');
                if (vBlock) window.recalcVariantPoints(vBlock);
            }
        );
    };

    window.validateTaskConfig = function(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return true;

        const isExact = document.querySelector(
            containerId.includes('Edit') ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb'
        )?.checked;

        let firstError = null;
        let errorCount = 0;

        container.querySelectorAll('.variant-block').forEach(vBlock => {
            vBlock.querySelectorAll('.task-row').forEach(row => {
                // Reset předchozích chyb
                row.style.outline = '';

                const type = window.getTaskTypeFromRow(row);
                const prompt = row.querySelector('.task-input')?.value?.trim() || '';
                let missing = false;

                if (!prompt) {
                    missing = true;
                } else if (isExact || ['flag'].includes(type)) {
                    const sol = row.querySelector('.task-solution')?.value?.trim() || '';
                    if (!sol) missing = true;
                } else if (type === 'tf') {
                    // tf má vždy výchozí hodnotu — nevyžaduje kontrolu
                } else if (type === 'abcd') {
                    const opts = Array.from(row.querySelectorAll('.abcd-input')).map(i => i.value.trim()).filter(Boolean);
                    if (opts.length < 2) missing = true;
                } else if (type === 'multi') {
                    const opts = Array.from(row.querySelectorAll('.multi-input')).map(i => i.value.trim()).filter(Boolean);
                    if (opts.length < 2) missing = true;
                } else if (type === 'sort') {
                    const opts = Array.from(row.querySelectorAll('.sort-input')).map(i => i.value.trim()).filter(Boolean);
                    if (opts.length < 2) missing = true;
                } else if (type === 'image') {
                    const ansType = row.querySelector('.image-answer-type')?.value || 'open';
                    if (ansType === 'strict') {
                        const sol = row.querySelector('.task-solution-text')?.value?.trim() || '';
                        if (!sol) missing = true;
                    }
                }

                if (missing) {
                    errorCount++;
                    row.style.outline = '2px solid #ef4444';
                    row.style.borderRadius = '6px';
                    if (!firstError) firstError = row;
                    setTimeout(() => { row.style.outline = ''; }, 4000);
                }
            });
        });

        if (errorCount > 0) {
            showToast(`⚠ ${errorCount} úkol${errorCount > 1 ? 'y nemají' : ' nemá'} vyplněné zadání nebo správnou odpověď.`, true);
            if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
        }
        return true;
    };

    window.confirmDeleteVariant = function(btn, containerId) {
        const vBlock = btn.closest('.variant-block');
        const variantNum = vBlock?.querySelector('.variant-title')?.textContent?.match(/\d+/)?.[0] || '';
        customConfirm(
            `Smazat variantu ${variantNum}?`,
            'Tato akce je nevratitelná. Všechny úkoly v této variantě budou smazány.',
            'Ano, smazat',
            () => { vBlock.remove(); window.renumberVariants(containerId); }
        );
    };

    window.addVariantField = function(containerId, type) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const newIndex = container.querySelectorAll('.variant-block').length + 1;
        const div = document.createElement('div');
        div.className = 'variant-block';
        div.setAttribute('data-variant', newIndex);
        div.style = 'background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;';
        
        const isEdit = type === 'edit';
        const btnFn = isEdit ? 'window.addEditTaskField(this)' : 'window.addTaskField(this)';
        
        const isExact = document.querySelector(isEdit ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb')?.checked;
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 class="variant-title" style="margin: 0; color: var(--text-primary);">Varianta ${newIndex}</h4>
                <button type="button" class="delete-variant-btn" onclick="window.confirmDeleteVariant(this, '${containerId}')" style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 13px;">✖ Smazat variantu</button>
            </div>
            <div class="scenario-tasks-scroll">
                <div class="tasks-container-dynamic"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                <button type="button" class="btn-add-task" onclick="${btnFn}">Přidat další úkol</button>
            </div>
            ${window.buildVariantGradingHtml('points', 0)}
        `;
        container.appendChild(div);
        
        const taskBtn = div.querySelector('button[onclick="' + btnFn + '"]');
        if (isEdit) {
            window.addEditTaskField(taskBtn);
        } else {
            window.addTaskField(taskBtn);
        }
        window.renumberVariants(containerId);
        // Inicializuj grading stav ihned po vytvoření
        setTimeout(() => window.recalcVariantPoints(div), 0);
    };

    window._baseAddEditTaskField = function(btnElement) {
        const container = btnElement ? btnElement.closest('.variant-block').querySelector('.tasks-container-dynamic') : document.querySelector('#variantsContainerEdit .tasks-container-dynamic');
        if (!container) return;

        const exactCb = document.getElementById('edit_exactSolutionCb');
        const isExact = exactCb ? exactCb.checked : false;

        const div = document.createElement('div');
        div.className = 'task-row';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="task-number" style="font-weight:bold; color:var(--text-primary);"></span>
                    <select class="task-type-select" onchange="window.handleTaskTypeChange(this)" style="padding: 2px 6px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); cursor: pointer;">
                        <optgroup label="Striktní (Sekvence / Automatické vyhodnocení)">
                            <option value="flag" selected>Přesný text (Flag, IP, Příkaz...)</option>
                            <option value="tf">Pravda / Nepravda</option>
                            <option value="abcd">Výběr z možnosti (A/B/C/D)</option>
                            <option value="multi">Vícenásobný výběr (Checkbox)</option>
                            <option value="sort">Seřazení kroků (Drag & Drop)</option>
                        </optgroup>
                        <optgroup label="Otevřené (Vyžaduje Učitele / AI)">
                            <option value="open">Otevřená odpověď (Report / Text)</option>
                            <option value="code">Oprava kódu (Code Review)</option>
                            <option value="image">Analýza obrázku / Záznamu</option>
                        </optgroup>
                    </select>
                </div>
                <button type="button" class="delete-task-btn" onclick="window.confirmDeleteTask(this)" style="color: #ef4444; border: none; background: none; cursor: pointer; font-size: 18px; padding: 0; line-height: 1;" title="Smazat úkol">×</button>
            </div>
            <label style="font-size:11px; color:var(--text-muted); font-weight:bold; display:block; margin-bottom:4px;">Zadání úkolu:</label>
            <textarea class="task-input" rows="2" style="width:100%; padding:8px; border:1px solid var(--border-color); border-radius:6px; box-sizing:border-box; background: var(--bg-panel); color: var(--text-primary);" placeholder="Popište, co má student udělat..."></textarea>
            
            <div class="task-rubric-wrapper" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <label class="rubric-label" style="font-size:11px; color:var(--text-primary); font-weight:bold;">Kritéria bodování pro AI:</label>
                <textarea class="task-rubric" rows="2" style="width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-panel); color: var(--text-primary);" placeholder="Napište pravidla pro AI hodnocení tohoto úkolu..."></textarea>
            </div>

            <div class="task-solution-text-wrapper" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <label class="task-sol-text-label" style="font-size:11px; color:var(--text-primary); font-weight:bold;">Správné řešení (pro učitele / AI):</label>
                <textarea class="task-solution-text" rows="2" style="width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-status); color: var(--text-primary);" placeholder="Jak vypadá správné řešení tohoto úkolu..."></textarea>
            </div>

            <div class="task-config-wrapper" style="display: block; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <div class="task-type-config-container"></div>

                <div class="task-hints-container" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-color);">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
                        <label style="font-size:11px; color:var(--text-muted); font-weight:bold; white-space:nowrap;">Body za úkol:</label>
                        <input type="number" class="task-points" min="0" max="100" value="0" style="width:48px; padding:4px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text-primary); font-size:12px; text-align:center;" />
                        <label style="display:none; align-items:center; gap:4px; cursor:pointer; font-size:11px; color:var(--text-muted); white-space:nowrap;">
                            <input type="checkbox" class="task-skippable" style="width:13px; height:13px; margin:0; cursor:pointer;" />
                            <span>Povolit přeskočení (student ztratí všechny body za úkol)</span>
                        </label>
                        <button type="button" onclick="window.addHintField(this);" style="background:var(--color-warning, #f59e0b); color:white; border:none; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:11px; white-space:nowrap; margin-left:auto;">+ nápověda</button>
                    </div>
                    <div class="hints-list"></div>
                </div>
            </div>`;
        container.appendChild(div);
        window.handleTaskTypeChange(div.querySelector('.task-type-select'));
        window.prepareTaskAccordion(div, true);
        window.renumberTasks(null, container);

        if (isExact) {
            const select = div.querySelector('.task-type-select');
            if (select) {
                const openGroup = Array.from(select.querySelectorAll('optgroup')).find(g => (g.label || '').includes('Otevřené'));
                if (openGroup) openGroup.disabled = true;
            }
        }
    };

    window.toggleEditTaskSolutions = function(isChecked) {
        // Zobrazí/skryje Vyžadované řešení u každého úkolu
        document.querySelectorAll('#variantsContainerEdit .task-solution-wrapper').forEach(el => {
            el.style.display = isChecked ? 'block' : 'none';
        });
        document.querySelectorAll('#variantsContainerEdit .task-solution-text-wrapper').forEach(el => {
            el.style.display = isChecked ? 'none' : 'block';
        });
        const globalBox = document.getElementById('edit_globalExpectedOutputsWrapper');
        if (globalBox) globalBox.style.display = isChecked ? 'none' : 'block';
    };

    window.handleEditSequentialToggle = function(cb) {
        window.syncScenarioFormLocks(true);
    };

    window.saveEditedScenario = async function() {
        const statusDiv = document.getElementById('edit_scenarioStatus');
        if (!activeDetailScenarioId || !activeDetailScenarioCourseId) {
            showToast('Chybí ID zadání.', true); return;
        }
        const title = document.getElementById('edit_scenarioTitle').value.trim();
        if (!title) { showToast('Název nesmí být prázdný.', true); return; }

        const description = document.getElementById('edit_scenarioDescription').value.trim();
        const isExact = document.getElementById('edit_exactSolutionCb').checked;
        const isSequential = document.getElementById('edit_sequentialCb').checked;
        const useAI = document.getElementById('edit_useAICb').checked;

        const variantBlocks = Array.from(document.querySelectorAll('#variantsContainerEdit .variant-block'));
        const instructions = variantBlocks.map((variantEl, variantIndex) => {
            const taskRows = Array.from(variantEl.querySelectorAll('.task-row'));

            const stepParts = taskRows.map((row, taskIndex) => {
                const taskText = (row.querySelector('.task-input')?.value || '').trim();
                
                const taskSolPrimary = (row.querySelector('.task-solution')?.value || '').trim();
                const altSols = Array.from(row.querySelectorAll('.task-solution-alt')).map(input => input.value.trim()).filter(val => val !== '');
                const combinedSols = [taskSolPrimary, ...altSols].filter(Boolean).join('||');

                // Načtení nápověd: [HINT:text:body]
                const hints = Array.from(row.querySelectorAll('.hints-list > div')).map(hDiv => {
                    const text = (hDiv.querySelector('.hint-text')?.value || '').trim();
                    const cost = parseInt(hDiv.querySelector('.hint-cost')?.value || '0');
                    return text ? `[HINT:${text}:${cost}]` : '';
                }).filter(Boolean).join('');
                
                const taskPts = parseInt(row.querySelector('.task-points')?.value || '0');
                const isSkip = row.querySelector('.task-skippable')?.checked ? 'true' : 'false';
                const taskRubric = (row.querySelector('.task-rubric')?.value || '').trim();

                const taskSolText = (row.querySelector('.task-solution-text')?.value || '').trim();

                if (!taskText) return '';

                let part = `[STEP${taskIndex + 1}]${taskText}[/STEP${taskIndex + 1}]`;
                if (combinedSols && isExact) {
                    part += `\n[SOL${taskIndex + 1}]${combinedSols}[/SOL${taskIndex + 1}]`;
                } else if (taskSolText && !isExact) {
                    part += `\n[SOLUTION_TEXT${taskIndex + 1}]\n${taskSolText}\n[/SOLUTION_TEXT${taskIndex + 1}]`;
                }
                if (taskRubric && document.getElementById('edit_useAICb').checked) {
                    part += `\n[RUBRIC${taskIndex + 1}]\n${taskRubric}\n[/RUBRIC${taskIndex + 1}]`;
                }
                if (hints) {
                    part += `\n[HINTS${taskIndex + 1}]${hints}[/HINTS${taskIndex + 1}]`;
                }
                part += `\n[PTS${taskIndex + 1}]${taskPts}[/PTS${taskIndex + 1}]\n[SKIP${taskIndex + 1}]${isSkip}[/SKIP${taskIndex + 1}]`;
                
                return part;
            }).filter(Boolean).join('\n');

            if (!stepParts) return '';

            return `[VARIANT${variantIndex + 1}]\n${stepParts}\n[/VARIANT${variantIndex + 1}]`;
        }).filter(Boolean).join('\n\n') || 'Žádné specifické zadání.';

        const editAiGlobalContext = document.getElementById('edit_aiGlobalContext')?.value.trim() || '';
        const gradingRubric = window.buildScenarioGradingRubric(useAI, editAiGlobalContext);
        const expectedOutputsEl = document.getElementById('edit_scenarioExpectedOutputs');
        const expectedOutputs = expectedOutputsEl ? expectedOutputsEl.value.trim() : '';
        const deadline = document.getElementById('edit_scenarioDeadline').value;
        const _editTaskConfig = window.buildTaskConfigFromForm('variantsContainerEdit');
        const _editFirstVariant = _editTaskConfig?.variants?.[0];
        const gStyle = _editFirstVariant?.gradingStyle || document.getElementById('edit_scenarioGradingStyle').value || 'points';
        const gMax = _editFirstVariant?.maxPoints || parseInt(document.getElementById('edit_scenarioMaxPoints').value) || 10;
        const gStyleNeedsMax = ['points', 'equal'].includes(String(gStyle || '').toLowerCase());
        const tLimit = parseInt(document.getElementById('edit_scenarioTimeLimit').value) || 60;
        const tType = document.getElementById('edit_scenarioTaskType').value;
        const attVal = document.getElementById('edit_scenarioAttempts').value;
        const maxAttempts = attVal === 'custom' ? parseInt(document.getElementById('edit_scenarioCustomAttempts').value) : 0;
        const autoSubmit = document.getElementById('aiEdit_autoSubmit')?.checked ? '[AUTO_SUBMIT:true]' : '';
        const editAutoSubmit = (tType === 'practice' && document.getElementById('edit_scenarioAutoSubmit')?.checked) ? '[AUTO_SUBMIT:true]' : '';
        const _editThCbSave = document.getElementById('edit_scenarioPassThresholdCb');
        const _editThValSave = document.getElementById('edit_scenarioPassThreshold')?.value;
        const editThreshold = (_editThCbSave?.checked && _editThValSave) ? `[PASS_THRESHOLD:${parseInt(_editThValSave)}]` : '';
        const hints = `[TIME_LIMIT:${tLimit}][GRADING:${gStyle}${gStyleNeedsMax ? ':' + gMax : ''}][TYPE:${tType}]${isSequential ? '[SEQUENTIAL:true]' : ''}${isExact ? '[EXACT:true]' : ''}${editAutoSubmit}${editThreshold}${(ids => ids ? `[PREREQS:${ids}]` : '')(window.getPrereqIds('prereqsEditContainer'))}`;
        const taskConfigJsonStr = JSON.stringify(_editTaskConfig);

        // Whitelist UI → blacklist DB (nobody = blacklist všech skupin kurzu)
        const editList = document.getElementById("edit_scenarioTargetGroupList");
        const allEditCourseGroups = window.getGroupsForCourse(activeDetailScenarioCourseId).map(g => getGroupId(g));
        let editTargetGroup;
        if (editList && editList.dataset.nobody === "true") {
            editTargetGroup = allEditCourseGroups.join(",");
        } else {
            const checkedEditGroups = Array.from(document.querySelectorAll("#edit_scenarioTargetGroupList input:checked")).map(cb => cb.value);
            editTargetGroup = allEditCourseGroups.filter(gid => !checkedEditGroups.includes(gid)).join(",");
        }

        showToast('Ukládám...');
        if (!window.validateTaskConfig('variantsContainerEdit')) return;

        const saveBtn = document.getElementById('btnSaveEditedScenario');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.style.background = "#9ca3af"; saveBtn.style.pointerEvents = "none"; saveBtn.textContent = "Ukládám..."; }
        try {
            const res = await fetch(`${API_BASE}/courses/${activeDetailScenarioCourseId}/scenarios/${activeDetailScenarioId}`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ title, description, instructions, gradingRubric, expectedOutputs, deadline: deadline || null, maxAttempts, hints, assigned_to_groups: editTargetGroup, taskConfigJson: taskConfigJsonStr, requiredOs: document.getElementById('edit_scenarioRequiredOs')?.value || 'kali' })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText);
            }
            // Immediately patch the local cache so reopening the edit form shows correct data
            // even if loadScenarios() refreshes a different course (listScenariosCourseSelect).
            if (window._scenarioCache && window._scenarioCache[activeDetailScenarioId]) {
                window._scenarioCache[activeDetailScenarioId].hints = hints;
                window._scenarioCache[activeDetailScenarioId].title = title;
                window._scenarioCache[activeDetailScenarioId].description = description;
            }
            await loadScenarios();
        } catch (err) {
            showToast(`Chyba: ${err.message}`, true);
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.style.background = "#f59e0b"; saveBtn.style.pointerEvents = ""; saveBtn.textContent = "Uložit změny"; }
            showToast('Zadání úspěšně uloženo!');
        }
    };




    window.addHintField = function(btn, hintText = '', hintCost = 1) {
        const container = btn.closest('.task-hints-container').querySelector('.hints-list');
        const div = document.createElement('div');
        div.className = 'alt-row';
        div.innerHTML = `
            <textarea class="hint-text" placeholder="Text nápovědy..." rows="1" style="flex:1; min-width:0; margin:0; padding:5px 6px; border-radius:4px; border:1px solid var(--border-color); box-sizing:border-box; background:var(--bg-panel); color:var(--text-primary); font-size:12px; resize:vertical; min-height:28px; line-height:1.4;">${escapeHtml(hintText)}</textarea>
            <span style="font-size:11px; color:var(--text-muted); white-space:nowrap; padding-top:6px; margin:0;">srážka bodů:</span>
            <input type="number" class="hint-cost" min="0" max="100" value="${hintCost}" title="Srážka bodů za použití nápovědy" style="width:48px; height:28px; margin:0; padding:0 4px; border-radius:4px; border:1px solid var(--border-color); box-sizing:border-box; background:var(--bg-panel); color:var(--text-primary); font-size:12px; text-align:center;" />
            <button type="button" onclick="this.parentElement.remove();" style="background:var(--color-danger, #ef4444); color:white; border:none; border-radius:4px; width:28px; height:28px; margin:0; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:18px; line-height:1; flex-shrink:0; padding:0;">×</button>
        `;
        container.appendChild(div);
    };
    window.addAlternativeSolution = function(btn) {
        const container = btn.closest('.task-row').querySelector('.alt-solutions-container');
        const div = document.createElement('div');
        div.className = 'alt-row';
        div.innerHTML = `
            <input type="text" class="task-solution-alt" placeholder="Další možná odpověď..." style="flex:1; height:28px; padding:0 6px; border-radius:4px; border:1px solid var(--border-color); box-sizing:border-box; background:var(--bg-panel); color:var(--text-primary);" />
            <button type="button" onclick="this.parentElement.remove();" style="background:var(--color-danger, #ef4444); color:white; border:none; border-radius:4px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:18px; line-height:1; flex-shrink:0; padding:0;">×</button>`;
        container.appendChild(div);
    };

    // Přečíslování úkolů — pokud je jen 1, zobrazí "Úkol:", jinak "1. úkol:", "2. úkol:"...
    window.renumberTasks = function(containerId, containerEl) {
        const container = containerEl || (containerId ? document.getElementById(containerId) : null) || document.querySelector('#standardScenarioFields .tasks-container-dynamic');
        if (!container) return;
        const rows = container.querySelectorAll('.task-row');
        rows.forEach((row, i) => {
            const label = row.querySelector('.task-number');
            const delBtn = row.querySelector('.delete-task-btn');
            const solLabel = row.querySelector('.task-solution-wrapper label');

            if (label) {
                label.innerText = rows.length === 1 ? 'Úkol:' : `${i + 1}. úkol:`;
            }
            if (delBtn) {
                delBtn.style.display = rows.length === 1 ? 'none' : 'inline-block';
            }
            if (solLabel) {
                solLabel.innerText = rows.length === 1
                    ? 'Vyžadované řešení (Flag / IP / Přesná odpověď):'
                    : `Vyžadované řešení ${i + 1}. úkolu (Flag / IP / Přesná odpověď):`;
            }
            
            const rubricLabel = row.querySelector('.rubric-label');
            if (rubricLabel) {
                rubricLabel.innerText = rows.length === 1
                    ? 'Kritéria bodování pro AI:'
                    : `Kritéria bodování pro AI pro ${i + 1}. úkol:`;
            }
            
            const textSolLabel = row.querySelector('.task-sol-text-label');
            if (textSolLabel) {
                textSolLabel.innerText = rows.length === 1
                    ? 'Správné řešení:'
                    : `Správné řešení pro ${i + 1}. úkol:`;
            }
        });
        
        // Aktualizace zobrazení a přepočet bodů při smazání/přidání úkolu
        const isEdit = !!container.closest('#variantsContainerEdit');
        const exactCb = document.querySelector(isEdit ? '#edit_exactSolutionCb' : '.scenarioExactSolution-cb');
        if (exactCb) {
            window.onExactOrSeqToggle(exactCb);
        }
    };

    // Funkce pro zobrazení/skrytí políček s řešením u standardních úkolů
    window.toggleTaskSolutions = function(isChecked) {
        // 1. Zobrazí/skryje malá políčka u jednotlivých úkolů
        document.querySelectorAll('.task-solution-wrapper').forEach(el => {
            el.style.display = isChecked ? 'block' : 'none';
        });

        // 2. Skryje/zobrazí řešení na úrovni variant
        document.querySelectorAll('.task-solution-text-wrapper').forEach(el => {
            el.style.display = isChecked ? 'none' : 'block';
        });
    };





