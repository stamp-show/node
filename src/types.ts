import type { components } from "./schema.js"

type Schemas = components["schemas"]

export type Application = Schemas["Application"]
export type ApplicationRequest = Schemas["ApplicationRequest"]
export type Submission = Schemas["Submission"]
export type SubmissionStatus = Schemas["SubmissionStatus"]
export type Evaluation = Schemas["Evaluation"]
export type Palmares = Schemas["Palmares"]
export type PalmaresHidden = Schemas["PalmaresHidden"]
export type Sponsor = Schemas["Sponsor"]
export type SpecialPrize = Schemas["SpecialPrize"]
export type Judge = Schemas["Judge"]
export type Commissioner = Schemas["Commissioner"]
export type CatalogEntry = Schemas["CatalogEntry"]

/** An Open Exhibit document (https://github.com/open-exhibit/spec). */
export type OpenExhibit = Schemas["ExhibitRequest"]["exhibit"]

/** The content endpoints that return `{ items: [...] }`. */
export interface ItemList<T> {
  items: T[]
}

/** `GET /palmares` answers the results, or why they are not visible yet. */
export type PalmaresResult = Palmares | PalmaresHidden

export type ContentResource = "palmares" | "sponsors" | "special-prizes" | "judges" | "commissioners" | "catalog"

/** What a webhook delivers. `data` depends on the event. */
export type StampShowEvent =
  | { event: "application.accepted"; data: Application }
  | { event: "application.rejected"; data: Application }
  | { event: "exhibit.ready"; data: Application }
  | { event: "exhibit.failed"; data: Application }
  | { event: "results.published"; data: { resource: "palmares" } }
  | { event: "content.changed"; data: { resource: Exclude<ContentResource, "palmares"> } }

export type StampShowEventName = StampShowEvent["event"]
