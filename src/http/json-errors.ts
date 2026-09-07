import type { ErrorRequestHandler, RequestHandler } from 'express';

export const requireJson: RequestHandler = (request, response, next) => {
  if (!request.is('application/json')) {
    response.status(415).json({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Use application/json',
      },
    });
    return;
  }
  next();
};

export function createJsonErrorHandler(
  limitMessage: string,
): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const type = readErrorField(error, 'type');
    const status = readErrorField(error, 'status');
    if (type === 'entity.too.large') {
      response.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: limitMessage },
      });
    } else if (status === 415) {
      response.status(415).json({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported JSON encoding',
        },
      });
    } else if (status === 400) {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      });
    } else {
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
      });
    }
  };
}

function readErrorField(error: unknown, field: 'type' | 'status'): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }
  return error[field as keyof typeof error];
}
