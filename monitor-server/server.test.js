import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {WebSocket} from 'ws';
import {createMonitorServer} from './server.js';

const servers = [];

async function startServer(options = {}) {
  const server = createMonitorServer({
    host: '127.0.0.1',
    port: 0,
    ...options,
  });
  servers.push(server);
  const address = await server.listen();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const onMessage = data => {
      const message = JSON.parse(data.toString());
      if (predicate(message)) {
        socket.off('message', onMessage);
        resolve(message);
      }
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  const snapshot = nextMessage(socket, message => message.type === 'snapshot');
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {socket, snapshot: await snapshot};
}

const observation = {
  packageName: 'com.app99.driver',
  capturedAt: 1_800_000_000_000,
  screenWidth: 1080,
  screenHeight: 2400,
  coordinateSpace: 'screen-pixels',
  ocrStatus: 'complete',
  elements: [{
    text: 'R$ 24,00',
    source: 'accessibility',
    bounds: {left: 12, top: 20, right: 120, bottom: 60},
  }],
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

test('serves the dashboard and current package status', async () => {
  const {baseUrl} = await startServer();
  const [page, health] = await Promise.all([
    fetch(baseUrl),
    fetch(`${baseUrl}/health`).then(response => response.json()),
  ]);

  assert.equal(page.status, 200);
  assert.match(await page.text(), /Captura ao vivo/);
  assert.deepEqual(health.targetPackages, ['com.app99.driver']);
});

test('connects without credentials and streams observations to every client', async () => {
  const {wsUrl} = await startServer();
  const {socket: appSocket} = await connect(wsUrl);
  const {socket: dashboardSocket, snapshot} = await connect(wsUrl);
  assert.deepEqual(snapshot.observations, []);

  const update = nextMessage(
    dashboardSocket,
    message => message.type === 'screenData',
  );
  appSocket.send(JSON.stringify({type: 'screenData', data: observation}));
  assert.deepEqual((await update).data, observation);
  appSocket.close();
  dashboardSocket.close();
});

test('sends the most recent observation to a newly connected dashboard', async () => {
  const {wsUrl} = await startServer();
  const {socket: sender} = await connect(wsUrl);
  sender.send(JSON.stringify({type: 'screenData', data: observation}));
  await nextMessage(sender, message => message.type === 'screenData');

  const {socket: dashboard, snapshot} = await connect(wsUrl);
  assert.deepEqual(snapshot.observations, [observation]);
  sender.close();
  dashboard.close();
});

test('rejects observations for packages outside the allowlist', async () => {
  const {wsUrl} = await startServer();
  const {socket} = await connect(wsUrl);
  const error = nextMessage(socket, message => message.type === 'error');
  socket.send(JSON.stringify({
    type: 'screenData',
    data: {...observation, packageName: 'com.other.app'},
  }));
  assert.equal((await error).type, 'error');
  socket.close();
});

test('requires at least one target package', () => {
  assert.throws(
    () => createMonitorServer({targetPackages: []}),
    /At least one target package/,
  );
});
