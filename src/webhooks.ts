import { createHmac, timingSafeEqual } from "node:crypto"
import { StampShowSignatureError } from "./errors.js"
import type { StampShowEvent, StampShowEventName } from "./types.js"

/**
 * True when `signature` (the `X-StampShow-Signature` header) is the hex HMAC-SHA256 of the **raw** request body
 * keyed with the API key's webhook secret. Pass the body exactly as it arrived: a re-serialized JSON object will
 * not match.
 */
export function verifySignature(rawBody: string | Uint8Array, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = createHmac("sha256", secret).update(rawBody).digest()
  const given = Buffer.from(signature.trim(), "hex")
  // A malformed (non-hex or wrong length) header decodes to a different length: reject before comparing.
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Verifies the signature and returns the parsed event. Throws `StampShowSignatureError` when it does not match.
 *
 * ```ts
 * const event = constructEvent(rawBody, req.headers["x-stampshow-signature"], process.env.STAMPSHOW_WEBHOOK_SECRET!)
 * if (event.event === "application.accepted") sendExhibit(event.data.exhibit_id)
 * ```
 */
export function constructEvent(
  rawBody: string | Uint8Array,
  signature: string | string[] | null | undefined,
  secret: string,
): StampShowEvent {
  const header = Array.isArray(signature) ? signature[0] : signature
  if (!verifySignature(rawBody, header, secret)) throw new StampShowSignatureError()

  let parsed: unknown
  try {
    parsed = JSON.parse(typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8"))
  } catch {
    throw new StampShowSignatureError("Webhook body is not valid JSON")
  }
  // An event this SDK does not know yet (a newer API) is handed over as is, not rejected.
  return parsed as StampShowEvent
}

type Handlers = { [E in StampShowEventName]?: (data: Extract<StampShowEvent, { event: E }>["data"]) => void | Promise<void> }

/**
 * A handler for Web-standard runtimes (Next.js route handlers, Hono, Cloudflare Workers, Deno, Bun):
 * `Request` in, `Response` out. It answers 401 to a bad signature and 200 once your handler for the event ran.
 * A handler that throws answers 500, so the API retries the delivery.
 *
 * ```ts
 * export const POST = webhookHandler(process.env.STAMPSHOW_WEBHOOK_SECRET!, {
 *   "results.published": () => revalidatePath("/palmares"),
 *   "content.changed": ({ resource }) => revalidateTag(resource),
 * })
 * ```
 */
export function webhookHandler(secret: string, handlers: Handlers): (request: Request) => Promise<Response> {
  return async (request) => {
    const rawBody = await request.text()
    let event: StampShowEvent
    try {
      event = constructEvent(rawBody, request.headers.get("x-stampshow-signature"), secret)
    } catch (error) {
      if (error instanceof StampShowSignatureError) return new Response(error.message, { status: 401 })
      throw error
    }
    const handler = handlers[event.event] as ((data: unknown) => void | Promise<void>) | undefined
    try {
      await handler?.(event.data)
    } catch {
      return new Response("Handler failed", { status: 500 })
    }
    return new Response("ok", { status: 200 })
  }
}
