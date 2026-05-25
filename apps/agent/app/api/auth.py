from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel
from app.infrastructure.config import settings

router = APIRouter()
DEMO_USER = {"username": "demo", "password": "demo1234"}
ALGORITHM = "HS256"
_security = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(req: LoginRequest):
    if req.username != DEMO_USER["username"] or req.password != DEMO_USER["password"]:
        raise HTTPException(401, "Invalid credentials")
    token = jwt.encode(
        {"sub": req.username, "exp": datetime.now(timezone.utc) + timedelta(hours=24)},
        settings.jwt_secret, algorithm=ALGORITHM,
    )
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me():
    return {"username": "demo"}


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_security)) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=[ALGORITHM])
        username: str = payload.get("sub") or payload.get("username")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
