# Project Management System

REST API backend untuk sistem manajemen proyek dan task. Dibangun dengan arsitektur berlapis (layered architecture) yang bersih, dilengkapi autentikasi JWT, RBAC tiga peran, Redis caching, dan background job via RabbitMQ.

## Tech Stack

| Layer | Teknologi |
|---|---|
| Runtime | Node.js >= 18.x |
| Framework | Express.js v4 |
| Database | MySQL 8.0 + Sequelize ORM v6 |
| Cache | Redis |
| Message Queue | RabbitMQ |
| Auth | JWT + bcrypt |
| Email | Nodemailer |

## Struktur Proyek

```
project-management-system/
├── src/
│   ├── config/          # database, redis, rabbitmq, mailer
│   ├── controllers/     # HTTP request/response handlers
│   ├── services/        # Business logic
│   ├── repositories/    # Data access layer (DB queries)
│   ├── models/          # Sequelize models
│   ├── middlewares/     # Auth, RBAC, Validation
│   ├── routes/          # Route definitions
│   ├── workers/         # RabbitMQ consumers (background jobs)
│   └── utils/           # responseHandler, treeHelper
├── migrations/          # SQL migration files
├── docs/                # Postman collection & API docs
├── .env.example         # Environment variable template
└── server.js            # Entry point
```

## Instalasi

### Prasyarat

- Node.js >= 18.x
- MySQL 8.0
- Redis
- RabbitMQ

### Langkah Setup

**1. Install dependencies**
```bash
npm install
```

**2. Konfigurasi environment**
```bash
cp .env.example .env
```

Isi `.env` dengan nilai yang sesuai:
```env
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_NAME=project_management
DB_USER=root
DB_PASSWORD=

JWT_SECRET=your_strong_jwt_secret_here
JWT_EXPIRES_IN=24h

REDIS_HOST=localhost
REDIS_PORT=6379

RABBITMQ_URL=amqp://user:password@localhost:5672

MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=your@email.com
MAIL_PASSWORD=your_app_password
MAIL_FROM=noreply@projectmanagement.com
```

**3. Buat database**
```sql
CREATE DATABASE project_management;
```

**4. Jalankan migrasi**

> Jika menggunakan MySQL tanpa password root:
```bash
mysql -u root project_management < migrations/001_create_users_table.sql
mysql -u root project_management < migrations/002_create_projects_table.sql
mysql -u root project_management < migrations/003_create_tasks_table.sql
mysql -u root project_management < migrations/004_create_indexes.sql
mysql -u root project_management < migrations/005_sample_data.sql
```

> Jika menggunakan password:
```bash
mysql -u root -p project_management < migrations/001_create_users_table.sql
# (masukkan password saat diminta, ulangi untuk 002-005)
```

> `005_sample_data.sql` menyertakan 4 user sample beserta data task untuk testing:
> - `admin@example.com` / `password123` (role: admin)
> - `john.manager@example.com` / `password123` (role: manager)
> - `alice@example.com` / `password123` (role: user)
> - `bob@example.com` / `password123` (role: user)

**5. Jalankan server**
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

**6. Jalankan worker** (terminal terpisah)
```bash
npm run worker
```

## API Endpoints

### Authentication `POST /api/auth`

| Method | Endpoint | Deskripsi | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Daftar akun baru | - |
| POST | `/api/auth/login` | Login, mendapat JWT token | - |
| GET | `/api/auth/profile` | Lihat profil sendiri | ✓ |
| POST | `/api/auth/logout` | Logout, invalidate token | ✓ |

### Users `GET /api/users` — Admin only

| Method | Endpoint | Deskripsi | Auth |
|---|---|---|---|
| GET | `/api/users` | Daftar semua user | Admin |
| GET | `/api/users/:id` | Detail user | Admin / Diri sendiri |
| POST | `/api/users` | Buat user baru | Admin |
| PUT | `/api/users/:id` | Update user | Admin / Diri sendiri |
| DELETE | `/api/users/:id` | Hapus user | Admin |
| PATCH | `/api/users/:id/status` | Toggle aktif/nonaktif | Admin |

### Projects `/api/projects`

| Method | Endpoint | Deskripsi | Auth |
|---|---|---|---|
| GET | `/api/projects` | Daftar project (admin: semua, user: milik sendiri) | ✓ |
| GET | `/api/projects/:id` | Detail project | ✓ |
| POST | `/api/projects` | Buat project baru | Admin |
| PUT | `/api/projects/:id` | Update project | Admin / Owner |
| DELETE | `/api/projects/:id` | Hapus project | Admin |

### Tasks `/api/tasks`

| Method | Endpoint | Deskripsi | Auth |
|---|---|---|---|
| GET | `/api/tasks` | Daftar task dengan pagination & filter | ✓ |
| GET | `/api/tasks/:id` | Detail task | ✓ |
| GET | `/api/tasks/tree?project_id=1` | Task tree per project | ✓ |
| GET | `/api/tasks/tree/all` | Semua task tree (Admin only) | Admin |
| GET | `/api/tasks/tree/metadata` | Tree dengan statistik | ✓ |
| POST | `/api/tasks` | Buat task baru | Admin / Manager |
| PUT | `/api/tasks/:id` | Update task | Admin / Manager / Assignee |
| DELETE | `/api/tasks/:id` | Hapus task | Admin / Manager (task assigned) |

> Dokumentasi lengkap dan contoh payload tersedia di `docs/Project_Management_API.postman_collection.json`

## Arsitektur

### Layered Architecture

```
Request → Route → Middleware → Controller → Service → Repository → Model → DB
                                    ↓
                              Response Handler
```

Setiap layer memiliki tanggung jawab tunggal:

- **Controller** — Terima request, validasi input HTTP, kirim response
- **Service** — Business logic, orchestration antar repository
- **Repository** — Semua query database, abstraksi dari ORM
- **Model** — Definisi schema + hooks (password hashing, dll.)

### RBAC (Role-Based Access Control)

Tiga role dengan hak akses berbeda:

| Role | Hak Akses |
|---|---|
| `admin` | Full access ke semua resource |
| `manager` | Buat/kelola project & task, tidak bisa hapus user |
| `user` | Baca data, update task yang di-assign ke dirinya |

### Caching Strategy (Redis)

- **Read-through**: GET task/project membaca cache terlebih dahulu
- **Cache invalidation**: CREATE/UPDATE/DELETE menghapus cache terkait
- **Logout blacklist**: Token JWT yang di-logout disimpan di Redis sampai expire
- **Key pattern**: `tasks:list:*`, `tasks:tree:{projectId}`, `task:{id}`

### Background Jobs (RabbitMQ)

- **Delay queue** menggunakan DLX (Dead Letter Exchange)
- Task yang melewati `due_date` dideteksi otomatis → status diubah ke `overdue`
- Notifikasi email dikirim ke assignee saat task dibuat atau overdue

### Recursive Tree Structure

Task mendukung hubungan parent-child tak terbatas:
- `parent_task_id` sebagai referensi ke task induk
- Tree dibangun di memori dengan `Map` (O(n)) setelah fetch flat list dari DB
- Tersedia: `buildTaskTree`, `buildTaskTreeWithMetadata`, `getTreeStatistics`, `getDescendantIds`

## Scripts

```bash
npm start        # Jalankan server production
npm run dev      # Jalankan server development (nodemon)
npm run worker   # Jalankan background worker
```

## Authors
Muammar Qathafi

