from fastapi import Header, HTTPException
from azure.core.exceptions import ResourceNotFoundError
from app.storage import get_users_table, get_coursemembers_table

def get_current_user(x_mock_user: str = Header(...)):
    users = get_users_table()
    try:
        user = users.get_entity(partition_key="USER", row_key=x_mock_user)
    except ResourceNotFoundError:
        raise HTTPException(status_code=401, detail="Neplatný mock uživatel.")

    if not user.get("is_active", False):
        raise HTTPException(status_code=403, detail="Uživatel není aktivní.")
    return user

def get_course_membership(course_id: str, user_id: str):
    coursemembers = get_coursemembers_table()
    try:
        return coursemembers.get_entity(partition_key=course_id, row_key=user_id)
    except ResourceNotFoundError:
        return None

def require_course_membership(course_id: str, user_id: str):
    # 1. KROK: Učitel a Admin mají absolutní přístup (Bypass)
    users = get_users_table()
    try:
        user = users.get_entity(partition_key="USER", row_key=user_id)
        if user.get("global_role") in ["teacher", "admin"]:
            # Vrátíme umělé členství s nejvyššími právy, aby endpointy nepadaly
            return {"role_in_course": "teacher", "user_id": user_id, "course_id": course_id}
    except Exception:
        pass

    # 2. KROK: Ostatní (studenti) musí být v kurzu zapsáni
    membership = get_course_membership(course_id, user_id)
    if not membership:
        raise HTTPException(status_code=403, detail="Uživatel není členem kurzu.")
    return membership