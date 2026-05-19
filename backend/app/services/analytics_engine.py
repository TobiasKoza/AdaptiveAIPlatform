import os
import re
import json
import statistics
from datetime import datetime, timezone, timedelta
from app.storage import get_attempts_table, get_users_table, get_groupmembers_table


def get_group_user_ids(group_id: str) -> set[str]:
    """
    Vrátí množinu user_id všech členů dané skupiny.

    :param group_id: ID skupiny (PartitionKey v groupmembers tabulce).
    :returns: Množina user_id řetězců.
    """
    table = get_groupmembers_table()
    return {e.get("RowKey", "") for e in table.query_entities(f"PartitionKey eq '{group_id}'")}


def _safe_score(val) -> float | None:
    """
    Bezpečně převede hodnotu na float; vrátí None při chybě nebo None vstupu.

    :param val: Hodnota ke konverzi.
    :returns: float nebo None.
    """
    try:
        return float(val) if val is not None else None
    except Exception:
        return None


def compute_course_summary(course_id: str, scenario_id: str | None = None, days: int = 30, user_ids: set | None = None) -> dict:
    """
    Agreguje statistiky kurzu ze záznamu attempts tabulky.

    Počítá průměr, medián, min, max, směrodatnou odchylku skóre všech pokusů,
    průměrný čas dokončení (createdAt → submittedAt), trend per den a rozložení
    průměrných skóre per student pro histogram.

    :param course_id: ID kurzu.
    :param scenario_id: Volitelný filtr na konkrétní zadání.
    :param days: Časové okno v dnech (nepoužito jako tvrdý cutoff, slouží pro trend).
    :param user_ids: Volitelná množina user_id pro filtrování (skupinový filtr).
    :returns: Dict se statistikami: avg_score, median_score, min_score, max_score,
              std_dev, avg_time_minutes, success_rate, trend, score_distribution.
    """
    attempts_table = get_attempts_table()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    subs = []
    for e in attempts_table.list_entities():
        if e.get("courseId") != course_id:
            continue
        if scenario_id and e.get("scenarioId") != scenario_id:
            continue
        if user_ids is not None and e.get("userId", "") not in user_ids:
            continue
        score = _safe_score(e.get("score"))
        submitted_at = e.get("submittedAt", "")
        started_at = e.get("createdAt", "")
        subs.append({"score": score, "submittedAt": submitted_at, "startedAt": started_at, "labReadyAt": e.get("labReadyAt", ""), "scenarioId": e.get("scenarioId", ""), "userId": e.get("userId", "")})

    evaluated = [s for s in subs if s["score"] is not None]
    scores = [s["score"] for s in evaluated]

    # Poslední hodnocený pokus per student — sledujeme nejvyšší submittedAt
    per_user_last: dict[str, tuple] = {}  # userId -> (submittedAt, score)
    for s in evaluated:
        uid = s["userId"]
        if uid not in per_user_last or s["submittedAt"] > per_user_last[uid][0]:
            per_user_last[uid] = (s["submittedAt"], s["score"])
    per_user_last_score = {uid: v[1] for uid, v in per_user_last.items()}

    avg_score = round(statistics.mean(scores), 1) if scores else 0
    median_score = round(statistics.median(scores), 1) if scores else 0
    min_score = round(min(scores), 1) if scores else 0
    max_score = round(max(scores), 1) if scores else 0
    std_dev = round(statistics.stdev(scores), 1) if len(scores) >= 2 else 0
    max_score = max(max(scores), 1) if scores else 1
    success_count = sum(1 for sc in scores if (sc / max_score * 100) >= 50)
    success_rate = round(success_count / len(scores) * 100, 1) if scores else 0

    durations = []
    for s in subs:
        # Použij labReadyAt (kdy byl lab připraven) místo createdAt (kdy student kliknul Start)
        start = s.get("labReadyAt") or s["startedAt"]
        if start and s["submittedAt"]:
            try:
                t1 = datetime.fromisoformat(start.replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(s["submittedAt"].replace("Z", "+00:00"))
                diff = (t2 - t1).total_seconds() / 60
                if 0 < diff < 480:
                    durations.append(diff)
            except Exception:
                pass
    avg_time_minutes = round(statistics.mean(durations), 1) if durations else None

    # Trend: per-day average over the window
    daily: dict[str, list] = {}
    for s in evaluated:
        day = s["submittedAt"][:10] if s["submittedAt"] else ""
        if day:
            daily.setdefault(day, []).append(s["score"])
    trend = [{"date": d, "avg": round(statistics.mean(v), 1)} for d, v in sorted(daily.items())]

    return {
        "total_submissions": len(subs),
        "evaluated_count": len(evaluated),
        "avg_score": avg_score,
        "median_score": median_score,
        "min_score": min_score,
        "max_score": max_score,
        "std_dev": std_dev,
        "avg_time_minutes": avg_time_minutes,
        "success_rate": success_rate,
        "trend": trend,
        "score_distribution": list(per_user_last_score.values()),
    }


def compute_student_performance(course_id: str, scenario_id: str | None = None, user_ids: set | None = None) -> list[dict]:
    """
    Vypočítá per-student výkonnostní metriky pro daný kurz.

    Pro každého studenta agreguje počet pokusů, průměrné skóre, trend (porovnání
    posledních dvou skóre) a datum poslední aktivity. Výsledek je seřazen vzestupně
    podle průměrného skóre (studenti bez skóre jsou na konci).

    :param course_id: ID kurzu.
    :param scenario_id: Volitelný filtr na konkrétní zadání.
    :param user_ids: Volitelná množina user_id pro skupinový filtr.
    :returns: Seznam dictů s klíči userId, displayName, avg_score, attempts, trend, last_activity.
    """
    attempts_table = get_attempts_table()
    users_table = get_users_table()

    user_cache: dict[str, str] = {}
    def get_display(uid: str) -> str:
        """Vrátí zobrazované jméno studenta; výsledek cachuje pro opakované volání."""
        if uid not in user_cache:
            try:
                u = users_table.get_entity(partition_key="users", row_key=uid)
                user_cache[uid] = u.get("displayName") or u.get("email") or uid
            except Exception:
                user_cache[uid] = uid
        return user_cache[uid]

    per_user: dict[str, dict] = {}
    for e in attempts_table.list_entities():
        if e.get("courseId") != course_id:
            continue
        if scenario_id and e.get("scenarioId") != scenario_id:
            continue
        uid = e.get("userId", "")
        if user_ids is not None and uid not in user_ids:
            continue
        score = _safe_score(e.get("score"))
        submitted_at = e.get("submittedAt", "")
        lab_ready_at = e.get("labReadyAt") or e.get("createdAt", "")
        duration_min: float | None = None
        if lab_ready_at and submitted_at:
            try:
                t1 = datetime.fromisoformat(lab_ready_at.replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
                diff = (t2 - t1).total_seconds() / 60
                if 0 < diff < 480:
                    duration_min = round(diff, 1)
            except Exception:
                pass
        if uid not in per_user:
            per_user[uid] = {"scored_attempts": [], "attempts": 0}
        per_user[uid]["attempts"] += 1
        if score is not None:
            per_user[uid]["scored_attempts"].append((submitted_at, score, duration_min))

    result = []
    for uid, data in per_user.items():
        # Seřaď ohodnocené pokusy podle data pro správný trend a last_score
        scored = sorted(data["scored_attempts"], key=lambda x: x[0])
        scores = [s[1] for s in scored]
        avg = round(statistics.mean(scores), 1) if scores else None
        last_score = scores[-1] if scores else None
        last_duration_minutes = scored[-1][2] if scored else None
        trend = "→"
        if len(scores) >= 2:
            trend = "↑" if scores[-1] > scores[-2] else ("↓" if scores[-1] < scores[-2] else "→")
        last_activity = scored[-1][0] if scored else ""
        result.append({
            "userId": uid,
            "displayName": get_display(uid),
            "avg_score": avg,
            "last_score": last_score,
            "last_duration_minutes": last_duration_minutes,
            "attempts": data["attempts"],
            "trend": trend,
            "last_activity": last_activity,
        })

    result.sort(key=lambda x: (x["last_score"] is None, x["last_score"] or 0))
    return result


def compute_at_risk_students(course_id: str, scenario_id: str | None = None, user_ids: set | None = None) -> list[dict]:
    """
    Identifikuje rizikové studenty na základě relativního výkonu (procenta z maxima).
    Rizikový = pod 60 % průměrného skóre nebo klesající trend.
    """
    students = compute_student_performance(course_id, scenario_id, user_ids=user_ids)
    if not students:
        return []

    # Zjisti max skóre ze všech studentů jako referenci
    scores = [s["avg_score"] for s in students if s["avg_score"] is not None]
    if not scores:
        return []
    max_score = max(scores) if scores else 1
    # Pokud max_score je velmi malé, použij absolutní hodnotu
    ref_max = max(max_score, 1)

    at_risk = []
    for s in students:
        risk_score = 0
        avg = s["avg_score"]
        if avg is None:
            risk_score += 3
        else:
            pct = (avg / ref_max) * 100
            if pct < 50:
                risk_score += 4   # F
            elif pct < 60:
                risk_score += 3   # E
            elif pct < 65:
                risk_score += 2   # slabé D
        if s["attempts"] >= 3:
            risk_score += 1
        if s["trend"] == "↓":
            risk_score += 2
        if risk_score >= 3:
            s["risk_level"] = "high" if risk_score >= 5 else "medium"
            s["risk_score"] = risk_score
            at_risk.append(s)
    at_risk.sort(key=lambda x: -x["risk_score"])

    # Přidej per-step detail pro každého rizikového studenta
    attempts_table = get_attempts_table()
    for s in at_risk:
        uid = s["userId"]
        weak_steps = []
        try:
            user_attempts = [
                e for e in attempts_table.list_entities()
                if e.get("userId") == uid and e.get("courseId") == course_id
                and (not scenario_id or e.get("scenarioId") == scenario_id)
                and e.get("status") == "archived"
            ]
            if user_attempts:
                # Vezmi nejnovější pokus
                latest = sorted(user_attempts, key=lambda x: x.get("submittedAt", ""), reverse=True)[0]
                step_details_raw = latest.get("stepDetails", "")
                if step_details_raw:
                    import json as _json
                    steps = _json.loads(step_details_raw)
                    for step in steps:
                        earned = step.get("points_earned", 0) or 0
                        max_pts = step.get("points_max") or step.get("max_points", 0) or 0
                        if max_pts > 0 and earned < max_pts:
                            weak_steps.append({
                                "step": step.get("step", "?"),
                                "label": (step.get("task_text") or step.get("title") or "")[:60],
                                "earned": earned,
                                "max": max_pts,
                            })
        except Exception:
            pass
        s["weak_steps"] = weak_steps[:5]

    return at_risk


_AI_TASK_RX = re.compile(
    r'Úkol\s+\d+\s+\[(\d+)/(\d+)\s*b\]:\s*\nOtázka:\s*([^\n]+)',
    re.MULTILINE
)

def compute_skill_gaps(course_id: str, scenario_id: str | None = None, user_ids: set | None = None) -> list[dict]:
    """
    Analyzuje chybovost per krok/podúkol pro daný kurz ze dvou zdrojů:

    1. Klasická zadání — pole stepDetails (JSON seznam kroků s points_earned/max_points).
    2. AI adaptivní zadání — pole submissionNote začínající '[AI_SCENARIO]',
       parsované regexem pro bloky 'Úkol N [X/Y b]: Otázka: ...'.

    Pro každý krok/podúkol počítá error_rate = (chybné pokusy / celkem pokusů) * 100.
    Výsledek je seřazen sestupně podle error_rate.

    :param course_id: ID kurzu.
    :param scenario_id: Volitelný filtr na konkrétní zadání.
    :param user_ids: Volitelná množina user_id pro skupinový filtr.
    :returns: Seznam dictů s klíči stepId, label, error_rate, total;
              seřazený od nejproblematičtějšího kroku.
    """
    attempts_table = get_attempts_table()
    step_errors: dict[str, dict] = {}

    for e in attempts_table.list_entities():
        if e.get("courseId") != course_id:
            continue
        if scenario_id and e.get("scenarioId") != scenario_id:
            continue
        if user_ids is not None and e.get("userId", "") not in user_ids:
            continue

        # Klasická zadání — step_details JSON
        step_details_raw = e.get("stepDetails") or e.get("step_details") or ""
        if step_details_raw:
            try:
                steps = json.loads(step_details_raw) if isinstance(step_details_raw, str) else step_details_raw
                if isinstance(steps, list):
                    for step in steps:
                        step_id_raw = str(step.get("step_id") or step.get("stepId") or "")
                        # Přeskoč AI podúkoly (step_id "ai-N") — ty se zpracovávají přes submissionNote
                        if step_id_raw.startswith("ai-"):
                            continue
                        # Klasický formát z student-submit.js: klíč "step" (integer index)
                        step_num = step.get("step")
                        if step_num is not None:
                            sid = str(int(step_num))
                            label = (step.get("task_text") or f"Krok {sid}")[:60]
                        elif step_id_raw:
                            sid = step_id_raw
                            label = (step.get("title") or step.get("label") or f"Krok {sid}")[:60]
                        else:
                            continue
                        pts = _safe_score(step.get("points_earned") or step.get("points") or step.get("earned"))
                        mx = _safe_score(step.get("max_points") or step.get("points_max") or step.get("maxPoints") or step.get("max"))
                        if sid not in step_errors:
                            step_errors[sid] = {"label": label, "total": 0, "errors": 0}
                        if pts is not None and mx is not None and mx > 0:
                            step_errors[sid]["total"] += 1
                            if pts < mx:
                                step_errors[sid]["errors"] += 1
            except Exception:
                pass

        # AI adaptivní zadání — parsuj submissionNote (= contentPayload) s [AI_SCENARIO] hlavičkou
        submission_note = e.get("submissionNote") or ""
        feedback_text = e.get("feedbackText") or ""
        search_text = submission_note + "\n\n" + feedback_text

        if submission_note.startswith("[AI_SCENARIO]"):
            for m in _AI_TASK_RX.finditer(search_text):
                pts = _safe_score(m.group(1))
                mx = _safe_score(m.group(2))
                question = m.group(3).strip()
                label = question[:60]
                sid = f"ai::{question[:50]}"
                if sid not in step_errors:
                    step_errors[sid] = {"label": label, "total": 0, "errors": 0}
                if pts is not None and mx is not None and mx > 0:
                    step_errors[sid]["total"] += 1
                    if pts < mx:
                        step_errors[sid]["errors"] += 1

    gaps = []
    for sid, d in step_errors.items():
        if d["total"] > 0:
            error_rate = round(d["errors"] / d["total"] * 100, 1)
            gaps.append({"stepId": sid, "label": d["label"], "error_rate": error_rate, "total": d["total"]})
    gaps.sort(key=lambda x: -x["error_rate"])
    return gaps


def compute_step_statistics(course_id: str, scenario_id: str, variant_ids: list[int] | None = None, user_ids: set | None = None) -> list[dict]:
    """
    Vypočítá statistiky úspěšnosti pro jednotlivé kroky zadání.
    Bere v potaz pouze POSLEDNÍ pokus každého studenta (per userId),
    aby osa X = počet unikátních studentů kteří odevzdali zadání.
    """
    attempts_table = get_attempts_table()

    # Krok 1: seber všechny relevantní pokusy, seskup per student → vezmi nejnovější
    all_attempts: dict[str, dict] = {}  # userId -> nejnovější entita

    for e in attempts_table.list_entities():
        if e.get("courseId") != course_id:
            continue
        if scenario_id and e.get("scenarioId") != scenario_id:
            continue
        uid = e.get("userId", "")
        if not uid:
            continue
        if user_ids is not None and uid not in user_ids:
            continue
        if variant_ids is not None:
            vi = e.get("variantIndex") or e.get("variant_index")
            try:
                if vi is None or int(vi) not in variant_ids:
                    continue
            except (ValueError, TypeError):
                continue
        # Ponechej jen nejnovější pokus studenta (podle submittedAt nebo createdAt)
        existing = all_attempts.get(uid)
        ts_new = e.get("submittedAt") or e.get("createdAt") or ""
        ts_old = existing.get("submittedAt") or existing.get("createdAt") or "" if existing else ""
        if existing is None or ts_new > ts_old:
            all_attempts[uid] = e

    step_stats: dict[str, dict] = {}
    valid_attempts_count = len(all_attempts)  # = počet unikátních studentů

    for e in all_attempts.values():
        attempt_scores = {}

        # 1. Klasická zadání (step_details)
        step_details_raw = e.get("stepDetails") or e.get("step_details") or ""
        if step_details_raw:
            try:
                steps = json.loads(step_details_raw) if isinstance(step_details_raw, str) else step_details_raw
                if isinstance(steps, list):
                    for step in steps:
                        step_id_raw = str(step.get("step_id") or step.get("stepId") or "")
                        if step_id_raw.startswith("ai-"):
                            continue

                        step_num = step.get("step")
                        if step_num is not None:
                            sid = str(int(step_num))
                            label = (step.get("task_text") or f"Krok {sid}")
                        elif step_id_raw:
                            sid = step_id_raw
                            label = (step.get("title") or step.get("label") or f"Krok {sid}")
                        else:
                            continue

                        pts_raw = None
                        mx_raw = None
                        
                        for k in ["points_earned", "points", "earned", "score", "pts", "awarded", "evaluated_points", "teacher_points", "ai_points"]:
                            if step.get(k) is not None and str(step.get(k)).strip() != "":
                                pts_raw = step.get(k)
                                break
                                
                        for k in ["max_points", "points_max", "maxPoints", "maxPts", "max", "max_score"]:
                            if step.get(k) is not None and str(step.get(k)).strip() != "":
                                mx_raw = step.get(k)
                                break
                        
                        pts = _safe_score(pts_raw)
                        mx = _safe_score(mx_raw)

                        if pts is None or mx is None:
                            text_to_search = str(step.get("feedback", "")) + " " + str(step.get("teacher_comment", "")) + " " + str(step.get("content", ""))
                            m = re.search(r'(?:\[|\b)(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*b?(?:\]|\b)', text_to_search, re.IGNORECASE)
                            if m:
                                pts = _safe_score(m.group(1))
                                mx = _safe_score(m.group(2))

                        if sid not in step_stats:
                            step_stats[sid] = {"label": label, "scores": []}

                        if mx is not None and mx > 0 and pts is not None:
                            attempt_scores[sid] = (pts, mx)
            except Exception:
                pass

        # 2. AI adaptivní zadání a fallback hledání pro všechny ostatní případy
        submission_note = e.get("submissionNote") or ""
        feedback_text = e.get("feedbackText") or ""
        search_text = submission_note + "\n\n" + feedback_text

        if submission_note.startswith("[AI_SCENARIO]"):
            for m in _AI_TASK_RX.finditer(search_text):
                pts = _safe_score(m.group(1))
                mx = _safe_score(m.group(2))
                question = m.group(3).strip()
                label = question
                sid = f"ai::{question[:50]}"

                if sid not in step_stats:
                    step_stats[sid] = {"label": label, "scores": []}

                if mx is not None and mx > 0 and pts is not None:
                    attempt_scores[sid] = (pts, mx)
        else:
            for m in re.finditer(r'(?:Krok|Úkol)\s*(\d+)[\s\S]{0,300}?(?:\[|\b)(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*b?(?:\]|\b)', search_text, re.IGNORECASE):
                sid = m.group(1)
                pts = _safe_score(m.group(2))
                mx = _safe_score(m.group(3))
                
                if sid not in step_stats:
                    step_stats[sid] = {"label": f"Krok {sid}", "scores": []}
                    
                if mx is not None and mx > 0 and pts is not None:
                    # Vždy přepíšeme body (i když už tam jsou 0 z prázdného step_details),
                    # protože nalezený feedback od AI/učitele je přesnější.
                    attempt_scores[sid] = (pts, mx)

        # Uložíme finální nalezené body za tento pokus
        for sid, (pts, mx) in attempt_scores.items():
            step_stats[sid]["scores"].append((pts, mx))

    result = []
    for sid, data in step_stats.items():
        f = 0
        p = 0
        z = 0
        
        for pts, mx in data["scores"]:
            if pts >= mx:
                f += 1
            elif pts > 0:
                p += 1
            else:
                z += 1
                
        # Chybějící záznamy pro tento krok (student odevzdal, ale krok nemá data)
        # → zobrazíme jako šedé (bez odpovědi), ne červené
        found_attempts = f + p + z
        skipped = valid_attempts_count - found_attempts if valid_attempts_count > found_attempts else 0

        total_for_step = f + p + z + skipped
        success_rate = round((f / total_for_step) * 100, 1) if total_for_step > 0 else 0

        result.append({
            "step_id": sid,
            "label": data["label"],
            "total_students": total_for_step,
            "total_attempts": total_for_step,
            "successful_students": f,
            "full_score_students": f,
            "partial_students": p,
            "zero_students": z,
            "skipped_students": skipped,
            "success_rate": success_rate,
        })

    return result


def compute_ai_weaknesses(course_id: str, scenario_id: str | None = None) -> str:
    """
    Analyzuje slabiny studentů v AI adaptivním zadání.

    Parsuje submissionNote (= contentPayload AI scénáře) pro každý attempt pomocí
    _AI_TASK_RX regexu. Agreguje otázky kde studenti dosáhli méně než 50 % bodů,
    sestaví statistiky a zavolá LLM (GPT-4o-mini přes GitHub Models endpoint)
    pro vygenerování strukturované analýzy v češtině.

    :param course_id: ID kurzu.
    :param scenario_id: Volitelné ID konkrétního AI zadání.
    :returns: Markdown string s analýzou slabin, nebo chybová zpráva při nedostatku dat/selhání API.
    """
    attempts_table = get_attempts_table()
    # question_text -> {total, failed, total_pts, max_pts_sum}
    question_stats: dict[str, dict] = {}

    for e in attempts_table.list_entities():
        if e.get("courseId") != course_id:
            continue
        if scenario_id and e.get("scenarioId") != scenario_id:
            continue
        submission_note = e.get("submissionNote") or ""
        feedback_text = e.get("feedbackText") or ""
        search_text = submission_note + "\n\n" + feedback_text

        if not submission_note.startswith("[AI_SCENARIO]"):
            continue
        for m in _AI_TASK_RX.finditer(search_text):
            pts = _safe_score(m.group(1))
            mx = _safe_score(m.group(2))
            question = m.group(3).strip()
            if question not in question_stats:
                question_stats[question] = {"total": 0, "failed": 0, "total_pts": 0.0, "max_pts_sum": 0.0}
            if pts is not None and mx is not None and mx > 0:
                question_stats[question]["total"] += 1
                question_stats[question]["total_pts"] += pts
                question_stats[question]["max_pts_sum"] += mx
                if pts < mx * 0.5:
                    question_stats[question]["failed"] += 1

    if not question_stats:
        return "Nedostatek dat pro analýzu slabin — studenti zatím neodevzdali AI zadání nebo data nemají správný formát."

    ranked = []
    for q, s in question_stats.items():
        if s["total"] > 0:
            failure_rate = round(s["failed"] / s["total"] * 100, 1)
            avg_pts = round(s["total_pts"] / s["total"], 1)
            avg_max = round(s["max_pts_sum"] / s["total"], 1)
            ranked.append({
                "question": q,
                "failure_rate": failure_rate,
                "total": s["total"],
                "failed": s["failed"],
                "avg_pts": avg_pts,
                "avg_max": avg_max,
            })
    ranked.sort(key=lambda x: -x["failure_rate"])
    top8 = ranked[:15]

    from app.services.ai_evaluator import get_ai_client
    client = get_ai_client()

    data_lines = "\n".join(
        f"  {i + 1}. Otázka: \"{r['question'][:120]}\"\n"
        f"     Chybovost: {r['failure_rate']}% ({r['failed']}/{r['total']} studentů), průměr: {r['avg_pts']}/{r['avg_max']} b."
        for i, r in enumerate(top8)
    )

    prompt = f"""Jsi analytik vzdělávacích výsledků kybernetické bezpečnosti. Na základě statistik odpovědí studentů na otázky AI adaptivního cvičení identifikuj hlavní slabiny a poskytni doporučení pro učitele.

STATISTIKY ODPOVĚDÍ STUDENTŮ (seřazeno od nejvyšší chybovosti):
{data_lines}

Vrať strukturovaný přehled v češtině (markdown, max 600 slov):

## Hlavní slabiny studentů
[2-3 věty o celkovém obrazu chybovosti]

## Témata s nejvyšší chybovostí
[bullet list — každá položka: téma/otázka, procento chybovosti, stručný komentář proč studenti selhávají]

## Doporučení pro výuku
[3-4 konkrétní akční doporučení pro učitele jak upravit výuku nebo co více procvičit]

Piš česky, odborně, konkrétně. Vyhni se obecným frázím."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Nepodařilo se vygenerovat analýzu slabin: {e}"


def generate_ai_summary(context: dict) -> str:
    """
    Vygeneruje strukturovaný AI přehled výkonu třídy pomocí LLM (GPT-4o-mini).

    Sestaví prompt z agregovaných dat kurzu, top 5 problematických kroků
    a bottom 5 rizikových studentů. Odpověď je v češtině ve formátu markdown
    se čtyřmi sekcemi: shrnutí, mezery ve znalostech, doporučení, rizikoví studenti.

    :param context: Dict s klíči avg_score, success_rate, total_submissions,
                    at_risk_students, skill_gaps, trend.
    :returns: Markdown string s AI přehledem, nebo chybová zpráva při selhání API.
    """
    from openai import OpenAI
    client = OpenAI(
        base_url="https://models.inference.ai.azure.com",
        api_key=os.getenv("GITHUB_TOKEN"),
    )

    avg = context.get("avg_score", 0)
    success_rate = context.get("success_rate", 0)
    total = context.get("total_submissions", 0)
    at_risk = context.get("at_risk_students", [])
    skill_gaps = context.get("skill_gaps", [])
    trend = context.get("trend", [])
    step_stats = context.get("step_stats", [])
    scenario_context = context.get("scenario_context", "")
    scenario_title = context.get("scenario_title", "")

    def _format_at_risk(s: dict) -> str:
        avg = s.get('avg_score')
        last_score = s.get('last_score') or avg
        step_stats_ctx = context.get('step_stats', [])
        total_max = sum(s2.get('avg_max', 0) or 0 for s2 in step_stats_ctx) if step_stats_ctx else 0
        max_pts = total_max if total_max > 0 else context.get('max_score', 100)
        pct = round((last_score / max_pts) * 100) if last_score is not None and max_pts else None
        grade = ''
        if pct is not None:
            if pct >= 90: grade = 'A'
            elif pct >= 75: grade = 'B'
            elif pct >= 60: grade = 'C'
            elif pct >= 50: grade = 'D'
            elif pct >= 30: grade = 'E'
            else: grade = 'F'
        grade_str = f", poslední pokus: {last_score} b. → {grade} ({pct}%)" if grade else ""
        lines = [f"  - {s.get('displayName', s.get('userId', '?'))}: průměr {avg} b.{grade_str} ({s.get('attempts', 0)} pokusů, trend {s.get('trend', '?')})"]
        # Přidej per-step detail pokud je dostupný
        weak_steps = s.get("weak_steps", [])
        if weak_steps:
            for ws in weak_steps[:4]:
                lines.append(f"    • Krok {ws['step']}: {ws['label']} — {ws['earned']}/{ws['max']} b.")
        return "\n".join(lines)

    at_risk_text = "\n".join(_format_at_risk(s) for s in at_risk) or "  Žádní rizikoví studenti."

    # Kroky seřazené podle úspěšnosti (nejhorší první)
    sorted_steps = sorted(step_stats, key=lambda x: x.get("success_rate", 100))
    steps_text = "\n".join(
        f"  - Krok {s.get('step_id', '?')}: {s.get('label', '?')} — {s.get('full_score_students', 0)} studentů plný počet, {s.get('partial_students', 0)} studentů částečný počet, {s.get('zero_students', 0)} studentů 0 bodů (celkem {s.get('total_students', 0)} studentů, úspěšnost {s.get('success_rate', 0):.0f}%)"
        for s in sorted_steps[:5]
    ) or "  Data o krocích nejsou dostupná."

    gaps_text = steps_text  # Použij skutečná data kroků místo skill_gaps

    trend_summary = ""
    if trend:
        first_avg = trend[0]["avg"] if trend else avg
        last_avg = trend[-1]["avg"] if trend else avg
        trend_summary = f"Trend posledních {len(trend)} dní: od {first_avg} b. na {last_avg} b."

    scenario_ctx_section = f"\nKONTEXT ZADÁNÍ ({scenario_title}):\n{scenario_context}\n" if scenario_context else ""

    prompt = f"""Jsi AI analytik výsledků studentů. Analyzuj data a poskytni strukturovaný přehled v češtině.
{scenario_ctx_section}
AGREGOVANÁ DATA KURZU:
- Celkový počet odevzdání: {total}
- Průměrné skóre třídy: {avg} bodů
- Míra úspěšnosti: {success_rate}%
- {trend_summary}

VÝSLEDKY PER KROK (seřazeno od nejhoršího):
{steps_text}

STUDENTI VYŽADUJÍCÍ POZORNOST:
{at_risk_text}

Poskytni odpověď PŘESNĚ v tomto strukturovaném formátu (markdown):

## Celkové shrnutí výkonu třídy
[2-3 věty o celkovém stavu, konkrétní čísla]

## Identifikované mezery ve znalostech
[bullet list max 4 položky — vycházej POUZE z dat kroků výše, uveď konkrétní název kroku/tématu]

## Doporučení pro výuku
[bullet list max 4 konkrétní doporučení — navázaná na problematické kroky výše]

## Rizikoví studenti
[bullet list — uveď VŠECHNY rizikové studenty. Ke každému uveď: průměr bodů, počet pokusů, a pro každý slabý krok uveď PŘESNĚ kolik bodů dostal z kolika (např. "Krok 3: 0/19 b."). Doporuč konkrétní postup. Nevymýšlej data která nemáš.]

Piš česky, formálně, konkrétně. Vycházej POUZE z dat která máš k dispozici. Nezmiňuj témata která nejsou v datech."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Nepodařilo se vygenerovat AI přehled: {e}"
