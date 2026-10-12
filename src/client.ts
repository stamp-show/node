import { StampShowConnectionError, StampShowError } from "./errors.js"
import type {
  Application,
  ApplicationRequest,
  CatalogEntry,
  Commissioner,
  ItemList,
  Judge,
  OpenExhibit,
  PalmaresResult,
  SpecialPrize,
  Sponsor,
  Submission,
} from "./types.js"

export interface StampShowOptions {
  /** The expo's API key (`jpk_...`), from the expo's API keys tab. Keep it on the server. */
  apiKey: string
  /** Default `https://api.stamp.show`. */
  baseUrl?: string
  /** Per-attempt timeout in milliseconds. Default 15000. */
  timeoutMs?: number
  /** Retries after a 429 (any request) or a 5xx / network failure (GET only). Default 2. */
  maxRetries?: number
  /** A `fetch` implementation, for tests or runtimes without a global one. */
  fetch?: typeof fetch
}

const DEFAULT_BASE_URL = "https://api.stamp.show"

export class StampShow {
  readonly applications: Applications
  readonly exhibits: Exhibits
  readonly content: Content

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch

  constructor(options: StampShowOptions) {
    if (!options?.apiKey) throw new TypeError("StampShow: apiKey is required")
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxRetries = options.maxRetries ?? 2
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof this.fetchImpl !== "function") throw new TypeError("StampShow: no fetch available; pass options.fetch (Node 18+ has one)")

    const request = <T>(method: string, path: string, body?: unknown) => this.request<T>(method, path, body)
    this.applications = new Applications(request)
    this.exhibits = new Exhibits(request)
    this.content = new Content(request)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
    const idempotent = method === "GET"

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxRetries
      let response: Response
      try {
        response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
      } catch (cause) {
        if (idempotent && canRetry) {
          await sleep(backoff(attempt))
          continue
        }
        throw new StampShowConnectionError(`Could not reach Stamp.Show: ${(cause as Error)?.message ?? cause}`, { cause })
      }

      if (response.ok) return (await parse(response)) as T

      const detail = errorDetail(await parse(response))
      const retryAfter = Number(response.headers.get("retry-after")) || undefined
      // 429 means the request was not processed, so it is safe to repeat whatever the method.
      if (canRetry && (response.status === 429 || (idempotent && response.status >= 500))) {
        await sleep(retryAfter ? retryAfter * 1000 : backoff(attempt))
        continue
      }
      throw new StampShowError(response.status, detail, retryAfter)
    }
  }
}

type Request = <T>(method: string, path: string, body?: unknown) => Promise<T>

const enc = encodeURIComponent

/** One application per exhibit; each is decided on its own. */
export class Applications {
  constructor(private readonly request: Request) {}

  /** Newest first, up to 500. */
  list(): Promise<Application[]> {
    return this.request("GET", "/applications")
  }

  /**
   * Apply. Retrying with the same `external_reference_id` answers the first application again instead of creating
   * another one, so set it whenever you may retry.
   */
  create(application: ApplicationRequest): Promise<Application> {
    return this.request("POST", "/applications", application)
  }

  get(id: string): Promise<Application> {
    return this.request("GET", `/applications/${enc(id)}`)
  }

  /** Accepts a `pending` application (409 otherwise, or when the expo's package has no room for its frames). */
  accept(id: string): Promise<Application> {
    return this.request("POST", `/applications/${enc(id)}/accept`)
  }

  /** Rejects a `pending` application. */
  reject(id: string): Promise<Application> {
    return this.request("POST", `/applications/${enc(id)}/reject`)
  }
}

/** Sending an accepted application's exhibit and following it. */
export class Exhibits {
  constructor(private readonly request: Request) {}

  /** The expo's submissions, newest first, up to 500. */
  list(): Promise<Submission[]> {
    return this.request("GET", "/exhibits")
  }

  /**
   * Sends the Open Exhibit document for an accepted application (its `exhibit_id`). Images are downloaded in the
   * background: follow the result with `get` or the `exhibit.ready` / `exhibit.failed` webhooks.
   */
  submit(exhibitId: string, exhibit: OpenExhibit): Promise<Submission> {
    return this.request("POST", `/exhibits/${enc(exhibitId)}`, { exhibit })
  }

  /** Processing status and, once the organizer evaluated the expo, the evaluation. */
  get(exhibitId: string): Promise<Submission> {
    return this.request("GET", `/exhibits/${enc(exhibitId)}`)
  }
}

/** The expo's public content, with the same visibility rules as its site. 404 once the public window closed. */
export class Content {
  constructor(private readonly request: Request) {}

  /** `{ visible: false, reason }` until the results are published. Check `visible` before reading `awards`. */
  palmares(): Promise<PalmaresResult> {
    return this.request("GET", "/palmares")
  }

  sponsors(): Promise<ItemList<Sponsor>> {
    return this.request("GET", "/sponsors")
  }

  specialPrizes(): Promise<ItemList<SpecialPrize>> {
    return this.request("GET", "/special-prizes")
  }

  /** Only judges who confirmed. */
  judges(): Promise<ItemList<Judge>> {
    return this.request("GET", "/judges")
  }

  /** Active commissioners, no e-mail. */
  commissioners(): Promise<ItemList<Commissioner>> {
    return this.request("GET", "/commissioners")
  }

  /** Accepted exhibits that are ready. */
  catalog(): Promise<ItemList<CatalogEntry>> {
    return this.request("GET", "/catalog")
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === "") return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorDetail(body: unknown): unknown {
  if (body && typeof body === "object" && "detail" in body) return (body as { detail: unknown }).detail
  return body
}

const backoff = (attempt: number) => Math.min(500 * 2 ** attempt, 4000)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
