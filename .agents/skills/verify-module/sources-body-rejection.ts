export const REJECTION_SOURCE = String.raw`import { Controller, Get, HTTPResult, JSONBody, Post, SetParameterProvider } from "@antelopejs/interface-api";
import { MakeParameterDecorator } from "@antelopejs/interface-core/decorators";
import { RateLimit } from "@antelopejs/interface-api-util";

export const ran: string[] = [];

const Refuse = MakeParameterDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, () => {
    throw new Error("later parameter refused");
  }),
);

const Throttle = MakeParameterDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, () => {
    throw new HTTPResult(429, "slow down");
  }),
);

const Note = MakeParameterDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, () => {
    ran.push("parameter after the throw");
    return true;
  }),
);

export class OversizedController extends Controller("/oversized") {
  @Post("throws")
  throws(@JSONBody() body: unknown, @Refuse() later: string, @Note() after: boolean) {
    ran.push("throws handler");
    return { body, later, after };
  }

  @Post("throttled")
  throttled(@JSONBody() body: unknown, @Throttle() later: string) {
    ran.push("throttled handler");
    return { body, later };
  }

  @Post("limited")
  @RateLimit(2, 60_000)
  limited(@JSONBody() body: unknown) {
    ran.push("limited handler");
    return { accepted: body === undefined ? "nothing" : "something" };
  }

  @Get("ping")
  ping() {
    return { ok: true };
  }
}
`;
