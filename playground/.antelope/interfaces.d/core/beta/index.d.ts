import 'reflect-metadata';
import { Class } from './decorators';
declare type Func<A extends any[] = any[], R = any> = (...args: A) => R;
export declare class AsyncProxy<T extends Func = Func, R = Awaited<ReturnType<T>>> {
  private callback?;
  private queue;
  onCall(callback: T, manualDetach?: boolean): void;
  detach(): void;
  call(...args: Parameters<T>): Promise<R>;
}
declare type RegisterFunction = (id: any, ...args: any[]) => void;
declare type RID<T> = T extends (id: infer P, ...args: any[]) => void ? P : never;
declare type RArgs<T> = T extends (id: any, ...args: infer P) => void ? P : never;
export declare class RegisteringProxy<T extends RegisterFunction = RegisterFunction> {
  private registerCallback?;
  private unregisterCallback?;
  private registered;
  onRegister(callback: T, manualDetach?: boolean): void;
  onUnregister(callback: (id: RID<T>) => void): void;
  detach(): void;
  register(id: RID<T>, ...args: RArgs<T>): void;
  unregister(id: RID<T>): void;
}
declare type EventFunction = (...args: any[]) => void;
export declare class EventProxy<T extends EventFunction = EventFunction> {
  private registered;
  constructor();
  emit(...args: Parameters<T>): void;
  register(func: T): void;
  unregister(fn: T): void;
}
export declare namespace events {
  const moduleConstructed: EventProxy<(module: string) => void>;
  const moduleDestroyed: EventProxy<(module: string) => void>;
}
export declare function GetResponsibleModule(ignoreInterfaces?: boolean, startFrame?: number): string | undefined;
export declare function GetMetadata<T extends Record<string, any>, U extends Record<string, any>>(
  target: U,
  meta: Class<T, [U]> & {
    key: symbol;
  },
  inherit?: boolean,
): T;
export declare function InterfaceFunction<T extends Func = Func, R = Awaited<ReturnType<T>>>(): (
  ...args: Parameters<T>
) => Promise<R>;
declare type InterfaceImplType<T> =
  T extends RegisteringProxy<infer P>
    ? {
        register: P;
        unregister: (id: RID<P>) => void;
      }
    : T extends EventProxy
      ? never
      : T extends (...args: any[]) => any
        ? T
        : T extends Record<string, any>
          ? InterfaceToImpl<T>
          : never;
declare type InterfaceToImpl<T> = T extends infer P
  ? {
      [K in keyof P]?: InterfaceImplType<P[K]>;
    }
  : never;
export declare function ImplementInterface<T, T2 = InterfaceToImpl<Awaited<T>>>(
  declaration: T,
  implementation: T2 | Promise<T2>,
): Promise<{
  declaration: Awaited<T>;
  implementation: T2;
}>;
export {};
