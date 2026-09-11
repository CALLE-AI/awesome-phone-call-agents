from app.api.dependencies import get_agent_service, get_current_user
from app.models.orm import User
from app.models.schemas import AgentChatRequest, AgentChatResponse
from app.services.agent_service import AgentService, AgentServiceError
from fastapi import APIRouter, Depends, HTTPException, status

router = APIRouter()


@router.post("/chat", response_model=AgentChatResponse)
def agent_chat(
    body: AgentChatRequest,
    _: User = Depends(get_current_user),
    service: AgentService = Depends(get_agent_service),
):
    try:
        return service.chat(message=body.message, history=body.history)
    except AgentServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc