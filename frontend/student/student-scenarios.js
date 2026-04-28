

window.getScenarioVariantNumber = function(scenario, runNumber) {
    const safeRunNumber = Number(runNumber) || 1;
    const hints = scenario?.hints || "";
    const mappedVariantMatch = hints.match(new RegExp(`\\[\\s*MAP${safeRunNumber}\\s*:([\\s\\S]*?)\\]`));
    const mappedVariant = mappedVariantMatch ? parseInt(mappedVariantMatch[1], 10) : null;
    return Number.isFinite(mappedVariant) && mappedVariant > 0 ? mappedVariant : safeRunNumber;
};

window.resolveStructuredTaskConfig = function(scenario, variantNum) {
    if (!scenario?.taskConfigJson) return null;

    try {
        const parsed = JSON.parse(scenario.taskConfigJson);
        const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
        if (!variants.length) return null;

        const chosenVariant = variants.find(v => Number(v?.variantNo) === Number(variantNum)) || variants[0];
        const tasks = Array.isArray(chosenVariant?.tasks) ? chosenVariant.tasks : [];
        return {
            version: parsed?.version || 1,
            variantNo: Number(chosenVariant?.variantNo) || Number(variantNum) || 1,
            tasks: tasks
        };
    } catch {
        return null;
    }
};

window.getStructuredTaskAttemptKey = function(scenarioId, attemptId, variantNum) {
    if (attemptId) return attemptId;
    return `preview_${scenarioId}_${variantNum}`;
};

window.getStructuredTaskDraftStorageKey = function(scenarioId, attemptKey, variantNum) {
    return `structured_task_draft_v1_${scenarioId}_${attemptKey}_${variantNum}`;
};

window.getStructuredTaskLayoutStorageKey = function(scenarioId, attemptKey, variantNum, taskIndex) {
    return `structured_task_layout_v1_${scenarioId}_${attemptKey}_${variantNum}_${taskIndex}`;
};

window.getStructuredTaskPageStorageKey = function(scenarioId, attemptKey, variantNum) {
    return `structured_task_page_v1_${scenarioId}_${attemptKey}_${variantNum}`;
};

window.ensureStructuredTaskUiStyles = function() {
    if (document.getElementById('structured-task-inline-styles')) return;

    const style = document.createElement('style');
    style.id = 'structured-task-inline-styles';
    style.textContent = `
        .structured-task-page {
            display: none;
        }
        .structured-task-page.is-visible {
            display: block;
        }
        .structured-choice-card {
            transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
            text-align: left;
            user-select: none;
        }
        .structured-choice-card:hover {
            border-color: var(--primary);
            background: var(--bg-card-hover);
        }
        .structured-choice-card.is-selected {
            border-color: var(--primary);
            background: var(--bg-card-hover);
        }
        .structured-choice-letter {
            min-width: 28px;
            text-align: left;
            font-weight: 700;
            color: var(--text-primary);
        }
        .structured-choice-text {
            flex: 1;
            min-width: 0;
            text-align: left;
            color: var(--text-primary);
            line-height: 1.5;
        }
        .structured-sort-item {
            position: relative;
            transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
            user-select: none;
        }
        .structured-sort-item.dragging {
            opacity: 0.55;
            transform: scale(0.985);
            border-color: var(--primary);
            background: var(--bg-card-hover);
            box-shadow: 0 0 0 1px var(--primary);
        }
        .structured-sort-drop-indicator {
            position: relative;
            height: 4px;
            margin: -6px 14px 2px 14px;
            pointer-events: none;
            z-index: 2;
        }
        .structured-sort-drop-indicator::before {
            content: "";
            position: absolute;
            left: 10px;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            height: 4px;
            border-radius: 999px;
            background: #60a5fa;
            opacity: 1;
        }
        .structured-sort-drop-indicator::after {
            content: "";
            position: absolute;
            left: 2px;
            top: 50%;
            transform: translateY(-50%);
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: #60a5fa;
            opacity: 1;
        }
        .structured-sort-grip {
            font-size: 16px;
            color: var(--text-muted);
            letter-spacing: 1px;
        }
        .structured-task-nav-btn[disabled] {
            opacity: 0.45;
            cursor: not-allowed;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
};

window.getStructuredCurrentTaskIndex = function(totalTasks) {
    const context = window.getStructuredDraftContext();
    if (!context) return 0;

    const storageKey = window.getStructuredTaskPageStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    const maxIndex = Math.max(0, (Number(totalTasks) || context.tasks.length || 1) - 1);
    const rawValue = parseInt(sessionStorage.getItem(storageKey) || '0', 10);

    if (!Number.isFinite(rawValue)) return 0;
    return Math.max(0, Math.min(rawValue, maxIndex));
};

window.setStructuredCurrentTaskIndex = function(index) {
    const context = window.getStructuredDraftContext();
    if (!context) return;

    const storageKey = window.getStructuredTaskPageStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    const maxIndex = Math.max(0, (context.tasks.length || 1) - 1);
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, maxIndex));

    sessionStorage.setItem(storageKey, String(safeIndex));
};

window.updateStructuredTaskBoxHeading = function(index, totalTasks) {
    const headingEl = document.getElementById('structuredTaskBoxHeading');
    if (!headingEl) return;

    const total = Number(totalTasks) || document.querySelectorAll('.structured-task-page').length || 0;
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, Math.max(0, total - 1)));

    headingEl.textContent = total > 0 ? `Úkol ${safeIndex + 1}:` : 'Úkol:';
};

window.updateStructuredChoiceVisuals = function(taskIndex) {
    document.querySelectorAll(`[data-structured-choice-task="${taskIndex}"]`).forEach(label => {
        const input = label.querySelector('input');
        label.classList.toggle('is-selected', !!input?.checked);
    });
};

window.showStructuredTaskPage = function(index) {
    const pages = Array.from(document.querySelectorAll('.structured-task-page'));
    if (!pages.length) return;

    const safeIndex = Math.max(0, Math.min(Number(index) || 0, pages.length - 1));

    pages.forEach((page, pageIndex) => {
        const isVisible = pageIndex === safeIndex;
        page.style.display = isVisible ? 'block' : 'none';
        page.classList.toggle('is-visible', isVisible);
    });

    window.setStructuredCurrentTaskIndex(safeIndex);
    window.updateStructuredTaskBoxHeading(safeIndex, pages.length);
};

window.goToStructuredTaskPage = function(index) {
    window.saveStructuredTaskDrafts();
    window.showStructuredTaskPage(index);
};

window.getStructuredSortIndicatorId = function(taskIndex) {
    return `structured-sort-drop-indicator-${taskIndex}`;
};

window.clearStructuredSortDropState = function(taskIndex) {
    const indicator = document.getElementById(window.getStructuredSortIndicatorId(taskIndex));
    if (indicator) {
        indicator.remove();
    }
};

window.setStructuredSortDropState = function(taskIndex, targetOptionId, shouldInsertBefore) {
    window.clearStructuredSortDropState(taskIndex);

    const list = document.getElementById(`structured-sort-list-${taskIndex}`);
    const targetEl = document.getElementById(`structured-sort-item-${taskIndex}-${targetOptionId}`);
    if (!list || !targetEl) return;

    const indicator = document.createElement('div');
    indicator.id = window.getStructuredSortIndicatorId(taskIndex);
    indicator.className = 'structured-sort-drop-indicator';

    list.insertBefore(indicator, shouldInsertBefore ? targetEl : targetEl.nextSibling);
};

window.shuffleStructuredArray = function(items) {
    const copy = Array.isArray(items) ? [...items] : [];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

window.getStructuredOrderedOptions = function(task, scenarioId, attemptKey, variantNum, taskIndex) {
    const options = Array.isArray(task?.options) ? task.options.filter(opt => opt && opt.id !== undefined && opt.id !== null) : [];
    if (!options.length) return [];

    if (!['abcd', 'multi', 'sort'].includes(String(task?.type || '').toLowerCase())) {
        return options;
    }

    const storageKey = window.getStructuredTaskLayoutStorageKey(scenarioId, attemptKey, variantNum, taskIndex);
    const optionIds = options.map(opt => String(opt.id));
    let storedOrder = null;

    try {
        storedOrder = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch (error) {
        storedOrder = null;
    }

    const isStoredOrderValid = Array.isArray(storedOrder)
        && storedOrder.length === optionIds.length
        && storedOrder.every(id => optionIds.includes(String(id)));

    if (!isStoredOrderValid) {
        storedOrder = window.shuffleStructuredArray(optionIds);
        sessionStorage.setItem(storageKey, JSON.stringify(storedOrder));
    }

    return storedOrder
        .map(id => options.find(opt => String(opt.id) === String(id)))
        .filter(Boolean);
};

window.findStructuredOptionById = function(task, optionId) {
    const options = Array.isArray(task?.options) ? task.options : [];
    return options.find(opt => String(opt.id) === String(optionId)) || null;
};

window.getStructuredDraftContext = function() {
    if (!window._structuredTaskMeta || !window._structuredTaskMeta.length) return null;

    const latestAttempt = latestAttemptMap?.[currentScenarioId];
    const attemptKey = window.getStructuredTaskAttemptKey(
        currentScenarioId,
        latestAttempt?.attemptId || window._structuredTaskAttemptId || null,
        window._structuredTaskVariantNo || 1
    );

    return {
        scenarioId: currentScenarioId,
        attemptKey,
        variantNum: window._structuredTaskVariantNo || 1,
        tasks: window._structuredTaskMeta
    };
};

window.readStructuredTaskAnswer = function(taskIndex, task) {
    const type = String(task?.type || '').toLowerCase();

    if (type === 'tf') {
        const checked = document.querySelector(`input[name="structured-tf-${taskIndex}"]:checked`);
        return checked ? checked.value : '';
    }

    if (type === 'abcd') {
        const checked = document.querySelector(`input[name="structured-abcd-${taskIndex}"]:checked`);
        return checked ? checked.value : '';
    }

    if (type === 'multi') {
        return Array.from(document.querySelectorAll(`input[name="structured-multi-${taskIndex}"]:checked`))
            .map(input => input.value)
            .filter(Boolean);
    }

    if (type === 'sort') {
        const list = document.getElementById(`structured-sort-list-${taskIndex}`);
        if (!list) return [];
        return Array.from(list.querySelectorAll('[data-option-id]'))
            .map(el => el.dataset.optionId)
            .filter(Boolean);
    }

    const input = document.getElementById(`structured-answer-${taskIndex}`);
    return input ? input.value.trim() : '';
};

window.saveStructuredTaskDrafts = function() {
    const context = window.getStructuredDraftContext();
    if (!context) return null;

    const draft = {
        answers: context.tasks.map((task, index) => window.readStructuredTaskAnswer(index, task))
    };

    const storageKey = window.getStructuredTaskDraftStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
    return draft;
};

window.restoreStructuredTaskDrafts = function() {
    const context = window.getStructuredDraftContext();
    if (!context) return;

    window.ensureStructuredTaskUiStyles();

    const storageKey = window.getStructuredTaskDraftStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    let saved = null;

    try {
        saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch (error) {
        saved = null;
    }

    const answers = Array.isArray(saved?.answers) ? saved.answers : [];

    context.tasks.forEach((task, index) => {
        const type = String(task?.type || '').toLowerCase();
        const answer = answers[index];

        if (type === 'tf' || type === 'abcd') {
            if (answer !== undefined && answer !== null && answer !== '') {
                const input = document.querySelector(`input[name="structured-${type}-${index}"][value="${String(answer)}"]`);
                if (input) input.checked = true;
            }
        } else if (type === 'multi') {
            const values = Array.isArray(answer) ? answer.map(String) : [];
            document.querySelectorAll(`input[name="structured-multi-${index}"]`).forEach(input => {
                input.checked = values.includes(String(input.value));
            });
        } else if (type === 'sort') {
            const list = document.getElementById(`structured-sort-list-${index}`);
            const values = Array.isArray(answer) ? answer.map(String) : [];
            if (list && values.length) {
                values.forEach(optionId => {
                    const item = list.querySelector(`[data-option-id="${optionId}"]`);
                    if (item) list.appendChild(item);
                });
                window.refreshStructuredSortNumbers(index);
            }
        } else {
            const input = document.getElementById(`structured-answer-${index}`);
            if (input && typeof answer === 'string') {
                input.value = answer;
                // Pokud existuje CM instance pro tento index, nastav hodnotu i tam
                const cm = window._studentCmInstances?.[String(index)];
                if (cm) cm.setValue(answer);
            }
        }

        if (['tf', 'abcd', 'multi'].includes(type)) {
            window.updateStructuredChoiceVisuals(index);
        }
    });

    window.showStructuredTaskPage(window.getStructuredCurrentTaskIndex(context.tasks.length));
};

window.clearStructuredTaskDrafts = function() {
    const context = window.getStructuredDraftContext();
    if (!context) return;

    const storageKey = window.getStructuredTaskDraftStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    sessionStorage.removeItem(storageKey);
};

window.normalizeStructuredText = function(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
};

window.evaluateStructuredTaskAnswer = function(task, rawAnswer) {
    const type = String(task?.type || '').toLowerCase();
    const pointsMax = Number(task?.points || 0);

    if (type === 'flag') {
        const acceptedAnswers = [task?.solution, ...(Array.isArray(task?.alternatives) ? task.alternatives : [])]
            .map(answer => window.normalizeStructuredText(answer))
            .filter(Boolean);

        if (!acceptedAnswers.length) return null;
        return acceptedAnswers.includes(window.normalizeStructuredText(rawAnswer))
            ? { pointsEarned: pointsMax, completed: true }
            : { pointsEarned: 0, completed: !!String(rawAnswer || '').trim() };
    }

    if (type === 'tf') {
        if (!String(task?.correctValue || '').trim()) return null;
        return String(rawAnswer) === String(task.correctValue)
            ? { pointsEarned: pointsMax, completed: true }
            : { pointsEarned: 0, completed: !!String(rawAnswer || '').trim() };
    }

    if (type === 'abcd') {
        const correctOption = (Array.isArray(task?.options) ? task.options : []).find(option => option.correct);
        if (!correctOption) return null;
        return String(rawAnswer) === String(correctOption.id)
            ? { pointsEarned: pointsMax, completed: true }
            : { pointsEarned: 0, completed: !!String(rawAnswer || '').trim() };
    }

    if (type === 'multi') {
        const correctIds = (Array.isArray(task?.options) ? task.options : [])
            .filter(option => option.correct)
            .map(option => String(option.id))
            .sort();

        if (!correctIds.length) return null;

        const selectedIds = (Array.isArray(rawAnswer) ? rawAnswer : [])
            .map(String)
            .sort();

        const isCorrect = selectedIds.length === correctIds.length
            && selectedIds.every((value, index) => value === correctIds[index]);

        return isCorrect
            ? { pointsEarned: pointsMax, completed: true }
            : { pointsEarned: 0, completed: selectedIds.length > 0 };
    }

    if (type === 'sort') {
        const correctOrder = (Array.isArray(task?.options) ? task.options : []).map(option => String(option.id));
        if (!correctOrder.length) return null;

        const currentOrder = (Array.isArray(rawAnswer) ? rawAnswer : []).map(String);
        const isCorrect = currentOrder.length === correctOrder.length
            && currentOrder.every((value, index) => value === correctOrder[index]);

        return isCorrect
            ? { pointsEarned: pointsMax, completed: true }
            : { pointsEarned: 0, completed: currentOrder.length > 0 };
    }

    return null;
};

window.formatStructuredAnswerForDisplay = function(task, rawAnswer) {
    const type = String(task?.type || '').toLowerCase();

    if (type === 'tf') {
        if (String(rawAnswer) === 'true') return 'Pravda';
        if (String(rawAnswer) === 'false') return 'Nepravda';
        return '(bez odpovědi)';
    }

    if (type === 'abcd') {
        const option = window.findStructuredOptionById(task, rawAnswer);
        return option?.text ? option.text : '(bez odpovědi)';
    }

    if (type === 'multi') {
        const values = Array.isArray(rawAnswer) ? rawAnswer : [];
        if (!values.length) return '(bez odpovědi)';
        const texts = values
            .map(optionId => window.findStructuredOptionById(task, optionId)?.text || optionId)
            .filter(Boolean);
        return texts.length ? texts.join(', ') : '(bez odpovědi)';
    }

    if (type === 'sort') {
        const values = Array.isArray(rawAnswer) ? rawAnswer : [];
        if (!values.length) return '(bez odpovědi)';
        const texts = values
            .map(optionId => window.findStructuredOptionById(task, optionId)?.text || optionId)
            .filter(Boolean);
        return texts.length ? texts.join(' → ') : '(bez odpovědi)';
    }

    return String(rawAnswer || '').trim() || '(bez odpovědi)';
};

window.collectStructuredTaskSubmission = function(scenario) {
    const latestAttempt = latestAttemptMap?.[currentScenarioId];
    const runNumber = latestAttempt?.runNumber || 1;
    const variantNum = window.getScenarioVariantNumber(scenario, runNumber);
    const structuredConfig = window.resolveStructuredTaskConfig(scenario, variantNum);

    if (!structuredConfig?.tasks?.length) return null;

    const savedDraft = window.saveStructuredTaskDrafts();
    const answers = Array.isArray(savedDraft?.answers) ? savedDraft.answers : structuredConfig.tasks.map(() => '');

    const stepDetails = structuredConfig.tasks.map((task, index) => {
        const rawAnswer = answers[index];
        const evaluation = window.evaluateStructuredTaskAnswer(task, rawAnswer);
        const formattedAnswer = window.formatStructuredAnswerForDisplay(task, rawAnswer);
        const answered = Array.isArray(rawAnswer)
            ? rawAnswer.length > 0
            : !!String(rawAnswer || '').trim();

        return {
            step: index + 1,
            task_type: String(task?.type || 'open').toLowerCase(),
            task_text: task?.prompt || '',
            rubric: task?.rubric || '',
            solution_text: task?.solutionText || '',
            points_max: Number(task?.points || 0),
            points_earned: evaluation ? evaluation.pointsEarned : null,
            completed: evaluation ? evaluation.completed : answered,
            skipped: false,
            hints_used: window._structuredHintsUsed[index] || 0,
            answer: formattedAnswer,
            answer_raw: JSON.stringify(rawAnswer ?? ''),
            options_order: JSON.stringify(window.getStructuredOrderedOptions(
                task,
                currentScenarioId,
                window.getStructuredTaskAttemptKey(currentScenarioId, latestAttempt?.attemptId || null, variantNum),
                variantNum,
                index
            ).map(option => option.id))
        };
    });

    const allAutoGradable = stepDetails.length > 0 && stepDetails.every(detail => detail.points_earned !== null);
    const autoScore = allAutoGradable
        ? stepDetails.reduce((sum, detail) => sum + Number(detail.points_earned || 0), 0)
        : null;

    const contentPayload = stepDetails.map(detail => {
        const suffix = detail.points_earned !== null ? ` [${detail.points_earned}/${detail.points_max} b]` : '';
        return `Krok ${detail.step}: ${detail.answer}${suffix}`;
    }).join('\n');

    return {
        contentPayload,
        stepDetails,
        autoScore
    };
};

window.getStructuredTaskTypeLabel = function(type) {
    const normalized = String(type || '').toLowerCase();
    const map = {
        flag: 'Přesná odpověď',
        tf: 'Pravda / Nepravda',
        abcd: 'Výběr z možností',
        multi: 'Více správných možností',
        sort: 'Seřazení kroků',
        open: 'Otevřená odpověď',
        code: 'Analýza kódu',
        image: 'Práce s obrázkem'
    };
    return map[normalized] || 'Úkol';
};

window.getStructuredDisplayLetter = function(index) {
    return String.fromCharCode(65 + index);
};

window.refreshStructuredSortNumbers = function(taskIndex) {
    const list = document.getElementById(`structured-sort-list-${taskIndex}`);
    if (!list) return;

    Array.from(list.querySelectorAll('.structured-sort-position')).forEach((el, index) => {
        el.textContent = `${index + 1}.`;
    });
};

window.onStructuredAnswerChange = function(taskIndex) {
    window.saveStructuredTaskDrafts();
    if (taskIndex !== undefined && taskIndex !== null) {
        window.updateStructuredChoiceVisuals(taskIndex);
    }
};

window._structuredHintsUsed = window._structuredHintsUsed || {};

window.getStructuredHintsStorageKey = function(scenarioId, attemptKey, variantNum) {
    return `structured_task_hints_v1_${scenarioId}_${attemptKey}_${variantNum}`;
};

window.loadStructuredHintsUsed = function() {
    const context = window.getStructuredDraftContext();
    if (!context) return;
    const key = window.getStructuredHintsStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    try {
        const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (saved && typeof saved === 'object') {
            window._structuredHintsUsed = saved;
        }
    } catch (e) {
        window._structuredHintsUsed = {};
    }
};

window.saveStructuredHintsUsed = function() {
    const context = window.getStructuredDraftContext();
    if (!context) return;
    const key = window.getStructuredHintsStorageKey(context.scenarioId, context.attemptKey, context.variantNum);
    sessionStorage.setItem(key, JSON.stringify(window._structuredHintsUsed));
};

window.restoreStructuredHintsUi = function() {
    const context = window.getStructuredDraftContext();
    if (!context) return;
    window.loadStructuredHintsUsed();
    context.tasks.forEach((task, taskIndex) => {
        const hints = Array.isArray(task?.hints) ? task.hints : [];
        const used = window._structuredHintsUsed[taskIndex] || 0;
        if (!used) return;
        // Znovu vyrender všechny již použité nápovědy do logu
        const log = document.getElementById(`structured-hints-log-${taskIndex}`);
        if (log) {
            log.innerHTML = '';
            for (let i = 0; i < used && i < hints.length; i++) {
                const hint = hints[i];
                const costText = hint.cost > 0 ? ` (srážka: ${hint.cost} b)` : '';
                const div = document.createElement('div');
                div.style.cssText = 'margin-top:6px; padding:8px 12px; background:var(--bg-status); border-left:3px solid #f59e0b; border-radius:0 6px 6px 0; font-size:13px; color:var(--text-primary);';
                div.innerHTML = `<strong style="color:#f59e0b;">Nápověda ${i + 1}${costText}:</strong> ${escapeHtml(hint.text)}`;
                log.appendChild(div);
            }
        }
        const remaining = hints.length - used;
        const countEl = document.getElementById(`structured-hint-count-${taskIndex}`);
        if (countEl) countEl.textContent = remaining;
        if (remaining === 0) {
            const btn = document.getElementById(`structured-hint-btn-${taskIndex}`);
            if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
        }
    });
};

window.showStructuredHint = function(taskIndex) {
    const context = window.getStructuredDraftContext();
    if (!context) return;
    const task = context.tasks[taskIndex];
    const hints = Array.isArray(task?.hints) ? task.hints : [];
    if (!hints.length) return;

    const used = window._structuredHintsUsed[taskIndex] || 0;
    if (used >= hints.length) {
        showToast('Byly zobrazeny všechny dostupné nápovědy.', true);
        return;
    }

    const hint = hints[used];
    const costText = hint.cost > 0 ? ` (srážka: ${hint.cost} b)` : '';

    customConfirm(
        `Zobrazit nápovědu č. ${used + 1}${costText}? Zbývá ${hints.length - used} nápověd.`,
        () => {
            window._structuredHintsUsed[taskIndex] = used + 1;
            window.saveStructuredHintsUsed();
            const log = document.getElementById(`structured-hints-log-${taskIndex}`);
            if (log) {
                const div = document.createElement('div');
                div.style.cssText = 'margin-top:6px; padding:8px 12px; background:var(--bg-status); border-left:3px solid #f59e0b; border-radius:0 6px 6px 0; font-size:13px; color:var(--text-primary);';
                div.innerHTML = `<strong style="color:#f59e0b;">Nápověda ${used + 1}${costText}:</strong> ${escapeHtml(hint.text)}`;
                log.appendChild(div);
            }
            const countEl = document.getElementById(`structured-hint-count-${taskIndex}`);
            const remaining = hints.length - window._structuredHintsUsed[taskIndex];
            if (countEl) countEl.textContent = remaining;
            if (remaining === 0) {
                const btn = document.getElementById(`structured-hint-btn-${taskIndex}`);
                if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
            }
            window.saveStructuredTaskDrafts();
        }
    );
};

window.handleStructuredSortDragStart = function(event, taskIndex, optionId) {
    event.dataTransfer.setData('text/plain', String(optionId));
    event.dataTransfer.effectAllowed = 'move';

    const item = document.getElementById(`structured-sort-item-${taskIndex}-${optionId}`);
    if (item) {
        item.classList.add('dragging');
    }

    window.clearStructuredSortDropState(taskIndex);
};

window.handleStructuredSortDragEnd = function(event, taskIndex, optionId) {
    const item = document.getElementById(`structured-sort-item-${taskIndex}-${optionId}`);
    if (item) {
        item.classList.remove('dragging');
    }

    window.clearStructuredSortDropState(taskIndex);
    window.refreshStructuredSortNumbers(taskIndex);
    window.saveStructuredTaskDrafts();
};

window.handleStructuredSortDragOver = function(event, taskIndex, targetOptionId) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const targetEl = document.getElementById(`structured-sort-item-${taskIndex}-${targetOptionId}`);
    if (!targetEl) return;

    const targetRect = targetEl.getBoundingClientRect();
    const relativeY = event.clientY - targetRect.top;
    const shouldInsertBefore = relativeY < (targetRect.height / 2);

    window.setStructuredSortDropState(taskIndex, targetOptionId, shouldInsertBefore);
};

window.handleStructuredSortDrop = function(event, taskIndex, targetOptionId) {
    event.preventDefault();

    const draggedOptionId = event.dataTransfer.getData('text/plain');
    if (!draggedOptionId) return;

    const list = document.getElementById(`structured-sort-list-${taskIndex}`);
    const draggedEl = document.getElementById(`structured-sort-item-${taskIndex}-${draggedOptionId}`);
    const targetEl = document.getElementById(`structured-sort-item-${taskIndex}-${targetOptionId}`);
    const indicator = document.getElementById(window.getStructuredSortIndicatorId(taskIndex));

    if (!list || !draggedEl || !targetEl || draggedEl === targetEl) {
        window.clearStructuredSortDropState(taskIndex);
        window.refreshStructuredSortNumbers(taskIndex);
        window.saveStructuredTaskDrafts();
        return;
    }

    const shouldInsertBefore = !!indicator && indicator.nextSibling === targetEl;
    const insertBeforeNode = shouldInsertBefore
        ? targetEl
        : (indicator ? indicator.nextSibling : targetEl.nextSibling);

    list.insertBefore(draggedEl, insertBeforeNode);

    window.clearStructuredSortDropState(taskIndex);
    window.refreshStructuredSortNumbers(taskIndex);
    window.saveStructuredTaskDrafts();
};

window.ensureStudentCodeMirror = function() {
    if (window._studentCmLoaded) return Promise.resolve();
    if (window._studentCmLoading) return window._studentCmLoading;

    window._studentCmLoading = new Promise(resolve => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.css';
        document.head.appendChild(css);

        const theme = document.createElement('link');
        theme.rel = 'stylesheet';
        theme.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/theme/dracula.min.css';
        document.head.appendChild(theme);

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.js';
        script.onload = () => {
            const modes = ['python','javascript','php','clike','shell'];
            let loaded = 0;
            const onDone = () => { if (++loaded === modes.length) { window._studentCmLoaded = true; resolve(); } };
            modes.forEach(m => {
                const s = document.createElement('script');
                s.src = `https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/${m}/${m}.min.js`;
                s.onload = onDone;
                s.onerror = onDone;
                document.head.appendChild(s);
            });
        };
        script.onerror = () => resolve();
        document.head.appendChild(script);
    });
    return window._studentCmLoading;
};

window.initStudentCodeEditors = function() {
    window.ensureStudentCodeMirror().then(() => {
        const isDark = document.body.classList.contains('dark-mode');
        const theme = isDark ? 'dracula' : 'default';
        const hasCM = typeof window.CodeMirror === 'function';

        // Snippet (readonly) — pokud CM nedostupný, zobraz kód v <pre>
        document.querySelectorAll('[id^="student-cm-snippet-"]').forEach(host => {
            if (host.dataset.cmReady) return;
            host.dataset.cmReady = '1';
            const snippet = host.dataset.snippet || '';
            if (!hasCM) {
                host.innerHTML = `<pre style="margin:0;padding:10px 14px;font-size:13px;overflow-x:auto;white-space:pre-wrap;color:var(--text-primary);">${escapeHtml ? escapeHtml(snippet) : snippet.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
                return;
            }
            const cm = CodeMirror(host, {
                value: snippet,
                mode: 'python',
                theme,
                lineNumbers: true,
                readOnly: true,
                lineWrapping: true,
                scrollbarStyle: 'native'
            });
            cm.setSize('100%', 'auto');
            setTimeout(() => cm.refresh(), 150);
        });

        // Answer editor — pokud CM nedostupný, zobraz textarea jako viditelný fallback
        document.querySelectorAll('[id^="student-cm-answer-"]').forEach(host => {
            if (host.dataset.cmReady) return;
            host.dataset.cmReady = '1';
            const idx = host.id.replace('student-cm-answer-', '');
            const textarea = document.getElementById(`structured-answer-${idx}`);
            if (!hasCM) {
                if (textarea) {
                    textarea.style.display = 'block';
                    textarea.style.width = '100%';
                    textarea.style.minHeight = '180px';
                    textarea.style.padding = '10px 14px';
                    textarea.style.fontFamily = 'monospace';
                    textarea.style.fontSize = '13px';
                    textarea.style.boxSizing = 'border-box';
                }
                return;
            }
            const cm = CodeMirror(host, {
                value: textarea ? textarea.value : '',
                mode: 'python',
                theme,
                lineNumbers: true,
                lineWrapping: true,
                scrollbarStyle: 'native',
                extraKeys: { Tab: cm => cm.execCommand('indentMore') }
            });
            cm.setSize('100%', '180px');
            cm.on('change', () => {
                if (textarea) {
                    textarea.value = cm.getValue();
                    window.onStructuredAnswerChange(parseInt(idx));
                }
            });
            if (!window._studentCmInstances) window._studentCmInstances = {};
            window._studentCmInstances[idx] = cm;
            setTimeout(() => cm.refresh(), 150);
        });
    });
};

window.getCodeLanguageLabel = function(code) {
    if (!code) return "Problematický kód:";
    const c = code.toLowerCase();
    if (c.includes("def ") || c.includes("import ") || c.includes("print(")) return "Problematický kód v Pythonu:";
    if (c.includes("console.log") || c.includes("document.") || c.includes("window.")) return "Problematický kód v JavaScriptu:";
    if (c.includes("<?php")) return "Problematický kód v PHP:";
    if (c.includes("#include") || c.includes("int main(")) return "Problematický kód v C/C++:";
    if (c.includes("public class ") && c.includes("system.out.print")) return "Problematický kód v Javě:";
    if (c.includes("select ") && c.includes("from ")) return "Problematický kód v SQL:";
    if (c.includes("<html") || c.includes("<div")) return "Problematický kód v HTML:";
    if (c.includes("using system;") || c.includes("namespace ")) return "Problematický kód v C#:";
    
    return "Problematický kód:";
};

window.buildStructuredTaskMarkup = function(task, taskIndex, totalTasks, scenario, latestAttempt, variantNum, isVisible) {
    const type = String(task?.type || 'open').toLowerCase();
    const scenarioId = scenario?.scenarioId || currentScenarioId;
    const attemptKey = window.getStructuredTaskAttemptKey(scenarioId, latestAttempt?.attemptId || null, variantNum);
    const promptHtml = escapeHtml(String(task?.prompt || '')).replace(/\n/g, '<br>');
    const points = Number(task?.points || 0);
    const typeLabel = window.getStructuredTaskTypeLabel(type);

    let bodyHtml = '';

    if (type === 'flag') {
        bodyHtml = `
            <input
                type="text"
                id="structured-answer-${taskIndex}"
                placeholder="Zadejte přesnou odpověď..."
                style="width:100%; padding:12px 14px; font-size:14px; border:1px solid var(--border-color); border-radius:10px; box-sizing:border-box; background:var(--bg-status); color:var(--text-primary);"
                oninput="window.onStructuredAnswerChange(${taskIndex})"
            />`;
    } else if (type === 'tf') {
        const tfOptions = [
            { value: 'true', text: 'Pravda', label: 'A)' },
            { value: 'false', text: 'Nepravda', label: 'B)' }
        ];

        bodyHtml = `
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${tfOptions.map(option => `
                    <label
                        data-structured-choice-task="${taskIndex}"
                        class="structured-choice-card"
                        style="display:flex; align-items:flex-start; justify-content:flex-start; gap:12px; padding:14px 16px; border:1px solid var(--border-color); border-radius:10px; cursor:pointer; background:var(--bg-status);"
                    >
                        <input
                            type="radio"
                            name="structured-tf-${taskIndex}"
                            value="${option.value}"
                            onchange="window.onStructuredAnswerChange(${taskIndex})"
                            style="margin:2px 0 0 0; width:18px; height:18px; min-width:18px; flex:0 0 18px; accent-color:var(--primary);"
                        >
                        <div style="display:flex; align-items:flex-start; justify-content:flex-start; gap:12px; flex:1; min-width:0;">
                            <span class="structured-choice-letter">${option.label}</span>
                            <span class="structured-choice-text">${option.text}</span>
                        </div>
                    </label>
                `).join('')}
            </div>`;
    } else if (type === 'abcd') {
        const orderedOptions = window.getStructuredOrderedOptions(task, scenarioId, attemptKey, variantNum, taskIndex);
        bodyHtml = `
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${orderedOptions.map((option, displayIndex) => `
                    <label
                        data-structured-choice-task="${taskIndex}"
                        class="structured-choice-card"
                        style="display:flex; align-items:flex-start; justify-content:flex-start; gap:12px; padding:14px 16px; border:1px solid var(--border-color); border-radius:10px; cursor:pointer; background:var(--bg-status);"
                    >
                        <input
                            type="radio"
                            name="structured-abcd-${taskIndex}"
                            value="${escapeHtml(String(option.id))}"
                            onchange="window.onStructuredAnswerChange(${taskIndex})"
                            style="margin:2px 0 0 0; width:18px; height:18px; min-width:18px; flex:0 0 18px; accent-color:var(--primary);"
                        >
                        <div style="display:flex; align-items:flex-start; justify-content:flex-start; gap:12px; flex:1; min-width:0;">
                            <span class="structured-choice-letter">${window.getStructuredDisplayLetter(displayIndex)})</span>
                            <span class="structured-choice-text">${escapeHtml(String(option.text || ''))}</span>
                        </div>
                    </label>
                `).join('')}
            </div>`;
    } else if (type === 'multi') {
        const orderedOptions = window.getStructuredOrderedOptions(task, scenarioId, attemptKey, variantNum, taskIndex);
        bodyHtml = `
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${orderedOptions.map((option, displayIndex) => `
                    <label
                        data-structured-choice-task="${taskIndex}"
                        class="structured-choice-card"
                        style="display:flex; align-items:flex-start; justify-content:flex-start; gap:12px; padding:14px 16px; border:1px solid var(--border-color); border-radius:10px; cursor:pointer; background:var(--bg-status);"
                    >
                        <input
                            type="checkbox"
                            name="structured-multi-${taskIndex}"
                            value="${escapeHtml(String(option.id))}"
                            onchange="window.onStructuredAnswerChange(${taskIndex})"
                            style="margin:2px 0 0 0; width:18px; height:18px; min-width:18px; flex:0 0 18px; accent-color:var(--primary);"
                        >
                        <div style="display:flex; align-items:flex-start; justify-content:flex-start; gap:12px; flex:1; min-width:0;">
                            <span class="structured-choice-letter">${displayIndex + 1}.</span>
                            <span class="structured-choice-text">${escapeHtml(String(option.text || ''))}</span>
                        </div>
                    </label>
                `).join('')}
            </div>`;
    } else if (type === 'sort') {
        const orderedOptions = window.getStructuredOrderedOptions(task, scenarioId, attemptKey, variantNum, taskIndex);
        bodyHtml = `
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">Přetáhněte položky do správného pořadí</div>
            <div id="structured-sort-list-${taskIndex}" style="display:flex; flex-direction:column;">
                ${orderedOptions.map(option => `
                    <div
                        id="structured-sort-item-${taskIndex}-${escapeHtml(String(option.id))}"
                        class="structured-sort-item"
                        data-option-id="${escapeHtml(String(option.id))}"
                        draggable="true"
                        ondragstart="window.handleStructuredSortDragStart(event, ${taskIndex}, '${escapeHtml(String(option.id))}')"
                        ondragend="window.handleStructuredSortDragEnd(event, ${taskIndex}, '${escapeHtml(String(option.id))}')"
                        ondragover="window.handleStructuredSortDragOver(event, ${taskIndex}, '${escapeHtml(String(option.id))}')"
                        ondrop="window.handleStructuredSortDrop(event, ${taskIndex}, '${escapeHtml(String(option.id))}')"
                        style="display:flex; align-items:center; justify-content:flex-start; gap:12px; padding:14px 16px; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-status); color:var(--text-primary); cursor:grab; margin-bottom:8px;"
                    >
                        <span class="structured-sort-grip">⋮⋮</span>
                        <span class="structured-sort-position" style="font-weight:bold; color:var(--text-muted); min-width:24px;">1.</span>
                        <span style="flex:1; min-width:0; text-align:left; line-height:1.5;">${escapeHtml(String(option.text || ''))}</span>
                    </div>
                `).join('')}
            </div>`;
    } else if (type === 'code') {
        const langLabel = window.getCodeLanguageLabel(task?.codeSnippet);
        bodyHtml = `
            ${task?.codeSnippet ? `
                <div style="margin-bottom:12px;">
                    <div style="font-size:12px; font-weight:bold; color:var(--text-muted); margin-bottom:6px;">${escapeHtml(langLabel)}</div>
                    <div id="student-cm-snippet-${taskIndex}" style="border:1px solid var(--border-color); border-radius:10px; overflow:hidden; font-size:13px;" data-snippet="${escapeHtml(String(task.codeSnippet || ''))}"></div>
                </div>
            ` : ''}
            <div style="font-size:12px; font-weight:bold; color:var(--text-muted); margin-bottom:6px;">Vaše řešení / oprava:</div>
            <div id="student-cm-answer-${taskIndex}" style="border:1px solid var(--border-color); border-radius:10px; overflow:hidden; font-size:13px;"></div>
            <textarea
                id="structured-answer-${taskIndex}"
                style="display:none;"
                oninput="window.onStructuredAnswerChange(${taskIndex})"
            ></textarea>`;
    } else if (type === 'image') {
        bodyHtml = `
            ${task?.imageUrl ? `
                <div style="margin-bottom:12px;">
                    <img src="${escapeHtml(String(task.imageUrl || ''))}" alt="Obrázek k úkolu" style="display:block; max-width:100%; max-height:400px; width:auto; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-panel); cursor:zoom-in;" onclick="const _i=this;if(_i._zoomed){_i.style.maxHeight='400px';_i.style.width='auto';_i._zoomed=false;_i.style.cursor='zoom-in';}else{_i.style.maxHeight='none';_i.style.width='100%';_i._zoomed=true;_i.style.cursor='zoom-out';}">
                </div>
            ` : ''}
            <textarea
                id="structured-answer-${taskIndex}"
                rows="5"
                placeholder="Napište odpověď k obrázku..."
                style="width:100%; min-height:130px; padding:12px 14px; font-size:14px; border:1px solid var(--border-color); border-radius:10px; box-sizing:border-box; resize:vertical; background:var(--bg-status); color:var(--text-primary);"
                oninput="window.onStructuredAnswerChange(${taskIndex})"
            ></textarea>`;
    } else {
        bodyHtml = `
            <textarea
                id="structured-answer-${taskIndex}"
                rows="5"
                placeholder="Napište odpověď..."
                style="width:100%; min-height:130px; padding:12px 14px; font-size:14px; border:1px solid var(--border-color); border-radius:10px; box-sizing:border-box; resize:vertical; background:var(--bg-status); color:var(--text-primary);"
                oninput="window.onStructuredAnswerChange(${taskIndex})"
            ></textarea>`;
    }

    return `
        <div
            id="structured-task-page-${taskIndex}"
            class="structured-task-page${isVisible ? ' is-visible' : ''}"
            data-task-index="${taskIndex}"
            style="display:${isVisible ? 'block' : 'none'};"
        >
            <div style="border:1px solid var(--border-color); border-radius:12px; background:var(--bg-panel); padding:18px; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                    <span id="structuredTaskBoxHeading" style="font-size:15px; font-weight:700; color:var(--text-primary);">Úkol ${taskIndex + 1}:</span>
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <span style="font-size:12px; color:var(--text-muted); border:1px solid var(--border-color); border-radius:999px; padding:3px 10px; background:var(--bg-status);">
                            ${escapeHtml(typeLabel)}
                        </span>
                        ${points > 0 ? `
                            <span style="font-size:12px; color:var(--text-primary); border:1px solid var(--border-color); border-radius:999px; padding:3px 10px; background:var(--bg-status); font-weight:bold;">
                                ${points} b
                            </span>
                        ` : ''}
                        <span style="font-size:12px; color:var(--text-primary); border:1px solid var(--border-color); border-radius:999px; padding:3px 10px; background:var(--bg-status); font-weight:bold;">
                            ${taskIndex + 1} / ${totalTasks}
                        </span>
                    </div>
                </div>

                ${task?.prompt ? `
                    <div style="font-size:15px; line-height:1.7; color:var(--text-primary); margin-bottom:14px;">
                        ${promptHtml}
                    </div>
                ` : ''}

                ${bodyHtml}

                <div id="structured-hints-log-${taskIndex}" style="margin-top:8px;"></div>

                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-top:16px; padding-top:14px; border-top:1px solid var(--border-color);">
                    <button
                        type="button"
                        class="structured-task-nav-btn"
                        onclick="window.goToStructuredTaskPage(${taskIndex - 1})"
                        ${taskIndex === 0 ? 'disabled' : ''}
                        style="background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:8px; padding:8px 14px; margin:0;"
                    >
                        ← Zpět
                    </button>

                    ${Array.isArray(task?.hints) && task.hints.length > 0 ? `
                    <button
                        type="button"
                        id="structured-hint-btn-${taskIndex}"
                        onclick="window.showStructuredHint(${taskIndex})"
                        style="background:var(--bg-status); color:var(--text-muted); border:1px solid var(--border-color); border-radius:8px; padding:8px 14px; margin:0; font-size:13px;"
                    >
                        💡 Nápověda (<span id="structured-hint-count-${taskIndex}">${task.hints.length}</span>)
                    </button>` : ''}

                    <button
                        type="button"
                        class="structured-task-nav-btn"
                        onclick="window.goToStructuredTaskPage(${taskIndex + 1})"
                        ${taskIndex === totalTasks - 1 ? 'disabled' : ''}
                        style="background:var(--btn-primary); color:var(--btn-primary-text); border:none; border-radius:8px; padding:8px 14px; margin:0;"
                    >
                        Další →
                    </button>
                </div>
            </div>
        </div>`;
};

window.renderStructuredTaskList = function(tasks, scenario, latestAttempt, variantNum) {
    window.ensureStructuredTaskUiStyles();

    window._structuredTaskMeta = Array.isArray(tasks) ? tasks : [];
    window._structuredTaskVariantNo = variantNum || 1;
    window._structuredTaskAttemptId = latestAttempt?.attemptId || null;

    const totalTasks = window._structuredTaskMeta.length;
    const currentIndex = window.getStructuredCurrentTaskIndex(totalTasks);

    return `
        <div id="structured-task-pages-wrapper">
            ${window._structuredTaskMeta
                .map((task, index) => window.buildStructuredTaskMarkup(
                    task,
                    index,
                    totalTasks,
                    scenario,
                    latestAttempt,
                    window._structuredTaskVariantNo,
                    index === currentIndex
                ))
                .join('')}
        </div>
    `;
};

function renderScenarios() {
    const listEl = document.getElementById("scenariosList");

    if (!currentScenarios.length) {
    listEl.innerHTML = "<div class='muted'>V tomto kurzu nejsou žádné úlohy.</div>";
    return;
    }

    listEl.innerHTML = "";

    currentScenarios.forEach(scenario => {
    const state = computeStudentState(scenario.scenarioId);
    const latestAttempt = latestAttemptMap[scenario.scenarioId];
    const deadlineText = scenario.deadline ? formatDate(scenario.deadline) : "Bez termínu";

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = scenario.scenarioId;
    // Výpočet aktuálního pokusu pro štítky
    const allScenarioAttempts = currentAttempts.filter(a => a.scenarioId === scenario.scenarioId);
    let runNum = 1;
    if (allScenarioAttempts.length > 0) {
        const lastAtm = latestAttemptMap[scenario.scenarioId];
        if (lastAtm && lastAtm.status !== "archived") {
            runNum = lastAtm.runNumber || allScenarioAttempts.length;
        } else {
            runNum = allScenarioAttempts.length + 1;
        }
    }

    const scenarioHints = scenario.hints || "";
    const thresholdMatch = scenarioHints.match(/\[PASS_THRESHOLD:(\d+)\]/);
    const passThreshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : null;
    const gradingInfo = parseGradingInfo(scenarioHints);
    const isAutoSubmitScenario = scenarioHints.includes('[AUTO_SUBMIT:true]');
    const isAttemptsTypoCard = scenario.maxAttempts > 50;
    const usedAttemptsCard = allScenarioAttempts.filter(a => a.status !== "archived").length;
    const limitReachedCard = scenario.maxAttempts > 0 && !isAttemptsTypoCard && usedAttemptsCard >= scenario.maxAttempts;

    const hasPassedAnyAttempt = passThreshold !== null && allScenarioAttempts.some(attempt => {
        let score = attempt.score;

        if (score === null || score === undefined || score === "") {
            const relatedSubmission = currentSubmissions.find(sub => sub.attemptId === attempt.attemptId);
            score = relatedSubmission?.score;
        }

        if (score === null || score === undefined || score === "") {
            const storedPassResult = localStorage.getItem(`pass_result_${attempt.attemptId}`);
            if (storedPassResult) {
                try {
                    const parsed = JSON.parse(storedPassResult);
                    return parsed?.passed === true;
                } catch (e) {}
            }
            return false;
        }

        const numericScore = Number(score);
        const maxScore = Number(gradingInfo?.max || 0);
        if (!Number.isFinite(numericScore) || !Number.isFinite(maxScore) || maxScore <= 0) return false;

        const percent = Math.round((numericScore / maxScore) * 100);
        return percent >= passThreshold;
    });

    let translatedState = state;
    let badgeClass = state;
    if (state === "available") {
        if (limitReachedCard) {
            translatedState = "Počet pokusů vyčerpán";
        } else {
            translatedState = `K dispozici ${runNum}. pokus${hasPassedAnyAttempt ? ` <span style="color: var(--success, #22c55e);">(splněno)</span>` : ""}`;
        }
    }
    if (state === "started") translatedState = `${runNum}. pokus je rozpracován`;
    if (state === "pending_submission") {
        translatedState = `${runNum}. pokus čeká na odevzdání`;
        badgeClass = "started"; // Převezme CSS styly rozpracovaného labu
    }
    if (state === "submitted") {
        translatedState = isAutoSubmitScenario
            ? `${runNum}. pokus se vyhodnocuje`
            : `${runNum}. pokus byl odevzdán`;
        if (isAutoSubmitScenario) badgeClass = "started";
    }
    if (state === "evaluated") {
        translatedState = isAutoSubmitScenario
            ? `${runNum}. pokus byl automaticky vyhodnocen`
            : `${runNum}. pokus byl ohodnocen`;
    }

    const calIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:3px; margin-top:-1px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const _badgeClassStr = limitReachedCard ? 'badge' : `badge state-${badgeClass}`;
    const _badgeExtraStyle = limitReachedCard ? ' background: var(--bg-status); color: var(--text-muted);' : '';
    card.innerHTML = `
        <div style="font-size: 14px; font-weight: bold; line-height: 1.3; margin-bottom: 6px;">${escapeHtml(scenario.title || "Bezejmenná úloha")}</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: 11px; color: var(--text-muted);">${calIcon}${deadlineText}</span>
        <span class="${_badgeClassStr}" style="font-size: 11px; white-space: nowrap; align-self: flex-start;${_badgeExtraStyle}">${translatedState}</span>
        </div>
    `;
    // Zjisti jestli má student aktivní (neodevzdaný) pokus v JINÉ úloze
    const activeStatesForLock = ["queued", "provisioning", "running", "started", "succeeded", "finished"];
    const lockedByOtherScenarioId = currentScenarios.find(s => {
        if (s.scenarioId === scenario.scenarioId) return false;
        const atm = latestAttemptMap[s.scenarioId];
        if (!atm || atm.status === "archived") return false;
        if (!activeStatesForLock.includes(atm.status)) return false;
        const sub = currentSubmissions.find(sub => sub.attemptId === atm.attemptId);
        const isSubmitted = sub && (sub.status === "submitted" || sub.status === "evaluated")
            || atm.learningStatus === "submitted" || atm.learningStatus === "evaluated";
        return !isSubmitted;
    });

    if (lockedByOtherScenarioId) {
        card.style.cssText = "padding: 10px 14px; cursor: not-allowed; border: 1px solid var(--border-color); border-radius: 8px; transition: background 0.15s; margin-bottom: 8px; opacity: 0.45;";
        card.title = "Nejprve dokonči a odevzdej rozpracovanou úlohu.";
    } else if (limitReachedCard) {
        card.style.cssText = "padding: 10px 14px; cursor: not-allowed; border: 1px solid var(--border-color); border-radius: 8px; transition: background 0.15s; margin-bottom: 8px; opacity: 0.45;";
        card.title = "Počet pokusů byl vyčerpán.";
    } else {
        card.style.cssText = "padding: 10px 14px; cursor: pointer; border: 1px solid var(--border-color); border-radius: 8px; transition: background 0.15s; margin-bottom: 8px;";
        card.addEventListener("click", () => selectScenario(scenario.scenarioId));
    }
    listEl.appendChild(card);
    });

    document.querySelectorAll("#scenariosList .card").forEach(el => {
    el.classList.toggle("active", el.dataset.id === currentScenarioId);
    });

    // Vždy po překreslení zadání synchronizuj stav kurzů
    updateCoursesLockState();
}

function selectScenario(scenarioId) {

    // Guard: pokud má student aktivní neodevzdaný pokus v jiné úloze, přepnutí zablokuj
    const activeStatesForLock = ["queued", "provisioning", "running", "started", "succeeded", "finished"];
    for (const s of currentScenarios) {
        if (s.scenarioId === scenarioId) continue;
        const atm = latestAttemptMap[s.scenarioId];
        if (!atm || atm.status === "archived") continue;
        if (!activeStatesForLock.includes(atm.status)) continue;
        const sub = currentSubmissions.find(sub => sub.attemptId === atm.attemptId);
        const isSubmitted = (sub && (sub.status === "submitted" || sub.status === "evaluated"))
            || atm.learningStatus === "submitted" || atm.learningStatus === "evaluated";
        if (!isSubmitted) {
            showToast("Nejprve dokonči a odevzdej rozpracovanou úlohu.", true);
            return;
        }
    }

    clearPolling();
    clearPageMessage(); 
    currentScenarioId = scenarioId;
    localStorage.setItem("last_scenario_id", scenarioId);
    renderScenarios();
    renderScenarioDetail();

    const latestAttempt = latestAttemptMap[scenarioId];
    const needsPolling = ["queued", "provisioning", "running", "started", "succeeded"];
    const savedUrl = localStorage.getItem('lab_url_' + latestAttempt?.attemptId) || latestAttempt?.guiUrl;
    const alreadyHasUrl = savedUrl && (savedUrl.startsWith("http") || savedUrl === "skip");
    if (latestAttempt && needsPolling.includes(latestAttempt.status) && !alreadyHasUrl) {
    startPolling(latestAttempt.attemptId);
    }
}

async function startAiScenario() {
    const scenario = currentScenarios.find(s => s.scenarioId === currentScenarioId);
    if (!scenario) return;
    const btn = document.getElementById('startBtn');

    // Pokud scénář vyžaduje skutečný lab (ne skip) → použij normální startScenario flow
    const needsLab = scenario.requiredOs && scenario.requiredOs !== 'skip';
    if (needsLab) {
        startScenario();
        return;
    }

    // Bez labu → rovnou vytvoř pokus a spusť AI
    if (btn) { btn.disabled = true; btn.textContent = 'Připravuji…'; }
    await initAiScenarioSafe(scenario, null, 'available', currentCourseId);
    if (btn) btn.style.display = 'none';
}

function ensureAiSpinnerCss() {
    if (document.getElementById('ai-spinner-style')) return;
    const style = document.createElement('style');
    style.id = 'ai-spinner-style';
    style.textContent = `.ai-spinner{width:20px;height:20px;border:3px solid var(--border-color,#e5e7eb);border-top-color:var(--primary,#1a3a6b);border-radius:50%;animation:ai-spin 0.8s linear infinite;flex-shrink:0}@keyframes ai-spin{to{transform:rotate(360deg)}}.ai-step-hidden{display:none!important}`;
    document.head.appendChild(style);
}

async function initAiScenarioSafe(scenario, latestAttempt, state, courseId) {
    if (!window.aiScenario) return;
    if (window._aiInitRunning === scenario.scenarioId) return;
    window._aiInitRunning = scenario.scenarioId;
    console.trace('[AI-INIT] voláno pro', scenario.scenarioId, '| latestAttempt:', latestAttempt?.attemptId ?? 'NULL', '| currentAttempts:', JSON.stringify(currentAttempts.map(a => ({id:a.attemptId, sid:a.scenarioId, status:a.status}))));

    try {
        let attempt = latestAttempt;

        if (!attempt) {
            const freshAttempts = await apiGet(`/courses/${courseId}/my-attempts`);
            currentAttempts = freshAttempts;
            buildLatestAttemptMap();
            attempt = latestAttemptMap[scenario.scenarioId] || null;
        }

        if (!attempt) {
            const guardKey = `ai_attempt_creating_${scenario.scenarioId}`;
            if (sessionStorage.getItem(guardKey)) {
                await new Promise(r => setTimeout(r, 3000));
                const fresh2 = await apiGet(`/courses/${courseId}/my-attempts`);
                currentAttempts = fresh2;
                buildLatestAttemptMap();
                attempt = latestAttemptMap[scenario.scenarioId] || null;
                if (!attempt) return;
            } else {
                sessionStorage.setItem(guardKey, '1');
                try {
                    const uniqueId = Math.random().toString(16).slice(2, 10);
                    await apiPost(`/scenarios/${scenario.scenarioId}/start`, {
                        attemptId: `pokus-${uniqueId}`,
                        labImage: "skip"
                    });
                    const fresh3 = await apiGet(`/courses/${courseId}/my-attempts`);
                    currentAttempts = fresh3;
                    buildLatestAttemptMap();
                    attempt = latestAttemptMap[scenario.scenarioId] || null;
                } finally {
                    sessionStorage.removeItem(guardKey);
                }
            }
        }

        await window.aiScenario.init(scenario, attempt, state);
    } catch {
    } finally {
        window._aiInitRunning = null;
    }
}

async function renderScenarioDetail() {
    ensureAiSpinnerCss();
    window.syncInputsToSession(); // Záchrana textů před smazáním DOMu
    const detailEl = document.getElementById("scenarioDetail");
    const startBtn = document.getElementById("startBtn");
    const submitBtn = document.getElementById("submitBtn");
    const feedbackBox = document.getElementById("feedbackBox");

    if (!currentScenarioId) {
    detailEl.innerHTML = "Vyber úlohu ze seznamu.";
    startBtn.disabled = true;
    submitBtn.disabled = true;

    const submissionBlock = document.getElementById("submissionBlock");
    if (submissionBlock) submissionBlock.style.display = "block";

    return;
    }

    const scenario = currentScenarios.find(s => s.scenarioId === currentScenarioId);
    const latestAttempt = latestAttemptMap[currentScenarioId];

    const pendingScore = null; // Zpráva o odevzdání se zobrazuje přímo v submitLatestAttempt
    const sub = latestAttempt ? currentSubmissions.find(s => s.attemptId === latestAttempt.attemptId) : null;
    
    const state = computeStudentState(currentScenarioId);
    const deadlineText = scenario.deadline ? formatDate(scenario.deadline) : "Bez termínu";
    const isAttemptsTypo = scenario.maxAttempts > 50;
    const maxAttemptsText = (scenario.maxAttempts === 0 || isAttemptsTypo) ? "Neomezeně" : scenario.maxAttempts;

    // 1. Výpočet aktuálního čísla pokusu (MUSÍ BÝT PRVNÍ)
    // runNumber z backendu je autoritativní — nikdy nepoužívej allScenarioAttempts.length jako variantu
    // protože polling může vrátit různý počet pokusů a způsobit oscilaci varianty
    const allScenarioAttempts = currentAttempts.filter(a => a.scenarioId === currentScenarioId);
    let currentRunNumber = 1;
    if (latestAttempt && latestAttempt.status !== "archived") {
        currentRunNumber = latestAttempt.runNumber || 1;
    } else if (allScenarioAttempts.length > 0) {
        // Žádný aktivní pokus — jsme na dalším. Vezmi max runNumber ze všech pokusů + 1
        const maxRun = Math.max(...allScenarioAttempts.map(a => a.runNumber || 0));
        currentRunNumber = maxRun > 0 ? maxRun + 1 : allScenarioAttempts.length + 1;
    }
    // Zobrazované číslo pokusu — pozice v seznamu (archived+1), ne historické runNumber z DB
    const displayRunNumber = allScenarioAttempts.filter(a => a.status === "archived").length + 1;

    // 2. Dynamický výběr zadání podle mapování (Varianty) nebo čísla pokusu
    const getTag = (tag) => {
        const match = (scenario.hints || "").match(new RegExp(`\\[\\s*${tag}\\s*:([\\s\\S]*?)\\]`));
        return match ? match[1].trim() : null;
    };

    // Zjistíme, jakou variantu zadání má tento pokus použít. 
    // Hledáme tag např. [MAP5:2] (5. pokus používá Variantu 2). 
    // Pokud není zmapován, zkusíme najít texty přímo pro dané číslo (zpětná kompatibilita pro staré laby).
    const mappedVariant = getTag("MAP" + currentRunNumber);
    const variantNum = mappedVariant ? parseInt(mappedVariant, 10) : currentRunNumber;

    let finalDescription = scenario.description || "";
    let finalInstructions = scenario.instructions || "Žádné specifické zadání.";
    let finalDeadline = scenario.deadline;

    if (variantNum > 1) {
        finalDescription = getTag("DESC" + variantNum) || finalDescription;
        finalInstructions = getTag("INST" + variantNum) || finalInstructions;
        const dlOverride = getTag("DL" + variantNum);
        if (dlOverride) finalDeadline = dlOverride;
    }

    // Extrakce správné varianty z [VARIANTx]...[/VARIANTx] tagů
    const variantBlockRegex = /\[VARIANT(\d+)\]([\s\S]*?)\[\/VARIANT\d+\]/g;
    const variantBlocks = [];
    let vMatch;
    while ((vMatch = variantBlockRegex.exec(finalInstructions)) !== null) {
        variantBlocks.push({ num: parseInt(vMatch[1]), content: vMatch[2].trim() });
    }
    if (variantBlocks.length > 0) {
        const chosen = variantBlocks.find(v => v.num === variantNum) || variantBlocks[0];
        // Vyber jen [STEPx] obsah, odstraň [VARIANT_SOLUTION]
        let chosenContent = chosen.content.replace(/\[VARIANT_SOLUTION\][\s\S]*?\[\/VARIANT_SOLUTION\]/g, "").trim();
        finalInstructions = chosenContent;
    }

    const visibleInstructions = finalInstructions.split(/CÍL MENTORA:|OSOBNOST TUTORA:|OSOBNOST MENTORA:/i)[0].trimEnd();
    let formattedInstructions = "";
    const structuredConfig = window.resolveStructuredTaskConfig ? window.resolveStructuredTaskConfig(scenario, variantNum) : null;
    const structuredTasks = Array.isArray(structuredConfig?.tasks) ? structuredConfig.tasks : [];
    const hasStructuredTasks = structuredTasks.length > 0;
    const stepCount = (visibleInstructions.match(/\[STEP\d+\]/g) || []).length;
    const hasSolutions = /\[SOL\d+\]/.test(visibleInstructions);
    const isSequential = !hasStructuredTasks && (stepCount > 1 || (stepCount === 1 && hasSolutions));
    window._isStrictSequential = (scenario.hints || "").includes("[SEQUENTIAL:true]");


    if (hasStructuredTasks) {
        window._stepPoints = null;
        window._stepHashes = null;
        window._stepHints = null;
        window._stepSkippable = null;
        window._stepRubrics = null;
        window._stepSolutionTexts = null;
        window._stepTexts = null;
        formattedInstructions = window.renderStructuredTaskList(
            structuredTasks,
            scenario,
            latestAttempt,
            structuredConfig?.variantNo || variantNum
        );
        window._pendingStructuredRestore = true;
        window._pendingSequentialRestore = false;
    } else if (isSequential) {
        const steps = [];
        const solutions = [];
        // Vylepšený regex: toleruje mezery a používá zpětnou referenci \1 pro správné uzavření tagu
        const stepRegex = /\[STEP(\d+)\s*\]([\s\S]*?)\[\/STEP\1\s*\]/gi;
        const stepPoints = [];         // body za každý krok
        const stepHints = [];          // nápovědy za každý krok: [{text, cost}, ...]
        const stepSkippable = [];      // zda lze krok přeskočit
        const stepRubrics = [];        // kritéria pro AI
        const stepSolutionTexts = [];  // vzorové správné řešení pro AI
        let stepMatch;

        while ((stepMatch = stepRegex.exec(visibleInstructions)) !== null) {
            const stepNum = stepMatch[1];
            const stepContent = stepMatch[2];

            const solRegex = new RegExp(`\\[SOL${stepNum}\\s*\\]([\\s\\S]*?)\\[\\/SOL${stepNum}\\s*\\]`, 'i');
            const solMatch = visibleInstructions.match(solRegex);
            let rawSolution = solMatch ? solMatch[1].trim() : '';
            const flagMatch = rawSolution.match(/^FLAG\[(.+)\]$/i);
            if (flagMatch) rawSolution = flagMatch[1];
            const solAlts = rawSolution.toLowerCase().split('||').map(s => s.trim()).filter(Boolean);
            solutions.push(solAlts);
            steps.push(stepContent.trim());

            const ptsMatch = visibleInstructions.match(new RegExp(`\\[PTS${stepNum}\\](\\d+)\\[\\/PTS${stepNum}\\]`, 'i'));
            stepPoints.push(ptsMatch ? parseInt(ptsMatch[1], 10) : 0);

            const skipMatch = visibleInstructions.match(new RegExp(`\\[SKIP${stepNum}\\](true|false)\\[\\/SKIP${stepNum}\\]`, 'i'));
            stepSkippable.push(skipMatch ? skipMatch[1] === 'true' : false);

            const rubricMatch = visibleInstructions.match(new RegExp(`\\[RUBRIC${stepNum}\\]([\\s\\S]*?)\\[\\/RUBRIC${stepNum}\\]`, 'i'));
            stepRubrics.push(rubricMatch ? rubricMatch[1].trim() : '');

            const solTextMatch = visibleInstructions.match(new RegExp(`\\[SOLUTION_TEXT${stepNum}\\]([\\s\\S]*?)\\[\\/SOLUTION_TEXT${stepNum}\\]`, 'i'));
            stepSolutionTexts.push(solTextMatch ? solTextMatch[1].trim() : '');

            const hintsBlockMatch = visibleInstructions.match(new RegExp(`\\[HINTS${stepNum}\\]([\\s\\S]*?)\\[\\/HINTS${stepNum}\\]`, 'i'));
            const parsedHints = [];
            if (hintsBlockMatch) {
                const hintRx = /\[HINT:(.*?):(\d+)\]/g;
                let hm;
                while ((hm = hintRx.exec(hintsBlockMatch[1])) !== null) {
                    parsedHints.push({ text: hm[1], cost: parseInt(hm[2], 10) });
                }
            }
            stepHints.push(parsedHints);
        }

        // Hashujeme odpovědi přes SHA-256 aby nebyly viditelné v DOM
        const hashAnswer = async (text) => {
            if (!text) return '';
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
        };

        if (steps.length === 0) {
            // Fallback: zkus parsovat bez [VARIANT] wrapperu
            const fallbackRegex = /\[STEP(\d+)\s*\]([\s\S]*?)\[\/STEP\1\s*\]/gi;
            let fm;
            while ((fm = fallbackRegex.exec(finalInstructions)) !== null) {
                const sNum = fm[1];
                const sContent = fm[2];
                const solRx = new RegExp(`\\[SOL${sNum}\\s*\\]([\\s\\S]*?)\\[\\/SOL${sNum}\\s*\\]`, 'i');
                const solM = finalInstructions.match(solRx);
                let raw = solM ? solM[1].trim() : '';
                const fg = raw.match(/^FLAG\[(.+)\]$/i); if (fg) raw = fg[1];
                solutions.push(raw.toLowerCase());
                steps.push(sContent.replace(/\[SOL\d+\s*\][\s\S]*?\[\/SOL\d+\s*\]/gi, '').trim());
            }
        }

        const buildSteps = async () => {
            const hashes = await Promise.all(solutions.map(alts =>
                Promise.all((Array.isArray(alts) ? alts : [alts]).map(a => hashAnswer(a)))
            ));

            window._stepHashes = hashes;
            window._stepHints = stepHints;
            window._stepPoints = stepPoints;
            window._stepSkippable = stepSkippable;
            window._stepRubrics = stepRubrics;
            window._stepSolutionTexts = stepSolutionTexts;
            window._stepTexts = steps;
            window._stepHintsUsed = steps.map(() => 0);

            const totalPoints = stepPoints.reduce((a, b) => a + b, 0);

            const stepsHtml = steps.map((s, i) => {
                const pts = stepPoints[i] || 0;
                const hints = stepHints[i] || [];

                const pointsBadge = pts > 0
                    ? `<span id="step-points-badge-${i}" style="font-size:12px; background:var(--bg-status); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; color:var(--text-primary); white-space:nowrap; display:inline-flex; align-items:center; gap:2px; line-height:1; box-sizing:border-box; height:28px;">
                        <span id="step-points-current-${i}">${pts}</span>&nbsp;/ ${pts} b
                        </span>`
                    : '';

                const hintBtn = hints.length > 0
                    ? `<button id="step-hint-btn-${i}" onclick="window.showHintConfirm(${i})"
                        style="font-size:12px; background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; cursor:pointer; white-space:nowrap; line-height:1; margin:0; height:28px; box-sizing:border-box;">
                        Nápověda (${hints.length})
                        </button>`
                    : '';

                const skippable = stepSkippable[i] || false;
                const skipBtn = skippable
                    ? `<button id="step-skip-btn-${i}" onclick="window.showSkipConfirm(${i})"
                        style="font-size:12px; background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; cursor:pointer; white-space:nowrap; display:inline-flex; align-items:center; gap:4px; line-height:1; margin:0; height:28px; box-sizing:border-box;">
                        Přeskočit krok
                        </button>`
                    : '';

                if (window._isStrictSequential) {
                    return `
                    <div id="lab-step-${i}" class="lab-step-container${i === 0 ? '' : ' hidden'}">
                        <div class="lab-step-title" style="margin:0 0 8px 0;">Krok ${i + 1} z ${steps.length}:</div>
                        <div class="lab-step-text">${s.replace(/\n/g, '<br>')}</div>
                        <div id="step-hints-log-${i}" style="margin-top:6px;"></div>
                        <div style="margin-top:10px;">
                            <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:6px; color:var(--text-primary);">Vaše odpověď pro ${i + 1}. krok:</label>
                            <div style="display:flex; gap:8px; align-items:stretch;">
                                <input type="text" id="step-answer-${i}" placeholder="Zadejte odpověď..." style="flex:1; margin:0;" oninput="window.saveDraftAnswer(${i})" onkeydown="if(event.key==='Enter') window.checkStepAnswer(${i}, ${i === steps.length - 1})" />
                                <button id="step-btn-${i}" style="background:var(--btn-primary); color:var(--btn-primary-text, #ffffff); padding:8px 16px; font-size:13px; margin:0; cursor:pointer; border-radius:6px; border:none; white-space:nowrap;" onclick="window.checkStepAnswer(${i}, ${i === steps.length - 1})">Odeslat odpověď</button>
                            </div>
                            <div id="step-feedback-${i}" style="margin-top:8px; font-size:13px; font-weight:bold; min-height:18px;"></div>
                        </div>
                        <div style="display:flex; align-items:center; margin-top:10px; padding-left:12px; gap:12px; flex-wrap:wrap;">
                            ${totalPoints > 0 ? `<span style="font-size:12px; color:var(--text-primary); font-weight:bold; border:1px dashed var(--border-color); border-radius:6px; padding:3px 10px; white-space:nowrap; display:inline-flex; align-items:center; height:28px; box-sizing:border-box; text-transform:uppercase;">CELKEM: ${totalPoints} B</span>` : ''}
                            ${pointsBadge}
                            ${hintBtn}
                            ${skipBtn}
                            ${i > 0 ? `<button onclick="window.goToStep(${i-1})" style="font-size:12px; background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; cursor:pointer; margin:0; height:28px; box-sizing:border-box; line-height:1;">← Zpět</button>` : ''}
                            ${i < steps.length - 1 ? `<button id="step-next-btn-${i}" onclick="window.goToStep(${i+1})" disabled style="font-size:12px; background:var(--btn-primary); color:var(--btn-primary-text, #ffffff); border:none; border-radius:6px; padding:3px 10px; margin:0; height:28px; box-sizing:border-box; line-height:1; cursor:not-allowed; opacity:0.4;">Další →</button>` : ''}
                        </div>
                    </div>`;
                }

                return `
                <div id="lab-step-${i}" class="lab-step-container${i === 0 ? '' : ' hidden'}">
                    <div class="lab-step-title" style="margin:0 0 8px 0;">Krok ${i + 1} z ${steps.length}:</div>
                    <div class="lab-step-text">${s.replace(/\n/g, '<br>')}</div>
                    <div id="step-hints-log-${i}" style="margin-top:6px;"></div>
                    <div style="margin-top:10px;">
                        <label style="font-size:13px; font-weight:bold; display:block; margin-bottom:6px; color:var(--text-primary);">Vaše odpověď pro ${i + 1}. krok:</label>
                        <textarea id="step-answer-${i}" rows="7" placeholder="Zadejte odpověď..." style="width:100%; min-height:170px; resize:vertical; margin:0; box-sizing:border-box;" oninput="window.saveDraftAnswer(${i})"></textarea>
                        <div id="step-feedback-${i}" style="margin-top:8px; font-size:13px; min-height:18px; color:var(--text-muted);"></div>
                    </div>
                    <div style="display:flex; align-items:center; margin-top:10px; padding-left:12px; gap:12px; flex-wrap:wrap;">
                        ${totalPoints > 0 ? `<span style="font-size:12px; color:var(--text-primary); font-weight:bold; border:1px dashed var(--border-color); border-radius:6px; padding:3px 10px; white-space:nowrap; display:inline-flex; align-items:center; height:28px; box-sizing:border-box; text-transform:uppercase;">CELKEM: ${totalPoints} B</span>` : ''}
                        ${pointsBadge}
                        ${hintBtn}
                        ${skipBtn}
                        ${i > 0 ? `<button onclick="window.goToStep(${i-1})" style="font-size:12px; background:var(--bg-status); color:var(--text-primary); border:1px solid var(--border-color); border-radius:6px; padding:3px 10px; cursor:pointer; margin:0; height:28px; box-sizing:border-box; line-height:1;">← Zpět</button>` : ''}
                        ${i < steps.length - 1 ? `<button id="step-next-btn-${i}" onclick="window.goToStep(${i+1})" style="font-size:12px; background:var(--btn-primary); color:var(--btn-primary-text, #ffffff); border:none; border-radius:6px; padding:3px 10px; margin:0; height:28px; box-sizing:border-box; line-height:1; cursor:pointer; opacity:1;">Další →</button>` : ''}
                    </div>
                </div>`;
            }).join('');

            return stepsHtml;
        };

        if (steps.length > 0) {
            formattedInstructions = await buildSteps();
        } else {
            // Kroky nebyly nalezeny — zobraz čistý text bez tagů
            formattedInstructions = visibleInstructions
                .replace(/\[STEP\d+\s*\]/gi, '').replace(/\[\/STEP\d+\s*\]/gi, '')
                .replace(/\[SOL\d+\s*\][\s\S]*?\[\/SOL\d+\s*\]/gi, '')
                .replace(/\[VARIANT_SOLUTION\][\s\S]*?\[\/VARIANT_SOLUTION\]/gi, '')
                .trim().replace(/\n/g, '<br>');
        }
        
        // Uložíme dočasně flag, abychom na konci funkce věděli, že máme obnovit stav
        window._pendingSequentialRestore = steps.length > 0;
    } else {
        // Vyčištění paměti od předchozích sekvenčních / strukturovaných úloh
        window._stepPoints = null;
        window._stepHashes = null;
        window._stepHints = null;
        window._stepSkippable = null;
        window._stepRubrics = null;
        window._stepSolutionTexts = null;
        window._stepTexts = null;
        window._structuredTaskMeta = null;
        window._structuredTaskVariantNo = null;
        window._structuredTaskAttemptId = null;
        window._pendingStructuredRestore = false;
        window._pendingSequentialRestore = false;
        window._isStrictSequential = false;

        // Odstraň případné [STEPx]...[/STEPx] tagy, zobraz jen čistý text
        formattedInstructions = visibleInstructions
            .replace(/\[STEP\d+\]/g, '')
            .replace(/\[\/STEP\d+\]/g, '')
            .replace(/\[SOLUTION_TEXT\d*\][\s\S]*?\[\/SOLUTION_TEXT\d*\]/gi, '')
            .replace(/\[RUBRIC\d*\][\s\S]*?\[\/RUBRIC\d*\]/gi, '')
            .replace(/\[STEP_SOLUTION\][\s\S]*?\[\/STEP_SOLUTION\]/g, '')
            .replace(/\[SOL\d+\][\s\S]*?\[\/SOL\d+\]/g, '')
            .replace(/\[VARIANT_SOLUTION\][\s\S]*?\[\/VARIANT_SOLUTION\]/g, '')
            .replace(/\[PTS\d+\][\s\S]*?\[\/PTS\d+\]/g, '')
            .replace(/\[SKIP\d+\][\s\S]*?\[\/SKIP\d+\]/g, '')
            .replace(/\[HINTS\d+\][\s\S]*?\[\/HINTS\d+\]/g, '')
            .trim()
            .replace(/\n/g, '<br>');
    }
    const deadlineTextObj = finalDeadline ? formatDate(finalDeadline) : "Bez termínu";

    const osMap = { "ubuntu": "Ubuntu", "kali": "Kali Linux", "windows": "Windows" };
    
    let displayOs = "Neznámý OS";
    if (scenario.requiredOs) {
        if (typeof customLabTemplatesMap !== 'undefined' && customLabTemplatesMap[scenario.requiredOs]) {
            // Zobrazí reálný název, který dal učitel (např. "Můj speciální Kali (Custom)")
            displayOs = customLabTemplatesMap[scenario.requiredOs] + " (Custom)";
        } else if (scenario.requiredOs.startsWith("custom:")) {
            // Bezpečnostní fallback, kdyby backend nepovolil studentovi načíst /labtemplates
            displayOs = "Vlastní lab prostředí (Custom)";
        } else {
            // Standardní mapování pro ubuntu, kali, windows
            displayOs = osMap[scenario.requiredOs] || scenario.requiredOs;
        }
    }
    let timeLimit = 60; 
    const limitMatch = scenario.hints ? scenario.hints.match(/\[TIME_LIMIT:(\d+)\]/) : null;
    if (limitMatch) timeLimit = parseInt(limitMatch[1], 10);

    const thresholdMatch = (scenario.hints || '').match(/\[PASS_THRESHOLD:(\d+)\]/);
    const passThreshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : null;

    const taskTypeMatch = (scenario.hints || '').match(/\[TYPE:([a-zA-Z_]+)\]/);
    const taskType = taskTypeMatch ? String(taskTypeMatch[1]).toLowerCase() : 'practice';

    const autoSubmitMeta = (scenario.hints || '').includes('[AUTO_SUBMIT:true]');

    const evaluationModeLabel = autoSubmitMeta && passThreshold !== null
        ? `Cvičení bez hodnocení učitelem (min. ${passThreshold} % pro splnění)`
        : autoSubmitMeta
            ? 'Cvičení bez hodnocení učitelem'
            : (passThreshold !== null
                ? (taskType === 'exam' || taskType === 'credit'
                    ? 'Výsledek: prospěl / neprospěl'
                    : 'Výsledek dle minimální úspěšnosti')
                : '');

    const attemptInfoText = (scenario.maxAttempts > 0 && !isAttemptsTypo) ? `${displayRunNumber}. z ${scenario.maxAttempts}` : `${displayRunNumber}.`;

    // Vykreslení horního panelu zadání

    // Sekvenční úlohy skryjeme zadání dokud lab není připraven (ochrana před resetem odpovědí)
    const hasStartedCurrentAttempt = !!latestAttempt && latestAttempt.status !== "archived";
    const savedUrl = hasStartedCurrentAttempt ? (localStorage.getItem('lab_url_' + latestAttempt.attemptId) || latestAttempt.guiUrl) : null;
    const labReady = hasStartedCurrentAttempt && latestAttempt?.status === "succeeded" && savedUrl && (savedUrl.startsWith("http") || savedUrl === "skip");
    const isLabStarted = hasStartedCurrentAttempt && ["queued", "provisioning", "running", "succeeded", "started"].includes(latestAttempt.status);
    const labFinished = hasStartedCurrentAttempt && ["finished", "deleting", "stopped", "failed"].includes(latestAttempt.status);
    
    const isSubmittedOrEvaluated = state === "submitted" || state === "evaluated";
    const isAdaptive = scenario.hints?.includes('[ADAPTIVE:true]') || scenario.difficulty === 'adaptive';
    const isAutoSubmit = (scenario.hints || '').includes('[AUTO_SUBMIT:true]');
    const needsLab = scenario.requiredOs && scenario.requiredOs !== 'skip';
    const hideTaskUntilReady = !labReady && !labFinished && !isSubmittedOrEvaluated
        && (!isAdaptive || (isAdaptive && needsLab && !hasStartedCurrentAttempt));

    // Zachovej ai-scenario-container před přepsáním DOM (BEZ CLONE, abychom nezabili CodeMirror)
    const _existingAiContainer = document.getElementById('ai-scenario-container');
    let _aiContainerBackup = null;
    if (_existingAiContainer) {
        _aiContainerBackup = _existingAiContainer;
        _existingAiContainer.parentNode.removeChild(_existingAiContainer);
    }

    detailEl.innerHTML = `
    <h3 class="scenario-detail-title">${scenario.title}</h3>
    <div class="os-badge">
        Operační systém: ${displayOs}
    </div>
    <div class="attempt-badge">
        Pokus: ${attemptInfoText}
    </div>
    <div class="scenario-meta-footer" style="margin-bottom: 16px;">
        <div><strong>Termín odevzdání:</strong> <span class="deadline-text">${deadlineTextObj}</span></div>
        <div><strong>Max. pokusů:</strong> ${maxAttemptsText}</div>
        <div><strong>Čas na splnění:</strong> <span id="labCountdownDisplay" class="countdown-text">${timeLimit} min</span></div>
        ${passThreshold !== null ? `<div><strong>Potřeba pro splnění:</strong> ${passThreshold} %</div>` : ''}
        ${evaluationModeLabel ? `<div><strong>Režim:</strong> ${evaluationModeLabel}</div>` : ''}
    </div>
    <p class="scenario-description">${(finalDescription || "Tato úloha nemá žádný podrobný popis.").replace(/\n/g, '<br>')}</p>
    ${isSubmittedOrEvaluated ? `
    <div id="task-box-placeholder" style="padding: 20px; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-muted); font-size: 14px; text-align: center; margin: 12px 0;">
        REVIZE ŘEŠENÍ JIŽ NENÍ MOŽNÁ
    </div>` : hideTaskUntilReady ? `
    <div id="task-box-placeholder" style="padding: 20px; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-muted); font-size: 14px; text-align: center; margin: 12px 0;">
        ⏳ Zadání se zobrazí po přípravě laboratorního prostředí…
    </div>` : (!isAdaptive || (isAdaptive && needsLab && !labReady && !labFinished) ? `
    <div class="task-box">
        <div class="task-instructions">${formattedInstructions}</div>
    </div>` : `<div id="ai-scenario-container">${(() => {
    if (!latestAttempt || latestAttempt.learningStatus !== 'started' || window.aiScenario?.isActive()) return '';
    const _pKey = 'ai_scenario_' + scenario.scenarioId + '_' + latestAttempt.attemptId;
    const _hasProgress = !!localStorage.getItem(_pKey);
    const _msg = _hasProgress ? 'Načítám, kde jste naposledy skončili…' : 'Připravuji první úkol…';
    return '<div style="display:flex;align-items:center;gap:12px;padding:18px 20px;border:1px solid var(--border-color);border-radius:12px;background:var(--bg-panel);margin:12px 0;"><div class=\'ai-spinner\'></div><span style=\'color:var(--text-muted);font-size:14px;\'>' + _msg + '</span></div>';
})()}</div>`)}
    `;


    // Schovat/zobrazit textarea "Vaše řešení" podle typu úlohy
    const submissionArea = document.getElementById("submissionNote");
    const submissionLabel = document.querySelector("label[for='submissionNote']");
    const submissionBlock = document.getElementById("submissionBlock");
    const hideTextarea = isSequential || isAdaptive || hasStructuredTasks;

    if (submissionBlock) submissionBlock.style.display = hideTextarea ? "none" : "block";
    if (submissionArea) submissionArea.style.display = hideTextarea ? "none" : "block";
    if (submissionLabel) submissionLabel.style.display = hideTextarea ? "none" : "block";

    // 3. GENEROVÁNÍ HISTORIE POKUSŮ (TOHLE TI ZMIZELO)
    let feedbackHtml = "";
    const pastAttempts = allScenarioAttempts.filter(a => a.status === "archived" || a.learningStatus === "evaluated" || a.learningStatus === "submitted");
    
    if (pastAttempts.length === 0 && !latestAttempt) {
        feedbackHtml = "<div class='status-box'>Zatím není dostupná žádná zpětná vazba.</div>";
    } else {
        // Seřadíme od nejnovějšího — zobrazujeme jen dokončené/odevzdané/ohodnocené, ne aktuální rozpracovaný
        const sorted = [...allScenarioAttempts]
            .filter(a => {
                // AUTO_SUBMIT: zobraz pokus v historii až po archivaci (tj. po hlášce "Cvičení dokončeno!")
                if (isAutoSubmit) return a.status === "archived";
                return a.status === "archived" || a.learningStatus === "evaluated" || a.learningStatus === "submitted";
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        sorted.forEach((pastAtm, idx) => {
            const pSub = currentSubmissions.find(s => s.attemptId === pastAtm.attemptId);
            const pRun = sorted.length - idx;
            let pScore = pastAtm.score ?? pSub?.score;
            const pFeedbackText = stripStoredAiEvaluation(pastAtm.feedbackText || pSub?.feedbackText);
            const grading = parseGradingInfo(scenario.hints);
            const isAutoSubmit = (scenario.hints || '').includes('[AUTO_SUBMIT:true]');

            if (pastAtm.learningStatus === "evaluated" && grading.style !== 'none' && (pScore === null || pScore === undefined || pScore === "")) {
                pScore = 0;
            }

            const isOpen = window.openAccordionIds && window.openAccordionIds.has(pastAtm.attemptId) ? " open" : "";

            // PASS_THRESHOLD
            const thresholdM = (scenario.hints || '').match(/\[PASS_THRESHOLD:(\d+)\]/);
            const passThreshold = thresholdM ? parseInt(thresholdM[1]) : null;
            const passResult = passThreshold && pScore !== null && pScore !== undefined && pScore !== ""
                ? Math.round((parseInt(pScore) / grading.max) * 100) >= passThreshold
                : null;

            // Známku zobraz jen pokud: není AUTO_SUBMIT A je evaluated (učitel hodnotil)
            const pDate = pastAtm.createdAt ? new Date(pastAtm.createdAt).toLocaleDateString("cs-CZ") : "-";
            // Přepočítej max z taskConfigJson pokud grading.max nesedí
            let _gradingMax = grading.max;
            try {
                const _cfg = JSON.parse(scenario?.taskConfigJson || 'null');
                if (_cfg?.variants) {
                    const _hintsStr = scenario?.hints || '';
                    const _mapM = _hintsStr.match(new RegExp(`\\[\\s*MAP${pastAtm.runNumber || 1}\\s*:([\\s\\S]*?)\\]`));
                    const _vNum = _mapM ? parseInt(_mapM[1].trim(), 10) : (pastAtm.runNumber || 1);
                    const _v = (_cfg.variants || []).find(v => Number(v.variantNo) === _vNum) || (_cfg.variants || [])[0];
                    const _calcMax = (_v?.tasks || []).reduce((s, t) => s + Number(t?.points || 0), 0);
                    if (_calcMax > 0) _gradingMax = _calcMax;
                }
            } catch(e) {}
            // Pro AI scénáře načti max z contentPayload
            const _rawAiPayload = pSub?.contentPayload || pastAtm.submissionNote || '';
            if (_rawAiPayload.trimStart().startsWith('[AI_SCENARIO]')) {
                const _aiMaxM = _rawAiPayload.match(/Celkem bodů:\s*\d+\s*\/\s*(\d+)/);
                if (_aiMaxM) _gradingMax = parseInt(_aiMaxM[1]);
            }

            let pPointsText = "-";
            if (pScore !== null && pScore !== undefined && pScore !== "") {
                pPointsText = isAutoSubmit
                    ? `${pScore} / ${_gradingMax} b`
                    : `${pScore} z ${_gradingMax} bodů`;
            }

            const pResultText = passThreshold !== null && passResult !== null
                ? (passResult ? 'Splněno' : 'Nesplněno')
                : null;

            const submittedSolutionHtml = buildSubmittedStepsHtml(pSub?.contentPayload || pastAtm.submissionNote || "", isAutoSubmit);

            // Badge pro accordion — známka nebo splněno/nesplněno
            const _hasScore = pScore !== null && pScore !== undefined && pScore !== "";
            const _headerBadge = (() => {
                if (passThreshold !== null && passResult !== null) {
                    const _c = passResult ? '#10b981' : '#ef4444';
                    return `<span class="badge" style="background:${_c};color:white;">${passResult ? '✓ Splněno' : '✗ Nesplněno'}</span>`;
                }
                if (_hasScore && pastAtm.learningStatus !== 'submitted') {
                    const _g = getGradeFromScore(pScore, { ...grading, max: _gradingMax });
                    const _gc = _g === 'F' ? '#ef4444' : '#22c55e';
                    return `<span class="badge" style="background:${_gc};color:white;">${_g}</span>`;
                }
                return '';
            })();
            // Hodnocení řádek uvnitř obsahu
            const _contentScoreHtml = _hasScore
                ? `<div><strong>${passThreshold !== null ? 'Výsledek' : (isAutoSubmit ? 'Body' : 'Hodnocení')}:</strong> ${passThreshold !== null ? pResultText : pPointsText}</div>`
                : '';

            feedbackHtml += `
            <div class="accordion-item${isOpen}" data-attempt-id="${pastAtm.attemptId}">
                <div class="accordion-header">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span>${pRun}. pokus</span>
                  ${_hasScore ? `<span style="font-size:13px; color:var(--text-muted); font-weight:normal;">${pScore} / ${_gradingMax} b</span>` : ''}
                  ${_headerBadge}
                </div>
                <i>&#x25BC;</i>
                </div>
                <div class="accordion-content" style="font-size: 14px; line-height: 1.6; color: var(--text-primary);">
                <div style="margin-top: 10px;"><strong>Datum:</strong> ${pDate}</div>
                ${_contentScoreHtml}
                ${pastAtm.learningStatus === 'submitted' && !isAutoSubmit ? `
                <div style="margin-top:12px; padding:10px 14px; border-left:3px solid #f59e0b; background:rgba(245,158,11,0.07); border-radius:0 8px 8px 0; color:var(--text-primary); font-size:13px;">
                    ⏳ <strong>Čeká na hodnocení učitelem.</strong> Výsledky se zobrazí po ohodnocení.
                </div>` : ''}
                ${(!isAutoSubmit && pastAtm.learningStatus === 'submitted') ? '' : (() => {
                  const _payload = pSub?.contentPayload || pastAtm.submissionNote || '';

                  // AI scénář — použij původní render
                  if (String(_payload).trimStart().startsWith('[AI_SCENARIO]')) {
                      return `<div style="margin-bottom:12px;">${buildSubmittedStepsHtml(_payload, isAutoSubmit)}</div>`;
                  }

                  const _scenario = currentScenarios.find(s => s.scenarioId === pastAtm.scenarioId);

                  // Parsuj AI metadata z feedbackText
                  let _aiPerStep = {};
                  let _aiImagePoints = {};
                  try {
                      const _raw = pSub?.feedbackText || pastAtm.feedbackText || '';
                      const _m = _raw.match(/\[__AI_STEP_EVAL__\]([\s\S]*?)\[\/__AI_STEP_EVAL__\]/);
                      if (_m) {
                          const _parsed = JSON.parse(decodeURIComponent(escape(atob(_m[1].trim()))));
                          (_parsed.perStepResults || []).forEach(r => { _aiPerStep[String(r.step)] = r; });
                          _aiImagePoints = _parsed.imagePoints || {};
                      }
                  } catch(e) {}

                  // Získej task config pro zadání a max body
                  let _tasks = [];
                  try {
                      const _cfg = JSON.parse(_scenario?.taskConfigJson || 'null');
                      const _vNum = pastAtm.runNumber || 1;
                      const _hintsStr = _scenario?.hints || '';
                      const _mapM = _hintsStr.match(new RegExp(`\\[\\s*MAP${_vNum}\\s*:([\\s\\S]*?)\\]`));
                      const _variantNum = _mapM ? parseInt(_mapM[1].trim(), 10) : _vNum;
                      const _v = (_cfg?.variants || []).find(v => Number(v.variantNo) === _variantNum) || (_cfg?.variants || [])[0];
                      _tasks = _v?.tasks || [];
                  } catch(e) {}

                  // Parsuj kroky z contentPayload
                  const _ansRx = /^Krok\s+(\d+):\s*/gm;
                  const _starts = [];
                  let _am;
                  while ((_am = _ansRx.exec(_payload)) !== null) _starts.push({ n: _am[1], marker: _am.index, pos: _am.index + _am[0].length });

                  if (_starts.length === 0 && !Object.keys(_aiPerStep).length) {
                      return `<div style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">${escapeHtml(_payload || '(bez odpovědi)')}</div>`;
                  }

                  // Spočítej celkový součet z contentPayload tagů + AI metadat
                  let _totalEarned = 0, _totalMax = 0, _hasPoints = false;
                  _starts.forEach(it => {
                      const i = _starts.indexOf(it);
                      const end = i + 1 < _starts.length ? _starts[i+1].marker : _payload.length;
                      const chunk = _payload.slice(it.pos, end);
                      const _scoreM = chunk.match(/\[(\d+)\/(\d+)\s*b[^\]]*\]/);
                      const _task = _tasks[parseInt(it.n) - 1] || null;
                      const _maxPts = Number(_task?.points || (_scoreM ? _scoreM[2] : 0));
                      const _open = _aiPerStep[it.n];
                      const _img = _aiImagePoints[it.n];
                      if (_open !== undefined) { _totalEarned += _open.points ?? 0; _totalMax += _maxPts; _hasPoints = true; }
                      else if (_img !== undefined) { _totalEarned += _img; _totalMax += _maxPts; _hasPoints = true; }
                      else if (_scoreM) { _totalEarned += parseInt(_scoreM[1]); _totalMax += parseInt(_scoreM[2]); _hasPoints = true; }
                      else _totalMax += _maxPts;
                  });

                  const _header = '';

                  const _stepsHtml = _starts.map((it, i) => {
                      const end = i + 1 < _starts.length ? _starts[i+1].marker : _payload.length;
                      const chunk = _payload.slice(it.pos, end);
                      const _scoreM = chunk.match(/\[(\d+)\/(\d+)\s*b[^\]]*\]/);
                      const answerText = chunk.replace(/\s*\[\d+\/\d+[^\]]*\]\s*$/, '').trim();
                      const _task = _tasks[parseInt(it.n) - 1] || null;
                      const _type = String(_task?.type || '').toLowerCase();
                      const _maxPts = Number(_task?.points || (_scoreM ? _scoreM[2] : 0));
                      const _open = _aiPerStep[it.n];
                      const _img = _aiImagePoints[it.n] ?? null;

                      const _earnedPts = _open !== undefined ? (_open.points ?? 0)
                          : _img !== null ? _img
                          : (_scoreM ? parseInt(_scoreM[1]) : null);
                      const _pct = _maxPts > 0 && _earnedPts !== null ? Math.round((_earnedPts / _maxPts) * 100) : 0;
                      const _col = _earnedPts === null ? '#6b7280' : _pct >= 70 ? '#10b981' : _pct >= 40 ? '#f59e0b' : '#ef4444';
                      const _prompt = _task?.prompt || '';

                      // Zpětná vazba
                      let _fbHtml = '';
                      if (_open?.feedback) {
                          _fbHtml = `<div style="margin-top:10px;border-left:3px solid #3b82f6;padding-left:10px;">
                              <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Zpětná vazba</div>
                              <div style="font-size:13px;color:var(--text-primary);line-height:1.5;">${escapeHtml(_open.feedback)}</div>
                          </div>`;
                      } else if (_earnedPts !== null && _maxPts > 0 && _type !== 'image' && _type !== 'open' && _type !== 'code') {
                          const _autoFb = _earnedPts >= _maxPts ? 'Výborně, odpověď je správná!' : !answerText ? 'Na tuto otázku jste neodpověděl/a.' : 'Odpověď nebyla správná.';
                          _fbHtml = `<div style="margin-top:10px;border-left:3px solid #3b82f6;padding-left:10px;">
                              <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Zpětná vazba</div>
                              <div style="font-size:13px;color:var(--text-primary);line-height:1.5;">${escapeHtml(_autoFb)}</div>
                          </div>`;
                      }

                      return `
                        <div style="border:1px solid var(--border-color);border-radius:10px;overflow:hidden;margin-bottom:10px;">
                          <div style="background:var(--bg-status);padding:10px 14px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-weight:bold;font-size:13px;color:var(--text-primary);">Krok ${it.n}</span>
                            ${_maxPts > 0 ? `<span style="font-size:14px;font-weight:bold;color:${_col};border:2px solid ${_col};border-radius:8px;padding:2px 10px;background:${_col}22;">${_earnedPts !== null ? _earnedPts : '—'} / ${_maxPts} b</span>` : ''}
                          </div>
                          <div style="padding:12px 14px;">
                            ${_prompt ? `<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Zadání</div>
                            <div style="font-size:13px;color:var(--text-primary);line-height:1.6;margin-bottom:10px;">${escapeHtml(_prompt)}</div>` : ''}
                            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Odpověď</div>
                            <div style="font-size:13px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;background:var(--bg-status);border-radius:8px;padding:10px 12px;border:1px solid ${answerText ? 'var(--border-color)' : '#f59e0b'};">${answerText ? escapeHtml(answerText) : '<span style="color:var(--text-muted);font-style:italic;">⚠ Bez odpovědi</span>'}</div>
                            ${_fbHtml}
                          </div>
                        </div>`;
                  }).join('');

                  // Celková zpětná vazba učitele
                  const _overallFb = pFeedbackText?.trim();
                  const _overallHtml = _overallFb ? `<div style="margin-top:14px;padding:14px 16px;border-left:3px solid #3b82f6;background:rgba(59,130,246,0.07);border-radius:0 10px 10px 0;">
                      <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Celková zpětná vazba</div>
                      <div style="font-size:13px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;">${escapeHtml(_overallFb)}</div>
                  </div>` : '';

                  return `<div style="margin-bottom:12px;">${_header}${_stepsHtml}${_overallHtml}</div>`;
                })()}
                </div>
            </div>
            `;
        });
    }
    feedbackBox.innerHTML = feedbackHtml;

    // 4. Logika tlačítek a pollingu (PŮVODNÍ ZBYTEK)
    const myValidAttempts = currentAttempts.filter(a => a.scenarioId === currentScenarioId && a.status !== "archived");
    const usedAttemptsCount = myValidAttempts.length;
    const isLatestArchived = latestAttempt && latestAttempt.status === "archived";
    // succeeded bez URL = skip lab byl ukončen, čeká na odevzdání
    const _labUrlGone = latestAttempt && !localStorage.getItem('lab_url_' + latestAttempt.attemptId) && !latestAttempt.guiUrl;
    const isActiveRun = latestAttempt && !isLatestArchived && (
        ["queued", "provisioning", "running"].includes(latestAttempt.status)
        || (latestAttempt.status === "succeeded" && !_labUrlGone)
    );
    const isAttemptActiveOrDone = latestAttempt && !isLatestArchived && (
        isActiveRun
        || ["finished", "deleting", "stopped", "failed"].includes(latestAttempt.status)
        || (latestAttempt.status === "succeeded" && _labUrlGone)
        || latestAttempt.learningStatus === "submitted"
        || latestAttempt.learningStatus === "evaluated"
    );
    const isSkipLab = savedUrl === 'skip';
    const canSubmit = latestAttempt
        && !isLatestArchived
        && (["finished", "deleting", "stopped", "failed"].includes(latestAttempt.status) || (latestAttempt.status === "succeeded" && (_labUrlGone || isSkipLab)))
        && latestAttempt.learningStatus !== "submitted"
        && latestAttempt.learningStatus !== "evaluated"
        && (!sub || (sub.status !== "submitted" && sub.status !== "evaluated"));
    const limitReached = scenario.maxAttempts > 0 && usedAttemptsCount >= scenario.maxAttempts;

    // Pokud se lab maže → zamkni AI container okamžitě (ale ne pokud stop právě dokončil)
    if (!window._stopJustCompleted && latestAttempt && ['deleting', 'stopped', 'failed', 'finished'].includes(latestAttempt.status) && window.aiScenario?.isActive()) {
        window.aiScenario.setLock(true);
    }

    if (isAdaptive) {
        if (!latestAttempt && !limitReached) {
            // Žádný pokus → student musí kliknout "Spustit prostředí"
            startBtn.style.display = "inline-block";
            startBtn.disabled = false;
            startBtn.textContent = "Spustit prostředí";
            startBtn.onclick = () => startAiScenario();
        } else if (latestAttempt && latestAttempt.status !== 'archived') {
            // Aktivní pokus existuje → tlačítko schovej, AI se inicializuje sama
            startBtn.style.display = "none";
        } else if (isLatestArchived && !limitReached) {
            // Archivovaný pokus = učitel povolil nový → zobraz "Spustit prostředí"
            startBtn.style.display = "inline-block";
            startBtn.disabled = false;
            startBtn.style.opacity = '';
            startBtn.style.cursor = '';
            startBtn.style.pointerEvents = 'auto';
            startBtn.textContent = "Spustit prostředí";
            startBtn.onclick = () => startAiScenario();
        } else {
            // Limit pokusů vyčerpán
            startBtn.style.display = "inline-block";
            startBtn.disabled = true;
            startBtn.textContent = "Počet pokusů vyčerpán";
            startBtn.style.opacity = '0.5';
            startBtn.style.cursor = 'not-allowed';
            startBtn.style.pointerEvents = 'none';
        }
    } else {
        startBtn.style.display = "inline-block";
        startBtn.onclick = limitReached ? null : () => startScenario();
        startBtn.textContent = limitReached ? "Počet pokusů vyčerpán" : "Spustit prostředí";
        // AUTO_SUBMIT: po archivaci (evaluated+archived) rovnou povolit nový pokus
        const isAutoSubmitDone = isAutoSubmit && isLatestArchived
            && (latestAttempt?.learningStatus === 'evaluated' || latestAttempt?.learningStatus === 'archived');
        const _startDisabled = (!isAutoSubmitDone && isAttemptActiveOrDone) || limitReached;
        startBtn.disabled = _startDisabled;
        startBtn.style.opacity = _startDisabled ? '0.5' : '';
        startBtn.style.cursor = _startDisabled ? 'not-allowed' : '';
        startBtn.style.pointerEvents = _startDisabled ? 'none' : 'auto';
    }
    // Kontrola, zda jsou u sekvenčního/strukturovaného zadání "vygenerovány" (zobrazeny) všechny kroky
    let allStepsSeen = true;
    if (isSequential && window._seqState) {
        allStepsSeen = window._seqState.maxReached >= (window._seqState.totalSteps - 1);
    }

    // Reset potvrzení odevzdání — nový render = nová šance na varování
    window._submitConfirmedGlobal = false;

    // Znovu zaregistruj AI hook po každém překreslení DOM (submitBtn je nový element)
    if (window.aiScenario?.isActive() && typeof window.aiScenario.registerSubmitHook === 'function') {
        setTimeout(() => window.aiScenario.registerSubmitHook(), 0);
    }

    const _submitShouldBeEnabled = canSubmit && !isLatestArchived && !isActiveRun && allStepsSeen;
    
    submitBtn.disabled = !_submitShouldBeEnabled;
    if (!_submitShouldBeEnabled) {
        submitBtn.style.backgroundColor = '#9ca3af';
        submitBtn.style.borderColor = '#9ca3af';
        submitBtn.style.color = '#ffffff';
        submitBtn.style.opacity = '0.7';
        submitBtn.style.cursor = 'not-allowed';
        submitBtn.style.pointerEvents = 'none';
    } else {
        submitBtn.style.backgroundColor = '';
        submitBtn.style.borderColor = '';
        submitBtn.style.color = '';
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        submitBtn.style.pointerEvents = 'auto';
    }

    // Hook pro varování u běžných úkolů (pokud chybí odpověď)
    if (!submitBtn.hasAttribute('data-global-hook')) {
        submitBtn.setAttribute('data-global-hook', 'true');
        submitBtn.addEventListener('click', function(e) {
            if (window.aiScenario && window.aiScenario.isActive()) return; // AI má vlastní hook v student-ai-scenario.js
            if (window._submitConfirmedGlobal) return;

            // ── Detekce prázdných odpovědí pro všechny typy zadání ──────────────
            const emptyTaskNums = [];

            // 1) Strukturované úkoly (flag/open/code/image → textarea nebo input)
            if (window._structuredTaskMeta && window._structuredTaskMeta.length > 0) {
                window._structuredTaskMeta.forEach((task, idx) => {
                    const type = String(task?.type || '').toLowerCase();
                    let isEmpty = false;
                    if (type === 'tf' || type === 'abcd') {
                        isEmpty = !document.querySelector(`input[name="structured-${type}-${idx}"]:checked`);
                    } else if (type === 'multi') {
                        isEmpty = !document.querySelector(`input[name="structured-multi-${idx}"]:checked`);
                    } else if (type === 'sort') {
                        // Sort vždy má pořadí — nevyžaduje akci od studenta
                        isEmpty = false;
                    } else {
                        // flag, open, code, image — textarea nebo input
                        const el = document.getElementById(`structured-answer-${idx}`);
                        const cm = window._studentCmInstances?.[String(idx)];
                        const val = cm ? cm.getValue() : (el ? el.value : '');
                        isEmpty = !val.trim();
                    }
                    if (isEmpty) emptyTaskNums.push(idx + 1);
                });
            // 2) Sekvenční úkoly (STEP textarea/input)
            } else if (window._seqState && window._seqState.totalSteps > 0) {
                for (let i = 0; i < window._seqState.totalSteps; i++) {
                    const el = document.getElementById(`step-answer-${i}`);
                    if (el && !el.value.trim()) emptyTaskNums.push(i + 1);
                }
            // 3) Prostá otevřená odpověď (submissionNote)
            } else {
                const sn = document.getElementById('submissionNote');
                if (sn && sn.style.display !== 'none' && !sn.value.trim()) emptyTaskNums.push(1);
            }

            if (emptyTaskNums.length > 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const taskList = emptyTaskNums.map(n => `úkolu č. ${n}`).join(', ');
                const msg = emptyTaskNums.length === 1
                    ? `U ${taskList} jste neodeslal odpověď. Určitě chcete odevzdat výsledek?`
                    : `U ${taskList} jste neodeslal odpovědi. Určitě chcete odevzdat výsledek?`;
                customConfirm(msg, () => {
                    window._submitConfirmedGlobal = true;
                    submitBtn.click();
                });
            }
        }, true);
    }

    if (isActiveRun) {
        startBtn.style.display = "none";
        const stopBtn = document.getElementById("stopBtn");
        stopBtn.style.display = "inline-block";
        
        const savedUrl = localStorage.getItem('lab_url_' + latestAttempt.attemptId) || latestAttempt.guiUrl;
        const isSkipLabReady = savedUrl === "skip";
        const isLabReady = latestAttempt.status === "succeeded" && savedUrl && (savedUrl.startsWith("http") || isSkipLabReady);

        // Zamrazení tlačítka Ukončit lab — disabled pokud lab není ready NEBO pokud se právě ukončuje
        const isStopInProgress = window._stopInProgress === true;
        if (isLabReady && !isStopInProgress) {
            stopBtn.disabled = false;
            stopBtn.style.opacity = "1";
            stopBtn.style.cursor = "pointer";
            stopBtn.style.pointerEvents = "auto";
        } else {
            stopBtn.disabled = true;
            stopBtn.style.opacity = "0.5";
            stopBtn.style.cursor = "not-allowed";
            stopBtn.style.pointerEvents = "none";
        }

        // Tlačítko Vstoupit se ukáže POUZE, když je stav plně 'succeeded' a máme platnou URL
        if (isLabReady) { 
            window.currentLabUrl = savedUrl; 
            document.getElementById("labLinkContainer").style.display = savedUrl === "skip" ? "none" : "block";
            hideToast();
            if (!localStorage.getItem('lab_url_' + latestAttempt.attemptId)) {
                localStorage.setItem('lab_url_' + latestAttempt.attemptId, savedUrl);
            }
            // Spusť odpočet ihned při zobrazení zadání — bez čekání na kliknutí Vstoupit
            if (!localStorage.getItem('lab_start_' + latestAttempt.attemptId)) {
                const effectiveStart = window._labClickTime || Date.now();
                localStorage.setItem('lab_start_' + latestAttempt.attemptId, effectiveStart);
            }
        } else {
            // Lab se spouští, url možná je, ale ještě není hotovo -> SCHOVAT!
            document.getElementById("labLinkContainer").style.display = "none";
            window.currentLabUrl = null;
        }
    } else {
        startBtn.style.display = "inline-block";
        document.getElementById("stopBtn").style.display = "none";
        document.getElementById("labLinkContainer").style.display = "none";
    }

    updateStatusAndFeedback(latestAttempt, sub, state, currentRunNumber, scenario);

    /// AI SCÉNÁŘ — inicializace pro adaptive zadání
    if (isAdaptive && !isSubmittedOrEvaluated) {
        const attemptForAi = (latestAttempt && latestAttempt.status !== 'archived') ? latestAttempt : null;
        if (attemptForAi) {
            // Pokud AI container existoval, AI běží a attemptId je stejné → jen vrať DOM bez reinicializace (zabrání blikání)
            const _sameAttempt = window.aiScenario?._state?.attemptId === attemptForAi.attemptId;
            if (_aiContainerBackup && window.aiScenario?.isActive() && _sameAttempt) {
                const detailElNow = document.getElementById('scenarioDetail');
                const newContainer = document.getElementById('ai-scenario-container');
                if (detailElNow && newContainer) {
                    // Nahradíme nově vygenerovaný (prázdný) kontejner tím zálohovaným s vyplněnými daty
                    detailElNow.replaceChild(_aiContainerBackup, newContainer);
                } else if (detailElNow) {
                    detailElNow.appendChild(_aiContainerBackup);
                }
            } else {
                setTimeout(() => initAiScenarioSafe(scenario, attemptForAi, state, currentCourseId), 0);
            }
        }
    }

    // OBNOVA STAVU A ROZEPSANÝCH TEXTŮ PO PŘEKRESLENÍ DOM
    // Zobraz výsledek odevzdání pokud čekal na překreslení

    if (window._pendingStructuredRestore) {
        setTimeout(() => {
            window.restoreStructuredTaskDrafts();
            window.restoreStructuredHintsUi();
            window._pendingStructuredRestore = false;
            // Inicializuj CodeMirror editory pro code úkoly
            window.initStudentCodeEditors();
        }, 0);
    }

    if (window._pendingSequentialRestore) {
        setTimeout(() => {
            restoreStepProgress();
            window._pendingSequentialRestore = false;
        }, 0);
    }
    
    updateMaterialsLockState();
}