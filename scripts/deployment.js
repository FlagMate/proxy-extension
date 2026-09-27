#!/usr/bin/env node
/**
 * deployment — mirror THIS folder into its DEPLOYMENT repo and push to
 * `PRODUCTION-DEPLOYMENT`. Copy-only (excludes node_modules and .git).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEST_REL = '../DEPLOYMENT/proxy-extension';
const BRANCH = 'PRODUCTION-DEPLOYMENT';

const folderRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = folderRoot;
const dest = path.resolve(folderRoot, DEST_REL);
const message = process.argv.slice(2).join(' ') || `deploy: ${new Date().toISOString()}`;
const SKIP = new Set(['node_modules', '.git']);

if (!existsSync(dest)) { console.error(`[deployment] dest not found: ${dest}`); process.exit(1); }
if (!existsSync(path.join(dest, '.git'))) { console.error(`[deployment] dest is not a git repo: ${dest}`); process.exit(1); }

const git = (args, opts = {}) => spawnSync('git', ['-C', dest, ...args], { encoding: 'utf8', ...opts });

console.log(`[deployment] copy ${path.basename(src)} -> ${DEST_REL}`);
cpSync(src, dest, { recursive: true, force: true, filter: (from) => !SKIP.has(path.basename(from)) });

let co = git(['checkout', BRANCH]);
if (co.status !== 0) { console.log(`[deployment] creating branch ${BRANCH}`); co = git(['checkout', '-B', BRANCH]); }
if (co.status !== 0) { console.error(co.stderr || co.stdout); process.exit(1); }

git(['add', '-A']);
if (!git(['status', '--porcelain']).stdout.trim()) { console.log('[deployment] no changes — done.'); process.exit(0); }

console.log(`[deployment] commit: ${message}`);
const c = git(['commit', '-m', message]);
if (c.status !== 0) { console.error(c.stderr || c.stdout); process.exit(1); }

console.log(`[deployment] push origin ${BRANCH} (force)`);
const p = git(['push', '-u', 'origin', BRANCH, '--force'], { stdio: 'inherit' });
if (p.status !== 0) { console.error('[deployment] push failed (commit saved locally).'); process.exit(1); }
console.log('[deployment] done.');
