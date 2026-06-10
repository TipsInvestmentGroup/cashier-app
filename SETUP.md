# Cashier Sales & Receivables Management System

## Setup Guide

### Prerequisites
- Node.js 18+ installed
- PostgreSQL 14+ installed and running
- A PostgreSQL database created

### 1. Create PostgreSQL Database

```sql
CREATE DATABASE cashier_db;
```

### 2. Configure Environment

Edit `.env` and update `DATABASE_URL`:

```env
DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/cashier_db"
JWT_SECRET="your-super-secret-key-change-this"
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Set Up Database

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed with initial data
npm run db:seed
```

Or run all at once:
```bash
npm run setup
```

### 5. Start Development Server

```bash
npm run dev
```

Visit: http://localhost:3000

---

## Default Login Credentials

| Role        | Email                     | Password       |
|-------------|---------------------------|----------------|
| Admin       | admin@lounge.com          | admin123       |
| Cashier     | cashier@lounge.com        | cashier123     |
| Cashier 2   | cashier2@lounge.com       | cashier123     |
| Manager     | manager@lounge.com        | manager123     |
| Director    | director@lounge.com       | director123    |
| Accountant  | accountant@lounge.com     | accountant123  |

---

## Feature Overview

### Modules
1. **Dashboard** — Real-time KPIs, charts, trends
2. **Daily Collections** — Cash, CRDB, Stanbic, M-PESA
3. **Signed Bills** — Admin, Director, Customer, Tips, DJ, Staff Loss
4. **Paid Bills** — Record debt recoveries
5. **Receivables** — Outstanding balances with aging
6. **Reports** — Daily/Weekly/Monthly/Annual + CSV export
7. **Persons** — Manage customers, directors, admins
8. **Users** — User management (Admin only)
9. **Outlets** — Branch management

### User Roles
- **CASHIER** — Record collections and bills
- **ACCOUNTANT** — View reports, manage receivables
- **MANAGER** — View outlet performance
- **DIRECTOR** — Full dashboard access
- **ADMIN** — Full system access

---

## Architecture

```
cashier-app/
├── app/
│   ├── api/              # API routes (Next.js)
│   │   ├── auth/login/
│   │   ├── collections/
│   │   ├── signed-bills/
│   │   ├── paid-bills/
│   │   ├── receivables/
│   │   ├── reports/
│   │   ├── dashboard/
│   │   ├── persons/
│   │   ├── outlets/
│   │   └── users/
│   ├── dashboard/        # Dashboard page
│   ├── collections/      # Collections page
│   ├── signed-bills/     # Signed bills page
│   ├── paid-bills/       # Paid bills page
│   ├── receivables/      # Receivables page
│   ├── reports/          # Reports page
│   ├── persons/          # Persons page
│   ├── users/            # Users page
│   ├── outlets/          # Outlets page
│   └── login/            # Login page
├── components/
│   └── Layout/           # AppShell, Sidebar
├── contexts/             # Auth context
├── hooks/                # useApi hook
├── lib/                  # Prisma, Auth, Utils
├── prisma/               # Schema, seed
└── .env                  # Environment variables
```

## Production Deployment

### Environment Variables
```env
DATABASE_URL="postgresql://user:pass@prod-host:5432/cashier_db"
JWT_SECRET="super-long-random-secret-key-minimum-32-chars"
NODE_ENV="production"
```

### Build & Start
```bash
npm run build
npm start
```

### Cloud Deployment Options
- **Vercel** — Zero-config Next.js hosting
- **Railway** — Full-stack + PostgreSQL
- **Render** — Web service + PostgreSQL
- **DigitalOcean App Platform** — Managed deployment

### Database Hosting
- **Supabase** — Free PostgreSQL with web UI
- **Neon** — Serverless PostgreSQL
- **Railway PostgreSQL** — Simple setup

---

## Security Notes

- Passwords are bcrypt-hashed (cost 12)
- JWT tokens expire after 8 hours
- Role-based access control on all API endpoints
- Audit log tracks all create/update operations
- Input validation on all form fields
- SQL injection prevented by Prisma ORM
