import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from app.auth import get_current_user
from app.services.analytics_engine import (
    compute_course_summary,
    compute_student_performance,
    compute_at_risk_students,
    compute_skill_gaps,
    compute_step_statistics,
    compute_ai_weaknesses,
    generate_ai_summary,
    get_group_user_ids,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _require_teacher(current_user: dict):
    if current_user.get("global_role") not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Pouze pro učitele a adminy.")


@router.get("/course/{course_id}/summary")
async def get_course_summary(
    course_id: str,
    scenario_id: str | None = Query(None),
    group_id: str | None = Query(None),
    days: int = Query(30),
    current_user: dict = Depends(get_current_user),
):
    _require_teacher(current_user)
    user_ids = get_group_user_ids(group_id) if group_id else None
    data = compute_course_summary(course_id, scenario_id, days, user_ids=user_ids)
    skill_gaps = compute_skill_gaps(course_id, scenario_id=scenario_id, user_ids=user_ids)
    data["skill_gaps"] = skill_gaps
    return JSONResponse(content=data)


@router.get("/course/{course_id}/students")
async def get_student_performance(
    course_id: str,
    scenario_id: str | None = Query(None),
    group_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _require_teacher(current_user)
    user_ids = get_group_user_ids(group_id) if group_id else None
    students = compute_student_performance(course_id, scenario_id, user_ids=user_ids)
    return JSONResponse(content=students)


@router.get("/course/{course_id}/at-risk")
async def get_at_risk_students(
    course_id: str,
    scenario_id: str | None = Query(None),
    group_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _require_teacher(current_user)
    user_ids = get_group_user_ids(group_id) if group_id else None
    at_risk = compute_at_risk_students(course_id, scenario_id, user_ids=user_ids)
    return JSONResponse(content=at_risk)


@router.get("/course/{course_id}/scenario/{scenario_id}/steps")
async def get_scenario_steps(
    course_id: str,
    scenario_id: str,
    group_id: str | None = Query(None),
    variant_ids: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _require_teacher(current_user)
    user_ids = get_group_user_ids(group_id) if group_id else None
    vid_list = (
        [int(x) for x in variant_ids.split(",") if x.strip().isdigit()]
        if variant_ids else None
    )
    steps_data = compute_step_statistics(course_id, scenario_id, variant_ids=vid_list, user_ids=user_ids)
    return JSONResponse(content=steps_data)


class AISummaryRequest(BaseModel):
    course_id: str
    scenario_id: str | None = None
    days: int = 30


class AiWeaknessRequest(BaseModel):
    course_id: str
    scenario_id: str | None = None


@router.post("/ai-summary")
async def get_ai_summary(
    payload: AISummaryRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_teacher(current_user)
    import re as _re
    from app.storage import get_scenarios_table

    summary_data = compute_course_summary(payload.course_id, payload.scenario_id, payload.days)
    at_risk = compute_at_risk_students(payload.course_id, payload.scenario_id)
    skill_gaps = compute_skill_gaps(payload.course_id)
    step_stats = compute_step_statistics(payload.course_id, payload.scenario_id) if payload.scenario_id else []

    # Načti kontext zadání z grading_rubric scénáře
    scenario_context = ""
    scenario_title = ""
    if payload.scenario_id:
        try:
            scenarios_table = get_scenarios_table()
            scenario = scenarios_table.get_entity(partition_key="scenarios", row_key=payload.scenario_id)
            scenario_title = scenario.get("title", "")
            rubric = scenario.get("gradingRubric") or scenario.get("grading_rubric") or ""
            ctx_match = _re.search(r'\[AI_GLOBAL_CONTEXT\]([\s\S]*?)\[/AI_GLOBAL_CONTEXT\]', rubric, _re.IGNORECASE)
            if ctx_match:
                scenario_context = ctx_match.group(1).strip()
        except Exception:
            pass

    context = {
        **summary_data,
        "at_risk_students": at_risk,
        "skill_gaps": skill_gaps[:5],
        "step_stats": step_stats,
        "scenario_context": scenario_context,
        "scenario_title": scenario_title,
    }
    text = generate_ai_summary(context)
    return JSONResponse(content={"summary": text})


@router.post("/ai-weakness")
async def get_ai_weakness(
    payload: AiWeaknessRequest,
    current_user: dict = Depends(get_current_user),
):
    """Vygeneruje AI analýzu slabin studentů pro AI adaptivní zadání."""
    _require_teacher(current_user)
    analysis = compute_ai_weaknesses(payload.course_id, payload.scenario_id)
    return JSONResponse(content={"analysis": analysis})


@router.get("/course/{course_id}/export-csv")
async def export_csv(
    course_id: str,
    scenario_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _require_teacher(current_user)
    students = compute_student_performance(course_id, scenario_id)

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["userId", "displayName", "avg_score", "attempts", "trend", "last_activity"],
        extrasaction="ignore",
    )
    writer.writeheader()
    writer.writerows(students)

    output.seek(0)
    filename = f"analytics_{course_id}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
