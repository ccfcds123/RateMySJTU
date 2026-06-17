const API_BASE = "https://course.sjtu.plus/api";
const PAGE_SIZE = 100;
const MAX_PAGES = 200;

const STORAGE_KEYS = {
  ratings: "ratings",
  courses: "courses",
  lastUpdated: "lastUpdated",
  lastError: "lastError",
  lastStats: "lastStats"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refreshRatings", { periodInMinutes: 12 * 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshRatings") {
    refreshRatings().catch((error) => {
      chrome.storage.local.set({
        [STORAGE_KEYS.lastError]: error.message,
        [STORAGE_KEYS.lastStats]: { ok: false, error: error.message, at: Date.now() }
      });
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_RATINGS") {
    chrome.storage.local.get(Object.values(STORAGE_KEYS)).then(sendResponse);
    return true;
  }

  if (message?.type === "REFRESH_RATINGS") {
    refreshRatings()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        const result = { ok: false, error: error.message, at: Date.now() };
        chrome.storage.local.set({
          [STORAGE_KEYS.lastError]: error.message,
          [STORAGE_KEYS.lastStats]: result
        });
        sendResponse(result);
      });
    return true;
  }

  return false;
});

async function refreshRatings() {
  let result;
  try {
    result = await fetchAllCourses(fetchCoursePageFromBackground, "background");
  } catch (error) {
    if (!isAuthLikeError(error)) throw error;
    result = await refreshThroughCourseTab();
  }

  const normalized = buildRatingStore(result.courses);
  if (normalized.indexCount === 0 && result.fetched > 0) {
    throw new Error(`已读取 ${result.fetched} 门课程，但没有解析到评分字段。请更新插件或反馈接口结构。`);
  }

  const lastUpdated = Date.now();
  const stats = {
    ok: true,
    source: result.source,
    fetched: result.fetched,
    total: result.total,
    coursesWithRating: normalized.courses.length,
    indexCount: normalized.indexCount,
    at: lastUpdated
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.ratings]: normalized.ratings,
    [STORAGE_KEYS.courses]: normalized.courses,
    [STORAGE_KEYS.lastUpdated]: lastUpdated,
    [STORAGE_KEYS.lastError]: "",
    [STORAGE_KEYS.lastStats]: stats
  });

  return stats;
}

async function refreshThroughCourseTab() {
  const tabs = await chrome.tabs.query({ url: "https://course.sjtu.plus/*" });
  const tab = tabs.find((item) => item.id);
  if (!tab?.id) {
    throw new Error("无法读取评分：请先打开并登录 course.sjtu.plus，然后再点击刷新。");
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "SCRAPE_COURSE_RATINGS",
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES
  });

  if (!response?.ok) {
    throw new Error(response?.error || "选课社区页面刷新失败。");
  }

  return {
    source: "course-tab",
    courses: response.courses,
    fetched: response.fetched,
    total: response.total
  };
}

async function fetchAllCourses(fetchPage, source) {
  const courses = [];
  let fetched = 0;
  let total = Infinity;

  for (let page = 1; page <= MAX_PAGES && fetched < total; page += 1) {
    const payload = await fetchPage(page);
    const items = extractItems(payload);
    const parsedTotal = Number(payload?.total ?? payload?.data?.total);
    total = Number.isFinite(parsedTotal) ? parsedTotal : items.length;

    courses.push(...items);
    fetched += items.length;
    if (items.length === 0) break;

    if (fetched < total) await delay(300);
  }

  return { source, courses, fetched, total: Number.isFinite(total) ? total : fetched };
}

async function fetchCoursePageFromBackground(page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await delay(Math.min(2000 * (2 ** (attempt - 1)), 10000));
    }

    const response = await fetch(buildCourseUrl(page), {
      credentials: "include",
      headers: { Accept: "application/json" }
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("unauthorized");
    }

    if (response.status === 429) {
      lastError = new Error(`评分数据刷新失败：HTTP 429（请求过于频繁，第 ${attempt + 1} 次尝试）`);
      continue;
    }

    if (!response.ok) {
      throw new Error(`评分数据刷新失败：HTTP ${response.status}`);
    }

    return response.json();
  }

  throw lastError || new Error("评分数据刷新失败：HTTP 429（重试已用尽）");
}

function buildCourseUrl(page) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    order_by: "rating_score"
  });
  return `${API_BASE}/course/?${params}`;
}

function buildRatingStore(rawCourses) {
  const ratings = {};
  const courses = [];

  for (const raw of rawCourses) {
    const course = normalizeCourse(raw);
    if (!course) continue;
    courses.push(course);

    for (const key of buildKeys(course.name, course.teachers)) {
      ratings[key] = chooseBetterRating(ratings[key], course);
    }
  }

  return { ratings, courses, indexCount: Object.keys(ratings).length };
}

function normalizeCourse(course) {
  const name = pickString(course, ["name", "title", "course_name", "courseName"]);
  const teachers = normalizeTeachers(course);
  const rating = course?.rating && typeof course.rating === "object" ? course.rating : course;
  const score = pickNumber(rating, [
    "avg",
    "average",
    "rating_score",
    "rating",
    "score",
    "avg_rating",
    "average_rating"
  ]);

  if (!name || !Number.isFinite(score) || score <= 0) return null;

  return {
    id: course.id ?? course.course_id ?? course.courseId ?? null,
    code: course.code ?? course.course_code ?? "",
    name,
    teachers,
    score: Math.round(score * 10) / 10,
    ratingCount: pickNumber(rating, ["count", "rating_count", "review_count", "reviews_count"]) ?? 0
  };
}

function normalizeTeachers(course) {
  const raw = course.teachers ?? course.teacher_names ?? course.teacher ?? course.instructors;
  const mainTeacher = course.main_teacher ?? course.mainTeacher;
  const values = [];

  if (mainTeacher) values.push(mainTeacher);
  if (Array.isArray(raw)) values.push(...raw);
  else if (raw) values.push(raw);

  return values
    .flatMap((item) => {
      if (typeof item === "string") return item.split(/[,，、/;\s]+/);
      const name = pickString(item, ["name", "teacher_name", "teacherName"]);
      return name ? [name] : [];
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildKeys(name, teachers) {
  const normalizedName = normalizeText(name);
  const keys = new Set([normalizedName]);

  for (const teacher of teachers) {
    const normalizedTeacher = normalizeText(teacher);
    if (normalizedTeacher) keys.add(`${normalizedName}::${normalizedTeacher}`);
  }

  return [...keys].filter(Boolean);
}

function chooseBetterRating(previous, next) {
  if (!previous) return next;
  return (next.ratingCount ?? 0) > (previous.ratingCount ?? 0) ? next : previous;
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .trim()
    .toLowerCase();
}

function pickString(source, keys) {
  for (const key of keys) {
    if (typeof source?.[key] === "string" && source[key].trim()) return source[key].trim();
  }
  return "";
}

function pickNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthLikeError(error) {
  return /unauthorized|401|403|登录|login/i.test(error?.message ?? "");
}
