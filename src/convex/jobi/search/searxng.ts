import { extractPrice, extractRating } from './price';
export interface SearXNGResult { title: string; }
export class SearXNGClient { search(): Promise<SearXNGResult[]> { return Promise.resolve([]); } }
export function searchWeb(): Promise<SearXNGResult[]> { return Promise.resolve([]); }
export interface SearXNGResult { title: string; url: string; snippet: string; price: number; currency: string; }
export function resolveSearXNGConfig(): never { throw new Error("no_searxng_config"); }
export function resolveSearXNGConfig(): never { throw new Error("no_searxng_config"); }
