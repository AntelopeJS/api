import {
  Connection,
  Context,
  Controller,
  Delete,
  Get,
  HandlerPriority,
  HTTPResult,
  MultiParameter,
  Parameter,
  Post,
  Postfix,
  Prefix,
  Put,
  RawBody,
  Result,
  Route,
  SetParameterProvider,
  Transform,
  WebsocketHandler,
  WriteStream,
  GetControllerInstance,
  RequestContext,
} from '@ajs/api/beta';
import { MakeMethodDecorator, MakeParameterAndPropertyDecorator } from '@ajs/core/beta/decorators';
import assert from 'assert';
import sinon, { SinonSpy } from 'sinon';
import { PassThrough } from 'stream';
import WebSocket from 'ws';

const SpyMethod = MakeMethodDecorator((_target, _key, descriptor) => {
  descriptor.value = sinon.spy(descriptor.value);
});

const URL_BASE = 'http://127.0.0.1:5010';

interface FetchTestOptions {
  route: string;
  status: number;
  method?: string;
  result?: string;
  callCount?: [() => any, number];
  prepare?: (this: Mocha.Context, init: RequestInit, options: FetchTestOptions) => void | Promise<void>;
  postCheck?: (this: Mocha.Context, res: Response, options: FetchTestOptions) => void | Promise<void>;
}

function FetchTest(name: string, options: FetchTestOptions) {
  it(`${name}: ${options.method ?? 'GET'} ${options.route}`, async function () {
    const init: RequestInit = { method: options.method ?? 'GET' };
    if (options.prepare) {
      await options.prepare.apply(this, [init, options]);
    }
    const res = await fetch(URL_BASE + options.route, init);
    if (res.status !== options.status) {
      throw new Error(`Wrong response status (expected ${options.status}, got ${res.status}): ${await res.text()}`);
    }
    if (options.result !== undefined) {
      assert.equal(await res.text(), options.result, 'Incorrect response body');
    }
    if (options.callCount) {
      sinon.assert.callCount(options.callCount[0] as SinonSpy, options.callCount[1]);
    }
    if (options.postCheck) {
      await options.postCheck.apply(this, [res, options]);
    }
  });
}

// Routing Tests

export class TestRoutingController0 extends Controller('/') {
  @Get()
  test() {}

  @Prefix('get', 'testPriority', HandlerPriority.HIGH)
  @SpyMethod()
  testPrefixHigh() {}

  @Prefix('get', 'testPriority', HandlerPriority.LOW)
  @SpyMethod()
  testPrefixLow() {}

  @Get()
  @SpyMethod()
  testPriority() {}

  @Postfix('get', 'testPriority', HandlerPriority.HIGH)
  @SpyMethod()
  testPostfixHigh() {}

  @Postfix('get', 'testPriority', HandlerPriority.LOW)
  @SpyMethod()
  testPostfixLow() {}

  @Prefix('get', 'testEarlyReturn')
  @SpyMethod()
  testPrefixEarlyReturn() {
    return 'Ok Early';
  }

  @Get()
  @SpyMethod()
  testEarlyReturn() {
    return 'Not Ok';
  }

  @Get()
  @SpyMethod()
  testOverride() {
    return 'Not Ok';
  }

  @Postfix('get', 'testOverride')
  @SpyMethod()
  testPostfixOverride() {
    return 'Ok Override';
  }
}

export class TestRoutingController1 extends Controller('/routing/controller1') {
  @Get()
  @SpyMethod()
  test() {
    return 'Ok';
  }

  @Post('test')
  @SpyMethod()
  testPost() {
    return 'Ok Post';
  }

  @Put('test')
  @SpyMethod()
  testPut() {
    return 'Ok Put';
  }

  @Delete('test')
  @SpyMethod()
  testDelete() {
    return 'Ok Delete';
  }

  @Route('handler', 'patch', 'test')
  @SpyMethod()
  testCustom() {
    return 'Ok Patch';
  }
}

export class TestRoutingController2 extends TestRoutingController1.extend('/explicit') {
  @Get()
  test() {
    return 'Ok 2';
  }
}

export class TestRoutingController3 extends Controller('///routing///controller2///') {
  @Get()
  test() {}
}

describe('Routing', () => {
  describe('Controller', () => {
    FetchTest('Root Controller', { route: '/test', method: 'GET', status: 200 });

    FetchTest('Normal Controller', {
      route: '/routing/controller1/test',
      method: 'GET',
      status: 200,
      result: 'Ok',
    });

    FetchTest('Extended Controller', {
      route: '/routing/controller1/explicit/test',
      method: 'GET',
      status: 200,
      result: 'Ok 2',
    });

    FetchTest('Redundant Slash Controller', { route: '/routing/controller2/test', method: 'GET', status: 200 });
  });

  describe('Handler', () => {
    const testRoute1 = TestRoutingController1.prototype.test as SinonSpy;

    FetchTest('Normal Call', {
      route: '/routing/controller1/test',
      method: 'GET',
      status: 200,
      callCount: [testRoute1, 1],
      prepare: () => testRoute1.resetHistory(),
    });

    // TODO: review expected result
    FetchTest('Options Call', {
      route: '/routing/controller1/test',
      method: 'OPTIONS',
      status: 404,
      callCount: [testRoute1, 0],
      prepare: () => testRoute1.resetHistory(),
    });

    FetchTest('Head Call', {
      route: '/routing/controller1/test',
      method: 'HEAD',
      status: 200,
      result: '',
      callCount: [testRoute1, 1],
      prepare: () => testRoute1.resetHistory(),
    });

    FetchTest('Post Call', {
      route: '/routing/controller1/test',
      method: 'POST',
      status: 200,
      result: 'Ok Post',
    });

    FetchTest('Put Call', {
      route: '/routing/controller1/test',
      method: 'PUT',
      status: 200,
      result: 'Ok Put',
    });

    FetchTest('Delete Call', {
      route: '/routing/controller1/test',
      method: 'DELETE',
      status: 200,
      result: 'Ok Delete',
    });

    FetchTest('Custom Call (PATCH)', {
      route: '/routing/controller1/test',
      method: 'PATCH',
      status: 200,
      result: 'Ok Patch',
    });

    FetchTest('Prefix Priority', {
      route: '/testPriority',
      method: 'GET',
      status: 200,
      postCheck: () => {
        sinon.assert.callOrder(
          TestRoutingController0.prototype.testPrefixHigh as SinonSpy,
          TestRoutingController0.prototype.testPrefixLow as SinonSpy,
          TestRoutingController0.prototype.testPriority as SinonSpy,
        );
      },
    });

    FetchTest('Prefix Early Return', {
      route: '/testEarlyReturn',
      method: 'GET',
      status: 200,
      result: 'Ok Early',
      callCount: [TestRoutingController0.prototype.testEarlyReturn, 0],
    });

    FetchTest('Postfix Priority', {
      route: '/testPriority',
      method: 'GET',
      status: 200,
      postCheck: () => {
        sinon.assert.callOrder(
          TestRoutingController0.prototype.testPriority as SinonSpy,
          TestRoutingController0.prototype.testPostfixHigh as SinonSpy,
          TestRoutingController0.prototype.testPostfixLow as SinonSpy,
        );
      },
    });

    FetchTest('Postfix Override', {
      route: '/testOverride',
      method: 'GET',
      status: 200,
      result: 'Ok Override',
      callCount: [TestRoutingController0.prototype.testOverride, 1],
    });
  });
});

// Execution Tests

const ConstantProvider = MakeParameterAndPropertyDecorator((target, key, index, value: any) =>
  SetParameterProvider(target, key, index, () => value),
);

export class TestExecutionController1 extends Controller('/execution/controller1') {
  @ConstantProvider('Ok')
  declare prop: string;

  @Get()
  @SpyMethod()
  testProperty() {
    return this.prop;
  }

  @Get()
  @SpyMethod()
  testParameter(@ConstantProvider('Ok') param: string) {
    return param;
  }
}

export class TestExecutionController2 extends Controller('/execution/controller2') {
  @Get()
  @SpyMethod()
  testProviderContext(@Context() _ctx: RequestContext) {}

  @Post()
  @SpyMethod()
  testProviderRawBody(@RawBody() _body: Buffer) {}

  @Get('testProviderParameterParam/:key')
  @SpyMethod()
  testProviderParameterParam(@Parameter('key', 'param') _param: string) {}

  @Get()
  @SpyMethod()
  testProviderParameterHeader(@Parameter('key', 'header') _param: string) {}

  @Get()
  @SpyMethod()
  testProviderParameterQuery(@Parameter('key', 'query') _param: string) {}

  @Get()
  @SpyMethod()
  testProviderMultiParameterHeader(@MultiParameter('key', 'header') _params: string[]) {}

  @Get()
  @SpyMethod()
  testProviderMultiParameterQuery(@MultiParameter('key', 'query') _params: string[]) {}

  @Get()
  @SpyMethod()
  testProviderWriteStream(@WriteStream() param: PassThrough) {
    param.write('Ok');
    param.end();
  }

  @Get()
  testProviderResult() {
    return 'Ok';
  }

  @Postfix('get', 'testProviderResult')
  @SpyMethod()
  testProviderResultPostfix(@Result() _res: string) {}

  @Get()
  @SpyMethod()
  testModifierTransform(@ConstantProvider('O') @Transform((_ctx, val) => val + 'k') _param: string) {}
}

export class TestExecutionController3 extends Controller('/execution/controller3') {
  @Get()
  test() {
    return new HTTPResult();
  }

  @Get()
  testThrow() {
    throw new HTTPResult();
  }

  @Get()
  testStatus() {
    return new HTTPResult(201);
  }

  @Get()
  testHeader() {
    const res = new HTTPResult(200);
    res.addHeader('key', 'Ok');
    return res;
  }

  @Get()
  testBody() {
    return new HTTPResult(200, 'Ok', 'text/plain');
  }

  @Postfix('get', 'testConsistency')
  testConsistencyPrefix(@Result() res: HTTPResult) {
    res.addHeader('key1', 'Ok');
  }

  @Get()
  testConsistency(@Result() res: HTTPResult) {
    res.addHeader('key2', 'Ok');
    res.setStatus(200);
    res.setBody('Ok', 'text/plain');
    return res;
  }

  @Postfix('get', 'testConsistency')
  testConsistencyPostfix(@Result() res: HTTPResult) {
    res.addHeader('key3', 'Ok');
  }

  @Get()
  @SpyMethod()
  async testControllerInstance(@Context() ctx: RequestContext) {
    const controller1 = await GetControllerInstance(TestExecutionController1, ctx);
    return controller1.prop;
  }
}

describe('Execution', () => {
  FetchTest('Property Access', {
    route: '/execution/controller1/testProperty',
    method: 'GET',
    status: 200,
    result: 'Ok',
  });

  FetchTest('Parameter Access', {
    route: '/execution/controller1/testParameter',
    method: 'GET',
    status: 200,
    result: 'Ok',
  });

  FetchTest('GetControllerInstance', {
    route: '/execution/controller3/testControllerInstance',
    method: 'GET',
    status: 200,
    result: 'Ok',
  });

  describe('Providers', () => {
    FetchTest('Context', {
      route: '/execution/controller2/testProviderContext',
      method: 'GET',
      status: 200,
      postCheck() {
        const res = (TestExecutionController2.prototype.testProviderContext as SinonSpy).lastCall
          .args[0] as RequestContext;
        assert.equal(typeof res, 'object', 'Context object type');
        assert(res.rawRequest, 'Context object');
      },
    });

    FetchTest('RawBody', {
      route: '/execution/controller2/testProviderRawBody',
      method: 'POST',
      status: 200,
      prepare(init) {
        init.body = 'Test';
      },
      postCheck() {
        const res = (TestExecutionController2.prototype.testProviderRawBody as SinonSpy).lastCall.args[0] as Buffer;
        assert(Buffer.isBuffer(res), 'Buffer object');
        assert.equal(res.toString(), 'Test');
      },
    });

    FetchTest('Parameter (param)', {
      route: '/execution/controller2/testProviderParameterParam/Ok',
      method: 'GET',
      status: 200,
      postCheck() {
        assert.equal(
          (TestExecutionController2.prototype.testProviderParameterParam as SinonSpy).lastCall.args[0],
          'Ok',
          'Parameter value',
        );
      },
    });

    FetchTest('Parameter (header)', {
      route: '/execution/controller2/testProviderParameterHeader',
      method: 'GET',
      status: 200,
      prepare(init) {
        init.headers = { key: 'Ok' };
      },
      postCheck() {
        assert.equal(
          (TestExecutionController2.prototype.testProviderParameterHeader as SinonSpy).lastCall.args[0],
          'Ok',
          'Parameter value',
        );
      },
    });

    FetchTest('Parameter (query)', {
      route: '/execution/controller2/testProviderParameterQuery?key=Ok',
      method: 'GET',
      status: 200,
      postCheck() {
        assert.equal(
          (TestExecutionController2.prototype.testProviderParameterQuery as SinonSpy).lastCall.args[0],
          'Ok',
          'Parameter value',
        );
      },
    });

    FetchTest('MultiParameter (header)', {
      route: '/execution/controller2/testProviderMultiParameterHeader',
      method: 'GET',
      status: 200,
      prepare(init) {
        init.headers = { key: ['Ok 1', 'Ok 2'] };
      },
      postCheck() {
        assert.equal(
          (TestExecutionController2.prototype.testProviderMultiParameterHeader as SinonSpy).lastCall.args[0].toString(),
          ['Ok 1', 'Ok 2'].toString(),
          'Parameter value',
        );
      },
    });

    FetchTest('MultiParameter (query)', {
      route: '/execution/controller2/testProviderMultiParameterQuery?key=Ok1&key=Ok2',
      method: 'GET',
      status: 200,
      postCheck() {
        assert.equal(
          (TestExecutionController2.prototype.testProviderMultiParameterQuery as SinonSpy).lastCall.args[0].toString(),
          ['Ok1', 'Ok2'].toString(),
          'Parameter value',
        );
      },
    });

    FetchTest('Result', {
      route: '/execution/controller2/testProviderResult',
      method: 'GET',
      status: 200,
      postCheck() {
        const res = (TestExecutionController2.prototype.testProviderResultPostfix as SinonSpy).lastCall
          .args[0] as HTTPResult;
        assert(res instanceof HTTPResult, 'HTTPResult object');
        assert.equal(res.getBody(), 'Ok', 'HTTPResult value');
      },
    });

    FetchTest('WriteStream', {
      route: '/execution/controller2/testProviderWriteStream',
      method: 'Get',
      status: 200,
      result: 'Ok',
      postCheck() {
        const res = (TestExecutionController2.prototype.testProviderWriteStream as SinonSpy).lastCall
          .args[0] as PassThrough;
        assert(res instanceof PassThrough, 'Stream object');
      },
    });
  });

  describe('Modifiers', () => {
    FetchTest('Transform', {
      route: '/execution/controller2/testModifierTransform',
      method: 'GET',
      status: 200,
      postCheck() {
        assert.equal(
          (TestExecutionController2.prototype.testModifierTransform as SinonSpy).lastCall.args[0],
          'Ok',
          'Parameter value',
        );
      },
    });
  });

  describe('HTTPResult', () => {
    FetchTest('Normal Return', { route: '/execution/controller3/test', method: 'GET', status: 200 });

    FetchTest('Throw', { route: '/execution/controller3/testThrow', method: 'GET', status: 200 });

    FetchTest('Status', { route: '/execution/controller3/testStatus', method: 'GET', status: 201 });

    FetchTest('Header', {
      route: '/execution/controller3/testHeader',
      method: 'GET',
      status: 200,
      postCheck(res) {
        assert.equal(res.headers.get('key'), 'Ok', 'Header value');
      },
    });

    FetchTest('Body', { route: '/execution/controller3/testBody', method: 'GET', status: 200, result: 'Ok' });

    FetchTest('Prefix/Postfix Consistency', {
      route: '/execution/controller3/testConsistency',
      method: 'GET',
      status: 200,
      result: 'Ok',
      postCheck(res) {
        assert.equal(res.headers.get('key1'), 'Ok', 'Prefix Header value');
        assert.equal(res.headers.get('key2'), 'Ok', 'Handler Header value');
        assert.equal(res.headers.get('key3'), 'Ok', 'Postfix Header value');
      },
    });
  });
});

// WebSocket Tests

const testWSReceiver = sinon.spy();
let testWSSocket: WebSocket;

export class TestWebsocketController1 extends Controller('/websocket/controller1') {
  @WebsocketHandler()
  @SpyMethod()
  test(@Connection() connection: WebSocket) {
    testWSSocket = connection;
    connection.on('message', testWSReceiver);
  }
}

describe('WebSocket', () => {
  let ws: WebSocket;
  const clientReceiver = sinon.spy();

  after(() => ws && ws.close());

  it('Connect', async () => {
    ws = new WebSocket(URL_BASE + '/websocket/controller1/test');
    ws.on('message', clientReceiver);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
  });

  it('Client -> Server', async () => {
    ws.send('Ok');
    await new Promise((resolve) => setTimeout(resolve, 10));
    sinon.assert.calledOnce(testWSReceiver);
    assert.equal(testWSReceiver.lastCall.firstArg.toString(), 'Ok');
  });

  it('Client <- Server', async () => {
    testWSSocket.send('Ok');
    await new Promise((resolve) => setTimeout(resolve, 10));
    sinon.assert.calledOnce(clientReceiver);
    assert.equal(clientReceiver.lastCall.firstArg.toString(), 'Ok');
  });

  it('Close', async () => {
    await new Promise((resolve) => {
      ws.on('close', resolve);
      testWSSocket.close();
    });
  });
});
