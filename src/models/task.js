const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Task Model
 * Menyimpan data task dengan struktur tree (parent-child relationship)
 */
const Task = sequelize.define('Task', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('open', 'working', 'closed', 'overdue'),
    defaultValue: 'open'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    defaultValue: 'medium'
  },
  due_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'projects',
      key: 'id'
    }
  },
  assigned_to: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  parent_task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'tasks',
      key: 'id'
    },
    comment: 'For hierarchical task structure (subtasks)'
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Define self-referencing relationship for parent-child tasks (Recursive)
Task.hasMany(Task, {
  as: 'subtasks',
  foreignKey: 'parent_task_id',
  onDelete: 'CASCADE'
});

Task.belongsTo(Task, {
  as: 'parent',
  foreignKey: 'parent_task_id'
});

// Instance method untuk check if task has subtasks
Task.prototype.hasSubtasks = async function() {
  const count = await Task.count({
    where: { parent_task_id: this.id }
  });
  return count > 0;
};

// Instance method untuk get depth level
Task.prototype.getDepth = async function() {
  let depth = 0;
  let currentTask = this;
  
  while (currentTask.parent_task_id) {
    depth++;
    currentTask = await Task.findByPk(currentTask.parent_task_id);
    if (!currentTask) break;
  }
  
  return depth;
};

module.exports = Task;
