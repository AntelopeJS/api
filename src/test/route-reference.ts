/** One segment of a route location: a literal, a `:name` parameter filling a whole segment, or a trailing `::name` catch-all. */
export type Segment =
  | { readonly kind: "static"; readonly text: string }
  | { readonly kind: "param"; readonly name: string }
  | { readonly kind: "rest"; readonly name: string };

/** The kinds of handler the route table keeps apart. */
export type Mode = "handler" | "prefix" | "postfix" | "monitor" | "websocket";

/** A handler as the reference router answers it: its id and the parameters of the match, sorted by name. */
export interface Match {
  readonly id: string;
  readonly parameters: readonly (readonly [string, string])[];
}

interface Node {
  readonly handlers: string[];
  readonly statics: Map<string, Node>;
  readonly params: Map<string, Node>;
  readonly rests: Map<string, Node>;
}

interface Placement {
  readonly mode: Mode;
  readonly method: string;
  readonly node: Node;
}

const ANY = "any";

function newNode(): Node {
  return {
    handlers: [],
    statics: new Map(),
    params: new Map(),
    rests: new Map(),
  };
}

function child(table: Map<string, Node>, key: string): Node {
  let node = table.get(key);
  if (!node) {
    node = newNode();
    table.set(key, node);
  }
  return node;
}

function sorted(parameters: ReadonlyMap<string, string>): Match["parameters"] {
  return [...parameters].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function withParameter(
  parameters: ReadonlyMap<string, string>,
  name: string,
  value: string,
): Map<string, string> {
  return new Map(parameters).set(name, value);
}

/**
 * A router that keeps every lookup table in a `Map`, so no segment, method or
 * parameter name can collide with an `Object.prototype` key. The semantics are
 * the documented ones: a method is lower-cased and `*`, empty or absent means
 * `any`; a static segment beats a parameter, which beats a catch-all; the first
 * handler registered at a location answers a `handler` or `websocket` lookup;
 * `prefix`, `postfix` and `monitor` lookups collect every handler along every
 * matching branch, in depth-first order.
 */
export class ReferenceRouter {
  private readonly tables = new Map<Mode, Map<string, Node>>();
  private readonly placements = new Map<string, Placement>();

  private table(mode: Mode): Map<string, Node> {
    let table = this.tables.get(mode);
    if (!table) {
      table = new Map();
      this.tables.set(mode, table);
    }
    return table;
  }

  register(
    id: string,
    mode: Mode,
    method: string | undefined,
    segments: readonly Segment[],
  ): void {
    const key = method?.toLowerCase();
    const methodName = !key || key === "*" ? ANY : key;
    let node = child(this.table(mode), methodName);
    for (const segment of segments) {
      node =
        segment.kind === "static"
          ? child(node.statics, segment.text)
          : segment.kind === "param"
            ? child(node.params, segment.name)
            : child(node.rests, segment.name);
    }
    node.handlers.push(id);
    this.placements.set(id, { mode, method: methodName, node });
  }

  unregister(id: string): void {
    const placement = this.placements.get(id);
    if (!placement) {
      return;
    }
    placement.node.handlers.splice(placement.node.handlers.indexOf(id), 1);
    this.placements.delete(id);
  }

  has(mode: Mode): boolean {
    return [...this.placements.values()].some(
      (placement) => placement.mode === mode,
    );
  }

  /** The handler a request answers: the lookup under its own method, then under `any`. */
  find(mode: Mode, method: string, path: readonly string[]): Match | undefined {
    const table = this.table(mode);
    for (const name of [method, ANY]) {
      const root = table.get(name);
      const found = root && this.walk(root, path, 0, new Map());
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /** Every handler of `mode` along the matching branches under each of `methods`, then under `any`. */
  collect(mode: Mode, methods: readonly string[], path: readonly string[]) {
    const table = this.table(mode);
    const matches: Match[] = [];
    for (const name of [...methods, ANY]) {
      const root = table.get(name);
      if (root) {
        this.gather(root, path, 0, new Map(), matches);
      }
    }
    return matches;
  }

  private walk(
    node: Node,
    path: readonly string[],
    depth: number,
    parameters: ReadonlyMap<string, string>,
  ): Match | undefined {
    if (depth >= path.length) {
      const [id] = node.handlers;
      return id === undefined
        ? undefined
        : { id, parameters: sorted(parameters) };
    }
    const segment = path[depth];
    const literal = node.statics.get(segment);
    const viaLiteral =
      literal && this.walk(literal, path, depth + 1, parameters);
    if (viaLiteral) {
      return viaLiteral;
    }
    for (const [name, next] of node.params) {
      const found = this.walk(
        next,
        path,
        depth + 1,
        withParameter(parameters, name, segment),
      );
      if (found) {
        return found;
      }
    }
    for (const [name, next] of node.rests) {
      const found = this.walk(
        next,
        path,
        path.length,
        withParameter(parameters, name, path.slice(depth).join("/")),
      );
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private gather(
    node: Node,
    path: readonly string[],
    depth: number,
    parameters: ReadonlyMap<string, string>,
    matches: Match[],
  ): void {
    for (const id of node.handlers) {
      matches.push({ id, parameters: sorted(parameters) });
    }
    if (depth >= path.length) {
      return;
    }
    const segment = path[depth];
    const literal = node.statics.get(segment);
    if (literal) {
      this.gather(literal, path, depth + 1, parameters, matches);
    }
    for (const [name, next] of node.params) {
      this.gather(
        next,
        path,
        depth + 1,
        withParameter(parameters, name, segment),
        matches,
      );
    }
    for (const [name, next] of node.rests) {
      this.gather(
        next,
        path,
        path.length,
        withParameter(parameters, name, path.slice(depth).join("/")),
        matches,
      );
    }
  }
}
