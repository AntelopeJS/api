export const MODES_SOURCE = String.raw`import { Controller, Delete, Get, HTTPResult, Post, Put, Result } from "@antelopejs/interface-api";

export const log: string[] = [];

export class ModeController extends Controller("/modes") {
  @Get("data", "prefix")
  refuseGet() {
    return new HTTPResult(403, "get refused");
  }

  @Get("data")
  getData() {
    log.push("get");
    return { main: "get" };
  }

  @Post("data", "prefix")
  refusePost() {
    return new HTTPResult(409, "post refused");
  }

  @Post("data")
  postData() {
    log.push("post");
    return { main: "post" };
  }

  @Put("data", "prefix")
  refusePut() {
    return new HTTPResult(422, "put refused");
  }

  @Put("data")
  putData() {
    log.push("put");
    return { main: "put" };
  }

  @Delete("data", "prefix")
  refuseDelete() {
    return new HTTPResult(410, "delete refused");
  }

  @Delete("data")
  deleteData() {
    log.push("delete");
    return { main: "delete" };
  }

  @Post("order")
  postOrder() {
    log.push("post-main");
    return new HTTPResult(201, { main: "post" });
  }

  @Post("order", "prefix")
  postOrderPrefix() {
    log.push("post-prefix");
  }

  @Put("order")
  putOrder() {
    log.push("put-main");
    return { main: "put" };
  }

  @Put("order", "prefix")
  putOrderPrefix() {
    log.push("put-prefix");
  }

  @Delete("order")
  deleteOrder() {
    log.push("delete-main");
    return { main: "delete" };
  }

  @Delete("order", "prefix")
  deleteOrderPrefix() {
    log.push("delete-prefix");
  }

  @Get("stamped")
  getStamped() {
    return { main: "stamped" };
  }

  @Get("stamped", "postfix")
  stamp(@Result() result: HTTPResult) {
    result.addHeader("X-Mode", "postfix");
  }

  @Get("watched")
  getWatched() {
    return { main: "watched" };
  }

  @Get("watched", "monitor")
  watch() {
    log.push("monitor");
  }
}
`;

export const ASYNC_SOURCE = String.raw`import { Context, Controller, Get, HTTPResult, HandlerPriority, Monitor, Postfix, Prefix, RequestContext, Result } from "@antelopejs/interface-api";

export const log: string[] = [];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AsyncController extends Controller("/a") {
  @Get("refuse")
  refuseMain() {
    log.push("main-refuse");
    return { main: "refuse" };
  }

  @Prefix("get", "refuse")
  async refuse() {
    await pause(5);
    return new HTTPResult(403, "async refused");
  }

  @Get("throw")
  throwMain() {
    log.push("main-throw");
    return { main: "throw" };
  }

  @Prefix("get", "throw")
  async refuseByThrowing() {
    await pause(5);
    throw new HTTPResult(401, "async thrown");
  }

  @Get("pass")
  passMain() {
    log.push("main-pass");
    return { main: "pass" };
  }

  @Prefix("get", "pass", HandlerPriority.HIGHEST)
  async passFirst() {
    await pause(5);
    log.push("pass-1");
  }

  @Prefix("get", "pass", HandlerPriority.LOWEST)
  async passSecond() {
    await pause(1);
    log.push("pass-2");
  }

  @Get("late")
  async late() {
    await pause(5);
    return { late: true };
  }

  @Postfix("get", "late")
  stampLate(@Result() result: HTTPResult) {
    result.addHeader("X-Post", "1");
  }

  @Get("post")
  postMain() {
    return { main: "post" };
  }

  @Postfix("get", "post", HandlerPriority.HIGH)
  async postHigh() {
    await pause(5);
    return new HTTPResult(201, "p1");
  }

  @Postfix("get", "post", HandlerPriority.LOW)
  postLow(@Result() result: HTTPResult) {
    log.push("post-low");
    result.addHeader("X-Low", "ran");
  }

  @Get("quiet")
  quietMain() {
    return { main: "quiet" };
  }

  @Postfix("get", "quiet", HandlerPriority.HIGH)
  async quietHigh(@Result() result: HTTPResult) {
    await pause(5);
    result.addHeader("X-High", "ran");
  }

  @Postfix("get", "quiet", HandlerPriority.LOW)
  quietLow(@Result() result: HTTPResult) {
    result.addHeader("X-Low", "ran");
  }

  @Get("mon")
  monMain() {
    return { ok: true };
  }

  @Monitor("get", "mon", HandlerPriority.HIGHEST)
  async monFirst() {
    await pause(5);
    log.push("mon-1");
    throw new Error("an async monitor failed");
  }

  @Monitor("get", "mon", HandlerPriority.NORMAL)
  async monSecond() {
    await pause(5);
    log.push("mon-2");
  }

  @Monitor("get", "mon", HandlerPriority.LOWEST)
  monLast() {
    log.push("mon-3");
  }

  @Get("fail")
  async fail() {
    await pause(5);
    throw new Error("async main failed");
  }

  @Monitor("get", "fail")
  async watchFail(@Context() ctx: RequestContext) {
    await pause(5);
    log.push("fail:" + ctx.response.getStatus() + ":" + String(ctx.error));
  }
}
`;

export const MATRIX_SOURCE = String.raw`import { Context, Controller, Get, HTTPResult, HandlerPriority, Monitor, Postfix, Prefix, RequestContext } from "@antelopejs/interface-api";

export const log: string[] = [];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MatrixController extends Controller("/mx") {
  @Get("r")
  returning() {
    return { main: "r" };
  }

  @Monitor("get", "r", HandlerPriority.HIGHEST)
  monitorReturns() {
    log.push("a");
    return new HTTPResult(418, "ignored");
  }

  @Monitor("get", "r", HandlerPriority.NORMAL)
  async monitorResolves() {
    await pause(5);
    log.push("b");
    return "ignored";
  }

  @Monitor("get", "r", HandlerPriority.LOWEST)
  monitorLast() {
    log.push("c");
  }

  @Monitor("any", "r")
  monitorAnyMethod() {
    log.push("any");
  }

  @Get("guarded")
  guarded() {
    return { main: "guarded" };
  }

  @Prefix("get", "guarded")
  check() {
    log.push("check");
  }

  @Prefix("options", "guarded")
  checkPreflight() {
    log.push("check-options");
  }

  @Get("refuse")
  refuse() {
    return { main: "refuse" };
  }

  @Prefix("get", "refuse", HandlerPriority.HIGH)
  deny() {
    return new HTTPResult(401, "no token");
  }

  @Get("p")
  postfixed() {
    return { main: "p" };
  }

  @Postfix("get", "p")
  postfixThrows() {
    throw new HTTPResult(409, "postfix refused");
  }

  @Monitor("get", "p")
  watchP(@Context() ctx: RequestContext) {
    log.push("p:" + ctx.response.getStatus() + ":" + String(ctx.error instanceof HTTPResult));
  }

  @Get("pa")
  postfixedAsync() {
    return { main: "pa" };
  }

  @Postfix("get", "pa")
  async postfixRejects() {
    await pause(5);
    throw new Error("x");
  }

  @Monitor("get", "pa")
  watchPa(@Context() ctx: RequestContext) {
    log.push("pa:" + ctx.response.getStatus() + ":" + String(ctx.error));
  }
}
`;
