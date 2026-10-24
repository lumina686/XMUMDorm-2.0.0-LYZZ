#!/usr/bin/env node

/**
 * 为课程资料与指南只读预览网关创建 MySQL 只读账号。
 *
 * 默认使用 PREVIEW_ADMIN_DATABASE_URL；未设置时才使用当前部署管理员连接
 * MYSQL_URL。脚本只授权课程资料和指南所需四张表的 SELECT。
 */

require('dotenv').config();

const crypto = require('crypto');
const mysql = require('mysql2/promise');

const USER = 'preview_reader';
const HOST = '%';
const TABLES = ['courses', 'materials', 'handbook_articles', 'handbook_tabs'];

function usage() {
  console.log('Usage: node scripts/materials/create-preview-reader.js [--dry-run]');
}

function databaseUrl() {
  const value = process.env.PREVIEW_ADMIN_DATABASE_URL || process.env.MYSQL_URL;
  if (!value) throw new Error('缺少 PREVIEW_ADMIN_DATABASE_URL 或 MYSQL_URL');
  const url = new URL(value);
  const database = url.pathname.replace(/^\//, '');
  if (!database) throw new Error('连接串缺少数据库名');
  return { value, database };
}

function previewUrl(adminUrl, password) {
  const url = new URL(adminUrl);
  url.username = USER;
  url.password = password;
  return url.toString();
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const { value, database } = databaseUrl();
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ account: `${USER}@${HOST}`, database, tables: TABLES, privileges: ['SELECT'] }));
    return;
  }

  const password = crypto.randomBytes(32).toString('hex');
  const connection = await mysql.createConnection(value);
  let created = false;
  try {
    await connection.query(`CREATE USER '${USER}'@'${HOST}' IDENTIFIED BY ${mysql.escape(password)}`);
    created = true;
    for (const table of TABLES) {
      // USER, HOST and TABLES are constants rather than user input.
      await connection.query(`GRANT SELECT ON \`${database.replace(/`/g, '``')}\`.\`${table}\` TO '${USER}'@'${HOST}'`);
    }
    const [grants] = await connection.query(`SHOW GRANTS FOR '${USER}'@'${HOST}'`);
    const grantLines = grants.flatMap((row) => Object.values(row));
    if (grantLines.some((line) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|INDEX|GRANT OPTION)\b/i.test(line))) {
      throw new Error('创建出的账号包含非只读权限，已中止');
    }

    console.log(JSON.stringify({
      account: `${USER}@${HOST}`,
      database,
      previewDatabaseUrl: previewUrl(value, password),
      grants: grantLines,
    }, null, 2));
  } catch (error) {
    if (created) {
      await connection.query(`DROP USER '${USER}'@'${HOST}'`).catch(() => {});
    }
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`创建预览只读账号失败：${error.message}`);
  process.exitCode = 1;
});
