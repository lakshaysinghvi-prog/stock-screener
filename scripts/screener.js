// Daily Stock Screener — fetches data, scores technical + fundamental strength,
// writes top 50 to Airtable. Run via GitHub Actions on a schedule.

const AIRTABLE_BASE_ID = "appYVrcRq6dcrAyD5";
const AIRTABLE_TABLE_ID = "tblgrpxHod4n2dIiC";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

if (!AIRTABLE_TOKEN) {
  console.error("Missing AIRTABLE_TOKEN environment variable / secret.");
  process.exit(1);
}

// Edit this watchlist to whatever universe you want screened.
// Yahoo Finance ticker format for NSE stocks: SYMBOL.NS
// Universe: NIFTY 50 + NIFTY Next 50 (= NIFTY 100) + a supplementary set of
// other liquid BSE 100 large/mid caps not already covered by NIFTY 100.
const watchlist = [
  // NIFTY 50
  "ADANIENT.NS", "ADANIPORTS.NS", "APOLLOHOSP.NS", "ASIANPAINT.NS", "AXISBANK.NS",
  "BAJAJ-AUTO.NS", "BAJFINANCE.NS", "BAJAJFINSV.NS", "BEL.NS", "BHARTIARTL.NS",
  "CIPLA.NS", "COALINDIA.NS", "DRREDDY.NS", "EICHERMOT.NS", "ETERNAL.NS",
  "GRASIM.NS", "HCLTECH.NS", "HDFCBANK.NS", "HDFCLIFE.NS", "HINDALCO.NS",
  "HINDUNILVR.NS", "ICICIBANK.NS", "INDIGO.NS", "INFY.NS", "ITC.NS",
  "JIOFIN.NS", "JSWSTEEL.NS", "KOTAKBANK.NS", "LT.NS", "M&M.NS",
  "MARUTI.NS", "MAXHEALTH.NS", "NESTLEIND.NS", "NTPC.NS", "ONGC.NS",
  "POWERGRID.NS", "RELIANCE.NS", "SBILIFE.NS", "SHRIRAMFIN.NS", "SBIN.NS",
  "SUNPHARMA.NS", "TCS.NS", "TATACONSUM.NS", "TMPV.NS", "TATASTEEL.NS",
  "TECHM.NS", "TITAN.NS", "TRENT.NS", "ULTRACEMCO.NS", "WIPRO.NS",
  // NIFTY Next 50 (together with the above = NIFTY 100)
  "ABB.NS", "ADANIENSOL.NS", "ADANIGREEN.NS", "ADANIPOWER.NS", "AMBUJACEM.NS",
  "BAJAJHLDNG.NS", "BANKBARODA.NS", "BPCL.NS", "BRITANNIA.NS", "BOSCHLTD.NS",
  "CANBK.NS", "CGPOWER.NS", "CHOLAFIN.NS", "CUMMINSIND.NS", "DIVISLAB.NS",
  "DLF.NS", "DMART.NS", "GAIL.NS", "GODREJCP.NS", "HDFCAMC.NS",
  "HAL.NS", "HINDZINC.NS", "HYUNDAI.NS", "INDHOTEL.NS", "IOC.NS",
  "IRFC.NS", "JINDALSTEL.NS", "LODHA.NS", "LTIM.NS", "MAZDOCK.NS",
  "MUTHOOTFIN.NS", "PIDILITIND.NS", "PFC.NS", "PNB.NS", "RECLTD.NS",
  "MOTHERSON.NS", "SHREECEM.NS", "SIEMENS.NS", "ENRIN.NS", "SOLARINDS.NS",
  "TATACAP.NS", "TMCV.NS", "TATAPOWER.NS", "TORNTPHARM.NS", "TVSMOTOR.NS",
  "UNIONBANK.NS", "UNITDSPR.NS", "VBL.NS", "VEDL.NS", "ZYDUSLIFE.NS",
  // Additional BSE 100 names not already covered above
  "SBICARD.NS", "ICICIGI.NS", "ICICIPRULI.NS", "IDFCFIRSTB.NS", "FEDERALBNK.NS",
  "AUBANK.NS", "BANDHANBNK.NS", "INDIANB.NS", "BANKINDIA.NS", "LICI.NS",
  "PERSISTENT.NS", "COFORGE.NS", "MPHASIS.NS", "LTTS.NS", "NAUKRI.NS",
  "OFSS.NS", "LUPIN.NS", "AUROPHARMA.NS", "ALKEM.NS", "BIOCON.NS",
  "IPCALAB.NS", "MANKIND.NS", "GLENMARK.NS", "MARICO.NS", "DABUR.NS",
  "COLPAL.NS", "PAGEIND.NS", "HAVELLS.NS", "VOLTAS.NS", "BERGEPAINT.NS",
  "UBL.NS", "EMAMILTD.NS", "PGHH.NS", "POLYCAB.NS", "ASTRAL.NS",
  "BHARATFORG.NS", "ASHOKLEY.NS", "MRF.NS", "APOLLOTYRE.NS", "JKCEMENT.NS",
  "DALBHARAT.NS", "SRF.NS", "BALKRISIND.NS", "CONCOR.NS", "PETRONET.NS",
  "INDUSTOWER.NS", "GODREJPROP.NS", "OBEROIRLTY.NS", "PHOENIXLTD.NS", "NHPC.NS",
  "SJVN.NS", "ATGL.NS", "POLICYBZR.NS", "JUBLFOOD.NS"
];

// How many top-ranked stocks to write to Airtable each run.
const TOP_N = 50;

// Airtable's REST API caps record creation at 10 records per request.
const AIRTABLE_BATCH_SIZE = 10;

const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Yahoo Finance's quoteSummary endpoint (used for fundamentals) now requires
// a session cookie + auth "crumb". The chart endpoint (used for price/technical
// data) does not. This fetches the cookie+crumb once and reuses it for every ticker.
async function getYahooAuth() {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: HEADERS,
    redirect: "manual"
  });
  const cookies = cookieRes.headers.getSetCookie
    ? cookieRes.headers.getSetCookie()
    : [cookieRes.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...HEADERS, Cookie: cookieHeader }
  });
  if (!crumbRes.ok) throw new Error(`Failed to get Yahoo crumb: HTTP ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes("Invalid") || crumb.includes("<")) {
    throw new Error(`Got a bad crumb value: "${crumb.slice(0, 80)}"`);
  }

  return { cookieHeader, crumb };
}

// Rule-based entry zone / stop-loss, derived purely from the moving averages
// and RSI already computed for the technical score. This is a mechanical
// technical-analysis output, not personalized investment advice — treat it
// as one more input into your own judgement.
function computeEntryZone(currentPrice, dma50, dma200, rsi) {
  const round2 = (n) => Number(n.toFixed(2));
  let entryLow = null;
  let entryHigh = null;
  let stopLoss = null;
  let note;

  if (currentPrice > dma50 && dma50 > dma200) {
    entryLow = dma50 * 0.98;
    entryHigh = Math.max(dma50 * 1.03, entryLow * 1.02);
    entryHigh = Math.min(entryHigh, currentPrice > entryLow ? currentPrice * 1.01 : entryHigh);
    stopLoss = Math.min(dma200, entryLow * 0.93);
    note = "Uptrend intact (price > 50DMA > 200DMA). Rule-based entry zone is a pullback toward the 50DMA; stop-loss below the 200DMA / ~7% under entry.";
  } else if (currentPrice < dma50 && currentPrice > dma200) {
    entryLow = dma50;
    entryHigh = dma50 * 1.02;
    stopLoss = dma200 * 0.97;
    note = "Price below 50DMA but above 200DMA — consolidation/base-building zone. Rule-based entry only triggers on a reclaim of the 50DMA; stop below the 200DMA.";
  } else if (currentPrice < dma50 && dma50 < dma200) {
    note = "Downtrend structure (price < 50DMA < 200DMA). No rule-based entry zone — this setup favors staying out until the trend structure repairs.";
  } else {
    entryLow = currentPrice * 0.97;
    entryHigh = currentPrice * 1.01;
    stopLoss = dma50 * 0.95;
    note = "Price reclaiming the 50DMA while the 200DMA still declines — early reversal setup. Tight rule-based entry near current price; stop below the 50DMA.";
  }

  if (rsi > 70) {
    note += " Currently overbought (RSI > 70) — the rule-based zone above assumes a pullback first rather than chasing here.";
  }

  return {
    entryLow: entryLow !== null ? round2(entryLow) : null,
    entryHigh: entryHigh !== null ? round2(entryHigh) : null,
    stopLoss: stopLoss !== null ? round2(stopLoss) : null,
    entryNote: note
  };
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
  const entryZone = computeEntryZone(currentPrice, dma50, dma200, rsi);

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
    compositeScore: Number(compositeScore.toFixed(1)),
    entryLow: entryZone.entryLow,
    entryHigh: entryZone.entryHigh,
    stopLoss: entryZone.stopLoss,
    entryNote: entryZone.entryNote
  };
}

async function writeToAirtable(records) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;
  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const batch = records.slice(i, i + AIRTABLE_BATCH_SIZE);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ records: batch, typecast: true })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable write failed for batch starting at ${i}: ${res.status} ${body}`);
    }
    if (i + AIRTABLE_BATCH_SIZE < records.length) {
      await sleep(250);
    }
  }
}

async function main() {
  const results = [];

  let auth;
  try {
    auth = await getYahooAuth();
  } catch (e) {
    console.error(`Could not get Yahoo auth (fundamentals will fail): ${e.message}`);
    auth = null;
  }

  for (const symbol of watchlist) {
    try {
      const priceJson = await fetchJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`
      );
      const fundUrl = auth
        ? `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail,price&crumb=${encodeURIComponent(auth.crumb)}`
        : `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail,price`;
      const fundJson = await fetchJson(
        fundUrl,
        auth ? { Cookie: auth.cookieHeader } : {}
      );
      results.push(computeIndicatorsAndScore(symbol, priceJson, fundJson));
    } catch (e) {
      console.warn(`Skipped ${symbol}: ${e.message}`);
    }
    // Be gentle with Yahoo's unofficial API across a ~150-ticker universe.
    await sleep(200);
  }

  const top = results.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, TOP_N);
  const today = new Date().toISOString().slice(0, 10);

  const records = top.map((s) => ({
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
      "Entry Zone Low": s.entryLow,
      "Entry Zone High": s.entryHigh,
      "Suggested Stop Loss": s.stopLoss,
      "Entry Notes": s.entryNote,
      "Data Source": "Yahoo Finance (free/public)"
    }
  }));

  if (records.length === 0) {
    console.log("No records to write — all tickers failed to fetch.");
    return;
  }

  await writeToAirtable(records);
  console.log(`Wrote ${records.length} records for ${today} (screened ${results.length}/${watchlist.length} tickers successfully):`);
  top.forEach((s) => console.log(`  ${s.symbol} — composite ${s.compositeScore}`));
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
