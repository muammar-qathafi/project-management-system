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
 *
 * Cara kerja Delay tanpa plugin tambahan:
 *   Publisher → DELAY_QUEUE (expiration = delay ms)
 *                   ↓ TTL habis
 *               DLX (default exchange "")
 *                   ↓ routing key = PROCESSING_QUEUE
 *               PROCESSING_QUEUE → Worker
 */
const PROCESSING_QUEUE = process.env.RABBITMQ_QUEUE_OVERDUE || 'task_overdue_queue';
const DELAY_QUEUE       = `${PROCESSING_QUEUE}.delay`;

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

    console.log('✓ RabbitMQ connected (queues: processing + delay)');

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

/**
 * Mulai mengkonsumsi pesan dari sebuah queue.
 * callback(parsedMessage) dipanggil untuk setiap pesan.
 * Jika callback melempar error, pesan di-nack (dibuang, tidak di-requeue).
 */
const consumeFromQueue = async (queueName, callback) => {
  try {
    const ch = await getChannel();
    await ch.assertQueue(queueName, { durable: true });
    ch.prefetch(1); // proses satu pesan per waktu

    console.log(`[MQ] Waiting for messages in "${queueName}"...`);

    ch.consume(queueName, async (msg) => {
      if (!msg) return;
      try {
        const content = JSON.parse(msg.content.toString());
        await callback(content);
        ch.ack(msg);
      } catch (error) {
        console.error('[MQ] Error processing message:', error.message);
        ch.nack(msg, false, false); // reject, jangan requeue
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
  PROCESSING_QUEUE,
  DELAY_QUEUE,
  getChannel: () => channel,
  getConnection: () => connection
};
