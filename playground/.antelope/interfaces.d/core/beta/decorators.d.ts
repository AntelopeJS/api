export declare type Func<A extends any[] = any[], R = any> = (...args: A) => R;
export declare type Class<T = any, A extends any[] = any[]> = {
  new (...args: A): T;
};
export declare type ClassDecorator<C = Class> = (t: C) => any;
export declare type PropertyDecorator = (t: any, key: PropertyKey) => void;
export declare type MethodDecorator = (t: any, key: PropertyKey, descriptor: PropertyDescriptor) => void;
export declare type ParameterDecorator = (t: any, key: PropertyKey, index: number) => void;
declare type MergeArray<A extends any[], B extends any[]> = A extends [infer P, ...infer PR]
  ? B extends [infer Q, ...infer QR]
    ? [P | Q, ...MergeArray<PR, QR>]
    : [P | undefined, ...MergeArray<PR, []>]
  : B extends [infer Q, ...infer QR]
    ? [Q | undefined, ...MergeArray<[], QR>]
    : [];
declare type UnwrapFunctions<T extends Func[]> = T extends [infer F]
  ? Parameters<F extends Func ? F : never>
  : T extends [infer F1, ...infer F2]
    ? MergeArray<Parameters<F1 extends Func ? F1 : never>, UnwrapFunctions<F2 extends Func[] ? F2 : never>>
    : [];
declare type Function1<T extends Func[], A extends any[], R = void, AR extends any[] = UnwrapFunctions<T>> = (
  a1: AR[0],
  ...args: A
) => R;
declare type Function2<T extends Func[], A extends any[], R = void, AR extends any[] = UnwrapFunctions<T>> = (
  a1: AR[0],
  a2: AR[1],
  ...args: A
) => R;
declare type Function3<T extends Func[], A extends any[], R = void, AR extends any[] = UnwrapFunctions<T>> = (
  a1: AR[0],
  a2: AR[1],
  a3: AR[2],
  ...args: A
) => R;
export declare function MakeClassDecorator<T extends any[]>(
  handler: Function1<[ClassDecorator], T, any>,
): (...args: T) => ClassDecorator<Class<any, any[]>>;
export declare function MakePropertyDecorator<T extends any[]>(
  handler: Function2<[PropertyDecorator], T, void>,
): (...args: T) => PropertyDecorator;
export declare function MakePropertyAndClassDecorator<T extends any[]>(
  handler: Function2<[PropertyDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator;
export declare function MakeMethodDecorator<T extends any[]>(
  handler: Function3<[MethodDecorator], T, void>,
): (...args: T) => MethodDecorator;
export declare function MakeMethodAndClassDecorator<T extends any[]>(
  handler: Function3<[MethodDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & MethodDecorator;
export declare function MakeMethodAndPropertyDecorator<T extends any[]>(
  handler: Function3<[MethodDecorator, PropertyDecorator], T, void>,
): (...args: T) => PropertyDecorator & MethodDecorator;
export declare function MakeMethodAndPropertyAndClassDecorator<T extends any[]>(
  handler: Function3<[MethodDecorator, PropertyDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator & MethodDecorator;
export declare function MakeParameterDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator], T, void>,
): (...args: T) => ParameterDecorator;
export declare function MakeParameterAndClassDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & ParameterDecorator;
export declare function MakeParameterAndPropertyDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, PropertyDecorator], T, void>,
): (...args: T) => PropertyDecorator & ParameterDecorator;
export declare function MakeParameterAndPropertyAndClassDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, PropertyDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator & ParameterDecorator;
export declare function MakeParameterAndMethodDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, MethodDecorator], T, void>,
): (...args: T) => MethodDecorator & ParameterDecorator;
export declare function MakeParameterAndMethodAndClassDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, MethodDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & MethodDecorator & ParameterDecorator;
export declare function MakeParameterAndMethodAndPropertyDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, MethodDecorator, PropertyDecorator], T, void>,
): (...args: T) => PropertyDecorator & MethodDecorator & ParameterDecorator;
export declare function MakeParameterAndMethodAndPropertyAndClassDecorator<T extends any[]>(
  handler: Function3<[ParameterDecorator, MethodDecorator, PropertyDecorator, ClassDecorator], T, any | undefined>,
): (...args: T) => ClassDecorator<Class<any, any[]>> & PropertyDecorator & MethodDecorator & ParameterDecorator;
export {};
