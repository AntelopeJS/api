export const GATE_SOURCE = String.raw`import { Connection, Controller, Get, HTTPResult, Post, WebsocketHandler } from "@antelopejs/interface-api";

export const hits: string[] = [];

export class PingController extends Controller("/ping") {
  @Get("")
  ping() {
    hits.push("get");
    return { ok: true };
  }

  @Post("")
  create() {
    hits.push("post");
    return { created: true };
  }
}

export class LiveController extends Controller("") {
  @Get("_live")
  mine() {
    hits.push("live");
    return new HTTPResult(418, "mine");
  }
}

export class SocketController extends Controller("/socket") {
  @WebsocketHandler("")
  open(@Connection() connection: any) {
    hits.push("socket");
    connection.send("open");
  }
}
`;

/** A second module that registers a route of its own while it constructs. */
export const OWNED_MODULE = String.raw`"use strict";
const api = require("@antelopejs/interface-api");
class Owned extends api.Controller("/owned") {}
exports.construct = function construct() {
  api.RegisterRoute({ mode: "handler", method: "get", location: "/owned/route", callback: () => ({ owned: true }), parameters: [], properties: {}, controller: Owned });
};
exports.start = function start() {};
exports.stop = function stop() {};
exports.destroy = function destroy() {};
`;
