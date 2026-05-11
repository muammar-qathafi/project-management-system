/**
 * Integration Test — Overdue Worker Full Production Cycle (~1 menit)
 *
 * Apa yang diuji:
 *   1. Task dibuat dengan due_date = sekarang + 60 detik
 *   2. Pesan dikirim ke DELAY_QUEUE RabbitMQ dengan TTL = 60 detik
 *   3. Setelah 60 detik, RabbitMQ (via DLX) memindahkan pesan ke PROCESSING_QUEUE
 *   4. OverdueWorker consumer menerima pesan dan menjalankan processOverdueCheck()
 *   5. Status task berubah menjadi 'overdue' di DB
 *   6. Log tercatat di logs/app_test.log (karena NODE_ENV=test)
 *
 * TIDAK ada mock — semua layanan nyata: MySQL, Redis, RabbitMQ
 *
 * Prasyarat:
 *   - Docker containers berjalan: MySQL, Redis, RabbitMQ
 *   - Seed data sudah ada (migrations/005_sample_data.sql)
 *   - File .env sudah dikonfigurasi
 *
 * Jalankan:
 *   npm run test:integration
 */

// ─── Set env sebelum module apapun di-require ────────────────────────────────
process.env.LOG_LEVEL = 'info';
require('dotenv').config();

// ─── Jest timeout: 8 menit (300s delay + polling 360s + buffer) ─────────────
jest.setTimeout(480_000);

// ─── Dependencies ─────────────────────────────────────────────────────────────
const { sequelize }    = require('../../src/config/database');
const {
  connectRabbitMQ,
  publishDelayed,
  consumeFromQueue,
  closeRabbitMQ,
  PROCESSING_QUEUE,
  DELAY_QUEUE,
  getChannel
}                      = require('../../src/config/rabbitmq');
const { redisClient, connectRedis } = require('../../src/config/redis');
const Task             = require('../../src/models/task');
const Project          = require('../../src/models/project');
const User             = require('../../src/models/user');
const OverdueWorker    = require('../../src/workers/overdueWorker');
const logger           = require('../../src/config/logger').child({ component: 'integration-test' });

// ─── Konstanta ────────────────────────────────────────────────────────────────
const DELAY_SECONDS    = 300;          // TTL pesan di DELAY_QUEUE (detik) — 5 menit
const POLL_INTERVAL_MS = 10_000;       // Interval polling DB (ms)
const MAX_POLL_MS      = 420_000;      // Batas waktu polling 7 menit (ms)

// ─── Helper ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll predicate setiap intervalMs sampai hasilnya truthy atau timeout.
 * @returns {*} Nilai truthy dari predicate, atau null jika timeout
 */
const pollUntil = async (predicate, timeoutMs, intervalMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result !== null && result !== false && result !== undefined) return result;
    await sleep(intervalMs);
  }
  return null;
};

// ─── Test Suite ───────────────────────────────────────────────────────────────
describe('Overdue Worker — Full Production Cycle (~1 menit)', () => {
  let testProject = null;
  let testTask    = null;
  let testUser    = null;

  // ── Setup: koneksi nyata + buat data test ──────────────────────────────────
  beforeAll(async () => {
    logger.info('═══════════════════════════════════════════════════');
    logger.info('  Integration test STARTING — connecting services  ');
    logger.info('═══════════════════════════════════════════════════');

    // 1. Database
    await sequelize.authenticate();
    logger.info('✓ MySQL connected');

    // 2. Redis (cek dulu apakah sudah terhubung)
    if (!redisClient.isOpen) {
      await connectRedis();
    }
    logger.info('✓ Redis connected');

    // 3. RabbitMQ
    await connectRabbitMQ();
    logger.info('✓ RabbitMQ connected');

    // 4. Purge queues — pastikan tidak ada pesan lama yang memblokir
    //    RabbitMQ per-message TTL hanya expire saat pesan di HEAD queue.
    //    Pesan baru di belakang antrian tidak akan diproses tepat waktu.
    const ch = getChannel();
    const purgeDelay      = await ch.purgeQueue(DELAY_QUEUE);
    const purgeProcessing = await ch.purgeQueue(PROCESSING_QUEUE);
    logger.info(
      { purgedDelay: purgeDelay.messageCount, purgedProcessing: purgeProcessing.messageCount },
      '✓ Queues purged — clean state'
    );

    // 4. Ambil user manager dari seed data
    testUser = await User.findOne({ where: { role: 'manager' } });
    if (!testUser) {
      throw new Error(
        'Tidak ada user "manager" di DB. Jalankan migrations/005_sample_data.sql terlebih dahulu.'
      );
    }
    logger.info({ userId: testUser.id, name: testUser.name }, '✓ Test user found');

    // 5. Buat project test (diisolasi dengan prefix [INTEGRATION-TEST])
    testProject = await Project.create({
      name:        `[INTEGRATION-TEST] Overdue Project ${Date.now()}`,
      description: 'Project sementara untuk integration test overdue worker',
      status:      'active',
      priority:    'high',
      owner_id:    testUser.id,
    });
    logger.info({ projectId: testProject.id }, '✓ Test project created');

    // 6. Buat task dengan due_date = sekarang + DELAY_SECONDS detik
    const dueDate = new Date(Date.now() + DELAY_SECONDS * 1_000);
    testTask = await Task.create({
      title:       `[INTEGRATION-TEST] Task Overdue ${Date.now()}`,
      description: `Task ini akan menjadi overdue dalam ~${DELAY_SECONDS} detik melalui RabbitMQ`,
      status:      'open',
      priority:    'high',
      due_date:    dueDate,
      project_id:  testProject.id,
      assigned_to: testUser.id,
      created_by:  testUser.id,
    });
    logger.info(
      { taskId: testTask.id, dueDate: dueDate.toISOString() },
      `✓ Test task created — due in ${DELAY_SECONDS}s`
    );

    // 7. Publish delayed message ke DELAY_QUEUE (TTL = DELAY_SECONDS * 1000 ms)
    //    Setelah TTL habis, RabbitMQ memindahkan pesan ke PROCESSING_QUEUE via DLX
    await publishDelayed(
      { type: 'task_overdue_check', task_id: testTask.id },
      DELAY_SECONDS * 1_000
    );
    logger.info(
      { taskId: testTask.id, ttlMs: DELAY_SECONDS * 1_000 },
      `✓ Delayed message published — will fire in ~${DELAY_SECONDS}s`
    );

    // 8. Start OverdueWorker consumer
    //    Langsung gunakan consumeFromQueue (bypass process.exit di OverdueWorker.start())
    const worker = new OverdueWorker();
    await consumeFromQueue(PROCESSING_QUEUE, (msg) => worker.handleMessage(msg));
    logger.info('✓ Worker consumer started — listening on PROCESSING_QUEUE');

    logger.info('');
    logger.info(`⏳ Waiting ~${DELAY_SECONDS}s for RabbitMQ delay to fire...`);
    logger.info(`   Polling DB every ${POLL_INTERVAL_MS / 1_000}s (max ${MAX_POLL_MS / 1_000}s)`);
    logger.info('');
  }, 30_000); // beforeAll diberi 30s tersendiri untuk setup

  // ── Cleanup: hapus data test dan tutup koneksi ─────────────────────────────
  afterAll(async () => {
    logger.info('');
    logger.info('═══════════════════════════════════════════════════');
    logger.info('  Integration test CLEANUP                         ');
    logger.info('═══════════════════════════════════════════════════');

    try {
      if (testTask)    await Task.destroy({ where: { id: testTask.id }, force: true });
      if (testProject) await Project.destroy({ where: { id: testProject.id }, force: true });
      logger.info('✓ Test data cleaned up');
    } catch (err) {
      logger.warn({ err }, 'Cleanup error (non-fatal)');
    }

    await closeRabbitMQ();
    if (redisClient.isOpen) await redisClient.quit();
    await sequelize.close();
    logger.info('✓ All connections closed');
  });

  // ── Test utama: satu siklus penuh (~1 menit) ──────────────────────────────
  it(
    `task status berubah menjadi "overdue" setelah ~${DELAY_SECONDS}s via RabbitMQ delay queue`,
    async () => {
      let pollCount = 0;

      const overdueTask = await pollUntil(async () => {
        pollCount++;
        const task = await Task.findByPk(testTask.id);
        const elapsed = Math.round((Date.now() - new Date(task.created_at).getTime()) / 1_000);

        logger.info(
          { poll: pollCount, taskId: task?.id, status: task?.status, elapsedSeconds: elapsed },
          `Poll #${pollCount} — status: "${task?.status}" (elapsed: ${elapsed}s)`
        );

        if (task && task.status === 'overdue') return task;
        return null;
      }, MAX_POLL_MS, POLL_INTERVAL_MS);

      // ── Assertions ──────────────────────────────────────────────────────────
      expect(overdueTask).not.toBeNull();
      expect(overdueTask.status).toBe('overdue');

      logger.info(
        { taskId: overdueTask.id, finalStatus: overdueTask.status, totalPolls: pollCount },
        '✓ SIKLUS SELESAI — Task berhasil diubah ke "overdue" oleh worker'
      );
    },
    460_000  // individual test timeout: 7.67 menit (300s delay + 160s buffer)
  );
});
