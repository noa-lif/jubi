"""
Transaction routes:
  GET    /api/transactions              – list for current user, filterable by year+month
  POST   /api/transactions              – create a new transaction
  PATCH  /api/transactions/{id}/category – inline category update from the dashboard table
  DELETE /api/transactions/{id}         – delete a transaction
  GET    /api/transactions/summary      – monthly aggregate (total + count)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import extract, func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db
from app.models.models import Category, Transaction, User
from app.schemas.schemas import (
    BatchDeleteRequest,
    MonthlySummaryResponse,
    TransactionCategoryUpdate,
    TransactionCreate,
    TransactionResponse,
)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _own_transaction_or_404(
    transaction_id: int, user: User, db: Session
) -> Transaction:
    """Helper: fetch a transaction that belongs to the current user, or raise 404."""
    txn = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.id == transaction_id, Transaction.user_id == user.id)
        .first()
    )
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return txn


@router.get("", response_model=list[TransactionResponse])
def list_transactions(
    year: int = Query(..., description="Filter by year, e.g. 2026"),
    month: int = Query(..., ge=1, le=12, description="Filter by month (1-12)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TransactionResponse]:
    """Return all transactions for the current user in the given month/year, newest first."""
    rows = (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(
            Transaction.user_id == current_user.id,
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
        )
        .order_by(Transaction.date.desc())
        .all()
    )
    return [TransactionResponse.from_orm_with_category(r) for r in rows]


@router.get("/summary", response_model=MonthlySummaryResponse)
def monthly_summary(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MonthlySummaryResponse:
    """Return the total spend and transaction count for a given month."""
    result = (
        db.query(
            func.coalesce(func.sum(Transaction.amount), 0).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .filter(
            Transaction.user_id == current_user.id,
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
        )
        .one()
    )
    return MonthlySummaryResponse(
        year=year,
        month=month,
        total=float(result.total),
        transaction_count=result.count,
    )


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    """Create a new expense transaction for the current user."""
    # Negative amounts are always income — force הכנסות category
    if payload.amount < 0:
        hachnasos = db.query(Category).filter_by(user_id=current_user.id, name="הכנסות").first()
        category_id = hachnasos.id if hachnasos else None
    elif payload.category_id is not None:
        cat = db.get(Category, payload.category_id)
        if not cat or cat.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid category",
            )
        category_id = payload.category_id
    else:
        shonot = db.query(Category).filter_by(user_id=current_user.id, name="שונות").first()
        category_id = shonot.id if shonot else None

    txn = Transaction(
        user_id=current_user.id,
        date=payload.date,
        amount=payload.amount,
        business_name=payload.business_name,
        category_id=category_id,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)

    # Reload with category relationship eagerly loaded for the response
    return TransactionResponse.from_orm_with_category(
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .get(txn.id)
    )


@router.patch("/{transaction_id}/category", response_model=TransactionResponse)
def update_transaction_category(
    transaction_id: int,
    payload: TransactionCategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    """
    Inline category update — called when the user selects a new category from the
    dropdown in the dashboard transactions table.
    """
    txn = _own_transaction_or_404(transaction_id, current_user, db)

    if txn.amount < 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Category of an income transaction cannot be changed",
        )

    if payload.category_id is not None:
        cat = db.get(Category, payload.category_id)
        if not cat or cat.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid category",
            )
        txn.category_id = payload.category_id
    else:
        shonot = db.query(Category).filter_by(user_id=current_user.id, name="שונות").first()
        txn.category_id = shonot.id if shonot else None
    db.commit()
    db.refresh(txn)

    return TransactionResponse.from_orm_with_category(
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .get(txn.id)
    )


@router.post("/batch-delete", status_code=status.HTTP_204_NO_CONTENT)
def batch_delete_transactions(
    payload: BatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete multiple transactions owned by the current user (used for undo-upload)."""
    if not payload.ids:
        return
    db.query(Transaction).filter(
        Transaction.id.in_(payload.ids),
        Transaction.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete a transaction owned by the current user."""
    txn = _own_transaction_or_404(transaction_id, current_user, db)
    db.delete(txn)
    db.commit()
