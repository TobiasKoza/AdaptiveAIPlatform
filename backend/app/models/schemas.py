from typing import Optional

from pydantic import BaseModel, Field

class CourseCreateRequest(BaseModel):
    course_id: str = Field(..., alias="courseId")
    title: str
    description: str = ""
    status: str = "active"
    model_config = {"populate_by_name": True}

class CourseMemberCreateRequest(BaseModel):
    user_id: str = Field(..., alias="userId")
    role_in_course: str = Field(..., alias="roleInCourse")
    status: Optional[str] = "active"
    model_config = {"populate_by_name": True}

class LabTemplateCreateRequest(BaseModel):
    template_id: str = Field(..., alias="templateId")
    title: str
    lab_image: str = Field(..., alias="labImage")
    file_share_name: str = Field(default="labs", alias="fileShareName")
    mount_path: str = Field(default="/mnt/output", alias="mountPath")
    runtime_config: str = Field(default="{}", alias="runtimeConfig")
    timeout_seconds: int = Field(default=900, alias="timeoutSeconds")
    cpu: int = 1
    memory_gb: int = Field(default=1, alias="memoryGb")
    status: str = "active"
    model_config = {"populate_by_name": True}

class CustomLabTemplateCreateRequest(BaseModel):
    title: str
    base_image: str = Field(..., alias="baseImage")
    init_script: str = Field(default="", alias="initScript")
    description: str = ""
    timeout_seconds: int = Field(default=900, alias="timeoutSeconds")
    cpu: int = 1
    memory_gb: int = Field(default=2, alias="memoryGb")
    model_config = {"populate_by_name": True}

class ScenarioTemplateCreateRequest(BaseModel):
    scenario_template_id: str = Field(..., alias="scenarioTemplateId")
    linked_template_id: str = Field(..., alias="linkedTemplateId")
    title: str
    description: str = ""
    instructions: str = ""
    hints: str = ""
    difficulty: str = "easy"
    expected_outputs: str = Field(default="", alias="expectedOutputs")
    grading_rubric: str = Field(default="", alias="gradingRubric")
    required_os: str = Field(default="ubuntu", alias="requiredOs")
    status: str = "active"
    task_config_json: str = Field(default="", alias="taskConfigJson")
    model_config = {"populate_by_name": True}


class CourseScenarioCreateRequest(BaseModel):
    course_scenario_id: str = Field(..., alias="courseScenarioId")
    course_id: str = Field(..., alias="courseId")
    scenario_template_id: str = Field(..., alias="scenarioTemplateId")
    deadline: str = Field(default="", alias="deadline")
    max_attempts: int = Field(default=0, alias="maxAttempts")
    assigned_to_groups: str = Field(default="", alias="assigned_to_groups")
    status: str = "assigned"
    model_config = {"populate_by_name": True}

class ScenarioStartRequest(BaseModel):
    attempt_id: str | None = Field(default=None, alias="attemptId")
    lab_image: str | None = Field(default=None, alias="labImage")
    override_template_id: str | None = Field(default=None, alias="overrideTemplateId")
    model_config = {"populate_by_name": True}
"""
class AttemptSubmitRequest(BaseModel):
    submission_note: str = Field(default="", alias="submissionNote")
    model_config = {"populate_by_name": True}

class AttemptEvaluateRequest(BaseModel):
    feedback_text: str = Field(default="", alias="feedbackText")
    score: int | None = Field(default=None, alias="score")
    model_config = {"populate_by_name": True}
"""
class SubmissionCreateRequest(BaseModel):
    course_id: str = Field(..., alias="courseId")
    scenario_id: str = Field(..., alias="scenarioId")
    attempt_id: str | None = Field(default=None, alias="attemptId")
    submission_type: str = Field(default="artifact", alias="submissionType") # 'artifact', 'text', 'flag'
    content_payload: str = Field(default="", alias="contentPayload") # text studenta nebo flag
    step_details: str | None = Field(default=None, alias="stepDetails") # JSON string s per-krok daty
    model_config = {"populate_by_name": True}

class SubmissionEvaluateRequest(BaseModel):
    feedback_text: str = Field(default="", alias="feedbackText")
    score: int | None = Field(default=None, alias="score")
    step_details: str | None = Field(default=None, alias="stepDetails")  # JSON string s per-krok daty včetně image bodů
    model_config = {"populate_by_name": True}

class AssignmentCreateRequest(BaseModel):
    assignment_id: str = Field(..., alias="assignmentId")
    course_id: str = Field(..., alias="courseId")
    title: str
    lab_image: str = Field(..., alias="labImage")
    description: str = ""
    file_share_name: str = Field(default="labs", alias="fileShareName")
    mount_path: str = Field(default="/mnt/output", alias="mountPath")
    model_config = {"populate_by_name": True}

class AssignmentStartRequest(BaseModel):
    attempt_id: str | None = Field(default=None, alias="attemptId")
    model_config = {"populate_by_name": True}

# ==========================================
# IAM (Identity & Access Management) Schemas
# ==========================================

class UserCreateRequest(BaseModel):
    email: str
    display_name: str = Field(..., alias="displayName")
    global_role: str = Field(default="student", alias="globalRole")
    group_ids: list[str] = Field(default=[], alias="groupIds")
    course_ids: list[str] = Field(default=[], alias="courseIds")
    model_config = {"populate_by_name": True}

class UserCreateResponse(BaseModel):
    user_id: str = Field(..., alias="userId")
    email: str
    temp_password: str = Field(..., alias="tempPassword")
    external_entra_user_id: str = Field(..., alias="externalEntraUserId")
    model_config = {"populate_by_name": True}

class GroupCreateRequest(BaseModel):
    title: str
    description: str = ""
    status: str = "active"
    model_config = {"populate_by_name": True}

class GroupAssignRequest(BaseModel):
    user_id: str = Field(..., alias="userId")
    model_config = {"populate_by_name": True}