export const WEBSOCKET_SOURCE = String.raw`import { Connection, Context, Controller, Get, HTTPResult, Monitor, Parameter, Prefix, RequestContext, WebsocketHandler } from "@antelopejs/interface-api";

export const closed: string[] = [];
export const monitored: string[] = [];

export class PropertySocketController extends Controller("/prop-socket") {
  @Connection()
  private socket!: any;

  @WebsocketHandler("")
  greet() {
    this.socket.send("hello from a property");
  }
}

export class ChatController extends Controller("/chat") {
  @WebsocketHandler("")
  async handleChat(@Connection() connection: any) {
    connection.on("message", (data: string) => {
      connection.send("Echo: " + data);
    });

    connection.on("close", () => {
      closed.push("chat");
    });
  }

  @WebsocketHandler("rooms/:room")
  joinRoom(@Connection() connection: any, @Parameter("room") room: string, @Parameter("token", "query") token: string | true | undefined) {
    connection.send("joined " + room + " as " + String(token));
    connection.on("close", () => {
      closed.push("room " + room);
    });
  }

  @Monitor("get", "")
  watchChat(@Context() context: RequestContext) {
    monitored.push("monitor:" + String(Boolean(context.connection)));
  }

  @WebsocketHandler("boom")
  boom(@Connection() connection: any) {
    connection.send("before the failure");
    throw new Error("socket boom");
  }

  @WebsocketHandler("late-boom")
  async lateBoom(@Connection() connection: any) {
    connection.send("before the async failure");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    throw new Error("late socket boom");
  }

  @Monitor("get", "boom")
  watchBoom(@Context() context: RequestContext) {
    monitored.push("boom:" + String(context.error));
  }

  @Monitor("get", "late-boom")
  watchLateBoom(@Context() context: RequestContext) {
    monitored.push("late-boom:" + String(context.error));
  }

  @Prefix("get", "late-private")
  async lateRefuse() {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    return new HTTPResult(403, "late private");
  }

  @WebsocketHandler("late-private")
  latePrivate(@Connection() connection: any) {
    connection.send("never reached");
  }

  @Get("http-only")
  httpOnly() {
    return { http: true };
  }

  @Prefix("get", "private")
  refuse() {
    return new HTTPResult(403, "private");
  }

  @WebsocketHandler("private")
  privateRoom(@Connection() connection: any) {
    connection.send("never reached");
  }
}
`;
