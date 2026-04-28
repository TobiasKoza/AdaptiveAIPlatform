    // Barva pro známku
    window.getGradeColor = function getGradeColor(grade) {
      if (grade === 'F') return '#ef4444';
      if (grade === '-') return '#6b7280';
      return '#22c55e';
    };

    // NOVÉ: Převod bodů/procent na známku pro učitelskou tabulku
    window.getGradeFromScore = function getGradeFromScore(score, gradingInfo) {
      if (score === null || score === undefined || score === "") return "-";
      const s = Number(score);
      const percent = gradingInfo.style === 'percent' ? s : (s / gradingInfo.max) * 100;
      
      if (percent >= 90) return "A";
      if (percent >= 80) return "B";
      if (percent >= 70) return "C";
      if (percent >= 60) return "D";
      if (percent >= 50) return "E";
      return "F";
    }
    
    function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

    function parseStoredAiEvaluation(feedbackText) {
      const raw = String(feedbackText || "");
      const markerRegex = /\[__AI_STEP_EVAL__\]([\s\S]*?)\[\/__AI_STEP_EVAL__\]/;
      const match = raw.match(markerRegex);

      if (!match) {
        return {
          visibleFeedback: raw,
          aiEval: null
        };
      }

      let aiEval = null;
      try {
        const decoded = decodeURIComponent(escape(atob(match[1].trim())));
        aiEval = JSON.parse(decoded);
      } catch { }

      const visibleFeedback = raw.replace(markerRegex, "").trim();

      return {
        visibleFeedback,
        aiEval
      };
    }

    function buildStoredFeedbackWithAiMeta(visibleFeedback, aiEval) {
      const cleanVisible = String(visibleFeedback || "").trim();

      const hasStepResults = Array.isArray(aiEval.perStepResults) && aiEval.perStepResults.length > 0;
      const hasImagePoints = aiEval.imagePoints && Object.keys(aiEval.imagePoints).length > 0;
      if (!aiEval || (!hasStepResults && !hasImagePoints)) {
        return cleanVisible;
      }

      try {
        const payload = {
          perStepResults: aiEval.perStepResults || [],
          totalPoints: aiEval.totalPoints ?? null,
          totalMaxPoints: aiEval.totalMaxPoints ?? null,
          imagePoints: aiEval.imagePoints || {}
        };

        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
        return `${cleanVisible}\n\n[__AI_STEP_EVAL__]${encoded}[/__AI_STEP_EVAL__]`;
      } catch {
        return cleanVisible;
      }
    }

    function openEvaluation(attemptId) {
      const panel = document.getElementById("evaluationPanel");
      const meta = document.getElementById("evaluationMeta");
      const preview = document.getElementById("submissionPreview");
      const _cmInitQueue = [];
      const _queueCmInit = (fn) => _cmInitQueue.push(fn);
      const feedback = document.getElementById("teacherFeedback");
      const score = document.getElementById("teacherScore");
      const status = document.getElementById("evaluationStatus");
      const saveBtn = document.getElementById("saveEvaluationBtn");
      const aiBtn = document.getElementById("btnAiEvaluate");
      if (aiBtn) {
          aiBtn.innerHTML = `Nechat AI ohodnotit otevřené úlohy`;
          if (!document.getElementById('btnAiEvaluateNote')) {
              const note = document.createElement('div');
              note.id = 'btnAiEvaluateNote';
              note.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px;';
              aiBtn.parentNode.insertBefore(note, aiBtn.nextSibling);
          }
      }

      const attempt = loadedAttempts.find(a => a.attemptId === attemptId);
      if (!attempt) return;

      // Najdeme odpovídající submission podle attemptId.
      // Backend vrací submissions seřazené od nejnovějších, takže první shoda stačí.
      const submission = loadedSubmissions.find(s => s.attemptId === attemptId);

      selectedSubmissionId = submission ? (submission.submissionId || submission.RowKey) : null;

      // selectedAttemptId musí být nastaven PŘED čtením cache, aby nenastala race condition
      selectedAttemptId = attemptId;

      const storedFeedbackRaw = attempt.feedbackText || submission?.feedbackText || "";
      const parsedStoredEval = parseStoredAiEvaluation(storedFeedbackRaw);
      const cachedAiEval = window.currentAiEvaluationByAttempt?.[attemptId] || parsedStoredEval.aiEval || null;

      panel.style.display = "block";
      status.innerText = "";
      saveBtn.disabled = false;

      // Zjištění typu hodnocení (body vs procenta) z nastavení
      const scenario = window.allLoadedScenariosForAttempts?.find(s => s.scenarioId === attempt.scenarioId || s.RowKey === attempt.scenarioId);
      let gStyle = 'points'; let gMax = 10; let passThreshold = null;
      const hintsStr = scenario?.hints || "";
      const instrStr = scenario?.instructions || "";
      
      const gm = hintsStr.match(/\[GRADING:\s*([a-zA-Z]+)\s*:?\s*(\d+)?\s*\]/i);
      if (gm) { gStyle = gm[1]; if (gm[2]) gMax = parseInt(gm[2], 10); }
      const _ptMatch = (hintsStr || '').match(/\[PASS_THRESHOLD:(\d+)\]/);
      if (_ptMatch) passThreshold = parseInt(_ptMatch[1], 10);
      
      if (!gm || !gm[2]) {
          // Fallback: Pokud učitel napsal "max bodů 150" rovnou do textu zadání nebo hints
          const textPointsMatch = hintsStr.match(/max(?:\.|im[áa]ln[íi])?\s*(?:po[čc]et\s*)?bod[uů]?\s*:?\s*(\d+)/i) || 
                                  instrStr.match(/max(?:\.|im[áa]ln[íi])?\s*(?:po[čc]et\s*)?bod[uů]?\s*:?\s*(\d+)/i);
          const textPoints = textPointsMatch ? parseInt(textPointsMatch[1], 10) : null;
          
          const fallbackMax = Number(scenario?.maxPoints) || textPoints || (scenario?.maxAttempts > 20 ? scenario.maxAttempts : 0);
          if (fallbackMax > 0) gMax = fallbackMax;
      }
      window.currentEvalStyle = gStyle;
      window.currentEvalMax = gMax;
      // Pomocná funkce pro čtení tagů z hints
      const getTag = (tag) => {
          const match = hintsStr.match(new RegExp(`\\[\\s*${tag}\\s*:([\\s\\S]*?)\\]`));
          return match ? match[1].trim() : null;
      };

      // Zjištění varianty a textu zadání pro AKTUÁLNÍ pokus
      const currentRunNum = attempt.runNumber || 1;
      const mappedVariant = getTag("MAP" + currentRunNum);
      const variantNum = mappedVariant ? parseInt(mappedVariant, 10) : currentRunNum;

      let finalInstructions = scenario?.instructions || "Žádné specifické zadání.";
      if (variantNum > 1) {
          finalInstructions = getTag("INST" + variantNum) || finalInstructions;
      }

      // Extrahuj správnou variantu z [VARIANTx] bloků
      const variantBlockRegex2 = /\[VARIANT(\d+)\]([\s\S]*?)\[\/VARIANT\d+\]/g;
      const variantBlocks2 = [];
      let vMatch2;
      while ((vMatch2 = variantBlockRegex2.exec(finalInstructions)) !== null) {
          variantBlocks2.push({ num: parseInt(vMatch2[1]), content: vMatch2[2].trim() });
      }
      if (variantBlocks2.length > 0) {
          const chosen2 = variantBlocks2.find(v => v.num === variantNum) || variantBlocks2[0];
          finalInstructions = chosen2.content;
      }
      
      const rawSelectedInstructionsForType = finalInstructions || "";

      // Bezpečné odstranění všech technických tagů pro čisté zobrazení textu u otevřených úloh
      finalInstructions = finalInstructions
          .replace(/\[VARIANT_SOLUTION\][\s\S]*?\[\/VARIANT_SOLUTION\]/gi, '')
          .replace(/\[SOLUTION_TEXT\d+\][\s\S]*?\[\/SOLUTION_TEXT\d+\]/gi, '')
          .replace(/\[SOL\d+\][\s\S]*?\[\/SOL\d+\]/gi, '')
          .replace(/\[PTS\d+\][\s\S]*?\[\/PTS\d+\]/gi, '')
          .replace(/\[SKIP\d+\][\s\S]*?\[\/SKIP\d+\]/gi, '')
          .replace(/\[HINTS\d+\][\s\S]*?\[\/HINTS\d+\]/gi, '')
          .replace(/\[STEP\d+\]/gi, '')
          .replace(/\[\/STEP\d+\]/gi, '')
          .trim();

      // Rozlišení typů úloh podle právě vybrané varianty, ne podle celého scenario.instructions
      const rawInstrForCheck = rawSelectedInstructionsForType;
      const stepCountForCheck = (rawInstrForCheck.match(/\[STEP\d+\]/g) || []).length;
      const hasStepTask = stepCountForCheck > 0;
      const hasSolutionsForCheck = /\[SOL\d+\]/.test(rawInstrForCheck);
      const isMarkedSequential = /\[SEQUENTIAL:true\]/i.test(hintsStr);
      const isExactOrSequentialScenario = hasSolutionsForCheck || isMarkedSequential;
      const isSingleStepOpenScenario = stepCountForCheck === 1 && !isExactOrSequentialScenario;

      // Detekce nového strukturovaného formátu (taskConfigJson)
      let structuredTaskConfig = null;
      try {
          if (scenario?.taskConfigJson) {
              const parsed = JSON.parse(scenario.taskConfigJson);
              const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
              const chosenVar = variants.find(v => Number(v?.variantNo) === variantNum) || variants[0];
              if (chosenVar && Array.isArray(chosenVar.tasks) && chosenVar.tasks.length > 0) {
                  structuredTaskConfig = { tasks: chosenVar.tasks, variantNo: Number(chosenVar.variantNo) || variantNum };
              }
          }
      } catch(e) { structuredTaskConfig = null; }
      const hasStructuredTaskConfig = !!structuredTaskConfig;

      const scenarioTypeLabel = hasStructuredTaskConfig
          ? 'strukturovaná úloha'
          : (hasStepTask
              ? (isExactOrSequentialScenario
                  ? 'sekvenční / přesně kontrolovaná úloha'
                  : (isSingleStepOpenScenario ? 'otevřená úloha' : 'vícekroková otevřená úloha'))
              : 'otevřená odpověď');

      // AI tlačítko — uprav label podle toho zda jsou otevřené úkoly
      if (aiBtn) {
          if (isExactOrSequentialScenario) {
              aiBtn.style.display = 'none';
          } else {
              aiBtn.style.display = 'inline-flex';
              // Strukturované zadání — zjisti zda má vůbec otevřené/code kroky
              const _note = document.getElementById('btnAiEvaluateNote');
              if (hasStructuredTaskConfig && structuredTaskConfig?.tasks) {
                  const _hasOpen = structuredTaskConfig.tasks.some(t =>
                      ['open', 'code'].includes(String(t?.type || '').toLowerCase()));
                  const _hasImage = structuredTaskConfig.tasks.some(t =>
                      String(t?.type || '').toLowerCase() === 'image');
                  if (!_hasOpen) {
                      aiBtn.innerHTML = `Nechat AI vygenerovat celkovou zpětnou vazbu`;
                      aiBtn.dataset.onlySynth = 'true';
                  } else {
                      aiBtn.innerHTML = `Nechat AI ohodnotit otevřené úlohy`;
                      aiBtn.dataset.onlySynth = 'false';
                  }
                  if (_note) _note.textContent = _hasImage ? 'Obrázky AI nehodnotí — odpovědi by byly nekonzistentní' : '';
              } else {
                  // Starý formát — zkontroluj zda zadání obsahuje image typ
                  const _hasImage = /\[TYPE:image\]|\bimage\b/i.test(scenario?.instructions || '') || /image/i.test(scenario?.taskConfigJson || '');
                  if (_note) _note.textContent = _hasImage ? 'Obrázky AI nehodnotí — odpovědi by byly nekonzistentní' : '';
              }
          }
      }

      // Hezká jména
      const userObj = allLoadedUsers.find(u => u.user_id === attempt.userId);
      const studentName = userObj ? (userObj.display_name || userObj.email || attempt.userId) : attempt.userId;
      const scenarioName = scenario ? scenario.title : attempt.scenarioId;

      // Čistá hlavička
      meta.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 14px; background: #f3f4f6; padding: 12px 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <div><strong>Student:</strong> ${escapeHtml(studentName)}</div>
            <div><strong>Zadání:</strong> ${escapeHtml(scenarioName)}</div>
            <div><strong>Pokus:</strong> ${attempt.runNumber || 1}.</div>
            <div><strong>Odevzdáno:</strong> ${attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString("cs-CZ") : "-"}</div>
        </div>
      `;

      // Historie ostatních pokusů studenta (Harmonika)
      const studentScenarioAttempts = loadedAttempts.filter(a => a.userId === attempt.userId && a.scenarioId === attempt.scenarioId);
      const pastAttempts = studentScenarioAttempts.filter(a => a.attemptId !== attemptId);
      let historyHtml = "";
      
      if (pastAttempts.length > 0) {
          historyHtml += `<div style="margin-top: 25px; border-top: 1px solid var(--border-color); padding-top: 15px;">
              <h4 style="margin-top: 0; color: var(--text-heading); margin-bottom: 12px;">Historie ostatních pokusů studenta</h4>`;
          
          pastAttempts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(pastAtm => {
              const pSub = loadedSubmissions.find(s => s.attemptId === pastAtm.attemptId);
              const pRun = pastAtm.runNumber || "?";
              const pDateObj = pastAtm.createdAt ? new Date(pastAtm.createdAt) : null;
              const pDate = pDateObj ? pDateObj.toLocaleDateString("cs-CZ") : "-";
              
              let pScore = pastAtm.score ?? pSub?.score;
              let pFeedbackText = pastAtm.feedbackText || pSub?.feedbackText;
              
              if (pFeedbackText) {
                  pFeedbackText = pFeedbackText.replace(/\[__AI_STEP_EVAL__\][\s\S]*?\[\/__AI_STEP_EVAL__\]/g, '').trim();
              }
              
              if (pastAtm.learningStatus === "evaluated" && gStyle !== 'none' && (pScore === null || pScore === undefined || pScore === "")) {
                  pScore = 0;
              }
              
              let pointsDetailHtml = `<strong>Hodnocení:</strong> -`;
              if (pScore !== null && pScore !== undefined && pScore !== "") {
                  pointsDetailHtml = gStyle === 'percent' ? `<strong>Hodnocení:</strong> ${pScore} %` : `<strong>Hodnocení:</strong> ${pScore} z ${gMax} bodů`;
              }
              // Zjištění varianty pro historii
              const pMappedVariant = getTag("MAP" + pRun);
              const pVariantNum = pMappedVariant ? parseInt(pMappedVariant, 10) : pRun;

              const statsBlockHtml = `
                <div style="font-size: 13px; color: var(--text-primary); padding-top: 10px;"><strong>Datum:</strong> ${pDate}</div>
                <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px;"><strong>Varianta zadání:</strong> ${pVariantNum}</div>
                <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px; margin-bottom: 10px;">${pointsDetailHtml}</div>
              `;
              
              const fbTextHtml = pFeedbackText 
                ? `<div style="font-size: 13px; color: var(--text-primary); margin-top: 6px; white-space: pre-wrap; font-family: monospace; background: var(--bg-panel); padding: 8px; border: 1px solid var(--border-color); border-radius: 6px;">${escapeHtml(pFeedbackText)}</div>` 
                : `<div style="font-size: 13px; color: var(--text-muted); font-style: italic; margin-top: 6px;">Zatím bez slovní zpětné vazby.</div>`;

              let pGrade = '';
              if (pScore !== null && pScore !== undefined && pScore !== '') {
                  if (passThreshold !== null && passThreshold !== undefined) {
                      const pPct = gMax > 0 ? (Number(pScore) / gMax) * 100 : 0;
                      const passed = pPct >= passThreshold;
                      pGrade = `<span class="badge" style="background:${passed?'#10b981':'#ef4444'};color:white;margin-left:10px;">${passed?'✓ Splněno':'✗ Nesplněno'}</span>`;
                  } else {
                      const gColor = window.getGradeColor(getGradeFromScore(pScore, {style: gStyle, max: gMax}));
                      pGrade = `<span class="badge" style="background:${gColor};color:white;margin-left:10px;">${getGradeFromScore(pScore, {style: gStyle, max: gMax})}</span>`;
                  }
              }

              historyHtml += `
                <div style="border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 12px; background: var(--bg-panel);">
                  <div style="padding: 10px 15px; font-weight: bold; border-bottom: 1px solid var(--border-color); background: var(--bg-status); border-radius: 8px 8px 0 0; display:flex; justify-content:space-between; color: var(--text-heading);">
                    <div>${pRun}. pokus ${pGrade}</div>
                  </div>
                  <div style="padding: 15px; color: var(--text-primary);">
                      ${statsBlockHtml}
                      <hr style="margin: 0 0 10px 0; border: 0; border-top: 1px solid var(--border-color);" />
                      <div style="font-size: 13px;"><strong>Slovní hodnocení učitele:</strong></div>
                      ${fbTextHtml}
                  </div>
                </div>
              `;
          });
          historyHtml += `</div>`;
      }

      // Pomocná funkce pro label typu úkolu
      const structuredTypeLabel = (type) => {
          const map = { flag:'Přesná odpověď', tf:'Pravda / Nepravda', abcd:'Výběr z možností',
              multi:'Více správných možností', sort:'Seřazení kroků', open:'Otevřená odpověď',
              code:'Analýza kódu', image:'Práce s obrázkem' };
          return map[String(type||'').toLowerCase()] || 'Úkol';
      };

      // Pro všechny vícekrokové úlohy sestavíme přehled kroků s odpověďmi
      let studentAnswerHtml = '';
      if (hasStructuredTaskConfig) {
          // Parsuj step_details JSON — merge dvou zdrojů:
          // 1) submission.step_details = kompletní data studenta (answer, answer_raw, ...)
          // 2) attempt.stepDetails = aktualizované body od učitele (points_earned)
          let stepDetails = {};
          try {
              // Nejdřív načti odpovědi studenta ze submission (primární zdroj odpovědí)
              const _subRaw = submission?.stepDetails || submission?.step_details || '';
              if (_subRaw) {
                  const _subSd = JSON.parse(_subRaw);
                  if (Array.isArray(_subSd)) _subSd.forEach(d => { stepDetails[String(d.step)] = { ...d }; });
              }
              // Pak přepiš points_earned z attempt.stepDetails (učitelské hodnocení má přednost)
              const _atmRaw = attempt.stepDetails || attempt.step_details || '';
              if (_atmRaw) {
                  const _atmSd = JSON.parse(_atmRaw);
                  if (Array.isArray(_atmSd)) {
                      _atmSd.forEach(d => {
                          const k = String(d.step);
                          if (!stepDetails[k]) stepDetails[k] = { step: d.step };
                          // Přepiš jen body — zachovej answer a ostatní pole ze submission
                          if (d.points_earned !== undefined && d.points_earned !== null) {
                              stepDetails[k].points_earned = d.points_earned;
                          }
                          if (d.points_max !== undefined && d.points_max !== null) {
                              stepDetails[k].points_max = d.points_max;
                          }
                      });
                  }
              }
          } catch(e) {}

          // Fallback: načti stepDetails ze submission záznamu (submission.stepDetails má vždy aktuální data)
          if (Object.keys(stepDetails).length === 0 && submission) {
              const _subSD = submission.stepDetails || submission.step_details || '';
              if (_subSD) {
                  try {
                      const _subParsed = JSON.parse(_subSD);
                      if (Array.isArray(_subParsed) && _subParsed.length > 0) {
                          _subParsed.forEach(d => { stepDetails[String(d.step)] = d; });
                      }
                  } catch(e) {}
              }
          }
          // Poslední záchrana: načti points_earned z perStepResults v metadatech —
          // ALE pouze pro kroky kde stepDetails opravdu chybí (ne jako override!)
          if (cachedAiEval?.perStepResults?.length > 0) {
              cachedAiEval.perStepResults.forEach(r => {
                  const k = String(r.step);
                  if (!stepDetails[k]) {
                      // Krok vůbec nemá záznam — vytvoř ho z AI dat
                      stepDetails[k] = { step: r.step, points_earned: r.points, points_max: r.maxPoints };
                  }
                  // NIKDY nepřepisovat existující points_earned — to způsobovalo reset na AI hodnotu
              });
          }

          if (Object.keys(stepDetails).length === 0) {
              const _payload = submission?.contentPayload || attempt.submissionNote || '';
              const _stepRx = /^Krok\s+(\d+):\s*/gm;
              const _starts = [];
              let _sm;
              while ((_sm = _stepRx.exec(_payload)) !== null) {
                  _starts.push({ n: _sm[1], pos: _sm.index + _sm[0].length, marker: _sm.index });
              }
              _starts.forEach((it, i) => {
                  const end = i + 1 < _starts.length ? _starts[i+1].marker : _payload.length;
                  let ansText = _payload.slice(it.pos, end).trim();
                  let pEarned = null, pMax = null;
                  const scoreM = ansText.match(/\[(\d+)\/(\d+)\s*b[^\]]*\]\s*$/);
                  if (scoreM) { pEarned = parseInt(scoreM[1]); pMax = parseInt(scoreM[2]); ansText = ansText.replace(scoreM[0], '').trim(); }
                  stepDetails[it.n] = { step: parseInt(it.n), answer: ansText, answer_raw: null, points_earned: pEarned, points_max: pMax, skipped: false };
              });
          }

          const tasks = structuredTaskConfig.tasks;
          const tasksHtml = tasks.map((task, idx) => {
              const stepNum = String(idx + 1);
              const det = stepDetails[stepNum] || null;
              const type = String(task?.type || 'open').toLowerCase();
              const typeLabel = structuredTypeLabel(type);
              const points = Number(task?.points || 0);
              // Priorita: det.points_earned → uložená AI/učitelská cache (feedbackText metadata) → null
              // NIKDY nepřepisovat uloženou hodnotu zpětným výpočtem ze správnosti odpovědi
              const _cachedStepResult = (cachedAiEval?.perStepResults || []).find(r => String(r.step) === stepNum);
              const pointsEarned = det?.points_earned ?? _cachedStepResult?.points ?? null;
              // barColor se dopočítá níže po definici isStrict, isImage, cachedStepPts, displayedEarned
              let barColor = '#6b7280';

              // Render odpovědi podle typu
              let answerHtml = '';
              const rawAns = det?.answer || det?.answer_raw || '';
              const displayAns = rawAns && rawAns !== '__SKIPPED__' ? rawAns : null;

              if (type === 'tf') {
                  const studentLabel = det?.answer || null;
                  const correctVal = task.correctValue ? (String(task.correctValue) === 'true' ? 'Pravda' : 'Nepravda') : null;
                  const tfNoAnswer = !studentLabel || (studentLabel !== 'Pravda' && studentLabel !== 'Nepravda');
                  answerHtml = `<div style="display:flex; gap:10px; flex-wrap:wrap;">
                      ${['Pravda','Nepravda'].map(val => {
                          const isSelected = studentLabel === val;
                          const isCorrectVal = correctVal === val;
                          const bg = isCorrectVal ? 'rgba(16,185,129,0.12)' : 'var(--bg-status)';
                          const border = isCorrectVal ? '2px solid #10b981' : '1px solid var(--border-color)';
                          return `<div style="flex:1;min-width:120px;padding:10px 14px;border-radius:8px;font-size:14px;font-weight:bold;background:${bg};border:${border};color:var(--text-primary);display:flex;align-items:center;gap:6px;">
                              ${isCorrectVal ? '<strong style="color:#10b981;">✓</strong>' : '<span style="display:inline-block;width:14px;"></span>'}
                              ${escapeHtml(val)}
                              ${isSelected ? '<span style="font-size:11px;color:#60a5fa;font-weight:normal;margin-left:4px;">(odpověď studenta)</span>' : ''}
                          </div>`;
                      }).join('')}
                  </div>`;
              } else if (type === 'abcd' || type === 'multi') {
                  const options = Array.isArray(task.options) ? task.options : [];
                  // Rekonstruuj pořadí ze step_details options_order pokud existuje
                  let orderedOpts = options;
                  try {
                      const storedOrder = JSON.parse(det?.options_order || 'null');
                      if (Array.isArray(storedOrder) && storedOrder.length === options.length) {
                          orderedOpts = storedOrder.map(id => options.find(o => String(o.id) === String(id))).filter(Boolean);
                      }
                  } catch(e) {}
                  // Fallback: pokud answer_raw chybí, matchuj podle textu v det.answer
                  const _answerText = det?.answer || '';
                  const _answerTexts = type === 'multi'
                      ? _answerText.split(',').map(s => s.trim()).filter(Boolean)
                      : [_answerText.trim()];
                  const selectedIds = (() => {
                      try {
                          if (type === 'multi') {
                              const raw = JSON.parse(det?.answer_raw || '[]');
                              if (Array.isArray(raw) && raw.length > 0) return raw;
                          } else {
                              const raw = JSON.parse(det?.answer_raw || 'null');
                              if (raw !== null) return [String(raw)];
                          }
                      } catch(e) {}
                      // Fallback — matchuj id podle textu
                      return orderedOpts.filter(o => _answerTexts.some(t => t.toLowerCase() === String(o.text||'').toLowerCase())).map(o => String(o.id));
                  })();
                  const noSelection = selectedIds.filter(x => x !== null && x !== undefined && x !== '').length === 0;
                  answerHtml = `<div style="display:flex;flex-direction:column;gap:8px;">
                      ${orderedOpts.map((opt, di) => {
                          const isSelected = selectedIds.map(String).includes(String(opt.id));
                          const isCorrect  = !!opt.correct;
                          const bg     = isCorrect ? 'rgba(16,185,129,0.12)' : isSelected ? 'rgba(239,68,68,0.08)' : 'var(--bg-status)';
                          const border = isCorrect ? '2px solid #10b981' : isSelected ? '2px solid #ef4444' : '1px solid var(--border-color)';
                          const letter = String.fromCharCode(65 + di);
                          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:${bg};border:${border};color:var(--text-primary);">
                              <span style="font-weight:700;min-width:22px;">${letter})</span>
                              <span style="flex:1;">${escapeHtml(String(opt.text||''))}</span>
                              ${isCorrect ? '<span style="color:#10b981;font-weight:bold;font-size:13px;">✓ správně</span>' : ''}
                              ${isSelected ? '<span style="font-size:11px;color:#60a5fa;font-weight:normal;margin-left:4px;">(odpověď studenta)</span>' : ''}
                          </div>`;
                      }).join('')}
                  </div>`;
              } else if (type === 'sort') {
                  const options = Array.isArray(task.options) ? task.options : [];
                  let studentOrder = [];
                  try {
                      const raw = JSON.parse(det?.answer_raw || '[]');
                      if (Array.isArray(raw) && raw.length > 0) { studentOrder = raw; }
                  } catch(e) {}
                  if (studentOrder.length === 0 && det?.answer) {
                      const parts = det.answer.split('→').map(s => s.trim()).filter(Boolean);
                      studentOrder = parts.map(text => {
                          const opt = options.find(o => String(o.text||'').trim() === text);
                          return opt ? String(opt.id) : null;
                      }).filter(Boolean);
                  }
                  const correctOrder = options.map(o => String(o.id));
                  answerHtml = `<div style="display:flex;flex-direction:column;gap:6px;">`;
                  if (studentOrder.length > 0) {
                      answerHtml += studentOrder.map((id, i) => {
                          const opt = options.find(o => String(o.id) === String(id));
                          const isOk = correctOrder[i] === String(id);
                          const bg     = isOk ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)';
                          const border = isOk ? '1px solid #10b981' : '1px solid #ef4444';
                          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:${bg};border:${border};color:var(--text-primary);">
                              <span style="font-weight:700;min-width:22px;color:var(--text-muted);">${i+1}.</span>
                              <span style="flex:1;">${escapeHtml(String(opt?.text||id))}</span>
                              ${isOk ? '<span style="color:#10b981;font-size:12px;">✓</span>' : '<span style="color:#ef4444;font-size:12px;">✗</span>'}
                          </div>`;
                      }).join('');
                      // Správné pořadí
                      answerHtml += `<div style="margin-top:8px;font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Správné pořadí</div>`;
                      answerHtml += correctOrder.map((id, i) => {
                          const opt = options.find(o => String(o.id) === String(id));
                          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:8px;background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.3);color:var(--text-primary);">
                              <span style="font-weight:700;min-width:22px;color:var(--text-muted);">${i+1}.</span>
                              <span style="flex:1;">${escapeHtml(String(opt?.text||id))}</span>
                          </div>`;
                      }).join('');
                  } else {
                      answerHtml += '';
                  }
                  answerHtml += '</div>';
              } else {
                  const text = displayAns || null;
                  const noAnswer = !text;

                  if (type === 'image') {
                      // Thumbnail s lightboxem
                      const imgUrl = task.imageUrl || '';
                      answerHtml = imgUrl ? `
                          <div style="margin-bottom:10px;">
                              <img src="${escapeHtml(imgUrl)}" alt="Obrázek k úkolu"
                                  onclick="this.style.position='fixed';this.style.top='50%';this.style.left='50%';this.style.transform='translate(-50%,-50%)';this.style.maxWidth='90vw';this.style.maxHeight='90vh';this.style.zIndex='9999';this.style.borderRadius='8px';this.style.boxShadow='0 0 0 9999px rgba(0,0,0,0.7)';this.style.cursor='zoom-out';this.onclick=function(){this.style.cssText='max-width:120px;border-radius:6px;cursor:zoom-in;border:1px solid var(--border-color);display:block;margin-bottom:8px;'};"
                                  style="max-width:120px;border-radius:6px;cursor:zoom-in;border:1px solid var(--border-color);display:block;margin-bottom:8px;" />
                          </div>` : '';
                      answerHtml += `<div style="font-size:13px;${noAnswer?'color:#f59e0b;font-style:italic;':'color:var(--text-primary);'}line-height:1.6;white-space:pre-wrap;background:var(--bg-status);border-radius:8px;padding:10px 12px;border:1px solid ${noAnswer?'#f59e0b':'var(--border-color)'};">${noAnswer?'Student neposkytl odpověď':escapeHtml(text)}</div>`;

                  } else if (type === 'code') {
                      const solText = (task.solutionText || '').trim();
                      const studentCode = (text || '').trim();
                      const cmSolId = `cm-sol-${stepNum}`;
                      const cmStudId = `cm-stud-${stepNum}`;
                      answerHtml = '';
                      
                      if (solText) {
                          answerHtml += `<div style="margin-bottom:12px;">
                              <div style="font-size:11px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Správné řešení</div>
                              <div id="${cmSolId}" style="border:1px solid rgba(16,185,129,0.4);border-radius:8px;overflow:hidden;"></div>
                          </div>`;
                      }
                      // Odpověď studenta
                      answerHtml += `<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Odpověď studenta</div>`;
                      if (noAnswer) {
                          answerHtml += `<div style="font-size:13px;color:#f59e0b;font-style:italic;line-height:1.6;background:var(--bg-status);border-radius:8px;padding:10px 12px;border:1px solid #f59e0b;">Student neposkytl odpověď</div>`;
                      } else {
                          answerHtml += `<div id="${cmStudId}" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;"></div>`;
                      }
                      // Lazy init CM po vložení do DOM
                      _queueCmInit(() => {
                          window.ensureCodeMirrorLoaded(() => {
                              const isDark = document.body.classList.contains('dark-mode');
                              const theme = isDark ? 'dracula' : 'default';
                              const _initResizableCM = (hostEl, code, readOnly, maxH = 220) => {
                                  if (!hostEl || hostEl._cm) return;
                                  const _lines = code.split('\n').length;
                                  const _h = Math.min(Math.max(_lines * 19 + 32, 60), maxH);
                                  hostEl.style.height = _h + 'px';
                                  hostEl.style.minHeight = '60px';
                                  hostEl.style.resize = 'vertical';
                                  hostEl.style.overflow = 'hidden';
                                  const cm = CodeMirror(hostEl, { value: code, mode: 'python', theme, lineNumbers: true, readOnly, lineWrapping: false, scrollbarStyle: 'native' });
                                  cm.setSize('100%', '100%');
                                  if (window.ResizeObserver) new ResizeObserver(() => cm.refresh()).observe(hostEl);
                                  setTimeout(() => { cm.setOption('mode', cm.getOption('mode')); cm.refresh(); }, 150);
                                  hostEl._cm = cm;
                              };
                              // Správné řešení - omezeno na 5 řádků (120px)
                              if (solText) _initResizableCM(document.getElementById(cmSolId), solText, true, 120);
                              // Odpověď studenta - max 10 řádků (220px)
                              if (!noAnswer) _initResizableCM(document.getElementById(cmStudId), studentCode, true, 220);
                          });
                      }, 50);

                  } else {
                      if (type === 'flag' && task.solution) {
                          const isMatch = String(displayAns||'').trim().toLowerCase() === String(task.solution).trim().toLowerCase();
                          answerHtml = `<div style="font-size:13px;${noAnswer?'color:#f59e0b;font-style:italic;':'color:var(--text-primary);'}line-height:1.6;white-space:pre-wrap;background:var(--bg-status);border-radius:8px;padding:10px 12px;border:1px solid ${noAnswer?'#f59e0b':'var(--border-color)'};">${noAnswer ? 'Student neposkytl odpověď' : `${escapeHtml(text)} <span style="color:${isMatch?'#10b981':'#ef4444'};font-weight:bold;">${isMatch?'✓':'✗'}</span>`}</div>`;
                          if (!isMatch) {
                              answerHtml += `<div style="margin-top:6px;padding:7px 12px;border-radius:6px;background:rgba(16,185,129,0.12);border:1px solid #10b981;font-size:13px;color:#10b981;">
                                  <strong>Správná odpověď:</strong> ${escapeHtml(task.solution)}
                              </div>`;
                          }
                      } else {
                          answerHtml = `<div style="font-size:13px;${noAnswer?'color:#f59e0b;font-style:italic;':'color:var(--text-primary);'}line-height:1.6;white-space:pre-wrap;background:var(--bg-status);border-radius:8px;padding:10px 12px;border:1px solid ${noAnswer?'#f59e0b':'var(--border-color)'};">${noAnswer?'Student neposkytl odpověď':escapeHtml(text)}</div>`;
                      }
                  }
              }

              // Striktní typy — auto-hodnotitelné, zbytek vyžaduje ruční/AI vstup
              const isStrict = ['flag','tf','abcd','multi','sort'].includes(type);
              const isImage  = type === 'image';

              // Pro open/code kroky — čti z cachedAiEval (funguje i po refreshi)
              // Striktní kroky už mají hodnotu v pointsEarned výše — necháme null aby se nepřepisovaly
              const cachedStepPts = !isStrict && !isImage
                  ? (cachedAiEval?.perStepResults || []).find(r => String(r.step) === stepNum)?.points ?? null
                  : null;
              // Image body z cache
              const cachedImagePts = isImage
                  ? (cachedAiEval?.imagePoints?.[stepNum] ?? null)
                  : null;
              const _rawEarned = pointsEarned !== null ? pointsEarned : (cachedStepPts ?? cachedImagePts);
              const _taskHintsForDeduct = Array.isArray(task?.hints) ? task.hints : [];
              const _hintsUsedCount = det?.hints_used || 0;
              const _hintCostTotal = _taskHintsForDeduct.slice(0, _hintsUsedCount).reduce((s, h) => s + (Number(h?.cost) || 0), 0);
              // Srážka se odečte pouze pokud student body skutečně získal (ne záporné výsledky)
              const displayedEarned = _rawEarned !== null ? Math.max(0, _rawEarned - _hintCostTotal) : null;
              const isCorrect  = displayedEarned !== null && points > 0 && displayedEarned >= points;
              const isPartial  = displayedEarned !== null && points > 0 && displayedEarned > 0 && displayedEarned < points;
              const isWrong    = displayedEarned !== null && points > 0 && displayedEarned <= 0;
              barColor = isCorrect ? '#10b981' : isPartial ? '#f59e0b' : isWrong ? '#ef4444' : '#6b7280';

              // Zpětná vazba pro striktní kroky — jen pokud bylo auto-ohodnoceno
              let stepFeedbackHtml = '';
              if (isStrict && points > 0 && pointsEarned !== null) {
                  const correct = pointsEarned >= points;
              const noAnswer = !det?.answer || det.answer === '(bez odpovědi)' || det.answer === '__SKIPPED__';
              const fbText = correct
                  ? 'Výborná práce, odpověď je správná!'
                  : noAnswer
                      ? 'Na tuto otázku student neodpověděl. Příště zkuste odpovědět — i tip se počítá!'
                      : 'Odpověď nebyla správná. Prostudujte si toto téma a příště to určitě vyjde!';
                  stepFeedbackHtml = `<div style="margin-top:10px;">
                      <label style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;">Zpětná vazba</label>
                      <textarea id="step-feedback-input-${stepNum}" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border-color);border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;background:rgba(59,130,246,0.07);color:var(--text-primary);font-size:13px;line-height:1.5;resize:vertical;min-height:60px;box-sizing:border-box;">${escapeHtml(fbText)}</textarea>
                  </div>`;
              }

              // AI výsledek jen pro open/code kroky — čti z cachedAiEval (obsahuje i data načtená ze serveru po refreshi)
              const aiStepResult = !isStrict ? (cachedAiEval?.perStepResults || [])
                  .find(r => String(r.step) === stepNum) : null;
              // Zpětná vazba pro open/code kroky — editovatelná textarea (prefill z AI nebo cache)
              if (!isStrict && !isImage) {
                  const _fbPrefill = aiStepResult?.feedback || (cachedAiEval?.perStepResults || []).find(r => String(r.step) === stepNum)?.feedback || '';
                  const _existingFb = (cachedAiEval?.perStepResults || []).find(r => String(r.step) === stepNum)?.teacherFeedback || _fbPrefill;
                  stepFeedbackHtml = `<div style="margin-top:10px;">
                      <label style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;">Zpětná vazba pro studenta</label>
                      <textarea id="step-feedback-input-${stepNum}" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border-color);border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;background:rgba(59,130,246,0.07);color:var(--text-primary);font-size:13px;line-height:1.5;resize:vertical;min-height:60px;box-sizing:border-box;">${escapeHtml(_existingFb)}</textarea>
                  </div>`;
              }
              const aiStepHtml = aiStepResult ? `<div style="margin-top:6px;padding:6px 10px;border-left:3px solid #6b7280;background:var(--bg-status);border-radius:0 6px 6px 0;">
                  <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">AI zdůvodnění (pro učitele)</span>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:2px;line-height:1.5;">${escapeHtml(aiStepResult.reasoning||aiStepResult.feedback||'')}</div>
              </div>` : '';

              // Per-krok body input
              const inputId = `step-points-input-${stepNum}`;
              let stepPointsHtml = '';
              if (points > 0) {
                  if (isStrict) {
                      // Striktní — nově editovatelné učitelem; prefill již zahrnuje srážku nápověd
                      const val = displayedEarned !== null ? displayedEarned : 0;
                      stepPointsHtml = `<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                          <span style="font-size:13px;font-weight:600;color:var(--text-primary);">Body za úkol:</span>
                          <input type="number" id="${inputId}" data-step="${stepNum}" data-max="${points}" data-strict="false" data-is-strict-task="true" data-hint-cost="${_hintCostTotal}"
                              min="0" max="${points}" value="${val}"
                              placeholder="0–${points}"
                              style="width:70px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;background:var(--bg-input);color:var(--text-primary);"
                              oninput="
                                  const _raw = Number(this.value) || 0;
                                  if (this.value !== '' && _raw > ${points}) { this.value = ''; this.style.borderColor = '#ef4444'; window.recalcStructuredScore(); return; }
                                  this.style.borderColor = '';
                                  window.recalcStructuredScore();
                                  const _v = this.value === '' ? null : Math.max(0, Math.min(${points}, _raw));
                                  const _badge = document.getElementById('step-score-badge-${stepNum}');
                                  if (_badge) {
                                      const _pct = _v !== null ? (_v / ${points}) * 100 : 0;
                                      const _color = _v === null ? '#6b7280' : _v >= ${points} ? '#10b981' : _pct >= 40 ? '#f59e0b' : '#ef4444';
                                      _badge.style.color = _color;
                                      _badge.style.borderColor = _color;
                                      _badge.style.background = _color + '22';
                                      _badge.textContent = (_v !== null ? _v : '—') + ' / ${points} b';
                                  }
                              ">
                          <span style="font-size:13px;color:var(--text-muted);">/ ${points}</span>
                      </div>`;
                  } else if (!isImage) {
                      // open / code — učitel nebo AI zadá; prefill z cache pokud existuje; odečti srážku nápověd
                      const _rawAiVal = aiStepResult ? aiStepResult.points : (cachedStepPts !== null ? cachedStepPts : '');
                      const aiVal = _rawAiVal !== '' && _rawAiVal !== null ? Math.max(0, Number(_rawAiVal) - _hintCostTotal) : '';
                      stepPointsHtml = `<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                          <span style="font-size:13px;font-weight:600;color:var(--text-primary);">Body za úkol:</span>
                          <input type="number" id="${inputId}" data-step="${stepNum}" data-max="${points}" data-strict="false"
                              min="0" max="${points}" value="${aiVal}"
                              placeholder="0–${points}"
                              style="width:70px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;background:var(--bg-input);color:var(--text-primary);"
                              oninput="
                                  const _raw = Number(this.value) || 0;
                                  if (this.value !== '' && _raw > ${points}) { this.value = ''; this.style.borderColor = '#ef4444'; window.recalcStructuredScore(); return; }
                                  this.style.borderColor = '';
                                  window.recalcStructuredScore();
                                  const _v = this.value === '' ? null : Math.max(0, Math.min(${points}, _raw));
                                  const _badge = document.getElementById('step-score-badge-${stepNum}');
                                  if (_badge) {
                                      const _pct = _v !== null ? (_v / ${points}) * 100 : 0;
                                      const _color = _v === null ? '#6b7280' : _v >= ${points} ? '#10b981' : _pct >= 40 ? '#f59e0b' : '#ef4444';
                                      _badge.style.color = _color;
                                      _badge.style.borderColor = _color;
                                      _badge.style.background = _color + '22';
                                      _badge.textContent = (_v !== null ? _v : '—') + ' / ${points} b';
                                  }
                              ">
                          <span style="font-size:13px;color:var(--text-muted);">/ ${points}</span>
                      </div>`;
                  } else {
                      // image — učitel zadá ručně; obnov z cache pokud existuje
                      const _savedImgVal = cachedAiEval?.imagePoints?.[stepNum] ?? '';
                      stepPointsHtml = `<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                          <span style="font-size:13px;font-weight:600;color:var(--text-primary);">Body za úkol:</span>
                          <input type="number" id="${inputId}" data-step="${stepNum}" data-max="${points}" data-strict="false" data-image="true"
                              min="0" max="${points}" value="${_savedImgVal}"
                              placeholder="0–${points}"
                              style="width:70px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;background:var(--bg-input);color:var(--text-primary);"
                              oninput="
                                  const _raw = Number(this.value) || 0;
                                  if (this.value !== '' && _raw > ${points}) { this.value = ''; this.style.borderColor = '#ef4444'; window.recalcStructuredScore(); return; }
                                  this.style.borderColor = '';
                                  window.recalcStructuredScore();
                                  const _v = this.value === '' ? null : Math.max(0, Math.min(${points}, _raw));
                                  const _badge = document.getElementById('step-score-badge-${stepNum}');
                                  if (_badge) {
                                      const _pct = _v !== null ? (_v / ${points}) * 100 : 0;
                                      const _color = _v === null ? '#6b7280' : _v >= ${points} ? '#10b981' : _pct >= 40 ? '#f59e0b' : '#ef4444';
                                      _badge.style.color = _color;
                                      _badge.style.borderColor = _color;
                                      _badge.style.background = _color + '22';
                                      _badge.textContent = (_v !== null ? _v : '—') + ' / ${points} b';
                                  }
                              ">
                          <span style="font-size:13px;color:var(--text-muted);">/ ${points}</span>
                      </div>`;
                  }
              }

              return `
                <div id="step-box-${stepNum}" style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;margin-bottom:12px;">
                  <div style="background:var(--bg-status);padding:10px 14px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-weight:bold;font-size:13px;color:var(--text-primary);">Krok ${stepNum}</span>
                      <span style="font-size:11px;color:var(--text-muted);border:1px solid var(--border-color);border-radius:999px;padding:2px 8px;background:var(--bg-panel);">${escapeHtml(typeLabel)}</span>
                    </div>
                    ${points > 0 ? `<span id="step-score-badge-${stepNum}" style="font-size:14px;font-weight:bold;color:${barColor};border:2px solid ${barColor};border-radius:8px;padding:2px 12px;background:${barColor}22;">${displayedEarned !== null ? displayedEarned : '—'} / ${points} b</span>` : ''}
                  </div>
                  <div style="padding:12px 14px;">
                    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Zadání</div>
                    <div style="font-size:13px;color:var(--text-primary);line-height:1.6;margin-bottom:10px;">${(() => {
                        const _p = task.prompt || '';
                        const _cbRx = /```(\w*)\n?([\s\S]*?)```/g;
                        let _last = 0, _parts = [], _pm, _pIdx = 0;
                        while ((_pm = _cbRx.exec(_p)) !== null) {
                            if (_pm.index > _last) _parts.push(`<span style="white-space:pre-wrap;">${escapeHtml(_p.slice(_last, _pm.index))}</span>`);
                            const _cmPId = `cm-prompt-${stepNum}-${_pIdx++}`;
                            const _pCode = _pm[2];
                            _parts.push(`<div id="${_cmPId}" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;margin:6px 0;"></div>`);
                            _queueCmInit(() => {
                                window.ensureCodeMirrorLoaded(() => {
                                    const _elP = document.getElementById(_cmPId);
                                    if (!_elP || _elP._cm) return;
                                    const _lP = _pCode.split('\n').length;
                                    const _hP = Math.min(Math.max(_lP * 19 + 32, 60), 500);
                                    _elP.style.height = _hP + 'px'; _elP.style.overflow = 'hidden'; _elP.style.resize = 'vertical';
                                    const _isDark = document.body.classList.contains('dark-mode');
                                    const _cmP = CodeMirror(_elP, { value: _pCode, mode: 'python', theme: _isDark ? 'dracula' : 'default', lineNumbers: true, readOnly: true, lineWrapping: false, scrollbarStyle: 'native' });
                                    _cmP.setSize('100%', '100%');
                                    if (window.ResizeObserver) new ResizeObserver(() => _cmP.refresh()).observe(_elP);
                                    setTimeout(() => { _cmP.setOption('mode', _cmP.getOption('mode')); _cmP.refresh(); }, 150);
                                    _elP._cm = _cmP;
                                });
                            });
                            _last = _pm.index + _pm[0].length;
                        }
                        if (_last < _p.length) _parts.push(`<span style="white-space:pre-wrap;">${escapeHtml(_p.slice(_last))}</span>`);
                        return _parts.length ? _parts.join('') : escapeHtml(_p);
                    })()}</div>
                    ${type !== 'code' ? `<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Odpověď studenta</div>` : ''}
                    ${answerHtml}
                    ${det?.skipped ? '<div style="margin-top:8px;font-size:12px;color:#ef4444;font-style:italic;">· krok přeskočen</div>' : ''}
                    ${(() => {
                        const _hintsUsed = det?.hints_used || 0;
                        if (_hintsUsed <= 0) return '';
                        const _taskHints = Array.isArray(task?.hints) ? task.hints : [];
                        const _usedHints = _taskHints.slice(0, _hintsUsed);
                        const _totalCost = _usedHints.reduce((s, h) => s + (Number(h?.cost) || 0), 0);
                        const _costStr = _totalCost > 0 ? ` <span style="color:#ef4444;font-weight:600;">(-${_totalCost} b)</span>` : '';
                        const _hintList = _usedHints.map((h, i) => {
                            const _c = Number(h?.cost) || 0;
                            return `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;padding-left:10px;">↳ Nápověda ${i+1}: ${escapeHtml(h.text||'')}${_c > 0 ? ` <span style="color:#ef4444;">(-${_c} b)</span>` : ''}</div>`;
                        }).join('');
                        return `<div style="margin-top:6px;" data-hints-cost="${_totalCost}" data-step-hints="${stepNum}">
                            <div style="font-size:12px;color:#f59e0b;font-weight:600;">📖 Využito nápověd: ${_hintsUsed}${_costStr}</div>
                            ${_hintList}
                        </div>`;
                    })()}
                    ${stepFeedbackHtml}
                    ${aiStepHtml}
                    ${stepPointsHtml}
                  </div>
                </div>`;
          }).join('');

          studentAnswerHtml = `<div style="margin-bottom:15px;">${tasksHtml}</div>`;

          // Výpočet součtu striktních bodů pro hint
          const strictTotal = tasks.reduce((sum, task, idx) => {
              const stepNum = String(idx + 1);
              const det = stepDetails[stepNum];
              const type = String(task?.type || '').toLowerCase();
              const isStrict = ['flag','tf','abcd','multi','sort'].includes(type);
              return isStrict ? sum + (Number(det?.points_earned ?? 0)) : sum;
          }, 0);
          const strictMax = tasks.reduce((sum, task) => {
              const type = String(task?.type || '').toLowerCase();
              return ['flag','tf','abcd','multi','sort'].includes(type) ? sum + Number(task.points || 0) : sum;
          }, 0);
          window._structuredStrictTotal = strictTotal;
          window._structuredStrictMax = strictMax;
          window._structuredTasks = tasks;
          window._structuredStepDetails = stepDetails;

          // Globální funkce pro přepočet celkového skóre z per-krok inputů
          window.recalcStructuredScore = function() {
              const inputs = document.querySelectorAll('[id^="step-points-input-"]');
              let total = 0; let totalMax = 0;
              let currentStrictTotal = 0;
              inputs.forEach(inp => {
                  const max = Number(inp.dataset.max || 0);
                  totalMax += max;
                  if (inp.value === '' || inp.value === null || inp.value === undefined) return;
                  const raw = Number(inp.value) || 0;
                  const val = inp.dataset.strict === 'true'
                      ? Math.max(0, raw)
                      : Math.max(0, Math.min(max, raw));
                  total += val;
                  
                  // Sledujeme i dynamický součet striktních úloh
                  if (inp.dataset.isStrictTask === 'true') {
                      currentStrictTotal += val;
                  }
              });
              const hintEl = document.getElementById('evalScoreSuggestHint');
              if (hintEl) {
                  hintEl.style.display = 'block';
                  hintEl.innerText = `Celkový součet bodů za striktní úlohy: ${currentStrictTotal} / ${window._structuredStrictMax}`;
              }
              const scoreEl = document.getElementById('teacherScore');
              if (scoreEl) {
                  scoreEl.value = total;
                  // Vyvoláme událost pro aktualizaci celkového odznáčku se známkou
                  scoreEl.dispatchEvent(new Event('input', { bubbles: true }));
              }
          };

      } else if (hasStepTask) {
          // Extrahuj kroky a správné odpovědi z instrukce
          const stepsForReview = [];
          const stepRx = /\[STEP(\d+)\]([\s\S]*?)\[\/STEP\d+\]/g;
          let sm;
          const instrSource = scenario?.instructions || '';
          // Najdeme správnou variantu v instrukci
          const vbRx = /\[VARIANT(\d+)\]([\s\S]*?)\[\/VARIANT\d+\]/g;
          let vb; const vbs = [];
          while ((vb = vbRx.exec(instrSource)) !== null) vbs.push({ num: parseInt(vb[1]), content: vb[2] });
          const chosenVariant = vbs.length > 0 ? (vbs.find(v => v.num === variantNum) || vbs[0]).content : instrSource;

          while ((sm = stepRx.exec(chosenVariant)) !== null) {
              const sNum = sm[1];
              const sText = sm[2].replace(/\[SOL\d+\][\s\S]*?\[\/SOL\d+\]/g, '').trim();
              const solRx = new RegExp(`\\[SOL${sNum}\\]([\\s\\S]*?)\\[\\/SOL${sNum}\\]`);
              const solM = chosenVariant.match(solRx);
              let correctAns = solM ? solM[1].trim() : '';
              const flagM = correctAns.match(/^FLAG\[(.+)\]$/i) || correctAns.match(/^FLAG\{(.+)\}$/i);
              if (flagM) correctAns = flagM[1];
              stepsForReview.push({ num: sNum, text: sText, correct: correctAns });
          }

          if (stepsForReview.length > 0) {
              const rawPayload = submission?.contentPayload || attempt.submissionNote || '';
              const studentAnswers = {};
              let stepDetails = {};

              // Parsuj step_details JSON — primární zdroj odpovědí
              try {
                  const sd = JSON.parse(submission?.step_details || attempt.step_details || '[]');
                  sd.forEach(d => {
                      stepDetails[d.step] = d;
                      // Rovnou naplň studentAnswers z answer pole v step_details
                      if (d.answer && d.answer !== '__SKIPPED__') {
                          studentAnswers[String(d.step)] = d.answer;
                      } else if (d.skipped) {
                          studentAnswers[String(d.step)] = '(přeskočeno)';
                      }
                  });
              } catch {}

              // Fallback: parsuj contentPayload jako bloky "Krok X:".
              // Blok končí až těsně před dalším "Krok X:" nebo na úplném konci textu.
              if (Object.keys(studentAnswers).length === 0 && rawPayload) {
                  const normalizedPayload = String(rawPayload).replace(/\r\n/g, '\n');
                  const stepStartRegex = /^Krok\s+(\d+):\s*/gm;

                  const starts = [];
                  let smStart;
                  while ((smStart = stepStartRegex.exec(normalizedPayload)) !== null) {
                      starts.push({
                          stepNum: String(smStart[1]),
                          contentStart: smStart.index + smStart[0].length
                      });
                  }

                  starts.forEach((item, idx) => {
                      const contentEnd = idx + 1 < starts.length ? starts[idx + 1].contentStart - (`Krok ${starts[idx + 1].stepNum}: `.length) : normalizedPayload.length;
                      let answerText = normalizedPayload.slice(item.contentStart, contentEnd).trim();

                      let isSkipped = answerText === '(přeskočeno)';
                      let pointsEarned = null;
                      let pointsMax = null;
                      let hintsUsed = 0;

                      const scoreMatch = answerText.match(/\s*\[(\d+)\/(\d+)\s*b(?:[^\]]*nápověd[^:]*:\s*(\d+))?[^\]]*\]\s*$/);
                      if (scoreMatch) {
                          pointsEarned = parseInt(scoreMatch[1], 10);
                          pointsMax = parseInt(scoreMatch[2], 10);
                          hintsUsed = scoreMatch[3] ? parseInt(scoreMatch[3], 10) : 0;
                          answerText = answerText.replace(scoreMatch[0], '').trim();
                          isSkipped = answerText === '(přeskočeno)';
                      }

                      studentAnswers[item.stepNum] = isSkipped ? '(přeskočeno)' : answerText;

                      if (pointsEarned !== null && pointsMax !== null && !stepDetails[item.stepNum]) {
                          stepDetails[item.stepNum] = {
                              step: parseInt(item.stepNum, 10),
                              answer: isSkipped ? '__SKIPPED__' : answerText,
                              points_earned: pointsEarned,
                              points_max: pointsMax,
                              hints_used: hintsUsed,
                              skipped: isSkipped
                          };
                      }
                  });

                  // Jednokroková otevřená úloha často nemá payload ve tvaru "Krok 1:".
                  // V tom případě ber celý text odevzdání jako odpověď na první a jediný krok.
                  if (Object.keys(studentAnswers).length === 0 && stepsForReview.length === 1) {
                      const singleStepKey = String(stepsForReview[0].num);
                      const plainAnswer = normalizedPayload.trim();
                      if (plainAnswer) {
                          studentAnswers[singleStepKey] = plainAnswer;
                      }
                  }
              }

              const aiStepMap = new Map(
                  (cachedAiEval?.perStepResults || []).map(item => [String(item.step), item])
              );

              studentAnswerHtml = stepsForReview.map(step => {
                  // stepDetails je vždy objekt indexovaný číslem kroku jako string
                  const stepKey = String(step.num);
                  const det = stepDetails[stepKey] || stepDetails[String(parseInt(step.num, 10))] || null;
                  const rawAns = studentAnswers[stepKey];
                  const ans = rawAns !== undefined
                      ? escapeHtml(rawAns).replace(/\n/g, '<br>')
                      : (det?.skipped ? '<span style="color:var(--error, #ef4444); font-style:italic;">(přeskočeno)</span>' : '—');

                  const detHtml = det ? `
                  <div style="font-size:13px; color:var(--text-muted); margin-top:10px; border-top:1px dashed var(--border-color); padding-top:8px;">
                    <strong>Body za krok: <span style="color:var(--text-primary);">${det.points_earned} / ${det.points_max} bodů</span></strong>
                    ${det.skipped ? ' <span style="color:var(--error, #ef4444); margin-left:8px;">· (PŘESKOČENO)</span>' : ''}
                    ${det.hints_used > 0 ? ` <span style="color:var(--text-muted); margin-left:8px;">· (VYUŽITO NÁPOVĚD: ${det.hints_used})</span>` : ''}
                  </div>` : '';

                  const aiEval = aiStepMap.get(stepKey);
                  const aiHtml = aiEval ? `
                  <div style="margin-top:12px; padding:12px; background:var(--bg-panel); border:1px solid var(--border-color); border-radius:8px;">
                    <div style="font-size:13px; font-weight:bold; color:var(--text-primary); margin-bottom:10px;">
                      AI návrh hodnocení pro tento krok: ${aiEval.points} / ${aiEval.maxPoints} bodů
                    </div>

                    <div style="font-size:13px; color:var(--text-primary); margin-bottom:6px;"><strong>Poznámka pro učitele:</strong></div>
                    <div style="padding:10px 12px; background:var(--bg-status); border:1px solid var(--border-color); border-radius:6px; font-size:13px; line-height:1.5; color:var(--text-primary); white-space:pre-wrap;">${escapeHtml(aiEval.reasoning || 'Bez zdůvodnění.')}</div>

                    <div style="font-size:13px; color:var(--text-primary); margin:10px 0 6px 0;"><strong>Navrhovaná zpětná vazba pro studenta:</strong></div>
                    <div style="padding:10px 12px; background:var(--bg-status); border:1px solid var(--border-color); border-radius:6px; font-size:13px; line-height:1.5; color:var(--text-primary); white-space:pre-wrap;">${escapeHtml(aiEval.feedback || 'Bez zpětné vazby.')}</div>
                  </div>` : '';

                  return `
                  <div style="margin-bottom:16px; padding:16px; background:var(--bg-status); border-radius:8px; border:1px solid var(--border-color); box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                      <div style="font-size:14px; font-weight:bold; color:var(--btn-primary, #3b82f6); margin-bottom:8px; text-transform:uppercase;">Krok ${step.num}</div>
                      <div style="font-size:14px; margin-bottom:12px; color:var(--text-primary); line-height:1.5;">${escapeHtml(step.text)}</div>
                      ${step.correct ? `
                          <div style="font-size:11px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Správná odpověď</div>
                          <div id="cm-step-corr-${step.num}" style="border:1px solid rgba(16,185,129,0.4); border-radius:8px; overflow:hidden; margin-bottom:12px;"></div>
                      ` : ''}
                      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Odpověď studenta</div>
                      <div id="cm-step-stud-${step.num}" style="border:1px solid var(--border-color); border-radius:8px; overflow:hidden; margin-bottom:8px;"></div>
                      
                      ${(() => {
                          const sNum = step.num;
                          const codeForCM = (rawAns || "").trim();
                          const corrForCM = (step.correct || "").trim();
                          // Inicializace CM po renderu
                          _queueCmInit(() => {
                              window.ensureCodeMirrorLoaded(() => {
                                  const isDark = document.body.classList.contains('dark-mode');
                                  const initCM = (id, val) => {
                                      const el = document.getElementById(id);
                                      if (!el || el._cm) return;
                                      const _lines = val.split('\n').length;
                                      const _h = Math.min(Math.max(_lines * 19 + 32, 80), 220);
                                      el.style.height = _h + 'px';
                                      el.style.minHeight = '80px';
                                      el.style.resize = 'vertical';
                                      el.style.overflow = 'hidden';
                                      const cm = CodeMirror(el, { 
                                          value: val, mode: 'javascript', theme: isDark ? 'dracula' : 'default', 
                                          lineNumbers: true, readOnly: true, lineWrapping: true, scrollbarStyle: 'native'
                                      });
                                      cm.setSize('100%', '100%');
                                      if (window.ResizeObserver) new ResizeObserver(() => cm.refresh()).observe(el);
                                      setTimeout(() => { cm.setOption('mode', cm.getOption('mode')); cm.refresh(); }, 150);
                                      el._cm = cm;
                                  };
                                  if (corrForCM) initCM(`cm-step-corr-${sNum}`, corrForCM);
                                  initCM(`cm-step-stud-${sNum}`, codeForCM);
                              });
                          });
                          return '';
                      })()}
                      ${detHtml}
                      ${aiHtml}
                  </div>`;
              }).join('');
          }
      } else {
          const rawPayload = submission?.contentPayload || attempt.submissionNote || '';
          const isAiScenario = rawPayload.trimStart().startsWith('[AI_SCENARIO]');

          // Skryj/zobraz AI tlačítko podle typu
          if (aiBtn) {
              aiBtn.style.display = (isExactOrSequentialScenario || isAiScenario) ? 'none' : 'inline-flex';
          }

          if (isAiScenario) {
              // ── AI scénář — hezký render ──────────────────────────────────
              const totalMatch = rawPayload.match(/Celkem bodů:\s*(\d+)\s*\/\s*(\d+)/);
              const totalEarned = totalMatch ? totalMatch[1] : null;
              const totalMax    = totalMatch ? totalMatch[2] : null;
              const pct = totalEarned && totalMax ? Math.round((parseInt(totalEarned) / parseInt(totalMax)) * 100) : null;
              const grade = pct === null ? null : pct>=90?'A':pct>=80?'B':pct>=70?'C':pct>=60?'D':pct>=50?'E':'F';
              const gradeColor = window.getGradeColor(grade);

              if (totalMax) {
                  // Vynutíme přepsání globálního maxima, aby nám nepsalo "Max 40" když součet úloh je "Max 30"
                  gMax = Number(totalMax);
                  window.currentEvalMax = gMax;
              }

              // Upravený regex, který odpouští prázdná místa nebo absence čísel u hodnocení (např. [ / 10 b])
              const taskRegex = /Úkol\s+(\d+)(?:\s*\[\s*(\d*)\s*\/\s*(\d+)\s*b\s*\])?:\nOtázka:\s*([\s\S]*?)\nOdpověď:\s*([\s\S]*?)\n(?:Správná odpověď:\s*([\s\S]*?)\n)?Zpětná vazba AI:\s*([\s\S]*?)(?=\n---\n|$)/g;
              const tasks = [];
              let tm;
              while ((tm = taskRegex.exec(rawPayload)) !== null) {
                  const sNum = tm[1];
                  // Pokud učitel dříve hodnoty přepsal a uložil, vytáhneme je z cache:
                  const override = (cachedAiEval?.perStepResults || []).find(r => String(r.step) === String(sNum));

                  tasks.push({
                      num: sNum, 
                      earned: override && override.points !== undefined ? override.points : (tm[2] !== undefined && tm[2] !== '' ? Number(tm[2]) : null), 
                      max: override && override.maxPoints ? override.maxPoints : (tm[3] !== undefined && tm[3] !== '' ? Number(tm[3]) : null),
                      question:      (tm[4]||'').trim(),
                      answer:        (tm[5]||'').trim().replace(/^([A-D])\)\s*\1\)/, '$1)'),
                      correctAnswer: (tm[6]||'').trim() || null,
                      feedback:      override && override.feedback !== undefined ? override.feedback : (tm[7]||'').trim(),
                  });
              }

              const headerHtml = totalEarned ? `
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px; padding:12px 16px;
                            background:var(--bg-status); border-radius:10px; border:1px solid var(--border-color);">
                  <span style="font-size:15px; font-weight:bold; color:var(--text-primary);">Celkem: ${totalEarned} / ${totalMax} b</span>
                  ${grade ? `<span style="background:${gradeColor}; color:white; padding:2px 12px; border-radius:6px; font-size:14px; font-weight:bold;">${grade}</span>` : ''}
                  <span style="font-size:11px; color:var(--text-muted); border:1px solid var(--border-color); border-radius:6px; padding:2px 8px;">předběžné hodnocení AI</span>
                </div>` : '';

              window.updateAiScenarioFeedback = function() {
                  let newTotal = 0;
                  const ptsInputs = document.querySelectorAll('.ai-scenario-points-input');
                  ptsInputs.forEach(inp => { 
                      const raw = Number(inp.value) || 0;
                      const max = Number(inp.max) || 0;
                      // Zamezení přesáhnutí limitu
                      if (inp.value !== '' && raw > max) {
                          inp.value = '';
                          inp.style.borderColor = '#ef4444';
                          return;
                      }
                      inp.style.borderColor = '';
                      
                      const val = inp.value === '' ? null : raw;
                      if (val !== null) newTotal += val; 
                      
                      // Dynamická aktualizace barvy fixního badge v hlavičce úkolu
                      const badge = document.getElementById(`ai-scenario-badge-${inp.dataset.task}`);
                      if (badge && max > 0) {
                          const pct = val !== null ? (val / max) * 100 : 0;
                          const color = val === null ? '#6b7280' : val >= max ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
                          badge.style.color = color;
                          badge.style.borderColor = color;
                          badge.style.background = color + '22';
                          badge.textContent = `${val !== null ? val : '—'} / ${max} b`;
                      }
                  });
                  const scoreEl = document.getElementById('teacherScore');
                  if(scoreEl && ptsInputs.length > 0) {
                      scoreEl.value = newTotal;
                      scoreEl.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  
                  const fbInputs = document.querySelectorAll('.ai-scenario-feedback-input');
                  let summary = "Zpětná vazba od AI po úkolech (upraveno učitelem):\n";
                  fbInputs.forEach(inp => {
                      const tNum = inp.dataset.task;
                      const pInp = document.getElementById(`ai-scenario-points-${tNum}`);
                      const pTxt = pInp ? `${pInp.value}/${pInp.max} b` : '';
                      if(inp.value.trim()) summary += `Úkol ${tNum} (${pTxt}): ${inp.value.trim()}\n\n`;
                  });
                  const tFb = document.getElementById("teacherFeedback");
                  if(tFb && (!tFb.value || tFb.value.startsWith("Zpětná vazba od AI po úkolech"))) {
                      tFb.value = summary.trim();
                  }
              };

              const tasksHtml = tasks.map(t => {
                  const _earnedN = t.earned !== null ? t.earned : null;
                  const _maxN = t.max !== null ? t.max : 0;
                  const ep = _earnedN !== null && _maxN > 0 ? Math.round((_earnedN / _maxN) * 100) : null;
                  const _isFull = _maxN > 0 && _earnedN >= _maxN;
                  const barColor = ep === null ? '#6b7280' : _isFull ? '#10b981' : ep >= 40 ? '#f59e0b' : '#ef4444';

                  // Detekuj typ otázky
                  const q = t.question || '';
                  const isAbcd = /\bA\)/.test(q) && /\bB\)/.test(q) && /\bC\)/.test(q);
                  const isFill = /___/.test(q);
                  const isTf = !isAbcd && !isFill && /^(Pravda|Nepravda)$/.test((t.answer || '').trim());

                  // Pokud student odpověděl správně, AI nemusí vracet correctAnswer — odvodíme ji z odpovědi
                  const earnedFull = t.earned ? parseInt(t.earned) : 0;
                  const maxFull = t.max ? parseInt(t.max) : 0;
                  const studentAnsweredCorrectly = maxFull > 0 && earnedFull >= maxFull;
                  const selectedLetterForCorrect = (t.answer || '').trim().replace(/^([A-D])\).*/, '$1');
                  const correctLetter = t.correctAnswer
                    ? t.correctAnswer.trim().replace(/^([A-D])\).*/, '$1')
                    : (studentAnsweredCorrectly && selectedLetterForCorrect ? selectedLetterForCorrect : null);
                  const correctAnswers = t.correctAnswer ? t.correctAnswer.split('/').map(a => a.trim()) : [];

                  let answerHtml = '';
                  if (isAbcd) {
                      const options = [];
                      const optRegex = /\b([A-D])\)\s*(.+?)(?=\s+[B-D]\)|$)/gs;
                      let om;
                      while ((om = optRegex.exec(q)) !== null) {
                          options.push({ letter: om[1], text: om[2].trim().replace(/\s+/g,' ') });
                      }
                      const selectedLetter = (t.answer || '').trim().replace(/^([A-D])\).*/, '$1');
                      answerHtml = options.map(o => {
                          const isSelected = o.letter === selectedLetter;
                          const isCorrect = correctLetter && o.letter === correctLetter;
                          const isWrong = isSelected && correctLetter && o.letter !== correctLetter;
                          const bg = isCorrect ? 'rgba(16,185,129,0.12)' : isWrong ? 'rgba(239,68,68,0.1)' : 'var(--bg-status)';
                          const border = isCorrect ? '2px solid #10b981' : isWrong ? '2px solid #ef4444' : '1px solid var(--border-color)';
                          const prefix = isCorrect && isSelected ? '✓' : isCorrect ? '✓' : isWrong ? '✗' : '';
                          const prefixColor = isCorrect ? '#10b981' : '#ef4444';
                          return `<div style="padding:7px 12px; border-radius:6px; margin-bottom:5px; font-size:13px;
                                              background:${bg}; border:${border}; color:var(--text-primary);">
                            ${prefix ? `<strong style="color:${prefixColor}; margin-right:6px;">${prefix}</strong>` : '<span style="display:inline-block;width:16px;"></span>'}
                            <strong style="color:var(--text-muted);">${o.letter})</strong> ${escapeHtml(o.text)}
                            ${isSelected ? '<span style="font-size:11px; color:#ef4444; margin-left:6px;">(odpověď studenta)</span>' : ''}
                          </div>`;
                      }).join('');
                  } else if (isFill) {
                      const answers = (t.answer || '').split('/').map(a => a.trim());
                      let fillIdx = 0;
                      const filledQ = q.replace(/___/g, () => {
                          const studentVal = answers[fillIdx] || '?';
                          const correctVal = correctAnswers[fillIdx] || null;
                          fillIdx++;
                          const isOk = correctVal ? studentVal.toLowerCase().trim() === correctVal.toLowerCase().trim() : false;
                          const borderColor = !correctVal ? barColor : isOk ? '#10b981' : '#ef4444';
                          const bg = !correctVal ? 'transparent' : isOk ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)';
                          return `<span style="display:inline-block;padding:2px 8px;margin:0 3px;border:2px solid ${borderColor};border-radius:5px;background:${bg};color:${borderColor};font-weight:bold;font-size:13px;">${escapeHtml(studentVal)}</span>`;
                      });
                      const wrongItems = correctAnswers.map((cv, i) => {
                          const sv = answers[i] || '?';
                          const isOk = cv ? sv.toLowerCase().trim() === cv.toLowerCase().trim() : false;
                          return (!isOk && cv) ? `<span style="color:#10b981;">${escapeHtml(cv)}</span>` : null;
                      }).filter(Boolean);
                      const correctLine = wrongItems.length > 0
                          ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Správně: ${wrongItems.join(' / ')}</div>`
                          : '';
                      answerHtml = `<div style="font-size:13px;color:var(--text-primary);line-height:2.2;padding:10px 12px;background:var(--bg-status);border-radius:8px;border:1px solid var(--border-color);">${filledQ}${correctLine}</div>`;
                  } else if (isTf) {
                      const studentTf = (t.answer || '').trim();
                      const correctTf = t.correctAnswer ? t.correctAnswer.trim() : (studentAnsweredCorrectly ? studentTf : null);
                      const tfCorrect = !correctTf || studentTf === correctTf;
                      answerHtml = `
                        <div style="display:flex; gap:10px; flex-wrap:wrap;">
                          ${['Pravda', 'Nepravda'].map(val => {
                            const isSelected = studentTf === val;
                            const isCorrectVal = correctTf === val;
                            const bg = isCorrectVal ? 'rgba(16,185,129,0.12)' : 'var(--bg-status)';
                            const border = isCorrectVal ? '2px solid #10b981' : '1px solid var(--border-color)';
                            const icon = isCorrectVal ? '✓' : '';
                            return `<div style="flex:1; min-width:120px; padding:10px 14px; border-radius:8px; font-size:14px; font-weight:bold;
                                        background:${bg}; border:${border}; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                              ${icon ? `<strong style="color:#10b981;">${icon}</strong>` : '<span style="display:inline-block;width:14px;"></span>'}
                              ${escapeHtml(val)}
                              ${isSelected ? '<span style="font-size:11px; color:#ef4444; font-weight:normal; margin-left:4px;">(odpověď studenta)</span>' : ''}
                            </div>`;
                          }).join('')}
                        </div>`;
                  } else {
                      const ansText = t.answer || '(bez odpovědi)';
                      const cmId = `cm-ai-stud-${t.num}`;
                      answerHtml = `<div id="${cmId}" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden;margin-bottom:8px;"></div>`;
                      
                      _queueCmInit(() => {
                          window.ensureCodeMirrorLoaded(() => {
                              const el = document.getElementById(cmId);
                              if (!el || el._cm) return;
                              const _lines = ansText.split('\n').length;
                              // Omezení odpovědi studenta na max 10 řádků (~220px)
                              const _h = Math.min(Math.max(_lines * 19 + 32, 60), 220);
                              el.style.height = _h + 'px';
                              el.style.minHeight = '60px';
                              el.style.resize = 'vertical';
                              el.style.overflow = 'hidden';
                              const isDark = document.body.classList.contains('dark-mode');
                              const cm = CodeMirror(el, { 
                                  value: ansText, 
                                  mode: 'javascript', 
                                  theme: isDark ? 'dracula' : 'default', 
                                  lineNumbers: true, 
                                  readOnly: true, 
                                  lineWrapping: true,
                                  scrollbarStyle: 'native'
                              });
                              cm.setSize('100%', '100%');
                              if (window.ResizeObserver) new ResizeObserver(() => cm.refresh()).observe(el);
                              setTimeout(() => { cm.setOption('mode', cm.getOption('mode')); cm.refresh(); }, 150);
                              el._cm = cm;
                          });
                      });

                      if (t.correctAnswer) {
                          const cmCorrId = `cm-ai-corr-${t.num}`;
                          answerHtml += `<div style="font-size:11px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:0.5px;margin-top:12px;margin-bottom:6px;">Správná odpověď</div>
                          <div id="${cmCorrId}" style="border:1px solid rgba(16,185,129,0.4);border-radius:8px;overflow:hidden;"></div>`;
                          
                          _queueCmInit(() => {
                              window.ensureCodeMirrorLoaded(() => {
                                  const elC = document.getElementById(cmCorrId);
                                  if (!elC || elC._cm) return;
                                  const _linesC = t.correctAnswer.split('\n').length;
                                  // Omezení správné odpovědi na max 5 řádků (~120px)
                                  const _hC = Math.min(Math.max(_linesC * 19 + 32, 60), 120);
                                  elC.style.height = _hC + 'px';
                                  elC.style.minHeight = '60px';
                                  elC.style.resize = 'vertical';
                                  elC.style.overflow = 'hidden';
                                  const isDark = document.body.classList.contains('dark-mode');
                                  const cmC = CodeMirror(elC, { 
                                      value: t.correctAnswer, 
                                      mode: 'javascript', 
                                      theme: isDark ? 'dracula' : 'default', 
                                      lineNumbers: true, 
                                      readOnly: true, 
                                      lineWrapping: true,
                                      scrollbarStyle: 'native'
                                  });
                                  cmC.setSize('100%', '100%');
                                  if (window.ResizeObserver) new ResizeObserver(() => cmC.refresh()).observe(elC);
                                  setTimeout(() => { cmC.setOption('mode', cmC.getOption('mode')); cmC.refresh(); }, 150);
                                  elC._cm = cmC;
                              });
                          });
                      }
                  }

                  // Zpracování otázky s podporou CodeMirror pro vložený kód
                  let questionDisplayHtml = '';
                  const rawQ = isAbcd
                      ? q.replace(/\s*[A-D]\)\s*.+?(?=[A-D]\)|$)/gs, '').trim()
                      : isFill ? ''
                      : q;

                  if (rawQ) {
                      // Hledá bloky začínající ``` (např. ```python) a končící ```
                      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
                      let lastIdx = 0;
                      let match;
                      let qParts = [];
                      let cmCounter = 0;
                      
                      while ((match = codeBlockRegex.exec(rawQ)) !== null) {
                          if (match.index > lastIdx) {
                              qParts.push(`<div style="font-size:13px; color:var(--text-primary); line-height:1.6; margin-bottom:10px; white-space: pre-wrap;">${escapeHtml(rawQ.substring(lastIdx, match.index))}</div>`);
                          }
                          const lang = match[1] || 'javascript';
                          const code = match[2].trim();
                          const cmId = `cm-ai-q-${t.num}-${cmCounter++}`;
                          
                          qParts.push(`<div id="${cmId}" style="border:1px solid var(--border-color); border-radius:8px; overflow:hidden; margin-bottom:10px;"></div>`);
                          
                          _queueCmInit(() => {
                              window.ensureCodeMirrorLoaded(() => {
                                  const el = document.getElementById(cmId);
                                  if (!el || el._cm) return;
                                  const _lines = code.split('\n').length;
                                  const _h = Math.min(Math.max(_lines * 19 + 32, 60), 220); // max 10 řádků
                                  el.style.height = _h + 'px';
                                  el.style.minHeight = '60px';
                                  el.style.resize = 'vertical';
                                  el.style.overflow = 'hidden';
                                  const isDark = document.body.classList.contains('dark-mode');
                                  const cm = CodeMirror(el, { 
                                      value: code, mode: lang === 'python' ? 'python' : 'javascript', theme: isDark ? 'dracula' : 'default', 
                                      lineNumbers: true, readOnly: true, lineWrapping: true, scrollbarStyle: 'native'
                                  });
                                  cm.setSize('100%', '100%');
                                  if (window.ResizeObserver) new ResizeObserver(() => cm.refresh()).observe(el);
                                  setTimeout(() => { cm.setOption('mode', cm.getOption('mode')); cm.refresh(); }, 150);
                                  el._cm = cm;
                              });
                          });
                          
                          lastIdx = match.index + match[0].length;
                      }
                      if (lastIdx < rawQ.length) {
                          qParts.push(`<div style="font-size:13px; color:var(--text-primary); line-height:1.6; margin-bottom:10px; white-space: pre-wrap;">${escapeHtml(rawQ.substring(lastIdx))}</div>`);
                      }
                      questionDisplayHtml = qParts.join('');
                  }

                  const feedbackHtml = `<div style="margin-top:12px;">
                      <label style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;">Zpětná vazba od AI pro studenta (lze upravit):</label>
                      <textarea id="ai-scenario-feedback-${t.num}" class="ai-scenario-feedback-input" data-task="${t.num}" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border-color);border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;background:rgba(59,130,246,0.07);color:var(--text-primary);font-size:13px;line-height:1.5;resize:vertical;min-height:60px;box-sizing:border-box;" oninput="window.updateAiScenarioFeedback()">${escapeHtml(t.feedback || '')}</textarea>
                  </div>`;
                  
                  // Nové políčko pro body (přesunuté dolů jako u NE-AI úloh)
                  const pointsHtml = t.max !== null ? `<div style="margin-top:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <span style="font-size:13px;font-weight:600;color:var(--text-primary);">Body za úkol:</span>
                      <input type="number" id="ai-scenario-points-${t.num}" class="ai-scenario-points-input" data-task="${t.num}" value="${t.earned !== null ? t.earned : ''}" max="${t.max}"
                          min="0"
                          placeholder="0–${t.max}"
                          style="width:70px;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;background:var(--bg-input);color:var(--text-primary);"
                          oninput="window.updateAiScenarioFeedback()">
                      <span style="font-size:13px;color:var(--text-muted);">/ ${t.max} b</span>
                  </div>` : '';

                  return `
                    <div style="border:1px solid var(--border-color); border-radius:10px; overflow:hidden; margin-bottom:12px;">
                      <div style="background:var(--bg-status); padding:10px 14px; border-bottom:1px solid var(--border-color);
                                  display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:bold; font-size:13px; color:var(--text-primary);">Úkol ${t.num}</span>
                        ${t.max !== null ? `<span id="ai-scenario-badge-${t.num}" style="font-size:14px; font-weight:bold; color:${barColor};
                          border:2px solid ${barColor}; border-radius:8px; padding:2px 12px;
                          background:${barColor}22;">${t.earned !== null ? t.earned : '—'} / ${t.max} b</span>` : ''}
                      </div>
                      <div style="padding:12px 14px;">
                        ${questionDisplayHtml ? `
                        <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:4px;">Otázka</div>
                        ${questionDisplayHtml}` : ''}
                        <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:6px;">Odpověď studenta</div>
                        ${answerHtml}
                        ${feedbackHtml}
                        ${pointsHtml}
                      </div>
                    </div>`;
              }).join('');

              studentAnswerHtml = `
                <div style="margin-bottom:15px;">
                  <h4 style="margin:0 0 12px 0; color:var(--text-primary); font-size:15px;">Odevzdané řešení studenta:</h4>
                  ${headerHtml}${tasksHtml || `<div style="color:var(--text-muted); font-size:13px;">Nepodařilo se parsovat odpovědi.</div>`}
                </div>`;

              setTimeout(() => {
                  if(typeof window.updateAiScenarioFeedback === 'function') {
                      window.updateAiScenarioFeedback();
                  }
              }, 100);

              // Nastav score z AI hodnocení pokud není uloženo
              if (totalEarned && !score.value) {
                  score.value = totalEarned;
                  const scoreHintEl = document.getElementById("evalScoreSuggestHint");
                  if (scoreHintEl) {
                      scoreHintEl.style.display = "block";
                      scoreHintEl.innerText = `Celkový součet bodů ze všech kroků: ${totalEarned} / ${totalMax}`;
                  }
              }

          } else {
              studentAnswerHtml = `
              <div style="margin-bottom:15px;">
                  <h4 style="margin:0 0 8px 0; color:var(--text-primary); font-size:15px;">Zadání úkolu:</h4>
                  <div style="font-size:14px; line-height:1.5; margin-bottom:18px; color:var(--text-primary); background:var(--bg-status); padding:16px; border-radius:8px; border:1px solid var(--border-color);">${finalInstructions.replace(/\n/g, '<br>')}</div>
                  <h4 style="margin:0 0 8px 0; color:var(--text-primary); font-size:15px;">Odevzdané řešení studenta:</h4>
                  <div style="padding:16px; background:var(--bg-panel); border:2px solid #3b82f6; border-radius:8px; white-space:pre-wrap; font-family:monospace; font-size:14px; color:var(--text-primary); min-height:90px; box-shadow:inset 0 2px 4px rgba(0,0,0,0.05);">${escapeHtml(rawPayload || "Student neodevzdal žádné textové řešení.")}</div>
              </div>`;
          }
      }

      preview.innerHTML = `
        <div style="margin-bottom: 25px; border: 2px solid #3b82f6; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
            <div style="background: #3b82f6; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 16px; font-weight: bold; color: white; display: flex; align-items: center; gap: 8px;">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    Hodnocený pokus (Odpovědi)
                </span>
                <span style="font-size: 12px; color: #1e3a8a; font-weight: bold; background: white; padding: 4px 10px; border-radius: 12px;">Varianta ${variantNum} — ${scenarioTypeLabel}</span>
            </div>
            <div style="padding: 20px; background: var(--bg-panel);">
                ${studentAnswerHtml}
            </div>
        </div>
      `;

      // Spusť všechny CM inity až po vložení do DOM
      setTimeout(() => { _cmInitQueue.forEach(fn => fn()); }, 60);

      // Dynamické vložení historie pod textová pole učitele (ale před tlačítko Uložit)
      let histContainer = document.getElementById("evaluationHistoryContainer");
      if (!histContainer) {
          histContainer = document.createElement("div");
          histContainer.id = "evaluationHistoryContainer";
          const evalStatus = document.getElementById("evaluationStatus");
          evalStatus.parentNode.insertBefore(histContainer, evalStatus);
      }
      histContainer.innerHTML = historyHtml;

      feedback.value = cachedAiEval?.aggregateFeedback || parsedStoredEval.visibleFeedback || feedback.value || "";

      // Obnov image body z uložených metadat při re-otevření (aby validace neblokovala uložení)
      const _savedImagePoints = parsedStoredEval.aiEval?.imagePoints || cachedAiEval?.imagePoints || {};
      if (Object.keys(_savedImagePoints).length > 0) {
          setTimeout(() => {
              Object.entries(_savedImagePoints).forEach(([sNum, pts]) => {
                  const inp = document.getElementById(`step-points-input-${sNum}`);
                  if (inp && inp.dataset.image === 'true' && (inp.value === '' || inp.value === '0')) {
                      inp.value = String(pts);
                      inp.dispatchEvent(new Event('input', { bubbles: true }));
                  }
              });
              // Přepočítej celkové skóre po obnově image bodů
              if (typeof window.recalcStructuredScore === 'function') window.recalcStructuredScore();
          }, 150);
      }


      const teacherSavedScore = (attempt.score !== null && attempt.score !== undefined && String(attempt.score).trim() !== '') ? Number(attempt.score) : null;

      // Backend neukládá score na submission — spočítej z contentPayload
      let autoSuggestedScore = null;
      let autoSuggestedTotal = null;
      const rawForScore = submission?.contentPayload || '';
      if (rawForScore) {
          let earned = 0; let total = 0; let hasData = false;
          const normalizedForScore = rawForScore.replace(/(?=Krok\s+\d+:)/g, '\n').trim();
          normalizedForScore.split(/\\n|\n/).forEach(line => {
              const m = line.match(/\[(\d+)\/(\d+)\s*b/);
              if (m) { earned += parseInt(m[1]); total += parseInt(m[2]); hasData = true; }
          });
          if (hasData && total > 0) { autoSuggestedScore = earned; autoSuggestedTotal = total; }
      }

      score.value = teacherSavedScore ?? cachedAiEval?.totalPoints ?? autoSuggestedScore ?? "";

      const scoreHintEl = document.getElementById("evalScoreSuggestHint");
      if (scoreHintEl) {
          if (hasStructuredTaskConfig && window._structuredStrictMax > 0) {
              scoreHintEl.style.display = "block";
              scoreHintEl.innerText = `Celkový součet bodů za striktní úlohy: ${window._structuredStrictTotal} / ${window._structuredStrictMax}`;
          } else if (autoSuggestedScore != null) {
              scoreHintEl.style.display = "block";
              const displayMax = autoSuggestedTotal ?? gMax;
              scoreHintEl.innerText = `Celkový součet bodů ze všech kroků: ${autoSuggestedScore} / ${displayMax}`;
          } else {
              scoreHintEl.style.display = "none";
          }
      }
      
      window.currentEvalStyle = gStyle;
      window.currentEvalMax = gMax;

      const labelEl = document.getElementById("evalScoreLabel");
      const inputEl = document.getElementById("teacherScore");
      if (gStyle === 'percent') {
          labelEl.innerText = "Hodnocení v procentech (0 - 100 %):";
          inputEl.max = 100;
          inputEl.placeholder = "např. 85";
          inputEl.style.display = "block";
      } else if (gStyle === 'none') {
          labelEl.innerText = "Zadání je bez bodového hodnocení (vyplňte pouze slovní zpětnou vazbu).";
          inputEl.style.display = "none";
          inputEl.value = "";
      } else {
          labelEl.innerText = `Udělené body (max ${gMax}):`;
          inputEl.max = gMax;
          inputEl.placeholder = `např. ${Math.floor(gMax/2)}`;
          inputEl.style.display = "block";
      }

      // Dynamická známka vedle score inputu
      let gradeBadgeEl = document.getElementById("evalGradeBadge");
      if (!gradeBadgeEl) {
          gradeBadgeEl = document.createElement("span");
          gradeBadgeEl.id = "evalGradeBadge";
          gradeBadgeEl.style.cssText = "font-size:14px;font-weight:bold;padding:2px 12px;border-radius:999px;margin-left:10px;display:inline-block;vertical-align:middle;";
          inputEl.insertAdjacentElement('afterend', gradeBadgeEl);
      }
      gradeBadgeEl.textContent = '';
      gradeBadgeEl.style.display = 'none';
      // Obal input + badge do flex řádku pokud ještě není
      if (!document.getElementById("evalScoreRow")) {
          const wrapper = document.createElement("div");
          wrapper.id = "evalScoreRow";
          wrapper.style.cssText = "display:flex;align-items:center;gap:0;";
          inputEl.parentNode.insertBefore(wrapper, inputEl);
          wrapper.appendChild(inputEl);
          wrapper.appendChild(gradeBadgeEl);
      }
      // Načti PASS_THRESHOLD ze zadání
      const _thresholdM = (hintsStr || '').match(/\[PASS_THRESHOLD:(\d+)\]/);
      const _passThreshold = _thresholdM ? parseInt(_thresholdM[1], 10) : null;

      const _updateGradeBadge = (val) => {
          if (gStyle === 'none') {
              gradeBadgeEl.style.display = 'none'; return;
          }
          if (val === '' || val === null || val === undefined) val = 0;
          gradeBadgeEl.className = 'badge';
          gradeBadgeEl.style.display = 'inline-block';
          gradeBadgeEl.style.border = '';
          gradeBadgeEl.style.color = 'white';

          if (_passThreshold !== null) {
              const _numVal = Number(val);
              const _pct = gStyle === 'percent' ? _numVal : (gMax > 0 ? Math.round((_numVal / gMax) * 100) : 0);
              const _passed = _pct >= _passThreshold;
              gradeBadgeEl.style.background = _passed ? '#10b981' : '#ef4444';
              gradeBadgeEl.textContent = _passed ? `✓ Splněno (${_pct} %)` : `✗ Nesplněno (${_pct} %)`;
          } else {
              const grade = window.getGradeFromScore(val, { style: gStyle, max: gMax });
              const color = window.getGradeColor(grade);
              gradeBadgeEl.style.background = color;
              gradeBadgeEl.textContent = grade;
          }
      };
      // score.value se nastavuje až po tomto bloku — zavolej update po mikrotasku
      setTimeout(() => _updateGradeBadge(inputEl.value), 0);
      inputEl.oninput = () => _updateGradeBadge(inputEl.value);

      if (!selectedSubmissionId) {
        status.style.color = "#b91c1c";
        status.innerText = "K tomuto pokusu chybí data o odevzdání (submission). Hodnocení nelze uložit.";
        saveBtn.disabled = true;
      }
    }

     let currentOpenScenarioParams = null; 

    async function saveEvaluation() {
      const status = document.getElementById("evaluationStatus");
      // Vynutit přepočet AI scenario bodů do teacherScore před čtením
      if (typeof window.updateAiScenarioFeedback === 'function') window.updateAiScenarioFeedback();
      const visibleFeedback = document.getElementById("teacherFeedback").value.trim();
      const scoreRaw = document.getElementById("teacherScore").value.trim();

      if (!selectedSubmissionId) {
        showToast("Chybí submissionId. Hodnocení nelze uložit.", true);
        return;
      }

      // Validace: image kroky musí mít zadané body
      const missingInputs = Array.from(document.querySelectorAll('[data-image="true"]'))
          .filter(inp => inp.value === '' || inp.value === null);
      if (missingInputs.length > 0) {
          missingInputs.forEach(inp => {
              const stepNum = inp.dataset.step;
              const box = document.getElementById(`step-box-${stepNum}`);
              if (box) box.style.outline = '2px solid #ef4444';
              setTimeout(() => { if (box) box.style.outline = ''; }, 3000);
          });
          missingInputs[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          showToast(`⚠ Ohodnoťte ${missingInputs.length > 1 ? `${missingInputs.length} kroky s obrázkem` : 'krok s obrázkem'} před uložením.`, true);
          return;
      }
      
      if (scoreRaw !== "") {
          const s = Number(scoreRaw);
          if (window.currentEvalStyle === 'percent' && (s < 0 || s > 100)) {
              showToast("Chyba: Procenta musí být v rozsahu 0 až 100.", true); return;
          }
          if (window.currentEvalStyle === 'points' && (s < 0 || s > window.currentEvalMax)) {
              showToast(`Chyba: Maximum bodů pro toto zadání je ${window.currentEvalMax}.`, true); return;
          }
      }

      // Okamžitě zablokuj tlačítko a všechna akční tlačítka v tabulce
      document.getElementById("saveEvaluationBtn").disabled = true;
      document.querySelectorAll('#attemptsTableBody button').forEach(btn => {
          btn.disabled = true;
          btn.style.opacity = '0.4';
      });
      showToast("Ukládám hodnocení...");

      try {
        // Přečti aktuální per-krok body a zpětné vazby z DOM inputů
        const imagePoints = {};
        const openStepPoints = {};
        const openStepFeedbacks = {};
        
        // Standardní úkoly
        document.querySelectorAll('[id^="step-points-input-"]').forEach(inp => {
            if (inp.dataset.strict === 'true') return;
            const sNum = inp.dataset.step;
            if (inp.dataset.image === 'true') {
                if (inp.value !== '') imagePoints[sNum] = Number(inp.value) || 0;
            } else {
                if (inp.value !== '') openStepPoints[sNum] = Number(inp.value) || 0;
            }
        });
        
        // AI scénáře (nově přidáno pro uložení přepsaných bodů učitelem)
        document.querySelectorAll('.ai-scenario-points-input').forEach(inp => {
            const sNum = inp.dataset.task;
            if (inp.value !== '') openStepPoints[sNum] = Number(inp.value) || 0;
        });

        // Standardní zpětná vazba
        document.querySelectorAll('[id^="step-feedback-input-"]').forEach(ta => {
            const sNum = ta.id.replace('step-feedback-input-', '');
            if (ta.value.trim()) openStepFeedbacks[sNum] = ta.value.trim();
        });
        
        // AI scénáře zpětná vazba (nově přidáno)
        document.querySelectorAll('.ai-scenario-feedback-input').forEach(ta => {
            const sNum = ta.dataset.task;
            if (ta.value.trim()) openStepFeedbacks[sNum] = ta.value.trim();
        });

        let existingAiCache = window.currentAiEvaluationByAttempt?.[selectedAttemptId] || null;
        // Aktualizuj perStepResults z DOM (učitel mohl body upravit ručně)
        const updatedPerStepResults = (existingAiCache?.perStepResults || []).map(r => ({
            ...r,
            points: openStepPoints[String(r.step)] !== undefined ? openStepPoints[String(r.step)] : r.points,
            feedback: openStepFeedbacks[String(r.step)] !== undefined ? openStepFeedbacks[String(r.step)] : r.feedback,
        }));
        // Přidej kroky které jsou v DOM ale ne v cache (např. po ručním zadání bez AI)
        Object.entries(openStepPoints).forEach(([sNum, pts]) => {
            if (!updatedPerStepResults.find(r => String(r.step) === sNum)) {
                updatedPerStepResults.push({
                    step: Number(sNum),
                    points: pts,
                    maxPoints: Number(document.getElementById(`step-points-input-${sNum}`)?.max || document.getElementById(`ai-scenario-points-${sNum}`)?.max || 0),
                    feedback: openStepFeedbacks[sNum] || '',
                    reasoning: ''
                });
            }
        });

        existingAiCache = {
            ...(existingAiCache || {}),
            perStepResults: updatedPerStepResults,
            imagePoints: Object.keys(imagePoints).length > 0 ? imagePoints : (existingAiCache?.imagePoints || {})
        };
        const storedFeedbackText = buildStoredFeedbackWithAiMeta(visibleFeedback, existingAiCache);

        // Sbírej i striktní kroky — učitel mohl body přepsat ručně
        const strictStepPoints = {};
        document.querySelectorAll('[id^="step-points-input-"]').forEach(inp => {
            if (inp.dataset.strict !== 'true') return;
            const sNum = inp.dataset.step;
            if (inp.value !== '') strictStepPoints[sNum] = Number(inp.value) || 0;
        });

        // Sestav aktualizovaný step_details JSON ze VŠECH DOM inputů (strict + open + image)
        let updatedStepDetailsJson = null;
        try {
            const _existingSD = JSON.parse(
                (loadedAttempts.find(a => a.attemptId === selectedAttemptId)?.stepDetails) ||
                (loadedSubmissions.find(s => s.attemptId === selectedAttemptId)?.step_details) || '[]'
            );
            // Aplikuj všechny typy kroků — strict, open, image
            const _allStepPoints = { ...strictStepPoints, ...openStepPoints, ...imagePoints };
            Object.entries(_allStepPoints).forEach(([sNum, pts]) => {
                const idx = _existingSD.findIndex(d => String(d.step) === String(sNum));
                if (idx >= 0) {
                    _existingSD[idx] = { ..._existingSD[idx], points_earned: pts };
                } else {
                    _existingSD.push({ step: Number(sNum), points_earned: pts, points_max: Number(document.getElementById(`step-points-input-${sNum}`)?.max || 0) });
                }
            });
            if (_existingSD.length > 0) updatedStepDetailsJson = JSON.stringify(_existingSD);
        } catch { }

        const payload = {
          feedbackText: storedFeedbackText,
          score: scoreRaw === "" ? null : Number(scoreRaw),
          ...(updatedStepDetailsJson ? { stepDetails: updatedStepDetailsJson } : {})
        };

        const res = await fetch(`${API_BASE}/submissions/${selectedSubmissionId}/evaluate`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());

        // Po úspěšném uložení invaliduj in-memory cache pro tento pokus,
        // aby se při příštím openEvaluation načetla čerstvá data z feedbackText metadat
        if (window.currentAiEvaluationByAttempt && selectedAttemptId) {
          delete window.currentAiEvaluationByAttempt[selectedAttemptId];
        }

        document.getElementById("saveEvaluationBtn").disabled = false;
        showToast("Hodnocení bylo úspěšně uloženo.");
        document.getElementById("evaluationPanel").style.display = "none";
        await loadAttempts(true);
      } catch (err) {
        document.getElementById("saveEvaluationBtn").disabled = false;
        showToast("Nepodařilo se uložit hodnocení: " + err.message, true);
      }
    }

    window.evaluateWithAI = async function() {
        if (!selectedAttemptId || !selectedSubmissionId) {
            showToast("Není vybrán žádný pokus k hodnocení.", true);
            return;
        }

        const btn = document.getElementById("btnAiEvaluate");
        const originalText = btn.innerHTML;
        btn.innerHTML = `Hodnotím otevřené úlohy…`;
        btn.disabled = true;
        btn.style.opacity = "0.7";
        showToast("Hodnotím otevřené úlohy…");

        try {
            const attempt = loadedAttempts.find(a => a.attemptId === selectedAttemptId);
            const submission = loadedSubmissions.find(s => s.attemptId === selectedAttemptId);
            const scenario = window.allLoadedScenariosForAttempts?.find(s => s.scenarioId === attempt?.scenarioId);

            if (!attempt || !scenario) {
                throw new Error("Nepodařilo se dohledat pokus nebo zadání.");
            }

            const studentAnswer = submission?.contentPayload || attempt?.submissionNote || "";
            const taskInstructions = scenario?.instructions || "";
            const hintsStr = scenario?.hints || "";

            const currentRunNum = attempt.runNumber || 1;
            const mappedVariantMatch = hintsStr.match(new RegExp(`\\[\\s*MAP${currentRunNum}\\s*:([\\s\\S]*?)\\]`));
            const variantNum = mappedVariantMatch ? parseInt(mappedVariantMatch[1], 10) : currentRunNum;

            let currentInstructions = taskInstructions;
            const variantBlockRx = new RegExp(`\\[VARIANT${variantNum}\\]([\\s\\S]*?)\\[\\/VARIANT${variantNum}\\]`);
            const variantMatch = taskInstructions.match(variantBlockRx);
            if (variantMatch) currentInstructions = variantMatch[1];

            const parseStudentAnswersFromPayload = (rawPayload) => {
                const normalizedPayload = String(rawPayload || "").replace(/\r\n/g, '\n');
                const stepStartRegex = /^Krok\s+(\d+):\s*/gm;

                const starts = [];
                let match;
                while ((match = stepStartRegex.exec(normalizedPayload)) !== null) {
                    starts.push({
                        stepNum: String(match[1]),
                        markerStart: match.index,
                        contentStart: match.index + match[0].length
                    });
                }

                // FALLBACK: Pokud student poslal čistý text bez prefixu "Krok X:" (např. u jednokrokové úlohy)
                if (starts.length === 0 && normalizedPayload.trim()) {
                    return { "1": normalizedPayload.trim() };
                }

                const answers = {};
                starts.forEach((item, idx) => {
                    const contentEnd = idx + 1 < starts.length ? starts[idx + 1].markerStart : normalizedPayload.length;
                    let answerText = normalizedPayload.slice(item.contentStart, contentEnd).trim();

                    const scoreMatch = answerText.match(/\s*\[(\d+)\/(\d+)\s*b(?:[^\]]*nápověd[^:]*:\s*(\d+))?[^\]]*\]\s*$/);
                    if (scoreMatch) {
                        answerText = answerText.replace(scoreMatch[0], '').trim();
                    }

                    answers[item.stepNum] = answerText;
                });

                return answers;
            };

            const distributePoints = (totalPoints, count) => {
                const safeTotal = Math.max(0, Number(totalPoints) || 0);
                const safeCount = Math.max(1, Number(count) || 1);

                const base = Math.floor(safeTotal / safeCount);
                const remainder = safeTotal % safeCount;

                return Array.from({ length: safeCount }, (_, i) => base + (i < remainder ? 1 : 0));
            };

            // Nový strukturovaný formát — hodnotíme pouze open a code kroky
            try {
                if (scenario?.taskConfigJson) {
                    const parsedCfg = JSON.parse(scenario.taskConfigJson);
                    const variants = Array.isArray(parsedCfg?.variants) ? parsedCfg.variants : [];
                    const chosenVar = variants.find(v => Number(v?.variantNo) === variantNum) || variants[0];
                    const allTasks = Array.isArray(chosenVar?.tasks) ? chosenVar.tasks : [];
                    const gradableTasks = allTasks
                        .map((task, idx) => ({ task, stepNum: idx + 1 }))
                        .filter(({ task }) => ['open', 'code'].includes(String(task?.type || '').toLowerCase()));

                    // stepDetails dostupné pro obě větve (open i čistě striktní)
                    let stepDetails = {};
                    try {
                        const sd = JSON.parse(submission?.step_details || attempt.step_details || '[]');
                        if (Array.isArray(sd) && sd.length > 0) sd.forEach(d => { stepDetails[String(d.step)] = d; });
                    } catch(e) {}
                    if (Object.keys(stepDetails).length === 0) {
                        const _payload = submission?.contentPayload || attempt.submissionNote || '';
                        const _rx = /^Krok\s+(\d+):\s*/gm;
                        const _starts = [];
                        let _m;
                        while ((_m = _rx.exec(_payload)) !== null) _starts.push({ n: _m[1], pos: _m.index + _m[0].length, marker: _m.index });
                        _starts.forEach((it, i) => {
                            const end = i + 1 < _starts.length ? _starts[i+1].marker : _payload.length;
                            let ans = _payload.slice(it.pos, end).trim().replace(/\s*\[\d+\/\d+\s*b[^\]]*\]\s*$/, '').trim();
                            stepDetails[it.n] = { step: parseInt(it.n), answer: ans };
                        });
                    }

                    if (gradableTasks.length > 0) {

                        // Zkontroluj image úkoly bez bodů
                        const _imageStepsNeedingPoints = allTasks
                            .map((t, idx) => ({ t, idx: idx+1 }))
                            .filter(({ t }) => String(t?.type||'').toLowerCase() === 'image' && Number(t?.points||0) > 0)
                            .filter(({ idx }) => {
                                const inp = document.getElementById(`step-points-input-${idx}`);
                                return !inp || inp.value === '' || inp.value === '0' && !inp.dataset.strict;
                            });
                        if (_imageStepsNeedingPoints.length > 0) {
                            const _nums = _imageStepsNeedingPoints.map(x => x.idx).join(', ');
                            showToast(`⚠ Nelze spustit AI hodnocení — nejprve zadejte body pro úkol${_imageStepsNeedingPoints.length > 1 ? 'y' : ''} č. ${_nums} (obrázky AI neumí hodnotit).`, true);
                            return;
                        }

                        const perStepResults = [];
                        for (const { task, stepNum } of gradableTasks) {
                            const det = stepDetails[String(stepNum)];
                            const studentStepAnswer = det?.answer || '(bez odpovědi)';
                            const maxPts = Number(task.points || 0) || Math.floor((window.currentEvalMax || 10) / gradableTasks.length) || 5;
                            const rubric = task.rubric || task.solutionText || '';

                            const res = await fetch(`${API_BASE}/api/ai/evaluate-step`, {
                                method: "POST",
                                headers: getHeaders(),
                                body: JSON.stringify({ question: task.prompt || '', answer: studentStepAnswer, maxPoints: maxPts, rubric })
                            });
                            if (!res.ok) throw new Error(`AI chyba u kroku ${stepNum}: ${await res.text()}`);
                            const aiResult = await res.json();
                            perStepResults.push({ step: stepNum, maxPoints: maxPts, points: Number(aiResult.points || 0), reasoning: aiResult.reasoning || '', feedback: aiResult.feedback || '' });
                        }

                        const totalPoints = perStepResults.reduce((s, x) => s + x.points, 0);
                        const totalMaxPoints = perStepResults.reduce((s, x) => s + x.maxPoints, 0);
                        // Syntéza celkové zpětné vazby
                        let aggregateFeedback = '';
                        try {
                            const _openMap = {};
                            perStepResults.forEach(x => { _openMap[String(x.step)] = x; });
                            // Počítej ze DOM inputů + AI výsledků — jediný spolehlivý zdroj před recalc
                            const _totalEarned = allTasks.reduce((s, t, idx) => {
                                const sNum = String(idx + 1);
                                const _open = _openMap[sNum];
                                if (_open) return s + _open.points;
                                const inp = document.getElementById(`step-points-input-${sNum}`);
                                return s + (inp && inp.value !== '' ? Math.max(0, Number(inp.value)||0) : 0);
                            }, 0);
                            const _totalMax = allTasks.reduce((s,t) => s + Number(t?.points||0), 0);
                            const _allLines = [`Celkové skóre studenta: ${_totalEarned} / ${_totalMax} bodů\n`].concat(allTasks.map((t, idx) => {
                                const sNum = String(idx + 1);
                                const _type = String(t?.type || '').toLowerCase();
                                const _pts = Number(t?.points || 0);
                                const _det = stepDetails[sNum];
                                const _open = _openMap[sNum];
                                if (_type === 'image') {
                                    const _imgInp = document.getElementById(`step-points-input-${sNum}`);
                                    const _imgPts = _imgInp && _imgInp.value !== '' ? Number(_imgInp.value) : null;
                                    return _imgPts !== null ? `Krok ${sNum}: ${_imgPts}/${_pts} b` : null;
                                }
                                if (_open) return `Krok ${sNum} (${_open.points}/${_open.maxPoints} b, otevřená): ${_open.feedback}`;
                                if (_det) {
                                    const _ans = (_det.answer || '(bez odpovědi)').slice(0, 80);
                                    // Přednostně vezmi points_earned z window._structuredStepDetails (nastaven při renderování z dat serveru)
                                    const _sdDet = window._structuredStepDetails?.[sNum];
                                    const _earned = _sdDet?.points_earned ?? _det.points_earned;
                                    if (_earned !== null && _earned !== undefined && _pts > 0) {
                                        return `Krok ${sNum} (${_earned}/${_pts} b, ${_type}): "${_ans}" — ${_earned >= _pts ? 'správně' : 'špatně'}.`;
                                    } else if (_det.answer) {
                                        return `Krok ${sNum} (${_type}): student odpověděl "${_ans}".`;
                                    }
                                }
                                return null;
                            })).filter(Boolean).join('\n');
                            const synthRes = await fetch(`${API_BASE}/api/ai/synthesize-feedback`, {
                                method: 'POST', headers: getHeaders(),
                                body: JSON.stringify({ feedbacks: _allLines })
                            });
                            if (synthRes.ok) { const synthData = await synthRes.json(); aggregateFeedback = synthData.feedback || ''; }
                        } catch { }

                        window.currentAiEvaluationByAttempt = window.currentAiEvaluationByAttempt || {};
                        window.currentAiEvaluationByAttempt[selectedAttemptId] = { perStepResults, totalPoints, totalMaxPoints, aggregateFeedback };

                        // Ulož image body před překreslením (openEvaluation resetuje DOM)
                        const _savedImageVals = {};
                        allTasks.forEach((t, idx) => {
                            if (String(t?.type||'').toLowerCase() === 'image') {
                                const inp = document.getElementById(`step-points-input-${idx+1}`);
                                if (inp && inp.value !== '') _savedImageVals[idx+1] = inp.value;
                            }
                        });

                        if (typeof openEvaluation === "function") openEvaluation(selectedAttemptId);

                        // Doplň AI body a zpětnou vazbu do per-krok inputů/textboxů
                        perStepResults.forEach(r => {
                            const ptsInp = document.getElementById(`step-points-input-${r.step}`);
                            if (ptsInp && ptsInp.dataset.strict !== 'true') {
                                const _pts = Math.max(0, Number(r.points) || 0);
                                ptsInp.value = _pts;
                                // Aktualizuj badge barvu pro open/code kroky
                                const _max = Number(ptsInp.max || 0);
                                const _badge = document.getElementById(`step-score-badge-${r.step}`);
                                if (_badge) {
                                    const _color = _pts >= _max ? '#10b981' : _pts > 0 ? '#f59e0b' : '#ef4444';
                                    _badge.style.color = _color;
                                    _badge.style.borderColor = _color;
                                    _badge.style.background = _color + '22';
                                    _badge.textContent = `${_pts} / ${_max} b`;
                                }
                            }
                            const fbTa = document.getElementById(`step-feedback-input-${r.step}`);
                            if (fbTa && r.feedback) fbTa.value = r.feedback;
                        });

                        // Obnov image body po překreslení + aktualizuj jejich badge
                        Object.entries(_savedImageVals).forEach(([stepNum, val]) => {
                            const inp = document.getElementById(`step-points-input-${stepNum}`);
                            if (inp) {
                                inp.value = val;
                                const _max = Number(inp.max || 0);
                                const _v = Math.max(0, Math.min(_max, Number(val)||0));
                                const _badge = document.getElementById(`step-score-badge-${stepNum}`);
                                if (_badge) {
                                    const _color = _v >= _max ? '#10b981' : _v > 0 ? '#f59e0b' : '#ef4444';
                                    _badge.style.color = _color;
                                    _badge.style.borderColor = _color;
                                    _badge.style.background = _color + '22';
                                    _badge.textContent = `${_v} / ${_max} b`;
                                }
                            }
                        });

                        if (typeof window.recalcStructuredScore === 'function') window.recalcStructuredScore();
                        showToast(`AI ohodnotilo ${gradableTasks.length} otevřený${gradableTasks.length > 1 ? 'ch' : ''} krok${gradableTasks.length > 1 ? 'ů' : ''}. Zkontrolujte a uložte.`);
                        return;
                    } else {
                        // Žádné otevřené úkoly — jen vygeneruj celkovou zpětnou vazbu
                        try {
                            const _strictLines = allTasks.map((t, idx) => {
                                const sNum = String(idx + 1);
                                const _det = stepDetails[sNum];
                                const _pts = Number(t?.points || 0);
                                const _earned = _det?.points_earned ?? null;
                                const _ans = _det?.answer || '(bez odpovědi)';
                                if (_earned !== null && _pts > 0) {
                                    return `Krok ${sNum} (${_earned}/${_pts} b): "${_ans.slice(0,80)}" — ${_earned >= _pts ? 'správně' : 'špatně'}.`;
                                }
                                return `Krok ${sNum}: "${_ans.slice(0,80)}"`;
                            }).filter(Boolean).join('\n');
                            const _totalStrict = allTasks.reduce((s, t) => s + Number(t?.points || 0), 0);
                            const _earnedStrict = allTasks.reduce((s, t, idx) => {
                                const _det = stepDetails[String(idx + 1)];
                                return s + Number(_det?.points_earned ?? 0);
                            }, 0);
                            const _ctx = `Celkové skóre studenta: ${_earnedStrict} / ${_totalStrict} bodů\n${_strictLines}`;
                            const synthRes = await fetch(`${API_BASE}/api/ai/synthesize-feedback`, {
                                method: 'POST', headers: getHeaders(),
                                body: JSON.stringify({ feedbacks: _ctx })
                            });
                            if (!synthRes.ok) throw new Error('Chyba syntézy');
                            const synthData = await synthRes.json();
                            const fbEl = document.getElementById('teacherFeedback');
                            if (fbEl) fbEl.value = synthData.feedback || '';
                            showToast('Celková zpětná vazba vygenerována. Zkontrolujte a uložte.');
                        } catch(e) {
                            showToast('Nepodařilo se vygenerovat zpětnou vazbu: ' + e.message, true);
                        }
                        return;
                    }
                }
            } catch(structErr) {
                if (structErr.message?.includes('AI chyba')) throw structErr;
                // Jinak fallback na starý [STEP] formát
            }

            const stepBlocks = [];
            const stepRx = /\[STEP(\d+)\s*\]([\s\S]*?)\[\/STEP\1\s*\]/gi;
            let sm;

            while ((sm = stepRx.exec(currentInstructions)) !== null) {
                const stepNum = sm[1];
                const stepText = sm[2].trim();

                const rubricMatch = currentInstructions.match(new RegExp(`\\[RUBRIC${stepNum}\\]([\\s\\S]*?)\\[\\/RUBRIC${stepNum}\\]`, 'i'));
                const solTextMatch = currentInstructions.match(new RegExp(`\\[SOLUTION_TEXT${stepNum}\\]([\\s\\S]*?)\\[\\/SOLUTION_TEXT${stepNum}\\]`, 'i'));

                stepBlocks.push({
                    step: parseInt(stepNum, 10),
                    text: stepText,
                    rubric: rubricMatch ? rubricMatch[1].trim() : '',
                    solutionText: solTextMatch ? solTextMatch[1].trim() : ''
                });
            }

            if (stepBlocks.length === 0) {
                let rubricText = "";
                const rubricMatch = currentInstructions.match(/\[RUBRIC\d*\]([\s\S]*?)\[\/RUBRIC\d*\]/);
                if (rubricMatch) rubricText = rubricMatch[1].trim();

                const solutionMatch = currentInstructions.match(/\[SOLUTION_TEXT\d*\]([\s\S]*?)\[\/SOLUTION_TEXT\d*\]/);
                if (solutionMatch) {
                    rubricText += `${rubricText ? '\n\n' : ''}Správné řešení:\n${solutionMatch[1].trim()}`;
                }

                const cleanQuestion = currentInstructions
                    .replace(/\[VARIANT_SOLUTION\][\s\S]*?\[\/VARIANT_SOLUTION\]/gi, '')
                    .replace(/\[SOLUTION_TEXT\d+\][\s\S]*?\[\/SOLUTION_TEXT\d+\]/gi, '')
                    .replace(/\[SOL\d+\][\s\S]*?\[\/SOL\d+\]/gi, '')
                    .replace(/\[PTS\d+\][\s\S]*?\[\/PTS\d+\]/gi, '')
                    .replace(/\[SKIP\d+\][\s\S]*?\[\/SKIP\d+\]/gi, '')
                    .replace(/\[HINTS\d+\][\s\S]*?\[\/HINTS\d+\]/gi, '')
                    .replace(/\[STEP\d+\]/gi, '')
                    .replace(/\[\/STEP\d+\]/gi, '')
                    .trim();

                const payload = {
                    question: cleanQuestion,
                    answer: studentAnswer,
                    maxPoints: window.currentEvalMax || 10,
                    rubric: rubricText
                };

                const res = await fetch(`${API_BASE}/api/ai/evaluate-step`, {
                    method: "POST",
                    headers: getHeaders(),
                    body: JSON.stringify(payload)
                });

                if (!res.ok) throw new Error("Chyba při komunikaci s AI: " + await res.text());

                const aiResult = await res.json();

                const finalStudentFeedback = String(aiResult.feedback || "Bez zpětné vazby.").trim();

                window.currentAiEvaluationByAttempt = window.currentAiEvaluationByAttempt || {};
                window.currentAiEvaluationByAttempt[selectedAttemptId] = {
                    perStepResults: [],
                    totalPoints: aiResult.points !== undefined ? Number(aiResult.points) : null,
                    totalMaxPoints: window.currentEvalMax || 10,
                    aggregateFeedback: finalStudentFeedback
                };

                if (typeof openEvaluation === "function") {
                    openEvaluation(selectedAttemptId);
                } else {
                    document.getElementById("teacherScore").value = aiResult.points !== undefined ? aiResult.points : "";
                    document.getElementById("teacherFeedback").value = finalStudentFeedback;
                }

                showToast("AI hodnocení úspěšně vloženo. Můžete jej upravit a uložit.");
                return;
            }

            const studentAnswersByStep = parseStudentAnswersFromPayload(studentAnswer);
            const stepPointLimits = distributePoints(window.currentEvalMax || 10, stepBlocks.length);

            const perStepResults = [];
            for (let i = 0; i < stepBlocks.length; i += 1) {
                const stepBlock = stepBlocks[i];
                const maxPointsForStep = stepPointLimits[i];
                const studentStepAnswer = studentAnswersByStep[String(stepBlock.step)] || "";

                let rubricForStep = stepBlock.rubric || "";
                if (stepBlock.solutionText) {
                    rubricForStep += `${rubricForStep ? '\n\n' : ''}Správné řešení:\n${stepBlock.solutionText}`;
                }

                const payload = {
                    question: stepBlock.text,
                    answer: studentStepAnswer || "(bez odpovědi)",
                    maxPoints: maxPointsForStep,
                    rubric: rubricForStep
                };

                const res = await fetch(`${API_BASE}/api/ai/evaluate-step`, {
                    method: "POST",
                    headers: getHeaders(),
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    throw new Error(`Chyba při AI hodnocení kroku ${stepBlock.step}: ${await res.text()}`);
                }

                const aiResult = await res.json();

                perStepResults.push({
                    step: stepBlock.step,
                    maxPoints: maxPointsForStep,
                    points: Number(aiResult.points || 0),
                    reasoning: aiResult.reasoning || "Bez zdůvodnění.",
                    feedback: aiResult.feedback || "Bez zpětné vazby."
                });
            }

            const totalPoints = perStepResults.reduce((sum, item) => sum + item.points, 0);
            const totalMaxPoints = perStepResults.reduce((sum, item) => sum + item.maxPoints, 0);

            const cleanedStudentFeedbacks = perStepResults
                .map(item => `Krok ${item.step} (${item.points}/${item.maxPoints} b): ${item.feedback || "Bez textu"}`)
                .filter(text => text.length > 0);

            let finalStudentFeedback = "Bez zpětné vazby.";
            
            if (cleanedStudentFeedbacks.length === 1) {
                // Pokud je jen jeden krok, použijeme rovnou jeho vazbu
                finalStudentFeedback = perStepResults[0].feedback || "Bez zpětné vazby.";
            } else if (cleanedStudentFeedbacks.length > 1) {
                // Pokud je kroků více, necháme AI vygenerovat syntézu
                try {
                    const synthRes = await fetch(`${API_BASE}/api/ai/synthesize-feedback`, {
                        method: "POST",
                        headers: getHeaders(),
                        body: JSON.stringify({ feedbacks: cleanedStudentFeedbacks.join("\n") })
                    });
                    
                    if (!synthRes.ok) throw new Error("Chyba při syntéze zpětné vazby.");
                    const synthData = await synthRes.json();
                    finalStudentFeedback = synthData.feedback || "Bez zpětné vazby.";
                } catch {
                    finalStudentFeedback = "Hodnocení po krocích uloženo, ale celkové shrnutí se nepodařilo vygenerovat.";
                }
            }

            window.currentAiEvaluationByAttempt = window.currentAiEvaluationByAttempt || {};
            window.currentAiEvaluationByAttempt[selectedAttemptId] = {
                perStepResults,
                totalPoints,
                totalMaxPoints,
                aggregateFeedback: finalStudentFeedback
            };

            if (typeof openEvaluation === "function") {
                openEvaluation(selectedAttemptId);
            } else {
                document.getElementById("teacherScore").value = totalPoints;
                document.getElementById("teacherFeedback").value = finalStudentFeedback;
            }

            showToast("AI hodnocení po jednotlivých úkolech bylo úspěšně vloženo.");

        } catch (err) {
            showToast("Nepodařilo se získat AI hodnocení: " + err.message, true);
        } finally {
            btn.innerHTML = `Nechat AI ohodnotit otevřené úlohy`;
            btn.disabled = false;
            btn.style.opacity = "1";
        }
    };