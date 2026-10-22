import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createTelemetryEngine, type TelemetryEngine } from "./engine.js";
import type { Scenario } from "./types.js";

export interface HttpServer {
  port: number;
  close: () => Promise<void>;
}

export function startHttpServer(engine: TelemetryEngine, port: number): Promise<HttpServer> {
  const server = createServer((req, res) => {
    void route(engine, req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "request failed";
      if (message === "simulator already running") {
        sendJson(res, 409, { error: message });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: message });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("HTTP server did not bind"));
        return;
      }
      resolve({
        port: (address as AddressInfo).port,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => {
              if (error) {
                fail(error);
                return;
              }
              done();
            });
          }),
      });
    });
  });
}

async function route(engine: TelemetryEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/api/health") {
    const state = engine.snapshot();
    sendJson(res, 200, {
      broker: state.broker,
      timescale: state.timescale,
      activePods: state.activePods,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/telemetry/state") {
    sendJson(res, 200, engine.snapshot());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/telemetry/stream") {
    stream(engine, req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/simulator/start") {
    const body = await readBody(req);
    const scenario = parseScenario(body);
    if (scenario === null) {
      sendJson(res, 400, { error: "scenario must be QI-0412 or QI-0419" });
      return;
    }
    if (engine.isRunning()) {
      sendJson(res, 409, { error: "simulator already running" });
      return;
    }
    void engine.run(scenario, "demo").catch((error: unknown) => {
      console.error("Flight simulator failed", error);
    });
    sendJson(res, 202, { started: scenario, mode: "demo" });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function stream(engine: TelemetryEngine, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event: unknown): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: "snapshot", state: engine.snapshot() });
  const unsubscribe = engine.subscribe(send);
  const heartbeat = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function parseScenario(body: string): Scenario | null {
  try {
    if (body.trim().length === 0) {
      return null;
    }
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("scenario" in parsed)) {
      return null;
    }
    const scenario = parsed.scenario;
    if (scenario === "QI-0412" || scenario === "QI-0419") {
      return scenario;
    }
    return null;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function main(): Promise<void> {
  const httpPort = Number(process.env.PORT ?? 4000);
  const mqttPort = Number(process.env.MQTT_PORT ?? 1883);
  const wsPort = Number(process.env.MQTT_WS_PORT ?? 8083);
  const engine = await createTelemetryEngine({
    mqttPort,
    wsPort,
    useTimescale: true,
  });
  const http = await startHttpServer(engine, httpPort);
  console.log(
    `FreshFlite telemetry listening on http://127.0.0.1:${String(http.port)} (MQTT ${String(mqttPort)}, WS ${String(wsPort)})`,
  );
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("/src/server.ts") === true || entry?.endsWith("/dist/server.js") === true) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
