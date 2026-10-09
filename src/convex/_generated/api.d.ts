/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as aiParse from "../aiParse.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as bookings from "../bookings.js";
import type * as favorites from "../favorites.js";
import type * as hotels from "../hotels.js";
import type * as http from "../http.js";
import type * as jobi_access from "../jobi/access.js";
import type * as jobi_catalogData from "../jobi/catalogData.js";
import type * as jobi_config from "../jobi/config.js";
import type * as jobi_engine from "../jobi/engine.js";
import type * as jobi_extraction_extractAction from "../jobi/extraction/extractAction.js";
import type * as jobi_extraction_extractStage from "../jobi/extraction/extractStage.js";
import type * as jobi_extraction_fetch from "../jobi/extraction/fetch.js";
import type * as jobi_extraction_index from "../jobi/extraction/index.js";
import type * as jobi_extraction_normalize from "../jobi/extraction/normalize.js";
import type * as jobi_extraction_types from "../jobi/extraction/types.js";
import type * as jobi_links from "../jobi/links.js";
import type * as jobi_matching from "../jobi/matching.js";
import type * as jobi_normalize from "../jobi/normalize.js";
import type * as jobi_parse from "../jobi/parse.js";
import type * as jobi_pricing from "../jobi/pricing.js";
import type * as jobi_providers_cachedProvider from "../jobi/providers/cachedProvider.js";
import type * as jobi_providers_compositeProvider from "../jobi/providers/compositeProvider.js";
import type * as jobi_providers_geminiProvider from "../jobi/providers/geminiProvider.js";
import type * as jobi_providers_index from "../jobi/providers/index.js";
import type * as jobi_providers_mockProvider from "../jobi/providers/mockProvider.js";
import type * as jobi_providers_searxngProvider from "../jobi/providers/searxngProvider.js";
import type * as jobi_providers_webSearchProvider from "../jobi/providers/webSearchProvider.js";
import type * as jobi_queries from "../jobi/queries.js";
import type * as jobi_search_gemini from "../jobi/search/gemini.js";
import type * as jobi_search_price from "../jobi/search/price.js";
import type * as jobi_search_searxng from "../jobi/search/searxng.js";
import type * as jobi_types from "../jobi/types.js";
import type * as jobi_urlSafety from "../jobi/urlSafety.js";
import type * as research from "../research.js";
import type * as searchCache from "../searchCache.js";
import type * as searchWeb from "../searchWeb.js";
import type * as searches from "../searches.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  aiParse: typeof aiParse;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  bookings: typeof bookings;
  favorites: typeof favorites;
  hotels: typeof hotels;
  http: typeof http;
  "jobi/access": typeof jobi_access;
  "jobi/catalogData": typeof jobi_catalogData;
  "jobi/config": typeof jobi_config;
  "jobi/engine": typeof jobi_engine;
  "jobi/extraction/extractAction": typeof jobi_extraction_extractAction;
  "jobi/extraction/extractStage": typeof jobi_extraction_extractStage;
  "jobi/extraction/fetch": typeof jobi_extraction_fetch;
  "jobi/extraction/index": typeof jobi_extraction_index;
  "jobi/extraction/normalize": typeof jobi_extraction_normalize;
  "jobi/extraction/types": typeof jobi_extraction_types;
  "jobi/links": typeof jobi_links;
  "jobi/matching": typeof jobi_matching;
  "jobi/normalize": typeof jobi_normalize;
  "jobi/parse": typeof jobi_parse;
  "jobi/pricing": typeof jobi_pricing;
  "jobi/providers/cachedProvider": typeof jobi_providers_cachedProvider;
  "jobi/providers/compositeProvider": typeof jobi_providers_compositeProvider;
  "jobi/providers/geminiProvider": typeof jobi_providers_geminiProvider;
  "jobi/providers/index": typeof jobi_providers_index;
  "jobi/providers/mockProvider": typeof jobi_providers_mockProvider;
  "jobi/providers/searxngProvider": typeof jobi_providers_searxngProvider;
  "jobi/providers/webSearchProvider": typeof jobi_providers_webSearchProvider;
  "jobi/queries": typeof jobi_queries;
  "jobi/search/gemini": typeof jobi_search_gemini;
  "jobi/search/price": typeof jobi_search_price;
  "jobi/search/searxng": typeof jobi_search_searxng;
  "jobi/types": typeof jobi_types;
  "jobi/urlSafety": typeof jobi_urlSafety;
  research: typeof research;
  searchCache: typeof searchCache;
  searchWeb: typeof searchWeb;
  searches: typeof searches;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
