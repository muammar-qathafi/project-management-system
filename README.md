# Project Management System

REST API backend untuk sistem manajemen proyek dan task. Dibangun dengan arsitektur berlapis (layered architecture) yang bersih, dilengkapi autentikasi JWT (HS256), RBAC tiga peran, Redis caching, dan background job via RabbitMQ.

## Tech Stack

| Layer | Teknologi |
|---|---|
| Runtime | Node.js >= 18.x |
| Framework | Express.js v4 |
| Database | MySQL 8.0 + Sequelize ORM v6 |
| Cache | Redis |
| Message Queue | RabbitMQ |
| Auth | JWT (HS256) + bcrypt |
| Email | Nodemailer |
| Logging | Pino + pino-http |
| Rate Limiting | express-rate-limit |

## Struktur Proyek

```
project-management-system/
├── src/
│   ├── app.js           # Express app setup (middleware, routes)
│   ├── config/          # database, redis, rabbitmq, mailer, logger
│   ├── controllers/     # HTTP request/response handlers
│   ├── services/        # Business logic
│   ├── repositories/    # Data access layer (DB queries)
│   ├── models/          # Sequelize models
│   ├── middlewares/     # Auth, RBAC, Validation
│   ├── routes/          # Route definitions
│   ├── workers/         # RabbitMQ consumers (background jobs)
│   └── utils/           # responseHandler, treeHelper
├── migrations/          # SQL migration files
│   └── README.md        # Panduan menjalankan migrasi manual
├── docs/
│   ├── ARCHITECTURE.md                        # Diagram & penjelasan arsitektur
│   ├── QUICK_START.md                         # Panduan setup cepat
│   └── Project_Management_API.postman_collection.json
├── docker-compose.yml   # MySQL, Redis, RabbitMQ container setup
├── package.json         # Dependencies & npm scripts
├── .env.example         # Environment variable template
└── server.js            # Entry point
```

## Instalasi

### Prasyarat

- Node.js >= 18.x
- MySQL 8.0
- Redis
- RabbitMQ
- Docker (opsional, direkomendasikan untuk menjalankan Redis & RabbitMQ)

### Menjalankan Infrastructure via Docker Compose

Cara tercepat untuk menjalankan MySQL, Redis, dan RabbitMQ sekaligus:

```bash
docker-compose up -d
```

Ini akan menjalankan tiga container sesuai konfigurasi di `.env`:

| Container | Service | Port |
|---|---|---|
| `project_mgmt_mysql` | MySQL 8.0 | 3306 |
| `project_mgmt_redis` | Redis | 6379 |
| `project_mgmt_rabbitmq` | RabbitMQ + Management UI | 5672 / 15672 |

```bash
# Cek status semua container
docker-compose ps

# Hentikan semua container
docker-compose down

# Hentikan dan hapus semua data volume (reset total)
docker-compose down -v
```

> **RabbitMQ Management UI:** http://localhost:15672
> Login dengan `admin` / `admin123` (sesuai `.env`)
>
> Jika user tidak bisa login ke Management UI, jalankan sekali:
> ```bash
> docker exec project_mgmt_rabbitmq rabbitmqctl set_user_tags admin administrator
> docker exec project_mgmt_rabbitmq rabbitmqctl set_permissions -p / admin ".*" ".*" ".*"
> ```

> **Catatan MySQL:** Volume `./migrations` di-mount ke `docker-entrypoint-initdb.d` — MySQL akan otomatis menjalankan semua file `.sql` saat pertama kali container dibuat (database kosong). Jika database sudah ada, mount ini diabaikan.

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
> - `alice@example.com` / `password123` (role: staff)
> - `bob@example.com` / `password123` (role: staff)

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

> **Memantau antrian RabbitMQ:** Buka http://localhost:15672 setelah server berjalan.
> Queue yang digunakan project ini:
> - `task_overdue_queue` — antrian utama pemrosesan task overdue
> - `task_overdue_queue.delay` — pesan tertunda (delay via DLX)
> - `task_overdue_queue.retry` — pesan yang gagal dan menunggu retry
> - `task_overdue_queue.dlq` — pesan yang gagal permanen (Dead Letter Queue)

## API Endpoints

### Authentication `POST /api/auth`

| Method | Endpoint | Deskripsi | Auth | Rate Limit |
|---|---|---|---|---|
| POST | `/api/auth/register` | Daftar akun baru (role selalu `staff`) | - | 5 req/jam/IP |
| POST | `/api/auth/login` | Login, mendapat JWT token | - | 10 req gagal/15 menit/IP |
| GET | `/api/auth/profile` | Lihat profil sendiri | ✓ | - |
| POST | `/api/auth/logout` | Logout, invalidate token | ✓ | - |

> Jika rate limit terlampaui, server mengembalikan HTTP **429 Too Many Requests** dengan pesan waktu tunggu.

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

> Dokumentasi lengkap beserta contoh response (200/201, 400, 401, 403, 404, 409, 429) tersedia di `docs/Project_Management_API.postman_collection.json`.
> Import ke Postman dan buka tab **Examples** pada setiap request.

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
| `staff` | Baca data, update task yang di-assign ke dirinya |

Catatan penting:
- Registrasi publik (`POST /api/auth/register`) **selalu** membuat akun dengan role `staff`. Field `role` diabaikan.
- Role hanya dapat diubah oleh Admin melalui `PUT /api/users/:id`.
- Setiap request memvalidasi ulang role dan status aktif dari database (bukan hanya dari JWT payload), sehingga perubahan role/deaktivasi akun langsung berlaku dalam ≤5 menit.

### Menambahkan Admin & Manager

Karena registrasi publik terkunci ke `staff`, ada dua jalur resmi untuk membuat akun dengan role lebih tinggi:

**Jalur 1 — Bootstrap Admin pertama via database seed**

Admin pertama tidak dapat dibuat lewat API karena belum ada admin yang mengotorisasi. Gunakan migrasi `005_sample_data.sql` (sudah disertakan untuk development) atau insert manual:

```sql
-- Jalankan sekali saat setup awal (gunakan hash bcrypt yang sesuai)
INSERT INTO users (name, email, password, role, is_active)
VALUES ('Super Admin', 'admin@company.com', '$2b$10$...bcrypt_hash...', 'admin', true);
```

**Jalur 2 — Admin membuat user baru langsung dengan role tertentu**

Setelah admin pertama ada, gunakan endpoint `POST /api/users` (Admin only):

```http
POST /api/users
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@company.com",
  "password": "SecurePass123",
  "role": "manager"
}
```

**Jalur 3 — Admin mempromosikan user yang sudah terdaftar**

User yang sudah mendaftar via `POST /api/auth/register` (role `staff`) dapat dipromosikan oleh Admin:

```http
PUT /api/users/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "role": "admin"
}
```

```
Alur lengkap:

DB Seed (migrasi)
      │
      ▼
  Admin pertama
      │
      ├── POST /api/users  → Buat Manager/Admin baru langsung
      │
      └── PUT /api/users/:id → Promosi Staff yang sudah ada
```

### Caching Strategy (Redis)

- **Read-through**: GET task/project membaca cache terlebih dahulu
- **Cache invalidation**: CREATE/UPDATE/DELETE menghapus cache terkait
- **Logout blacklist**: Token JWT yang di-logout disimpan di Redis sampai expire. Blacklist check bersifat *fail-closed* — jika Redis tidak tersedia, request ditolak (HTTP 503) daripada melewati pemeriksaan
- **Role/status cache**: `user:auth:{id}` di-cache selama 5 menit. Otomatis di-invalidasi saat Admin mengubah role atau status akun melalui `PUT /api/users/:id` atau `PATCH /api/users/:id/status`
- **Key pattern**: `tasks:list:*`, `tasks:tree:{projectId}`, `task:{id}`, `user:auth:{id}`

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
npm start             # Jalankan server production
npm run dev           # Jalankan server development (nodemon)
npm run worker        # Jalankan background worker
npm test              # Jalankan semua unit test
npm run test:coverage # Jalankan test + laporan coverage
```

## Security

| Mekanisme | Detail |
|---|---|
| JWT Algorithm | HS256 — di-pin secara eksplisit; `alg:none` dan downgrade ke RS256 ditolak |
| Blacklist token | Redis fail-closed — Redis error → HTTP 503, bukan bypass |
| Role enforcement | Divalidasi dari DB per-request (cached 5 menit), bukan dari JWT payload |
| Privilege escalation | Registrasi publik terkunci ke role `staff`; role hanya dapat diubah Admin |
| SQL Injection | Seluruh query menggunakan Sequelize ORM dengan parameterized query |
| Password hashing | bcrypt (salt rounds: 10) via Sequelize model hook |
| Rate limiting | Login: 10 percobaan gagal/15 menit/IP — Register: 5 req/jam/IP |
| Env validation | Variabel wajib divalidasi saat startup; server tidak jalan jika ada yang kosong |

## Hasil Simulasi Running Project (11 Mei 2026)

Simulasi dilakukan di lingkungan Windows 11 menggunakan Docker Desktop v29.4.1, Docker Compose v5.1.3, dan VS Code.

### Ringkasan Hasil

| # | Langkah | Status | Keterangan |
|---|---|---|---|
| 1 | Docker tersedia | ✅ Berhasil | Docker v29.4.1 + Compose v5.1.3 terinstall |
| 2 | Docker daemon berjalan | ❌ **Gagal (awal)** | Docker Desktop belum dijalankan |
| 3 | `docker compose up -d` | ✅ Berhasil (setelah fix) | Semua container berhasil dijalankan |
| 4 | MySQL — database & tabel | ✅ Berhasil | Auto-migrasi via `docker-entrypoint-initdb.d` |
| 5 | MySQL — sample data | ✅ Berhasil | 4 user + project + task ter-insert |
| 6 | Redis — koneksi | ✅ Berhasil | `redis-cli ping` → `PONG` |
| 7 | RabbitMQ — koneksi & user | ✅ Berhasil | User `admin` terdaftar sebagai administrator |
| 8 | Node.js tersedia | ❌ **Gagal** | Node.js tidak terinstall di sistem |
| 9 | `npm install` | ❌ **Gagal** | Bergantung pada Node.js |
| 10 | `npm run dev` (server) | ❌ **Gagal** | Bergantung pada Node.js |
| 11 | Mailer verify (startup) | ⚠️ Non-fatal | Jika email placeholder, log error tapi server tetap jalan |

---

### Kegagalan & Solusi

#### ❌ Kegagalan 1 — Docker Desktop tidak berjalan

**Error:**
```
unable to get image 'redis:alpine': failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and
if the daemon is running: open //./pipe/dockerDesktopLinuxEngine:
The system cannot find the file specified.
```

**Penyebab:** Docker Desktop terinstall tetapi belum dijalankan. Daemon Linux engine belum aktif.

**Solusi:**
1. Buka aplikasi **Docker Desktop** dari Start Menu atau system tray
2. Tunggu sampai ikon Docker di system tray berhenti berputar (status: *Engine running*)
3. Verifikasi daemon aktif: `docker info`
4. Baru jalankan `docker compose up -d`

> Alternatif: Aktifkan Docker Desktop agar auto-start saat Windows booting via *Settings → General → Start Docker Desktop when you sign in*.

---

#### ❌ Kegagalan 2 — Node.js tidak terinstall

**Error:**
```
node : The term 'node' is not recognized as the name of a cmdlet, function,
script file, or operable program.
```

**Penyebab:** Node.js tidak terinstall atau tidak ada di sistem `PATH`. Tanpa Node.js, perintah `npm install`, `npm run dev`, dan `npm run worker` tidak dapat dijalankan.

**Solusi:**
1. Download installer Node.js LTS (>= 18.x) dari https://nodejs.org
2. Jalankan installer dan **centang opsi "Add to PATH"**
3. Restart terminal (atau restart VS Code) agar PATH diperbarui
4. Verifikasi: `node --version` dan `npm --version`
5. Jalankan `npm install` di direktori project

```bash
# Setelah Node.js terinstall
node --version   # harus >= v18.x
npm --version
npm install
npm run dev
```

> Alternatif tanpa install lokal: gunakan Node.js via Docker container yang di-mount ke source code project (lihat contoh di bawah).

```bash
# Alternatif: jalankan server via Docker tanpa install Node.js lokal
docker run --rm -it \
  --network host \
  -v "${PWD}:/app" \
  -w /app \
  --env-file .env \
  node:18-alpine \
  sh -c "npm install && npm run dev"
```

---

#### ❌ Kegagalan 3 — Konflik nama container saat `docker compose up -d` dijalankan ulang

**Error:**
```
Conflict. The container name "/project_mgmt_mysql" is already in use by container
"956bafd7...". You have to remove (or rename) that container to be able to reuse that name.
```

**Penyebab:** Container dari sesi sebelumnya (status: *stopped*) masih ada dengan nama yang sama. Terjadi jika `docker compose up -d` dijalankan ulang tanpa terlebih dahulu menjalankan `docker compose down`.

**Solusi:**
```bash
# Hentikan dan hapus semua container lama terlebih dahulu
docker compose down

# Kemudian baru jalankan ulang
docker compose up -d
```

Atau jika hanya satu container yang konflik:
```bash
docker rm -f project_mgmt_mysql
docker compose up -d
```

---

#### ⚠️ Peringatan 1 — `RABBITMQ_URL` di `.env.example` tidak menyertakan kredensial

**Isu:** File `.env.example` mengandung:
```
RABBITMQ_URL=amqp://localhost:5672
```

Sementara `docker-compose.yml` mengkonfigurasi user khusus `admin`/`admin123`. Jika `.env.example` disalin tanpa modifikasi, koneksi menggunakan default `guest`/`guest` RabbitMQ yang hanya bisa dari localhost (masih bisa berjalan), tetapi tidak konsisten dengan user yang dikonfigurasi di docker-compose.

**Solusi:** Setelah `cp .env.example .env`, pastikan `RABBITMQ_URL` diubah menjadi:
```env
RABBITMQ_URL=amqp://admin:admin123@localhost:5672
```

---

#### ⚠️ Peringatan 2 — Mailer verification gagal saat startup (non-fatal)

**Isu:** Jika `MAIL_USER` dan `MAIL_PASSWORD` masih berupa placeholder (nilai dari `.env.example`), fungsi `verifyMailer()` di `server.js` akan gagal saat startup. Namun server **tetap berjalan** karena error hanya di-log, tidak melempar exception.

**Dampak:** Fitur notifikasi email (task overdue, dll.) tidak berfungsi. Worker akan tetap memproses antrian, tetapi pengiriman email gagal.

**Solusi untuk development:** Gunakan [Ethereal Email](https://ethereal.email) (SMTP testing palsu, tidak mengirim email sungguhan):
```env
MAIL_HOST=smtp.ethereal.email
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=<user_dari_ethereal>
MAIL_PASSWORD=<password_dari_ethereal>
```

**Solusi untuk production:** Gunakan Gmail App Password:
1. Aktifkan 2FA di akun Google
2. Buka https://myaccount.google.com/apppasswords
3. Buat App Password baru → gunakan sebagai `MAIL_PASSWORD`

---

### Checklist Lengkap Sebelum Menjalankan Project

```
[ ] Docker Desktop terinstall dan sudah dijalankan (daemon aktif)
[ ] Node.js >= 18.x terinstall dan ada di PATH
[ ] File .env sudah dibuat dari .env.example dan semua nilai diisi
[ ] RABBITMQ_URL menggunakan format: amqp://admin:admin123@localhost:5672
[ ] JWT_SECRET minimal 32 karakter (bukan placeholder)
[ ] docker compose up -d berhasil dan semua container berstatus "healthy"
[ ] npm install berhasil tanpa error
[ ] npm run dev berjalan dan server merespons di http://localhost:3000/health
[ ] npm run worker dijalankan di terminal terpisah
```

---

## Unit Testing

### Menjalankan Test

```bash
# Jalankan semua test
npm test

# Jalankan dengan output verbose (nama setiap test case ditampilkan)
npm run test:verbose

# Jalankan dengan laporan code coverage
npm run test:coverage
```

### Struktur Test

```
tests/
└── unit/
    ├── utils/
    │   ├── responseHandler.test.js    # Format respons API
    │   └── treeHelper.test.js         # Utilitas tree rekursif
    ├── services/
    │   ├── authService.test.js        # IAM: register, login, logout, profile
    │   ├── projectService.test.js     # CRUD project + constraint assignment
    │   └── taskService.test.js        # CRUD task + email + RabbitMQ + cache
    └── middlewares/
        └── roleMiddleware.test.js     # RBAC semua role × semua operasi
```

### Hasil Test (89/89 Lulus)

```
Test Suites: 6 passed, 6 total
Tests:       89 passed, 89 total
Snapshots:   0 total
Time:        ~1.4 s
```

### Rincian Per Suite

| Suite | Tests | Cakupan |
|---|---|---|
| `treeHelper.test.js` | 14 | buildTaskTree, getTreeStatistics, getDescendantIds, validateNoCircularReference, searchInTree, filterTree |
| `responseHandler.test.js` | 6 | successResponse, errorResponse, paginationResponse |
| `authService.test.js` | 10 | Register (role injection prevention), Login, Logout blacklist, Profile |
| `projectService.test.js` | 16 | CRUD, Assignment hanya ke Manager, Cache invalidation |
| `taskService.test.js` | 21 | CRUD, Tree view, Email notification, RabbitMQ delay, Cache invalidation |
| `roleMiddleware.test.js` | 30 | RBAC Admin/Manager/Staff untuk Project & Task, isAdminOrSelf |
| **Total** | **89** | |

### Skenario RBAC yang Diuji

**Project (sesuai soal: dibuat Admin, di-assign ke Manager):**

| Operasi | Admin | Manager | Staff |
|---|---|---|---|
| CREATE project | ✅ Boleh | ❌ 403 | ❌ 403 |
| READ project | ✅ Semua | ✅ Milik sendiri | ❌ 403 |
| UPDATE project | ✅ Boleh | ✅ Boleh | ❌ 403 |
| DELETE project | ✅ Boleh | ❌ 403 | ❌ 403 |

**Assignment Constraint (sesuai soal):**

| Kondisi | Hasil |
|---|---|
| `owner_id` → user role **Manager** | ✅ 201 Created |
| `owner_id` → user role **Admin** | ❌ 400: "Project can only be assigned to a user with role Manager" |
| `owner_id` → user role **Staff** | ❌ 400: "Project can only be assigned to a user with role Manager" |
| `owner_id` tidak disertakan | ❌ 400: "owner_id is required" |

**Task:**

| Operasi | Admin | Manager | Staff |
|---|---|---|---|
| CREATE task | ✅ Boleh | ✅ Boleh | ❌ 403 |
| UPDATE task | ✅ Semua | ✅ Milik sendiri | ✅ Milik sendiri |
| DELETE task | ✅ Semua | ✅ Milik sendiri | ❌ 403 |

### Skenario Lanjutan yang Diuji

| Fitur | Skenario | Hasil |
|---|---|---|
| Cache Redis | CACHE HIT — data dikembalikan dari cache | ✅ |
| Cache Redis | CACHE MISS — data diambil dari DB, lalu disimpan ke cache | ✅ |
| Cache invalidation | Update/Delete project → cache di-clear | ✅ |
| Cache invalidation | Update task → write-through `task:{id}` + hapus `tasks:tree:{projectId}` | ✅ |
| RabbitMQ | `scheduleOverdue()` dipanggil saat task dibuat dengan `due_date` | ✅ |
| Email | `sendTaskAssignmentEmail()` dikirim saat `assigned_to` di-set/berubah | ✅ |
| Overdue automation | `checkOverdueTasks()` ubah status → overdue + kirim ke queue | ✅ |
| Tree rekursif | Struktur parent→child unlimited depth (diuji hingga 5 level) | ✅ |
| Circular reference | Validasi mencegah task menjadi parent dari leluhurnya sendiri | ✅ |
| JWT Blacklist | Logout → token diblacklist di Redis dengan TTL sisa | ✅ |
| Role injection | Registrasi publik selalu menghasilkan role `staff` (tidak bisa inject admin) | ✅ |

---

## Authors
Muammar Qathafi

