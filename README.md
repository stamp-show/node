<p align="center">
  <a href="https://stamp.show/"><img src="https://stamp.show/app/logo.png" alt="Stamp.Show" width="160"></a>
</p>

# @stamp-show/sdk

Node.js client for the [Stamp.Show](https://stamp.show/) API: register exhibits in your expo from your own system, read the expo's public content (palmares, sponsors, judges, catalog...) and verify webhooks. Typed, no runtime dependencies, ESM and CommonJS.

[API reference](https://stamp.show/developers/api/) · [OpenAPI spec](https://stamp.show/developers/api/openapi.yaml) · [All developer docs](https://stamp.show/developers/)

Requires Node.js 18 or later (it uses the global `fetch`).

```sh
npm install @stamp-show/sdk
```

## Quick start

An API key belongs to one expo. Create it in the expo's **API keys** tab (it starts with `jpk_`) and keep it on your server.

```ts
import { StampShow } from "@stamp-show/sdk"

const stampshow = new StampShow({ apiKey: process.env.STAMPSHOW_API_KEY! })

const palmares = await stampshow.content.palmares()
if (palmares.visible) {
  for (const award of palmares.awards) console.log(award.medal, award.title, award.exhibitor)
}
```

## Register an exhibit

Registering takes two calls. First apply, one application per exhibit. Once **that application** is accepted (at once if the expo accepts registrations automatically, otherwise when the organizer decides) it carries an `exhibit_id` and you send the exhibit.

```ts
const application = await stampshow.applications.create({
  exhibitor: { email: "ana@example.com", name: "Ana Pérez", country: "PE" },
  external_reference_id: "exh-001", // makes a retried request safe
  title: "The 1856 issue",
  exhibit_class: "traditional",
  frame_count: 3,
})

// later, when application.accepted arrives (see Webhooks) or after polling applications.get(id):
await stampshow.exhibits.submit(application.exhibit_id!, openExhibitDocument)

const submission = await stampshow.exhibits.get(application.exhibit_id!)
// submission.status: "processing" | "ready" | "failed"; submission.evaluation once the organizer ran it
```

`openExhibitDocument` is an [Open Exhibit](https://github.com/open-exhibit/spec) document (an open, application-neutral format): title, class, frames and sheets, with an `image.uri` per sheet. Validate it against the [JSON Schema](https://github.com/open-exhibit/spec/blob/main/schema/exhibit.schema.json) before sending; see the [examples](https://github.com/open-exhibit/spec/tree/main/examples).

A site that manages applications itself can also decide them: `applications.accept(id)` and `applications.reject(id)`.

## Read the expo's content

The same data, and the same visibility rules, as the expo's public site. Each call answers `404` (a `StampShowError`) once the expo's public window has closed.

```ts
await stampshow.content.palmares()       // { visible: true, awards, special_prizes } or { visible: false, reason }
await stampshow.content.sponsors()       // { items: [{ name, category, logo_url }] }
await stampshow.content.specialPrizes()
await stampshow.content.judges()         // only judges who confirmed
await stampshow.content.commissioners()
await stampshow.content.catalog()
```

Cache what you read and refresh it on the `content.changed` and `results.published` webhooks instead of polling.

## Webhooks

Set a webhook URL on the API key (expo's **API keys** tab) and tick the events you want. Every delivery is signed with the key's webhook secret. Verify against the **raw** body: a body that was parsed and serialized again will not match.

### Express

```ts
import express from "express"
import { constructEvent, StampShowSignatureError } from "@stamp-show/sdk"

app.post("/stampshow", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = constructEvent(req.body, req.headers["x-stampshow-signature"], process.env.STAMPSHOW_WEBHOOK_SECRET!)
    if (event.event === "application.accepted") queueExhibit(event.data.exhibit_id!)
    res.sendStatus(200)
  } catch (error) {
    res.sendStatus(error instanceof StampShowSignatureError ? 401 : 500)
  }
})
```

### Next.js, Hono, Cloudflare Workers, Deno, Bun

`webhookHandler` takes a Web `Request` and returns a `Response`: 401 for a bad signature, 500 if your handler throws (so the delivery is retried), 200 otherwise.

```ts
// app/api/stampshow/route.ts
import { webhookHandler } from "@stamp-show/sdk"
import { revalidatePath, revalidateTag } from "next/cache"

export const POST = webhookHandler(process.env.STAMPSHOW_WEBHOOK_SECRET!, {
  "results.published": () => revalidatePath("/palmares"),
  "content.changed": ({ resource }) => revalidateTag(resource),
})
```

Events: `application.accepted`, `application.rejected`, `exhibit.ready`, `exhibit.failed`, `results.published`, `content.changed`. The first four carry the application, as `applications.get(id)` returns it; the last two carry `{ resource }`. Use `X-StampShow-Delivery` to ignore repeated deliveries. If you only need the verification, import from `@stamp-show/sdk/webhooks`.

## Errors and retries

A non-2xx answer throws `StampShowError` with `status` and `detail` (the API answers `{"detail": ...}`). A request that gets no answer throws `StampShowConnectionError`.

```ts
import { StampShowError } from "@stamp-show/sdk"

try {
  await stampshow.applications.create(application)
} catch (error) {
  if (error instanceof StampShowError && error.status === 422) console.error(error.detail)
  else throw error
}
```

A `429` (the limit is 60 requests per minute per key) is retried, honouring `Retry-After`, for any method: the request was not processed. A `5xx` or a network failure is retried for `GET` only. `maxRetries` (default 2) and `timeoutMs` (default 15000) are options, as are `baseUrl` and `fetch`.

## Types

Everything is typed from the API's [OpenAPI description](https://stamp.show/developers/api/openapi.yaml). The models are exported (`Application`, `Submission`, `Palmares`, `Judge`, `StampShowEvent`...). To regenerate them after the API changes: `npm run generate`.

## License

[MIT](LICENSE). Stamp.Show is the platform for running a philatelic exhibition online, from registration to the published palmarès: [stamp.show](https://stamp.show/).
