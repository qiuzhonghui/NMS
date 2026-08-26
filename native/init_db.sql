-- =============================================================================
-- NMS - Network Management System
-- Database Initialization Script
-- =============================================================================
-- Usage:
--   mysql -u root -p < init_db.sql
-- Or with custom credentials:
--   mysql -u root -p -e "SET @db_name='nms'; SET @db_user='nms'; SET @db_pass='your_password'; SOURCE init_db.sql;"
-- =============================================================================

-- Allow overriding via variables (default values)
SET @db_name   = IFNULL(@db_name,   'nms');
SET @db_user   = IFNULL(@db_user,   'nms');
SET @db_pass   = IFNULL(@db_pass,   'nms_password');
SET @db_host   = IFNULL(@db_host,   'localhost');

-- Create database
SET @create_db = CONCAT('CREATE DATABASE IF NOT EXISTS `', @db_name,
    '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
PREPARE stmt FROM @create_db;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create users (from localhost and 127.0.0.1 for socket + TCP support)
SET @create_user1 = CONCAT(
    'CREATE USER IF NOT EXISTS ''', @db_user, '''@''localhost''',
    ' IDENTIFIED BY ''', @db_pass, '''');
PREPARE stmt FROM @create_user1;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @create_user2 = CONCAT(
    'CREATE USER IF NOT EXISTS ''', @db_user, '''@''127.0.0.1''',
    ' IDENTIFIED BY ''', @db_pass, '''');
PREPARE stmt FROM @create_user2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Grant privileges
SET @grant1 = CONCAT('GRANT ALL PRIVILEGES ON `', @db_name, '`.* TO ''', @db_user, '''@''localhost''');
PREPARE stmt FROM @grant1;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @grant2 = CONCAT('GRANT ALL PRIVILEGES ON `', @db_name, '`.* TO ''', @db_user, '''@''127.0.0.1''');
PREPARE stmt FROM @grant2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Also create user for remote connections (if DB_HOST is not localhost)
SET @create_user3 = CONCAT(
    'CREATE USER IF NOT EXISTS ''', @db_user, '''@''%''',
    ' IDENTIFIED BY ''', @db_pass, '''');
PREPARE stmt FROM @create_user3;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @grant3 = CONCAT('GRANT ALL PRIVILEGES ON `', @db_name, '`.* TO ''', @db_user, '''@''%''');
PREPARE stmt FROM @grant3;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Flush
FLUSH PRIVILEGES;

-- Show result
SELECT CONCAT('Database ''', @db_name, ''' and user ''', @db_user, ''' created successfully.') AS Result;
