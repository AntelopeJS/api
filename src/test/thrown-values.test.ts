import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { HTTPResult } from "@antelopejs/interface-api";

import { registerHandler, requestListener, unregisterHandler } from "../server";

const TEST_HOST = "127.0.0.1";

interface ThrownCase {
  location: string;
  thrower: () => never;
  answer: [number, string, string];
}

const CASES: ThrownCase[] = [
  {
    location: "/thrown-object",
    thrower: () => {
      throw { code: 7, detail: [1, null] };
    },
    answer: [500, '{"code":7,"detail":[1,null]}', "application/json"],
  },
  {
    location: "/thrown-object-message",
    thrower: () => {
      throw { message: { field: "name" } };
    },
    answer: [500, '{"field":"name"}', "application/json"],
  },
  {
    location: "/thrown-null-message",
    thrower: () => {
      throw { message: null, code: 3 };
    },
    answer: [500, '{"message":null,"code":3}', "application/json"],
  },
  {
    location: "/thrown-number",
    thrower: () => {
      throw 42;
    },
    answer: [500, "42", "application/json"],
  },
  {
    location: "/thrown-undefined",
    thrower: () => {
      throw undefined;
    },
    answer: [500, "", "text/plain"],
  },
  {
    location: "/thrown-result",
    thrower: () => {
      throw new HTTPResult(409, { conflict: true });
    },
    answer: [409, '{"conflict":true}', "application/json"],
  },
];

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, TEST_HOST, () => {
      const address = server.address();
      if (!(address instanceof Object)) {
        reject(new Error("Test server did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function answer(
  port: number,
  location: string,
): Promise<[number, string, string | null]> {
  const response = await fetch(`http://${TEST_HOST}:${port}${location}`);
  return [
    response.status,
    await response.text(),
    response.headers.get("content-type"),
  ];
}

describe("Server answer to a thrown value", () => {
  const server = createServer((incoming, response) => {
    void requestListener(incoming, response, "http");
  });
  let port: number;

  before(async () => {
    port = await listen(server);
    for (const { location, thrower } of CASES) {
      registerHandler(
        location,
        { mode: "handler", method: "get", location },
        thrower,
      );
    }
  });

  after(async () => {
    for (const { location } of CASES) {
      unregisterHandler(location);
    }
    await close(server);
  });

  it("answers its message as text, or its JSON, with status 500", async () => {
    const answers: Array<[number, string, string | null]> = [];
    for (const { location } of CASES) {
      answers.push(await answer(port, location));
    }

    assert.deepEqual(
      answers,
      CASES.map((thrown) => thrown.answer),
    );
  });
});
