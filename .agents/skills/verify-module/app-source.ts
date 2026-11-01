/** The consumer module every journey adds beside the driver: it loads the journey's compiled controllers, as a module that imports `@antelopejs/interface-api` does, and runs scenario bodies inside the project on its own loopback port. */
export const APP_SOURCE = String.raw`"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let controllers = {};
let received = {};

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  return value;
}

function plain(value) {
  return ordered(JSON.parse(JSON.stringify(value === undefined ? null : value)));
}

async function answer(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  try {
    const scenario = new AsyncFunction("api", "util", "load", "waitFor", "controllers", "config", text);
    const value = await scenario(require("@antelopejs/interface-api"), require("@antelopejs/interface-api-util"), require, sleep, controllers, received);
    return { ok: true, value: plain(value) };
  } catch (error) {
    return { ok: false, error: { name: (error && error.name) || "Error", message: String((error && error.message) || error) } };
  }
}

exports.construct = function construct(config) {
  received = config || {};
  if (received.connectAtConstruct) {
    received.constructProbe = "pending";
    const socket = require("node:net").connect(Number(received.connectAtConstruct), "127.0.0.1");
    socket.on("connect", () => { received.constructProbe = "connected"; socket.destroy(); });
    socket.on("error", (error) => { received.constructProbe = error.code; });
  }
  const file = path.join(__dirname, "controllers.js");
  if (fs.existsSync(file)) controllers = require(file);
  server = http.createServer((request, response) => {
    answer(request).then((result) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result));
    });
  });
  server.listen(Number(process.env.VERIFY_APP_PORT), "127.0.0.1");
};
exports.start = async function start() {
  await sleep(Number(process.env.VERIFY_APP_START_DELAY || 0));
  if (process.env.VERIFY_APP_START_FAILS) throw new Error("the consumer module failed to start");
};
exports.stop = async function stop() {
  await sleep(Number(process.env.VERIFY_APP_STOP_DELAY || 0));
  if (server) server.close();
};
exports.destroy = function destroy() {};
`;
