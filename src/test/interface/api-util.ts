import nodeAssert from 'assert';
import { HTTPResult } from '@ajs/api/beta';
import { assert as assertCondition, assertValidation } from '@ajs/api-util/beta';

interface ValidatedPayload {
  name: string;
  active: boolean;
}

interface ValidationErrorPayload {
  code: string;
  detail: string;
}

const BAD_REQUEST_CODE = 400;
const UNPROCESSABLE_ENTITY_CODE = 422;
const ASSERTION_ERROR_MESSAGE = 'Missing payload';
const VALIDATION_ERROR_MESSAGE = 'Invalid payload';
const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';

function toHTTPResult(error: unknown): HTTPResult {
  if (!(error instanceof HTTPResult)) {
    throw new Error('Expected an HTTPResult error');
  }

  return error;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePayload(value: unknown): ValidatedPayload {
  if (!isObjectRecord(value)) {
    throw new Error(VALIDATION_ERROR_MESSAGE);
  }

  const nameValue = value.name;
  const activeValue = value.active;

  if (typeof nameValue !== 'string' || typeof activeValue !== 'boolean') {
    throw new Error(VALIDATION_ERROR_MESSAGE);
  }

  return {
    name: nameValue,
    active: activeValue,
  };
}

function mapValidationError(): ValidationErrorPayload {
  return {
    code: VALIDATION_ERROR_CODE,
    detail: VALIDATION_ERROR_MESSAGE,
  };
}

describe('API Util Interface', () => {
  describe('assert', () => {
    it('returns when the condition is truthy', () => {
      nodeAssert.doesNotThrow(() => assertCondition(true, BAD_REQUEST_CODE, ASSERTION_ERROR_MESSAGE));
    });

    it('throws HTTPResult when the condition is falsy', () => {
      let thrownError: unknown;

      try {
        assertCondition(false, BAD_REQUEST_CODE, ASSERTION_ERROR_MESSAGE);
      } catch (error: unknown) {
        thrownError = error;
      }

      const httpError = toHTTPResult(thrownError);
      nodeAssert.equal(httpError.getStatus(), BAD_REQUEST_CODE);
      nodeAssert.equal(httpError.getBody(), ASSERTION_ERROR_MESSAGE);
    });
  });

  describe('assertValidation', () => {
    it('returns parsed payload when validation succeeds', () => {
      const payload = assertValidation(
        {
          name: 'antelope',
          active: true,
        },
        parsePayload,
      );

      nodeAssert.equal(payload.name, 'antelope');
      nodeAssert.equal(payload.active, true);
    });

    it('throws HTTPResult with default code and serialized error message', () => {
      let thrownError: unknown;

      try {
        assertValidation({}, parsePayload);
      } catch (error: unknown) {
        thrownError = error;
      }

      const httpError = toHTTPResult(thrownError);
      nodeAssert.equal(httpError.getStatus(), BAD_REQUEST_CODE);
      nodeAssert.equal(httpError.getBody(), `Error: ${VALIDATION_ERROR_MESSAGE}`);
    });

    it('applies custom error mapper and status code', () => {
      let thrownError: unknown;

      try {
        assertValidation({}, parsePayload, mapValidationError, UNPROCESSABLE_ENTITY_CODE);
      } catch (error: unknown) {
        thrownError = error;
      }

      const httpError = toHTTPResult(thrownError);
      nodeAssert.equal(httpError.getStatus(), UNPROCESSABLE_ENTITY_CODE);
      nodeAssert.equal(httpError.getBody(), JSON.stringify(mapValidationError()));
    });
  });
});
