-- Sample Data untuk Testing Recursive Tree Structure
-- Run setelah menjalankan migrations

-- ============================================
-- 1. Insert Sample Users
-- ============================================
-- Password untuk semua user: password123
INSERT INTO users (name, username, email, password, phone_number, role) VALUES
('Admin User', 'admin', 'admin@example.com', '$2b$10$J.r6kXtLsjy1KESr.MdwoOtm6/zLRiHsDtK.jrFoTjJ6GFcIRIWPm', '+628111000001', 'admin'),
('John Manager', 'john.manager', 'john.manager@example.com', '$2b$10$J.r6kXtLsjy1KESr.MdwoOtm6/zLRiHsDtK.jrFoTjJ6GFcIRIWPm', '+628111000002', 'manager'),
('Alice Developer', 'alice', 'alice@example.com', '$2b$10$J.r6kXtLsjy1KESr.MdwoOtm6/zLRiHsDtK.jrFoTjJ6GFcIRIWPm', '+628111000003', 'staff'),
('Bob Developer', 'bob', 'bob@example.com', '$2b$10$J.r6kXtLsjy1KESr.MdwoOtm6/zLRiHsDtK.jrFoTjJ6GFcIRIWPm', '+628111000004', 'staff');

-- ============================================
-- 2. Insert Sample Projects
-- ============================================
INSERT INTO projects (name, description, status, priority, start_date, end_date, owner_id) VALUES
('E-Commerce Platform', 'Build a full-stack e-commerce platform with payment integration', 'active', 'high', '2026-01-01', '2026-12-31', 2),
('Mobile App', 'Develop cross-platform mobile application', 'planning', 'medium', '2026-06-01', '2026-12-31', 2);

-- ============================================
-- 3. Insert Sample Tasks with Recursive Structure
-- ============================================

-- ROOT LEVEL TASKS (parent_task_id = NULL)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
-- Project 1: E-Commerce Platform
('Backend Development', 'Complete backend API development', 'working', 'high', 1, NULL, 3, 1, '2026-08-01'),
('Frontend Development', 'Complete frontend UI development', 'open', 'high', 1, NULL, 4, 1, '2026-09-01'),
('DevOps Setup', 'Setup CI/CD and deployment', 'open', 'medium', 1, NULL, 2, 1, '2026-10-01');

-- LEVEL 1 - Children of "Backend Development" (id: 1)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Database Setup', 'Design and setup MySQL database', 'closed', 'high', 1, 1, 3, 1, '2026-05-15'),
('API Development', 'Develop RESTful APIs', 'working', 'high', 1, 1, 3, 1, '2026-07-01'),
('Authentication System', 'Implement JWT authentication', 'closed', 'high', 1, 1, 3, 1, '2026-05-20'),
('Testing & QA', 'Write unit and integration tests', 'open', 'medium', 1, 1, 3, 1, '2026-07-15');

-- LEVEL 2 - Children of "Database Setup" (id: 4)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Create Migrations', 'Create database migration files', 'closed', 'high', 1, 4, 3, 1, '2026-05-10'),
('Seed Data', 'Insert initial data', 'closed', 'medium', 1, 4, 3, 1, '2026-05-12'),
('Database Indexes', 'Optimize with proper indexes', 'closed', 'medium', 1, 4, 3, 1, '2026-05-14');

-- LEVEL 2 - Children of "API Development" (id: 5)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('User Management API', 'CRUD endpoints for users', 'closed', 'high', 1, 5, 3, 1, '2026-06-01'),
('Product Management API', 'CRUD endpoints for products', 'working', 'high', 1, 5, 3, 1, '2026-06-15'),
('Order Management API', 'CRUD endpoints for orders', 'open', 'high', 1, 5, 3, 1, '2026-06-30'),
('Payment Integration API', 'Integrate payment gateway', 'open', 'high', 1, 5, 3, 1, '2026-07-15');

-- LEVEL 2 - Children of "Authentication System" (id: 6)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Login Endpoint', 'Implement login functionality', 'closed', 'high', 1, 6, 3, 1, '2026-05-16'),
('Register Endpoint', 'Implement user registration', 'closed', 'high', 1, 6, 3, 1, '2026-05-17'),
('JWT Middleware', 'Create authentication middleware', 'closed', 'high', 1, 6, 3, 1, '2026-05-18'),
('Password Reset', 'Implement password reset flow', 'closed', 'medium', 1, 6, 3, 1, '2026-05-19');

-- LEVEL 3 - Children of "User Management API" (id: 11)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Create User', 'POST /users endpoint', 'closed', 'high', 1, 11, 3, 1, '2026-05-25'),
('Get Users', 'GET /users endpoint with pagination', 'closed', 'high', 1, 11, 3, 1, '2026-05-26'),
('Update User', 'PUT /users/:id endpoint', 'closed', 'high', 1, 11, 3, 1, '2026-05-27'),
('Delete User', 'DELETE /users/:id endpoint', 'closed', 'medium', 1, 11, 3, 1, '2026-05-28');

-- LEVEL 3 - Children of "Product Management API" (id: 12)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Create Product', 'POST /products endpoint', 'closed', 'high', 1, 12, 3, 1, '2026-06-05'),
('Get Products', 'GET /products with filters', 'closed', 'high', 1, 12, 3, 1, '2026-06-06'),
('Update Product', 'PUT /products/:id endpoint', 'working', 'high', 1, 12, 3, 1, '2026-06-10'),
('Product Images', 'Upload and manage product images', 'open', 'medium', 1, 12, 3, 1, '2026-06-12');

-- LEVEL 4 - Deep nesting example (Children of "Login Endpoint" - id: 15)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Validate Credentials', 'Check email and password', 'closed', 'high', 1, 15, 3, 1, '2026-05-16'),
('Generate JWT Token', 'Create JWT on successful login', 'closed', 'high', 1, 15, 3, 1, '2026-05-16'),
('Return User Data', 'Send user info in response', 'closed', 'medium', 1, 15, 3, 1, '2026-05-16');

-- LEVEL 1 - Children of "Frontend Development" (id: 2)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('UI Components', 'Build reusable React components', 'open', 'high', 1, 2, 4, 1, '2026-08-15'),
('State Management', 'Setup Redux or Context API', 'open', 'medium', 1, 2, 4, 1, '2026-08-20'),
('API Integration', 'Connect frontend to backend APIs', 'open', 'high', 1, 2, 4, 1, '2026-08-30');

-- LEVEL 2 - Children of "UI Components" (id: 31)
INSERT INTO tasks (title, description, status, priority, project_id, parent_task_id, assigned_to, created_by, due_date) VALUES
('Header Component', 'Create navigation header', 'open', 'medium', 1, 31, 4, 1, '2026-08-10'),
('Product Card', 'Create product display card', 'open', 'high', 1, 31, 4, 1, '2026-08-11'),
('Shopping Cart', 'Build shopping cart component', 'open', 'high', 1, 31, 4, 1, '2026-08-13');

-- ============================================
-- Tree Structure Visualization for Project 1:
-- ============================================
-- Backend Development (id: 1)
-- ├── Database Setup (id: 4)
-- │   ├── Create Migrations (id: 8)
-- │   ├── Seed Data (id: 9)
-- │   └── Database Indexes (id: 10)
-- ├── API Development (id: 5)
-- │   ├── User Management API (id: 11)
-- │   │   ├── Create User (id: 19)
-- │   │   ├── Get Users (id: 20)
-- │   │   ├── Update User (id: 21)
-- │   │   └── Delete User (id: 22)
-- │   ├── Product Management API (id: 12)
-- │   │   ├── Create Product (id: 23)
-- │   │   ├── Get Products (id: 24)
-- │   │   ├── Update Product (id: 25)
-- │   │   └── Product Images (id: 26)
-- │   ├── Order Management API (id: 13)
-- │   └── Payment Integration API (id: 14)
-- ├── Authentication System (id: 6)
-- │   ├── Login Endpoint (id: 15)
-- │   │   ├── Validate Credentials (id: 27)
-- │   │   ├── Generate JWT Token (id: 28)
-- │   │   └── Return User Data (id: 29)
-- │   ├── Register Endpoint (id: 16)
-- │   ├── JWT Middleware (id: 17)
-- │   └── Password Reset (id: 18)
-- └── Testing & QA (id: 7)
--
-- Frontend Development (id: 2)
-- ├── UI Components (id: 31)
-- │   ├── Header Component (id: 34)
-- │   ├── Product Card (id: 35)
-- │   └── Shopping Cart (id: 36)
-- ├── State Management (id: 32)
-- └── API Integration (id: 33)
--
-- DevOps Setup (id: 3)

-- ============================================
-- Statistics for Project 1:
-- ============================================
-- Total Tasks: 36
-- Max Depth: 4 levels
-- Root Tasks: 3
-- Branch Tasks: ~12
-- Leaf Tasks: ~24

-- ============================================
-- Verification Queries
-- ============================================

-- Check total tasks
-- SELECT COUNT(*) as total_tasks FROM tasks WHERE project_id = 1;

-- Check root level tasks
-- SELECT id, title, status FROM tasks WHERE project_id = 1 AND parent_task_id IS NULL;

-- Check task hierarchy for specific task
-- SELECT 
--   t1.id as level_1_id,
--   t1.title as level_1_title,
--   t2.id as level_2_id,
--   t2.title as level_2_title,
--   t3.id as level_3_id,
--   t3.title as level_3_title
-- FROM tasks t1
-- LEFT JOIN tasks t2 ON t2.parent_task_id = t1.id
-- LEFT JOIN tasks t3 ON t3.parent_task_id = t2.id
-- WHERE t1.project_id = 1 AND t1.parent_task_id IS NULL
-- ORDER BY t1.id, t2.id, t3.id;
