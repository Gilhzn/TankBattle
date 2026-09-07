import { spawn } from 'node:child_process';
const procs = [
  spawn('npm', ['run', 'dev', '-w', '@tank/server'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT ?? '8080' } }),
  spawn('npm', ['run', 'dev', '-w', '@tank/client'], { stdio: 'inherit' }),
];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
