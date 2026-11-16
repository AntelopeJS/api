export const REFUSAL_SOURCE = String.raw`import { Connection, Controller, HTTPResult, Prefix, WebsocketHandler } from "@antelopejs/interface-api";

export const reached: string[] = [];

export class RefusalController extends Controller("/refusal") {
  @Prefix("get", "private")
  refusePrivate() {
    return new HTTPResult(403, "private");
  }

  @WebsocketHandler("private")
  privateRoom(@Connection() connection: any) {
    reached.push("private");
    connection.send("never reached");
  }

  @Prefix("get", "teapot")
  refuseTeapot() {
    return new HTTPResult(418, "short and stout");
  }

  @WebsocketHandler("teapot")
  teapotRoom(@Connection() connection: any) {
    reached.push("teapot");
    connection.send("never reached");
  }

  @Prefix("get", "throwing")
  failThrowing() {
    throw new Error("prefix exploded");
  }

  @WebsocketHandler("throwing")
  throwingRoom(@Connection() connection: any) {
    reached.push("throwing");
    connection.send("never reached");
  }

  @Prefix("get", "late-throwing")
  async failLate() {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    throw new Error("late prefix exploded");
  }

  @WebsocketHandler("late-throwing")
  lateThrowingRoom(@Connection() connection: any) {
    reached.push("late-throwing");
    connection.send("never reached");
  }

  @WebsocketHandler("open")
  openRoom(@Connection() connection: any) {
    connection.on("message", (data: string) => connection.send("Echo: " + data));
  }
}
`;
