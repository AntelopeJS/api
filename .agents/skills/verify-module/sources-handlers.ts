export const HANDLERS_SOURCE = String.raw`import { Context, Controller, Get, HTTPResult, HandlerPriority, Monitor, Parameter, Postfix, Prefix, RequestContext, Result } from "@antelopejs/interface-api";

export const log: string[] = [];

export class UsersController extends Controller("/users") {
  @Prefix("get", ":id")
  validateUserExists(@Parameter("id") id: string) {
    if (id === "missing") {
      return new HTTPResult(404, { error: "User not found" });
    }
  }

  @Get(":id")
  getUser(@Parameter("id") id: string) {
    return { id, name: "Sample User" };
  }

  @Postfix("get", ":id")
  logUserAccess(@Result() result: HTTPResult) {
    result.addHeader("X-Accessed-At", "postfix");
  }

  @Monitor("get", ":id")
  logRequest(@Context() ctx: RequestContext, @Parameter("id") id: string) {
    log.push(ctx.response.getStatus() + ":" + (ctx.error ? String(ctx.error) : "ok") + ":" + id);
    return new HTTPResult(418, "ignored");
  }

}

export class FailingController extends Controller("/failing") {
  @Get(":n")
  boom(@Parameter("n") n: string) {
    throw new Error("boom " + n);
  }

  @Monitor("get", ":n")
  logFailure(@Context() ctx: RequestContext) {
    log.push(ctx.response.getStatus() + ":" + String(ctx.error));
  }
}

export class SecuredController extends Controller("/api") {
  @Prefix("get", "data", HandlerPriority.LOWEST)
  last() {
    log.push("lowest");
  }

  @Prefix("get", "data", HandlerPriority.HIGH)
  checkAuthorization(@Parameter("x-role", "header") role: string | undefined) {
    log.push("high");
    if (role === "guest") {
      return new HTTPResult(403, { error: "Forbidden" });
    }
  }

  @Prefix("get", "data", HandlerPriority.HIGHEST)
  checkAuthentication(@Parameter("x-token", "header") token: string | undefined) {
    log.push("highest");
    if (token === undefined) {
      return new HTTPResult(401, { error: "Unauthorized" });
    }
  }

  @Prefix("get", "data", HandlerPriority.NORMAL)
  normal() {
    log.push("normal");
  }

  @Prefix("get", "data", HandlerPriority.LOW)
  low() {
    log.push("low");
  }

  @Get("data")
  data() {
    log.push("main");
    return { data: 1 };
  }
}

export class ChainController extends Controller("/chain") {
  @Get("stop")
  stopMain() {
    return { main: "stop" };
  }

  @Postfix("get", "stop", HandlerPriority.LOWEST)
  stopThird(@Result() result: HTTPResult) {
    result.addHeader("X-Third", "yes");
  }

  @Postfix("get", "stop", HandlerPriority.NORMAL)
  stopSecond(@Result() result: HTTPResult) {
    result.addHeader("X-Second", "yes");
    return new HTTPResult(202, { replaced: true });
  }

  @Postfix("get", "stop", HandlerPriority.HIGHEST)
  stopFirst(@Result() result: HTTPResult) {
    result.addHeader("X-First", "yes");
  }

  @Get("all")
  allMain() {
    return { main: "all" };
  }

  @Postfix("get", "all", HandlerPriority.LOWEST)
  allThird(@Result() result: HTTPResult) {
    result.addHeader("X-Third", "yes");
  }

  @Postfix("get", "all", HandlerPriority.NORMAL)
  allSecond(@Result() result: HTTPResult) {
    result.addHeader("X-Second", "yes");
  }

  @Postfix("get", "all", HandlerPriority.HIGHEST)
  allFirst(@Result() result: HTTPResult) {
    result.addHeader("X-First", "yes");
  }

  @Get("monitored")
  monitored() {
    return { ok: true };
  }

  @Monitor("get", "monitored", HandlerPriority.HIGHEST)
  failing() {
    log.push("monitor-1");
    throw new Error("a failing monitor");
  }

  @Monitor("get", "monitored", HandlerPriority.LOWEST)
  afterFailing() {
    log.push("monitor-2");
  }
}
`;
