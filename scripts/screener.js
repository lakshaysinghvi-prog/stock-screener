// Daily Stock Screener — fetches data, scores technical + fundamental strength,
// writes top 5 to Airtable. Run via GitHub Actions on a schedule.

const AIRTABLE_BASE_ID = "appYVrcRq6dcrAyD5";
const AIRTABLE_TABLE_ID = "tblgrpxHod4n2dIiC";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

if (!AIRTABLE_TOKEN) {
  console.error("Missing AIRTABLE_TOKEN environment variable / secret.");
  process.exit(1);
}

// Edit this watchlist to whatever universe you want screened.
// Yahoo Finance ticker format for NSE stocks: SYMBOL.NS
const watchlist = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
  "ITC.NS", "LT.NS", "SBIN.NS", "BHARTIARTL.NS", "AXISBANK.NS",
  "KOTAKBANK.NS", "HINDUNILVR.NS", "MARUTI.NS", "TATASTEEL.NS", "JINDALSAW.NS",
  "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS", "WIPRO.NS", "ADANIENT.NS"
];

const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function computeIndicatorsAndScore(symbol, priceJson, fundJson) {
  const result = priceJson.chart.result[0];
  const closes = result.indicators.quote[0].close.filter((c) => c !== null);
  const volumes = result.indicators.quote[0].volume.filter((v) => v !== null);
  const currentPrice = closes[closes.length - 1];

  const dma = (n) => {
    const slice = closes.slice(-n);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  const dma50 = dma(Math.min(50, closes.length));
  const dma200 = dma(Math.min(200, closes.length));

  const rsiPeriod = 14;
  let gains = 0, losses = 0;
  const recent = closes.slice(-(rsiPeriod + 1));
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

  const vol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const latestVol = volumes[volumes.length - 1];
  const volPct = ((latestVol - vol20) / vol20) * 100;

  let techScore = 50;
  const techNotes = [];
  if (currentPrice > dma50 && dma50 > dma200) {
    techScore += 20;
    techNotes.push("Price above 50DMA and 50DMA above 200DMA (bullish trend structure)");
  } else if (currentPrice < dma50 && dma50 < dma200) {
    techScore -= 20;
    techNotes.push("Price below 50DMA and 50DMA below 200DMA (bearish trend structure)");
  }
  if (rsi > 70) {
    techScore -= 10;
    techNotes.push(`RSI at ${rsi.toFixed(1)} suggests overbought conditions`);
  } else if (rsi < 30) {
    techScore -= 10;
    techNotes.push(`RSI at ${rsi.toFixed(1)} suggests oversold conditions`);
  } else if (rsi >= 50 && rsi <= 65) {
    techScore += 15;
    techNotes.push(`RSI at ${rsi.toFixed(1)} shows healthy bullish momentum without being overbought`);
  }
  if (volPct > 20) {
    techScore += 15;
    techNotes.push(`Volume ${volPct.toFixed(0)}% above 20-day average, confirming move with participation`);
  } else if (volPct < -20) {
    techScore -= 5;
    techNotes.push("Volume below average, move lacks conviction");
  }
  techScore = Math.max(0, Math.min(100, techScore));

  const stats = fundJson.quoteSummary.result[0];
  const pe = stats.summaryDetail?.trailingPE?.raw ?? null;
  const debtToEquity = stats.financialData?.debtToEquity?.raw ?? null;
  const earningsGrowth =
    stats.financialData?.earningsGrowth?.raw != null
      ? stats.financialData.earningsGrowth.raw * 100
      : null;
  const sector = stats.price?.industry || stats.price?.sector || "Unknown";
  const companyName = stats.price?.longName || symbol;

  let fundScore = 50;
  const fundNotes = [];
  if (pe !== null) {
    if (pe > 0 && pe < 25) {
      fundScore += 15;
      fundNotes.push(`P/E of ${pe.toFixed(1)} is reasonable, not overextended`);
    } else if (pe >= 45) {
      fundScore -= 15;
      fundNotes.push(`P/E of ${pe.toFixed(1)} is elevated, priced for high growth`);
    } else {
      fundNotes.push(`P/E of ${pe.toFixed(1)} is moderately rich`);
    }
  }
  if (debtToEquity !== null) {
    if (debtToEquity < 50) {
      fundScore += 10;
      fundNotes.push(`Debt/Equity of ${debtToEquity.toFixed(1)} indicates a conservative balance sheet`);
    } else if (debtToEquity > 150) {
      fundScore -= 15;
      fundNotes.push(`Debt/Equity of ${debtToEquity.toFixed(1)} is high, adds balance sheet risk`);
    }
  }
  if (earningsGrowth !== null) {
    if (earningsGrowth > 15) {
      fundScore += 20;
      fundNotes.push(`Earnings growth of ${earningsGrowth.toFixed(1)}% YoY is strong`);
    } else if (earningsGrowth < 0) {
      fundScore -= 20;
      fundNotes.push(`Earnings declined ${Math.abs(earningsGrowth).toFixed(1)}% YoY`);
    }
  }
  fundScore = Math.max(0, Math.min(100, fundScore));

  const compositeScore = techScore * 0.5 + fundScore * 0.5;

  return {
    symbol: symbol.replace(".NS", ""),
    companyName,
    currentPrice: Number(currentPrice?.toFixed(2)),
    dma50: Number(dma50?.toFixed(2)),
    dma200: Number(dma200?.toFixed(2)),
    rsi: Number(rsi?.toFixed(1)),
    volPct: Number(volPct?.toFixed(1)),
    pe: pe !== null ? Number(pe.toFixed(2)) : null,
    debtToEquity: debtToEquity !== null ? Number(debtToEquity.toFixed(2)) : null,
    earningsGrowth: earningsGrowth !== null ? Number(earningsGrowth.toFixed(1)) : null,
    sector,
    techScore: Number(techScore.toFixed(1)),
    techSignal: techScore >= 55 ? "Positive" : techScore <= 45 ? "Negative" : "Neutral",
    techNotes: techNotes.join(". ") || "No strong technical signal either way.",
    fundScore: Number(fundScore.toFixed(1)),
    fundSignal: fundScore >= 55 ? "Positive" : fundScore <= 45 ? "Negative" : "Neutral",
    fundNotes: fundNotes.join(". ") || "No strong fundamental signal either way.",
    compositeScore: Number(compositeScore.toFixed(1))
  };
}

async function writeToAirtable(records) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ records, typecast: true })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable write failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function main() {
  const results = [];

  for (const symbol of watchlist) {
    try {
      const priceJson = await fetchJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`
      );
      const fundJson = await fetchJson(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail,price`
      );
      results.push(computeIndicatorsAndScore(symbol, priceJson, fundJson));
    } catch (e) {
      console.warn(`Skipped ${symbol}: ${e.message}`);
    }
  }

  const top5 = results.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);

  const records = top5.map((s) => ({
    fields: {
      "Ticker": s.symbol,
      "Company Name": s.companyName,
      "Date": today,
      "Exchange": "NSE",
      "Current Price": s.currentPrice,
      "Composite Score": s.compositeScore,
      "Technical Signal": s.techSignal,
      "Technical Score": s.techScore,
      "RSI (14)": s.rsi,
      "50 DMA": s.dma50,
      "200 DMA": s.dma200,
      "Volume vs 20d Avg (%)": s.volPct,
      "Technical Notes": s.techNotes,
      "Fundamental Signal": s.fundSignal,
      "Fundamental Score": s.fundScore,
      "P/E Ratio": s.pe,
      "Debt to Equity": s.debtToEquity,
      "YoY Earnings Growth (%)": s.earningsGrowth,
      "Fundamental Notes": s.fundNotes,
      "Sector": s.sector,
      "Data Source": "Yahoo Finance (free/public)"
    }
  }));

  if (records.length === 0) {
    console.log("No records to write — all tickers failed to fetch.");
    return;
  }

  await writeToAirtable(records);
  console.log(`Wrote ${records.length} records for ${today}:`);
  top5.forEach((s) => console.log(`  ${s.symbol} — composite ${s.compositeScore}`));
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
