# Database Migrations

## How to Run Migrations

### Option 1: Manual via MySQL CLI

```bash
# Connect to MySQL
mysql -u root -p

# Create database
CREATE DATABASE project_management;
USE project_management;

# Run migrations in order
source 001_create_users_table.sql
source 002_create_projects_table.sql
source 003_create_tasks_table.sql
source 004_create_indexes.sql
```

### Option 2: Using Script

```bash
# Run all migrations
cat migrations/*.sql | mysql -u root -p project_management
```

### Option 3: Using Sequelize CLI (if using Sequelize migrations)

```bash
npm install --save-dev sequelize-cli
npx sequelize-cli db:migrate
```

## Migration Order

1. `001_create_users_table.sql` - Create users table
2. `002_create_projects_table.sql` - Create projects table
3. `003_create_tasks_table.sql` - Create tasks table with hierarchical structure
4. `004_create_indexes.sql` - Create additional indexes for performance

## Schema Overview

### Users Table
- Authentication & Authorization
- Role-based access control (admin, manager, user)

### Projects Table
- Project management
- Owned by users

### Tasks Table
- Task management with parent-child relationship
- Assigned to users
- Belongs to projects
- Support hierarchical structure (subtasks)

## Important Notes

- All tables use InnoDB engine for transaction support
- Foreign keys use CASCADE for delete operations
- Timestamps are automatically managed
- Indexes are created for frequently queried columns
