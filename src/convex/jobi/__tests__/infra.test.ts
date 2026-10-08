import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Infrastructure guards.
 *
 * These assert the properties of the SearXNG setup that are easy to break by
 * accident, and that cannot be proven without a running container: the JSON
 * API stays enabled, the service is never published publicly, and the internal
 * URL never leaks into application source.
 */

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "_generated" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Exclude test files so the needles below cannot match this file itself.
const sourceFiles = walk(path.join(ROOT, "src")).filter((file) => !file.includes("__tests__"));
const frontendFiles = sourceFiles.filter((file) =>
  /src[\\/](pages|components|hooks)[\\/]/.test(file),
);

/**
 * Strip comments so a URL mentioned in documentation prose is not mistaken for
 * a hardcoded value in executable code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // A `//` preceded by `:` is part of a URL (http://…), not a comment.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const codeOf = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("docker-compose — SearXNG service", () => {
  const compose = read("docker-compose.yml");

  it("defines the SearXNG service on a dedicated internal network", () => {
    expect(compose).toMatch(/^\s{2}searxng:\s*$/m);
    expect(compose).toMatch(/image:\s*docker\.io\/searxng\/searxng:latest/);
    expect(compose).toMatch(/networks:\s*\n\s*-\s*jobi-search/);
    expect(compose).toMatch(/^\s{2}jobi-search:\s*$/m);
  });

  it("never publishes the container beyond loopback", () => {
    const published = compose.match(/^\s*-\s*"([^"]+:\d+:8080)"\s*$/m);
    expect(published).not.toBeNull();
    expect(published![1]).toMatch(/^127\.0\.0\.1:/);
    // No 0.0.0.0 / all-interfaces binding anywhere in the file.
    expect(compose).not.toMatch(/0\.0\.0\.0:\d+:8080/);
  });

  it("has a healthcheck and bounded log rotation", () => {
    expect(compose).toMatch(/healthcheck:/);
    expect(compose).toMatch(/healthz/);
    expect(compose).toMatch(/max-size/);
    expect(compose).toMatch(/restart:\s*unless-stopped/);
  });
});

describe("searxng/settings.yml — JSON API", () => {
  const settings = read("searxng/settings.yml");

  it("enables JSON output (otherwise /search?format=json returns 403)", () => {
    expect(settings).toMatch(/formats:\s*\n\s*- html\s*\n\s*- json/);
  });

  it("keeps the instance private and unthrottled at the edge", () => {
    expect(settings).toMatch(/limiter:\s*false/);
    expect(settings).toMatch(/base_url:\s*false/);
    expect(settings).toMatch(/image_proxy:\s*false/);
  });

  it("sets a finite outgoing timeout so a hung engine cannot stall a run", () => {
    expect(settings).toMatch(/request_timeout:\s*\d/);
    expect(settings).toMatch(/max_request_timeout:\s*\d/);
  });
});

describe("the internal SearXNG address never leaks into source", () => {
  const needles = ["searxng" + ":8080", "localhost" + ":8888"];

  it("has no hardcoded SearXNG address in any application source file", () => {
    const offenders = sourceFiles.filter((file) =>
      needles.some((needle) => codeOf(file).includes(needle)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the search client and provider out of the frontend bundle", () => {
    const offenders = frontendFiles.filter((file) => {
      const contents = codeOf(file);
      return contents.includes("jobi/search") || contents.includes("SearXNGClient");
    });
    expect(offenders).toEqual([]);
  });
});

describe("environment configuration", () => {
  it("ignores .env", () => {
    expect(read(".gitignore")).toMatch(/^\.env$/m);
  });

  it("documents every required variable in the template", () => {
    const template = read("env.example");
    for (const key of ["SEARXNG_URL", "SEARCH_CACHE_TTL", "SEARCH_TIMEOUT"]) {
      expect(template).toContain(`${key}=`);
    }
  });
});