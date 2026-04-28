    const API_BASE = "http://127.0.0.1:8000";
    let selectedAttemptId = null;
    let selectedSubmissionId = null;
    let loadedAttempts = [];
    let loadedSubmissions = [];
    let allLoadedUsers = []; 
    let allLoadedGroups = [];
    let allLoadedCourses = [];
    let activeDetailUserId = null;
    let activeDetailCourseId = null;
    let activeDetailScenarioId = null;
    let activeDetailScenarioCourseId = null;

    function performLogin() { sharedPerformLogin(["teacher", "admin"], initDashboard, "teacher"); }
    function changeMockPassword() { sharedChangeMockPassword(initDashboard, "teacher"); }
    function logout() { sharedLogout(() => {}, "teacher"); }

    async function initDashboard() {
      // 1. Nejdřív číselníky
      await Promise.all([
        loadGroups(),
        loadMyCourses(true),
        loadAiScenarioLabTemplates()
      ]);
      renderAiPersonaTemplateButtons();
      
      renderGroupCheckboxes();

      // 2. Pak uživatele
      await loadUsers();

      // 3. Bleskové překreslení kurzů (bez sítě), aby se doplnila jména správců
      await loadMyCourses(false);
      
      // 4. Obnovení poslední otevřené záložky po F5
      const savedTab = localStorage.getItem('teacherActiveTab');
      if (savedTab) {
          const tabBtn = document.querySelector(`.main-nav-tab[onclick*="'${savedTab}'"]`);
          if (tabBtn) {
              switchMainAppTab(savedTab, tabBtn);
          }
      }
    }

    sharedCheckAutoLogin(["teacher", "admin"], initDashboard, "teacher");

    window.getGroupsForCourse = function(courseId) {
        if (!courseId) return [];
        const courseGroupIds = new Set();
        allLoadedUsers.forEach(u => {
            if (u.global_role === 'student' && u.course_ids && u.course_ids.includes(courseId) && u.group_ids) {
                const gIds = Array.isArray(u.group_ids) ? u.group_ids : String(u.group_ids).split(',');
                gIds.forEach(gid => { const c = String(gid).trim(); if (c) courseGroupIds.add(c); });
            }
        });
        return Array.from(courseGroupIds)
            .map(gid => allLoadedGroups.find(gr => getGroupId(gr) === gid))
            .filter(Boolean);
    };

    window.renderGroupCheckboxesInto = function(boxId, groups, checkedIds = []) {
        const box = document.getElementById(boxId);
        if (!box) return;
        // Odvozené IDs pro label a nobody-btn z boxId
        const labelId = boxId.replace('List', 'Label');
        const noBtnId = boxId + '_noBtn';
        box.dataset.nobody = "false";
        if (groups.length === 0) {
            box.innerHTML = `<div style="padding:6px 8px; font-size:12px; color:var(--text-muted);">Kurz nemá přiřazené žádné skupiny.</div>`;
            return;
        }
        const nobodyBtn = `<button type="button" id="${noBtnId}" onclick="window.toggleAllNobodyInCourse('${boxId}','${labelId}','${noBtnId}')"
            style="display:block; width:calc(100% - 12px); margin:4px 6px; padding:4px 8px; font-size:12px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-status); color:var(--text-muted); cursor:pointer; text-align:left;">
            Nikdo v kurzu</button>`;
        const checkboxesHtml = groups.map(g => {
            const id = getGroupId(g);
            const name = getGroupTitle(g);
            const isChecked = checkedIds.includes(id) ? 'checked' : '';
            return `<label style="display:flex; align-items:center; width:100%; box-sizing:border-box; cursor:pointer; margin-bottom:0; font-weight:normal; color:var(--text-primary); padding:4px 6px; border-radius:4px;" onmouseover="this.style.background='var(--bg-status)'" onmouseout="this.style.background='transparent'">
                        <input type="checkbox" value="${id}" ${isChecked} style="width:16px; height:16px; margin:0 8px 0 0; padding:0; cursor:pointer; flex-shrink:0;" onchange="window.updateMultiSelectLabels(); document.getElementById('${noBtnId}') && (document.getElementById('${noBtnId}').innerText='Nikdo v kurzu', document.getElementById('${noBtnId}').style.background='var(--bg-status)', document.getElementById('${noBtnId}').style.color='var(--text-muted)', document.getElementById('${boxId}').dataset.nobody='false')"> ${escapeHtml(name)}
                    </label>`;
        }).join('');
        box.innerHTML = nobodyBtn + checkboxesHtml;
    };

    window.refreshCreateScenarioGroups = function() {
        const courseId = document.getElementById("scenarioCourseSelect")?.value || "";
        const groups = window.getGroupsForCourse(courseId);
        window.renderGroupCheckboxesInto("scenarioTargetGroupList", groups);
        document.querySelectorAll("#scenarioTargetGroupList input[type='checkbox']").forEach(cb => cb.checked = false);
        const label = document.getElementById("scenarioTargetGroupLabel");
        if (label) label.innerText = "Všichni v kurzu";
    };

    window.toggleAllNobodyInCourse = function(listId, labelId, noBtnId) {
        const list = document.getElementById(listId);
        if (!list) return;
        const checkboxes = list.querySelectorAll("input[type='checkbox']");
        const label = document.getElementById(labelId);
        const noBtn = document.getElementById(noBtnId);
        // Pokud jsou všechny odškrtnuté → "Nikdo" = zaškrtneme speciální příznak
        const isNobody = list.dataset.nobody === "true";
        if (isNobody) {
            // Zpět na "Všichni"
            list.dataset.nobody = "false";
            checkboxes.forEach(cb => cb.checked = false);
            if (noBtn) { noBtn.innerText = "Nikdo v kurzu"; noBtn.style.background = "var(--bg-status)"; noBtn.style.color = "var(--text-muted)"; }
            if (label) label.innerText = "Všichni v kurzu";
        } else {
            // Nikdo = odškrtneme všechny a nastavíme příznak
            list.dataset.nobody = "true";
            checkboxes.forEach(cb => cb.checked = false);
            if (noBtn) { noBtn.innerText = "✓ Nikdo v kurzu"; noBtn.style.background = "#fee2e2"; noBtn.style.color = "#dc2626"; }
            if (label) label.innerText = "Nikdo v kurzu";
        }
    };

    window.refreshEditScenarioGroups = function(courseId, checkedIds = []) {
        const groups = window.getGroupsForCourse(courseId);
        window.renderGroupCheckboxesInto("edit_scenarioTargetGroupList", groups, checkedIds);
        window.updateMultiSelectLabels();
    };

    // Zachována zpětná kompatibilita — plní pouze skrytý detailScenarioTargetGroupList (nepoužívá se pro UI checkboxy)
    window.renderGroupCheckboxes = function() {
        const detailBox = document.getElementById("detailScenarioTargetGroupList");
        if (!detailBox) return;
        detailBox.innerHTML = allLoadedGroups.map(g => {
            const id = getGroupId(g);
            const name = getGroupTitle(g);
            return `<label style="display:flex; align-items:center; width:100%; box-sizing:border-box; cursor:pointer; margin-bottom:0; font-weight:normal; color:var(--text-primary); padding:4px 6px; border-radius:4px;" onmouseover="this.style.background='var(--bg-status)'" onmouseout="this.style.background='transparent'">
                        <input type="checkbox" value="${id}" style="width:16px; height:16px; margin:0 8px 0 0; padding:0; cursor:pointer; flex-shrink:0;" onchange="updateMultiSelectLabels()"> ${escapeHtml(name)}
                    </label>`;
        }).join('');
    };

    window.updateMultiSelectLabels = function() {
        const createBox = document.getElementById("scenarioTargetGroupList");
        if (createBox) {
            const checked = createBox.querySelectorAll("input:checked");
            const label = document.getElementById("scenarioTargetGroupLabel");
            if (label) {
                if (checked.length === 0) {
                    label.innerText = "Všichni v kurzu";
                } else {
                    const names = Array.from(checked).map(cb => cb.parentElement.innerText.trim());
                    label.innerText = names.join(", ");
                }
            }
        }
        
        // Modální okno pro Správu zadání (zde label neexistuje, bráníme TypeErroru)
        const detailBox = document.getElementById("detailScenarioTargetGroupList");
        if (detailBox) {
            const checked = detailBox.querySelectorAll("input:checked");
            const label = document.getElementById("detailScenarioTargetGroupLabel");
            if (label) {
                if (checked.length === 0) {
                    label.innerText = "Všichni v kurzu";
                } else {
                    const names = Array.from(checked).map(cb => cb.parentElement.innerText.trim());
                    label.innerText = names.join(", ");
                }
            }
        }

        const editBox = document.getElementById("edit_scenarioTargetGroupList");
        if (editBox) {
            const checked = editBox.querySelectorAll("input:checked");
            const label = document.getElementById("edit_scenarioTargetGroupLabel");
            if (label) {
                if (checked.length === 0) {
                    label.innerText = "Všichni v kurzu";
                } else {
                    const names = Array.from(checked).map(cb => cb.parentElement.innerText.trim());
                    label.innerText = names.join(", ");
                }
            }
        }
    };