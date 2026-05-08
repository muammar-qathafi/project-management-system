const { Sequelize } = require('sequelize');
const logger = require('./logger');
require('dotenv').config();

// Konfigurasi koneksi database MySQL menggunakan Sequelize
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: process.env.DB_DIALECT || 'mysql',
    logging: process.env.NODE_ENV === 'development' ? (sql) => logger.debug({ sql }, 'Sequelize') : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  }
);

// Test koneksi database
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error({ err: error }, 'Unable to connect to database');
    process.exit(1);
  }
};

module.exports = {
  sequelize,
  testConnection
};
