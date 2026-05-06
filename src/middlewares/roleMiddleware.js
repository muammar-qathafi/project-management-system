const { errorResponse } = require('../utils/responseHandler');
const taskRepository = require('../repositories/taskRepository');

/**
 * Role-Based Access Control (RBAC) Middleware
 *
 * Aturan otorisasi:
 *  - Admin  : CRUD semua (User, Project, Task)
 *  - Manager: Update Project (tidak bisa Create/Delete Project),
 *             CRUD Task yang di-assign padanya
 *  - User   : Hanya bisa mengelola Task yang di-assign padanya
 *             (Read + Update saja, tidak bisa Create/Delete)
 */

/**
 * Middleware factory — cek apakah role user termasuk dalam daftar yang diizinkan.
 * @param {string|string[]} allowedRoles
 */
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json(errorResponse('Authentication required', 401));
      }

      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

      if (!roles.includes(req.user.role)) {
        return res.status(403).json(
          errorResponse('Access denied. Insufficient permissions.', 403)
        );
      }

      next();
    } catch (error) {
      return res.status(500).json(errorResponse('Role verification error', 500));
    }
  };
};

// ─── Shorthand Role Middlewares ───────────────────────────────────────────────

/** Hanya Admin */
const isAdmin = checkRole('admin');

/** Admin atau Manager */
const isManager = checkRole(['admin', 'manager']);

/** Semua role yang sudah login */
const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(errorResponse('Authentication required', 401));
  }
  next();
};

// ─── Project RBAC ─────────────────────────────────────────────────────────────

/** Hanya Admin yang boleh membuat project */
const canCreateProject = checkRole('admin');

/** Admin dan Manager boleh mengupdate project */
const canUpdateProject = checkRole(['admin', 'manager']);

/** Hanya Admin yang boleh menghapus project */
const canDeleteProject = checkRole('admin');

// ─── Task Ownership Middleware ────────────────────────────────────────────────

/**
 * Middleware factory untuk operasi Task yang memerlukan cek kepemilikan.
 * Admin selalu lolos. Untuk manager/user, task harus di-assign ke mereka.
 *
 * @param {string[]} nonAdminRoles - role selain admin yang BOLEH melanjutkan
 *                                   (jika task di-assign ke mereka)
 */
const requireTaskOwnership = (nonAdminRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json(errorResponse('Authentication required', 401));
      }

      const { role, id: userId } = req.user;

      // Admin melewati semua pemeriksaan kepemilikan
      if (role === 'admin') {
        return next();
      }

      // Role tidak termasuk daftar yang diizinkan sama sekali
      if (!nonAdminRoles.includes(role)) {
        return res.status(403).json(
          errorResponse('Access denied. Insufficient permissions.', 403)
        );
      }

      // Ambil task dari DB untuk verifikasi kepemilikan
      const taskId = parseInt(req.params.id);
      if (!taskId || isNaN(taskId)) {
        return res.status(400).json(errorResponse('Invalid task ID', 400));
      }

      const task = await taskRepository.findById(taskId);
      if (!task) {
        return res.status(404).json(errorResponse('Task not found', 404));
      }

      // Simpan task di req agar controller tidak perlu query ulang
      req.task = task;

      if (task.assigned_to !== userId) {
        return res.status(403).json(
          errorResponse('Access denied. You can only manage tasks assigned to you.', 403)
        );
      }

      next();
    } catch (error) {
      return res.status(500).json(errorResponse('Authorization error', 500));
    }
  };
};

// ─── Task RBAC ────────────────────────────────────────────────────────────────

/**
 * Membuat task:
 *  - Admin  : boleh
 *  - Manager: boleh
 *  - User   : tidak boleh
 */
const canCreateTask = checkRole(['admin', 'manager']);

/**
 * Mengupdate task:
 *  - Admin  : boleh (task apapun)
 *  - Manager: boleh (hanya task yang di-assign kepadanya)
 *  - User   : boleh (hanya task yang di-assign kepadanya)
 */
const canUpdateTask = requireTaskOwnership(['manager', 'staff']);

/**
 * Menghapus task:
 *  - Admin  : boleh (task apapun)
 *  - Manager: boleh (hanya task yang di-assign kepadanya)
 *  - User   : tidak boleh
 */
const canDeleteTask = requireTaskOwnership(['manager']);

// ─── User Management RBAC ─────────────────────────────────────────────────────

/**
 * Admin dapat mengakses data user manapun.
 * User lain hanya dapat mengakses data dirinya sendiri.
 */
const isAdminOrSelf = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse('Authentication required', 401));
    }

    const { role, id: userId } = req.user;
    const targetId = parseInt(req.params.id);

    if (role === 'admin' || userId === targetId) {
      return next();
    }

    return res.status(403).json(
      errorResponse('Access denied. You can only access your own data.', 403)
    );
  } catch (error) {
    return res.status(500).json(errorResponse('Authorization error', 500));
  }
};

module.exports = {
  checkRole,
  isAdmin,
  isManager,
  isAuthenticated,
  canCreateProject,
  canUpdateProject,
  canDeleteProject,
  canCreateTask,
  canUpdateTask,
  canDeleteTask,
  isAdminOrSelf,
};
