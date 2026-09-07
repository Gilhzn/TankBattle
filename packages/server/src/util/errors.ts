/** Error carrying an HTTP status + machine-readable code; rendered as `{error:{code,message}}`. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message);
export const unauthorized = (message = 'unauthorized', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'forbidden', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'not found', code = 'not_found') => new HttpError(404, code, message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
export const tooMany = (message = 'rate limited', code = 'rate_limited') => new HttpError(429, code, message);
