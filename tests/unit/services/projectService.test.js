'use strict';
/**
 * Unit Test: ProjectService
 * Requirement:
 *  - Project dibuat oleh Admin, hanya dapat di-assign ke user dengan role Manager
 *  - Manager: Update project saja (tidak bisa Create/Delete)
 *  - Cache invalidation saat ada perubahan
 */

jest.mock('../../../src/repositories/projectRepository');
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

const projectService = require('../../../src/services/projectService');
const projectRepository = require('../../../src/repositories/projectRepository');
const User = require('../../../src/models/user');
const { cacheHelper } = require('../../../src/config/redis');

const makeProject = (overrides = {}) => ({
  id: 1,
  name: 'Alpha Project',
  description: 'Test project',
  status: 'active',
  priority: 'high',
  owner_id: 2,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  toJSON: jest.fn().mockReturnValue({ id: 1, name: 'Alpha Project', owner_id: 2 }),
  ...overrides
});

const makeManager = (id = 2) => ({
  id, name: 'Manager User', role: 'manager', is_active: true
});

beforeEach(() => jest.clearAllMocks());

// ─── createProject ────────────────────────────────────────────────────────────

describe('ProjectService.createProject', () => {
  test('ASSIGNMENT: project berhasil dibuat dengan owner_id yang merupakan Manager', async () => {
    User.findByPk.mockResolvedValue(makeManager(2));
    projectRepository.create.mockResolvedValue(makeProject());

    const result = await projectService.createProject({
      name: 'Alpha Project',
      priority: 'high',
      owner_id: 2
    });

    expect(User.findByPk).toHaveBeenCalledWith(2);
    expect(projectRepository.create).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('CONSTRAINT: gagal jika owner_id menunjuk ke user dengan role Admin (bukan Manager)', async () => {
    User.findByPk.mockResolvedValue({ id: 1, role: 'admin', name: 'Admin User' });

    await expect(projectService.createProject({
      name: 'Bad Project',
      priority: 'high',
      owner_id: 1   // Admin, bukan Manager
    })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Project can only be assigned to a user with role Manager'
    });
  });

  test('CONSTRAINT: gagal jika owner_id menunjuk ke user dengan role Staff', async () => {
    User.findByPk.mockResolvedValue({ id: 3, role: 'staff', name: 'Staff User' });

    await expect(projectService.createProject({
      name: 'Bad Project',
      priority: 'high',
      owner_id: 3
    })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Project can only be assigned to a user with role Manager'
    });
  });

  test('CONSTRAINT: gagal jika owner_id tidak ditemukan (HTTP 404)', async () => {
    User.findByPk.mockResolvedValue(null);

    await expect(projectService.createProject({
      name: 'Ghost Project',
      priority: 'high',
      owner_id: 9999
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── getProjectById ───────────────────────────────────────────────────────────

describe('ProjectService.getProjectById', () => {
  test('berhasil mengambil project yang ada', async () => {
    projectRepository.findById.mockResolvedValue(makeProject());

    const result = await projectService.getProjectById(1);

    expect(projectRepository.findById).toHaveBeenCalledWith(1);
    expect(result.id).toBe(1);
  });

  test('throw 404 jika project tidak ditemukan', async () => {
    projectRepository.findById.mockResolvedValue(null);

    await expect(projectService.getProjectById(999))
      .rejects.toMatchObject({ statusCode: 404, message: 'Project not found' });
  });
});

// ─── getAllProjects ───────────────────────────────────────────────────────────

describe('ProjectService.getAllProjects', () => {
  test('Admin melihat semua project', async () => {
    const mockResult = { projects: [makeProject()], total: 1 };
    projectRepository.findAll.mockResolvedValue(mockResult);

    const result = await projectService.getAllProjects({
      page: 1, limit: 10, userId: 1, userRole: 'admin'
    });

    expect(projectRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ userRole: 'admin', userId: 1 })
    );
    expect(result.projects).toHaveLength(1);
  });

  test('Manager hanya melihat project yang di-assign kepadanya', async () => {
    const mockResult = { projects: [makeProject()], total: 1 };
    projectRepository.findAll.mockResolvedValue(mockResult);

    await projectService.getAllProjects({
      page: 1, limit: 10, userId: 2, userRole: 'manager'
    });

    expect(projectRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ userRole: 'manager', userId: 2 })
    );
  });
});

// ─── updateProject ────────────────────────────────────────────────────────────

describe('ProjectService.updateProject', () => {
  test('Manager dapat mengupdate project yang di-assign kepadanya', async () => {
    projectRepository.update.mockResolvedValue(makeProject({ name: 'Updated Name' }));
    cacheHelper.delPattern.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);

    const result = await projectService.updateProject(1, { name: 'Updated Name' });

    expect(projectRepository.update).toHaveBeenCalledWith(1, { name: 'Updated Name' });
    expect(result).toBeDefined();
  });

  test('throw 404 jika project tidak ditemukan saat update', async () => {
    projectRepository.update.mockResolvedValue(null);

    await expect(projectService.updateProject(999, { name: 'X' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── deleteProject ────────────────────────────────────────────────────────────

describe('ProjectService.deleteProject', () => {
  test('Admin dapat menghapus project', async () => {
    projectRepository.delete.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);

    const result = await projectService.deleteProject(1);
    expect(result).toBe(true);
    expect(projectRepository.delete).toHaveBeenCalledWith(1);
  });

  test('throw 404 jika project tidak ditemukan saat delete', async () => {
    projectRepository.delete.mockResolvedValue(false);

    await expect(projectService.deleteProject(999))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── cache invalidation ───────────────────────────────────────────────────────

describe('ProjectService — cache invalidation', () => {
  test('invalidateProjectCache dipanggil setelah update', async () => {
    projectRepository.update.mockResolvedValue(makeProject());
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    await projectService.updateProject(1, { name: 'Refreshed' });

    expect(cacheHelper.del).toHaveBeenCalledWith('tasks:tree:1');
    expect(cacheHelper.delPattern).toHaveBeenCalledWith('tasks:list:*');
  });

  test('invalidateProjectCache dipanggil setelah delete', async () => {
    projectRepository.delete.mockResolvedValue(true);
    cacheHelper.del.mockResolvedValue(true);
    cacheHelper.delPattern.mockResolvedValue(true);

    await projectService.deleteProject(1);

    expect(cacheHelper.del).toHaveBeenCalledWith('tasks:tree:1');
  });
});
