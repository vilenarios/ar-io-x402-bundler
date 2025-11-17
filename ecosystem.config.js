/**
 * PM2 Ecosystem Configuration for AR.IO x402 Bundler
 *
 * This is a simplified upload-only bundler (no payment service).
 * All x402 payment logic is handled directly in the upload routes.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load root .env file
const rootEnv = dotenv.config({
  path: path.join(__dirname, '.env')
}).parsed || {};

module.exports = {
  apps: [
    {
      name: 'upload-api',
      cwd: __dirname,
      script: './lib/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        ...rootEnv,
        NODE_ENV: 'production',
        PORT: 3001,
        DB_DATABASE: 'bundler_lite',
      },
      error_file: './logs/upload-api-error.log',
      out_file: './logs/upload-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
    },
    {
      name: 'upload-workers',
      cwd: __dirname,
      script: './lib/jobs/allWorkers.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        ...rootEnv,
        NODE_ENV: 'production',
        DB_DATABASE: 'bundler_lite',
      },
      error_file: './logs/upload-workers-error.log',
      out_file: './logs/upload-workers-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      kill_timeout: 30000,
    },
    {
      name: 'bull-board',
      cwd: __dirname,
      script: './bull-board-server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        ...rootEnv,
        NODE_ENV: 'production',
        BULL_BOARD_PORT: 3002,
        DB_DATABASE: 'bundler_lite',
      },
      error_file: './logs/bull-board-error.log',
      out_file: './logs/bull-board-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
    },
  ],
};
