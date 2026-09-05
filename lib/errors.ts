/**
 * A domain error carrying an HTTP status code, mirroring FastAPI's
 * HTTPException(status_code, detail) pattern. Route handlers catch this and
 * turn it into a NextResponse via `errorResponse`.
 */
export class ApiError extends Error {
  status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}
