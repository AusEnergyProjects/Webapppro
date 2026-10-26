export class AdminJobReadError extends Error {
  readonly response: Response;
  constructor(response: Response) { super("ADMIN_JOB_READ_DENIED"); this.response = response; }
}

export function adminJobReadError(error: unknown): Response | null {
  return error instanceof AdminJobReadError ? error.response : null;
}
