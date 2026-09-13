import { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

type PeerSocket = Socket &
  Partial<Pick<TLSSocket, "encrypted" | "authorized" | "authorizationError">>;

const PEER_FIELDS = [
  "remoteAddress",
  "remotePort",
  "remoteFamily",
  "localAddress",
  "localPort",
  "localFamily",
  "encrypted",
  "authorized",
  "authorizationError",
] as const;

/** Detached transport retaining peer metadata without exposing the live socket. */
export class RegisteredReadSocket extends Socket {
  constructor(
    parent: PeerSocket,
    private readonly abort: () => void,
  ) {
    super();
    for (const field of PEER_FIELDS) {
      Object.defineProperty(this, field, { value: parent[field] });
    }
  }

  override write(): boolean {
    this.abort();
    return false;
  }

  override end(): this {
    this.abort();
    return this;
  }

  override connect(): this {
    this.abort();
    return this;
  }

  override _destroy(
    _error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    this.abort();
    callback();
  }

  override setTimeout(): this {
    this.abort();
    return this;
  }
}
