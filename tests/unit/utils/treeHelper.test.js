'use strict';
/**
 * Unit Test: treeHelper utility
 * Requirement: Task Structure — Recursive/Self-referencing (unlimited depth)
 */

const {
  buildTaskTree,
  buildTaskTreeWithMetadata,
  getTreeStatistics,
  getDescendantIds,
  validateNoCircularReference,
  searchInTree,
  filterTree
} = require('../../../src/utils/treeHelper');

describe('treeHelper — buildTaskTree', () => {
  const flat = [
    { id: 1, title: 'Root A', parent_task_id: null, status: 'open', priority: 'high', assigned_to: 2 },
    { id: 2, title: 'Child A1', parent_task_id: 1, status: 'working', priority: 'medium', assigned_to: 3 },
    { id: 3, title: 'Grandchild A1a', parent_task_id: 2, status: 'closed', priority: 'low', assigned_to: 3 },
    { id: 4, title: 'Root B', parent_task_id: null, status: 'overdue', priority: 'high', assigned_to: 4 },
    { id: 5, title: 'Child B1', parent_task_id: 4, status: 'open', priority: 'medium', assigned_to: 2 },
  ];

  test('harus menghasilkan 2 root node dari flat array', () => {
    const tree = buildTaskTree(flat);
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe(1);
    expect(tree[1].id).toBe(4);
  });

  test('harus membangun hirarki parent-to-child unlimited depth', () => {
    const tree = buildTaskTree(flat);
    const rootA = tree[0];
    expect(rootA.subtasks).toBeDefined();
    expect(rootA.subtasks).toHaveLength(1);
    expect(rootA.subtasks[0].id).toBe(2);
    // Grandchild (level 3)
    expect(rootA.subtasks[0].subtasks).toHaveLength(1);
    expect(rootA.subtasks[0].subtasks[0].id).toBe(3);
  });

  test('leaf node tidak boleh memiliki property subtasks', () => {
    const tree = buildTaskTree(flat);
    const grandchild = tree[0].subtasks[0].subtasks[0];
    expect(grandchild.subtasks).toBeUndefined();
  });

  test('harus mengembalikan [] untuk input kosong', () => {
    expect(buildTaskTree([])).toEqual([]);
    expect(buildTaskTree(null)).toEqual([]);
  });

  test('harus mendukung kedalaman tidak terbatas (5 level)', () => {
    const deep = [
      { id: 1, title: 'L1', parent_task_id: null },
      { id: 2, title: 'L2', parent_task_id: 1 },
      { id: 3, title: 'L3', parent_task_id: 2 },
      { id: 4, title: 'L4', parent_task_id: 3 },
      { id: 5, title: 'L5', parent_task_id: 4 },
    ];
    const tree = buildTaskTree(deep);
    expect(tree).toHaveLength(1);
    expect(tree[0].subtasks[0].subtasks[0].subtasks[0].subtasks[0].id).toBe(5);
  });
});

describe('treeHelper — getTreeStatistics', () => {
  test('harus menghitung total_tasks, max_depth, leaf_nodes, branch_nodes dengan benar', () => {
    const flat = [
      { id: 1, title: 'Root', parent_task_id: null, status: 'open', priority: 'high', assigned_to: 1 },
      { id: 2, title: 'Child', parent_task_id: 1, status: 'open', priority: 'low', assigned_to: 1 },
    ];
    const tree = buildTaskTree(flat);
    const stats = getTreeStatistics(tree);

    expect(stats.total_tasks).toBe(2);
    expect(stats.max_depth).toBeGreaterThanOrEqual(1);
    expect(stats.leaf_nodes).toBe(1);
    expect(stats.branch_nodes).toBe(1);
  });

  test('harus mengembalikan semua nol untuk tree kosong', () => {
    const stats = getTreeStatistics([]);
    expect(stats.total_tasks).toBe(0);
    expect(stats.max_depth).toBe(0);
  });
});

describe('treeHelper — getDescendantIds', () => {
  test('harus mengambil semua ID turunan secara rekursif', () => {
    const flat = [
      { id: 1, title: 'Root', parent_task_id: null },
      { id: 2, title: 'Child 1', parent_task_id: 1 },
      { id: 3, title: 'Child 2', parent_task_id: 1 },
      { id: 4, title: 'Grandchild', parent_task_id: 2 },
    ];
    const ids = getDescendantIds(flat, 1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    expect(ids).toContain(4);
    expect(ids).toHaveLength(3);
  });

  test('harus mengembalikan [] untuk task yang tidak punya anak', () => {
    const flat = [{ id: 1, title: 'Root', parent_task_id: null }];
    expect(getDescendantIds(flat, 1)).toEqual([]);
  });
});

describe('treeHelper — validateNoCircularReference', () => {
  test('harus mengembalikan false jika ada circular reference', () => {
    const flat = [
      { id: 1, parent_task_id: null },
      { id: 2, parent_task_id: 1 },
      { id: 3, parent_task_id: 2 },
    ];
    // Signature: validateNoCircularReference(tasks, taskId, newParentId)
    // Mencoba jadikan task 1 sebagai child dari task 3 (task 3 adalah cucu task 1 → circular)
    const isValid = validateNoCircularReference(flat, 1, 3);
    expect(isValid).toBe(false);
  });

  test('harus mengembalikan true jika tidak ada circular reference', () => {
    const flat = [
      { id: 1, parent_task_id: null },
      { id: 2, parent_task_id: 1 },
    ];
    // Task 3 (baru) sebagai child dari task 2 — tidak circular
    const isValid = validateNoCircularReference(flat, 2, 99);
    expect(isValid).toBe(true);
  });
});

describe('treeHelper — searchInTree & filterTree', () => {
  const flat = [
    { id: 1, title: 'Backend API Development', parent_task_id: null, status: 'open', priority: 'high', assigned_to: 1 },
    { id: 2, title: 'Frontend Setup', parent_task_id: 1, status: 'working', priority: 'medium', assigned_to: 2 },
    { id: 3, title: 'Database Migration', parent_task_id: 1, status: 'closed', priority: 'low', assigned_to: 3 },
  ];

  test('searchInTree harus menemukan task berdasarkan keyword judul', () => {
    const tree = buildTaskTree(flat);
    // searchInTree mengembalikan {task, path} atau null
    const result = searchInTree(tree, 'Backend');
    expect(result).not.toBeNull();
    expect(result.task).toBeDefined();
    expect(result.task.title).toContain('Backend');
    expect(result.path).toBeDefined();
  });

  test('filterTree harus memfilter berdasarkan status', () => {
    const tree = buildTaskTree(flat);
    const filtered = filterTree(tree, (t) => t.status === 'working');
    // Filter harus menemukan 'Frontend Setup' dengan status working
    const hasWorking = filtered.some(r => r.id === 1 && r.subtasks && r.subtasks.some(s => s.id === 2));
    expect(hasWorking).toBe(true);
  });
});
