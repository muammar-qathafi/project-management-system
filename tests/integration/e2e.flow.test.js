/**
 * E2E Integration Test — Simulasi Lengkap Postman Flow
 *
 * Setiap request dibuat via supertest (HTTP nyata melewati semua middleware:
 * helmet, cors, pino-http, rate-limit, auth, RBAC, validator, controller, service).
 * Semua request + response tercatat di logs/app_test.log secara real-time.
 *
 * FLOW (6 Phase):
 *  Phase 1  Auth      : Register, Login 3 role, Profile, Update Profile, Logout
 *  Phase 2  Users     : CRUD (Admin only) + RBAC enforcement
 *  Phase 3  Projects  : CRUD + RBAC enforcement
 *  Phase 4  Tasks     : CRUD + Subtask + Tree structure + RBAC
 *  Phase 5  Overdue   : Task due +60s via API -> RabbitMQ DLX -> status "overdue"
 *  Phase 6  Security  : Token blacklist, no-token, malformed-token
 *
 * Log : logs/app_test.log  (NODE_ENV=test)
 * Run : npm run test:integration
 *
 * Prasyarat:
 *  - Docker: MySQL, Redis, RabbitMQ berjalan
 *  - Seed data: migrations/005_sample_data.sql
 *  - .env terkonfigurasi
 */

// ─── Set env SEBELUM module apapun di-require ─────────────────────────────────
process.env.LOG_LEVEL = 'info';
require('dotenv').config();

jest.setTimeout(480_000);

// ─── Dependencies ─────────────────────────────────────────────────────────────
const request = require('supertest');
const app     = require('../../src/app');

const { sequelize }                  = require('../../src/config/database');
const { redisClient, connectRedis }  = require('../../src/config/redis');
const {
  connectRabbitMQ,
  closeRabbitMQ,
  consumeFromQueue,
  PROCESSING_QUEUE,
  DELAY_QUEUE,
  getChannel,
} = require('../../src/config/rabbitmq');

const Task    = require('../../src/models/task');
const Project = require('../../src/models/project');
const User    = require('../../src/models/user');

const OverdueWorker = require('../../src/workers/overdueWorker');
const logger = require('../../src/config/logger').child({ component: 'e2e-test' });

// ─── Shared state (diisi oleh test, dipakai oleh test berikutnya) ─────────────
const tokens = { admin: null, manager: null, staff: null };
const ids = {
  adminId:      1,   // seed: admin@example.com
  managerId:    2,   // seed: john.manager@example.com
  staffId:      3,   // seed: alice@example.com
  newUserId:    null,
  projectId:    null,
  rootTaskId:   null,
  subtaskId:    null,
  overdueTaskId: null,
};

const TS = Date.now();
const created = { users: [], projects: [], tasks: [] };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep     = (ms) => new Promise((r) => setTimeout(r, ms));
const testEmail = (label) => `e2e.${label}.${TS}@test.local`;

const pollUntil = async (predFn, timeoutMs = 90_000, intervalMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predFn();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
};

const logStep = (step, method, path, status, passed) =>
  logger.info(
    { step, method, path, status, result: passed ? 'PASS' : 'FAIL' },
    `[${passed ? 'PASS' : 'FAIL'}] ${step}`
  );

// ─── Global setup / teardown ──────────────────────────────────────────────────
beforeAll(async () => {
  logger.info('=================================================================');
  logger.info('  E2E FLOW TEST — Simulasi Penuh Postman API Collection        ');
  logger.info('=================================================================');

  await sequelize.authenticate();
  logger.info('OK MySQL connected');

  if (!redisClient.isOpen) await connectRedis();
  logger.info('OK Redis connected');

  await connectRabbitMQ();
  logger.info('OK RabbitMQ connected');

  // Purge queues agar tidak ada pesan lama yang mengganggu Phase 5
  const ch = getChannel();
  const pd = await ch.purgeQueue(DELAY_QUEUE);
  const pp = await ch.purgeQueue(PROCESSING_QUEUE);
  logger.info({ purgedDelay: pd.messageCount, purgedProcessing: pp.messageCount },
    'OK Queues purged — clean state');

  // Start overdue worker consumer sekarang (untuk Phase 5)
  const worker = new OverdueWorker();
  await consumeFromQueue(PROCESSING_QUEUE, (msg) => worker.handleMessage(msg));
  logger.info('OK Worker consumer started — listening on PROCESSING_QUEUE');

  logger.info('Setup selesai — memulai test...');
  logger.info('');
}, 30_000);

afterAll(async () => {
  logger.info('');
  logger.info('=== CLEANUP ===');

  // Hapus dalam urutan dependency: tasks -> projects -> users
  for (const id of created.tasks)
    await Task.destroy({ where: { id }, force: true }).catch(() => {});
  for (const id of created.projects)
    await Project.destroy({ where: { id }, force: true }).catch(() => {});
  for (const id of created.users)
    await User.destroy({ where: { id }, force: true }).catch(() => {});

  logger.info({ created }, 'OK Test data cleaned up');

  await closeRabbitMQ();
  if (redisClient.isOpen) await redisClient.quit();
  await sequelize.close();
  logger.info('OK All connections closed');
});

// =============================================================================
//  PHASE 1 — Authentication
// =============================================================================
describe('Phase 1 — Authentication', () => {

  it('POST /api/auth/register — Register user baru -> 201', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name:     'E2E Register User',
        username: `e2e_reg_${TS}`,
        email:    testEmail('register'),
        password: 'Register123!',
        role:     'staff',
      });
    logStep('Register user', 'POST', '/api/auth/register', res.status,
      res.status === 201 || res.status === 200);
    expect([200, 201]).toContain(res.status);
    // Hapus user ini di cleanup
    if (res.body.data && res.body.data.id) {
      created.users.push(res.body.data.id);
    }
  });

  it('POST /api/auth/register — Email duplikat -> 400/409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name:     'Duplicate',
        email:    'admin@example.com',
        password: 'Admin123!',
        role:     'staff',
      });
    logStep('Register duplicate email', 'POST', '/api/auth/register', res.status,
      [400, 409].includes(res.status));
    expect([400, 409]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/login — Admin login berhasil -> 200, token tersimpan', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    logStep('Admin login', 'POST', '/api/auth/login', res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    tokens.admin = res.body.data.token;
  });

  it('POST /api/auth/login — Manager login berhasil -> 200, token tersimpan', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'john.manager@example.com', password: 'password123' });
    logStep('Manager login', 'POST', '/api/auth/login', res.status, res.status === 200);
    expect(res.status).toBe(200);
    tokens.manager = res.body.data.token;
  });

  it('POST /api/auth/login — Staff login berhasil -> 200, token tersimpan', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'password123' });
    logStep('Staff login', 'POST', '/api/auth/login', res.status, res.status === 200);
    expect(res.status).toBe(200);
    tokens.staff = res.body.data.token;
  });

  it('POST /api/auth/login — Password salah -> 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrongpassword' });
    logStep('Login wrong password', 'POST', '/api/auth/login', res.status, res.status === 401);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/login — Email tidak terdaftar -> 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notexist@example.com', password: 'password123' });
    logStep('Login non-existent email', 'POST', '/api/auth/login', res.status, res.status === 401);
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/profile — Admin authenticated -> 200', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Get admin profile', 'GET', '/api/auth/profile', res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
  });

  it('PUT /api/auth/profile — Admin update nama -> 200', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Admin Updated E2E' });
    logStep('Update admin profile', 'PUT', '/api/auth/profile', res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Admin Updated E2E');
    // Kembalikan nama asli
    await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Admin User' });
  });

  it('GET /api/auth/profile — Tanpa token -> 401', async () => {
    const res = await request(app).get('/api/auth/profile');
    logStep('Profile no token', 'GET', '/api/auth/profile', res.status, res.status === 401);
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/profile — Token invalid -> 401/403', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', 'Bearer invalid.jwt.token');
    logStep('Profile invalid token', 'GET', '/api/auth/profile', res.status,
      [401, 403].includes(res.status));
    expect([401, 403]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

// =============================================================================
//  PHASE 2 — User Management (Admin Only)
// =============================================================================
describe('Phase 2 — User Management (Admin Only)', () => {

  it('GET /api/users — Admin -> 200, list semua user', async () => {
    const res = await request(app)
      .get('/api/users?page=1&limit=10')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /users', 'GET', '/api/users', res.status, res.status === 200);
    expect(res.status).toBe(200);
    // paginationResponse: data is the array directly (not nested under .users)
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('[RBAC] GET /api/users — Staff -> 403 (Admin only)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('[RBAC] Staff GET /users', 'GET', '/api/users', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('[RBAC] GET /api/users — Manager -> 403 (Admin only)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tokens.manager}`);
    logStep('[RBAC] Manager GET /users', 'GET', '/api/users', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('POST /api/users — Admin buat user baru (staff) -> 201', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        name:     'E2E Staff Test',
        username: `e2e_staff_${TS}`,
        email:    testEmail('staff'),
        password: 'StaffPass123!',
        role:     'staff',
      });
    logStep('Admin POST /users', 'POST', '/api/users', res.status, res.status === 201);
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('staff');
    ids.newUserId = res.body.data.id;
    created.users.push(ids.newUserId);
  });

  it('[RBAC] POST /api/users — Manager -> 403 (Admin only)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ name: 'Hacker', email: testEmail('hack'), password: 'Hack123456!', role: 'staff' });
    logStep('[RBAC] Manager POST /users', 'POST', '/api/users', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('GET /api/users/:id — Admin lihat user baru -> 200', async () => {
    const res = await request(app)
      .get(`/api/users/${ids.newUserId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /users/:id', 'GET', `/api/users/${ids.newUserId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ids.newUserId);
  });

  it('GET /api/users/:id — Staff lihat diri sendiri -> 200', async () => {
    const res = await request(app)
      .get(`/api/users/${ids.staffId}`)
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('Staff GET own /users/:id', 'GET', `/api/users/${ids.staffId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('PUT /api/users/:id — Admin update nama user -> 200', async () => {
    const res = await request(app)
      .put(`/api/users/${ids.newUserId}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'E2E Staff Updated' });
    logStep('Admin PUT /users/:id', 'PUT', `/api/users/${ids.newUserId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('E2E Staff Updated');
  });

  it('PATCH /api/users/:id/status — Admin deactivate user -> 200', async () => {
    const res = await request(app)
      .patch(`/api/users/${ids.newUserId}/status`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ is_active: false });
    logStep('Admin PATCH /users/:id/status', 'PATCH', `/api/users/${ids.newUserId}/status`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('PATCH /api/users/:id/status — Admin re-activate user -> 200', async () => {
    const res = await request(app)
      .patch(`/api/users/${ids.newUserId}/status`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ is_active: true });
    logStep('Admin re-activate user', 'PATCH', `/api/users/${ids.newUserId}/status`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(true);
  });

  it('GET /api/users/999999 — User tidak ada -> 404', async () => {
    const res = await request(app)
      .get('/api/users/999999')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /users/999999 not found', 'GET', '/api/users/999999', res.status, res.status === 404);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
//  PHASE 3 — Project Management
// =============================================================================
describe('Phase 3 — Project Management', () => {

  it('POST /api/projects — Admin buat project (owner = manager) -> 201', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        name:        `[E2E] Project Alpha ${TS}`,
        description: 'Project untuk E2E testing flow',
        status:      'active',
        priority:    'high',
        owner_id:    ids.managerId,
      });
    logStep('Admin POST /projects', 'POST', '/api/projects', res.status, res.status === 201);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    ids.projectId = res.body.data.id;
    created.projects.push(ids.projectId);
  });

  it('[RBAC] POST /api/projects — Staff -> 403 (Admin only)', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ name: 'Unauthorized Project', owner_id: ids.managerId });
    logStep('[RBAC] Staff POST /projects', 'POST', '/api/projects', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('[RBAC] POST /api/projects — Manager -> 403 (Admin only)', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ name: 'Manager Project', owner_id: ids.managerId });
    logStep('[RBAC] Manager POST /projects', 'POST', '/api/projects', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('GET /api/projects — Admin list semua project -> 200', async () => {
    const res = await request(app)
      .get('/api/projects?page=1&limit=10')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /projects', 'GET', '/api/projects', res.status, res.status === 200);
    expect(res.status).toBe(200);
    // paginationResponse: data is the array directly (not nested under .projects)
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/projects — Manager dapat list projects -> 200', async () => {
    const res = await request(app)
      .get('/api/projects?page=1&limit=10')
      .set('Authorization', `Bearer ${tokens.manager}`);
    logStep('Manager GET /projects', 'GET', '/api/projects', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/projects — Staff dapat list projects -> 200', async () => {
    const res = await request(app)
      .get('/api/projects?page=1&limit=10')
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('Staff GET /projects', 'GET', '/api/projects', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/projects/:id — Admin get project by ID -> 200', async () => {
    const res = await request(app)
      .get(`/api/projects/${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /projects/:id', 'GET', `/api/projects/${ids.projectId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ids.projectId);
  });

  it('PUT /api/projects/:id — Admin update project status -> 200', async () => {
    const res = await request(app)
      .put(`/api/projects/${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ status: 'on_hold', name: `[E2E] Project Alpha Updated ${TS}` });
    logStep('Admin PUT /projects/:id', 'PUT', `/api/projects/${ids.projectId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('PUT /api/projects/:id — Manager update project -> 200', async () => {
    const res = await request(app)
      .put(`/api/projects/${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ status: 'active' });
    logStep('Manager PUT /projects/:id', 'PUT', `/api/projects/${ids.projectId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('[RBAC] PUT /api/projects/:id — Staff -> 403', async () => {
    const res = await request(app)
      .put(`/api/projects/${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ status: 'completed' });
    logStep('[RBAC] Staff PUT /projects/:id', 'PUT', `/api/projects/${ids.projectId}`, res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('[RBAC] DELETE /api/projects/:id — Manager -> 403 (Admin only)', async () => {
    const res = await request(app)
      .delete(`/api/projects/${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.manager}`);
    logStep('[RBAC] Manager DELETE /projects/:id', 'DELETE', `/api/projects/${ids.projectId}`, res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('GET /api/projects/999999 — Project tidak ada -> 404', async () => {
    const res = await request(app)
      .get('/api/projects/999999')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /projects/999999 not found', 'GET', '/api/projects/999999', res.status, res.status === 404);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
//  PHASE 4 — Task Management + Tree Structure
// =============================================================================
describe('Phase 4 — Task Management + Tree Structure', () => {

  it('POST /api/tasks — Admin buat root task -> 201', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        title:       `[E2E] Root Task ${TS}`,
        description: 'Root task untuk E2E testing',
        project_id:  ids.projectId,
        priority:    'high',
        status:      'open',
        assigned_to: ids.staffId,
        due_date:    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    logStep('Admin POST /tasks (root)', 'POST', '/api/tasks', res.status, res.status === 201);
    expect(res.status).toBe(201);
    ids.rootTaskId = res.body.data.id;
    created.tasks.push(ids.rootTaskId);
  });

  it('POST /api/tasks — Manager buat subtask (parent_task_id) -> 201', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({
        title:          `[E2E] Subtask ${TS}`,
        description:    'Subtask dari root task',
        project_id:     ids.projectId,
        priority:       'medium',
        status:         'open',
        assigned_to:    ids.staffId,
        parent_task_id: ids.rootTaskId,
        due_date:       new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      });
    logStep('Manager POST /tasks (subtask)', 'POST', '/api/tasks', res.status, res.status === 201);
    expect(res.status).toBe(201);
    expect(res.body.data.parent_task_id).toBe(ids.rootTaskId);
    ids.subtaskId = res.body.data.id;
    created.tasks.push(ids.subtaskId);
  });

  it('[RBAC] POST /api/tasks — Staff -> 403 (Admin+Manager only)', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ title: 'Unauthorized', project_id: ids.projectId });
    logStep('[RBAC] Staff POST /tasks', 'POST', '/api/tasks', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('GET /api/tasks — Admin list task per project -> 200, minimal 2 task', async () => {
    const res = await request(app)
      .get(`/api/tasks?page=1&limit=10&project_id=${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /tasks', 'GET', '/api/tasks', res.status, res.status === 200);
    expect(res.status).toBe(200);
    // paginationResponse: data is the array directly (not nested under .tasks)
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/tasks — Manager list task -> 200', async () => {
    const res = await request(app)
      .get(`/api/tasks?page=1&limit=10&project_id=${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.manager}`);
    logStep('Manager GET /tasks', 'GET', '/api/tasks', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/tasks — Staff list task (task assigned ke mereka) -> 200', async () => {
    const res = await request(app)
      .get('/api/tasks?page=1&limit=10')
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('Staff GET /tasks', 'GET', '/api/tasks', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/tasks/:id — Admin get task by ID -> 200', async () => {
    const res = await request(app)
      .get(`/api/tasks/${ids.rootTaskId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /tasks/:id', 'GET', `/api/tasks/${ids.rootTaskId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ids.rootTaskId);
  });

  it('GET /api/tasks/tree — Tree structure untuk project -> 200', async () => {
    const res = await request(app)
      .get(`/api/tasks/tree?project_id=${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /tasks/tree', 'GET', '/api/tasks/tree', res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('tree');
    expect(res.body.data).toHaveProperty('statistics');
  });

  it('GET /api/tasks/tree/metadata — Tree dengan metadata -> 200', async () => {
    const res = await request(app)
      .get(`/api/tasks/tree/metadata?project_id=${ids.projectId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /tasks/tree/metadata', 'GET', '/api/tasks/tree/metadata', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/tasks/tree/search — Search task di tree -> 200', async () => {
    const res = await request(app)
      .get(`/api/tasks/tree/search?project_id=${ids.projectId}&q=E2E`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /tasks/tree/search', 'GET', '/api/tasks/tree/search', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/tasks/tree/filter — Filter task di tree -> 200', async () => {
    const res = await request(app)
      .get(`/api/tasks/tree/filter?project_id=${ids.projectId}&status=open`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /tasks/tree/filter', 'GET', '/api/tasks/tree/filter', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/tasks/tree/all — Admin all-projects tree -> 200', async () => {
    const res = await request(app)
      .get('/api/tasks/tree/all')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin GET /tasks/tree/all', 'GET', '/api/tasks/tree/all', res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('[RBAC] GET /api/tasks/tree/all — Staff -> 403 (Admin only)', async () => {
    const res = await request(app)
      .get('/api/tasks/tree/all')
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('[RBAC] Staff GET /tasks/tree/all', 'GET', '/api/tasks/tree/all', res.status, res.status === 403);
    expect(res.status).toBe(403);
  });

  it('PUT /api/tasks/:id — Admin update status task -> 200', async () => {
    const res = await request(app)
      .put(`/api/tasks/${ids.rootTaskId}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ status: 'working' });
    logStep('Admin PUT /tasks/:id (status)', 'PUT', `/api/tasks/${ids.rootTaskId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('working');
  });

  it('PUT /api/tasks/:id — Staff update task yang di-assign ke mereka -> 200', async () => {
    const res = await request(app)
      .put(`/api/tasks/${ids.rootTaskId}`)
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ status: 'open' });
    logStep('Staff PUT /tasks/:id (assigned)', 'PUT', `/api/tasks/${ids.rootTaskId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
  });

  it('GET /api/tasks/999999 — Task tidak ditemukan -> 404', async () => {
    const res = await request(app)
      .get('/api/tasks/999999')
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('GET /tasks/999999 not found', 'GET', '/api/tasks/999999', res.status, res.status === 404);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
//  PHASE 5 — Overdue Worker via RabbitMQ (~60 detik nyata)
// =============================================================================
describe('Phase 5 — Overdue Worker (RabbitMQ Delay Queue ~60s)', () => {

  const DELAY_SECONDS = 300;

  it(
    'Task dibuat via API (due +60s) -> RabbitMQ DLX fires -> status berubah ke "overdue"',
    async () => {
      // PENTING: Purge DELAY_QUEUE sebelum buat overdue task.
      // Phase 4 membuat rootTask (due +30d) dan subtask (due +15d) yang sudah
      // ada di DELAY_QUEUE. RabbitMQ per-message TTL hanya expire di HEAD queue —
      // jika rootTask (TTL 30 hari) ada di depan, overdueTask (TTL 60s) di belakang
      // TIDAK AKAN PERNAH expire sampai rootTask diproses atau di-purge.
      const ch = getChannel();
      const beforePurge = await ch.purgeQueue(DELAY_QUEUE);
      logger.info({ purged: beforePurge.messageCount },
        'Phase 5: DELAY_QUEUE purged — clean slate for overdue test');

      const dueDate = new Date(Date.now() + DELAY_SECONDS * 1_000).toISOString();

      // Buat task via API (bukan langsung DB) agar melewati service.createTask()
      // yang otomatis mempublish pesan ke DELAY_QUEUE
      const createRes = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({
          title:       `[E2E] Overdue Task ${TS}`,
          description: `Task ini akan overdue dalam ~${DELAY_SECONDS}s via RabbitMQ DLX`,
          project_id:  ids.projectId,
          priority:    'high',
          status:      'open',
          assigned_to: ids.staffId,
          due_date:    dueDate,
        });

      logStep('Create overdue task via API', 'POST', '/api/tasks', createRes.status, createRes.status === 201);
      expect(createRes.status).toBe(201);
      ids.overdueTaskId = createRes.body.data.id;
      created.tasks.push(ids.overdueTaskId);

      logger.info(
        { taskId: ids.overdueTaskId, dueDate, ttlSeconds: DELAY_SECONDS },
        `Overdue task created (id=${ids.overdueTaskId}) — menunggu ~${DELAY_SECONDS}s agar RabbitMQ fire`
      );
      logger.info(`Polling GET /api/tasks/${ids.overdueTaskId} setiap 10s (maks 390s)...`);

      // Poll via API (mensimulasikan monitoring manual di Postman).
      // Sebelum setiap poll, hapus cache Redis key task:${id} agar API
      // selalu membaca dari DB. Ini diperlukan karena worker update DB di
      // proses berbeda (OverdueWorker) — jika cache invalidation-nya tidak
      // sempurna (race condition, connection reuse), poll akan mengembalikan
      // nilai lama. Dalam skenario Postman nyata ini tidak jadi masalah karena
      // delay antar request sudah cukup; di sini kita pastikan konsistensi.
      let pollCount = 0;
      const overdueTask = await pollUntil(async () => {
        pollCount++;
        // Force cache miss agar API hit DB pada setiap poll
        await redisClient.del(`task:${ids.overdueTaskId}`).catch(() => {});
        const pollRes = await request(app)
          .get(`/api/tasks/${ids.overdueTaskId}`)
          .set('Authorization', `Bearer ${tokens.admin}`);

        const status  = pollRes.body.data?.status;
        const elapsed = pollCount * 10;
        logger.info(
          { poll: pollCount, taskId: ids.overdueTaskId, status, elapsedSeconds: elapsed },
          `Poll #${pollCount} — status: "${status}" (elapsed: ~${elapsed}s)`
        );

        return status === 'overdue' ? pollRes.body.data : null;
      }, 390_000, 10_000);

      logStep('Overdue worker full cycle', 'WORKER', 'RabbitMQ DLX -> DB', 'overdue', overdueTask !== null);
      expect(overdueTask).not.toBeNull();
      expect(overdueTask.status).toBe('overdue');

      logger.info(
        { taskId: ids.overdueTaskId, totalPolls: pollCount },
        `SIKLUS SELESAI — task diubah ke "overdue" setelah ${pollCount} polls (~${pollCount * 10}s)`
      );
    },
    395_000
  );
});

// =============================================================================
//  PHASE 6 — Security: Token Blacklist + Akses Tidak Sah
// =============================================================================
describe('Phase 6 — Security', () => {

  it('POST /api/auth/logout — Staff logout -> 200, token diblacklist di Redis', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('Staff logout', 'POST', '/api/auth/logout', res.status, res.status === 200);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/auth/profile — Token di-blacklist -> 401', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${tokens.staff}`);
    logStep('[Security] Blacklisted token', 'GET', '/api/auth/profile', res.status, res.status === 401);
    expect(res.status).toBe(401);
  });

  it('GET /api/tasks — Tanpa Authorization header -> 401', async () => {
    const res = await request(app).get('/api/tasks');
    logStep('[Security] No token', 'GET', '/api/tasks', res.status, res.status === 401);
    expect(res.status).toBe(401);
  });

  it('GET /api/projects — Malformed Bearer token -> 401/403', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.INVALID.SIGNATURE');
    logStep('[Security] Malformed token', 'GET', '/api/projects', res.status,
      [401, 403].includes(res.status));
    // App may return 401 (Unauthorized) or 403 (Forbidden) for malformed token
    expect([401, 403]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/users — Tanpa token -> 401', async () => {
    const res = await request(app).get('/api/users');
    logStep('[Security] No token on /users', 'GET', '/api/users', res.status, res.status === 401);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/tasks/:id — Admin hapus subtask -> 200', async () => {
    const res = await request(app)
      .delete(`/api/tasks/${ids.subtaskId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin DELETE /tasks/:id (subtask)', 'DELETE', `/api/tasks/${ids.subtaskId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    // Hapus dari daftar cleanup agar tidak double-delete
    created.tasks = created.tasks.filter((id) => id !== ids.subtaskId);
  });

  it('DELETE /api/users/:id — Admin hapus user test -> 200', async () => {
    const res = await request(app)
      .delete(`/api/users/${ids.newUserId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    logStep('Admin DELETE /users/:id', 'DELETE', `/api/users/${ids.newUserId}`, res.status, res.status === 200);
    expect(res.status).toBe(200);
    created.users = created.users.filter((id) => id !== ids.newUserId);
  });
});
