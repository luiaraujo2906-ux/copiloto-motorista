import {monitorServerConfig} from '../config/monitorServer';
import {NormalizedScreen} from '../screen/screenModel';

export type MonitorStreamState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

type MonitorStream = {
  publish: (screen: NormalizedScreen) => void;
  close: () => void;
};

export function connectMonitorStream(
  onStateChange: (state: MonitorStreamState, message?: string) => void,
): MonitorStream {
  if (!monitorServerConfig.url) {
    onStateChange('disabled');
    return {publish: () => undefined, close: () => undefined};
  }

  let socket: WebSocket | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;
  let latestScreen: NormalizedScreen | null = null;

  const sendLatest = () => {
    if (socket?.readyState === WebSocket.OPEN && latestScreen) {
      socket.send(JSON.stringify({type: 'screenData', data: latestScreen}));
    }
  };

  const scheduleReconnect = () => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retryDelay = Math.min(retryDelay * 2, 30_000);
      connect();
    }, retryDelay);
  };

  const connect = () => {
    if (closed) return;
    onStateChange('connecting');

    try {
      socket = new WebSocket(monitorServerConfig.url);
    } catch (error) {
      onStateChange(
        'error',
        error instanceof Error ? error.message : 'Endereço WebSocket inválido.',
      );
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      retryDelay = 1_000;
      onStateChange('connected');
      sendLatest();
    };
    socket.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'error') {
          onStateChange('error', message.message ?? 'Observação rejeitada.');
        }
      } catch {
        onStateChange('error', 'Resposta inválida do servidor WebSocket.');
      }
    };
    socket.onerror = () => {
      if (!closed) onStateChange('error', 'Não foi possível conectar ao servidor WebSocket.');
    };
    socket.onclose = () => {
      if (!closed) {
        onStateChange('disconnected');
        scheduleReconnect();
      }
    };
  };

  connect();

  return {
    publish(screen) {
      latestScreen = screen;
      sendLatest();
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    },
  };
}
