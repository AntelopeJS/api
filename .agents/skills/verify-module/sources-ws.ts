export const WEBSOCKET_SOURCE = String.raw`import { Connection, Controller, Get, HTTPResult, Parameter, Prefix, WebsocketHandler } from "@antelopejs/interface-api";

export const closed: string[] = [];

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
