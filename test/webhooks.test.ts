import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { StampShowSignatureError, constructEvent, verifySignature, webhookHandler } from "../src/index.js"

const secret = "whsec_test"
const sign = (body: string, key = secret) => createHmac("sha256", key).update(body).digest("hex")
const body = JSON.stringify({ event: "content.changed", data: { resource: "sponsors" } })

describe("verifySignature", () => {
  it("accepts the HMAC of the raw body", () => {
    expect(verifySignature(body, sign(body), secret)).toBe(true)
    expect(verifySignature(Buffer.from(body), sign(body), secret)).toBe(true)
  })

  it("rejects a tampered body, a wrong secret, and malformed or missing signatures", () => {
    expect(verifySignature(body + " ", sign(body), secret)).toBe(false)
    expect(verifySignature(body, sign(body, "other"), secret)).toBe(false)
    expect(verifySignature(body, "zz", secret)).toBe(false)
    expect(verifySignature(body, sign(body).slice(2), secret)).toBe(false)
    expect(verifySignature(body, "", secret)).toBe(false)
    expect(verifySignature(body, null, secret)).toBe(false)
    expect(verifySignature(body, sign(body), "")).toBe(false)
  })
})

describe("constructEvent", () => {
  it("returns the parsed event", () => {
    const event = constructEvent(body, sign(body), secret)
    expect(event.event).toBe("content.changed")
    if (event.event === "content.changed") expect(event.data.resource).toBe("sponsors")
  })

  it("accepts the header as an array, as a Node request may give it", () => {
    expect(constructEvent(body, [sign(body)], secret).event).toBe("content.changed")
  })

  it("throws on a bad signature", () => {
    expect(() => constructEvent(body, "00", secret)).toThrow(StampShowSignatureError)
  })

  it("throws on signed non-JSON", () => {
    const text = "not json"
    expect(() => constructEvent(text, sign(text), secret)).toThrow(StampShowSignatureError)
  })
})

describe("webhookHandler", () => {
  const request = (payload: string, signature: string) =>
    new Request("https://site.test/hook", { method: "POST", body: payload, headers: { "x-stampshow-signature": signature } })

  it("runs the handler for the event and answers 200", async () => {
    const seen: unknown[] = []
    const handle = webhookHandler(secret, { "content.changed": (data) => void seen.push(data) })
    const response = await handle(request(body, sign(body)))
    expect(response.status).toBe(200)
    expect(seen).toEqual([{ resource: "sponsors" }])
  })

  it("answers 200 to an event nobody handles", async () => {
    const handle = webhookHandler(secret, {})
    expect((await handle(request(body, sign(body)))).status).toBe(200)
  })

  it("answers 401 to a bad signature without running anything", async () => {
    let ran = false
    const handle = webhookHandler(secret, { "content.changed": () => void (ran = true) })
    expect((await handle(request(body, "00"))).status).toBe(401)
    expect(ran).toBe(false)
  })

  it("answers 500 when the handler throws, so the delivery is retried", async () => {
    const handle = webhookHandler(secret, {
      "content.changed": () => {
        throw new Error("db down")
      },
    })
    expect((await handle(request(body, sign(body)))).status).toBe(500)
  })
})
