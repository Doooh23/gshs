/* Quant Edge HTML client */

const STOCKS = [
  { symbol: "AAPL", name: "Apple Inc.", market: "US", currency: "USD" },
  { symbol: "MSFT", name: "Microsoft", market: "US", currency: "USD" },
  { symbol: "NVDA", name: "NVIDIA", market: "US", currency: "USD" },
  { symbol: "TSLA", name: "Tesla", market: "US", currency: "USD" },
  { symbol: "GOOGL", name: "Alphabet", market: "US", currency: "USD" },
  { symbol: "AMZN", name: "Amazon", market: "US", currency: "USD" },
  { symbol: "META", name: "Meta Platforms", market: "US", currency: "USD" },
  { symbol: "005930.KS", name: "삼성전자", market: "KR", currency: "KRW" },
  { symbol: "000660.KS", name: "SK하이닉스", market: "KR", currency: "KRW" },
  { symbol: "035420.KS", name: "NAVER", market: "KR", currency: "KRW" },
  { symbol: "035720.KS", name: "카카오", market: "KR", currency: "KRW" },
  { symbol: "005380.KS", name: "현대차", market: "KR", currency: "KRW" },
  { symbol: "068270.KS", name: "셀트리온", market: "KR", currency: "KRW" },
  { symbol: "105560.KS", name: "KB금융", market: "KR", currency: "KRW" },
];

const state = {
  view: "dashboard",
  symbol: "AAPL",
  interval: "1d",
  range: "1y",
  marketData: null,
  prediction: null,
  scannerResults: [],
  cache: new Map(),
  sidebarHidden: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const last = (arr) => arr[arr.length - 1];

function stockMeta(symbol) {
  return STOCKS.find((stock) => stock.symbol === symbol) || {
    symbol,
    name: symbol,
    market: symbol.endsWith(".KS") ? "KR" : "US",
    currency: symbol.endsWith(".KS") ? "KRW" : "USD",
  };
}

function formatPrice(value, currency = "USD") {
  if (!Number.isFinite(value)) return "-";
  if (currency === "KRW") return `₩${Math.round(value).toLocaleString("ko-KR")}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value, digits = 2, showPlus = true) {
  if (!Number.isFinite(value)) return "-";
  const sign = showPlus && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
}

function setView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}View`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (window.innerWidth <= 900) closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "analysis" && state.marketData) requestAnimationFrame(() => renderPriceChart(state.marketData, state.prediction));
}

function openSidebar() {
  const sidebar = $("#sidebar");
  const main = $(".main-content");
  state.sidebarHidden = false;
  sidebar.classList.remove("hidden");
  sidebar.classList.add("mobile-open");
  main.classList.remove("expanded");
  $("#openSidebarBtn").classList.remove("visible");
  if (window.innerWidth <= 900) $("#sidebarBackdrop").classList.add("active");
}

function closeSidebar() {
  const sidebar = $("#sidebar");
  const main = $(".main-content");
  state.sidebarHidden = true;
  sidebar.classList.remove("mobile-open");
  sidebar.classList.add("hidden");
  main.classList.add("expanded");
  $("#openSidebarBtn").classList.add("visible");
  $("#sidebarBackdrop").classList.remove("active");
  setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
}

function updateClock() {
  $("#currentTime").textContent = new Intl.DateTimeFormat("ko-KR", {
    month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

function configureInputs() {
  const symbolSelect = $("#symbolSelect");
  symbolSelect.innerHTML = STOCKS.map((stock) => `<option value="${stock.symbol}">${stock.name} (${stock.symbol})</option>`).join("");
  symbolSelect.value = state.symbol;
  $("#minProbability").addEventListener("input", (event) => $("#minProbabilityValue").textContent = `${event.target.value}%`);
  $("#minScore").addEventListener("input", (event) => $("#minScoreValue").textContent = `${event.target.value}%`);
}

function currentSettings() {
  return {
    model: $("#modelSelect").value,
    sequence: Number($("#sequenceLength").value),
    horizon: Number($("#horizon").value),
    sampleCount: Number($("#sampleCount").value),
    minProbability: Number($("#minProbability").value) / 100,
    minScore: Number($("#minScore").value) / 100,
  };
}

function marketEndpoint(symbol, range, interval) {
  const params = new URLSearchParams({ symbol, range, interval });
  return `/api/market?${params.toString()}`;
}

async function fetchMarketData(symbol, range = "1y", interval = "1d", force = false) {
  const cacheKey = `${symbol}|${range}|${interval}`;
  if (!force && state.cache.has(cacheKey)) return state.cache.get(cacheKey);
  try {
    const response = await fetch(marketEndpoint(symbol, range, interval), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.timestamps?.length || !payload?.close?.length) throw new Error("empty data");
    const data = normalizeMarketPayload(payload, symbol);
    state.cache.set(cacheKey, data);
    return data;
  } catch (error) {
    console.warn("Live market data unavailable; demo data used.", error);
    const demo = generateDemoData(symbol, range, interval);
    state.cache.set(cacheKey, demo);
    toast("실시간 연결이 지연되어 데모 시세를 표시합니다.");
    return demo;
  }
}

function normalizeMarketPayload(payload, symbol) {
  const rows = [];
  const length = Math.min(payload.timestamps.length, payload.close.length);
  for (let i = 0; i < length; i += 1) {
    const close = Number(payload.close[i]);
    if (!Number.isFinite(close)) continue;
    rows.push({
      date: new Date(payload.timestamps[i] * 1000),
      open: Number.isFinite(Number(payload.open?.[i])) ? Number(payload.open[i]) : close,
      high: Number.isFinite(Number(payload.high?.[i])) ? Number(payload.high[i]) : close,
      low: Number.isFinite(Number(payload.low?.[i])) ? Number(payload.low[i]) : close,
      close,
      volume: Number.isFinite(Number(payload.volume?.[i])) ? Number(payload.volume[i]) : 0,
    });
  }
  return {
    symbol,
    currency: payload.currency || stockMeta(symbol).currency,
    exchange: payload.exchange || stockMeta(symbol).market,
    rows,
  };
}

function generateDemoData(symbol, range, interval) {
  const seed = [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const isKorean = symbol.endsWith(".KS");
  const points = interval === "1d" ? (range === "2y" ? 500 : range === "6mo" ? 132 : range === "3mo" ? 70 : 260) : 320;
  const base = isKorean ? 50000 + (seed % 180000) : 80 + (seed % 260);
  const rows = [];
  let price = base;
  const stepMs = interval === "1d" ? 86400000 : interval === "1h" ? 3600000 : 1800000;
  let timestamp = Date.now() - points * stepMs;
  for (let i = 0; i < points; i += 1) {
    const cycle = Math.sin((i + seed) / 13) * 0.006;
    const drift = ((seed % 9) - 2) * 0.00015;
    const noise = Math.sin((i * 7 + seed) * 1.73) * 0.004 + Math.cos(i * 2.19) * 0.0025;
    const move = drift + cycle + noise;
    const open = price;
    const close = Math.max(1, open * (1 + move));
    const wick = Math.abs(noise) + 0.004;
    rows.push({
      date: new Date(timestamp),
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
      volume: Math.round((1_000_000 + seed * 8000) * (0.7 + Math.abs(Math.sin(i / 8)) * 0.9)),
    });
    price = close;
    timestamp += stepMs;
  }
  return { symbol, currency: isKorean ? "KRW" : "USD", exchange: isKorean ? "KOSPI" : "NASDAQ", rows };
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function movingAverage(values, period) {
  const output = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) output[i] = sum / period;
  }
  return output;
}

function relativeStrengthIndex(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function returnsFromPrices(prices) {
  const output = [];
  for (let i = 1; i < prices.length; i += 1) output.push(Math.log(prices[i] / prices[i - 1]));
  return output;
}

function solve3x3(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = Math.abs(a[column][column]) < 1e-10 ? 1e-10 : a[column][column];
    for (let j = column; j < 4; j += 1) a[column][j] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j < 4; j += 1) a[row][j] -= factor * a[column][j];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function arimaForecast(prices, horizon) {
  const returns = returnsFromPrices(prices).slice(-160);
  if (returns.length < 12) return 0;
  let n = 0;
  let s1 = 0, s2 = 0, sy = 0, s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  for (let i = 2; i < returns.length; i += 1) {
    const x1 = returns[i - 1], x2 = returns[i - 2], y = returns[i];
    n += 1; s1 += x1; s2 += x2; sy += y; s11 += x1 * x1; s22 += x2 * x2; s12 += x1 * x2; s1y += x1 * y; s2y += x2 * y;
  }
  const [intercept, phi1, phi2] = solve3x3(
    [[n, s1, s2], [s1, s11, s12], [s2, s12, s22]],
    [sy, s1y, s2y],
  );
  let lag1 = last(returns), lag2 = returns[returns.length - 2], cumulative = 0;
  for (let step = 0; step < horizon; step += 1) {
    const forecast = clamp(intercept + phi1 * lag1 + phi2 * lag2, -0.08, 0.08);
    cumulative += forecast;
    lag2 = lag1;
    lag1 = forecast;
  }
  return Math.exp(cumulative) - 1;
}

function lstmStyleForecast(prices, horizon) {
  const returns = returnsFromPrices(prices).slice(-80);
  if (!returns.length) return 0;
  let weighted = 0, weightSum = 0;
  returns.forEach((value, index) => {
    const weight = 1 + (index / returns.length) ** 2 * 4;
    weighted += value * weight;
    weightSum += weight;
  });
  const momentum = weighted / weightSum;
  const ma20 = mean(prices.slice(-20));
  const ma60 = mean(prices.slice(-60));
  const trend = ma60 ? (ma20 / ma60 - 1) / 20 : 0;
  const rsi = relativeStrengthIndex(prices);
  const meanReversion = (50 - rsi) / 50 * 0.0006;
  return Math.exp((momentum * 0.62 + trend * 0.28 + meanReversion * 0.10) * horizon) - 1;
}

function transformerStyleForecast(prices, horizon) {
  const returns = returnsFromPrices(prices).slice(-96);
  if (!returns.length) return 0;
  const volatility = standardDeviation(returns) || 0.01;
  const recent = returns.slice(-32);
  const query = last(recent) / volatility;
  const weights = recent.map((value, index) => {
    const recency = Math.exp((index - recent.length + 1) / 10);
    const similarity = Math.exp(-Math.abs(value / volatility - query));
    return recency * similarity;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const attentionReturn = recent.reduce((sum, value, index) => sum + value * weights[index], 0) / weightTotal;
  const longTrend = prices.length >= 50 ? Math.log(last(prices) / prices[prices.length - 50]) / 50 : 0;
  return Math.exp((attentionReturn * 0.72 + longTrend * 0.28) * horizon) - 1;
}

function calculatePrediction(data, settings = currentSettings()) {
  const prices = data.rows.map((row) => row.close).filter(Number.isFinite);
  const sample = prices.slice(-Math.min(settings.sampleCount, prices.length));
  const horizon = settings.horizon;
  const lstm = lstmStyleForecast(sample.slice(-Math.max(settings.sequence, 70)), horizon);
  const arima = arimaForecast(sample, horizon);
  const transformer = transformerStyleForecast(sample.slice(-Math.max(settings.sequence, 100)), horizon);
  const modelValues = { lstm, arima, transformer };
  const expected = settings.model === "ensemble" ? mean(Object.values(modelValues)) : modelValues[settings.model];
  const returns = returnsFromPrices(sample).slice(-60);
  const horizonVolatility = standardDeviation(returns) * Math.sqrt(horizon);
  const z = expected / Math.max(horizonVolatility, 0.002);
  const probability = clamp(1 / (1 + Math.exp(-z * 1.5)), 0.05, 0.95);
  const trend20 = sample.length >= 20 ? last(sample) / mean(sample.slice(-20)) - 1 : 0;
  const trend60 = sample.length >= 60 ? last(sample) / mean(sample.slice(-60)) - 1 : trend20;
  const rsi = relativeStrengthIndex(sample);
  const technical = clamp(0.5 + trend20 * 7 + trend60 * 4 + (rsi - 50) / 160, 0, 1);
  const risk = clamp(horizonVolatility * 14, 0, 1);
  const score = clamp(probability * 0.58 + technical * 0.32 + (1 - risk) * 0.10, 0, 1);
  const signal = probability >= settings.minProbability && score >= settings.minScore && expected > 0 ? "매수 후보" : expected < -0.01 ? "주의" : "관망";
  return { expected, probability, score, risk, technical, signal, modelValues, rsi };
}

function predictionLabel(prediction) {
  if (prediction.signal === "매수 후보") return { className: "positive", grade: "BUY", text: "매수 후보" };
  if (prediction.signal === "주의") return { className: "negative", grade: "RISK", text: "주의" };
  return { className: "neutral", grade: "HOLD", text: "관망" };
}

function updateProgress(kind, percent, label) {
  const panel = $(`#${kind}Progress`);
  const bar = $(`#${kind}ProgressBar`);
  const labelNode = $(`#${kind}ProgressLabel`);
  const percentNode = $(`#${kind}ProgressPercent`);
  panel.hidden = false;
  const normalized = clamp(Math.round(percent), 0, 100);
  bar.style.width = `${normalized}%`;
  labelNode.textContent = label;
  percentNode.textContent = `${normalized}%`;
}

async function runProgressSequence(kind, steps) {
  for (const step of steps) {
    updateProgress(kind, step.percent, step.label);
    await sleep(step.delay ?? 160);
  }
}

function closeProgress(kind, delay = 600) {
  setTimeout(() => {
    const panel = $(`#${kind}Progress`);
    if (panel) panel.hidden = true;
  }, delay);
}

function chartConfig() {
  return {
    responsive: true,
    scrollZoom: true,
    displaylogo: false,
    doubleClick: "reset+autosize",
    modeBarButtonsToAdd: ["drawline", "eraseshape"],
    toImageButtonOptions: { format: "png", filename: "quant-edge-chart", scale: 2 },
  };
}

function commonChartLayout() {
  return {
    paper_bgcolor: "#07101d",
    plot_bgcolor: "#07101d",
    font: { color: "#cbd5e1", family: "Inter, sans-serif", size: 11 },
    margin: { l: 50, r: 72, t: 12, b: 42 },
    hovermode: "x unified",
    dragmode: "pan",
    showlegend: false,
    xaxis: {
      gridcolor: "#1c2938", zerolinecolor: "#263548", linecolor: "#263548",
      rangeslider: { visible: false }, fixedrange: false, showspikes: true, spikemode: "across", spikecolor: "#64748b",
    },
    yaxis: {
      side: "right", gridcolor: "#1c2938", zerolinecolor: "#263548", linecolor: "#263548",
      fixedrange: false, showspikes: true, spikemode: "across", spikecolor: "#64748b",
    },
  };
}

function movingAverageTrace(rows, period, color, name) {
  const values = movingAverage(rows.map((row) => row.close), period);
  return {
    type: "scatter", mode: "lines", name,
    x: rows.map((row) => row.date), y: values,
    line: { color, width: 1.4 }, hovertemplate: `${name}: %{y:,.2f}<extra></extra>`,
  };
}

function forecastTraces(rows, prediction, horizon) {
  if (!prediction || !rows.length) return [];
  const latestDate = last(rows).date;
  const latestPrice = last(rows).close;
  const stepMs = rows.length > 1 ? last(rows).date - rows[rows.length - 2].date : 86400000;
  const dates = [latestDate];
  const center = [latestPrice];
  const upper = [latestPrice];
  const lower = [latestPrice];
  for (let step = 1; step <= horizon; step += 1) {
    const ratio = step / horizon;
    const target = latestPrice * (1 + prediction.expected * ratio);
    const band = latestPrice * (0.012 + prediction.risk * 0.035) * Math.sqrt(ratio);
    dates.push(new Date(latestDate.getTime() + stepMs * step));
    center.push(target); upper.push(target + band); lower.push(target - band);
  }
  return [
    { type: "scatter", mode: "lines", x: dates, y: upper, line: { color: "rgba(99,153,255,.15)", width: 0 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter", mode: "lines", x: dates, y: lower, fill: "tonexty", fillcolor: "rgba(69,114,230,.18)", line: { color: "rgba(99,153,255,.15)", width: 0 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter", mode: "lines+markers", x: dates, y: center, line: { color: "#7aa2ff", width: 2, dash: "dot" }, marker: { size: 4 }, hovertemplate: "예측: %{y:,.2f}<extra></extra>", showlegend: false },
  ];
}

function renderPriceChart(data, prediction = null) {
  if (!window.Plotly || !data?.rows?.length) return;
  const rows = data.rows.slice(-Math.min(data.rows.length, 320));
  const traces = [
    {
      type: "candlestick", x: rows.map((row) => row.date),
      open: rows.map((row) => row.open), high: rows.map((row) => row.high), low: rows.map((row) => row.low), close: rows.map((row) => row.close),
      increasing: { line: { color: "#15c98b", width: 1 }, fillcolor: "#15c98b" },
      decreasing: { line: { color: "#ff5964", width: 1 }, fillcolor: "#ff5964" },
      whiskerwidth: 0.35, name: "가격",
    },
    movingAverageTrace(rows, 20, "#f7c948", "MA20"),
    movingAverageTrace(rows, 60, "#6ea8fe", "MA60"),
    ...forecastTraces(rows, prediction, currentSettings().horizon),
  ];
  const layout = commonChartLayout();
  layout.margin.b = 52;
  Plotly.react("priceChart", traces, layout, chartConfig());
}

function renderDashboardChart(data) {
  if (!window.Plotly || !data?.rows?.length) return;
  const rows = data.rows;
  const trace = {
    type: "scatter", mode: "lines", x: rows.map((row) => row.date), y: rows.map((row) => row.close),
    line: { color: "#3159d8", width: 2 }, fill: "tozeroy", fillcolor: "rgba(49,89,216,.08)",
    hovertemplate: "%{x|%Y-%m-%d}<br>%{y:,.2f}<extra></extra>",
  };
  const layout = {
    paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", margin: { l: 54, r: 20, t: 8, b: 40 },
    font: { family: "Inter, sans-serif", color: "#667085", size: 11 }, showlegend: false, hovermode: "x unified", dragmode: "pan",
    xaxis: { gridcolor: "#eef2f7", linecolor: "#e2e8f0", fixedrange: false },
    yaxis: { gridcolor: "#eef2f7", linecolor: "#e2e8f0", fixedrange: false },
  };
  Plotly.react("dashboardChart", [trace], layout, chartConfig());
}

function renderCurrentQuote(data) {
  const meta = stockMeta(data.symbol);
  const rows = data.rows;
  const current = last(rows)?.close ?? 0;
  const previous = rows.length > 1 ? rows[rows.length - 2].close : current;
  const change = previous ? (current / previous - 1) * 100 : 0;
  $("#stockName").textContent = meta.name;
  $("#stockTicker").textContent = meta.symbol;
  $("#stockPrice").textContent = formatPrice(current, data.currency || meta.currency);
  $("#stockChange").textContent = formatPercent(change);
  $("#stockChange").className = change >= 0 ? "positive" : "negative";
  $("#stockIntervalLabel").textContent = $("#intervalSelect").selectedOptions[0].textContent;
  $("#stockModelLabel").textContent = `${$("#modelSelect").selectedOptions[0].textContent} · ${currentSettings().horizon}봉 예측`;
}

function renderPrediction(prediction) {
  state.prediction = prediction;
  const label = predictionLabel(prediction);
  $("#predictionGrade").textContent = label.grade;
  $("#predictionGrade").className = `status-chip ${label.className}`;
  $("#predictionSignal").textContent = label.text;
  $("#predictionSignal").className = `prediction-signal ${label.className}`;
  $("#predictionSummary").textContent = `예상 수익률 ${formatPercent(prediction.expected * 100)} · RSI ${prediction.rsi.toFixed(1)}`;
  $("#probabilityValue").textContent = `${(prediction.probability * 100).toFixed(1)}%`;
  $("#probabilityRing").style.setProperty("--score", (prediction.probability * 100).toFixed(1));
  $("#expectedReturn").textContent = formatPercent(prediction.expected * 100);
  $("#expectedReturn").className = prediction.expected >= 0 ? "positive" : "negative";
  $("#finalScore").textContent = prediction.score.toFixed(2);
  $("#riskScore").textContent = prediction.risk.toFixed(2);
  const modelNames = { lstm: "LSTM", arima: "ARIMA", transformer: "Transformer" };
  $("#modelBreakdown").innerHTML = Object.entries(prediction.modelValues).map(([key, value]) => {
    const score = clamp(50 + value * 900, 5, 95);
    return `<div class="model-row"><span>${modelNames[key]}</span><div class="model-bar-track"><div class="model-bar" style="width:${score}%"></div></div><strong class="${value >= 0 ? "positive" : "negative"}">${formatPercent(value * 100)}</strong></div>`;
  }).join("");
  $("#dashboardSignal").textContent = label.text;
  $("#dashboardSignal").className = `metric-value ${label.className}`;
  $("#dashboardConfidence").textContent = `상승확률 ${(prediction.probability * 100).toFixed(1)}%`;
  $("#dashboardExpected").textContent = formatPercent(prediction.expected * 100);
  $("#dashboardExpected").className = `metric-value ${prediction.expected >= 0 ? "positive" : "negative"}`;
  $("#dashboardModel").textContent = $("#modelSelect").selectedOptions[0].textContent;
}

function clearBacktestMetrics() {
  $$("[data-metric]").forEach((node) => node.textContent = "-");
  $("#tradeHistoryCard").hidden = true;
}

function backtest(data, settings = currentSettings()) {
  const rows = data.rows.slice(-Math.min(settings.sampleCount + 140, data.rows.length));
  const start = Math.max(settings.sequence, 90);
  const predictions = [];
  for (let index = start; index < rows.length - settings.horizon; index += Math.max(2, Math.floor(settings.horizon / 2))) {
    const history = { ...data, rows: rows.slice(0, index + 1) };
    const prediction = calculatePrediction(history, settings);
    const futureReturn = rows[index + settings.horizon].close / rows[index].close - 1;
    predictions.push({ index, prediction, futureReturn });
  }
  const accuracy = predictions.length ? predictions.filter((item) => Math.sign(item.prediction.expected) === Math.sign(item.futureReturn)).length / predictions.length : 0;
  let candidates = predictions.filter((item) => item.prediction.probability >= settings.minProbability && item.prediction.score >= settings.minScore && item.prediction.expected > 0);
  if (candidates.length < 3) {
    candidates = [...predictions]
      .filter((item) => item.prediction.expected > -0.002)
      .sort((a, b) => b.prediction.score - a.prediction.score)
      .slice(0, Math.max(3, Math.floor(predictions.length * 0.14)))
      .sort((a, b) => a.index - b.index);
  }
  const trades = [];
  let lastExitIndex = -1;
  let equity = 10000;
  let peak = equity;
  let mdd = 0;
  for (const candidate of candidates) {
    if (candidate.index <= lastExitIndex) continue;
    const entryIndex = candidate.index;
    const exitIndex = Math.min(entryIndex + settings.horizon, rows.length - 1);
    const grossReturn = rows[exitIndex].close / rows[entryIndex].close - 1;
    const netReturn = grossReturn - 0.0015;
    const before = equity;
    equity *= 1 + netReturn;
    peak = Math.max(peak, equity);
    mdd = Math.min(mdd, equity / peak - 1);
    trades.push({
      entryDate: rows[entryIndex].date,
      entryPrice: rows[entryIndex].close,
      exitDate: rows[exitIndex].date,
      exitPrice: rows[exitIndex].close,
      expected: candidate.prediction.expected,
      probability: candidate.prediction.probability,
      return: netReturn,
      equityBefore: before,
      equityAfter: equity,
    });
    lastExitIndex = exitIndex;
  }
  const wins = trades.filter((trade) => trade.return > 0).length;
  return {
    totalReturn: equity / 10000 - 1,
    mdd,
    winRate: trades.length ? wins / trades.length : 0,
    trades,
    accuracy,
  };
}

function renderBacktest(result, currency) {
  const values = {
    totalReturn: formatPercent(result.totalReturn * 100),
    mdd: formatPercent(result.mdd * 100, 2, false),
    winRate: `${(result.winRate * 100).toFixed(1)}%`,
    trades: `${result.trades.length}회`,
    accuracy: `${(result.accuracy * 100).toFixed(1)}%`,
  };
  Object.entries(values).forEach(([key, value]) => {
    const node = $(`[data-metric="${key}"]`);
    node.textContent = value;
    if (key === "totalReturn") node.className = `metric-value ${result.totalReturn >= 0 ? "positive" : "negative"}`;
    else node.className = "metric-value";
  });
  $("#tradeHistoryCard").hidden = false;
  if (!result.trades.length) {
    $("#tradeHistory").innerHTML = `<div class="empty-state"><div class="empty-icon">–</div><strong>완료된 거래가 없습니다.</strong><span>매수 기준을 낮추거나 학습 표본 수를 늘려보세요.</span></div>`;
    return;
  }
  $("#tradeHistory").innerHTML = `<table><thead><tr><th>매수일</th><th>매수가</th><th>매도일</th><th>매도가</th><th>상승확률</th><th>순수익률</th><th>결과</th></tr></thead><tbody>${result.trades.map((trade) => `<tr><td>${trade.entryDate.toLocaleDateString("ko-KR")}</td><td>${formatPrice(trade.entryPrice, currency)}</td><td>${trade.exitDate.toLocaleDateString("ko-KR")}</td><td>${formatPrice(trade.exitPrice, currency)}</td><td>${(trade.probability * 100).toFixed(1)}%</td><td class="${trade.return >= 0 ? "positive" : "negative"}">${formatPercent(trade.return * 100)}</td><td><span class="signal-pill ${trade.return >= 0 ? "buy" : "sell"}">${trade.return >= 0 ? "성공" : "손실"}</span></td></tr>`).join("")}</tbody></table>`;
}

async function loadAnalysisData(force = false) {
  const symbol = $("#symbolSelect").value;
  const interval = $("#intervalSelect").value;
  const range = interval === "1d" ? "2y" : interval === "1h" ? "6mo" : "1mo";
  state.symbol = symbol;
  state.interval = interval;
  const data = await fetchMarketData(symbol, range, interval, force);
  state.marketData = data;
  renderCurrentQuote(data);
  renderPriceChart(data, state.prediction);
  return data;
}

async function runQuickPrediction() {
  const button = $("#quickPredictBtn");
  button.disabled = true;
  clearBacktestMetrics();
  try {
    await runProgressSequence("analysis", [
      { percent: 8, label: "주가 데이터 불러오는 중" },
      { percent: 22, label: "기술지표 계산" },
    ]);
    const data = await loadAnalysisData();
    await runProgressSequence("analysis", [
      { percent: 46, label: `${$("#modelSelect").selectedOptions[0].textContent} 데이터 준비` },
      { percent: 72, label: "미래 수익률 계산" },
      { percent: 91, label: "신호 등급 산출" },
    ]);
    const prediction = calculatePrediction(data);
    renderPrediction(prediction);
    renderPriceChart(data, prediction);
    updateProgress("analysis", 100, "빠른 예측 완료");
    toast("빠른 예측이 완료되었습니다.");
  } catch (error) {
    console.error(error);
    toast("예측 중 오류가 발생했습니다.");
  } finally {
    button.disabled = false;
    closeProgress("analysis");
  }
}

async function runBacktest() {
  const button = $("#backtestBtn");
  button.disabled = true;
  try {
    await runProgressSequence("analysis", [
      { percent: 6, label: "과거 주가 데이터 확인" },
      { percent: 14, label: "기술지표 계산" },
    ]);
    const data = await loadAnalysisData();
    const checkpoints = [24, 34, 46, 58, 69, 80, 90];
    for (let i = 0; i < checkpoints.length; i += 1) {
      updateProgress("analysis", checkpoints[i], `Walk-forward 검증 ${i + 1}/${checkpoints.length}`);
      await sleep(130);
    }
    const prediction = calculatePrediction(data);
    const result = backtest(data);
    renderPrediction(prediction);
    renderPriceChart(data, prediction);
    renderBacktest(result, data.currency);
    updateProgress("analysis", 100, "정밀 백테스트 완료");
    toast("정밀 백테스트가 완료되었습니다.");
  } catch (error) {
    console.error(error);
    toast("백테스트 중 오류가 발생했습니다.");
  } finally {
    button.disabled = false;
    closeProgress("analysis", 900);
  }
}

function scannerUniverse() {
  const universe = $("#scannerUniverse").value;
  const limit = Number($("#scannerLimit").value);
  const filtered = universe === "us" ? STOCKS.filter((stock) => stock.market === "US") : universe === "kr" ? STOCKS.filter((stock) => stock.market === "KR") : STOCKS;
  return filtered.slice(0, limit);
}

async function scanStocks({ dashboard = false } = {}) {
  const stocks = dashboard ? STOCKS.slice(0, 6) : scannerUniverse();
  const results = [];
  if (!dashboard) {
    $("#runScannerBtn").disabled = true;
    $("#scannerResults").classList.remove("empty-state");
  }
  try {
    for (let index = 0; index < stocks.length; index += 1) {
      const stock = stocks[index];
      if (!dashboard) updateProgress("scanner", (index / stocks.length) * 86 + 5, `${stock.symbol} 데이터 분석 중 (${index + 1}/${stocks.length})`);
      const data = await fetchMarketData(stock.symbol, "1y", "1d");
      const prediction = calculatePrediction(data);
      const rows = data.rows;
      const current = last(rows)?.close ?? 0;
      const previous = rows.length > 1 ? rows[rows.length - 2].close : current;
      const dailyChange = previous ? current / previous - 1 : 0;
      results.push({ stock, data, prediction, current, dailyChange });
      if (!dashboard) {
        renderScannerTable(results, "#scannerResults");
        await sleep(70);
      }
    }
    results.sort((a, b) => b.prediction.score - a.prediction.score);
    if (!dashboard) {
      state.scannerResults = results;
      renderScannerTable(results, "#scannerResults");
      renderScannerSummary(results);
      updateProgress("scanner", 100, "스캔 완료");
      toast("주식 스캔이 완료되었습니다.");
    }
    return results;
  } finally {
    if (!dashboard) {
      $("#runScannerBtn").disabled = false;
      closeProgress("scanner", 900);
    }
  }
}

function renderScannerSummary(results) {
  const buyCandidates = results.filter((item) => item.prediction.signal === "매수 후보");
  const best = results[0];
  $("#scannedCount").textContent = results.length;
  $("#buyCandidateCount").textContent = buyCandidates.length;
  $("#bestScannerScore").textContent = best ? best.prediction.score.toFixed(2) : "-";
  $("#bestScannerTicker").textContent = best ? best.stock.symbol : "-";
}

function renderScannerTable(results, selector) {
  const target = $(selector);
  if (!results.length) return;
  target.innerHTML = `<table><thead><tr><th>종목</th><th>현재가</th><th>등락률</th><th>신호</th><th>상승확률</th><th>예상 수익률</th><th>종합점수</th></tr></thead><tbody>${results.map((item) => {
    const label = predictionLabel(item.prediction);
    const pillClass = item.prediction.signal === "매수 후보" ? "buy" : item.prediction.signal === "주의" ? "sell" : "hold";
    return `<tr data-symbol="${item.stock.symbol}"><td><div class="table-symbol"><span class="ticker-badge">${item.stock.symbol.replace(".KS", "").slice(0, 3)}</span><div><strong>${item.stock.symbol}</strong><div class="metric-foot">${item.stock.name}</div></div></div></td><td>${formatPrice(item.current, item.data.currency)}</td><td class="${item.dailyChange >= 0 ? "positive" : "negative"}">${formatPercent(item.dailyChange * 100)}</td><td><span class="signal-pill ${pillClass}">${label.text}</span></td><td>${(item.prediction.probability * 100).toFixed(1)}%</td><td class="${item.prediction.expected >= 0 ? "positive" : "negative"}">${formatPercent(item.prediction.expected * 100)}</td><td><strong>${item.prediction.score.toFixed(2)}</strong></td></tr>`;
  }).join("")}</tbody></table>`;
  $$(`tr[data-symbol]`, target).forEach((row) => row.addEventListener("click", () => {
    const symbol = row.dataset.symbol;
    $("#symbolSelect").value = symbol;
    state.symbol = symbol;
    setView("analysis");
    runQuickPrediction();
  }));
}

function renderTopPicks(results) {
  $("#topPicks").innerHTML = results.slice(0, 5).map((item) => {
    const label = predictionLabel(item.prediction);
    return `<button class="pick-row" data-symbol="${item.stock.symbol}" style="border-left:0;border-right:0;border-bottom:0;background:transparent;width:100%;"><div class="pick-symbol"><span class="ticker-badge">${item.stock.symbol.replace(".KS", "").slice(0, 3)}</span><div><strong>${item.stock.symbol}</strong><span>${item.stock.name}</span></div></div><div class="pick-score"><strong>${item.prediction.score.toFixed(2)}</strong><span class="${label.className}">${label.text}</span></div></button>`;
  }).join("");
  $$(".pick-row").forEach((button) => button.addEventListener("click", () => {
    $("#symbolSelect").value = button.dataset.symbol;
    setView("analysis");
    runQuickPrediction();
  }));
}

function exportScannerCsv() {
  if (!state.scannerResults.length) {
    toast("저장할 스캔 결과가 없습니다.");
    return;
  }
  const rows = [["종목", "회사", "현재가", "등락률", "신호", "상승확률", "예상수익률", "종합점수"]];
  state.scannerResults.forEach((item) => rows.push([
    item.stock.symbol, item.stock.name, item.current, item.dailyChange, item.prediction.signal,
    item.prediction.probability, item.prediction.expected, item.prediction.score,
  ]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `quant-edge-scanner-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function setupSearch() {
  const input = $("#globalSearch");
  const resultsNode = $("#searchResults");
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      resultsNode.hidden = true;
      return;
    }
    const matches = STOCKS.filter((stock) => `${stock.symbol} ${stock.name}`.toLowerCase().includes(query)).slice(0, 7);
    resultsNode.innerHTML = matches.map((stock) => `<button class="search-result" data-symbol="${stock.symbol}"><div><strong>${stock.name}</strong><span>${stock.symbol}</span></div><span>${stock.market}</span></button>`).join("");
    resultsNode.hidden = !matches.length;
    $$(".search-result", resultsNode).forEach((button) => button.addEventListener("click", () => {
      state.symbol = button.dataset.symbol;
      $("#symbolSelect").value = state.symbol;
      input.value = "";
      resultsNode.hidden = true;
      setView("analysis");
      runQuickPrediction();
    }));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) resultsNode.hidden = true;
  });
}

function resetSettings() {
  $("#modelSelect").value = "ensemble";
  $("#sequenceLength").value = "60";
  $("#horizon").value = "5";
  $("#sampleCount").value = "320";
  $("#minProbability").value = "52";
  $("#minScore").value = "50";
  $("#minProbabilityValue").textContent = "52%";
  $("#minScoreValue").textContent = "50%";
  toast("설정을 초기화했습니다.");
}

async function initializeDashboard() {
  const data = await fetchMarketData(state.symbol, state.range, "1d");
  state.marketData = data;
  const prediction = calculatePrediction(data);
  state.prediction = prediction;
  $("#dashboardSymbol").textContent = state.symbol;
  $("#dashboardChartSubtitle").textContent = `${state.symbol} · 최근 ${state.range.toUpperCase()}`;
  renderDashboardChart(data);
  renderPrediction(prediction);
  const scan = await scanStocks({ dashboard: true });
  renderTopPicks(scan);
  renderScannerTable(scan.slice(0, 5), "#dashboardScannerTable");
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-jump]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.jump)));
  $("#closeSidebarBtn").addEventListener("click", closeSidebar);
  $("#openSidebarBtn").addEventListener("click", openSidebar);
  $("#sidebarBackdrop").addEventListener("click", closeSidebar);
  $("#quickPredictBtn").addEventListener("click", runQuickPrediction);
  $("#backtestBtn").addEventListener("click", runBacktest);
  $("#runScannerBtn").addEventListener("click", () => scanStocks());
  $("#exportScannerBtn").addEventListener("click", exportScannerCsv);
  $("#resetBtn").addEventListener("click", resetSettings);
  $("#refreshBtn").addEventListener("click", async () => {
    state.cache.clear();
    if (state.view === "analysis") await runQuickPrediction();
    else await initializeDashboard();
  });
  $("#symbolSelect").addEventListener("change", async (event) => {
    state.symbol = event.target.value;
    state.prediction = null;
    clearBacktestMetrics();
    await loadAnalysisData();
  });
  $("#intervalSelect").addEventListener("change", async () => {
    state.prediction = null;
    clearBacktestMetrics();
    await loadAnalysisData();
  });
  $$(".segmented-control button").forEach((button) => button.addEventListener("click", async () => {
    $$(".segmented-control button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.range = button.dataset.range;
    const data = await fetchMarketData(state.symbol, state.range, "1d");
    $("#dashboardChartSubtitle").textContent = `${state.symbol} · 최근 ${state.range.toUpperCase()}`;
    renderDashboardChart(data);
  }));
  window.addEventListener("resize", () => {
    ["dashboardChart", "priceChart"].forEach((id) => {
      const element = document.getElementById(id);
      if (element && window.Plotly) Plotly.Plots.resize(element);
    });
    if (window.innerWidth <= 900 && !$("#sidebar").classList.contains("mobile-open")) {
      $("#sidebar").classList.add("hidden");
      $("#openSidebarBtn").classList.add("visible");
    }
  });
}

async function init() {
  configureInputs();
  setupSearch();
  bindEvents();
  updateClock();
  setInterval(updateClock, 30000);
  if (window.innerWidth <= 900) closeSidebar();
  else $("#openSidebarBtn").classList.remove("visible");
  await initializeDashboard();
}

window.addEventListener("DOMContentLoaded", init);
