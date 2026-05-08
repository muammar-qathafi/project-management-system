/**
 * Tree Helper Utility
 * Fungsi-fungsi untuk handle recursive tree structure pada tasks
 * Optimized dengan O(n) complexity menggunakan Map
 */

/**
 * Build hierarchical tree dari flat array tasks (OPTIMIZED VERSION)
 * Time Complexity: O(n) - hanya satu pass
 * Space Complexity: O(n)
 * 
 * @param {Array} tasks - Flat array of tasks
 * @param {Number} parentId - Parent task ID (null untuk root)
 * @returns {Array} Hierarchical tree structure
 */
const buildTaskTree = (tasks, parentId = null) => {
  if (!tasks || tasks.length === 0) return [];

  // Create Map untuk O(1) lookup
  const taskMap = new Map();
  const tree = [];

  // First pass: buat Map dan initialize subtasks array
  tasks.forEach(task => {
    const taskData = task.toJSON ? task.toJSON() : { ...task };
    taskData.subtasks = [];
    taskMap.set(taskData.id, taskData);
  });

  // Second pass: build tree structure
  tasks.forEach(task => {
    const taskData = taskMap.get(task.id);
    const parentTaskId = task.parent_task_id;

    if (parentTaskId === parentId || (!parentTaskId && parentId === null)) {
      // Root level task atau task dengan parent yang diminta
      if (!parentTaskId) {
        tree.push(taskData);
      } else {
        const parent = taskMap.get(parentTaskId);
        if (parent) {
          parent.subtasks.push(taskData);
        } else {
          // Jika parent tidak ditemukan, treat as root
          tree.push(taskData);
        }
      }
    } else if (parentTaskId) {
      // Child task - add to parent's subtasks
      const parent = taskMap.get(parentTaskId);
      if (parent) {
        parent.subtasks.push(taskData);
      }
    }
  });

  // Remove empty subtasks arrays untuk cleaner output
  const cleanTree = (nodes) => {
    nodes.forEach(node => {
      if (node.subtasks.length === 0) {
        delete node.subtasks;
      } else {
        cleanTree(node.subtasks);
      }
    });
  };

  cleanTree(tree);
  return tree;
};

/**
 * Build hierarchical tree dengan metadata (depth, path, counts)
 * @param {Array} tasks - Flat array of tasks
 * @returns {Array} Tree dengan metadata lengkap
 */
const buildTaskTreeWithMetadata = (tasks) => {
  if (!tasks || tasks.length === 0) return [];

  const taskMap = new Map();
  const tree = [];

  // First pass: create Map
  tasks.forEach(task => {
    const taskData = task.toJSON ? task.toJSON() : { ...task };
    taskData.subtasks = [];
    taskData.depth = 0;
    taskData.subtask_count = 0;
    taskData.total_descendants = 0;
    taskMap.set(taskData.id, taskData);
  });

  // Second pass: build structure
  tasks.forEach(task => {
    const taskData = taskMap.get(task.id);
    const parentTaskId = task.parent_task_id;

    if (!parentTaskId) {
      tree.push(taskData);
    } else {
      const parent = taskMap.get(parentTaskId);
      if (parent) {
        parent.subtasks.push(taskData);
        taskData.depth = parent.depth + 1;
      } else {
        tree.push(taskData);
      }
    }
  });

  // Third pass: calculate metadata
  const calculateMetadata = (node) => {
    let totalDescendants = 0;
    
    if (node.subtasks && node.subtasks.length > 0) {
      node.subtask_count = node.subtasks.length;
      
      node.subtasks.forEach(child => {
        const childDescendants = calculateMetadata(child);
        totalDescendants += 1 + childDescendants;
      });
      
      node.total_descendants = totalDescendants;
    }
    
    return totalDescendants;
  };

  tree.forEach(node => calculateMetadata(node));

  return tree;
};

/**
 * Flatten tree structure menjadi flat array
 * @param {Array} tree - Hierarchical tree
 * @param {Array} result - Accumulator
 * @returns {Array} Flat array
 */
const flattenTaskTree = (tree, result = []) => {
  for (const node of tree) {
    const { subtasks, ...task } = node;
    result.push(task);
    
    if (subtasks && subtasks.length > 0) {
      flattenTaskTree(subtasks, result);
    }
  }
  
  return result;
};

/**
 * Get all descendant IDs dari sebuah task (untuk cascade operations)
 *
 * PERF FIX: Sebelumnya O(n²) — tasks.filter() di dalam rekursi = O(n) per level.
 * Sekarang O(n): bangun children Map sekali, lalu iterasi BFS tanpa rekursi
 * sehingga aman terhadap stack overflow pada tree yang sangat dalam.
 *
 * @param {Array} tasks - All tasks
 * @param {Number} taskId - Parent task ID
 * @returns {Array} Array of descendant task IDs
 */
const getDescendantIds = (tasks, taskId) => {
  // Build children index once — O(n)
  const childrenMap = new Map();
  tasks.forEach(task => {
    const pid = task.parent_task_id;
    if (pid != null) {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(task.id);
    }
  });

  // Iterative BFS — avoids call-stack overflow on deep trees
  const descendants = [];
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = childrenMap.get(current) || [];
    for (const childId of children) {
      descendants.push(childId);
      queue.push(childId);
    }
  }
  return descendants;
};

/**
 * Get path dari root ke specific task (breadcrumb)
 *
 * PERF FIX: Sebelumnya O(n*depth) — tasks.find() O(n) di setiap level rekursi.
 * Sekarang O(n): bangun Map sekali, lalu walk ke atas secara iteratif.
 *
 * @param {Array} tasks - All tasks
 * @param {Number} taskId - Target task ID
 * @returns {Array} Path array dari root ke task
 */
const getTaskPath = (tasks, taskId) => {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const path = [];
  let current = taskMap.get(taskId);
  while (current) {
    path.unshift(current);
    current = current.parent_task_id ? taskMap.get(current.parent_task_id) : null;
  }
  return path;
};

/**
 * Calculate depth/level of a task in tree
 *
 * PERF FIX: Sebelumnya O(n*depth) — tasks.find() O(n) di setiap level rekursi.
 * Sekarang O(n): bangun Map sekali, lalu walk ke atas secara iteratif.
 *
 * @param {Array} tasks - All tasks
 * @param {Number} taskId - Task ID
 * @returns {Number} Depth level (0 for root)
 */
const getTaskDepth = (tasks, taskId) => {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  let depth = 0;
  let current = taskMap.get(taskId);
  while (current && current.parent_task_id) {
    depth++;
    current = taskMap.get(current.parent_task_id);
  }
  return depth;
};

/**
 * Validate circular reference (task tidak boleh jadi parent dari ancestor-nya)
 * @param {Array} tasks - All tasks
 * @param {Number} taskId - Task yang akan dipindah
 * @param {Number} newParentId - New parent ID
 * @returns {Boolean} true jika valid, false jika circular
 */
const validateNoCircularReference = (tasks, taskId, newParentId) => {
  if (!newParentId) return true; // Root level, always valid
  if (taskId === newParentId) return false; // Task tidak boleh jadi parent dirinya sendiri
  
  // Check apakah newParent adalah descendant dari task
  const descendants = getDescendantIds(tasks, taskId);
  return !descendants.includes(newParentId);
};

/**
 * Get tree statistics (total tasks, max depth, etc)
 * @param {Array} tree - Hierarchical tree
 * @returns {Object} Statistics
 */
const getTreeStatistics = (tree) => {
  let totalTasks = 0;
  let maxDepth = 0;
  let leafNodes = 0;

  const traverse = (nodes, depth = 0) => {
    maxDepth = Math.max(maxDepth, depth);
    
    nodes.forEach(node => {
      totalTasks++;
      
      if (!node.subtasks || node.subtasks.length === 0) {
        leafNodes++;
      } else {
        traverse(node.subtasks, depth + 1);
      }
    });
  };

  traverse(tree);

  return {
    total_tasks: totalTasks,
    max_depth: maxDepth,
    leaf_nodes: leafNodes,
    branch_nodes: totalTasks - leafNodes
  };
};

/**
 * Search task in tree by ID or title
 * @param {Array} tree - Hierarchical tree
 * @param {String|Number} searchTerm - Task ID atau title
 * @returns {Object|null} Found task dengan path
 */
const searchInTree = (tree, searchTerm) => {
  const search = (nodes, path = []) => {
    for (const node of nodes) {
      const currentPath = [...path, node];
      
      // Check by ID or title
      if (node.id === searchTerm || 
          (typeof searchTerm === 'string' && 
           node.title && 
           node.title.toLowerCase().includes(searchTerm.toLowerCase()))) {
        return {
          task: node,
          path: currentPath.map(n => ({ id: n.id, title: n.title }))
        };
      }
      
      // Search in subtasks
      if (node.subtasks && node.subtasks.length > 0) {
        const result = search(node.subtasks, currentPath);
        if (result) return result;
      }
    }
    return null;
  };

  return search(tree);
};

/**
 * Filter tree by condition (status, priority, dll)
 * @param {Array} tree - Hierarchical tree
 * @param {Function} predicate - Filter function
 * @returns {Array} Filtered tree
 */
const filterTree = (tree, predicate) => {
  const filter = (nodes) => {
    return nodes.reduce((acc, node) => {
      const nodeMatches = predicate(node);
      let subtasks = [];

      if (node.subtasks && node.subtasks.length > 0) {
        subtasks = filter(node.subtasks);
      }

      // Include node if it matches or has matching subtasks
      if (nodeMatches || subtasks.length > 0) {
        acc.push({
          ...node,
          subtasks: subtasks.length > 0 ? subtasks : undefined
        });
      }

      return acc;
    }, []);
  };

  return filter(tree);
};

module.exports = {
  buildTaskTree,
  buildTaskTreeWithMetadata,
  flattenTaskTree,
  getDescendantIds,
  getTaskPath,
  getTaskDepth,
  validateNoCircularReference,
  getTreeStatistics,
  searchInTree,
  filterTree
};
