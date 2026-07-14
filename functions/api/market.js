const ALLOWED_INTERVALS = new Set(["1d", "1h", "30m"]);
const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y"]);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "AAPL").trim().toUpperCase();
  const interval = ALLOWED_INTERVALS.has(url.searchParams.get("interval")) ? url.searchParams.get("interval") : "1d";
  let range = ALLOWED_RANGES.has(url.searchParams.get("range")) ? url.searchParams.get("range") : "1y";

  if (interval === "30m" && !["1mo", "3mo"].includes(range)) range = "1mo";
  if (interval === "1h" && range === "2y") range = "6mo";

  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  endpoint.searchParams.set("interval", interval);
  endpoint.searchParams.set("range", range);
  endpoint.searchParams.set("includePrePost", "false");
  endpoint.searchParams.set("events", "div,splits");

  try {
    const response = await fetch(endpoint.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 QuantEdge/1.0",
        Accept: "application/json",
      },
      cf: { cacheTtl: interval === "1d" ? 300 : 60, cacheEverything: true },
    });

    if (!response.ok) {
      return Response.json({ error: `Market data request failed (${response.status})` }, { status: 502 });
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp?.length || !quote) {
      return Response.json({ error: json?.chart?.error?.description || "No market data" }, { status: 404 });
    }

    const payload = {
      symbol,
      currency: result.meta?.currency || (symbol.endsWith(".KS") ? "KRW" : "USD"),
      exchange: result.meta?.exchangeName || result.meta?.fullExchangeName || "",
      timezone: result.meta?.exchangeTimezoneName || "UTC",
      timestamps: result.timestamp,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": interval === "1d" ? "public, max-age=300" : "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
