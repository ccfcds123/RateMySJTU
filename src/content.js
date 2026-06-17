const BADGE_CLASS = "ratemysjtu-badge";
const BADGE_LOW_CLASS = "ratemysjtu-badge-low";
const BADGE_NONE_CLASS = "ratemysjtu-badge-none";
const BADGE_EMPTY_CLASS = "ratemysjtu-empty";
const MARKED_ATTR = "data-ratemysjtu-marked";

const COURSE_HEADER_RE = /课程(名称|名)?|kcmc|course/i;
const TEACHER_HEADER_RE = /教师|老师|任课|skjs|teacher|instructor/i;
const COURSE_FIELD_RE = /kcmc|course.?name|课程/i;

let ratingIndex = {};
let ratingKeys = new Set();
let codeToCourse = {};
let annotateTimer = 0;

init();

async function init() {
  const data = await chrome.runtime.sendMessage({ type: "GET_RATINGS" });
  updateRatings(data?.ratings ?? {}, data?.courses ?? []);
  annotatePage();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.ratings) return;
    updateRatings(
      changes.ratings.newValue ?? {},
      changes.courses?.newValue ?? []
    );
    clearBadges();
    annotatePage();
  });

  const observer = new MutationObserver(scheduleAnnotate);
  observer.observe(document.body, { childList: true, subtree: true });
}

function updateRatings(nextRatings, nextCourses) {
  ratingIndex = nextRatings || {};
  ratingKeys = new Set(Object.keys(ratingIndex));
  codeToCourse = {};
  for (const course of (nextCourses || [])) {
    if (course.code && course.name) {
      codeToCourse[course.code.toUpperCase()] = course.name;
    }
  }
}

function scheduleAnnotate() {
  window.clearTimeout(annotateTimer);
  annotateTimer = window.setTimeout(annotatePage, 200);
}

function annotatePage() {
  if (!ratingKeys.size) {
    showEmptyStateOnce();
    return;
  }

  document.querySelector(`.${BADGE_EMPTY_CLASS}`)?.remove();

  const localCodeMap = buildLocalCodeMap();
  annotateSubRows(localCodeMap);
  annotateTables();
  annotateGridLikeRows();
  annotateLooseCourseNodes();
}

function buildLocalCodeMap() {
  const localCodeMap = { ...codeToCourse };

  // Scan ALL elements for (CODE) CourseName patterns, not just table rows
  const allElements = document.querySelectorAll("td, th, span, div, a, li, h1, h2, h3, h4, h5, h6, p, label");
  for (const el of allElements) {
    const text = (el.textContent || "").trim();
    const match = text.match(/\(([A-Z]{2,5}\d{3,6})\)\s*(.+)/);
    if (!match) continue;

    const code = match[1].toUpperCase();
    if (localCodeMap[code]) continue;

    // Extract course name from the text after the code
    let rest = match[2];
    // Strip our own badges
    rest = rest.replace(/\s*⭐\s*\d+(\.\d+)?/g, "").trim();
    // Stop at common delimiters
    rest = rest.split(/\s{2,}| {2,}|\t|\n|- \d|教学班|学分|状态/)[0].trim();
    if (rest.length >= 2 && rest.length <= 60) {
      localCodeMap[code] = rest;
      console.log("[RateMySJTU] 映射:", code, "→", rest);
    }
  }

  console.log("[RateMySJTU] 编码映射:", Object.keys(localCodeMap).length, "条");
  return localCodeMap;
}

function findParentCourseName(subRow, targetCode) {
  // Walk up DOM to find course name in a nearby parent container
  let el = subRow.parentElement;
  for (let depth = 0; depth < 8 && el && el !== document.body; depth += 1) {
    const text = (el.textContent || "").trim();
    const match = text.match(/\(([A-Z]{2,5}\d{3,6})\)\s*(.+)/);
    if (match && match[1].toUpperCase() === targetCode) {
      let name = match[2].replace(/\s*⭐\s*\d+(\.\d+)?/g, "").trim();
      name = name.split(/\s{2,}| {2,}|\t|\n|- \d|教学班|学分|状态/)[0].trim();
      if (name.length >= 2 && name.length <= 60) return name;
    }
    el = el.parentElement;
  }
  return null;
}

function annotateSubRows(localCodeMap) {
  const candidateRows = document.querySelectorAll("tr, .datagrid-row, [role='row']");
  let annotated = 0;

  for (const row of candidateRows) {
    if (row.querySelector("th")) continue;
    if (isMainCourseRow(row)) continue;

    const rowText = row.textContent || "";
    const classMatch = rowText.match(/([A-Z]{2,5}\d{3,6})-\d{1,3}/);
    const bracketTeacher = rowText.match(/【(.+?)】/);

    if (!classMatch || !bracketTeacher) continue;

    const courseCode = classMatch[1].toUpperCase();
    let courseName = localCodeMap[courseCode];

    if (!courseName) {
      // Try to find course name from parent DOM context
      courseName = findParentCourseName(row, courseCode);
      if (courseName) {
        localCodeMap[courseCode] = courseName;
        console.log("[RateMySJTU] 父级映射:", courseCode, "→", courseName);
      }
    }

    if (!courseName) {
      console.log("[RateMySJTU] 子行未找到课程:", courseCode);
      continue;
    }

    const teacherName = bracketTeacher[1].trim();
    const ratings = findRatings(courseName, [teacherName]);

    const cells = [...row.querySelectorAll("td, [role='gridcell']")];
    const teacherCell = cells.find((cell) => cell.textContent.includes("【"));
    if (!teacherCell) continue;

    if (ratings.length) {
      appendBadges(teacherCell, ratings, "subRow");
    } else {
      appendNoRatingBadge(teacherCell, courseName);
    }
    annotated += 1;
  }

  console.log("[RateMySJTU] 子行标注:", annotated, "条");
}

function annotateTables() {
  for (const table of document.querySelectorAll("table")) {
    const columns = detectColumns(table);

    for (const row of table.querySelectorAll("tbody tr, tr")) {
      if (row.querySelector("th")) continue;
      if (isMainCourseRow(row)) continue;

      const cells = [...row.children];
      const rowText = row.textContent || "";

      // Skip sub-rows (already handled by annotateSubRows)
      if (rowText.match(/([A-Z]{2,5}\d{3,6})-\d{1,3}/) && rowText.match(/【(.+?)】/)) continue;

      if (columns.name < 0) continue;
      const nameCell = cells[columns.name];
      if (!nameCell || nameCell.hasAttribute(MARKED_ATTR)) continue;

      const courseName = extractCourseName(nameCell);
      if (!courseName) continue;

      const teacherCell = columns.teacher >= 0 ? cells[columns.teacher] : null;
      const teacherName = teacherCell
        ? cleanText(teacherCell)
        : extractTeacherFromRow(row);

      if (!teacherName) continue;

      const ratings = findRatings(courseName, [teacherName]);
      if (!ratings.length) continue;

      appendBadges(teacherCell || nameCell, ratings, "table");
    }
  }
}

function annotateGridLikeRows() {
  const rows = document.querySelectorAll(".ui-jqgrid tr, .datagrid-row, [role='row']");
  for (const row of rows) {
    if (!(row instanceof HTMLElement) || row.hasAttribute(MARKED_ATTR)) continue;
    if (isMainCourseRow(row)) continue;
    const nameNode = findCourseNodeInRow(row);
    if (!nameNode || nameNode.hasAttribute(MARKED_ATTR)) continue;

    const courseName = extractCourseName(nameNode);
    const teacherName = extractTeacherFromRow(row);
    const ratings = findRatings(courseName, teacherName ? [teacherName] : []);
    if (ratings.length) {
      appendBadges(nameNode, ratings, "grid");
      row.setAttribute(MARKED_ATTR, "true");
    }
  }
}

function annotateLooseCourseNodes() {
  const selector = [
    "[name*='kcmc' i]",
    "[id*='kcmc' i]",
    "[data-field*='kcmc' i]",
    "[aria-label*='课程']"
  ].join(",");

  for (const node of document.querySelectorAll(selector)) {
    if (!(node instanceof HTMLElement) || node.hasAttribute(MARKED_ATTR)) continue;
    if (node.querySelector(`.${BADGE_CLASS}`)) continue;

    const parentRow = node.closest("tr, .datagrid-row, [role='row']");
    if (parentRow) {
      if (isMainCourseRow(parentRow)) continue;
      if (parentRow.querySelector(`[${MARKED_ATTR}]`)) continue;
    }

    const courseName = extractCourseName(node);
    if (!looksLikeCourseName(courseName)) continue;

    // Skip if the node itself looks like a main course row
    if (isMainCourseRow(node)) continue;

    const teacherName = closestRowTeacher(node);
    const ratings = findRatings(courseName, teacherName ? [teacherName] : []);
    if (ratings.length) appendBadges(node, ratings, "loose");
  }
}

function detectColumns(table) {
  const rows = [...table.querySelectorAll("tr")].slice(0, 5);
  for (const row of rows) {
    const headers = [...row.children].map((cell) => cleanText(cell));
    const name = headers.findIndex((text) => COURSE_HEADER_RE.test(text));
    if (name >= 0) {
      return {
        name,
        teacher: headers.findIndex((text) => TEACHER_HEADER_RE.test(text))
      };
    }
  }
  return { name: -1, teacher: -1 };
}

function findCourseNodeInRow(row) {
  const direct = row.querySelector("[name*='kcmc' i], [id*='kcmc' i], [data-field*='kcmc' i], [aria-label*='课程']");
  if (direct instanceof HTMLElement) return direct;

  const cells = [...row.querySelectorAll("td, [role='gridcell']")];
  return cells.find((cell) => looksLikeCourseName(extractCourseName(cell))) ?? null;
}

function extractCourseName(node) {
  const text = cleanText(node)
    .replace(/^\[[^\]]+\]/, "")
    .replace(/^课程(名称|名)?[:：]/, "")
    .replace(/\s*⭐\s*\d+(\.\d+)?$/, "")
    .trim();

  if (looksLikeCourseName(text)) return text;

  const attrs = ["title", "data-title", "data-original-title", "value"];
  for (const attr of attrs) {
    const value = node.getAttribute?.(attr);
    if (looksLikeCourseName(value)) return value.trim();
  }

  return text;
}

function extractTeacherFromRow(row) {
  const rowText = row.textContent || "";
  const bracketMatch = rowText.match(/【(.+?)】/);
  if (bracketMatch) return bracketMatch[1].trim();

  const teacherNode = row.querySelector("[name*='js' i], [id*='js' i], [data-field*='js' i], [aria-label*='教师']");
  return teacherNode ? cleanText(teacherNode) : "";
}

function isMainCourseRow(row) {
  const text = (row.textContent || "").trim();
  if (/\([A-Z]{2,5}\d{3,6}\)/.test(text)) return true;
  // Bare course code without sub-row markers (no CODE-NN, no 【】)
  if (/[A-Z]{2,5}\d{3,6}/.test(text) &&
      !/[A-Z]{2,5}\d{3,6}-\d{1,3}/.test(text) &&
      !/【/.test(text)) return true;
  return false;
}

function closestRowTeacher(node) {
  const row = node.closest("tr, .datagrid-row, [role='row']");
  return row ? extractTeacherFromRow(row) : "";
}

function findRatings(courseName, teacherNames) {
  const nameKey = normalizeText(courseName);
  if (!nameKey) return [];

  const rawCandidates = teacherNames.flatMap((t) => splitTeachers(t)).filter(Boolean);
  const seen = new Set();
  const results = [];
  const hasTeacher = rawCandidates.length > 0;

  for (const rawTeacher of rawCandidates) {
    const teacherKey = normalizeText(rawTeacher);
    if (!teacherKey) continue;
    const rating = ratingIndex[`${nameKey}::${teacherKey}`];
    if (rating && !seen.has(rating)) {
      seen.add(rating);
      results.push({ ...rating, matchedTeacher: rawTeacher });
    }
  }

  if (results.length > 0) return results;

  // Only use course-level or fuzzy matching when NO teacher was specified
  if (!hasTeacher) {
    const exact = ratingIndex[nameKey];
    if (exact) return [exact];

    const fuzzy = fuzzyFind(nameKey);
    if (fuzzy) return [fuzzy];
  }

  return [];
}

function fuzzyFind(nameKey) {
  if (nameKey.length < 6) return null;
  for (const key of ratingKeys) {
    if (key.includes("::")) continue;
    if (key === nameKey) return ratingIndex[key];
    // Require substantial overlap: one must contain the other and length ratio ≥ 0.6
    if ((key.includes(nameKey) || nameKey.includes(key)) &&
        Math.min(key.length, nameKey.length) / Math.max(key.length, nameKey.length) >= 0.6) {
      return ratingIndex[key];
    }
  }
  return null;
}

function appendBadges(target, ratings, source) {
  if (!ratings.length) return;
  if (target.querySelector(`.${BADGE_CLASS}`)) return;

  const preview = (target.textContent || "").replace(/\s+/g, " ").trim().substring(0, 60);
  console.log("[RateMySJTU] 标注 [" + (source || "?") + "]:", preview, "→", ratings.map((r) => r.score).join(","));

  target.appendChild(document.createTextNode(" "));

  const showTeacher = ratings.length > 1;

  for (const rating of ratings) {
    const badge = document.createElement("a");
    badge.className = `${BADGE_CLASS}${rating.score < 3.5 ? ` ${BADGE_LOW_CLASS}` : ""}`;
    badge.title = buildTitle(rating) + " — 点击查看选课社区详情";
    const teacherLabel = showTeacher && rating.matchedTeacher
      ? `${rating.matchedTeacher} `
      : "";
    badge.textContent = `⭐ ${teacherLabel}${Number(rating.score).toFixed(1)}`;

    if (rating.id) {
      badge.href = `https://course.sjtu.plus/course/${rating.id}`;
      badge.target = "_blank";
      badge.rel = "noopener noreferrer";
    } else {
      badge.style.cursor = "default";
      badge.style.textDecoration = "none";
    }

    target.appendChild(badge);
  }

  target.setAttribute(MARKED_ATTR, "true");
}

function appendNoRatingBadge(target, courseName) {
  if (target.querySelector(`.${BADGE_CLASS}`)) return;

  let courseId = null;
  if (courseName) {
    const nameKey = normalizeText(courseName);
    courseId = ratingIndex[nameKey]?.id;
    if (!courseId) {
      for (const key of ratingKeys) {
        if (key.startsWith(nameKey + "::")) {
          courseId = ratingIndex[key]?.id;
          if (courseId) break;
        }
      }
    }
  }

  const badge = document.createElement(courseId ? "a" : "span");
  badge.className = `${BADGE_CLASS} ${BADGE_NONE_CLASS}`;
  badge.textContent = "无评分";

  if (courseId) {
    badge.href = `https://course.sjtu.plus/course/${courseId}`;
    badge.target = "_blank";
    badge.rel = "noopener noreferrer";
    badge.title = "点击查看选课社区详情";
  }

  target.appendChild(document.createTextNode(" "));
  target.appendChild(badge);
  target.setAttribute(MARKED_ATTR, "true");
}

function buildTitle(rating) {
  const teacherText = rating.teachers?.length ? ` - ${rating.teachers.join("、")}` : "";
  const countText = rating.ratingCount ? `，${rating.ratingCount} 条点评` : "";
  return `${rating.name}${teacherText}${countText}`;
}

function clearBadges() {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
  document.querySelectorAll(`[${MARKED_ATTR}]`).forEach((node) => node.removeAttribute(MARKED_ATTR));
}

function showEmptyStateOnce() {
  if (document.querySelector(`.${BADGE_EMPTY_CLASS}`)) return;
  const hint = document.createElement("div");
  hint.className = BADGE_EMPTY_CLASS;
  hint.textContent = "RateMySJTU：暂无本地评分数据，请在插件弹窗中刷新。";
  document.documentElement.appendChild(hint);
  window.setTimeout(() => hint.remove(), 6000);
}

function looksLikeCourseName(value) {
  const text = String(value ?? "").trim();
  if (text.length < 2 || text.length > 80) return false;
  if (COURSE_FIELD_RE.test(text)) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(text);
}

function cleanText(node) {
  if (!node) return "";
  return [...node.childNodes]
    .filter((child) => !(child instanceof HTMLElement && child.classList.contains(BADGE_CLASS)))
    .map((child) => child.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTeachers(value) {
  return String(value ?? "")
    .split(/[,，、/;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .trim()
    .toLowerCase();
}
