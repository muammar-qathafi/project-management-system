const amqp = require('amqplib');
require('dotenv').config();

let connection = null;
let channel = null;

/**
 * Nama queue yang digunakan:
 *
 *  PROCESSING_QUEUE  — worker membaca pesan dari sini
 *  DELAY_QUEUE       — pesan "parkir" di sini selama TTL (due_date - now)
 *                      Setelah expired → otomatis di-route ke PROCESSING_QUEUE
 *                      via Dead Letter Exchange (DLX).
 *  RETRY_QUEUE       — pesan parkir sementara saat terjadi error transien
 *                      (DB mati, network error, dsb). Per-message expiration +
 *                      DLX kembali ke PROCESSING_QUEUE setelah backoff.
 *  DLQ_QUEUE         — parking lot permanen untuk pesan yang sudah melebihi
 *                      MAX_RETRIES atau dilempar sebagai PermanentError.
 *                      Digunakan untuk monitoring, alerting, dan replay manual.
 *
 * Alur Retry:
 *   Worker gagal (transien) → RETRY_QUEUE (expiration = backoff ms)
 *                   ↓ TTL habis
 *               DLX → PROCESSING_QUEUE → Worker (coba lagi)
 *               Setelah MAX_RETRIES → DLQ_QUEUE
 *
 * Alur Delay (tetap sama):
 *   Publisher → DELAY_QUEUE (expiration = delay ms)
 *                   ↓ TTL habis
 *               DLX (default exchange "")
 *                   ↓ routing key = PROCESSING_QUEUE
 *               PROCESSING_QUEUE → Worker
 */
const PROCESSING_QUEUE = process.env.RABBITMQ_QUEUE_OVERDUE || 'task_overdue_queue';
const DELAY_QUEUE       = `${PROCESSING_QUEUE}.delay`;
const RETRY_QUEUE       = `${PROCESSING_QUEUE}.retry`;
const DLQ_QUEUE         = `${PROCESSING_QUEUE}.dlq`;

// Maksimum retry sebelum pesan diparkir ke DLQ
const MAX_RETRIES = parseInt(process.env.RABBITMQ_MAX_RETRIES || '3', 10);
// Exponential backoff: retry ke-1 = 30s, ke-2 = 60s, ke-3+ = 120s
const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000];

/**
 * Error yang menandakan kegagalan permanen — tidak perlu di-retry.
 * Lempar dari callback consumer untuk langsung memindahkan pesan ke DLQ.
 *
 * Contoh penggunaan:
 *   throw new PermanentError('Unknown message type: ' + type);
 *   throw new PermanentError('task_id is missing from payload');
 */
class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentError';
  }
}

const connectRabbitMQ = async () => {
  try {
    // heartbeat=60 mencegah TCP idle timeout pada NAT/firewall/Docker network
    const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    connection = await amqp.connect(url, { heartbeat: 60 });
    channel = await connection.createChannel();

    // 1. Queue utama — worker mengkonsumsi dari sini
    await channel.assertQueue(PROCESSING_QUEUE, { durable: true });

    // 2. Delay queue — DLX mengarah ke default exchange,
    //    routing key = nama PROCESSING_QUEUE
    await channel.assertQueue(DELAY_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange':    '',               // default exchange
        'x-dead-letter-routing-key': PROCESSING_QUEUE // forward ke processing queue
      }
    });

    // 3. Retry queue — pesan parkir selama per-message expiration, lalu DLX kembali ke
    //    PROCESSING_QUEUE. Tidak menggunakan x-message-ttl (queue-level) agar tiap pesan
    //    bisa memiliki backoff yang berbeda (exponential) via property 'expiration'.
    await channel.assertQueue(RETRY_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange':    '',
        'x-dead-letter-routing-key': PROCESSING_QUEUE
      }
    });

    // 4. Dead Letter Queue — parking lot permanen. Tidak ada consumer otomatis;
    //    dimonitor secara manual atau via alerting.
    await channel.assertQueue(DLQ_QUEUE, { durable: true });

    console.log('✓ RabbitMQ connected (queues: processing + delay + retry + dlq)');

    connection.on('error', (err) => {
      console.error('✗ RabbitMQ connection error:', err.message);
    });

    connection.on('close', () => {
      console.log('RabbitMQ connection closed, attempting to reconnect...');
      // Reset channel agar getChannel() tidak pakai referensi lama yang sudah mati
      connection = null;
      channel = null;
      setTimeout(connectRabbitMQ, 5000);
    });

    return { connection, channel };
  } catch (error) {
    console.error('✗ Failed to connect to RabbitMQ:', error.message);
    setTimeout(connectRabbitMQ, 5000);
  }
};

const getChannel = async () => {
  if (!channel) await connectRabbitMQ();
  return channel;
};

/**
 * Publish pesan langsung ke processing queue (tanpa delay).
 */
const publishToQueue = async (queueName, message) => {
  try {
    const ch = await getChannel();
    await ch.assertQueue(queueName, { durable: true });
    ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
      persistent: true
    });
    console.log(`[MQ] Published to ${queueName}:`, message);
    return true;
  } catch (error) {
    console.error('[MQ] publishToQueue error:', error.message);
    return false;
  }
};

/**
 * Publish pesan dengan delay ke DELAY_QUEUE.
 * Setelah `delayMs` milidetik, pesan secara otomatis pindah ke PROCESSING_QUEUE.
 *
 * @param {object} message  - objek yang akan dikirim
 * @param {number} delayMs  - waktu tunda dalam milidetik
 */
const publishDelayed = async (message, delayMs) => {
  try {
    const ch = await getChannel();

    // expiration harus string dan >= 0
    const ttl = Math.max(0, Math.floor(delayMs));

    ch.sendToQueue(DELAY_QUEUE, Buffer.from(JSON.stringify(message)), {
      persistent:  true,
      expiration:  String(ttl)   // per-message TTL (ms)
    });

    const fireAt = new Date(Date.now() + ttl).toISOString();
    console.log(`[MQ] Delayed message queued (ttl=${ttl}ms, fires≈${fireAt}):`, message);
    return true;
  } catch (error) {
    console.error('[MQ] publishDelayed error:', error.message);
    return false;
  }
};

// ─── Internal retry / DLQ helpers ───────────────────────────────────────────

/**
 * Publish pesan ke RETRY_QUEUE dengan exponential backoff.
 * Setiap pesan menggunakan per-message 'expiration' (bukan x-message-ttl)
 * agar tiap attempt memiliki delay yang berbeda.
 * Setelah TTL habis, DLX otomatis mengirim kembali ke PROCESSING_QUEUE.
 */
const _publishToRetry = (ch, content, retryCount) => {
  const delayMs = RETRY_BACKOFF_MS[Math.min(retryCount - 1, RETRY_BACKOFF_MS.length - 1)];
  ch.sendToQueue(RETRY_QUEUE, Buffer.from(JSON.stringify(content)), {
    persistent:  true,
    expiration:  String(delayMs)
  });
  console.warn(`[MQ] Retry #${retryCount}/${MAX_RETRIES} queued (delay=${delayMs}ms, task_id=${content.task_id || '?'})`);
};

/**
 * Publish pesan ke DLQ sebagai parking lot permanen.
 * Menyertakan original message, alasan kegagalan, jumlah retry, dan timestamp.
 */
const _publishToDLQ = (ch, originalBuffer, reason, retryCount = 0) => {
  const dlqPayload = {
    original_message: originalBuffer.toString(),
    failure_reason:   reason,
    retry_count:      retryCount,
    failed_at:        new Date().toISOString()
  };
  ch.sendToQueue(DLQ_QUEUE, Buffer.from(JSON.stringify(dlqPayload)), { persistent: true });
  console.error(`[MQ] Message moved to DLQ (retries=${retryCount}): ${reason}`);
};

// ─── Consumer ────────────────────────────────────────────────────────────────

/**
 * Mulai mengkonsumsi pesan dari sebuah queue.
 * callback(parsedMessage) dipanggil untuk setiap pesan.
 *
 * Retry strategy:
 *  - JSON parse error              → DLQ langsung (tidak bisa diperbaiki)
 *  - PermanentError dari callback  → DLQ langsung
 *  - Error transien (DB mati, dsb) → RETRY_QUEUE dengan exponential backoff
 *  - Habis MAX_RETRIES             → DLQ
 *
 * Retry count disimpan di field _retryCount di dalam payload pesan agar
 * tetap tersedia setelah pesan di-route ulang oleh DLX dari RETRY_QUEUE.
 *
 * Semua path menggunakan ch.ack() — kita selalu memindahkan pesan secara
 * eksplisit daripada mengandalkan nack+requeue untuk menghindari infinite loop.
 */
const consumeFromQueue = async (queueName, callback) => {
  try {
    const ch = await getChannel();
    await ch.assertQueue(queueName, { durable: true });
    ch.prefetch(1); // proses satu pesan per waktu

    console.log(`[MQ] Waiting for messages in "${queueName}"...`);

    ch.consume(queueName, async (msg) => {
      if (!msg) return;

      // 1. Parse JSON — pesan malformed langsung ke DLQ, tidak bisa di-retry
      let content;
      try {
        content = JSON.parse(msg.content.toString());
      } catch (parseError) {
        console.error('[MQ] Malformed JSON, routing to DLQ:', msg.content.toString());
        _publishToDLQ(ch, msg.content, `JSON parse error: ${parseError.message}`);
        ch.ack(msg);
        return;
      }

      const retryCount = content._retryCount || 0;

      try {
        // 2. Proses pesan — callback melempar error jika gagal
        await callback(content);
        ch.ack(msg); // sukses
      } catch (error) {
        const isPermanent = error instanceof PermanentError;

        if (isPermanent || retryCount >= MAX_RETRIES) {
          // 3a. Kegagalan permanen atau retry habis → DLQ
          _publishToDLQ(ch, msg.content, error.message, retryCount);
          ch.ack(msg);
        } else {
          // 3b. Kegagalan transien (DB mati, network error, dsb) → RETRY_QUEUE
          const nextCount = retryCount + 1;
          _publishToRetry(ch, { ...content, _retryCount: nextCount }, nextCount);
          ch.ack(msg);
        }
      }
    });
  } catch (error) {
    console.error('[MQ] consumeFromQueue error:', error.message);
  }
};

const closeRabbitMQ = async () => {
  try {
    if (channel)    await channel.close();
    if (connection) await connection.close();
    console.log('[MQ] Connection closed');
  } catch (error) {
    console.error('[MQ] closeRabbitMQ error:', error.message);
  }
};

module.exports = {
  connectRabbitMQ,
  publishToQueue,
  publishDelayed,
  consumeFromQueue,
  closeRabbitMQ,
  PermanentError,
  PROCESSING_QUEUE,
  DELAY_QUEUE,
  RETRY_QUEUE,
  DLQ_QUEUE,
  getChannel: () => channel,
  getConnection: () => connection
};
