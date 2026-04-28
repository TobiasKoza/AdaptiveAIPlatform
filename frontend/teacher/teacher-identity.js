function deleteUser(userId) {
        const user = allLoadedUsers.find(u => u.user_id === userId);
        const userName = user ? (user.display_name || user.email) : userId;

        customConfirm("Smazat uživatele", `Opravdu chcete smazat uživatele a odstranit ho ze všech skupin a kurzů?`, "Ano, smazat vše", async () => {
            showToast(`Mažu uživatele "${userName}"...`);
            try {
                if (user) {
                    const emailForDelete = user.email || user.user_id;
                    
                    if (user.group_ids && user.group_ids.length > 0) {
                        await Promise.all(user.group_ids.map(async (gid) => {
                            try { await fetch(`${API_BASE}/groups/${gid}/members/${emailForDelete}`, { method: "DELETE", headers: getHeaders() }); } catch(e) {}
                        }));
                    }
                    
                    if (user.course_ids && user.course_ids.length > 0) {
                        await Promise.all(user.course_ids.map(async (cid) => {
                            try { await fetch(`${API_BASE}/courses/${cid}/members/${emailForDelete}`, { method: "DELETE", headers: getHeaders() }); } catch(e) {}
                        }));
                    }
                }

                const res = await fetch(`${API_BASE}/users/${userId}`, { method: "DELETE", headers: getHeaders() });
                if (!res.ok) throw new Error(await res.text());

                // Okamžitě odstraň řádek z tabulky a zobraz toast nastejno
                const row = document.querySelector(`tr[data-user-id="${userId}"]`);
                if (row) row.remove();
                showToast(`Uživatel "${userName}" byl úspěšně smazán.`);

                // Reload na pozadí
                await loadUsers();
                if (typeof loadMyCourses === 'function') await loadMyCourses();
                if (typeof loadGroups === 'function') await loadGroups();
            } catch (err) { showToast("Chyba při mazání: " + err.message, true); }
        });
    }

    function deleteGroup(groupId) {
        const group = allLoadedGroups.find(g => getGroupId(g) === groupId);
        const groupName = group ? getGroupTitle(group) : groupId;

        customConfirm("Smazat skupinu", `Opravdu chcete smazat skupinu "${groupName}"?`, "Ano, smazat", async () => {
            showToast(`Mažu skupinu "${groupName}"...`);
            try {
                const res = await fetch(`${API_BASE}/groups/${groupId}`, { method: "DELETE", headers: getHeaders() });
                if (!res.ok) throw new Error(await res.text());
                await loadGroups();
                showToast(`Skupina "${groupName}" byla úspěšně smazána.`);
            } catch (err) { showToast("Chyba při mazání: " + err.message, true); }
        });
    }
    async function createUser() {
      const emailInput = document.getElementById("newEmail").value.trim();
      const role = document.getElementById("newRole").value;
      const statusDiv = document.getElementById("userStatus");

      if (!emailInput) { statusDiv.style.color = "red"; statusDiv.innerText = "Vyplňte alespoň jeden email."; return; }

      // Rozsekáme text podle čárek, středníků, mezer nebo nových řádků a vyčistíme
      const rawEmails = emailInput.split(/[\n,; ]+/);
      const emails = rawEmails.map(e => e.trim()).filter(e => e.length > 0 && e.includes('@'));

      if (emails.length === 0) {
          statusDiv.style.color = "red"; statusDiv.innerText = "Nenašel jsem žádné platné emaily (musí obsahovat zavináč).";
          return;
      }

      const groupIds = getSelectedValues('groupList');
      const courseIds = getSelectedValues('courseList');
      
      const wordCount = (emails.length >= 1 && emails.length <= 4) ? "uživatele" : "uživatelů";
      showToast(`Vytvářím ${emails.length} ${wordCount}...`);
      statusDiv.innerText = "";
      
      let successHtml = "";
      let failCount = 0;

      // Projdeme všechny maily a vytvoříme je jeden po druhém
      for (const email of emails) {
          const name = email.split('@')[0];
          try {
            const res = await fetch(`${API_BASE}/users`, {
              method: "POST", 
              headers: getHeaders(), 
              body: JSON.stringify({ 
                  email: email, 
                  displayName: name, 
                  globalRole: role, 
                  groupIds: groupIds, 
                  courseIds: courseIds 
              })
            });
            
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();

            // OPRAVA: Pojistka - donutíme backend, ať uživateli v kurzech rovnou zapíše status "active"
            if (courseIds && courseIds.length > 0) {
                for (const cid of courseIds) {
                    try {
                        await fetch(`${API_BASE}/courses/${cid}/members`, {
                            method: "POST",
                            headers: getHeaders(),
                            body: JSON.stringify({ user_id: email, role_in_course: role, status: "active" })
                        });
                    } catch(e) {}
                }
            }
            
            // Uložíme si hesla do výpisu
            successHtml += `<div style="font-size: 13px; margin-bottom: 2px;"><b>${escapeHtml(email)}</b>: heslo <span style="background:#eee; padding:1px 4px; border: 1px solid #ccc; font-family: monospace;">${data.tempPassword}</span></div>`;
          } catch {
              failCount++;
          }
      }
      
      if (successHtml !== "") {
          const successCount = emails.length - failCount;
          const successWord = (successCount >= 1 && successCount <= 4) ? "uživatel vytvořen" : "uživatelů vytvořeno";
          showToast(`${successCount} ${successWord} úspěšně.`);

          if (failCount > 0) {
              const failWord = (failCount === 1) ? "uživatele" : "uživatelů";
              showToast(`U ${failCount} ${failWord} nastala chyba (zřejmě už existují).`, true);
          }

          // Hesla se zobrazí pod formulářem a po 10 sekundách zmizí
          statusDiv.style.color = "green";
          statusDiv.innerHTML = `<div style="max-height: 200px; overflow-y: auto; border: 1px solid #d1d5db; padding: 8px; border-radius: 6px; background: #fff; margin-top: 10px;">
                                   <div style="margin-bottom: 8px; font-weight: bold; color: #059669;">Zde jsou přihlašovací údaje nově vytvořených studentů:</div>
                                   ${successHtml}
                                 </div>`;
          setTimeout(() => { statusDiv.innerHTML = ""; }, 10000);
      } else {
          showToast("Nepodařilo se vytvořit žádného uživatele (pravděpodobně už všichni existují).", true);
          statusDiv.innerText = "";
      }
      
      // Nevymažeme status s hesly automaticky, učitel si je musí zkopírovat!
      // Jen vyčistíme formulář.
      document.getElementById("newEmail").value = "";
      document.getElementById("groupSearchInput").value = "";
      document.getElementById("courseSearchInput").value = "";
      document.querySelectorAll('.custom-item.selected').forEach(el => el.classList.remove('selected'));
      
      await loadUsers();
    }

    async function createGroup() {
          const title = document.getElementById("newGroupTitle").value.trim();
          const statusDiv = document.getElementById("groupStatus");
          const createBtn = document.querySelector("[onclick='createGroup()']");

          if (!title) {
              statusDiv.style.color = "red";
              statusDiv.innerText = "Zadejte název skupiny.";
              return;
          }

          // Zablokuj tlačítko po dobu vytváření
          if (createBtn) { createBtn.disabled = true; createBtn.style.opacity = "0.5"; }
          statusDiv.innerText = "";
          showToast(`Zakládám skupinu "${title}"...`);

          try {
            const res = await fetch(`${API_BASE}/groups`, {
              method: "POST", headers: getHeaders(),
              body: JSON.stringify({ title: title })
            });
            if (!res.ok) throw new Error(await res.text());

            // Úspěch — vymazat input, toast i obnovit tlačítko nastejno, reload až potom
            document.getElementById("newGroupTitle").value = "";
            showToast(`Skupina "${title}" byla úspěšně vytvořena.`);
            if (createBtn) { createBtn.disabled = false; createBtn.style.opacity = "1"; }
            await loadGroups();
          } catch (err) {
            statusDiv.style.color = "red";
            statusDiv.innerText = `Chyba: ${err.message}`;
            showToast(`Chyba při vytváření skupiny: ${err.message}`, true);
          } finally {
            // Odblokuj tlačítko při chybě (při úspěchu se odblokuje dříve)
            if (createBtn && createBtn.disabled) { createBtn.disabled = false; createBtn.style.opacity = "1"; }
          }
    }

    async function loadUsers() {
        const tbody = document.getElementById("usersTableBody");
        try {
            const res = await fetch(`${API_BASE}/users?t=${Date.now()}`, { headers: getHeaders() });
            if (!res.ok) throw new Error("Nelze načíst uživatele");
            const users = await res.json();
            
            // OPRAVA: Převedeme stringy na reálná pole hned při stažení, aby s nimi zbytek aplikace mohl spolehlivě pracovat
            users.forEach(u => {
                if (typeof u.group_ids === 'string') u.group_ids = u.group_ids.split(',').map(s => s.trim()).filter(s => s);
                if (!u.group_ids) u.group_ids = [];
                
                if (typeof u.course_ids === 'string') u.course_ids = u.course_ids.split(',').map(s => s.trim()).filter(s => s);
                if (!u.course_ids) u.course_ids = [];
            });
            allLoadedUsers = users;

            tbody.innerHTML = users.map(u => {
                const groupNames = u.group_ids.map(id => {
                    const searchId = String(id).trim();
                    // Musíme srovnat searchId s RowKey té skupiny
                    const found = allLoadedGroups.find(gr => String(gr.RowKey || "").trim() === searchId);
                    // Pokud ji najdeme, vezmeme .title, jinak necháme původní ID
                    return found ? (found.title || found.name || searchId) : searchId; 
                });

                const courseNames = u.course_ids.map(id => {
                    const searchId = String(id).trim();
                    const c = allLoadedCourses.find(cr => String(cr.courseId).trim() === searchId);
                    return c ? c.title : searchId;
                });

                const groups = groupNames.length ? groupNames.join(", ") : "-";
                const courses = courseNames.length ? courseNames.join(", ") : "-";
                
                const isPending = u.account_status === 'pending_activation';
                const statusLabel = isPending ? 'Čeká na přihlášení' : 'Aktivní';
                const statusClass = isPending ? 'status-queued' : 'status-succeeded';

                return `<tr data-user-id="${u.user_id}">
                    <td style="color: #1f2937;">${u.email}</td>
                    <td style="color: #1f2937;">${u.display_name}</td>
                    <td style="text-align: center; vertical-align: middle; padding: 0;">
                        <span onclick="renameUserPrompt('${u.user_id}', '${u.display_name}')" title="Přejmenovat" style="cursor: pointer; color: #9ca3af;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px; height:18px; vertical-align: middle;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                            </svg>
                        </span>
                    </td>
                    <td>${u.global_role}</td>
                    <td class="muted" style="font-size: 11px;">Groups: ${groups}<br>Courses: ${courses}</td>
                    <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                    <td style="white-space: nowrap;">
                        <button class="btn-small" style="background:#3b82f6; margin-right:5px;" onclick="openStudentDetail('${u.user_id}')">Detail</button>
                        <button class="btn-small" style="background:#dc2626;" onclick="deleteUser('${u.user_id}')">Smazat</button>
                    </td>
                </tr>`;
            }).join("");
        } catch(err) { tbody.innerHTML = `<tr><td colspan='7'>${err.message}</td></tr>`; }
    }

    async function loadGroups() {
        const tbody = document.getElementById("groupsTableBody");
        const groupList = document.getElementById("groupList");
        try {
            const res = await fetch(`${API_BASE}/groups`, { headers: getHeaders() });
            if (!res.ok) throw new Error("Nelze načíst skupiny");
            const groups = await res.json();
            allLoadedGroups = groups;

            tbody.innerHTML = groups.length ? groups.map(g => {
                const gid = getGroupId(g);
                const gtitle = getGroupTitle(g);

                return `<tr data-group-id="${gid}">
                    <td><span class="clickable-group" onclick="showStudentsInGroup('${gtitle}')" title="Filtrovat studenty">${gtitle}</span></td>
                    
                    <td style="text-align: center; vertical-align: middle; padding: 0;">
                        <span onclick="renameGroup('${gid}', '${gtitle}')" title="Přejmenovat skupinu" style="cursor: pointer; color: #9ca3af;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:18px; height:18px; vertical-align: middle;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                            </svg>
                        </span>
                    </td>

                    <td style="white-space: nowrap;">
                        <button class="btn-small" style="background:#3b82f6; margin-right:5px;" onclick="openGroupDetail('${gid}')">Detail</button>
                        <button class="btn-small" style="background:#dc2626;" onclick="deleteGroup('${gid}')">Smazat</button>
                    </td>
                </tr>`;
            }).join("") : "<tr><td colspan='3'>Zatím nemáte žádné skupiny.</td></tr>";

            if (groupList) {
                groupList.innerHTML = groups.length ? groups.map(g => {
                  const gid = getGroupId(g);
                  const gtitle = getGroupTitle(g);
                  return `<div class="custom-item" data-value="${gid}" onclick="toggleSelection(this, 'groupSearchInput', 'groupList')">${gtitle}</div>`;
                }).join("") : `<div class="muted" style="padding:6px;">Žádné existující skupiny.</div>`;
            }
            // Naplnění filtru skupin ve výsledcích a zadáních
            const attGroupFilter = document.getElementById("attemptsGroupFilter");
            if (attGroupFilter) {
                attGroupFilter.innerHTML = '<option value="">-- Všechny skupiny --</option>' + 
                    groups.map(g => `<option value="${getGroupId(g)}">${getGroupTitle(g)}</option>`).join("");
            }
            // Překreslíme nové scrollovací boxy s checkboxy
            if (typeof renderGroupCheckboxes === 'function') {
                renderGroupCheckboxes();
                updateMultiSelectLabels(); 
            }
        } catch(err) { tbody.innerHTML = `<tr><td colspan='3'>${err.message}</td></tr>`; }
    }

    function filterUsers() {
        const term = document.getElementById("userSearchInput").value.toLowerCase();
        const rows = document.querySelectorAll("#usersTableBody tr");
        rows.forEach(row => { row.style.display = row.innerText.toLowerCase().includes(term) ? "" : "none"; });
    }

    function showStudentsInGroup(groupName) {
        document.getElementById("userSearchInput").value = groupName;
        filterUsers();
    }

    async function renameGroup(groupId, oldTitle) {
        const newTitle = prompt("Zadejte nový název skupiny:", oldTitle);
        if (!newTitle || newTitle === oldTitle) return;
        try {
            const res = await fetch(`${API_BASE}/groups/${groupId}`, {
                method: "PUT", headers: getHeaders(), body: JSON.stringify({ title: newTitle })
            });
            if (!res.ok) throw new Error(await res.text());
            await loadGroups(); await loadUsers();
        } catch (err) { alert("Chyba: " + err.message); }
    }

    function openStudentDetail(userId) {
        const user = allLoadedUsers.find(u => u.user_id === userId);
        if (!user) return;
        activeDetailUserId = userId;
        document.getElementById("detailStudentName").innerText = user.display_name;
        document.getElementById("detailStudentEmail").innerText = user.email;
        document.getElementById("detailStudentRole").innerText = "Role: " + user.global_role;
        
        // 1. Vykreslení SKUPIN pomocí pravých ID
        const groupsUl = document.getElementById("detailStudentGroups");
        groupsUl.innerHTML = "";
        const processedGroups = new Set();
        (user.group_ids || []).forEach(groupId => {
            if (processedGroups.has(groupId)) return;
            processedGroups.add(groupId);
            const realG = allLoadedGroups.find(g => getGroupId(g) === groupId);
            const name = realG ? getGroupTitle(realG) : groupId;
            
            groupsUl.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span>• <strong>${name}</strong></span>
                <button class="btn-small" style="background: #dc2626; padding: 2px 8px; font-size: 11px;" 
                        onclick="removeStudentFromGroup('${groupId}', '${name}')">Odstranit</button>
                </div>`;
        });

        // 2. Vykreslení KURZŮ pomocí pravých ID
        const coursesUl = document.getElementById("detailStudentCourses");
        coursesUl.innerHTML = "";
        const processedCourses = new Set();
        (user.course_ids || []).forEach(courseId => {
            if (processedCourses.has(courseId)) return;
            processedCourses.add(courseId);
            const realC = allLoadedCourses.find(c => c.courseId === courseId);
            const name = realC ? realC.title : courseId;
            
            coursesUl.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                <span>• <strong>${name}</strong></span>
                <button class="btn-small" style="background: #dc2626; padding: 2px 8px; font-size: 11px;" 
                        onclick="removeStudentFromCourse('${courseId}', '${name}')">Odstranit</button>
                </div>`;
        });

        // 3. Naplnění dropdownů
        const gSelect = document.getElementById("detailGroupSelect");
        gSelect.innerHTML = '<option value="">-- Vybrat skupinu --</option>';
        allLoadedGroups.forEach(g => {
            const gid = getGroupId(g);
            const gtitle = getGroupTitle(g);

            if (!(user.group_ids || []).includes(gid)) {
                gSelect.innerHTML += `<option value="${gid}">${gtitle}</option>`;
            }
        });

        const cSelect = document.getElementById("detailCourseSelect");
        cSelect.innerHTML = '<option value="">-- Vybrat kurz --</option>';
        allLoadedCourses.forEach(c => { 
            if (!(user.course_ids || []).includes(c.courseId)) cSelect.innerHTML += `<option value="${c.courseId}">${c.title}</option>`; 
        });

        document.getElementById("studentDetailModal").style.display = "flex";
    }

    async function addStudentToGroup() {
        const groupId = document.getElementById("detailGroupSelect").value;
        if (!groupId || !activeDetailUserId) return;
        const group = allLoadedGroups.find(g => getGroupId(g) === groupId);
        const gName = group ? getGroupTitle(group) : groupId;
        const btn = document.querySelector("[onclick='addStudentToGroup()']");

        if (btn) { btn.disabled = true; btn.style.opacity = "0.5"; }
        showToast(`Přidávám do skupiny "${gName}"...`);
        try {
            const res = await fetch(`${API_BASE}/groups/${groupId}/members`, {
                method: "POST", headers: getHeaders(), body: JSON.stringify({ user_id: activeDetailUserId })
            });
            if (!res.ok) throw new Error(await res.text());
            await loadUsers();
            openStudentDetail(activeDetailUserId);
            showToast(`Student byl přidán do skupiny "${gName}".`);
        } catch (err) {
            showToast(err.message, true);
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
        }
    }

    function removeStudentFromGroup(groupId, groupName) {
        customConfirm("Odebrat ze skupiny", `Opravdu chcete studenta odebrat ze skupiny ${groupName}?`, "Ano, odebrat", async () => {
            showToast(`Odebírám ze skupiny "${groupName}"...`);
            try {
                const res = await fetch(`${API_BASE}/groups/${groupId}/members/${activeDetailUserId}`, {
                    method: "DELETE", headers: getHeaders()
                });
                if (!res.ok) throw new Error(await res.text());
                await loadGroups();
                await loadUsers();
                showToast(`Student byl odebrán ze skupiny "${groupName}".`);
            } catch (err) { showToast(err.message, true); }
        });
    }

    async function addStudentToCourse() {
        const courseId = document.getElementById("detailCourseSelect").value;
        if (!courseId || !activeDetailUserId) return;
        const user = allLoadedUsers.find(u => u.user_id === activeDetailUserId);
        const course = allLoadedCourses.find(c => c.courseId === courseId);
        const cName = course ? course.title : courseId;
        const btn = document.querySelector("[onclick='addStudentToCourse()']");

        if (btn) { btn.disabled = true; btn.style.opacity = "0.5"; }
        showToast(`Zapisuji do kurzu "${cName}"...`);
        try {
            const res = await fetch(`${API_BASE}/courses/${courseId}/members`, {
                method: "POST", headers: getHeaders(),
                body: JSON.stringify({ user_id: activeDetailUserId, role_in_course: user.global_role })
            });
            if (!res.ok) throw new Error(await res.text());
            await loadUsers();
            openStudentDetail(activeDetailUserId);
            showToast(`Student byl zapsán do kurzu "${cName}".`);
        } catch (err) {
            showToast(err.message, true);
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
        }
    }

    function removeStudentFromCourse(courseId, courseName) {
        customConfirm("Odebrat z kurzu", `Opravdu chcete uživatele odebrat z kurzu ${courseName}?`, "Ano, odebrat", async () => {
            showToast(`Odebírám z kurzu "${courseName}"...`);
            try {
                const res = await fetch(`${API_BASE}/courses/${courseId}/members/${activeDetailUserId}`, {
                    method: "DELETE", headers: getHeaders()
                });
                if (!res.ok) throw new Error(await res.text());
                await loadUsers();
                await loadMyCourses();
                openStudentDetail(activeDetailUserId);
                showToast(`Uživatel byl odebrán z kurzu "${courseName}".`);
            } catch (err) { showToast(err.message, true); }
        });
    }

  let activeDetailGroupId = null;

    async function openGroupDetail(groupId) {
        const group = allLoadedGroups.find(g => getGroupId(g) === groupId);
        if (!group) return;
        activeDetailGroupId = groupId;

        const gName = getGroupTitle(group);
        document.getElementById("detailGroupName").innerText = "Detail skupiny: " + gName;
        document.getElementById("bulkStatus").innerText = "";

        const listEl = document.getElementById("groupMembersList");
        listEl.innerHTML = "<div style='color:var(--text-muted); padding:6px;'>Načítám členy skupiny...</div>";

        // Naplnění dropdownu s kurzy
        const cSelect = document.getElementById("groupBulkCourseSelect");
        cSelect.innerHTML = '<option value="">-- Vybrat kurz pro skupinu --</option>';
        allLoadedCourses.forEach(c => {
            cSelect.innerHTML += `<option value="${c.courseId}">${c.title}</option>`;
        });

        document.getElementById("groupDetailModal").style.display = "flex";

        // Načteme členy živě z API
        try {
            await loadUsers();
            const members = allLoadedUsers.filter(u => u.group_ids && u.group_ids.includes(groupId));

            if (members.length === 0) {
                listEl.innerHTML = "<div class='muted'>Tato skupina nemá žádné členy.</div>";
            } else {
                listEl.innerHTML = members.map(m => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
                        <span>• <strong>${m.display_name}</strong> (${m.email})</span>
                        <button class="btn-small" style="background: #dc2626; padding: 2px 8px; font-size: 11px;"
                                onclick="removeMemberFromGroupContext('${groupId}', '${escapeJsString(gName)}', '${m.user_id}')">
                            Odebrat
                        </button>
                    </div>
                `).join("");
            }
        } catch (e) {
            listEl.innerHTML = "<div style='color:red;'>Chyba při načítání členů.</div>";
        }
    }

    async function assignCourseToGroup() {
        const courseId = document.getElementById("groupBulkCourseSelect").value;
        const group = allLoadedGroups.find(g => getGroupId(g) === activeDetailGroupId);
        const statusDiv = document.getElementById("bulkStatus");

        if (!courseId || !group) return;

        // Najdeme členy pomocí pravého ID skupiny
        const members = allLoadedUsers.filter(u => u.group_ids && u.group_ids.includes(getGroupId(group)));
        if (members.length === 0) {
            statusDiv.style.color = "red";
            statusDiv.innerText = "Skupina nemá členy, není koho zapisovat.";
            return;
        }

        const course = allLoadedCourses.find(c => c.courseId === courseId);
        const cName = course ? course.title : courseId;
        const gName = getGroupTitle(group);

        showToast(`Zapisuji ${members.length} studentů ze skupiny "${gName}" do kurzu "${cName}"...`);
        statusDiv.innerText = '';

        let successCount = 0;
        let alreadyCount = 0;
        let failCount = 0;

        for (const user of members) {
            try {
                const alreadyInCourse = user.course_ids && user.course_ids.includes(courseId);
                if (alreadyInCourse) { alreadyCount++; continue; }
                const res = await fetch(`${API_BASE}/courses/${courseId}/members`, {
                    method: "POST", headers: getHeaders(),
                    body: JSON.stringify({ user_id: user.user_id, role_in_course: user.global_role })
                });
                if (res.ok) successCount++; else failCount++;
            } catch (e) { failCount++; }
        }

        await loadUsers();

        const pluralStudents = (n) => n === 1 ? 'student' : (n >= 2 && n <= 4) ? 'studenti' : 'studentů';
        let msg = `Zapsáno ${successCount} ${pluralStudents(successCount)} do kurzu "${cName}".`;
        if (alreadyCount > 0) msg += ` ${alreadyCount} ${alreadyCount === 1 ? 'student již byl zapsán' : (alreadyCount >= 2 && alreadyCount <= 4) ? 'studenti již byli zapsáni' : 'studentů již bylo zapsáno'}.`;
        if (failCount > 0) msg += ` Chyba u ${failCount} ${pluralStudents(failCount)}.`;
        showToast(msg, failCount > 0);
    }

    async function renameUserPrompt(userId, oldName) {
        const newName = prompt("Zadejte nové zobrazované jméno uživatele:", oldName);
        if (!newName || newName === oldName) return;

        try {
            const res = await fetch(`${API_BASE}/users/${userId}`, {
                method: "PUT",
                headers: getHeaders(),
                body: JSON.stringify({ display_name: newName })
            });
            if (!res.ok) throw new Error(await res.text());
            await loadUsers();
        } catch (err) { alert("Chyba při přejmenování uživatele: " + err.message); }
    }

    async function changeUserEmailPrompt(userId, oldEmail) {
        const newEmail = prompt("Zadejte nový primární email uživatele:", oldEmail);
        if (!newEmail || newEmail === oldEmail) return;
        if (!newEmail.includes("@")) { alert("Neplatný email."); return; }

        try {
            const res = await fetch(`${API_BASE}/users/${userId}/email`, {
                method: "PUT",
                headers: getHeaders(),
                body: JSON.stringify({ email: newEmail })
            });
            if (!res.ok) throw new Error(await res.text());
            if (currentUserEmail === oldEmail) {
                alert("Váš email byl změněn. Budete odhlášeni.");
                logout();
            } else {
                await loadUsers();
            }
        } catch (err) { alert("Chyba při změně emailu: " + err.message); }
    }
    function removeMemberFromGroupContext(groupId, groupName, userId) {
        customConfirm("Odstranit uživatele", `Opravdu chcete odstranit uživatele ze skupiny ${groupName}?`, "Ano, odstranit", async () => {
            document.getElementById("groupMembersList").innerHTML = "Aktualizuji seznam...";
            try {
                const res = await fetch(`${API_BASE}/groups/${groupId}/members/${userId}`, {
                    method: "DELETE", headers: getHeaders()
                });
                if (!res.ok) throw new Error(await res.text());
                
                await loadGroups(); 
                await loadUsers();
                openGroupDetail(groupId); 
                showToast("Uživatel byl odstraněn ze skupiny.");
            } catch (err) { 
                showToast("Chyba při odebírání: " + err.message, true);
                openGroupDetail(groupId); 
            }
        });
    }