"""
Authentication routes:  POST /api/auth/signup  and  POST /api/auth/login
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.models import Category, User
from app.schemas.schemas import (
    LoginRequest,
    SignupRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Register a new user.
    Returns a JWT access token so the client is immediately authenticated.
    """
    # Reject duplicate email or ID number
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )
    if db.query(User).filter(User.id_number == payload.id_number).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this ID number already exists",
        )

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        id_number=payload.id_number,
    )
    db.add(user)
    db.flush()  # get user.id before creating categories

    db.add(Category(name="שונות", user_id=user.id))
    db.add(Category(name="הכנסות", user_id=user.id))
    db.commit()

    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Authenticate with email + password.
    Returns a JWT access token on success.
    """
    user = db.query(User).filter(User.email == payload.email).first()

    # Use a generic error to avoid leaking whether the email exists
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    """Return the currently authenticated user's profile."""
    return current_user
