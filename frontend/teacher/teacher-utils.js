    // --- UI FUNKCE PRO VYSKAKOVACÍ BUBLINY V PRAVO NAHOŘE ---
    function showToast(message, isError = false) {
        const toast = document.getElementById('notificationToast');
        if (!toast) return;
        toast.innerText = message;
        toast.style.background = isError ? '#dc2626' : '#10b981';
        toast.style.top = '20px';
        setTimeout(() => { toast.style.top = '-100px'; }, 3000);
    }

    function customConfirm(title, text, confirmBtnText, onConfirm) {
        document.getElementById('ucmTitle').innerText = title;
        document.getElementById('ucmText').innerText = text;
        const btnYes = document.getElementById('ucmBtnYes');
        btnYes.innerText = confirmBtnText;
        btnYes.onclick = () => {
            document.getElementById('universalConfirmModal').style.display = 'none';
            onConfirm();
        };
        document.getElementById('universalConfirmModal').style.display = 'flex';
    }

    function getHeaders() {
      return {
        "Content-Type": "application/json",
        "X-Mock-User": currentUserEmail
      };
    }

    function getGroupId(group) {
      const id = group?.RowKey || group?.group_id || group?.groupId || "";
      return String(id).trim();
    }

    function getGroupTitle(group) {
      if (!group) return "Neznámá";
      // Prohledá úplně všechny klíče, které Azure běžně používá
      return group.title || group.groupName || group.name || group.RowKey || group.groupId || group.group_id || "Bezejmenná";
    }

    function showList(listId) {
        document.getElementById(listId).style.display = 'block';
    }

    function hideList(listId) {
        // Zpoždění 200ms je nutné, abychom stihli zaznamenat kliknutí na položku dřív, než seznam zmizí
        setTimeout(() => document.getElementById(listId).style.display = 'none', 200);
    }

    function toggleSelection(element, inputId, listId) {
        element.classList.toggle('selected');
        
        const selectedItems = Array.from(document.querySelectorAll(`#${listId} .custom-item.selected`));
        const input = document.getElementById(inputId);
        
        if (selectedItems.length > 0) {
            input.value = selectedItems.map(el => el.innerText).join(', ') + ', ';
        } else {
            input.value = '';
        }
        
        filterCustomList(listId, input.value, inputId);
        input.focus();
    }

    function filterCustomList(listId, searchText, inputId) {
        // 1. Zjistíme, co přesně je teď napsáno v textovém poli (odděleno čárkou)
        const typedNames = searchText.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
        
        // 2. Projdeme seznam a odebereme/přidáme modré označení čistě podle toho, jestli to je v textu
        const allItems = document.querySelectorAll(`#${listId} .custom-item`);
        allItems.forEach(item => {
            if (typedNames.includes(item.innerText.toLowerCase())) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });

        // 3. Zjistíme, co uživatel zrovna teď aktivně píše za poslední čárkou
        const parts = searchText.split(',');
        const currentSearch = parts[parts.length - 1].trim().toLowerCase();
        
        // 4. Vyfiltrujeme nabídku (hledáme jen v aktuálně psaném slově)
        allItems.forEach(item => {
            if (item.innerText.toLowerCase().includes(currentSearch)) {
                item.style.display = "block";
            } else {
                item.style.display = "none";
            }
        });
    }

    function getSelectedValues(listId) {
        return Array.from(document.querySelectorAll(`#${listId} .custom-item.selected`)).map(el => el.dataset.value);
    }

        function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
    function escapeJsString(value) {
      return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;")
        .replace(/\r?\n/g, " ");
    }

    function formatScenarioDeadlineForDisplay(value) {
      if (!value) return "Bez termínu";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString("cs-CZ", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function formatScenarioDeadlineForInput(value) {
      if (!value) return "";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    }

    // --- PŘEPÍNÁNÍ HLAVNÍCH ZÁLOŽEK V APLIKACI ---
    function switchMainAppTab(tabName, btnElement) {
        localStorage.setItem('teacherActiveTab', tabName);

        document.querySelectorAll('.main-nav-tab').forEach(btn => btn.classList.remove('active'));
        btnElement.classList.add('active');

        document.querySelectorAll('.main-panel').forEach(panel => {
            panel.style.display = 'none';
        });

        const artifactPanel = document.getElementById('artifactPanel');
        const evalPanel = document.getElementById('evaluationPanel');
        if(artifactPanel) artifactPanel.style.display = 'none';
        if(evalPanel) evalPanel.style.display = 'none';

        if (tabName === 'identity') {
            document.getElementById('panel-identity').style.display = 'block';
        } else if (tabName === 'courses') {
            document.getElementById('panel-courses').style.display = 'block';
        } else if (tabName === 'scenarios') {
            document.getElementById('panel-scenario-create').style.display = 'block';
            document.getElementById('panel-scenario-list').style.display = 'block';
            // panel-scenario-edit zůstane skrytý — zobrazí se až po kliknutí TEST: Upravit
        } else if (tabName === 'results') {
            document.getElementById('panel-results').style.display = 'block';
            setTimeout(() => { if (typeof restoreAttemptsFilters === 'function') restoreAttemptsFilters(); }, 100);
        } else if (tabName === 'analytics') {
            document.getElementById('panel-analytics').style.display = 'block';
            if (typeof teacherAnalytics !== 'undefined') teacherAnalytics.init();
        } else if (tabName === 'labtemplates') {
            document.getElementById('panel-labtemplates').style.display = 'block';
            if (typeof loadCustomLabTemplates === 'function') {
                const _waitAndLoad = () => {
                    if (typeof currentUserEmail !== 'undefined' && currentUserEmail) {
                        if (!_customLabTemplatesLoading && !_customLabTemplatesLoaded) loadCustomLabTemplates();
                    } else {
                        setTimeout(_waitAndLoad, 200);
                    }
                };
                setTimeout(_waitAndLoad, 100);
            }
        }
    }

    window.toggleMultiSelect = function(listId) {
        const list = document.getElementById(listId);
        if (list.style.display === "none") {
            document.querySelectorAll("div[id$='TargetGroupList']").forEach(el => el.style.display = "none");
            list.style.display = "block";
        } else {
            list.style.display = "none";
        }
    };

    document.addEventListener('click', function(event) {
        const isClickInside = event.target.closest("div[id$='TargetGroupList']") || event.target.closest("[onclick^='toggleMultiSelect']");
        if (!isClickInside) {
            document.querySelectorAll("div[id$='TargetGroupList']").forEach(el => el.style.display = "none");
        }
    });

    // --- OKAMŽITÉ OBNOVENÍ ZÁLOŽKY PŘI NAČTENÍ STRÁNKY (Bez čekání na API) ---
    document.addEventListener("DOMContentLoaded", () => {
        const savedTab = localStorage.getItem('teacherActiveTab') || 'identity';
        const tabBtn = document.querySelector(`.main-nav-tab[onclick*="'${savedTab}'"]`);
        if (tabBtn) {
            switchMainAppTab(savedTab, tabBtn);
        }
    });