"""
Excel/CSV parser for credit card statements.

Strategy:
  1. Read the file entirely in-memory — no disk writes ever.
  2. Auto-detect the header row by scanning up to the first 20 rows for the
     one that contains the most known column alias hits.
  3. Build a col_map: canonical name → actual DataFrame column name.
  4. For every data row: skip empties / summary totals, clean the amount,
     parse a flexible date, resolve the category (creating it if new).
  5. Return the Transaction ORM objects ready for bulk insert — the caller
     commits the session.
"""
from __future__ import annotations

import io
import re
from collections import Counter
from datetime import date, datetime
from typing import Optional

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Category, Transaction

# ---------------------------------------------------------------------------
# Column alias registry
# Extend any set here to support additional credit-card statement formats.
# ---------------------------------------------------------------------------

COLUMN_ALIASES: dict[str, set[str]] = {
    "amount": {
        "amount", "סכום", "סכום עסקה", "סכום חיוב", 'סכום בש"כ', "סכום בשקלים",
        "charge amount", "charged amount", "debit", "credit", "sum",
        "transaction amount",
    },
    "date": {
        "date", "תאריך", "תאריך עסקה", "תאריך רכישה", "תאריך פעולה",
        "transaction date", "purchase date", "פעולה תאריך",
    },
    "business_name": {
        "business name", "business", "שם בית עסק", "שם בית העסק", "שם עסק", "שם בית-עסק",
        "merchant", "תיאור", "תאור", "description", "name", "פירוט",
        "details", "בית עסק",
    },
    "category": {
        "category", "קטגוריה", "ענף", "תחום", "category name",
    },
}

# Regex that matches summary/total rows we should skip
_SUMMARY_RE = re.compile(
    r'סה[״"’\']?כ|סהכ|total|grand total|subtotal',
    re.IGNORECASE,
)

# Explicit date formats tried in order when pandas flexible parser fails
_DATE_FORMATS = [
    "%d/%m/%Y", "%d/%m/%y",
    "%d-%m-%Y", "%d-%m-%y",
    "%d.%m.%Y", "%d.%m.%y",
    "%Y-%m-%d",
    "%m/%d/%Y", "%m/%d/%y",
    "%Y/%m/%d",
]


# ---------------------------------------------------------------------------
# File loading
# ---------------------------------------------------------------------------

def _load_raw(contents: bytes, filename: str) -> pd.DataFrame:
    """Read the file into a raw DataFrame with no header (all strings)."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    buf = io.BytesIO(contents)

    if ext == "xlsx":
        return pd.read_excel(buf, header=None, dtype=str, engine="openpyxl")
    if ext == "xls":
        return pd.read_excel(buf, header=None, dtype=str, engine="xlrd")
    if ext == "csv":
        for enc in ("utf-8-sig", "utf-8", "cp1255", "iso-8859-8", "latin-1"):
            try:
                buf.seek(0)
                return pd.read_csv(buf, header=None, dtype=str, encoding=enc)
            except UnicodeDecodeError:
                continue
        raise ValueError("Could not decode CSV file — unsupported encoding.")
    raise ValueError(f"Unsupported file extension: .{ext!r}")


# ---------------------------------------------------------------------------
# Header detection
# ---------------------------------------------------------------------------

def _find_header_row(raw: pd.DataFrame) -> int:
    """
    Scan the first 20 rows and return the index of the row that contains
    the most hits against known column aliases.
    Falls back to row 0 if nothing matches.
    """
    all_aliases: set[str] = {a for aliases in COLUMN_ALIASES.values() for a in aliases}
    best_idx, best_score = 0, 0
    for i, row in raw.head(20).iterrows():
        cell_values = {
            str(v).strip().lower()
            for v in row
            if pd.notna(v) and str(v).strip()
        }
        score = len(cell_values & all_aliases)
        if score > best_score:
            best_score, best_idx = score, i
    return best_idx


def _build_col_map(columns: pd.Index) -> dict[str, str]:
    """Return {canonical_name: actual_column_name} for every alias that matches."""
    col_map: dict[str, str] = {}
    for col in columns:
        col_lower = str(col).strip().lower()
        for canonical, aliases in COLUMN_ALIASES.items():
            if col_lower in aliases and canonical not in col_map:
                col_map[canonical] = col
                break
    return col_map


# ---------------------------------------------------------------------------
# Row-level helpers
# ---------------------------------------------------------------------------

def _is_skip_row(row: pd.Series, business_col: Optional[str]) -> bool:
    """True for fully-empty rows and summary/total rows."""
    non_empty = [v for v in row if pd.notna(v) and str(v).strip()]
    if not non_empty:
        return True
    if business_col:
        val = str(row.get(business_col, "")).strip()
        if _SUMMARY_RE.search(val):
            return True
    return False


def _clean_amount(raw) -> float:
    """
    Strip currency symbols (₪ $ € £), thousands separators, and whitespace.
    Convert accounting-style negatives "(100.00)" → -100.00.
    """
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        raise ValueError(f"Empty amount: {raw!r}")
    s = re.sub(r"[₪$€£,\s\xa0]", "", s)
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        raise ValueError(f"Cannot parse amount: {raw!r}")


def _parse_date(raw) -> date:
    """Parse a date value that may be a Python date, datetime, or string."""
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        raise ValueError(f"Empty date: {raw!r}")
    # Pandas flexible parser — handles many ISO and locale formats
    try:
        return pd.to_datetime(s, dayfirst=True).date()
    except Exception:
        pass
    # Explicit format fallback
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {raw!r}")


def _resolve_category(
    name: Optional[str],
    db: Session,
    user_id: int,
    cache: dict[str, int],
) -> int:
    """
    Return the id of the category matching *name*.

    Lookup order:
      1. In-memory cache (avoids repeated DB queries for the same name).
      2. System categories (user_id IS NULL) — case-insensitive.
      3. User-owned categories — case-insensitive.
      4. Create a new user-owned category and flush to obtain its id.

    Falls back to "Other" when *name* is empty, NaN, or None.
    """
    # Normalise: empty / NaN → "Other"
    target = (
        name.strip()
        if name and name.strip().lower() not in ("nan", "none", "")
        else "שונות"
    )

    if target in cache:
        return cache[target]

    cat = (
        db.query(Category)
        .filter(
            func.lower(Category.name) == target.lower(),
            Category.user_id == user_id,
        )
        .first()
    )

    if not cat:
        cat = Category(name=target, user_id=user_id)
        db.add(cat)
        db.flush()  # assign cat.id without committing the outer transaction

    cache[target] = cat.id
    return cat.id


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def deduplicate_transactions(
    parsed: list[Transaction],
    db: Session,
    user_id: int,
) -> tuple[list[Transaction], int]:
    """
    Frequency-based row-level deduplication against the existing DB.

    A transaction's identity is (date, amount, business_name).
    Legitimate duplicates on the same day are allowed — the system inserts
    exactly (file_count − db_count) rows for each key, where that difference
    is positive.

    Single DB round-trip: queries only the dates present in the uploaded file.

    Returns:
        (transactions_to_insert, duplicates_skipped)
    """
    if not parsed:
        return [], 0

    def _key(t: Transaction) -> tuple:
        return (t.date, round(t.amount, 2), t.business_name)

    # Count how many times each key appears in the file
    file_counts: Counter[tuple] = Counter(_key(t) for t in parsed)

    # Fetch existing DB rows for those dates in one query
    unique_dates = list({k[0] for k in file_counts})
    existing = (
        db.query(Transaction.date, Transaction.amount, Transaction.business_name)
        .filter(
            Transaction.user_id == user_id,
            Transaction.date.in_(unique_dates),
        )
        .all()
    )
    db_counts: Counter[tuple] = Counter(
        (row.date, round(row.amount, 2), row.business_name) for row in existing
    )

    # Group parsed transactions by key (preserving original order within each group)
    groups: dict[tuple, list[Transaction]] = {}
    for t in parsed:
        groups.setdefault(_key(t), []).append(t)

    to_insert: list[Transaction] = []
    duplicates_skipped = 0
    for key, txns in groups.items():
        n = max(0, file_counts[key] - db_counts.get(key, 0))
        to_insert.extend(txns[:n])
        duplicates_skipped += len(txns) - n

    return to_insert, duplicates_skipped


def parse_excel(
    contents: bytes,
    filename: str,
    db: Session,
    user_id: int,
) -> tuple[list[Transaction], int]:
    """
    Parse an in-memory Excel or CSV file into Transaction ORM objects.

    The caller is responsible for committing the session after adding
    the returned transactions.

    Returns:
        (transactions, rows_skipped)
        *rows_skipped* counts empty rows, summary rows, and unparseable rows.

    Raises:
        ValueError — if the file cannot be loaded, required columns are
                     missing, or no valid transactions were found.
    """
    raw = _load_raw(contents, filename)
    header_idx = _find_header_row(raw)

    # Build column names from the detected header row, replacing NaN cells
    col_names = [
        str(c).strip() if pd.notna(c) and str(c).strip() else f"_col_{i}"
        for i, c in enumerate(raw.iloc[header_idx])
    ]
    data = raw.iloc[header_idx + 1:].reset_index(drop=True).copy()
    data.columns = col_names

    col_map = _build_col_map(data.columns)

    required = {"amount", "date", "business_name"}
    missing = required - col_map.keys()
    if missing:
        visible_cols = [c for c in data.columns if not c.startswith("_col_")]
        raise ValueError(
            f"Could not find required columns: {missing}. "
            f"Columns detected in file: {visible_cols}"
        )

    cat_cache: dict[str, int] = {}
    transactions: list[Transaction] = []
    rows_skipped = 0
    business_col = col_map.get("business_name")

    for _, row in data.iterrows():
        if _is_skip_row(row, business_col):
            rows_skipped += 1
            continue

        try:
            amount = _clean_amount(row[col_map["amount"]])
            parsed_date = _parse_date(row[col_map["date"]])
            business = str(row[col_map["business_name"]]).strip()

            if not business or business.lower() == "nan":
                rows_skipped += 1
                continue

            raw_cat = row.get(col_map["category"]) if "category" in col_map else None
            cat_name: Optional[str] = None
            if raw_cat is not None and pd.notna(raw_cat):
                cat_name = str(raw_cat).strip() or None

            if amount < 0:
                category_id = _resolve_category("הכנסות", db, user_id, cat_cache)
            else:
                category_id = _resolve_category(cat_name, db, user_id, cat_cache)

            transactions.append(
                Transaction(
                    user_id=user_id,
                    date=parsed_date,
                    amount=amount,
                    business_name=business,
                    category_id=category_id,
                )
            )
        except Exception:
            rows_skipped += 1
            continue

    if not transactions:
        raise ValueError(
            "No valid transactions were found in the file. "
            "Ensure it contains Date, Amount, and Business Name columns."
        )

    return transactions, rows_skipped
