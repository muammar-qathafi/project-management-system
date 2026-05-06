require('dotenv').config();
const { consumeFromQueue, PROCESSING_QUEUE } = require('../config/rabbitmq');
const { sequelize } = require('../config/database');
const { cacheHelper } = require('../config/redis');
const { sendEmail, emailTemplates } = require('../config/mailer');
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
        console.warn('[Worker] Unknown message type:', type);
    }
  }

  /**
   * Inti logika: cek task → jika belum 'completed', set 'overdue' + kirim email.
   *
   * Pesan dikirim tepat saat due_date tiba (via delay queue), sehingga kita
   * cukup cek apakah status != 'closed'. Tidak perlu bandingkan tanggal lagi.
   *
   * @param {number} taskId
   */
  async processOverdueCheck(taskId) {
    const task = await Task.findByPk(taskId);

    if (!task) {
      console.warn(`[Worker] Task #${taskId} not found, skipping.`);
      return;
    }

    // 'closed' = task sudah selesai sebelum due_date, tidak perlu diubah
    if (task.status === 'closed') {
      console.log(`[Worker] Task #${taskId} already closed, no action needed.`);
      return;
    }

    if (task.status === 'overdue') {
      console.log(`[Worker] Task #${taskId} already marked overdue.`);
      return;
    }

    // Ubah status menjadi overdue
    await task.update({ status: 'overdue' });
    console.log(`[Worker] Task #${taskId} → status set to 'overdue'`);

    // Invalidasi cache tree untuk project yang bersangkutan
    await this._invalidateCache(task.project_id, task.id);

    // Kirim email notifikasi ke assignee
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
   * (Duplikasi kecil dari taskService.invalidateTaskCache — worker tidak boleh
   *  import seluruh service untuk menghindari circular dependency.)
   */
  async _invalidateCache(projectId, taskId) {
    try {
      await Promise.all([
        cacheHelper.delPattern('tasks:list:*'),
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
