import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchLinkedIn,
  isRecentLinkedInPost,
  parseLinkedInPostDate,
  toLinkedInJob,
} from "../lib/fetchers/linkedin.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");

test("parses relative and absolute post dates", () => {
  assert.equal(
    parseLinkedInPostDate("3 days ago", NOW).toISOString(),
    "2026-11-07T12:00:00.000Z",
  );
  assert.equal(
    parseLinkedInPostDate("2026-11-09", NOW).toISOString(),
    "2026-11-09T00:00:00.000Z",
  );
  assert.equal(parseLinkedInPostDate("date unavailable", NOW), null);
});

test("accepts only dates within the past seven days", () => {
  assert.equal(isRecentLinkedInPost("7 days ago", NOW), true);
  assert.equal(isRecentLinkedInPost("8 days ago", NOW), false);
  assert.equal(isRecentLinkedInPost("1 hour ago", NOW), true);
  assert.equal(
    isRecentLinkedInPost(
      "1 day ago",
      new Date("2026-11-10T00:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isRecentLinkedInPost("2026-11-11", NOW),
    false,
  );
  assert.equal(isRecentLinkedInPost("not dated", NOW), false);
});

test("converts only recent LinkedIn posts that match a target role", () => {
  const recent = toLinkedInJob(
    {
      title: "We're hiring a React Native Developer",
      link: "https://www.linkedin.com/posts/company_hiring-mobile-activity-123?tracking=abc",
      date: "2 days ago",
      snippet: "Join our team to build mobile apps with React Native and Expo.",
    },
    NOW,
  );
  assert.equal(recent.title, "React Native Developer");
  assert.equal(recent.company, "LinkedIn post");
  assert.equal(recent.source, "linkedin");
  assert.equal(recent.link, "https://www.linkedin.com/posts/company_hiring-mobile-activity-123");
  assert.equal(recent.postedAt, "2026-11-08T12:00:00.000Z");

  assert.equal(
    toLinkedInJob(
      {
        title: "Frontend Engineer",
        link: "https://www.linkedin.com/posts/company_frontend-activity-456",
        date: "8 days ago",
        snippet: "We are hiring.",
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    toLinkedInJob(
      {
        title: "Frontend Engineer",
        link: "https://www.linkedin.com/jobs/view/123",
        date: "2 days ago",
        snippet: "We are hiring.",
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    toLinkedInJob(
      {
        title: "Community Manager",
        link: "https://www.linkedin.com/posts/company_hiring-activity-789",
        date: "2 days ago",
        snippet: "We're hiring a community manager.",
      },
      NOW,
    ),
    null,
  );
});

test("converts a recent role-matching post from general search results", () => {
  const post = toLinkedInJob(
    {
      title: "React Native Developer - hiring announcement",
      link: "https://www.linkedin.com/posts/company_role-hiring-activity-123",
      date: "6 days ago",
      snippet:
        "Senior React Native Developer. Requires expertise in React Native, TypeScript, and mobile payments.",
    },
    NOW,
  );
  assert.equal(post?.title, "React Native Developer");
  assert.equal(post?.source, "linkedin");
  assert.equal(post?.postedAt, "2026-11-04T12:00:00.000Z");
});

test("reports rejected credentials without including the API key", async () => {
  const originalSerperKey = process.env.SERPER_API_KEY;
  const originalSerpApiKey = process.env.SERPAPI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SERPER_API_KEY = "test-key-not-a-real-secret";
  delete process.env.SERPAPI_API_KEY;
  globalThis.fetch = async () =>
    new Response("Unauthorized", { status: 401 });

  try {
    await assert.rejects(fetchLinkedIn(), (error) => {
      assert.match(error.message, /Serper rejected the API key \(HTTP 401\)/);
      assert.match(error.message, /SERPER_API_KEY/);
      assert.match(error.message, /restart the process/);
      assert.doesNotMatch(error.message, /test-key-not-a-real-secret/);
      return true;
    });
  } finally {
    if (originalSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = originalSerperKey;
    if (originalSerpApiKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = originalSerpApiKey;
    globalThis.fetch = originalFetch;
  }
});

test("calls the Serper endpoint and parses its organic result shape", async () => {
  const originalSerperKey = process.env.SERPER_API_KEY;
  const originalSerpApiKey = process.env.SERPAPI_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const requests = [];
  const logs = [];
  process.env.SERPER_API_KEY = "test-serper-key";
  delete process.env.SERPAPI_API_KEY;
  console.log = (...args) => logs.push(args.join(" "));
  globalThis.fetch = async (input, options) => {
    requests.push({ url: new URL(input), options });
    return Response.json({
      organic: [
        {
          title: "We're hiring a Frontend Engineer",
          link: "https://www.linkedin.com/posts/company_frontend-activity-123",
          date: "2 days ago",
          snippet: "Join our team to build React and TypeScript applications.",
        },
        {
          title: "Frontend Engineer",
          link: "https://www.linkedin.com/posts/company_old-activity-456",
          date: "8 days ago",
          snippet: "We are hiring.",
        },
        {
          title: "Frontend Engineer",
          link: "https://example.com/job/123",
          date: "2 days ago",
          snippet: "We are hiring.",
        },
      ],
    });
  };

  try {
    const jobs = await fetchLinkedIn();
    assert.equal(requests.length, 3);
    assert.ok(
      requests.every(
        ({ url, options }) =>
          url.origin === "https://google.serper.dev" &&
          url.pathname === "/search" &&
          options.method === "POST" &&
          options.headers["X-API-KEY"] === "test-serper-key" &&
          /^LinkedIn post hiring (React Native Developer|Product Engineer|Frontend Engineer)$/.test(
            JSON.parse(options.body).q,
          ) &&
          !/\b(site:|after:|OR)\b/i.test(JSON.parse(options.body).q) &&
          !JSON.parse(options.body).q.includes("test-serper-key"),
      ),
    );
    assert.ok(jobs.some((job) => job.source === "linkedin"));
    assert.match(
      logs.join(" "),
      /results: 9, post URLs: 6, role mismatch: 0, undated: 0, older than 7 days: 3, eligible: 1/,
    );
  } finally {
    if (originalSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = originalSerperKey;
    if (originalSerpApiKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = originalSerpApiKey;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("includes safe Serper response details for malformed requests", async () => {
  const originalSerperKey = process.env.SERPER_API_KEY;
  const originalSerpApiKey = process.env.SERPAPI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SERPER_API_KEY = "test-serper-key";
  delete process.env.SERPAPI_API_KEY;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ message: "Invalid request: unsupported field" }),
      { status: 400 },
    );

  try {
    await assert.rejects(fetchLinkedIn(), (error) => {
      assert.match(error.message, /Serper returned HTTP 400/);
      assert.match(error.message, /unsupported field/);
      assert.doesNotMatch(error.message, /test-serper-key/);
      return true;
    });
  } finally {
    if (originalSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = originalSerperKey;
    if (originalSerpApiKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = originalSerpApiKey;
    globalThis.fetch = originalFetch;
  }
});
