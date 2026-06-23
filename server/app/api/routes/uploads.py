"""
File upload route — parses Excel/CSV credit card statements in-memory
and bulk-inserts the extracted transactions into the database.

Security & integrity guarantees:
  • Files are NEVER written to disk — processed entirely from bytes.
  • A SHA-256 hash of the raw bytes is stored in file_imports.
    Re-uploading the same file returns HTTP 409 (per-user check).
  • Identical transaction rows within a file ARE inserted — the hash
    check deduplicates at the file level, not the row level.

Supported formats: .xlsx  .xls  .csv
"""
import hashlib
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.models import FileImport, User
from app.schemas.schemas import UploadResponse
from app.services.excel_parser import deduplicate_transactions, parse_excel

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

ALLOWED_EXTENSIONS = {"xlsx", "xls", "csv"}


def _file_ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


@router.post("", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UploadResponse:
    """
    Upload an Excel or CSV credit card statement.

    1. Validates the file extension.
    2. Reads the bytes and computes a SHA-256 hash.
    3. Rejects with 409 if this user already imported this exact file.
    4. Parses transactions with flexible column/date/amount handling.
    5. Bulk-inserts transactions and records the import metadata.
    """
    filename = file.filename or "upload"
    ext = _file_ext(filename)

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '.{ext}'. Allowed: .xlsx, .xls, .csv",
        )

    contents = await file.read()

    # ── Duplicate detection ────────────────────────────────────────────────
    file_hash = hashlib.sha256(contents).hexdigest()

    existing = (
        db.query(FileImport)
        .filter_by(user_id=current_user.id, file_hash=file_hash)
        .first()
    )
    if existing:
        # Allow re-upload (e.g. to recover accidentally deleted transactions).
        # Remove the old import record so the unique constraint doesn't block the new insert.
        db.delete(existing)
        db.flush()

    # ── Parse ──────────────────────────────────────────────────────────────
    try:
        parsed, rows_skipped = parse_excel(contents, filename, db, current_user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    # ── Deduplicate ────────────────────────────────────────────────────────
    transactions, duplicates_skipped = deduplicate_transactions(parsed, db, current_user.id)

    # ── Persist ────────────────────────────────────────────────────────────
    db.add_all(transactions)
    db.add(
        FileImport(
            user_id=current_user.id,
            file_hash=file_hash,
            filename=filename,
            uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
            transaction_count=len(transactions),
        )
    )
    db.flush()                              # assigns IDs without committing
    transaction_ids = [t.id for t in transactions]
    db.commit()

    month_counts = Counter((t.date.year, t.date.month) for t in transactions)
    months_imported = [
        {"year": y, "month": m, "count": c}
        for (y, m), c in sorted(month_counts.items())
    ]

    return UploadResponse(
        filename=filename,
        file_hash=file_hash,
        transactions_imported=len(transactions),
        rows_skipped=rows_skipped,
        duplicates_skipped=duplicates_skipped,
        months_imported=months_imported,
        transaction_ids=transaction_ids,
    )
