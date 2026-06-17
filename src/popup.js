const refreshButton = document.querySelector("#refresh");
const summary = document.querySelector("#summary");
const statusEl = document.querySelector("#status");
const stateEl = document.querySelector("#state");
const indexCountEl = document.querySelector("#indexCount");
const courseCountEl = document.querySelector("#courseCount");
const fetchedCountEl = document.querySelector("#fetchedCount");
const totalCountEl = document.querySelector("#totalCount");

refreshButton.addEventListener("click", refresh);
loadSummary();

async function loadSummary() {
  const data = await chrome.runtime.sendMessage({ type: "GET_RATINGS" });
  const indexCount = Object.keys(data?.ratings ?? {}).length;
  const courseCount = Array.isArray(data?.courses) ? data.courses.length : 0;
  const lastUpdated = data?.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : "尚未刷新";
  const stats = data?.lastStats;

  indexCountEl.textContent = String(indexCount);
  courseCountEl.textContent = String(courseCount);
  fetchedCountEl.textContent = stats?.fetched ? String(stats.fetched) : "—";
  totalCountEl.textContent = stats?.total ? String(stats.total) : "—";
  summary.textContent = `更新时间：${lastUpdated}`;

  if (data?.lastError) {
    setState("失败", true);
    statusEl.textContent = data.lastError;
  } else if (indexCount > 0) {
    setState("可用", false);
    const sourceLabel = stats?.source === "course-tab" ? "选课社区页面" : "后台请求";
    statusEl.textContent = `来源：${sourceLabel}，读取 ${stats?.fetched ?? "?"} 条记录，其中 ${courseCount} 门课程有评分。`;
  } else {
    setState("待刷新", false);
    statusEl.textContent = "请先登录并打开选课社区，然后点击刷新数据。";
  }
}

async function refresh() {
  refreshButton.disabled = true;
  setState("刷新中", false);
  statusEl.textContent = "正在读取选课社区评分...";

  const result = await chrome.runtime.sendMessage({ type: "REFRESH_RATINGS" });
  if (result?.ok) {
    setState("可用", false);
    statusEl.textContent = `刷新完成：读取 ${result.fetched} 门，解析 ${result.coursesWithRating} 门有评分课程。`;
  } else {
    setState("失败", true);
    statusEl.textContent = result?.error || "刷新失败。";
  }

  refreshButton.disabled = false;
  await loadSummary();
}

function setState(text, isError) {
  stateEl.textContent = text;
  stateEl.classList.toggle("error", Boolean(isError));
}
