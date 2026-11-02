export const INSTANCES_SOURCE = String.raw`import { Context, Controller, Get, GetControllerInstance, JSONBody, Parameter, PartialController, Post, RequestContext } from "@antelopejs/interface-api";

export const built: string[] = [];

export class UserController extends Controller("/users") {
  @Parameter("x-user", "header")
  private user!: string | undefined;

  private hits = 0;

  constructor() {
    super();
    built.push("user");
  }

  async fetchUser(id: string) {
    return { id, name: "Example User", viewer: this.user };
  }

  count() {
    this.hits += 1;
    return this.hits;
  }

  @Get("count")
  counter() {
    return { hits: this.count() };
  }
}

export class OrderController extends Controller("/orders") {
  @Get(":id")
  async getOrder(@Context() context: RequestContext, @Parameter("id") id: string) {
    const userCtrl = await GetControllerInstance(UserController, context);
    const user = await userCtrl.fetchUser("user-123");
    return { order: { id, user } };
  }

  @Get("twice/:id")
  async twice(@Context() context: RequestContext) {
    const first = await GetControllerInstance(UserController, context);
    const second = await GetControllerInstance(UserController, context);
    first.count();
    return { same: first === second, hits: second.count() };
  }
}

export class BodyHolder extends Controller("/holder") {
  @JSONBody()
  private payload!: unknown;

  read() {
    return this.payload;
  }
}

export class AsyncInstanceController extends Controller("/async") {
  @Post("twice")
  async twice(@Context() context: RequestContext) {
    const first = await GetControllerInstance(BodyHolder, context);
    const second = await GetControllerInstance(BodyHolder, context);
    return { same: first === second, payload: first.read() };
  }
}

export class ApiController extends Controller("/api") {
  @Get("")
  root() {
    return { level: "api" };
  }
}

export class ApiUsersController extends ApiController.extend("users") {
  describe() {
    return "api users";
  }
}

export class ApiUsersMore extends PartialController(ApiUsersController) {
  @Get("more")
  more() {
    return { more: true };
  }
}

export class ReachController extends Controller("/reach") {
  @Get("extended")
  async extended(@Context() context: RequestContext) {
    const instance = await GetControllerInstance(ApiUsersController, context);
    const partial = await GetControllerInstance(ApiUsersMore, context);
    return { extended: instance.describe(), partial: partial instanceof ApiUsersMore };
  }
}
`;
