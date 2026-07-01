"""
Pydantic v2 schemas for request validation and response serialisation.
Keeps API contracts decoupled from ORM models.
"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    id_number: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("id_number")
    @classmethod
    def id_number_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("ID number cannot be empty")
        padded = v.zfill(9)
        if not padded.isdigit() or len(padded) != 9:
            raise ValueError("Invalid Israeli ID number")
        total = sum(
            (n - 9 if (n := int(d) * (1 if i % 2 == 0 else 2)) > 9 else n)
            for i, d in enumerate(padded)
        )
        if total % 10 != 0:
            raise ValueError("Invalid Israeli ID number")
        return padded


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
    id_number: str


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------

class CategoryCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Category name cannot be empty")
        return v.strip()


class CategoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    # True when this is a system default (no owner)
    is_system: bool = False

    @classmethod
    def from_orm_with_flag(cls, obj) -> "CategoryResponse":
        return cls(id=obj.id, name=obj.name, is_system=obj.name in {"שונות", "הכנסות"})


# ---------------------------------------------------------------------------
# Transaction
# ---------------------------------------------------------------------------

class TransactionCreate(BaseModel):
    date: date
    amount: float
    business_name: str
    category_id: Optional[int] = None

    @field_validator("amount")
    @classmethod
    def amount_not_zero(cls, v: float) -> float:
        if v == 0:
            raise ValueError("Amount cannot be zero")
        return v


class TransactionCategoryUpdate(BaseModel):
    """Lightweight schema for inline category editing from the dashboard table."""
    category_id: Optional[int] = None


class TransactionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    date: date
    amount: float
    business_name: str
    category_id: Optional[int]
    category_name: Optional[str] = None

    @classmethod
    def from_orm_with_category(cls, obj) -> "TransactionResponse":
        return cls(
            id=obj.id,
            date=obj.date,
            amount=obj.amount,
            business_name=obj.business_name,
            category_id=obj.category_id,
            category_name=obj.category.name if obj.category else None,
        )


class MonthlySummaryResponse(BaseModel):
    year: int
    month: int
    total: float
    transaction_count: int


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------

class MonthImported(BaseModel):
    year: int
    month: int
    count: int


class UploadResponse(BaseModel):
    filename: str
    file_hash: str
    transactions_imported: int
    rows_skipped: int
    duplicates_skipped: int
    months_imported: list[MonthImported]
    transaction_ids: list[int] = []


class BatchDeleteRequest(BaseModel):
    ids: list[int]
