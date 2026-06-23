"""
Category routes:
  GET    /api/categories        – list the user's own categories
  POST   /api/categories        – create a new category
  DELETE /api/categories/{id}   – delete a category (reassigns its transactions to שונות)

All categories are personal — every user manages their own list.
"שונות" is the only protected category and cannot be deleted.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.models import Category, Transaction, User
from app.schemas.schemas import CategoryCreate, CategoryResponse

router = APIRouter(prefix="/api/categories", tags=["categories"])

PROTECTED_NAMES = {"שונות", "הכנסות"}


def _get_shonot(user_id: int, db: Session) -> Category | None:
    return db.query(Category).filter_by(user_id=user_id, name="שונות").first()


@router.get("", response_model=list[CategoryResponse])
def list_categories(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CategoryResponse]:
    """Return all categories belonging to the current user, sorted by name."""
    rows = (
        db.query(Category)
        .filter(Category.user_id == current_user.id)
        .order_by(Category.name)
        .all()
    )
    return [CategoryResponse.from_orm_with_flag(r) for r in rows]


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    """Add a new category for the current user."""
    existing = (
        db.query(Category)
        .filter(
            Category.user_id == current_user.id,
            Category.name.ilike(payload.name),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Category '{payload.name}' already exists",
        )

    category = Category(name=payload.name, user_id=current_user.id)
    db.add(category)
    db.commit()
    db.refresh(category)
    return CategoryResponse.from_orm_with_flag(category)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """
    Delete a category owned by the current user.
    All transactions in this category are reassigned to 'שונות' first.
    'שונות' itself cannot be deleted.
    """
    category = db.query(Category).filter_by(id=category_id, user_id=current_user.id).first()

    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if category.name in PROTECTED_NAMES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"'{category.name}' is a protected category and cannot be deleted",
        )

    # Reassign transactions to שונות before deleting
    shonot = _get_shonot(current_user.id, db)
    db.query(Transaction).filter_by(category_id=category.id).update(
        {"category_id": shonot.id if shonot else None}
    )

    db.delete(category)
    db.commit()
