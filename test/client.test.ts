import { describe, expect, it, vi } from "vitest"
import { StampShow, StampShowConnectionError, StampShowError } from "../src/index.js"

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

function client(responses: Array<Response | Error>, options = {}) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (next === undefined) throw new Error("unexpected extra request")
    if (next instanceof Error) throw next
    return next
  })
  const stampshow = new StampShow({ apiKey: "jpk_test", fetch: fetchMock as unknown as typeof fetch, ...options })
  return { stampshow, fetchMock }
}

const application = { exhibitor: { email: "ana@example.com" }, title: "The 1856 issue", exhibit_class: "traditional", frame_count: 3 }

describe("requests", () => {
  it("sends the key, the path and the JSON body", async () => {
    const { stampshow, fetchMock } = client([json({ id: "p1", status: "pending" }, 201)])
    const created = await stampshow.applications.create(application)
    expect(created.id).toBe("p1")

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.stamp.show/api/v1/applications")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jpk_test")
    expect(JSON.parse(init.body as string).frame_count).toBe(3)
  })

  it("wraps the exhibit in the envelope and escapes ids", async () => {
    const { stampshow, fetchMock } = client([json({ id: "s1" }, 202)])
    await stampshow.exhibits.submit("a/b", { title: "x" })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.stamp.show/api/v1/exhibits/a%2Fb")
    expect(JSON.parse(init.body as string)).toEqual({ exhibit: { title: "x" } })
  })

  it("covers every endpoint of the spec", async () => {
    const calls: string[] = []
    const stampshow = new StampShow({
      apiKey: "k",
      baseUrl: "https://example.test/",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url.replace("https://example.test/api/v1", "")}`)
        return json({ items: [] })
      }) as unknown as typeof fetch,
    })
    await stampshow.applications.list()
    await stampshow.applications.get("a")
    await stampshow.applications.accept("a")
    await stampshow.applications.reject("a")
    await stampshow.exhibits.list()
    await stampshow.exhibits.get("e")
    await stampshow.content.palmares()
    await stampshow.content.sponsors()
    await stampshow.content.specialPrizes()
    await stampshow.content.judges()
    await stampshow.content.commissioners()
    await stampshow.content.catalog()
    expect(calls).toEqual([
      "GET /applications",
      "GET /applications/a",
      "POST /applications/a/accept",
      "POST /applications/a/reject",
      "GET /exhibits",
      "GET /exhibits/e",
      "GET /palmares",
      "GET /sponsors",
      "GET /special-prizes",
      "GET /judges",
      "GET /commissioners",
      "GET /catalog",
    ])
  })

  it("requires a key", () => {
    expect(() => new StampShow({ apiKey: "" })).toThrow(TypeError)
  })
})

describe("errors", () => {
  it("turns {detail} into a StampShowError", async () => {
    const { stampshow } = client([json({ detail: "title is required" }, 422)])
    const error = await stampshow.applications.get("x").catch((e) => e)
    expect(error).toBeInstanceOf(StampShowError)
    expect(error.status).toBe(422)
    expect(error.message).toBe("title is required")
    expect(error.detail).toBe("title is required")
  })

  it("keeps an object detail", async () => {
    const { stampshow } = client([json({ detail: { frame_count: "too big" } }, 422)])
    const error = await stampshow.applications.get("x").catch((e) => e)
    expect(error.detail).toEqual({ frame_count: "too big" })
    expect(error.message).toBe("Stamp.Show answered HTTP 422")
  })

  it("does not retry a 4xx", async () => {
    const { stampshow, fetchMock } = client([json({ detail: "nope" }, 404)])
    await expect(stampshow.applications.get("x")).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("retries", () => {
  it("repeats a 429 for any method, honouring Retry-After", async () => {
    vi.useFakeTimers()
    const { stampshow, fetchMock } = client([json({ detail: "slow down" }, 429, { "retry-after": "1" }), json({ id: "p1" }, 201)])
    const pending = stampshow.applications.create(application)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ id: "p1" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("repeats a 5xx on a GET but never on a POST", async () => {
    vi.useFakeTimers()
    const get = client([json({ detail: "boom" }, 502), json({ items: [] })])
    const reading = get.stampshow.content.judges()
    await vi.advanceTimersByTimeAsync(500)
    await expect(reading).resolves.toEqual({ items: [] })

    const post = client([json({ detail: "boom" }, 502)])
    await expect(post.stampshow.applications.accept("a")).rejects.toMatchObject({ status: 502 })
    expect(post.fetchMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("gives up after maxRetries and reports a connection failure", async () => {
    vi.useFakeTimers()
    const { stampshow, fetchMock } = client([new TypeError("fetch failed"), new TypeError("fetch failed")], { maxRetries: 1 })
    const reading = stampshow.content.catalog().catch((e) => e)
    await vi.advanceTimersByTimeAsync(500)
    expect(await reading).toBeInstanceOf(StampShowConnectionError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
