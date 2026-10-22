const API_BASE = "https://api.weglide.org/v1";
const CLUB_ID = 709;
const DEFAULT_CONTEST = "free";
const CLUB_AIRCRAFT_REGISTRATIONS = "JA2412,JA2442,JA2444";
const CLASS_LABELS = {
  all: "All Class",
  club: "Club Class",
  "club-aircraft": "クラブ機Class",
};

const elements = {
  season: document.querySelector("#season-select"),
  month: document.querySelector("#month-select"),
  aircraftClass: document.querySelector("#class-select"),
  regions: [...document.querySelectorAll(".segment-button")],
  ranking: document.querySelector("#ranking-select"),
  download: document.querySelector("#download-button"),
  refresh: document.querySelector("#refresh-button"),
  status: document.querySelector("#status"),
  statusText: document.querySelector("#status-text"),
  monthly: document.querySelector("#monthly-ranking"),
  monthlyCaption: document.querySelector("#monthly-caption"),
  pilots: document.querySelector("#pilot-ranking"),
  rankingEyebrow: document.querySelector("#ranking-eyebrow"),
  rankingTitle: document.querySelector("#ranking-title"),
  rankingCaption: document.querySelector("#ranking-caption"),
  rankingFootnote: document.querySelector("#ranking-footnote"),
};

let currentFlights = [];
let visibleFlights = [];
let selectedRegion = "domestic";
let currentDataSource = "";
let unclassifiedFlightCount = 0;

function setStatus(message, state = "loading") {
  elements.status.dataset.state = state;
  elements.statusText.textContent = message;
}

function cacheKey(season, aircraftClass) {
  return `weglide-club-${CLUB_ID}-${season}-${DEFAULT_CONTEST}-${aircraftClass}`;
}

function readCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.flights;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      return null;
    }
  }
  return null;
}

async function loadFlights(season, aircraftClass, forceRefresh = false) {
  const key = cacheKey(season, aircraftClass);
  if (!forceRefresh) {
    const cached = readCache(key);
    if (cached) return { flights: cached, cached: true };
  }

  const flights = [];
  const startDate = `${season}-01-01`;
  const endDate = `${season}-12-31`;
  for (let skip = 0; skip < 2000; skip += 100) {
    const params = new URLSearchParams({
      club_id_in: String(CLUB_ID),
      scoring_date_start: startDate,
      scoring_date_end: endDate,
      contest: DEFAULT_CONTEST,
      include_stats: "true",
      include_story: "false",
      limit: "100",
      skip: String(skip),
    });
    if (aircraftClass === "club") params.set("sc_class_id_in", "CL");
    if (aircraftClass === "club-aircraft") params.set("registration_in", CLUB_AIRCRAFT_REGISTRATIONS);
    const response = await fetch(`${API_BASE}/flight?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`WeGlide API error (${response.status})`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("WeGlide APIから予期しない形式の応答がありました。");
    flights.push(...page);
    if (page.length < 100) break;
  }

  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), flights }));
  } catch {
    // The dashboard still works when browser storage is unavailable.
  }
  return { flights, cached: false };
}

function flightScore(flight) {
  const value = Number(flight?.contest?.points);
  return Number.isFinite(value) ? value : null;
}

function flightStats(flight) {
  return flight?.contest?.score ?? {};
}

function safeNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits }).format(value);
}

function monthKey(flight) {
  return typeof flight.scoring_date === "string" ? flight.scoring_date.slice(0, 7) : "";
}

function regionForFlight(flight) {
  const region = flight.takeoff_airport?.region ?? flight.custom_takeoff_airport?.region;
  if (typeof region !== "string" || !region.trim()) return null;
  return region.trim().toUpperCase() === "JP" ? "domestic" : "overseas";
}

function flightHref(flight) {
  return `https://www.weglide.org/flight/${encodeURIComponent(flight.id)}`;
}

function flightDurationMinutes(flight) {
  const takeoff = Date.parse(flight.takeoff_time);
  const landing = Date.parse(flight.landing_time);
  if (!Number.isFinite(takeoff) || !Number.isFinite(landing) || landing < takeoff) return null;
  return Math.round((landing - takeoff) / 60000);
}

function formatFlightDuration(flight) {
  const minutes = flightDurationMinutes(flight);
  if (minutes == null) return "飛行時間不明";
  return formatDurationMinutes(minutes);
}

function formatDurationMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}時間${String(remainingMinutes).padStart(2, "0")}分` : `${minutes}分`;
}

function updateMetrics(flights) {
  const pilots = new Set(flights.map((flight) => flight.user?.id).filter((id) => id != null));
  const bestFlight = flights.reduce((best, flight) =>
    flightScore(flight) != null && (!best || flightScore(flight) > flightScore(best)) ? flight : best, null);
  const longestFlight = flights.reduce((best, flight) => {
    const distance = safeNumber(flight.contest?.distance);
    return distance != null && (!best || distance > safeNumber(best.contest?.distance)) ? flight : best;
  }, null);

  document.querySelector("#metric-flights").textContent = formatNumber(flights.length, 0);
  document.querySelector("#metric-pilots").textContent = formatNumber(pilots.size, 0);
  document.querySelector("#metric-points").textContent = bestFlight ? formatNumber(flightScore(bestFlight), 1) : "—";
  document.querySelector("#metric-points-note").textContent = bestFlight ? `${bestFlight.user?.name ?? "Unknown"} · ${bestFlight.scoring_date}` : "対象データなし";
  document.querySelector("#metric-distance").textContent = longestFlight ? `${formatNumber(longestFlight.contest.distance, 1)} km` : "—";
  document.querySelector("#metric-distance-note").textContent = longestFlight ? `${longestFlight.user?.name ?? "Unknown"} · ${longestFlight.scoring_date}` : "対象データなし";
}

function groupMonthlyBest(flights) {
  const months = new Map();
  for (const flight of flights) {
    const month = monthKey(flight);
    const score = flightScore(flight);
    if (!month || score == null || !flight.user?.id) continue;
    if (!months.has(month)) months.set(month, new Map());
    const pilots = months.get(month);
    const current = pilots.get(flight.user.id);
    if (!current || score > flightScore(current)) pilots.set(flight.user.id, flight);
  }
  return [...months.entries()].sort(([a], [b]) => b.localeCompare(a));
}

function renderMonthly(flights) {
  const months = groupMonthlyBest(flights);
  if (months.length === 0) {
    elements.monthly.innerHTML = '<p class="empty-state">この期間の月間ランキングはありません。</p>';
    return;
  }

  elements.monthly.innerHTML = months.map(([month, pilots], monthIndex) => {
    const [year, monthNumber] = month.split("-");
    const rankedPilots = [...pilots.values()].sort((a, b) => flightScore(b) - flightScore(a));
    const podiumPilots = rankedPilots.slice(0, 3);
    const podiumMarkup = podiumPilots.length === 3 ? `
      <div class="podium" aria-label="${year}年${Number(monthNumber)}月 上位3名">
        ${podiumPilots.map((flight, index) => `
          <article class="podium-place podium-place-${index + 1}">
            <span class="podium-rank">${index + 1}</span>
            <a class="pilot-name" href="${flightHref(flight)}" target="_blank" rel="noreferrer" aria-label="WeGlideで${flight.scoring_date}のフライトを開く">${escapeHtml(flight.user.name)}</a>
            <span class="podium-score">${formatNumber(flightScore(flight), 1)} pts</span>
            <a class="podium-date flight-link" href="${flightHref(flight)}" target="_blank" rel="noreferrer" aria-label="WeGlideで${flight.scoring_date}のフライトを開く">${flight.scoring_date.slice(5)} ↗</a>
          </article>`).join("")}
      </div>` : "";
    const listStart = podiumPilots.length === 3 ? 3 : 0;
    const remainingMarkup = rankedPilots.slice(listStart).map((flight, index) => {
      const rank = index + listStart + 1;
      return `
        <div class="month-winner">
          <span class="rank-number">${String(rank).padStart(2, "0")}</span>
          <a class="pilot-name" href="${flightHref(flight)}" target="_blank" rel="noreferrer" aria-label="WeGlideで${flight.scoring_date}のフライトを開く">${escapeHtml(flight.user.name)}</a>
          <a class="flight-meta flight-link" href="${flightHref(flight)}" target="_blank" rel="noreferrer" aria-label="WeGlideで${flight.scoring_date}のフライトを開く">${flight.scoring_date} ↗</a>
          <span class="winner-score">${formatNumber(flightScore(flight), 1)} pts</span>
        </div>`;
    }).join("");
    const rankingsMarkup = `${podiumMarkup}${remainingMarkup ? `<div class="month-ranking-list">${remainingMarkup}</div>` : ""}`;
    return `<article class="month-row" style="animation-delay:${Math.min(monthIndex, 8) * 35}ms">
      <div class="month-stamp">${year}.${monthNumber}<small>${pilots.size} PILOTS</small></div>
      <div class="month-winners">${rankingsMarkup}</div>
    </article>`;
  }).join("");
}

const flightRankingOptions = {
  thermal: {
    value: (flight) => safeNumber(flightStats(flight).thermal_avg),
    eligible: (flight) => safeNumber(flightStats(flight).thermal_avg) != null
      && safeNumber(flightStats(flight).thermal_count) > 0,
    format: (value) => `${formatNumber(value, 2)} m/s`,
    detail: (flight) => `${flight.scoring_date} · ${formatFlightDuration(flight)} · ${flightStats(flight).thermal_count} thermals`,
    caption: "各フライトの平均サーマル上昇率で比較します。",
  },
  glide: {
    value: (flight) => safeNumber(flightStats(flight).glide_ratio),
    eligible: (flight) => safeNumber(flightStats(flight).glide_ratio) > 0,
    format: (value) => `${formatNumber(value, 1)} : 1`,
    detail: (flight) => `${flight.scoring_date} · ${formatFlightDuration(flight)} · ${formatNumber(flight.contest?.distance ?? 0, 1)} km`,
    caption: "各フライトの平均滑空比で比較します。",
  },
  speed: {
    value: (flight) => safeNumber(flight.contest?.speed),
    eligible: (flight) => safeNumber(flight.contest?.distance) >= 50
      && safeNumber(flight.contest?.speed) != null,
    format: (value) => `${formatNumber(value, 1)} km/h`,
    detail: (flight) => `${flight.scoring_date} · ${formatFlightDuration(flight)} · ${formatNumber(flight.contest.distance, 1)} km`,
    caption: "各フライトの平均速度で比較。飛行距離50km以上の便のみ対象です。",
  },
  duration: {
    value: (flight) => flightDurationMinutes(flight),
    eligible: (flight) => flightDurationMinutes(flight) != null,
    format: (value) => formatDurationMinutes(value),
    detail: (flight) => `${flight.scoring_date} · ${formatNumber(flight.contest?.distance ?? 0, 1)} km`,
    caption: "離陸から着陸までの飛行時間が長い順に表示します。",
  },
};

function renderPilots(flights) {
  const option = flightRankingOptions[elements.ranking.value];
  elements.rankingEyebrow.innerHTML = '<span class="eyebrow-line"></span> FLIGHT INDEX';
  elements.rankingTitle.textContent = "個別Indexランキング";
  const rows = flights
    .filter((flight) => flight.user?.id && option.eligible(flight))
    .sort((a, b) => option.value(b) - option.value(a))
    .slice(0, 8);
  elements.rankingCaption.textContent = option.caption;
  elements.rankingFootnote.textContent = "各フライトのWeGlide主操縦者名義で表示しています。";
  if (!rows.length) {
    elements.pilots.innerHTML = '<p class="empty-state">ランキング対象となる記録がまだありません。</p>';
    return;
  }
  const maxValue = Math.max(...rows.map(option.value), 0);
  elements.pilots.innerHTML = rows.map((flight, index) => {
    const amount = option.value(flight);
    const width = maxValue > 0 ? Math.max(4, amount / maxValue * 100) : 4;
    return `<article class="pilot-row">
      <span class="pilot-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="pilot-info">
        <a class="pilot-name" href="${flightHref(flight)}" target="_blank" rel="noreferrer" aria-label="WeGlideで${flight.scoring_date}のフライトを開く">${escapeHtml(flight.user.name)}</a>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      </div>
      <div class="pilot-value"><strong>${option.format(amount)}</strong><small>${escapeHtml(option.detail(flight))}</small></div>
    </article>`;
  }).join("");
}

function getFilteredFlights() {
  const month = elements.month.value;
  return month === "all"
    ? visibleFlights
    : visibleFlights.filter((flight) => flight.scoring_date?.slice(5, 7) === month);
}

function csvCell(value, protectText = false) {
  let text = String(value ?? "");
  if (protectText && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv() {
  const flights = getFilteredFlights();
  const option = flightRankingOptions[elements.ranking.value];
  const monthlyRanks = new Map();
  for (const [, pilots] of groupMonthlyBest(flights)) {
    [...pilots.values()]
      .sort((a, b) => flightScore(b) - flightScore(a))
      .forEach((flight, index) => monthlyRanks.set(flight.id, index + 1));
  }
  const metricRanks = new Map(flights
    .filter((flight) => flight.user?.id && option.eligible(flight))
    .sort((a, b) => option.value(b) - option.value(a))
    .map((flight, index) => [flight.id, index + 1]));
  const metricLabels = {
    thermal: "平均上昇率",
    glide: "平均滑空比",
    speed: "平均速度",
    duration: "飛行時間(分)",
  };
  const headers = ["地域", "クラス", "年月", "月間順位", "指標順位", "順位指標", "指標値", "日付", "飛行時間(分)", "主操縦者", "フライトID", "WeGlide URL", "距離(km)", "平均上昇率(m/s)", "平均滑空比", "平均速度(km/h)", "得点"];
  const rows = flights.map((flight) => {
    const score = flightScore(flight);
    const distance = safeNumber(flight.contest?.distance);
    const thermalRate = safeNumber(flightStats(flight).thermal_avg);
    const glideRatio = safeNumber(flightStats(flight).glide_ratio);
    const speed = safeNumber(flight.contest?.speed);
    const metricValue = metricRanks.has(flight.id) ? option.format(option.value(flight)) : "";
    return [
      selectedRegion === "domestic" ? "日本国内" : "海外",
      CLASS_LABELS[elements.aircraftClass.value],
      monthKey(flight),
      monthlyRanks.get(flight.id) ?? "",
      metricRanks.get(flight.id) ?? "",
      metricLabels[elements.ranking.value],
      metricValue,
      flight.scoring_date,
      flightDurationMinutes(flight) ?? "",
      flight.user?.name ?? "",
      flight.id,
      flightHref(flight),
      distance ?? "",
      thermalRate ?? "",
      glideRatio ?? "",
      speed ?? "",
      score ?? "",
    ].map((value, index) => csvCell(value, index === 7)).join(",");
  });
  const csv = `\uFEFF${[headers.map((value) => csvCell(value)).join(","), ...rows].join("\r\n")}`;
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  const regionSlug = selectedRegion === "domestic" ? "japan" : "overseas";
  const monthSlug = elements.month.value === "all" ? "all-months" : elements.month.value;
  const classSlug = elements.aircraftClass.value;
  link.href = blobUrl;
  link.download = `jsc-${elements.season.value}-${regionSlug}-${monthSlug}-${classSlug}-${elements.ranking.value}.csv`;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function setLoading(loading) {
  elements.refresh.disabled = loading;
  elements.download.disabled = loading;
  elements.refresh.classList.toggle("is-loading", loading);
  elements.season.disabled = loading;
  elements.month.disabled = loading;
  elements.aircraftClass.disabled = loading;
}

function renderCurrentFilters() {
  const month = elements.month.value;
  const filteredFlights = getFilteredFlights();
  const monthLabel = month === "all" ? "全月" : `${Number(month)}月`;
  const regionLabel = selectedRegion === "domestic" ? "日本国内" : "海外";
  const classLabel = CLASS_LABELS[elements.aircraftClass.value];
  const season = elements.season.value;

  updateMetrics(filteredFlights);
  renderMonthly(filteredFlights);
  renderPilots(filteredFlights);
  elements.monthlyCaption.textContent = month === "all"
    ? "各月の全順位を表示し、上位3名を表彰台で強調します。"
    : `${monthLabel}の全順位を表示し、上位3名を表彰台で強調します。`;

  const unclassifiedNote = unclassifiedFlightCount ? ` · 地域不明 ${unclassifiedFlightCount}便を除外` : "";
  setStatus(`${filteredFlights.length} flights · ${regionLabel} · ${classLabel} · ${season} · ${monthLabel} · ${currentDataSource}${unclassifiedNote}`, "loaded");
}

async function refreshDashboard(forceRefresh = false) {
  const season = Number(elements.season.value);
  const aircraftClass = elements.aircraftClass.value;
  const regionLabel = selectedRegion === "domestic" ? "日本国内" : "海外";
  const classLabel = CLASS_LABELS[aircraftClass];
  setLoading(true);
  setStatus(`${season}年の${regionLabel} ${classLabel}フライトを読み込み中`, "loading");
  try {
    const result = await loadFlights(season, aircraftClass, forceRefresh);
    currentFlights = result.flights;
    const regionFlights = currentFlights.filter((flight) => regionForFlight(flight) === selectedRegion);
    visibleFlights = regionFlights;
    unclassifiedFlightCount = currentFlights.filter((flight) => regionForFlight(flight) == null).length;
    document.querySelector("#last-sync").textContent = new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date());
    currentDataSource = result.cached ? "15分以内の保存データ" : "WeGlide API";
    renderCurrentFilters();
  } catch (error) {
    console.error(error);
    setStatus(error.message.includes("Failed to fetch")
      ? "APIに接続できません。ページをHTTPサーバーで開き、通信を確認してください。"
      : error.message, "error");
    elements.monthly.innerHTML = '<p class="empty-state">データを取得できませんでした。更新ボタンで再試行してください。</p>';
    elements.pilots.innerHTML = '<p class="empty-state">API接続後にランキングが表示されます。</p>';
  } finally {
    setLoading(false);
  }
}

function initialize() {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= 2019; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    elements.season.append(option);
  }
  elements.season.addEventListener("change", () => refreshDashboard());
  elements.month.addEventListener("change", renderCurrentFilters);
  elements.aircraftClass.addEventListener("change", () => refreshDashboard());
  for (const button of elements.regions) {
    button.addEventListener("click", () => {
      selectedRegion = button.dataset.region;
      for (const regionButton of elements.regions) {
        const isActive = regionButton === button;
        regionButton.classList.toggle("is-active", isActive);
        regionButton.setAttribute("aria-pressed", String(isActive));
      }
      refreshDashboard();
    });
  }
  elements.ranking.addEventListener("change", () => renderCurrentFilters());
  elements.download.addEventListener("click", downloadCsv);
  elements.refresh.addEventListener("click", () => refreshDashboard(true));
  refreshDashboard();
}

initialize();
