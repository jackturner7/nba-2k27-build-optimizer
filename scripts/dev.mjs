#!/usr/bin/env node
/**
 * Runs the API and the web dev server together with prefixed output.
 * `npm run dev` from the repo root.
 */
import { spawn } from 'node:child_process';

const targets = [
  { name: 'api', color: '[36m', args: ['run', 'dev', '-w', '@2k27/api'] },
  { name: 'web', color: '[35m', args: ['run', 'dev', '-w', '@2k27/web'] },
];

const children = [];
let shuttingDown = false;

for (const target of targets) {
  const child = spawn('npm', target.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  children.push(child);

  const prefix = `${target.color}[${target.name}][0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`${prefix}exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
