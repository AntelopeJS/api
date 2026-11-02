export const PARAMS_SOURCE = String.raw`import { Context, Controller, Get, JSONBody, MultiParameter, Parameter, Post, RawBody, RequestContext } from "@antelopejs/interface-api";

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
`;
