-- Migration: Create Additional Indexes
-- Description: Indexes untuk optimize query performance

-- Composite index untuk task filtering
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_project_priority ON tasks(project_id, priority);
CREATE INDEX idx_tasks_assigned_status ON tasks(assigned_to, status);

-- Index untuk overdue task checking
CREATE INDEX idx_tasks_overdue_check ON tasks(due_date, status);

-- Full-text search index (optional)
-- CREATE FULLTEXT INDEX idx_tasks_search ON tasks(title, description);
-- CREATE FULLTEXT INDEX idx_projects_search ON projects(name, description);
