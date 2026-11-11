// Searches public LinkedIn posts indexed by Google through Serper. LinkedIn's
// public pages are not reliably crawlable, so posts without a verifiable date
// are discarded rather than treated as recent.

import { loadJson } from "../loadJson.js";
import { makeJob } from "./base.js";

const SERPER_URL = "https://google.serper.dev/search";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LINKEDIN_PATH = /\/(?:posts|feed\/update)\//i;
const ROLE_LABELS = {
  react_native: "React Native Developer",
  product_engineer: "Product Engineer",
  frontend_engineer: "Frontend Engineer",
};
const cvMapping = loadJson(import.meta.url, "../../config/cvMapping.json");
const ROLE_PROFILES = Object.entries(cvMapping)
  .filter(([key, profile]) => ROLE_LABELS[key] && Array.isArray(profile.titleKeywords))
  .map(([key, profile]) => ({
    key,
    label: ROLE_LABELS[key],
    terms: [...new Set(profile.titleKeywords.map(normalize).filter((term) => term.length >= 5))],
  }));
function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseLinkedInPostDate(value, now = new Date()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const dateText = value.trim().toLowerCase();
  if (/\btoday\b/.test(dateText)) return new Date(now);
  if (/\byesterday\b/.test(dateText)) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const relative = dateText.match(
    /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/,
  );
  if (relative) {
    const units = {
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    return new Date(
      now.getTime() - Number(relative[1]) * units[relative[2]],
    );
  }

  const dateOnly = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnly
    ? new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isRecentLinkedInPost(value, now = new Date()) {
  const postedAt = parseLinkedInPostDate(value, now);
  if (!postedAt) return false;
  const age = now.getTime() - postedAt.getTime();
  return age >= 0 && age <= MAX_AGE_MS;
}

function matchingProfile(text) {
  const normalized = normalize(text);
  return ROLE_PROFILES.find((profile) =>
    profile.terms.some((term) => normalized.includes(term)),
  );
}

function isLinkedInPostUrl(value) {
  try {
    const url = new URL(value);
    return (
      /(^|\.)linkedin\.com$/i.test(url.hostname) &&
      LINKEDIN_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function inspectLinkedInResult(result, now) {
  if (!result || typeof result.link !== "string") return { reason: "invalid" };
  let url;
  try {
    url = new URL(result.link);
  } catch {
    return { reason: "invalid" };
  }
  if (!isLinkedInPostUrl(result.link)) return { reason: "not_post" };

  const description = String(result.snippet || "").trim();
  const titleText = String(result.title || "").trim();
  const profile = matchingProfile(`${titleText} ${description}`);
  const dateText = result.date || description.match(
    /\b(?:today|yesterday|\d+\s+(?:minute|hour|day|week)s?\s+ago)\b/i,
  )?.[0];
  if (!profile) return { reason: "role_mismatch" };
  const parsedDate = parseLinkedInPostDate(dateText, now);
  if (!parsedDate) return { reason: "undated" };
  if (!isRecentLinkedInPost(dateText, now))
    return { reason: "outside_seven_days" };

  url.search = "";
  url.hash = "";
  return {
    reason: "match",
    job: makeJob({
      title: profile.label,
      company: "LinkedIn post",
      location: "",
      link: url.toString(),
      description,
      source: "linkedin",
      postTitle: titleText,
      postedAt: parsedDate.toISOString(),
    }),
  };
}

export function toLinkedInJob(result, now = new Date()) {
  return inspectLinkedInResult(result, now).job || null;
}

function buildSearchQuery(profile) {
  return `LinkedIn post hiring ${profile.label}`;
}

export async function fetchLinkedIn() {
  const apiKey =
    process.env.SERPER_API_KEY?.trim() || process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[fetchers] linkedin skipped: set SERPER_API_KEY to search public LinkedIn posts",
    );
    return [];
  }

  const jobs = [];
  const diagnostics = {
    results: 0,
    postUrls: 0,
    roleMismatch: 0,
    undated: 0,
    outsideSevenDays: 0,
  };
  const now = new Date();
  for (const profile of ROLE_PROFILES) {
    let response;
    try {
      response = await fetch(SERPER_URL, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: buildSearchQuery(profile),
          num: 30,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("Serper request failed before receiving a response.");
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Serper rejected the API key (HTTP 401). Verify SERPER_API_KEY in your Serper dashboard and restart the process after changing .env.local.",
        );
      }
      const details = (await response.text())
        .replaceAll(apiKey, "[redacted]")
        .slice(0, 300);
      throw new Error(
        `Serper returned HTTP ${response.status}${details ? `: ${details}` : ""}`,
      );
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Serper: ${data.error}`);
    }

    const results = data.organic || data.organic_results || [];
    diagnostics.results += results.length;
    for (const result of results) {
      const inspected = inspectLinkedInResult(result, now);
      if (inspected.reason === "role_mismatch") {
        diagnostics.postUrls++;
        diagnostics.roleMismatch++;
      } else if (inspected.reason === "undated") {
        diagnostics.postUrls++;
        diagnostics.undated++;
      } else if (inspected.reason === "outside_seven_days") {
        diagnostics.postUrls++;
        diagnostics.outsideSevenDays++;
      } else if (inspected.reason === "match") {
        diagnostics.postUrls++;
        jobs.push(inspected.job);
      }
    }
  }

  const uniqueJobs = [...new Map(jobs.map((job) => [job.link, job])).values()];
  console.log(
    `[fetchers] linkedin results: ${diagnostics.results}, post URLs: ${diagnostics.postUrls}, role mismatch: ${diagnostics.roleMismatch}, undated: ${diagnostics.undated}, older than 7 days: ${diagnostics.outsideSevenDays}, eligible: ${uniqueJobs.length}`,
  );
  return uniqueJobs;
}
