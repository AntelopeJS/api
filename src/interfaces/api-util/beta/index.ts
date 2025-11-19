import { HTTPResult } from '@ajs/api/beta';

/**
 * Assert a condition is truthy, throwing an HTTPResult error if false.
 *
 * This utility function can be used in API handlers to validate conditions
 * and return appropriate HTTP error responses when validations fail.
 *
 * @param condition The condition to assert (truthy values pass, falsy values throw)
 * @param code HTTP status code to use for the error response (e.g., 400, 404, 500)
 * @param message Error message to include in the response body
 * @throws {HTTPResult} Throws an HTTPResult with the specified code and message if condition is falsy
 *
 * Example:
 * ```ts
 * @Get('users/:id')
 * async getUser(@Parameter('id') id: string) {
 *   const user = await findUser(id);
 *   assert(user, 404, "User not found");
 *
 *   return new HTTPResult(200, user);
 * }
 * ```
 */
export function assert<T>(condition: T, code: number, message: string): asserts condition {
  if (!condition) {
    throw new HTTPResult(code, message);
  }
}

/**
 * Executes the given validator function on a body, throwing an HTTPResult error if it fails.
 * The validator should return a validated object on success and throw on failure.
 *
 * The error thrown by the validator may be altered by passing an error handler.
 * The result of this error handler will be passed directly as the body of the HTTPResult.
 * If no error handler is given, assertValidation will resort to calling the error's toString() method if possible.
 *
 * @param body Input to validate
 * @param validator Validator function
 * @param errorFunc Error handler
 * @param code Error code on failure
 * @returns Validated body
 * @throws {HTTPResult} Throws an HTTPResult with the specified code and message on failure
 *
 * Example:
 * ```ts
 * import * as z from 'zod';
 *
 * const schema = z.object({ name: z.string() })
 *
 * const { name } = assertValidation(requestBody, schema.parse);
 * ```
 */
export function assertValidation<T>(
  body: unknown,
  validator: (body: unknown) => T,
  errorFunc?: (err: any) => unknown,
  code = 400,
): T {
  try {
    return validator(body);
  } catch (e: any) {
    const errObj = errorFunc ? errorFunc(e) : 'toString' in e ? e.toString() : String(e);
    throw new HTTPResult(code, errObj);
  }
}
