'use strict';
/**
 * Unit Test: TaskService
 * Requirement:
 *  - Standard CRUD task
 *  - Recursive tree view (unlimited depth, cached)
 *  - Cache invalidation (write-through/invalidation strategy)
 *  - Email notification saat task di-assign
 *  - RabbitMQ delay untuk status Overdue
 *  - Task Status: open, working, closed, overdue
 */

jest.mock('../../../src/repositories/taskRepository');
jest.mock('../../../src/models/user');
jest.mock('../../../src/config/redis', () => ({
  cacheHelper: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn()
  },
  redisClient: { on: jest.fn() }
}));
jest.mock('../../../src/config/rabbitmq', () => ({
  publishDelayed: jest.fn().mockResolvedValue(true),
  publishToQueue: jest.fn().mockResolvedValue(true),
  PROCESSING_QUEUE: 'task_overdue_queue'
}));
jest.mock('../../../src/config/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  emailTemplates: {
    taskAssigned: jest.fn().mockReturnValue({
      subject: 'Task Assigned',
      text: 'You have a new task',
      html: '<p>You have a new task</p>'
    })
  }
}));
jest.mock('../../../src/config/logger', () => ({
  child: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

const taskService = require('../../../src/services/taskService');
const taskRepository = require('../../../src/repositories/taskRepository');
const User = require('../../../src/models/user');
const { cacheHelper } = require('../../../src/config/redis');
const { publishDelayed, publishToQueue } = require('../../../src/config/rabbitmq');
const { sendEmail, emailTemplates } = require('../../../src/config/mailer');

// Helpers untuk setup email mock (direset tiap test oleh resetAllMocks)
const setupEmailMock = () => {
  emailTemplates.taskAssigned.mockReturnValue({
    subject: 'Task Assigned',
    text: 'You have a new task',
    html: '<p>You have a new task</p>'
  });
  sendEmail.mockResolvedValue(true);
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeTask = (overrides = {}) => ({
  id: 1,
  title: 'Test Task',
  description: 'Test description',
  status: 'open',
  priority: 'high',
  due_date: '2026-12-31T23:59:59',
  project_id: 1,
  assigned_to: 3,
  parent_task_id: null,
  created_by: 1,
  toJSON: jest.fn().mockReturnThis,
  ...overrides
});

const makeUser = (id = 3, role = 'staff') => ({
  id, name: 'Staff User', email: 'staff@example.com',
  username: 'staffuser', role
});

beforeEach(() => jest.resetAllMocks());

// ─── getTaskTree ──────────────────────────────────────────────────────────────

describe('TaskService.getTaskTree', () => {
  const flatTasks = [
    { id: 1, title: 'Root Task', parent_task_id: null, status: 'open', priority: 'high', project_id: 1 },
    { id: 2, title: 'Sub Task 1', parent_task_id: 1, status: 'working', priority: 'medium', project_id: 1 },
    { id: 3, title: 'Sub Task 2', parent_task_id: 1, status: 'closed', priority: 'low', project_id: 1 },
    { id: 4, title: 'Deep Sub Task', parent_task_id: 2, status: 'open', priority: 'high', project_id: 1 },
  ];

  test('CACHE HIT: mengembalikan data dari cache jika tersedia', async () => {
    const cachedResult = { tree: [], statistics: {}, generated_at: 'cached' };
    cacheHelper.get.mockResolvedValue(cachedResult);

    const result = await taskService.getTaskTree(1, 1);

    expect(cacheHelper.get).toHaveBeenCalledWith('tasks:tree:1');
    expect(taskRepository.findByProject).not.toHaveBeenCalled();
    expect(result.generated_at).toBe('cached');
  });

  test('CACHE MISS: membangun tree dari database jika cache kosong', async () => {
    cacheHelper.get.mockResolvedValue(null);
    taskRepository.findByProject.mockResolvedValue(flatTasks);
    cacheHelper.set.mockResolvedValue(true);

    const result = await taskService.getTaskTree(1, 1);

    expect(taskRepository.findByProject).toHaveBeenCalledWith(1);
    expect(cacheHelper.set).toHaveBeenCalledWith(
      'tasks:tree:1', expect.any(Object), expect.any(Number)
    );
    expect(result.tree).toHaveLength(1); // 1 root
    expect(result.statistics).toBeDefined();
  });

  test('TREE STRUCTURE: tree memiliki hirarki yang benar (parent → children)', async () => {
    cacheHelper.get.mockResolvedValue(null);
    taskRepository.findByProject.mockResolvedValue(flatTasks);
    cacheHelper.set.mockResolvedValue(true);

    const result = await taskService.getTaskTree(1, 1);
    const root = result.tree[0];

    expect(root.id).toBe(1);
    expect(root.subtasks).toHaveLength(2);
    expect(root.subtasks.find(s => s.id === 2).subtasks).toHaveLength(1);
  });

  test('mengembalikan tree kosong untuk project tanpa tasks', async () => {
    cacheHelper.get.mockResolvedValue(null);
    taskRepository.findByProject.mockResolvedValue([]);

    const result = await taskService.getTaskTree(1, 1);

    expect(result.tree).toEqual([]);
    expect(result.statistics.total_tasks).toBe(0);
  });
});

// ─── createTask ───────────────────────────────────────────────────────────────

describe('TaskService.createTask', () => {
  test('berhasil membuat task baru dengan status default open', async () => {
    const mockTask = makeTask();
    taskRepository.create.mockResolvedValue(mockTask);
    taskRepository.findById.mockResolvedValue(mockTask);
    User.findByPk.mockResolvedValue(makeUser());
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    const result = await taskService.createTask({
      title: 'Test Task',
      priority: 'high',
      project_id: 1,
      assigned_to: 3,
      due_date: '2026-12-31T23:59:59',
      created_by: 1
    });

    expect(taskRepository.create).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('RABBITMQ DELAY: scheduleOverdue dipanggil saat task dibuat dengan due_date', async () => {
    const mockTask = makeTask();
    taskRepository.create.mockResolvedValue(mockTask);
    taskRepository.findById.mockResolvedValue(mockTask);
    User.findByPk.mockResolvedValue(makeUser());
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    await taskService.createTask({
      title: 'Task with Due Date',
      priority: 'high',
      project_id: 1,
      assigned_to: 3,
      due_date: '2026-12-31T23:59:59',
      created_by: 1
    });

    // publishDelayed harus dipanggil untuk schedule overdue check
    expect(publishDelayed).toHaveBeenCalled();
  });

  test('EMAIL NOTIFICATION: mengirim email ke assignee saat task dibuat dengan assigned_to', async () => {
    setupEmailMock();
    const mockTask = makeTask();
    taskRepository.create.mockResolvedValue(mockTask);
    taskRepository.findById.mockResolvedValue(mockTask);
    User.findByPk.mockResolvedValue(makeUser());
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    await taskService.createTask({
      title: 'Task with Assignment',
      priority: 'high',
      project_id: 1,
      assigned_to: 3,
      due_date: '2026-12-31T23:59:59',
      created_by: 1
    });

    expect(sendEmail).toHaveBeenCalled();
  });

  test('SUBTASK: validasi parent task harus di project yang sama', async () => {
    const parentTask = makeTask({ id: 10, project_id: 99 }); // Beda project
    taskRepository.findById.mockResolvedValue(parentTask);

    await expect(taskService.createTask({
      title: 'Bad Subtask',
      project_id: 1,
      parent_task_id: 10,
      created_by: 1
    })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Parent task must be in the same project'
    });
  });

  test('SUBTASK: gagal jika parent task tidak ditemukan', async () => {
    taskRepository.findById.mockResolvedValue(null);

    await expect(taskService.createTask({
      title: 'Orphan Subtask',
      project_id: 1,
      parent_task_id: 9999,
      created_by: 1
    })).rejects.toMatchObject({ statusCode: 404, message: 'Parent task not found' });
  });
});

// ─── getTaskById ──────────────────────────────────────────────────────────────

describe('TaskService.getTaskById', () => {
  test('CACHE HIT: mengembalikan single task dari cache', async () => {
    const cachedTask = makeTask();
    cacheHelper.get.mockResolvedValue(cachedTask);

    const result = await taskService.getTaskById(1, 1);

    expect(cacheHelper.get).toHaveBeenCalledWith('task:1');
    expect(taskRepository.findById).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
  });

  test('CACHE MISS: mengambil dari DB dan cache hasilnya', async () => {
    cacheHelper.get.mockResolvedValue(null);
    const mockTask = makeTask();
    taskRepository.findById.mockResolvedValue(mockTask);
    cacheHelper.set.mockResolvedValue(true);

    const result = await taskService.getTaskById(1, 1);

    expect(taskRepository.findById).toHaveBeenCalledWith(1);
    expect(cacheHelper.set).toHaveBeenCalledWith('task:1', mockTask);
    expect(result).toBeDefined();
  });

  test('throw 404 jika task tidak ditemukan', async () => {
    cacheHelper.get.mockResolvedValue(null);
    taskRepository.findById.mockResolvedValue(null);

    await expect(taskService.getTaskById(999, 1))
      .rejects.toMatchObject({ statusCode: 404, message: 'Task not found' });
  });
});

// ─── updateTask ───────────────────────────────────────────────────────────────

describe('TaskService.updateTask', () => {
  test('TASK STATUS: update status ke semua status yang valid (open/working/closed/overdue)', async () => {
    for (const status of ['open', 'working', 'closed', 'overdue']) {
      jest.clearAllMocks();
      const mockTask = makeTask({ status });
      taskRepository.update.mockResolvedValue(mockTask);
      taskRepository.findById.mockResolvedValue(mockTask);
      cacheHelper.del.mockResolvedValue(true);
      cacheHelper.delPattern.mockResolvedValue(true);
      User.findByPk.mockResolvedValue(makeUser());

      const result = await taskService.updateTask(1, { status }, 1, 'admin');
      expect(result).toBeDefined();
    }
  });

  test('CACHE INVALIDATION: cache di-invalidate setelah update (write-through + tree invalidation)', async () => {
    const mockTask = makeTask({ status: 'working' });
    taskRepository.update.mockResolvedValue(mockTask);
    taskRepository.findById.mockResolvedValue(mockTask);
    cacheHelper.set.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);
    User.findByPk.mockResolvedValue(makeUser());

    await taskService.updateTask(1, { status: 'working' }, 1, 'admin');

    // Write-through: single task di-tulis langsung ke cache (bukan di-delete)
    expect(cacheHelper.set).toHaveBeenCalledWith('task:1', mockTask, 300);
    // Tree dan list cache di-invalidate
    expect(cacheHelper.del).toHaveBeenCalledWith('tasks:tree:1');
  });

  test('EMAIL NOTIFICATION: dikirim saat assigned_to berubah', async () => {
    setupEmailMock();
    const oldTask = makeTask({ assigned_to: 3 });
    const updatedTask = makeTask({ assigned_to: 4 });
    taskRepository.findById.mockResolvedValueOnce(oldTask).mockResolvedValueOnce(updatedTask);
    taskRepository.update.mockResolvedValue(updatedTask);
    User.findByPk.mockResolvedValue(makeUser(4));
    cacheHelper.set.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    await taskService.updateTask(1, { assigned_to: 4 }, 1, 'admin');

    expect(sendEmail).toHaveBeenCalled();
  });

  test('throw 404 jika task tidak ditemukan saat update', async () => {
    taskRepository.findById.mockResolvedValue(null);

    await expect(taskService.updateTask(999, { status: 'closed' }, 1, 'admin'))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── deleteTask ───────────────────────────────────────────────────────────────

describe('TaskService.deleteTask', () => {
  test('berhasil menghapus task', async () => {
    const mockTask = makeTask();
    taskRepository.findById.mockResolvedValue(mockTask);
    taskRepository.findByProject.mockResolvedValue([mockTask]); // untuk getDescendantIds cascade
    taskRepository.delete.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    const result = await taskService.deleteTask(1, 1, 'admin');
    expect(taskRepository.delete).toHaveBeenCalledWith(1);
    expect(result).toBe(true);
  });

  test('throw 404 jika task tidak ditemukan', async () => {
    taskRepository.findById.mockResolvedValue(null);

    await expect(taskService.deleteTask(999, 1, 'admin'))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── invalidateTaskCache ──────────────────────────────────────────────────────

describe('TaskService — cache invalidation strategy', () => {
  test('WRITE-THROUGH: invalidasi semua key cache yang terkait setelah perubahan', async () => {
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    await taskService.invalidateTaskCache(1);

    // Harus hapus tree cache
    expect(cacheHelper.del).toHaveBeenCalledWith('tasks:tree:1');
    expect(cacheHelper.del).toHaveBeenCalledWith('tasks:tree:metadata:1');

    // Harus hapus list cache (project-scoped)
    expect(cacheHelper.delPattern).toHaveBeenCalledWith('tasks:list:1:*');

    // Harus hapus global admin tree
    expect(cacheHelper.delPattern).toHaveBeenCalledWith('tasks:tree:all:*');
  });
});

// ─── overdue automation ───────────────────────────────────────────────────────

describe('TaskService.checkOverdueTasks', () => {
  test('OVERDUE AUTOMATION: mengubah status task ke overdue dan kirim ke queue', async () => {
    const overdueTasks = [
      makeTask({ id: 10, status: 'open', project_id: 1, assigned_to: 3 }),
      makeTask({ id: 11, status: 'working', project_id: 2, assigned_to: 4 })
    ];
    taskRepository.findOverdue.mockResolvedValue(overdueTasks);
    taskRepository.update.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    const count = await taskService.checkOverdueTasks();

    expect(taskRepository.update).toHaveBeenCalledWith(10, { status: 'overdue' });
    expect(taskRepository.update).toHaveBeenCalledWith(11, { status: 'overdue' });
    expect(publishToQueue).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
  });
});
