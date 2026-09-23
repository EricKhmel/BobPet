import { createServer, type Server, type Socket } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { parseMessage, type Message, type PetState } from '@bob-pet/shared';

/** How long a connection has to identify itself before it is dropped. */
const UNAUTHENTICATED_MS = 5_000;

/** Opt-in connection trace for diagnosing clients that cannot get through. Never logs secrets. */
const trace = (...parts: unknown[]): void => {
  if (process.env.BOB_PET_IPC_DEBUG) process.stderr.write(`[bob-pet-ipc ${new Date().toISOString().slice(11, 23)}] ${parts.join(' ')}\n`);
};

export class LocalPetServer {
  private server?: Server;
  private activeSockets = new Set<Socket>();

  constructor(
    private readonly secret: string,
    private readonly onState: (state: PetState, label?: string, source?: 'bob') => void,
    private readonly onFocus: () => void
  ) {}

  /**
   * Listens on `port`, or on any free port if that one is taken. Another program holding
   * 48173 must not stop the pet from running; the port it actually got is published in
   * `session.json`, which is where the hooks and the extension look it up.
   */
  async start(port = 0): Promise<number> {
    try {
      return await this.listen(port);
    } catch (error) {
      if (port === 0 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      // The failed attempt never started listening, so closing it is best effort only.
      try { this.server?.close(); } catch { /* never listened */ }
      this.server = undefined;
      return this.listen(0);
    }
  }

  private async listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handle(socket));
      this.server.once('error', reject);
      this.server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        this.server?.off('error', reject);
        const address = this.server?.address();
        if (!address || typeof address === 'string') return reject(new Error('No loopback address'));
        resolve(address.port);
      });
    });
  }

  /** Broadcasts a message to authenticated extension client sockets */
  notifyExtensionFocusRequest(): void {
    const payload = '{"version":1,"type":"request-focus-ide"}\n';
    for (const socket of this.activeSockets) {
      try {
        socket.write(payload);
      } catch {
        this.activeSockets.delete(socket);
      }
    }
  }

  /** Constant-time, so a wrong secret tells a caller nothing by how long it took. */
  private secretMatches(offered: string): boolean {
    const a = Buffer.from(offered, 'utf8');
    const b = Buffer.from(this.secret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private handle(socket: Socket): void {
    let authenticated = false;
    let buffer = '';
    trace('connection from', `${socket.remoteAddress}:${socket.remotePort}`);
    // Until it says who it is, a connection has five seconds. An extension that
    // authenticates stays connected for as long as it likes (see below).
    socket.setTimeout(UNAUTHENTICATED_MS, () => { if (!authenticated) socket.destroy(); });
    socket.on('close', () => trace('closed', `${socket.remoteAddress}:${socket.remotePort}`, authenticated ? 'authenticated' : 'unauthenticated'));
    // Keep connection alive while extension is connected
    socket.on('close', () => this.activeSockets.delete(socket));
    socket.on('error', () => this.activeSockets.delete(socket));

    socket.on('data', (part) => {
      buffer += part.toString('utf8');
      if (buffer.length > 8192) return socket.destroy();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(trimmed);
        } catch {
          trace('rejected: line is not JSON,', String(trimmed.length), 'chars');
          socket.destroy();
          return;
        }
        const message = parseMessage(raw);
        if (!message) {
          const shape = raw && typeof raw === 'object' ? Object.keys(raw).join(',') : typeof raw;
          trace('rejected: invalid message, keys', shape);
          socket.destroy();
          return;
        }
        if (!authenticated) {
          if (message.type === 'hello' && this.secretMatches(message.secret)) {
            authenticated = true;
            socket.setTimeout(0);
            this.activeSockets.add(socket);
            socket.write('{"ok":true}\n');
            trace('authenticated');
          } else {
            trace('rejected:', message.type === 'hello' ? 'wrong secret' : `unauthenticated ${message.type}`);
            socket.destroy();
            return;
          }
        } else if (message.type !== 'hello') {
          trace('dispatch', message.type, message.type === 'set-state' ? message.state : '');
          this.dispatch(message, socket);
        }
      }
    });
  }

  private dispatch(message: Exclude<Message, { type: 'hello' }>, socket: Socket): void {
    if (message.type === 'set-state') this.onState(message.state, message.label, message.source);
    if (message.type === 'focus-request') this.onFocus();
    if (message.type === 'ping') socket.write('{"ok":true}\n');
  }

  async close(): Promise<void> {
    for (const s of this.activeSockets) s.destroy();
    this.activeSockets.clear();
    if (this.server) {
      await new Promise<void>((resolve, reject) => this.server?.close((error) => (error ? reject(error) : resolve())));
    }
  }
}
