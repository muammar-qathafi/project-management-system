'use strict';
/**
 * Unit Test: RBAC Middleware
 * Requirement:
 *  - Admin: Full access (CRUD) untuk User, Project, Task
 *  - Manager: Update project saja (tidak Create/Delete), CRUD task yang di-assign
 *  - Staff: Hanya manage task yang di-assign (Update saja, tidak Create/Delete)
 */

jest.mock('../../../src/repositories/taskRepository');
jest.mock('../../../src/utils/responseHandler', () => ({
  errorResponse: jest.fn((msg, code) => ({ success: false, statusCode: code, message: msg }))
}));

const {
  checkRole,
  isAdmin,
  isManager,
  canCreateProject,
  canUpdateProject,
  canDeleteProject,
  canCreateTask,
  canUpdateTask,
  canDeleteTask,
  isAdminOrSelf
} = require('../../../src/middlewares/roleMiddleware');
const taskRepository = require('../../../src/repositories/taskRepository');

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/**
 * Helper: simulasi express middleware call
 */
const runMiddleware = (middleware, req) => {
  return new Promise((resolve) => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    middleware(req, res, next);
    // Async middleware butuh setImmediate
    setImmediate(() => resolve({ req, res, next }));
  });
};

const makeReq = (role, extra = {}) => ({
  user: { id: 1, role, email: `${role}@test.com` },
  params: {},
  ...extra
});

beforeEach(() => jest.clearAllMocks());

// ─── checkRole ────────────────────────────────────────────────────────────────

describe('checkRole middleware', () => {
  test('lolos jika role user termasuk dalam daftar yang diizinkan', async () => {
    const mw = checkRole(['admin', 'manager']);
    const { next, res } = await runMiddleware(mw, makeReq('admin'));
    expect(next).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('ditolak (403) jika role tidak diizinkan', async () => {
    const mw = checkRole(['admin']);
    const { next, res } = await runMiddleware(mw, makeReq('staff'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('ditolak (401) jika req.user tidak ada (unauthenticated)', async () => {
    const mw = checkRole(['admin']);
    const { next, res } = await runMiddleware(mw, { params: {} });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Project RBAC ─────────────────────────────────────────────────────────────

describe('Project RBAC — canCreateProject', () => {
  test('Admin BOLEH membuat project', async () => {
    const { next } = await runMiddleware(canCreateProject, makeReq('admin'));
    expect(next).toHaveBeenCalled();
  });

  test('Manager TIDAK BOLEH membuat project (403)', async () => {
    const { res, next } = await runMiddleware(canCreateProject, makeReq('manager'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('Staff TIDAK BOLEH membuat project (403)', async () => {
    const { res, next } = await runMiddleware(canCreateProject, makeReq('staff'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('Project RBAC — canUpdateProject', () => {
  test('Admin BOLEH mengupdate project', async () => {
    const { next } = await runMiddleware(canUpdateProject, makeReq('admin'));
    expect(next).toHaveBeenCalled();
  });

  test('Manager BOLEH mengupdate project', async () => {
    const { next } = await runMiddleware(canUpdateProject, makeReq('manager'));
    expect(next).toHaveBeenCalled();
  });

  test('Staff TIDAK BOLEH mengupdate project (403)', async () => {
    const { res, next } = await runMiddleware(canUpdateProject, makeReq('staff'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('Project RBAC — canDeleteProject', () => {
  test('Admin BOLEH menghapus project', async () => {
    const { next } = await runMiddleware(canDeleteProject, makeReq('admin'));
    expect(next).toHaveBeenCalled();
  });

  test('Manager TIDAK BOLEH menghapus project (403)', async () => {
    const { res, next } = await runMiddleware(canDeleteProject, makeReq('manager'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('Staff TIDAK BOLEH menghapus project (403)', async () => {
    const { res, next } = await runMiddleware(canDeleteProject, makeReq('staff'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─── Task RBAC ────────────────────────────────────────────────────────────────

describe('Task RBAC — canCreateTask', () => {
  test('Admin BOLEH membuat task', async () => {
    const { next } = await runMiddleware(canCreateTask, makeReq('admin'));
    expect(next).toHaveBeenCalled();
  });

  test('Manager BOLEH membuat task', async () => {
    const { next } = await runMiddleware(canCreateTask, makeReq('manager'));
    expect(next).toHaveBeenCalled();
  });

  test('Staff TIDAK BOLEH membuat task (403)', async () => {
    const { res, next } = await runMiddleware(canCreateTask, makeReq('staff'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('Task RBAC — canUpdateTask (ownership required for non-admin)', () => {
  test('Admin BOLEH mengupdate task apapun (langsung lolos tanpa cek ownership)', async () => {
    const { next } = await runMiddleware(
      canUpdateTask,
      makeReq('admin', { params: { id: '5' } })
    );
    expect(next).toHaveBeenCalled();
    expect(taskRepository.findById).not.toHaveBeenCalled();
  });

  test('Manager BOLEH update task yang di-assign kepadanya', async () => {
    taskRepository.findById.mockResolvedValue({
      id: 5, title: 'Task', assigned_to: 2, project_id: 1
    });

    const req = {
      user: { id: 2, role: 'manager' },
      params: { id: '5' }
    };
    const { next } = await runMiddleware(canUpdateTask, req);
    expect(next).toHaveBeenCalled();
  });

  test('Manager TIDAK BOLEH update task yang bukan miliknya (403)', async () => {
    taskRepository.findById.mockResolvedValue({
      id: 5, title: 'Task', assigned_to: 99, project_id: 1  // Milik orang lain
    });

    const req = {
      user: { id: 2, role: 'manager' },
      params: { id: '5' }
    };
    const { res, next } = await runMiddleware(canUpdateTask, req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('Staff BOLEH update task yang di-assign kepadanya', async () => {
    taskRepository.findById.mockResolvedValue({
      id: 7, title: 'Staff Task', assigned_to: 3, project_id: 1
    });

    const req = {
      user: { id: 3, role: 'staff' },
      params: { id: '7' }
    };
    const { next } = await runMiddleware(canUpdateTask, req);
    expect(next).toHaveBeenCalled();
  });

  test('Staff TIDAK BOLEH update task yang bukan miliknya (403)', async () => {
    taskRepository.findById.mockResolvedValue({
      id: 7, title: 'Other Task', assigned_to: 99, project_id: 1
    });

    const req = {
      user: { id: 3, role: 'staff' },
      params: { id: '7' }
    };
    const { res, next } = await runMiddleware(canUpdateTask, req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('Task RBAC — canDeleteTask', () => {
  test('Admin BOLEH menghapus task apapun', async () => {
    const { next } = await runMiddleware(
      canDeleteTask,
      makeReq('admin', { params: { id: '5' } })
    );
    expect(next).toHaveBeenCalled();
    expect(taskRepository.findById).not.toHaveBeenCalled();
  });

  test('Manager BOLEH menghapus task yang di-assign kepadanya', async () => {
    taskRepository.findById.mockResolvedValue({
      id: 5, assigned_to: 2, project_id: 1
    });

    const req = {
      user: { id: 2, role: 'manager' },
      params: { id: '5' }
    };
    const { next } = await runMiddleware(canDeleteTask, req);
    expect(next).toHaveBeenCalled();
  });

  test('Staff TIDAK BOLEH menghapus task apapun (403)', async () => {
    const req = {
      user: { id: 3, role: 'staff' },
      params: { id: '5' }
    };
    const { res, next } = await runMiddleware(canDeleteTask, req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─── isAdminOrSelf ────────────────────────────────────────────────────────────

describe('isAdminOrSelf', () => {
  test('Admin boleh akses data user manapun', async () => {
    const req = {
      user: { id: 1, role: 'admin' },
      params: { id: '5' }
    };
    const { next } = await runMiddleware(isAdminOrSelf, req);
    expect(next).toHaveBeenCalled();
  });

  test('User boleh akses data dirinya sendiri', async () => {
    const req = {
      user: { id: 3, role: 'staff' },
      params: { id: '3' }
    };
    const { next } = await runMiddleware(isAdminOrSelf, req);
    expect(next).toHaveBeenCalled();
  });

  test('User TIDAK BOLEH akses data user lain (403)', async () => {
    const req = {
      user: { id: 3, role: 'staff' },
      params: { id: '99' }
    };
    const { res, next } = await runMiddleware(isAdminOrSelf, req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
