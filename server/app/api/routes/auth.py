"""
Authentication routes:  POST /api/auth/signup  and  POST /api/auth/login
"""
import secrets
from datetime import datetime, timedelta, timezone

import resend
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.models import Category, PasswordResetToken, User
from app.schemas.schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
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


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(User.email == payload.email).first()
    # Always return 200 to avoid leaking whether the email exists
    if not user:
        return {"message": "If that email exists, a reset link has been sent"}

    # Invalidate any existing unused tokens for this user
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False,
    ).delete()

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db.add(PasswordResetToken(user_id=user.id, token=token, expires_at=expires_at))
    db.commit()

    reset_link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    resend.api_key = settings.RESEND_API_KEY
    resend.Emails.send({
        "from": "JubiJubi <noreply@jubijubi.com>",
        "to": [user.email],
        "subject": "איפוס סיסמה - JubiJubi",
        "html": f"""
            <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
                <h2>איפוס סיסמה</h2>
                <p>קיבלנו בקשה לאיפוס הסיסמה שלך.</p>
                <p>לחץ על הקישור הבא לאיפוס הסיסמה (בתוקף לשעה אחת):</p>
                <a href="{reset_link}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:white;border-radius:8px;text-decoration:none;font-weight:bold">
                    איפוס סיסמה
                </a>
                <p style="color:#888;font-size:12px;margin-top:24px">אם לא ביקשת איפוס סיסמה, ניתן להתעלם מהודעה זו.</p>
            </div>
        """,
    })

    return {"message": "If that email exists, a reset link has been sent"}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict:
    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == payload.token,
        PasswordResetToken.used == False,
    ).first()

    if not record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="קישור האיפוס אינו תקין")

    if datetime.now(timezone.utc) > record.expires_at.replace(tzinfo=timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="פג תוקף קישור האיפוס")

    record.user.password_hash = hash_password(payload.password)
    record.used = True
    db.commit()

    return {"message": "הסיסמה עודכנה בהצלחה"}
