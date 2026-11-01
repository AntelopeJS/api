export const UTIL_SOURCE = String.raw`import { Context, Controller, Delete, Get, HTTPResult, JSONBody, Parameter, Post, RawBody, RequestContext } from "@antelopejs/interface-api";
import { RateLimit, assert, assertValidation } from "@antelopejs/interface-api-util";

function parseJsonObject(body: Buffer): Record<string, string> {
  const parsed: unknown = JSON.parse(body.toString());
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Expected a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

export class GreetingController extends Controller("/greet") {
  @Get("")
  greet(@Parameter("name", "query") name: string | true | undefined) {
    assert(typeof name === "string" && name.trim().length > 0, 400, "Name is required");
    return { message: "Hello, " + name + "!" };
  }

  @Get("truthy/:value")
  truthy(@Parameter("value") value: string) {
    const table: Record<string, unknown> = { zero: 0, empty: "", nil: null, none: undefined, nan: NaN, no: false, text0: "0", list: [], object: {}, one: 1 };
    assert(table[value], 418, "falsy " + value);
    return { passed: value };
  }
}

export class PostsController extends Controller("/posts") {
  @Delete(":id")
  deletePost(@Parameter("id") id: string, @Parameter("x-user", "header") currentUserId: string | undefined) {
    const post = id === "p1" ? { id: "p1", authorId: "u1" } : undefined;
    assert(post, 404, "Post not found");
    assert(post.authorId === currentUserId, 403, "Not authorized to delete this post");
    return new HTTPResult(200, { deleted: true });
  }
}

export class ImportController extends Controller("import") {
  @Post("")
  create(@RawBody() body: Buffer) {
    return assertValidation(body, parseJsonObject);
  }

  @Post("custom")
  custom(@JSONBody() body: unknown) {
    return assertValidation(
      body,
      (value: unknown) => {
        const age = typeof value === "object" && value !== null && "age" in value ? Number(value.age) : NaN;
        if (!(age >= 18)) throw new Error("age must be at least 18");
        return { age };
      },
      (err) => ({ errors: [String(err instanceof Error ? err.message : err)] }),
      422,
    );
  }

  @Post("coded")
  coded(@RawBody() body: Buffer) {
    return assertValidation(body, parseJsonObject, undefined, 409);
  }

  @Post("late")
  late(@RawBody() body: Buffer) {
    return assertValidation(body, async () => {
      throw new Error("rejected late");
    });
  }
}

export const limitedRuns: string[] = [];

export class LimitedController extends Controller("/limited") {
  @Get("")
  @RateLimit(3, 1500)
  list(@Context() context: RequestContext) {
    limitedRuns.push("list");
    context.response.setBody({ users: [] });
    return context.response;
  }

  @Get("other")
  @RateLimit(5, 60_000)
  other() {
    return { other: true };
  }

  @Get("keyed")
  @RateLimit(2, 60_000, { key: (context) => context.url.searchParams.get("who"), message: "Too many from you" })
  keyed() {
    return { keyed: true };
  }
}

export class AuthController extends Controller("auth") {
  @Post(":tenant/login")
  @RateLimit(2, 60_000, { key: (ctx) => ctx.routeParameters.tenant, message: "Too many login attempts, slow down" })
  login() {
    return new HTTPResult(200, { ok: true });
  }
}
`;

export const MISPLACED_RATE_LIMIT_SOURCE = String.raw`import { Controller, Get } from "@antelopejs/interface-api";
import { RateLimit } from "@antelopejs/interface-api-util";

export class MisplacedController extends Controller("/misplaced") {
  @RateLimit(1, 1000)
  @Get("")
  list() {
    return { users: [] };
  }
}
`;
