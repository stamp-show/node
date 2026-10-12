/** The API answered with a non-2xx status. `detail` is the API's own explanation (it answers `{"detail": ...}`). */
export class StampShowError extends Error {
  readonly status: number
  readonly detail: unknown
  /** Seconds to wait before retrying, when the API said so (429). */
  readonly retryAfter?: number

  constructor(status: number, detail: unknown, retryAfter?: number) {
    super(typeof detail === "string" && detail !== "" ? detail : `Stamp.Show answered HTTP ${status}`)
    this.name = "StampShowError"
    this.status = status
    this.detail = detail
    this.retryAfter = retryAfter
  }
}

/** The request never got an answer (network failure or timeout). */
export class StampShowConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "StampShowConnectionError"
  }
}

/** A webhook did not carry a valid signature. */
export class StampShowSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message)
    this.name = "StampShowSignatureError"
  }
}
