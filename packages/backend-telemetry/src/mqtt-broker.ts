import { createRequire } from "node:module";
import net from "node:net";
import { WebSocketServer, createWebSocketStream } from "ws";

interface AedesClient {
  id: string;
}

interface AedesBroker {
  handle: (stream: NodeJS.ReadWriteStream, request?: unknown) => void;
  clients: Record<string, AedesClient | undefined>;
  on: (event: "client" | "clientDisconnect", handler: (client: AedesClient) => void) => void;
  close: (callback: () => void) => void;
}

export interface MqttBroker {
  port: number;
  wsPort: number | null;
  close: () => Promise<void>;
  isClientConnected: (clientId: string) => boolean;
}

export async function startMqttBroker(options: {
  mqttPort: number;
  wsPort?: number;
  onSession?: (clientId: string, connected: boolean) => void;
}): Promise<MqttBroker> {
  const require = createRequire(import.meta.url);
  const createBroker = require("aedes") as () => AedesBroker;
  const broker = createBroker();
  broker.on("client", (client) => {
    options.onSession?.(client.id, true);
  });
  broker.on("clientDisconnect", (client) => {
    options.onSession?.(client.id, false);
  });
  const tcp = net.createServer((stream) => {
    broker.handle(stream);
  });

  const port = await new Promise<number>((resolve, reject) => {
    tcp.once("error", reject);
    tcp.listen(options.mqttPort, () => {
      const address = tcp.address();
      if (address === null || typeof address === "string") {
        reject(new Error("MQTT broker did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });

  let wsServer: WebSocketServer | null = null;
  let wsPort: number | null = null;
  if (options.wsPort !== undefined) {
    wsServer = new WebSocketServer({ port: options.wsPort });
    wsPort = await new Promise<number>((resolve, reject) => {
      wsServer?.once("error", reject);
      wsServer?.once("listening", () => {
        const address = wsServer?.address();
        if (address === null || address === undefined || typeof address === "string") {
          reject(new Error("MQTT websocket bridge did not bind"));
          return;
        }
        resolve(address.port);
      });
    });
    wsServer.on("connection", (socket, request) => {
      const stream = createWebSocketStream(socket);
      broker.handle(stream, request);
    });
  }

  return {
    port,
    wsPort,
    isClientConnected(clientId: string): boolean {
      return broker.clients[clientId] !== undefined;
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        const finish = (): void => {
          broker.close(() => {
            resolve();
          });
        };
        if (wsServer === null) {
          tcp.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            finish();
          });
          return;
        }
        wsServer.close(() => {
          tcp.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            finish();
          });
        });
      });
    },
  };
}
