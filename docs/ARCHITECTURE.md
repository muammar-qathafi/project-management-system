# Architecture Documentation

## Layered Architecture Overview

Proyek ini menggunakan **Layered Architecture Pattern** dengan pemisahan tanggung jawab yang jelas:

```
┌─────────────────────────────────────────┐
│           HTTP Layer (Routes)           │
│         - Endpoint Definitions          │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│       Controller Layer                  │
│   - HTTP Request/Response Handling      │
│   - Input Validation                    │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│         Service Layer                   │
│   - Business Logic                      │
│   - Cache Management                    │
│   - Queue Publishing                    │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│       Repository Layer                  │
│   - Data Access Abstraction             │
│   - SQL Query Operations                │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│          Model Layer                    │
│   - Database Schema Definition          │
│   - Sequelize ORM                       │
└─────────────────────────────────────────┘
```

## Layer Responsibilities

### 1. Routes Layer
**Location**: `src/routes/`

**Responsibilities**:
- Define API endpoints
- Mount middleware (auth, validation, RBAC)
- Route requests to appropriate controllers

**Example**:
```javascript
router.post('/tasks', 
  authenticateToken,    // Auth middleware
  canCreateTask,        // RBAC middleware (Admin + Manager)
  validateCreateTask,   // Validation middleware
  taskController.createTask
);
```

### 2. Controller Layer
**Location**: `src/controllers/`

**Responsibilities**:
- Handle HTTP requests and responses
- Extract request data (body, params, query)
- Call appropriate service methods
- Format responses using response handlers
- Error handling (pass to error middleware)

**Example**:
```javascript
async createTask(req, res, next) {
  try {
    const taskData = req.body;
    const createdBy = req.user.id;
    const task = await taskService.createTask({ ...taskData, created_by: createdBy });
    return res.status(201).json(successResponse(task, 'Task created', 201));
  } catch (error) {
    next(error);
  }
}
```

### 3. Service Layer
**Location**: `src/services/`

**Responsibilities**:
- Core business logic
- Data validation and transformation
- Cache management (get, set, invalidate)
- Message queue publishing
- Orchestrate multiple repository calls
- Transaction management

**Key Features**:
- **Cache Strategy**: Read-through cache dengan invalidation
- **Recursive Logic**: Tree building untuk hierarchical tasks
- **Background Jobs**: Publish messages ke RabbitMQ

**Example**:
```javascript
async createTask(taskData) {
  // Validate parent task
  if (taskData.parent_task_id) {
    const parent = await taskRepository.findById(taskData.parent_task_id);
    if (!parent) throw new Error('Parent task not found');
  }
  
  // Create task
  const task = await taskRepository.create(taskData);
  
  // Invalidate cache
  await this.invalidateTaskCache(task.project_id);
  
  // Publish to queue
  await publishToQueue('task_queue', { task_id: task.id });
  
  return task;
}
```

### 4. Repository Layer
**Location**: `src/repositories/`

**Responsibilities**:
- Data access abstraction
- SQL query operations via Sequelize
- CRUD operations
- Complex queries (joins, aggregations)
- No business logic

**Example**:
```javascript
async findAll(filters) {
  const { page, limit, status, priority } = filters;
  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  
  return await Task.findAndCountAll({
    where,
    limit,
    offset: (page - 1) * limit,
    order: [['created_at', 'DESC']]
  });
}
```

### 5. Model Layer
**Location**: `src/models/`

**Responsibilities**:
- Define database schema
- Relationships between entities
- Model-level validations
- Hooks (beforeCreate, afterUpdate, etc.)

**Example**:
```javascript
const Task = sequelize.define('Task', {
  title: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('open', 'working', 'closed', 'overdue'), defaultValue: 'open' }
}, {
  hooks: {
    beforeCreate: async (task) => {
      // Hook logic
    }
  }
});
```

## Supporting Components

### App Setup (`src/app.js`)

File ini merupakan Express app setup, dipisah dari `server.js` agar mudah di-test tanpa menjalankan HTTP server nyata.

**Responsibilities**:
- Daftarkan security middleware: `helmet` (HTTP headers) dan `cors`
- Setup HTTP logger via `pino-http` — auto-log method, url, status, responseTime; health check endpoint di-skip
- Mount body parser (`express.json`, `express.urlencoded`)
- Expose `GET /health` endpoint
- Mount semua routes di bawah prefix `/api`
- 404 handler dan global error handler

### Config Layer (`src/config/`)

1. **database.js**: Sequelize connection setup
2. **redis.js**: Redis client + `cacheHelper` wrapper (get, set, del, delPattern)
3. **rabbitmq.js**: RabbitMQ channel, deklarasi exchange & queue termasuk DLX pattern
4. **mailer.js**: Nodemailer transporter + `emailTemplates` untuk notifikasi
5. **logger.js**: Pino logger terpusat
   - Level: `debug` di development, `info` di production (override via `LOG_LEVEL`)
   - Format: `pino-pretty` (berwarna) di non-production, JSON murni di production
   - Redact otomatis field sensitif: `authorization`, `cookie`, `password`, `token`, `secret`

1. **authMiddleware.js**: JWT token verification
2. **roleMiddleware.js**: RBAC authorization
3. **validatorMiddleware.js**: Input validation using express-validator

### Workers
**Location**: `src/workers/`

Background job processors menggunakan RabbitMQ:
- **overdueWorker.js**: Check dan update overdue tasks

### Utilities
**Location**: `src/utils/`

1. **responseHandler.js**: Standardize API responses
2. **treeHelper.js**: Recursive functions untuk tree structure

## Data Flow Example

### Create Task Request Flow:

```
1. Client sends POST /api/tasks
   ↓
2. Route: `authenticateToken` → `canCreateTask` → `validateCreateTask` → `taskController.createTask`
   ↓
3. Controller: Extract data, call taskService.createTask()
   ↓
4. Service: 
   - Validate business rules
   - Call taskRepository.create()
   - Invalidate cache
   - Publish to RabbitMQ
   ↓
5. Repository: Execute SQL INSERT via Sequelize
   ↓
6. Model: Apply hooks, return created task
   ↓
7. Response flows back through layers
   ↓
8. Client receives JSON response
```

## Caching Strategy

### Read-Through Cache
```javascript
// Get from cache first
const cached = await cacheHelper.get(cacheKey);
if (cached) return cached;

// If not cached, get from DB
const data = await repository.findAll();

// Store in cache
await cacheHelper.set(cacheKey, data, TTL);
```

### Cache Invalidation
```javascript
// On CREATE/UPDATE/DELETE
await cacheHelper.delPattern('tasks:list:*');
await cacheHelper.delPattern(`tasks:tree:${projectId}`);
await cacheHelper.delPattern('tasks:tree:all:*');
await cacheHelper.del(`task:${taskId}`);
```

## Background Jobs

### RabbitMQ — Delay via Dead Letter Exchange (DLX):

```
taskService.createTask / updateTask
   │ publish ke DELAY_QUEUE
   │ expiration = (due_date - now) ms
   ↓
task_overdue_queue.delay   ← pesan menunggu TTL habis
   │ setelah TTL habis, DLX otomatis memindahkan ke:
   ↓
task_overdue_queue         ← PROCESSING_QUEUE (dikonsumsi worker)
   │
   ↓
overdueWorker.handleMessage()
   ├── Ambil task dari DB
   ├── Jika status bukan 'closed' → ubah ke 'overdue'
   ├── Kirim email notifikasi ke assignee
   └── Invalidasi Redis cache
   │
   ↓ jika gagal & retry habis
task_overdue_queue.dlq     ← Dead Letter Queue (gagal permanen)
```

Queue yang digunakan:

| Queue | Fungsi |
|---|---|
| `task_overdue_queue.delay` | Pesan tertunda (delay via DLX) |
| `task_overdue_queue` | Antrian utama pemrosesan |
| `task_overdue_queue.retry` | Pesan gagal menunggu retry |
| `task_overdue_queue.dlq` | Dead Letter Queue (gagal permanen) |

## RBAC Implementation

### Role Hierarchy:
- **Admin**: Full access ke semua resource
- **Manager**: Buat/kelola project & task, tidak bisa hapus user
- **Staff**: Baca data, update task yang di-assign ke dirinya

### Middleware Chain:
```javascript
router.delete('/tasks/:id', 
  authenticateToken,  // Verify user is logged in
  canDeleteTask,      // Admin: semua task; Manager: task milik sendiri; Staff: ditolak
  taskController.deleteTask
);
```

## Error Handling

### Global Error Handler:
```javascript
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json(errorResponse(err.message, statusCode));
});
```

### Service-Level Errors:
```javascript
const error = new Error('Resource not found');
error.statusCode = 404;
throw error;
```

## Best Practices Implemented

1. ✅ **Separation of Concerns**: Each layer has single responsibility
2. ✅ **Dependency Injection**: Layers depend on abstractions
3. ✅ **Error Handling**: Consistent error propagation
4. ✅ **Caching**: Redis for performance optimization
5. ✅ **Async Processing**: RabbitMQ for background jobs
6. ✅ **Security**: JWT + RBAC + Input validation
7. ✅ **Scalability**: Stateless architecture with external cache
8. ✅ **Maintainability**: Clear structure and documentation

## Testing

### Unit Tests (89/89 Lulus)

```bash
npm test                   # Jalankan semua unit test
npm run test:verbose       # Output verbose
npm run test:coverage      # Dengan laporan coverage
```

| Suite | Tests | Cakupan |
|---|---|---|
| `treeHelper.test.js` | 14 | buildTaskTree, getTreeStatistics, getDescendantIds, circular reference, search, filter |
| `responseHandler.test.js` | 6 | successResponse, errorResponse, paginationResponse |
| `authService.test.js` | 10 | Register (role injection prevention), Login, Logout blacklist, Profile |
| `projectService.test.js` | 16 | CRUD, Assignment constraint (Manager only), Cache invalidation |
| `taskService.test.js` | 21 | CRUD, Tree view, Email notification, RabbitMQ delay, Cache invalidation |
| `roleMiddleware.test.js` | 30 | RBAC Admin/Manager/Staff untuk Project & Task, isAdminOrSelf |
| **Total** | **89** | |

### Integration Tests (59/59 Lulus)

```bash
# Membutuhkan Docker services aktif
docker compose up -d
npm run test:integration   # Berjalan serial, ~12 menit total
```

| Suite | Tests | Cakupan |
|---|---|---|
| `overdue.integration.test.js` | 1 | Siklus penuh RabbitMQ DLX → DB status overdue |
| `e2e.flow.test.js` | 58 | Auth, User CRUD, Project CRUD, Task CRUD+Tree, Overdue Worker, Security |
| **Total** | **59** | |
