# Quick Start Guide

## Prerequisites

Pastikan sudah terinstall:
- ✅ Node.js >= 18.x
- ✅ MySQL >= 8.0
- ✅ Redis Server
- ✅ RabbitMQ Server

## Installation Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
```bash
# Copy template
cp .env.example .env

# Edit .env dengan konfigurasi Anda
# Minimal yang harus diubah:
# - DB_PASSWORD
# - JWT_SECRET (generate dengan: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# - MAIL_USER dan MAIL_PASSWORD (jika ingin test email)
```

### 3. Setup Database

**Option A: Step by step (MySQL tanpa password)**
```bash
mysql -u root project_management < migrations/001_create_users_table.sql
mysql -u root project_management < migrations/002_create_projects_table.sql
mysql -u root project_management < migrations/003_create_tasks_table.sql
mysql -u root project_management < migrations/004_create_indexes.sql
mysql -u root project_management < migrations/005_sample_data.sql
```

**Option B: Step by step (MySQL dengan password)**
```bash
mysql -u root -p project_management < migrations/001_create_users_table.sql
mysql -u root -p project_management < migrations/002_create_projects_table.sql
mysql -u root -p project_management < migrations/003_create_tasks_table.sql
mysql -u root -p project_management < migrations/004_create_indexes.sql
mysql -u root -p project_management < migrations/005_sample_data.sql
```

> `005_sample_data.sql` otomatis menyertakan user sample:
> - `admin@example.com` / `password123` (admin)
> - `john.manager@example.com` / `password123` (manager)
> - `alice@example.com` / `password123` (user)
> - `bob@example.com` / `password123` (user)

### 4. Start Redis Server
```bash
# Windows (jika pakai WSL atau native Redis)
redis-server

# Atau menggunakan Docker
docker run -d -p 6379:6379 redis:alpine
```

### 5. Start RabbitMQ Server
```bash
# Windows (jika terinstall)
rabbitmq-server

# Atau menggunakan Docker
docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# Access RabbitMQ Management UI: http://localhost:15672 (guest/guest)
```

### 6. Start Application

**Terminal 1 - Main Server:**
```bash
npm run dev
```

**Terminal 2 - Background Worker:**
```bash
npm run worker
```

### 7. Test API

**Health Check:**
```bash
curl http://localhost:3000/health
```

**Register User:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123",
    "role": "staff"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }'
```

## Docker Setup (Alternative)

### docker-compose.yml
```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: project_management
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"

volumes:
  mysql_data:
```

**Start all services:**
```bash
docker-compose up -d
```

## Testing with Postman

1. Import collection dari `docs/Project_Management_API.postman_collection.json`
2. Set collection variable `baseUrl` = `http://localhost:3000`
3. Login untuk mendapatkan token (auto-saved ke collection variable)
4. Test endpoints lainnya

## Common Issues

### Issue: Cannot connect to MySQL
```bash
# Check MySQL service
sudo systemctl status mysql

# Start MySQL
sudo systemctl start mysql
```

### Issue: Redis connection refused
```bash
# Check Redis
redis-cli ping
# Should return: PONG

# Start Redis
redis-server
```

### Issue: RabbitMQ not available
```bash
# Check RabbitMQ
rabbitmqctl status

# Start RabbitMQ
rabbitmq-server
```

### Issue: Port 3000 already in use
```bash
# Change PORT in .env file
PORT=3001
```

## Project Structure
```
project-management-system/
├── src/
│   ├── config/          # Database, Redis, RabbitMQ, Mailer configs
│   ├── controllers/     # HTTP handlers
│   ├── services/        # Business logic
│   ├── repositories/    # Data access
│   ├── models/          # Database models
│   ├── middlewares/     # Auth, RBAC, Validation
│   ├── routes/          # API endpoints
│   ├── workers/         # Background jobs
│   └── utils/           # Helper functions
├── migrations/          # SQL migrations
├── docs/                # Documentation
├── .env.example         # Template environment variables
├── server.js            # Entry point
└── package.json         # Dependencies
```

## Next Steps

1. ✅ Setup complete
2. 📝 Read `docs/ARCHITECTURE.md` untuk understand struktur
3. 🔧 Customize business logic sesuai requirement
4. 🧪 Add unit tests
5. 🚀 Deploy to production

## Support

Untuk pertanyaan atau issue, check dokumentasi di folder `docs/`:
- `ARCHITECTURE.md` - Architecture details
- `Project_Management_API.postman_collection.json` - API collection (Postman)
- `QUICK_START.md` - Quick start guide
