export const MODIFIERS_SOURCE = String.raw`import { AddParameterModifier, Context, Controller, Get, HTTPResult, Parameter, type ParameterModifier, type ParameterProvider, Post, ReadBody, RequestContext, SetParameterProvider, Transform } from "@antelopejs/interface-api";
import { MakeParameterDecorator } from "@antelopejs/interface-core/decorators";

export const ran: string[] = [];

const EnsureNumber = MakeParameterDecorator((target, key, param) =>
  AddParameterModifier(target, key, param, (context: RequestContext, value: unknown) => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }),
);

const Suffix = (label: string) =>
  MakeParameterDecorator((target, key, param) =>
    AddParameterModifier(target, key, param, (_context: RequestContext, value: unknown) => String(value) + label),
  )();

const Later = (label: string) =>
  MakeParameterDecorator((target, key, param) =>
    AddParameterModifier(target, key, param, async (_context: RequestContext, value: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return String(value) + label;
    }),
  )();

const Refuse = MakeParameterDecorator((target, key, param) =>
  AddParameterModifier(target, key, param, (_context: RequestContext, value: unknown) => {
    ran.push("refuse:" + String(value));
    throw new Error("the modifier refused " + String(value));
  }),
);

const Seen = MakeParameterDecorator((target, key, param) =>
  AddParameterModifier(target, key, param, (_context: RequestContext, value: unknown) => {
    ran.push("seen:" + String(value));
    return value;
  }),
);

const authorization: ParameterProvider<string | undefined> = (context) => context.rawRequest.headers.authorization;

const bearerToken: ParameterModifier<string | undefined> = (_context, header) => (typeof header === "string" ? header.replace(/^Bearer /, "") : undefined);

const BearerToken = MakeParameterDecorator((target, key, param) => {
  SetParameterProvider(target, key, param, authorization);
  AddParameterModifier(target, key, param, bearerToken);
});

const BodyText = MakeParameterDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, async (context: RequestContext) => (await ReadBody(context)).toString("utf8")),
);

const UrlPath = MakeParameterDecorator((target, key, param) => SetParameterProvider(target, key, param, (context: RequestContext) => context.url.pathname));

function parseId(_context: RequestContext, value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new HTTPResult(400, "Expected a positive integer ID");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new HTTPResult(400, "ID is too large");
  }
  return id;
}

export class ExampleController extends Controller("/example") {
  @Get(":id")
  async getExample(@Parameter("id") @EnsureNumber() id: number) {
    return { id, doubled: id * 2 };
  }
}

export class ChainController extends Controller("/chain") {
  @Get("order/:v")
  order(@Parameter("v") @Suffix("-top") @Suffix("-middle") @Suffix("-bottom") v: string) {
    return { v };
  }

  @Get("async/:v")
  async later(@Parameter("v") @Later("-first") @Suffix("-second") @Later("-third") v: string) {
    return { v };
  }

  @Get("refused/:v")
  refused(@Parameter("v") @Seen() @Refuse() @Seen() v: string) {
    ran.push("handler");
    return { v };
  }
}

export class ItemController extends Controller("/items") {
  @Get(":id")
  getItem(@Parameter("id") @Transform(parseId) id: number) {
    return { id, type: typeof id };
  }
}

export class ProviderController extends Controller("/providers") {
  @Get("bearer")
  bearer(@BearerToken() token: string | undefined) {
    return { token };
  }

  @Get("path")
  path(@UrlPath() urlPath: string) {
    return { urlPath };
  }

  @Get("combined/:name")
  combined(@Parameter("name") name: string, @BearerToken() token: string | undefined, @Context() ctx: RequestContext) {
    return { name, token, method: ctx.rawRequest.method };
  }

  @Post("body")
  bodyText(@BodyText() text: string, @BodyText() again: string) {
    return { text, again };
  }
}
`;
