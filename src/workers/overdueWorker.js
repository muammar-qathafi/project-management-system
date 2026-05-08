require('dotenv').config();
const { consumeFromQueue, PROCESSING_QUEUE, PermanentError } = require('../config/rabbitmq');
const { sequelize } = require('../config/database');
const { cacheHelper } = require('../config/redis');
const { sendEmail, emailTemplates } = require('../config/mailer');
const { Op } = require('sequelize');
const Task = require('../models/task');
const User = require('../models/user');

/**
 * Overdue Worker
 *
 * Alur:
 *  1. taskService.createTask / updateTask mem-publish pesan ke DELAY_QUEUE
 *     dengan expiration = (due_date - now) ms.
 *  2. Setelah TTL habis, RabbitMQ (via DLX) otomatis memindahkan pesan ke
 *     PROCESSING_QUEUE.
 *  3. Worker ini mengkonsumsi PROCESSING_QUEUE, lalu:
 *     a. Ambil task dari DB.
 *     b. Jika status BUKAN 'closed', ubah menjadi 'overdue'.
 *     c. Kirim email notifikasi ke user yang di-assign.
 *     d. Invalidasi cache Redis untuk tree yang berubah.
 */

class OverdueWorker {
  /**
   * Mulai worker: koneksi DB, mulai consume queue.
   */
  async start() {
    try {
      console.log('[Worker] Starting Overdue Worker...');

      await sequelize.authenticate();
      console.log('[Worker] ✓ Database connected');

      await consumeFromQueue(PROCESSING_QUEUE, (msg) => this.handleMessage(msg));

      console.log(`[Worker] ✓ Listening on "${PROCESSING_QUEUE}"`);
    } catch (error) {
      console.error('[Worker] Failed to start:', error.message);
      process.exit(1);
    }
  }

  /**
   * Router pesan berdasarkan field `type`.
   */
  async handleMessage(message) {
    const { type } = message;
    console.log('[Worker] Received message:', message);

    switch (type) {
      case 'task_overdue_check':
        await this.processOverdueCheck(message.task_id);
        break;

      default:
        // [IDEMPOTENCY] Tipe pesan tidak dikenal tidak akan berhasil dengan retry.
        // PermanentError memastikan pesan langsung dipindahkan ke DLQ.
        console.warn('[Worker] Unknown message type:', type);
        throw new PermanentError(`Unknown message type: "${type}"`);
    }
  }

  /**
   * Inti logika: cek task → jika belum 'closed', set 'overdue' + kirim email.
   *
   * @param {number} taskId
   */
  async processOverdueCheck(taskId) {
    // [IDEMPOTENCY] Gunakan atomic conditional UPDATE dengan WHERE clause.
    // Jika pesan dikirim dua kali (double-delivery setelah reconnect):
    //   - Pertama kali: UPDATE berhasil, affectedRows = 1
    //   - Kedua kali:   Task sudah 'overdue', affectedRows = 0 → skip aman
    //
    // Tidak ada TOCTOU race condition karena check dan update adalah SATU
    // SQL statement atomik (tidak ada findByPk + update terpisah).
    //
    // [ERROR HANDLING] Jika DB mati di sini, Task.update() melempar error.
    // consumeFromQueue menangkapnya sebagai error transien → RETRY_QUEUE.
    const [affectedRows] = await Task.update(
      { status: 'overdue' },
      {
        where: {
          id:     taskId,
          status: { [Op.notIn]: ['closed', 'overdue'] }
        }
      }
    );

    if (affectedRows === 0) {
      // Task tidak ditemukan, sudah closed, atau sudah overdue — aman dilewati
      console.log(`[Worker] Task #${taskId} skipped — not found, closed, or already overdue (idempotent).`);
      return;
    }

    console.log(`[Worker] Task #${taskId} → status set to 'overdue'`);

    // Fetch data terbaru untuk keperluan email dan cache invalidation.
    // Jika DB sempat mati antara UPDATE dan findByPk, Task.findByPk() akan
    // melempar error → consumeFromQueue men-retry. Pada retry berikutnya,
    // affectedRows=0 (sudah overdue) sehingga skip dengan aman.
    const task = await Task.findByPk(taskId);
    if (!task) {
      // Edge case: task dihapus antara UPDATE dan findByPk
      console.warn(`[Worker] Task #${taskId} updated but deleted before fetch. Skipping notifications.`);
      return;
    }

    // Cache invalidation dan email tidak boleh menyebabkan retry —
    // keduanya sudah di-wrap try/catch di dalam helper masing-masing.
    await this._invalidateCache(task.project_id, task.id);
    await this.sendOverdueNotification(task);
  }

  /**
   * Kirim email overdue ke user yang di-assign.
   */
  async sendOverdueNotification(task) {
    if (!task.assigned_to) return;

    const user = await User.findByPk(task.assigned_to);
    if (!user) return;

    try {
      const { subject, text, html } = emailTemplates.taskOverdue(task, user);
      const result = await sendEmail({ to: user.email, subject, text, html });

      if (result.success) {
        console.log(`[Worker] Overdue email sent → ${user.email} (task #${task.id})`);
      } else {
        console.warn(`[Worker] Email failed for task #${task.id}:`, result.error);
      }
    } catch (err) {
      console.error('[Worker] sendOverdueNotification error:', err.message);
    }
  }

  /**
   * Hapus cache list & tree yang terpengaruh.
   * Menggunakan project-scoped key pattern agar tidak menginvalidasi
   * cache project lain yang tidak berhubungan.
   */
  async _invalidateCache(projectId, taskId) {
    try {
      await Promise.all([
        cacheHelper.delPattern(`tasks:list:${projectId}:*`),
        cacheHelper.delPattern('tasks:list:all:*'),
        cacheHelper.del(`tasks:tree:${projectId}`),
        cacheHelper.del(`tasks:tree:metadata:${projectId}`),
        cacheHelper.delPattern('tasks:tree:all:*'),
        cacheHelper.del(`task:${taskId}`)
      ]);
      console.log(`[Worker] Cache invalidated for project #${projectId}`);
    } catch (err) {
      console.error('[Worker] Cache invalidation error:', err.message);
    }
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const worker = new OverdueWorker();
  worker.start();

  const shutdown = (signal) => {
    console.log(`[Worker] ${signal} received, shutting down...`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

module.exports = OverdueWorker;
