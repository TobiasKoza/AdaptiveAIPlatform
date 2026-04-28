import os
import uuid

class MicrosoftGraphService:
    def __init__(self):
        self.is_enabled = os.getenv("ENTRA_GRAPH_ENABLED", "false").lower() == "true"

    def create_entra_user(self, email: str, display_name: str) -> dict:
        # Heslo přesně podle toho, co je před @ (např. "jan.novak" z "jan.novak@skola.cz")
        temp_password = email.split('@')[0]

        if not self.is_enabled:
            return {
                "entra_user_id": str(uuid.uuid4()),
                "temp_password": temp_password,
                "status": "mocked"
            }

        raise NotImplementedError("Real Microsoft Graph API is not yet enabled.")

graph_service = MicrosoftGraphService()