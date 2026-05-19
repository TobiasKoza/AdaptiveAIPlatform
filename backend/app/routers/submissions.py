import logging
import uuid
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import UpdateMode
from openai import BaseModel

from app.auth import get_current_user, require_course_membership, get_course_membership
from app.storage import get_submissions_table, get_attempts_table, utc_now_iso
from app.models.schemas import SubmissionCreateRequest, SubmissionEvaluateRequest
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Azure Table Storage hard limit: 64 KB per string property (≈ 32 000 UTF-16 chars).
# 60 000 is a safe ceiling; hitting it indicates a bug upstream.
_AZ_TABLE_STR_LIMIT = 30_000

def _guard_str(value: str | None, field: str) -> str:
    s = value or ""
    if len(s) > _AZ_TABLE_STR_LIMIT:
        logger.warning(
            "Submission field '%s' exceeds %d chars (%d) — truncating. "
            "Check that reference materials are not leaking into submission payloads.",
            field, _AZ_TABLE_STR_LIMIT, len(s),
        )
        return s[:_AZ_TABLE_STR_LIMIT]
    return s

router = APIRouter(tags=["Submissions"])

@router.post("/submissions")
def create_submission(payload: SubmissionCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    require_course_membership(payload.course_id, current_user["user_id"])
    
    if current_user.get("global_role") not in ["student", "teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění k odevzdání.")

    submissions = get_submissions_table()
    submission_id = f"sub-{uuid.uuid4().hex[:8]}"
    submitted_at = utc_now_iso()

    artifact_path = ""
    if payload.attempt_id:
        attempts = get_attempts_table()
        try:
            attempt = attempts.get_entity(partition_key="attempts", row_key=payload.attempt_id)
            if attempt.get("userId") != current_user["user_id"]:
                raise HTTPException(status_code=403, detail="Nemůžete odevzdat cizí attempt.")
            artifact_path = attempt.get("artifactPath", "")
        except ResourceNotFoundError:
            pass

    safe_content = _guard_str(payload.content_payload, "contentPayload")
    safe_steps   = _guard_str(payload.step_details,   "stepDetails")

    entity = {
        "PartitionKey": payload.course_id,
        "RowKey": submission_id,
        "submissionId": submission_id,
        "courseId": payload.course_id,
        "scenarioId": payload.scenario_id,
        "userId": current_user["user_id"],
        "attemptId": payload.attempt_id or "",
        "submissionType": payload.submission_type,
        "contentPayload": safe_content,
        "stepDetails": safe_steps,
        "artifactPath": artifact_path,
        "status": "submitted",
        "submittedAt": submitted_at,
        "score": None,
        "feedbackText": "",
        "evaluatedAt": "",
        "evaluatedBy": ""
    }

    submissions.create_entity(entity=entity)

    # Synchronizace do attempts, protože studentský i učitelský dashboard čtou stav právě odtud.
    if payload.attempt_id:
        attempts = get_attempts_table()
        attempts.upsert_entity(
            mode=UpdateMode.MERGE,
            entity={
                "PartitionKey": "attempts",
                "RowKey": payload.attempt_id,
                "learningStatus": "submitted",
                "submittedAt": submitted_at,
                "submissionNote": safe_content,
                "submittedArtifactPath": artifact_path,
                "updatedAt": submitted_at,
                **({"stepDetails": safe_steps} if payload.step_details else {}),
            }
        )
    
    return JSONResponse(
        status_code=201,
        content={
            "message": "Odevzdání bylo úspěšné.",
            "submissionId": submission_id,
            "status": "submitted"
        }
    )

@router.get("/courses/{course_id}/my-submissions")
def list_my_submissions(course_id: str, current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    require_course_membership(course_id, current_user["user_id"])
    submissions = get_submissions_table()
    result = []

    for entity in submissions.query_entities(query_filter=f"PartitionKey eq '{course_id}'"):
        if entity.get("userId") == current_user["user_id"]:
            result.append(dict(entity))

    result.sort(key=lambda x: x.get("submittedAt", ""), reverse=True)
    return result

@router.get("/courses/{course_id}/submissions")
def list_course_submissions(course_id: str, current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    membership = require_course_membership(course_id, current_user["user_id"])
    if membership.get("role_in_course") not in ["teacher", "assistant"] and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Pouze učitel vidí všechna odevzdání.")

    submissions = get_submissions_table()
    result = [dict(e) for e in submissions.query_entities(query_filter=f"PartitionKey eq '{course_id}'")]
    result.sort(key=lambda x: x.get("submittedAt", ""), reverse=True)
    return result


@router.post("/submissions/{submission_id}/evaluate")
def evaluate_submission(
    submission_id: str,
    payload: SubmissionEvaluateRequest,
    current_user=Depends(get_current_user)
) -> JSONResponse:
    submissions = get_submissions_table()

    # V MVP hledáme submission lineárně, protože neznáme PartitionKey (courseId) předem.
    submission = None
    for entity in submissions.list_entities():
        if entity.get("RowKey") == submission_id:
            submission = entity
            break

    if not submission:
        raise HTTPException(status_code=404, detail="Odevzdání nebylo nalezeno.")

    course_id = submission.get("courseId", "")
    membership = require_course_membership(course_id, current_user["user_id"])

    if membership.get("role_in_course") not in ["teacher", "assistant"] and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Hodnotit může pouze učitel nebo asistent.")

    evaluated_at = utc_now_iso()

    # Použijeme skutečný PartitionKey nalezené entity, aby byl zápis robustní i při změně partition strategie.
    submissions.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": submission.get("PartitionKey", course_id),
            "RowKey": submission_id,
            "status": "evaluated",
            "feedbackText": payload.feedback_text,
            "score": payload.score,
            "evaluatedAt": evaluated_at,
            "evaluatedBy": current_user["user_id"]
        }
    )

    # Synchronizace do attempts, protože UI čte didaktický stav odtud.
    attempt_id = submission.get("attemptId", "")
    if attempt_id:
        attempts = get_attempts_table()
        attempt_update: dict = {
            "PartitionKey": "attempts",
            "RowKey": attempt_id,
            "learningStatus": "evaluated",
            "feedbackText": payload.feedback_text,
            "feedbackAt": evaluated_at,
            "score": payload.score,
            "updatedAt": evaluated_at,
        }
        # Uloží body zpět do attempts, aby byly dostupné při příštím otevření hodnocení (např. v dashboardu).
        if payload.step_details:
            attempt_update["stepDetails"] = payload.step_details
        attempts.upsert_entity(mode=UpdateMode.MERGE, entity=attempt_update)

    return JSONResponse(
        status_code=200,
        content={
            "message": "Hodnocení uloženo.",
            "status": "evaluated"
        }
    )

class AutoArchiveRequest(BaseModel):
    score: float | None = None
    feedback_text: str | None = None

@router.post("/submissions/{submission_id}/auto-archive")
def auto_archive_attempt(
    submission_id: str,
    payload: AutoArchiveRequest = AutoArchiveRequest(),
    current_user=Depends(get_current_user)
) -> JSONResponse:
    """Auto-archivace pokusu po odevzdání AI cvičení bez hodnocení učitele (AUTO_SUBMIT)."""
    submissions = get_submissions_table()

    submission = None
    for entity in submissions.list_entities():
        if entity.get("RowKey") == submission_id:
            submission = entity
            break

    if not submission:
        raise HTTPException(status_code=404, detail="Odevzdání nebylo nalezeno.")

    if submission.get("userId") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Nemůžete archivovat cizí pokus.")

    attempt_id = submission.get("attemptId", "")
    if not attempt_id:
        raise HTTPException(status_code=400, detail="Submission nemá vazbu na pokus.")

    now = utc_now_iso()

    submissions.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": submission.get("PartitionKey"),
            "RowKey": submission_id,
            "status": "evaluated",
            "evaluatedAt": now,
            "evaluatedBy": "auto",
            **({"score": payload.score} if payload.score is not None else {}),
            **({"feedbackText": payload.feedback_text} if payload.feedback_text else {}),
        }
    )

    # Archivace pokusu umožní studentovi začít nový.
    attempts = get_attempts_table()
    attempts.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": "attempts",
            "RowKey": attempt_id,
            "status": "archived",
            "learningStatus": "evaluated",
            "feedbackText": payload.feedback_text or "Automaticky ohodnoceno.",
            **({"score": payload.score} if payload.score is not None else {}),
            "updatedAt": now,
        }
    )

    return JSONResponse(status_code=200, content={"message": "Pokus byl automaticky archivován."})


class SaveScoreRequest(BaseModel):
    score: float | None = None
    feedback_text: str | None = None

@router.post("/submissions/{submission_id}/save-score")
def save_score_pending_teacher(
    submission_id: str,
    payload: SaveScoreRequest = SaveScoreRequest(),
    current_user=Depends(get_current_user)
) -> JSONResponse:
    """Uloží AI skóre a feedback do submission, ale attempt NEARCHIVUJE — čeká na potvrzení učitelem."""
    submissions = get_submissions_table()

    submission = None
    for entity in submissions.list_entities():
        if entity.get("RowKey") == submission_id:
            submission = entity
            break

    if not submission:
        raise HTTPException(status_code=404, detail="Odevzdání nebylo nalezeno.")

    if submission.get("userId") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Nemůžete upravovat cizí odevzdání.")

    attempt_id = submission.get("attemptId", "")
    now = utc_now_iso()

    # Status zůstane "submitted", ale uložíme předběžné skóre.
    submissions.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": submission.get("PartitionKey"),
            "RowKey": submission_id,
            "evaluatedAt": now,
            "evaluatedBy": "ai-pending",
            **({"score": payload.score} if payload.score is not None else {}),
            **({"feedbackText": payload.feedback_text} if payload.feedback_text else {}),
        }
    )

    # Synchronizace do attempt pro UI, ale pokus zůstává aktivní (není archivován).
    if attempt_id:
        attempts = get_attempts_table()
        attempts.upsert_entity(
            mode=UpdateMode.MERGE,
            entity={
                "PartitionKey": "attempts",
                "RowKey": attempt_id,
                "learningStatus": "submitted",
                "feedbackText": payload.feedback_text or "",
                **({"score": payload.score} if payload.score is not None else {}),
                "updatedAt": now,
            }
        )

    return JSONResponse(status_code=200, content={"message": "Skóre uloženo, čeká na potvrzení učitelem."})


@router.post("/attempts/{scenario_id}/users/{user_id}/allow-next")
def allow_next_attempt(
    scenario_id: str,
    user_id: str,
    current_user=Depends(get_current_user)
) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Pouze učitel může povolit další pokus.")

    attempts = get_attempts_table()
    
    student_attempts = []
    for entity in attempts.list_entities():
        if entity.get("scenarioId") == scenario_id and entity.get("userId") == user_id:
            student_attempts.append(entity)
            
    if not student_attempts:
        raise HTTPException(status_code=404, detail="Student zatím nemá u tohoto zadání žádný pokus.")

    # Archivujeme nejnovější pokus, čímž uvolníme místo pro nový (UI filtr ignoruje archivované).
    student_attempts.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    latest_attempt = student_attempts[0]
    
    attempts.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": "attempts",
            "RowKey": latest_attempt.get("RowKey"),
            "status": "archived",
            "learningStatus": "archived"
        }
    )

    return JSONResponse(status_code=200, content={"message": "Další pokus byl povolen."})