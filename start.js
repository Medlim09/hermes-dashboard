// Railway start router — checked at runtime, not build time.
// Set BACKEND=1 on the zoological-bravery service to run server.js.
// Leave unset on hermes-dashboard to run Next.js.
if (process.env.BACKEND === '1') {
  require('./server.js');
} else {
  const { spawn } = require('child_process');
  const port = process.env.PORT || '3000';
  const child = spawn(
    'node',
    ['node_modules/.bin/next', 'start', '-p', port],
    { stdio: 'inherit' }
  );
  child.on('exit', (code) => process.exit(code ?? 0));
}
