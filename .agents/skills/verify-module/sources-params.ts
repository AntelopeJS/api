export const PARAMS_SOURCE = String.raw`import { BodyStream, Context, Controller, Get, JSONBody, MultiParameter, Parameter, Post, RawBody, RequestContext, Transform } from "@antelopejs/interface-api";

export class UsersController extends Controller("/users") {
  @Get(":id")
  getUser(@Parameter("id") id: string) {
    return { id, name: "Example User" };
  }

  @Get("")
  listUsers(@Parameter("page", "query") page: string | true | undefined) {
    return { page };
  }

  @Get(":userId/posts/:postId")
  getUserPost(@Parameter("userId") userId: string, @Parameter("postId") postId: string) {
    return { userId, postId };
  }

  @Get("explicit/:id")
  explicit(@Parameter("id", "param") id: string) {
    return { id };
  }
}

export class ProductsController extends Controller("/products") {
  @Get("search")
  searchProducts(@MultiParameter("tag") tags: string[]) {
    return { tags };
  }

  @Get("headers")
  headers(@MultiParameter("x-tag", "header") tags: string[], @Parameter("Authorization", "header") authorization: string | undefined, @Parameter("x-token", "header") token: string | undefined) {
    return { tags, authorization, token };
  }

  @Get("mixed/:id")
  mixed(@Parameter("id") id: string, @Parameter("lang", "query") lang: string | true | undefined, @Parameter("x-trace", "header") trace: string | undefined, @MultiParameter("tag", "query") tags: string[]) {
    return { id, lang, trace, tags };
  }
}

export class ConfigurableController extends Controller("/config") {
  @Parameter("apiKey", "header")
  private apiKey!: string;

  @MultiParameter("tags", "query")
  private tags!: string[];

  @Parameter("scope", "query")
  private scope!: string | true | undefined;

  @Get("")
  async getConfig() {
    return { authenticated: Boolean(this.apiKey), key: this.apiKey, appliedTags: this.tags, scope: this.scope };
  }
}

export class BodyPropertiesController extends Controller("/props") {
  @JSONBody()
  private json!: unknown;

  @RawBody()
  private raw!: Buffer;

  @Context()
  private context!: RequestContext;

  @Post("")
  async read() {
    return { json: this.json, rawBytes: this.raw.length, method: this.context.rawRequest.method, path: this.context.url.pathname };
  }
}

export class StreamPropertyController extends Controller("/props-stream") {
  @BodyStream()
  private chunks!: AsyncIterable<Uint8Array>;

  @Post("")
  async read() {
    let bytes = 0;
    for await (const chunk of this.chunks) bytes += chunk.byteLength;
    return { bytes };
  }
}

const double = (_context: RequestContext, value: unknown) => Number(value) * 2;

export class TransformPropertyController extends Controller("/props-transform") {
  @Parameter("n", "query")
  @Transform(double)
  private doubled!: number;

  @Get("")
  read() {
    return { doubled: this.doubled };
  }
}

export class BareController extends Controller("/bare") {
  @Post("json")
  // @ts-expect-error a bare decorator is not a valid parameter decorator, yet the skill says it compiles
  bare(@JSONBody body: unknown) {
    return { injected: body !== undefined };
  }
}

export class LastProviderController extends Controller("/last") {
  @Post("param-last")
  paramLast(@Parameter("a", "query") @JSONBody() value: unknown) {
    return { value: value ?? null };
  }

  @Post("body-last")
  bodyLast(@JSONBody() @Parameter("a", "query") value: unknown) {
    return { value: value ?? null };
  }
}
`;
