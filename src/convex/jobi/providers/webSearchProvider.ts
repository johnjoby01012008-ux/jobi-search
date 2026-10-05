/**
 * @deprecated The paid search providers (Exa / Brave / Serper) have been
 * removed in favour of the self-hosted SearXNG layer. Price extraction now
 * lives in `../search/price`. This module only remains as a compatibility
 * re-export for older imports.
 */
export { extractObservedPrice, extractPrice } from "../search/price";
