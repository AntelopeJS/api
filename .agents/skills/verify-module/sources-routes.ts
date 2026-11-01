export const ROUTES_SOURCE = String.raw`import { Controller, Delete, Get, HTTPResult, Parameter, PartialController, Post, Put, Route } from "@antelopejs/interface-api";

export class UsersController extends Controller("/users") {
  @Get()
  listUsers() {
    return { users: ["user1", "user2"] };
  }

  @Get("")
  root() {
    return { where: "root" };
  }

  @Get(":id")
  getUser(@Parameter("id") id: string) {
    return { id };
  }

  @Get(":userId/posts/:postId")
  getUserPost(@Parameter("userId") userId: string, @Parameter("postId") postId: string) {
    return { userId, postId };
  }

  @Post()
  createUser() {
    return new HTTPResult(201, { id: "new-user-id" });
  }

  @Put(":id")
  replaceUser(@Parameter("id") id: string) {
    return { replaced: id };
  }

  @Delete(":id")
  deleteUser() {
    return new HTTPResult(204);
  }

  @Get("/lead/:name")
  leading(@Parameter("name") name: string) {
    return { lead: name };
  }

  @Route("handler", "patch", ":id/nickname")
  patchNickname(@Parameter("id") id: string) {
    return { patched: id };
  }
}

export class OrdersController extends Controller("/orders") {
  @Get("")
  root() {
    return { where: "orders" };
  }

  @Get(":id")
  getOrder(@Parameter("id") id: string) {
    return { order: id };
  }

  @Post("submit/form")
  submit() {
    return { submitted: true };
  }
}

export class ApiController extends Controller("/api") {
  static readonly version = "v1";

  @Get("")
  root() {
    return { level: "api" };
  }
}

export class ApiUsersController extends ApiController.extend("users") {
  @Get("")
  list() {
    return { level: "api/users" };
  }
}

export class ApiUsersAdminController extends ApiUsersController.extend("admin") {
  @Get("")
  list() {
    return { level: "api/users/admin" };
  }
}

export class ReportsController extends Controller("/reports") {
  @Get()
  daily() {
    return { report: "daily" };
  }
}

export class ReportsAdminController extends PartialController(ReportsController) {
  @Get("admin")
  admin() {
    return { report: "admin" };
  }
}

class Greeter {
  greeting() {
    return "hi from the base class";
  }
}

export class TypedController extends Controller("/typed", Greeter) {
  @Get("")
  hello() {
    return { said: this.greeting() };
  }
}
`;
