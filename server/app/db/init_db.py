"""
Database initialisation: creates all tables and ensures every user has
the protected 'שונות' and 'הכנסות' categories.
Called once at application startup.
"""
from sqlalchemy.orm import Session

from app.db.database import Base, engine
from app.models.models import Category, FileImport, User  # noqa: F401 — ensures models are registered

PROTECTED_CATEGORIES = ["שונות", "הכנסות"]


def _ensure_protected_categories(session: Session) -> None:
    """Create any missing protected categories for every existing user."""
    users = session.query(User).all()
    for user in users:
        for name in PROTECTED_CATEGORIES:
            exists = session.query(Category).filter_by(user_id=user.id, name=name).first()
            if not exists:
                session.add(Category(name=name, user_id=user.id))
    session.commit()


def init_db() -> None:
    """Create tables and guarantee every user has the protected categories."""
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        _ensure_protected_categories(session)
