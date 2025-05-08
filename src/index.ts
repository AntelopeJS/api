import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import stream from 'stream';

import { ImplementInterface } from '@ajs/core/beta';
import { requestListener, upgradeListener } from './server';
import './middlewares/cors';

interface HTTPConfig extends http.ServerOptions {
  protocol: 'http';
  host?: string;
  port?: number;
}

interface HTTPSConfig extends https.ServerOptions {
  protocol: 'https';
  host?: string;
  port?: number;
}

interface Config {
  servers?: (HTTPConfig | HTTPSConfig)[];
  cors?: {
    allowedOrigins?: string | RegExp | (string | RegExp)[];
    allowedMethods?: string[];
  };
}

let conf: Config;
let servers: net.Server[];

export function getConfig(): Config {
  return conf;
}

export async function construct(config: Config): Promise<void> {
  conf = config;
  conf.servers = conf.servers || [];
  if (conf.servers.length === 0) {
    conf.servers.push({ protocol: 'http', port: 80 });
  }

  await ImplementInterface(import('@ajs.local/api/beta'), import('./implementations/api/beta'));
}

export function destroy(): void {}

export function start(): void {
  servers = conf.servers!.map((config) => {
    let server: net.Server;
    switch (config.protocol) {
      case 'http':
        server = http.createServer(config);
        server.on(
          'request',
          (req: http.IncomingMessage, res: http.ServerResponse) => void requestListener(req, res, 'http'),
        );
        server.on(
          'upgrade',
          (req: http.IncomingMessage, sock: stream.Duplex, head: Buffer) => void upgradeListener(req, sock, head, 'ws'),
        );
        break;
      case 'https':
        server = https.createServer(config);
        server.on(
          'request',
          (req: http.IncomingMessage, res: http.ServerResponse) => void requestListener(req, res, 'https'),
        );
        server.on(
          'upgrade',
          (req: http.IncomingMessage, sock: stream.Duplex, head: Buffer) =>
            void upgradeListener(req, sock, head, 'wss'),
        );
        break;
    }
    return server.listen(config.port, config.host);
  });
}

export function stop(): void {
  servers.forEach((server) => server.close());
  servers = [];
}
