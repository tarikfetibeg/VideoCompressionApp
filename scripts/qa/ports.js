const net = require('node:net');
const ports = (process.argv.find((arg) => arg.startsWith('--ports='))?.slice(8) || '5110,5112,5114,27110,27112,27114,9227').split(',').map(Number);
if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid port list.');
(async () => {
  const result = {};
  for (const port of ports) {
    result[port] = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (error) => resolve(error.code === 'EADDRINUSE' ? 'listening' : 'unavailable:' + error.code));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve('free')));
    });
  }
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(result).some((value) => value !== 'free')) process.exitCode = 1;
})();
