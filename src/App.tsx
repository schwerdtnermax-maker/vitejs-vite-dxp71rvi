import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { Plus, X, TrendingUp, TrendingDown, RefreshCw, Clock } from 'lucide-react';

// ---- Konfiguration ----------------------------------------------------

const BUY_LADDER = [
  { price: 55000, amount: 400 },
  { price: 52500, amount: 400 },
  { price: 50000, amount: 400 },
  { price: 47500, amount: 400 },
  { price: 45000, amount: 400 },
];

const TRANSFER_DATE = new Date('2026-12-28T16:00:00');
const HISTORY_KEY = 'ledgerwatch_history_v1';
const HISTORY_MAX_POINTS = 300;
const HISTORY_MIN_GAP_MS = 60000; // frühestens jede Minute einen neuen Punkt loggen

const WATCHLIST_IDS = ['bitcoin', 'solana', 'ethereum', 'binancecoin', 'sui', 'avalanche-2', 'ripple'];

const COIN_META = {
  bitcoin: { symbol: 'BTC', name: 'Bitcoin', color: '#F7931A', binance: 'BTCUSDT' },
  solana: { symbol: 'SOL', name: 'Solana', color: '#9945FF', binance: 'SOLUSDT' },
  ethereum: { symbol: 'ETH', name: 'Ethereum', color: '#627EEA', binance: 'ETHUSDT' },
  binancecoin: { symbol: 'BNB', name: 'BNB', color: '#F3BA2F', binance: 'BNBUSDT' },
  sui: { symbol: 'SUI', name: 'Sui', color: '#4DA2FF', binance: 'SUIUSDT' },
  'avalanche-2': { symbol: 'AVAX', name: 'Avalanche', color: '#E84142', binance: 'AVAXUSDT' },
  ripple: { symbol: 'XRP', name: 'XRP', color: '#25A768', binance: 'XRPUSDT' },
};

// Icons von einer öffentlichen CDN — fällt automatisch auf den Buchstaben-Kreis
// zurück, falls ein Symbol dort nicht existiert (siehe onError in CoinCard).
const iconUrl = (id) => `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/128/color/${COIN_META[id].symbol.toLowerCase()}.png`;

// Startbestand — Menge & Einstiegspreis in USD pro Coin.
// Kann direkt in der App über "+" bei jedem Coin ergänzt werden.
const INITIAL_POSITIONS = {
  bitcoin: { amount: 0.02822850, avgEntry: 64787 },
  solana: { amount: 0, avgEntry: 0 },
  ethereum: { amount: 0, avgEntry: 0 },
  binancecoin: { amount: 0, avgEntry: 0 },
  sui: { amount: 0, avgEntry: 0 },
  'avalanche-2': { amount: 0, avgEntry: 0 },
  ripple: { amount: 0, avgEntry: 0 },
};

// ---- Helpers ------------------------------------------------------------

const fmtUSD = (n, d = 2) =>
  n == null ? '—' : `$${n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmtEUR = (n, d = 2) =>
  n == null ? '—' : `€${n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmtPct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);

// ---- Component ------------------------------------------------------------

const STORAGE_KEY = 'ledgerwatch_positions_v1';

const loadStoredPositions = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge mit INITIAL_POSITIONS, falls neue Coins hinzugefügt wurden
      return { ...INITIAL_POSITIONS, ...parsed };
    }
  } catch (e) {
    // localStorage nicht verfügbar oder defektes JSON — Fallback auf Startwerte
  }
  return INITIAL_POSITIONS;
};

const loadStoredHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignorieren, mit leerer Historie starten
  }
  return [];
};

export default function StackFolio() {
  const [coins, setCoins] = useState(null);
  const [eurRate, setEurRate] = useState(0.865);
  const [fng, setFng] = useState(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(new Date());
  const [lastSuccess, setLastSuccess] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [positions, setPositions] = useState(loadStoredPositions);
  const [openForm, setOpenForm] = useState(null); // coinId of open "add purchase" form
  const [history, setHistory] = useState(loadStoredHistory);
  const lastLoggedAt = useRef(0);

  // Positionen bei jeder Änderung dauerhaft im Browser speichern
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    } catch (e) {
      // Speicher voll oder nicht verfügbar — Positionen bleiben trotzdem im aktuellen Tab erhalten
    }
  }, [positions]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const symbols = WATCHLIST_IDS.map((id) => COIN_META[id].binance);
    const symbolsParam = encodeURIComponent(JSON.stringify([...symbols, 'BTCEUR']));

    const results = await Promise.allSettled([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`).then((r) => r.json()),
      fetch('https://api.alternative.me/fng/?limit=1').then((r) => r.json()),
    ]);
    const [t, f] = results;
    let ok = false;

    if (t.status === 'fulfilled' && Array.isArray(t.value)) {
      const bySymbol = {};
      t.value.forEach((row) => {
        bySymbol[row.symbol] = row;
      });
      const btcEur = bySymbol['BTCEUR'];
      const btcUsd = bySymbol['BTCUSDT'];
      if (btcEur && btcUsd) {
        setEurRate(parseFloat(btcEur.lastPrice) / parseFloat(btcUsd.lastPrice));
      }
      const newCoins = WATCHLIST_IDS.map((id) => {
        const row = bySymbol[COIN_META[id].binance];
        if (!row) return null;
        return {
          id,
          symbol: COIN_META[id].symbol,
          current_price: parseFloat(row.lastPrice),
          price_change_percentage_24h: parseFloat(row.priceChangePercent),
          image: iconUrl(id),
        };
      }).filter(Boolean);
      if (newCoins.length > 0) {
        setCoins((prev) =>
          newCoins.map((c) => ({
            ...c,
            sparkline_in_7d: { price: prev?.find((p) => p.id === c.id)?.sparkline_in_7d?.price || [] },
          }))
        );
        ok = true;
      }
    }
    if (f.status === 'fulfilled' && f.value?.data?.[0]) setFng(f.value.data[0]);
    setLive(ok);
    if (ok) setLastSuccess(new Date());
    setRefreshing(false);
  }, []);

  // Sparklines (7 Tage, 4h-Kerzen) seltener laden — Binance erlaubt das großzügig,
  // aber es gibt keinen Grund, das bei jedem 10s-Preis-Tick mitzuladen.
  const loadSparklines = useCallback(async () => {
    const results = await Promise.allSettled(
      WATCHLIST_IDS.map((id) =>
        fetch(`https://api.binance.com/api/v3/klines?symbol=${COIN_META[id].binance}&interval=4h&limit=42`).then((r) => r.json())
      )
    );
    setCoins((prev) => {
      if (!prev) return prev;
      return prev.map((c, i) => {
        const res = results[i];
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          const closes = res.value.map((k) => parseFloat(k[4]));
          return { ...c, sparkline_in_7d: { price: closes } };
        }
        return c;
      });
    });
  }, []);

  useEffect(() => {
    const clockId = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clockId);
  }, []);

  useEffect(() => {
    load();
    loadSparklines();
    const priceId = setInterval(load, 10000);
    const sparkId = setInterval(loadSparklines, 120000);
    return () => {
      clearInterval(priceId);
      clearInterval(sparkId);
    };
  }, [load, loadSparklines]);

  const priceUSD = (id) => coins?.find((c) => c.id === id)?.current_price ?? null;

  const addPurchase = (id, qty, price) => {
    setPositions((prev) => {
      const pos = prev[id] || { amount: 0, avgEntry: 0 };
      const newAmount = pos.amount + qty;
      const newAvg = newAmount > 0 ? (pos.amount * pos.avgEntry + qty * price) / newAmount : 0;
      return { ...prev, [id]: { amount: newAmount, avgEntry: newAvg } };
    });
    setOpenForm(null);
  };

  // Portfolio-Summe über alle Coins mit Bestand
  let totalValueEUR = 0;
  let totalCostEUR = 0;
  WATCHLIST_IDS.forEach((id) => {
    const pos = positions[id];
    const p = priceUSD(id);
    if (pos?.amount > 0 && p != null) {
      totalValueEUR += pos.amount * p * eurRate;
      totalCostEUR += pos.amount * pos.avgEntry * eurRate;
    }
  });
  const totalPL = totalValueEUR - totalCostEUR;
  const totalPLPct = totalCostEUR > 0 ? (totalPL / totalCostEUR) * 100 : 0;

  // Allokation je Coin für das Pie-Chart
  const allocation = WATCHLIST_IDS.map((id) => {
    const pos = positions[id];
    const p = priceUSD(id);
    const value = pos?.amount > 0 && p != null ? pos.amount * p * eurRate : 0;
    return { id, name: COIN_META[id].symbol, color: COIN_META[id].color, value };
  }).filter((a) => a.value > 0);

  // Portfolio-Verlauf: alle ~60s (oder sofort bei einem neuen Kauf) einen Punkt loggen
  useEffect(() => {
    if (totalValueEUR <= 0) return;
    const nowMs = Date.now();
    if (nowMs - lastLoggedAt.current < HISTORY_MIN_GAP_MS) return;
    lastLoggedAt.current = nowMs;
    setHistory((prev) => {
      const next = [...prev, { t: nowMs, v: totalValueEUR }].slice(-HISTORY_MAX_POINTS);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch (e) {
        // Speicher voll — Verlauf bleibt trotzdem im aktuellen Tab erhalten
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalValueEUR]);

  // Countdown bis zum geplanten TR→Ledger Transfer
  const msLeft = TRANSFER_DATE.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.floor(msLeft / (1000 * 60 * 60 * 24)));
  const hoursLeft = Math.max(0, Math.floor((msLeft / (1000 * 60 * 60)) % 24));
  const minsLeft = Math.max(0, Math.floor((msLeft / (1000 * 60)) % 60));

  const btcPrice = priceUSD('bitcoin');
  const nextRung = btcPrice != null ? BUY_LADDER.find((r) => btcPrice <= r.price) : null;
  const rungIdx = nextRung ? BUY_LADDER.indexOf(nextRung) : -1;

  const fngValue = fng ? parseInt(fng.value, 10) : null;
  const fngLabelMap = { 'Extreme Fear': 'Extreme Angst', Fear: 'Angst', Neutral: 'Neutral', Greed: 'Gier', 'Extreme Greed': 'Extreme Gier' };

  return (
    <div style={s.page}>
      <div style={s.container}>
        {/* Header */}
        <header style={s.header}>
          <div>
            <div style={s.brand}>Portfolio</div>
            <div style={s.brandSub}>Self-Custody Tracker</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={s.liveTag}>
              <span style={{ ...s.dot, background: live ? '#22C55E' : lastSuccess ? '#F59E0B' : '#94A3B8' }} />
              {live
                ? 'Aktualisiert'
                : lastSuccess
                ? `Stand ${lastSuccess.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : 'Verbinde…'}
              {' · '}
              {now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <button
              onClick={load}
              disabled={refreshing}
              style={s.refreshBtn}
              aria-label="Jetzt aktualisieren"
              title="Jetzt aktualisieren"
            >
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
            </button>
          </div>
        </header>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>

        {/* Hero total */}
        <section style={s.hero}>
          <div style={s.eyebrow}>GESAMTWERT PORTFOLIO</div>
          <div style={s.heroNum}>{fmtEUR(totalValueEUR)}</div>
          <div style={s.heroRow}>
            <span style={{ ...s.plTag, color: totalPL >= 0 ? '#4ADE80' : '#F87171', background: totalPL >= 0 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)' }}>
              {totalPL >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {totalPL >= 0 ? '+' : ''}{fmtEUR(totalPL)} ({fmtPct(totalPLPct)})
            </span>
            <span style={s.costNote}>Einsatz {fmtEUR(totalCostEUR)}</span>
          </div>
        </section>

        {/* Fear & Greed + Kaufleiter */}
        <section style={s.dualGrid}>
          <div style={s.panel}>
            <div style={s.panelTitle}>Fear &amp; Greed</div>
            <div style={s.fngRow}>
              <span style={{ ...s.fngNum, color: fngValue != null ? zoneColor(fngValue) : '#94A3B8' }}>
                {fngValue ?? '—'}
              </span>
              <span style={s.fngLabel}>{fng ? fngLabelMap[fng.value_classification] || fng.value_classification : 'lädt…'}</span>
            </div>
            <div style={s.fngTrack}>
              <div style={s.fngGradient} />
              {fngValue != null && <div style={{ ...s.fngMarker, left: `${fngValue}%` }} />}
            </div>
          </div>

          <div style={s.panel}>
            <div style={s.panelTitle}>Kaufleiter · BTC</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {BUY_LADDER.map((r, i) => {
                const active = i === rungIdx;
                return (
                  <div key={r.price} style={s.rungRow}>
                    <span style={{ ...s.rungDot, background: active ? '#4ADE80' : '#2A3140' }} />
                    <span style={{ ...s.rungPrice, color: active ? '#0F172A' : '#94A3B8' }}>${r.price.toLocaleString('de-DE')}</span>
                    <span style={{ ...s.rungAmt, color: active ? '#4ADE80' : '#3A4152' }}>{active ? `AKTIV · €${r.amount}` : `€${r.amount}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Transfer-Countdown */}
        <section style={{ marginBottom: 20 }}>
          <div style={s.panel}>
            <div style={s.panelTitle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Clock size={11} /> TR → LEDGER TRANSFER
              </span>
            </div>
            {msLeft > 0 ? (
              <div style={s.countdownRow}>
                <CountdownBlock value={daysLeft} label="Tage" />
                <CountdownBlock value={hoursLeft} label="Std" />
                <CountdownBlock value={minsLeft} label="Min" />
                <span style={s.countdownDate}>28.12.2026 · 16:00</span>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 13, color: '#4ADE80', fontWeight: 700 }}>Termin erreicht</div>
            )}
          </div>
        </section>

        {/* Verlauf + Allokation */}
        <section style={s.dualGrid}>
          <div style={s.panel}>
            <div style={s.panelTitle}>PORTFOLIO-VERLAUF</div>
            {history.length >= 2 ? (
              <div style={{ height: 130, marginTop: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <XAxis dataKey="t" hide />
                    <YAxis hide domain={['dataMin - dataMin*0.02', 'dataMax + dataMax*0.02']} />
                    <Tooltip
                      contentStyle={{ background: '#0B0E14', border: '1px solid #2A3140', borderRadius: 8, fontSize: 11 }}
                      labelFormatter={(t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      formatter={(v) => [fmtEUR(v), 'Wert']}
                    />
                    <Line type="monotone" dataKey="v" stroke="#4ADE80" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 11.5, color: '#64748B' }}>
                Verlauf wird aufgezeichnet — Punkte sammeln sich mit der Zeit
              </div>
            )}
          </div>

          <div style={s.panel}>
            <div style={s.panelTitle}>ALLOKATION</div>
            {allocation.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <div style={{ width: 90, height: 90, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={26} outerRadius={42} paddingAngle={2} stroke="none">
                        {allocation.map((a) => (
                          <Cell key={a.id} fill={a.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                  {allocation
                    .slice()
                    .sort((a, b) => b.value - a.value)
                    .map((a) => (
                      <div key={a.id} style={s.allocRow}>
                        <span style={{ ...s.allocDot, background: a.color }} />
                        <span style={s.allocSymbol}>{a.name}</span>
                        <span style={s.allocPct}>{((a.value / totalValueEUR) * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 11.5, color: '#64748B' }}>Noch keine Positionen</div>
            )}
          </div>
        </section>

        {/* Positions */}
        <section>
          <div style={s.sectionTitle}>POSITIONEN</div>
          <div style={s.list}>
            {WATCHLIST_IDS.map((id) => (
              <CoinCard
                key={id}
                id={id}
                meta={COIN_META[id]}
                coin={coins?.find((c) => c.id === id)}
                eurRate={eurRate}
                position={positions[id]}
                open={openForm === id}
                onToggleForm={() => setOpenForm(openForm === id ? null : id)}
                onAdd={(qty, price) => addPurchase(id, qty, price)}
              />
            ))}
          </div>
        </section>

        <footer style={s.footer}>Self-Custody · Käufe werden dauerhaft in diesem Browser gespeichert</footer>
      </div>
    </div>
  );
}

// Reset-Funktion für die Konsole (optional): localStorage.removeItem('ledgerwatch_positions_v1')

// ---- Coin Card ------------------------------------------------------------

function CoinCard({ id, meta, coin, eurRate, position, open, onToggleForm, onAdd }) {
  const [amountUSD, setAmountUSD] = useState('');
  const [price, setPrice] = useState('');

  const priceUSD = coin?.current_price ?? null;
  const priceEUR = priceUSD != null ? priceUSD * eurRate : null;
  const change = coin?.price_change_percentage_24h;
  const positive = change >= 0;
  const spark = coin?.sparkline_in_7d?.price || [];
  const sparkData = spark.map((p, i) => ({ i, p }));

  const hasPosition = position?.amount > 0;
  const posValueEUR = hasPosition && priceEUR != null ? position.amount * priceEUR : null;
  const posCostEUR = hasPosition ? position.amount * position.avgEntry * eurRate : null;
  const posPL = hasPosition && posValueEUR != null ? posValueEUR - posCostEUR : null;
  const posPLPct = hasPosition && posCostEUR > 0 ? (posPL / posCostEUR) * 100 : null;

  const submit = () => {
    const invested = parseFloat(amountUSD);
    const p = parseFloat(price);
    if (invested > 0 && p > 0) {
      const qty = invested / p; // Menge automatisch aus investiertem Betrag berechnet
      onAdd(qty, p);
      setAmountUSD('');
      setPrice('');
    }
  };

  return (
    <div style={s.card}>
      <div style={s.cardRow}>
        {coin?.image ? (
          <img
            src={coin.image}
            alt={meta.symbol}
            style={s.coinIcon}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div style={{ ...s.coinDot, background: meta.color, display: coin?.image ? 'none' : 'flex' }}>{meta.symbol.slice(0, 1)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.coinName}>{meta.symbol}</div>
          <div style={s.coinSub}>{meta.name}</div>
        </div>
        <div style={{ width: 70, height: 30, flexShrink: 0 }}>
          {sparkData.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="p" stroke={positive ? '#4ADE80' : '#F87171'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div style={{ textAlign: 'right', minWidth: 92 }}>
          <div style={s.priceUSD}>{priceUSD != null ? fmtUSD(priceUSD, 2) : '—'}</div>
          <div style={{ ...s.change, color: positive ? '#4ADE80' : '#F87171' }}>{fmtPct(change)}</div>
        </div>
        <button style={s.addBtn} onClick={onToggleForm} aria-label="Kauf hinzufügen">
          {open ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {hasPosition && (
        <div style={s.posRow}>
          <div style={s.posItem}>
            <span style={s.posLabel}>Bestand</span>
            <span style={s.posValue}>{position.amount.toFixed(id === 'bitcoin' ? 8 : 4)} {meta.symbol}</span>
          </div>
          <div style={s.posItem}>
            <span style={s.posLabel}>Ø Einstieg</span>
            <span style={s.posValue}>{fmtUSD(position.avgEntry, 2)}</span>
          </div>
          <div style={s.posItem}>
            <span style={s.posLabel}>Wert</span>
            <span style={s.posValue}>{fmtEUR(posValueEUR)}</span>
          </div>
          <div style={s.posItem}>
            <span style={s.posLabel}>P&amp;L</span>
            <span style={{ ...s.posValue, color: posPL >= 0 ? '#4ADE80' : '#F87171', fontWeight: 700 }}>
              {posPL >= 0 ? '+' : ''}{fmtEUR(posPL)} ({fmtPct(posPLPct)})
            </span>
          </div>
        </div>
      )}

      {open && (
        <div style={s.form}>
          <div style={s.formField}>
            <label style={s.formLabel}>Investiert (USD)</label>
            <input style={s.formInput} type="number" step="any" value={amountUSD} onChange={(e) => setAmountUSD(e.target.value)} placeholder="z.B. 400" />
          </div>
          <div style={s.formField}>
            <label style={s.formLabel}>Preis pro {meta.symbol} (USD)</label>
            <input style={s.formInput} type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="z.B. 55000" />
          </div>
          <button style={s.formSubmit} onClick={submit}>Hinzufügen</button>
          {parseFloat(amountUSD) > 0 && parseFloat(price) > 0 && (
            <div style={s.formPreview}>
              ≈ {(parseFloat(amountUSD) / parseFloat(price)).toFixed(id === 'bitcoin' ? 8 : 4)} {meta.symbol}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CountdownBlock({ value, label }) {
  return (
    <div style={s.countdownBlock}>
      <span style={s.countdownValue}>{value}</span>
      <span style={s.countdownLabel}>{label}</span>
    </div>
  );
}

function zoneColor(v) {
  if (v < 25) return '#F87171';
  if (v < 45) return '#FB923C';
  if (v < 55) return '#FACC15';
  if (v < 75) return '#A3E635';
  return '#4ADE80';
}

// ---- Styles ------------------------------------------------------------

const s = {
  page: { minHeight: '100vh', background: '#0B0E14', color: '#E5E9F0', fontFamily: "'Inter', -apple-system, sans-serif" },
  container: { maxWidth: 640, margin: '0 auto', padding: '24px 18px 60px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  brand: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: '#F1F5F9' },
  brandSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  liveTag: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B', fontFamily: "'JetBrains Mono', monospace" },
  refreshBtn: { width: 24, height: 24, borderRadius: 7, border: '1px solid #2A3140', background: '#1A1F2B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', cursor: 'pointer', padding: 0 },
  dot: { width: 6, height: 6, borderRadius: '50%' },

  hero: { background: '#12161F', border: '1px solid #1E2430', borderRadius: 16, padding: '22px 20px', marginBottom: 14 },
  eyebrow: { fontSize: 10.5, letterSpacing: '0.08em', color: '#64748B', fontWeight: 700 },
  heroNum: { fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 6, fontFamily: "'JetBrains Mono', monospace", color: '#F8FAFC' },
  heroRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' },
  plTag: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, padding: '5px 10px', borderRadius: 8, fontFamily: "'JetBrains Mono', monospace" },
  costNote: { fontSize: 11.5, color: '#64748B' },

  dualGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 },
  panel: { background: '#12161F', border: '1px solid #1E2430', borderRadius: 14, padding: '15px 16px' },
  panelTitle: { fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' },
  fngRow: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 },
  fngNum: { fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" },
  fngLabel: { fontSize: 12, color: '#94A3B8', fontWeight: 600 },
  fngTrack: { position: 'relative', height: 5, borderRadius: 3, marginTop: 14 },
  fngGradient: { position: 'absolute', inset: 0, borderRadius: 3, background: 'linear-gradient(90deg,#F87171,#FB923C,#FACC15,#A3E635,#4ADE80)', opacity: 0.9 },
  fngMarker: { position: 'absolute', top: -2.5, width: 10, height: 10, borderRadius: '50%', background: '#0B0E14', border: '2px solid #E5E9F0', transform: 'translateX(-50%)' },

  rungRow: { display: 'flex', alignItems: 'center', gap: 8 },
  rungDot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0 },
  rungPrice: { fontSize: 12, fontWeight: 600, flex: 1, fontFamily: "'JetBrains Mono', monospace" },
  rungAmt: { fontSize: 10.5, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" },

  sectionTitle: { fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', marginBottom: 10 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },

  card: { background: '#12161F', border: '1px solid #1E2430', borderRadius: 14, padding: 14 },
  cardRow: { display: 'flex', alignItems: 'center', gap: 12 },
  coinDot: { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 },
  coinIcon: { width: 30, height: 30, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', background: '#1A1F2B' },
  coinName: { fontSize: 13.5, fontWeight: 700, color: '#F1F5F9' },
  coinSub: { fontSize: 11, color: '#64748B', marginTop: 1 },
  priceUSD: { fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#F1F5F9' },
  change: { fontSize: 11, fontWeight: 600, marginTop: 1, fontFamily: "'JetBrains Mono', monospace" },
  addBtn: { width: 28, height: 28, borderRadius: 8, border: '1px solid #2A3140', background: '#1A1F2B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', cursor: 'pointer', flexShrink: 0 },

  posRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #1E2430' },
  posItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  posLabel: { fontSize: 9.5, color: '#64748B', fontWeight: 600, letterSpacing: '0.03em' },
  posValue: { fontSize: 11.5, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: '#E5E9F0' },

  form: { display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid #1E2430', flexWrap: 'wrap' },
  formField: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 110px' },
  formLabel: { fontSize: 10, color: '#64748B', fontWeight: 600 },
  formInput: { border: '1px solid #2A3140', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: 'none', background: '#0B0E14', color: '#E5E9F0' },
  formSubmit: { background: '#E5E9F0', color: '#0B0E14', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  formPreview: { fontSize: 11, color: '#64748B', fontFamily: "'JetBrains Mono', monospace", width: '100%', marginTop: -2 },

  footer: { textAlign: 'center', fontSize: 10.5, color: '#374151', marginTop: 24 },

  countdownRow: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' },
  countdownBlock: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 },
  countdownValue: { fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#F1F5F9' },
  countdownLabel: { fontSize: 9.5, color: '#64748B', fontWeight: 600, letterSpacing: '0.03em', marginTop: 1 },
  countdownDate: { fontSize: 11, color: '#64748B', marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace" },

  allocRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 },
  allocDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  allocSymbol: { fontWeight: 700, color: '#E5E9F0', flex: 1 },
  allocPct: { fontFamily: "'JetBrains Mono', monospace", color: '#94A3B8', fontWeight: 600 },
};
