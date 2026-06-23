"""
Run this once to create a default user in the database.
Usage: python seed_user.py
"""
import bcrypt
from sqlalchemy.orm import Session
from app.db.database import engine
from app.db.init_db import init_db
from app.models.models import User

# ── Change these to whatever you want ──
EMAIL    = "noalif65@gmail.com"
PASSWORD = "noalif65"
ID_NUMBER = "318773629"
# ───────────────────────────────────────

init_db()  # make sure tables exist

with Session(engine) as session:
    existing = session.query(User).filter(User.email == EMAIL).first()
    if existing:
        print(f"User '{EMAIL}' already exists — nothing to do.")
    else:
        user = User(
            email=EMAIL,
            password_hash=bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode(),
            id_number=ID_NUMBER,
        )
        session.add(user)
        session.commit()
        print(f"✓ User '{EMAIL}' created successfully.")
