import sinon from "sinon";
import assert from "node:assert";
import { Logging } from "@antelopejs/interface-core/logging";

import { logServerStarted } from "../port-binding";
import type { ServerConfig } from "../server-config";

const REQUESTED_PORT = 5010;
const FALLBACK_PORT = 5011;
const RANDOM_PORT = 0;

const HTTP_CONFIG: ServerConfig = { protocol: "http", host: "127.0.0.1" };

interface LoggingStubs {
  info: sinon.SinonStub;
  warn: sinon.SinonStub;
}

function stubLogging(): LoggingStubs {
  return {
    info: sinon.stub(Logging, "Info"),
    warn: sinon.stub(Logging, "Warn"),
  };
}

describe("Server start logging", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("logs at info level when the requested port is bound", () => {
    const { info, warn } = stubLogging();

    logServerStarted(HTTP_CONFIG, REQUESTED_PORT, REQUESTED_PORT);

    sinon.assert.notCalled(warn);
    sinon.assert.calledOnceWithExactly(
      info,
      `Server started, listening on http://127.0.0.1:${REQUESTED_PORT}`,
    );
  });

  it("logs at info level when a random port was requested", () => {
    const { info, warn } = stubLogging();

    logServerStarted(HTTP_CONFIG, RANDOM_PORT, FALLBACK_PORT);

    sinon.assert.notCalled(warn);
    sinon.assert.calledOnce(info);
  });

  it("warns with the strictPort hint when the port fell back", () => {
    const { info, warn } = stubLogging();

    logServerStarted(HTTP_CONFIG, REQUESTED_PORT, FALLBACK_PORT);

    sinon.assert.notCalled(info);
    sinon.assert.calledOnce(warn);
    const [message] = warn.firstCall.args as string[];
    assert.match(message, new RegExp(`Port ${REQUESTED_PORT} in use`));
    assert.ok(message.includes(`http://127.0.0.1:${FALLBACK_PORT}`));
    assert.ok(message.includes("strictPort: true"));
  });
});
