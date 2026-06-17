chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCRAPE_COURSE_RATINGS") return false;

  scrapeCourseRatings(message.pageSize, message.maxPages)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function scrapeCourseRatings(pageSize = 100, maxPages = 200) {
  const courses = [];
  let fetched = 0;
  let total = Infinity;

  for (let page = 1; page <= maxPages && fetched < total; page += 1) {
    let payload;
    let lastError;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await delay(Math.min(2000 * (2 ** (attempt - 1)), 10000));
      }

      const response = await fetch(buildCourseUrl(page, pageSize), {
        credentials: "include",
        headers: { Accept: "application/json" }
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("选课社区未登录或登录已过期，请在当前页面登录后再刷新。");
      }

      if (response.status === 429) {
        lastError = new Error(`选课社区接口请求失败：HTTP 429（请求过于频繁，第 ${attempt + 1} 次尝试）`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`选课社区接口请求失败：HTTP ${response.status}`);
      }

      payload = await response.json();
      lastError = undefined;
      break;
    }

    if (lastError) throw lastError;

    const items = extractItems(payload);
    const parsedTotal = Number(payload?.total ?? payload?.data?.total);
    total = Number.isFinite(parsedTotal) ? parsedTotal : items.length;

    courses.push(...items);
    fetched += items.length;
    if (items.length === 0) break;

    if (fetched < total) await delay(300);
  }

  return { courses, fetched, total: Number.isFinite(total) ? total : fetched };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCourseUrl(page, pageSize) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    order_by: "rating_score"
  });
  return `/api/course/?${params}`;
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}
