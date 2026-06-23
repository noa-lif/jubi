# 💰 Spendi — MVP Scaffold

A personal monthly expense tracker built with **FastAPI + React (Vite + Tailwind CSS)**.

---

## Project Structure

```
expense-tracker/
├── client/                        # React frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── api/                   # Axios API wrappers (auth, transactions, categories, uploads)
│   │   ├── components/
│   │   │   ├── auth/              # LoginForm, SignupForm
│   │   │   ├── dashboard/         # MonthNavigator, ExpenseSummaryWidget, TransactionsTable, FileUploadWidget
│   │   │   ├── layout/            # AppLayout (sidebar + outlet)
│   │   │   └── ui/                # Button, Input (reusable primitives)
│   │   ├── context/               # AuthContext (JWT state)
│   │   ├── hooks/                 # useAuth
│   │   └── pages/                 # AuthPage, DashboardPage, CategoriesPage
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
│
└── server/                        # FastAPI backend
    ├── app/
    │   ├── api/
    │   │   ├── deps.py            # get_db, get_current_user
    │   │   └── routes/
    │   │       ├── auth.py        # POST /signup, POST /login, GET /me
    │   │       ├── categories.py  # CRUD for categories
    │   │       ├── transactions.py# CRUD + monthly summary + inline category update
    │   │       └── uploads.py     # File upload placeholder
    │   ├── core/
    │   │   ├── config.py          # Pydantic-settings (.env)
    │   │   └── security.py        # bcrypt + JWT helpers
    │   ├── db/
    │   │   ├── database.py        # SQLAlchemy engine + session factory
    │   │   └── init_db.py         # Table creation + system category seeding
    │   ├── models/
    │   │   └── models.py          # User, Category, Transaction ORM models
    │   ├── schemas/
    │   │   └── schemas.py         # Pydantic v2 request/response schemas
    │   └── main.py                # FastAPI app + CORS + router registration
    ├── requirements.txt
    └── .env.example
```

---

## Quick Start

### 1. Backend

```bash
cd server

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and set a strong SECRET_KEY

# Start the dev server (tables + seed data created automatically on first run)
uvicorn app.main:app --reload
# → http://localhost:8000
# → http://localhost:8000/docs  (Swagger UI)
```

### 2. Frontend

```bash
cd client

npm install
npm run dev
# → http://localhost:5173
```

---

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Register (email, password, id_number) |
| POST | `/api/auth/login` | Login → JWT |
| GET  | `/api/auth/me` | Current user profile |
| GET  | `/api/transactions?year=&month=` | Monthly transactions |
| GET  | `/api/transactions/summary?year=&month=` | Total + count |
| POST | `/api/transactions` | Create transaction |
| PATCH | `/api/transactions/{id}/category` | Inline category update |
| DELETE | `/api/transactions/{id}` | Delete transaction |
| GET  | `/api/categories` | List all categories |
| POST | `/api/categories` | Create custom category |
| DELETE | `/api/categories/{id}` | Delete custom category |
| POST | `/api/uploads` | File upload (placeholder) |

---

## Next Steps

- **File parsing:** Implement Pandas-based XLSX/CSV/PDF parsing inside `/api/uploads`
- **Add transaction form:** UI modal to add transactions manually
- **Charts:** Monthly spend breakdown by category (Recharts / Chart.js)
- **Alembic migrations:** Replace `create_all` with versioned migrations for production
- **Docker Compose:** Containerise both services for deployment
