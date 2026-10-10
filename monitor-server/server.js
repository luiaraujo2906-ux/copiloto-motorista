import {createServer as createHttpServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';

const dashboardPath = new URL('./public/index.html', import.meta.url);

function isScreenObservation(value, allowedPackages) {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.packageName !== 'string' ||
    !allowedPackages.has(value.packageName) ||
    typeof value.capturedAt !== 'number' ||
    !Number.isFinite(value.capturedAt) ||
    typeof value.screenWidth !== 'number' ||
    !Number.isFinite(value.screenWidth) ||
    typeof value.screenHeight !== 'number' ||
    !Number.isFinite(value.screenHeight) ||
    !Array.isArray(value.elements) ||
    value.elements.length > 500 ||
    !['complete', 'unavailable', 'failed'].includes(value.ocrStatus)
  ) {
    return false;
  }

  return value.elements.every(element =>
    typeof element === 'object' &&
    element !== null &&
    typeof element.text === 'string' &&
    element.text.length <= 4_000 &&
    ['accessibility', 'ocr'].includes(element.source) &&
    typeof element.bounds === 'object' &&
    element.bounds !== null &&
    ['left', 'top', 'right', 'bottom'].every(
      edge => typeof element.bounds[edge] === 'number' &&
        Number.isFinite(element.bounds[edge]),
    ),
  );
}

export function createMonitorServer({
  targetPackages = ['com.app99.driver'],
  host = '0.0.0.0',
  port = 8080,
} = {}) {
  const allowedPackages = new Set(targetPackages);
  if (allowedPackages.size === 0) {
    throw new Error('At least one target package is required.');
  }

  const clients = new Set();
  const latestByPackage = new Map();
  const httpServer = createHttpServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({
        status: 'ok',
        connectedClients: clients.size,
        targetPackages: [...allowedPackages],
      }));
      return;
    }

    if (request.method !== 'GET' || (request.url !== '/' && request.url !== '/index.html')) {
      response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }

    try {
      const page = await readFile(dashboardPath);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; connect-src ws: wss:; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        'x-content-type-options': 'nosniff',
      });
      response.end(page);
    } catch (error) {
      console.error('Could not read dashboard page:', error);
      response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'});
      response.end('Dashboard unavailable');
    }
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 512 * 1024,
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, webSocket => {
      webSocketServer.emit('connection', webSocket);
    });
  });

  webSocketServer.on('connection', webSocket => {
    clients.add(webSocket);
    webSocket.send(JSON.stringify({
      type: 'snapshot',
      targetPackages: [...allowedPackages],
      observations: [...latestByPackage.values()],
    }));

    webSocket.on('message', rawMessage => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        webSocket.close(4002, 'Invalid JSON');
        return;
      }

      if (
        typeof message !== 'object' ||
        message === null ||
        message.type !== 'screenData' ||
        !isScreenObservation(message.data, allowedPackages)
      ) {
        webSocket.send(JSON.stringify({
          type: 'error',
          message: 'Screen observation does not match the configured target packages.',
        }));
        return;
      }

      const observation = message.data;
      latestByPackage.set(observation.packageName, observation);
      const broadcast = JSON.stringify({type: 'screenData', data: observation});
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcast);
        }
      }
    });

    webSocket.on('close', () => clients.delete(webSocket));
    webSocket.on('error', error => {
      console.error('WebSocket client error:', error.message);
    });
  });

  return {
    httpServer,
    webSocketServer,
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener('error', reject);
          resolve(httpServer.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const client of webSocketServer.clients) {
          client.terminate();
        }
        webSocketServer.close(error => {
          if (error) {
            reject(error);
            return;
          }
          httpServer.close(closeError => {
            if (closeError) reject(closeError);
            else resolve();
          });
        });
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  const targetPackages = (process.env.COPILOTO_TARGET_PACKAGES ?? 'com.app99.driver')
    .split(',')
    .map(packageName => packageName.trim())
    .filter(Boolean);
  const server = createMonitorServer({
    targetPackages,
    host: process.env.COPILOTO_WS_HOST ?? '0.0.0.0',
    port: Number(process.env.COPILOTO_WS_PORT ?? 8080),
  });

  server.listen().then(address => {
    console.log(`Copiloto dashboard: http://localhost:${address.port}`);
    console.log(`WebSocket endpoint: ws://<LAN-IP>:${address.port}/ws`);
    console.log(`Allowed target packages: ${targetPackages.join(', ')}`);
  }).catch(error => {
    console.error('Could not start monitor server:', error);
    process.exitCode = 1;
  });
}
