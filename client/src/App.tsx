import React, { useState, useEffect, useCallback, useRef } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Features {
  accounts_available: boolean;
  opportunities_available: boolean;
  activities_available: boolean;
  renewals_active: boolean;
  alerts_active: boolean;
  health_score_active: boolean;
  churn_active: boolean;
}

interface Account {
  id: number;
  name: string;
  industry: string;
  region: string;
  segment: string;
  owner_rep: string;
  tier: string;
  status: string;
  created_date: string;
  health_score?: number;
  renewals?: Renewal[];
  alerts?: RiskAlert[];
}

interface Renewal {
  renewal_type: string;
  contract_value_usd: number;
  renewal_date: string;
  likelihood: number;
}

interface RiskAlert {
  alert_type: string;
  severity: string;
  message: string;
  created_at: string;
}

interface Opportunity {
  id: number;
  account_id: number;
  account_name: string;
  segment: string;
  close_date: string;
  opp_number: number;
  amount_usd: number;
  stage: string;
  probability: number;
  product_line: string;
  weighted_amount: number;
}

interface OppStats {
  total_opps: number;
  total_pipeline_usd: number;
  weighted_pipeline_usd: number;
  avg_deal_size_usd: number;
}

/* Synced from the lakehouse: ML team's churn-prediction gold table. */
interface ChurnPrediction {
  account_id: number;
  account_name: string;
  segment: string;
  churn_risk_score: number;          // 0.0 - 1.0
  risk_band: string;                 // Low | Medium | High
  predicted_arr_at_risk_usd: number;
  top_churn_driver: string;
  recommended_action: string;
  model_version: string;
  scored_at: string;
}

interface ChurnStats {
  total_arr_at_risk_usd: number;
  high_risk_accounts: number;
  avg_churn_score: number;
  model_version: string;
  scored_at: string;
}

/* Tabs */
type Tab = 'demo' | 'accounts' | 'opportunities' | 'churn';

/* ------------------------------------------------------------------ */
/*  Colors -- Databricks-inspired sales palette                        */
/* ------------------------------------------------------------------ */

/* Databricks brand palette
   https://brandguides.brandfolder.com/databricks-extended-brand-guidelines/colors
   Lava (primary): #FF3621 | Navy 800: #1B3139 | Oat: #F9F7F4 / #EEEDE9
   Secondary: Green #00A972, Blue #2272B4, Yellow #FCA700, Maroon #98102A, Purple #8A63D2 */
const COLORS = {
  primary: '#1B3139',      // Navy 800
  primaryDark: '#0E1B20',  // deeper navy
  primaryLight: '#5A6E76', // muted navy
  primaryBg: '#F5F5F0',    // oat tint
  accent: '#FF3621',       // Lava (Databricks orange)
  success: '#00A972',      // Databricks green
  successBg: '#DBF3E8',
  warning: '#FCA700',      // Databricks yellow
  warningBg: '#FDF0D5',
  danger: '#98102A',       // Databricks maroon
  dangerBg: '#F8DEDF',
  gray50: '#F9F7F4',       // Oat Light
  gray100: '#EEEDE9',      // Oat Medium
  gray200: '#E0DED8',
  gray300: '#CAC7BF',
  gray400: '#98948B',
  gray500: '#6B6862',
  gray700: '#3C3A36',
  gray800: '#1B3139',      // Navy 800 for text
  gray900: '#0E1B20',
  white: '#FFFFFF',
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: COLORS.gray50,
    color: COLORS.gray800,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
    color: COLORS.white,
    padding: '0 32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: 400,
    opacity: 0.8,
    marginLeft: 12,
  },
  nav: {
    display: 'flex',
    gap: 4,
    padding: '0 32px',
    backgroundColor: COLORS.white,
    borderBottom: `1px solid ${COLORS.gray200}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  navTab: {
    padding: '14px 24px',
    cursor: 'pointer',
    border: 'none',
    backgroundColor: 'transparent',
    color: COLORS.gray500,
    fontSize: 14,
    fontWeight: 500,
    borderBottom: '3px solid transparent',
    transition: 'all 0.2s ease',
  },
  navTabActive: {
    color: COLORS.primary,
    borderBottom: `3px solid ${COLORS.accent}`,
    fontWeight: 600,
  },
  // Top-level row: the app column (left) + the Demo Control console (right),
  // each a full-height independent surface.
  body: {
    flex: 1,
    display: 'flex',
    alignItems: 'stretch',
    minHeight: 0,
  },
  // Left column holding the app's own header, nav, content and footer — so the
  // app chrome stays entirely on the left and never brackets the console.
  appColumn: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: '24px 32px',
    boxSizing: 'border-box' as const,
    overflowY: 'auto' as const,
  },
  // Fixed ~18% "remote control" panel, scrolls independently of the app.
  // Dark "operator console" dock — visually distinct from the light app so it
  // reads as the presenter's remote control, not a feature of the product.
  panel: {
    width: '20%',
    minWidth: 320,
    maxWidth: 440,
    flexShrink: 0,
    backgroundColor: COLORS.primaryDark,
    borderLeft: `1px solid #000`,
    boxShadow: '-4px 0 16px rgba(0,0,0,0.25)',
    padding: '14px 16px 24px',
    overflowY: 'auto' as const,
    boxSizing: 'border-box' as const,
  },
  panelHeaderBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.12)',
  },
  panelCollapseBtn: {
    border: '1px solid rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.8)',
    borderRadius: 14,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  // Thin tab shown when the panel is collapsed; click to reopen.
  panelReopen: {
    flexShrink: 0,
    width: 40,
    border: 'none',
    borderLeft: `1px solid ${COLORS.gray200}`,
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    writingMode: 'vertical-rl' as const,
    textOrientation: 'mixed' as const,
    letterSpacing: '0.05em',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
    padding: 24,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: COLORS.gray800,
    marginBottom: 16,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 14,
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    backgroundColor: COLORS.gray50,
    color: COLORS.gray500,
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    borderBottom: `2px solid ${COLORS.gray200}`,
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '12px 16px',
    borderBottom: `1px solid ${COLORS.gray100}`,
    color: COLORS.gray700,
  },
  trHover: {
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: '20px 24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    borderLeft: `4px solid ${COLORS.primary}`,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: COLORS.gray500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginTop: 4,
  },
  unavailable: {
    textAlign: 'center' as const,
    padding: '60px 40px',
    backgroundColor: COLORS.primaryBg,
    borderRadius: 12,
    border: `1px solid ${COLORS.accent}33`,
  },
  unavailableTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: COLORS.primary,
    marginBottom: 8,
  },
  unavailableText: {
    fontSize: 15,
    color: COLORS.gray500,
    maxWidth: 500,
    margin: '0 auto',
    lineHeight: 1.6,
  },
  statusBar: {
    backgroundColor: COLORS.white,
    borderTop: `1px solid ${COLORS.gray200}`,
    padding: '8px 32px',
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    fontSize: 12,
    color: COLORS.gray500,
    flexWrap: 'wrap' as const,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: 6,
  },
  detailPanel: {
    backgroundColor: COLORS.gray50,
    borderRadius: 8,
    padding: 20,
    margin: '0 16px 16px 16px',
    border: `1px solid ${COLORS.gray200}`,
  },
  detailSection: {
    marginBottom: 16,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: COLORS.primary,
    marginBottom: 8,
    borderBottom: `1px solid ${COLORS.gray200}`,
    paddingBottom: 4,
  },
  loading: {
    textAlign: 'center' as const,
    padding: 40,
    color: COLORS.gray400,
    fontSize: 15,
  },
  error: {
    textAlign: 'center' as const,
    padding: 20,
    color: COLORS.danger,
    backgroundColor: COLORS.dangerBg,
    borderRadius: 8,
    fontSize: 14,
  },
  demoBanner: {
    backgroundColor: COLORS.warningBg,
    color: COLORS.warning,
    textAlign: 'center' as const,
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 32px',
    borderBottom: `1px solid ${COLORS.warning}33`,
  },
};

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

const fmtUSD = (n: number) => {
  if (n == null) return '--';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtPct = (n: number) => (n == null ? '--' : `${Math.round(n)}%`);

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    'active': { bg: COLORS.successBg, color: COLORS.success },
    'expansion': { bg: '#DDEAF5', color: '#2272B4' },
    'at risk': { bg: COLORS.warningBg, color: COLORS.warning },
    'churned': { bg: COLORS.dangerBg, color: COLORS.danger },
    'prospect': { bg: COLORS.gray100, color: COLORS.gray500 },
  };
  const s = map[status?.toLowerCase()] || { bg: COLORS.gray100, color: COLORS.gray500 };
  return <span style={{ ...styles.badge, backgroundColor: s.bg, color: s.color }}>{status}</span>;
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    'enterprise': { bg: '#EBE4F8', color: '#8A63D2' },
    'mid-market': { bg: '#DDEAF5', color: '#2272B4' },
    'smb': { bg: COLORS.gray100, color: COLORS.gray500 },
  };
  const s = map[tier?.toLowerCase()] || { bg: COLORS.gray100, color: COLORS.gray500 };
  return <span style={{ ...styles.badge, backgroundColor: s.bg, color: s.color }}>{tier}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    high: { bg: COLORS.dangerBg, color: COLORS.danger },
    medium: { bg: COLORS.warningBg, color: COLORS.warning },
    low: { bg: COLORS.successBg, color: COLORS.success },
  };
  const s = map[severity?.toLowerCase()] || { bg: COLORS.gray100, color: COLORS.gray500 };
  return <span style={{ ...styles.badge, backgroundColor: s.bg, color: s.color }}>{severity}</span>;
}

function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    'prospecting': { bg: COLORS.gray100, color: COLORS.gray500 },
    'qualification': { bg: '#DDEAF5', color: '#2272B4' },
    'proposal': { bg: COLORS.warningBg, color: COLORS.warning },
    'negotiation': { bg: '#F8DEDF', color: '#98102A' },
    'closed won': { bg: COLORS.successBg, color: COLORS.success },
    'closed lost': { bg: COLORS.dangerBg, color: COLORS.danger },
  };
  const s = map[stage?.toLowerCase()] || { bg: COLORS.gray100, color: COLORS.gray500 };
  return <span style={{ ...styles.badge, backgroundColor: s.bg, color: s.color }}>{stage}</span>;
}

function HealthPill({ score }: { score: number }) {
  const color = score >= 70 ? COLORS.success : score >= 40 ? COLORS.warning : COLORS.danger;
  const bg = score >= 70 ? COLORS.successBg : score >= 40 ? COLORS.warningBg : COLORS.dangerBg;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 40, height: 6, borderRadius: 3, backgroundColor: COLORS.gray200,
        display: 'inline-block', overflow: 'hidden', position: 'relative',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: color,
        }} />
      </span>
      <span style={{ fontWeight: 700, color, fontSize: 13 }}>{score}</span>
    </span>
  );
}

function UnavailableCard({ title, message }: { title: string; message: string }) {
  return (
    <div style={styles.unavailable}>
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.5 }}>~</div>
      <div style={styles.unavailableTitle}>{title}</div>
      <div style={styles.unavailableText}>{message}</div>
    </div>
  );
}

function LoadingSpinner() {
  return <div style={styles.loading}>Loading data...</div>;
}

function PipelineLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="14" fill="rgba(255,255,255,0.15)" />
      <path d="M7 18l4-4 3 2 6-7" stroke="rgba(255,255,255,0.95)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="20" cy="9" r="2" fill="#FF6B4A" />
    </svg>
  );
}

/* Per-act feature glyph. Rendered inside the round badge in the Demo Control
   panel, replacing the old sequence numbers so the acts read as a modular menu
   (use any part) rather than an ordered checklist. */
function ActIcon({ name, color }: { name: ActIconName; color: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const paths: Record<ActIconName, React.ReactNode> = {
    // branch: a fork splitting off a trunk (zero-copy branching)
    branch: (<>
      <circle cx="7" cy="4" r="2" {...p} /><circle cx="7" cy="16" r="2" {...p} /><circle cx="15" cy="9" r="2" {...p} />
      <path d="M7 6v8M7 11h3.5a3 3 0 003-3" {...p} />
    </>),
    // rewind: a clock being turned back (point-in-time recovery)
    rewind: (<>
      <path d="M4 10a6 6 0 106-6 6 6 0 00-5 2.6" {...p} /><path d="M5 3v3h3" {...p} /><path d="M10 7v3l2 2" {...p} />
    </>),
    // syncIn: arrow flowing down/in (lakehouse -> lakebase)
    syncIn: (<>
      <path d="M10 3v10" {...p} /><path d="M6 9l4 4 4-4" {...p} /><path d="M4 16h12" {...p} />
    </>),
    // syncOut: arrow flowing up/out (lakebase -> lakehouse, CDF)
    syncOut: (<>
      <path d="M10 17V7" {...p} /><path d="M6 11l4-4 4 4" {...p} /><path d="M4 4h12" {...p} />
    </>),
    // surge: a rising spike (load test / autoscaling)
    surge: (<>
      <path d="M3 15l4-6 3 3 4-8" {...p} /><path d="M14 4h3v3" {...p} />
    </>),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock data -- used when the API is unreachable (local dev preview)  */
/* ------------------------------------------------------------------ */

const MOCK_FEATURES: Features = {
  accounts_available: true,
  opportunities_available: true,
  activities_available: true,
  renewals_active: true,
  alerts_active: true,
  health_score_active: true,
  // churn starts OFF: the synced table doesn't exist until the ML team's
  // gold table is synced into Lakebase during the demo.
  churn_active: false,
};

const INDUSTRIES = ['Financial Services', 'Healthcare', 'Retail', 'Manufacturing', 'Technology', 'Media', 'Energy', 'Public Sector'];
const REGIONS = ['AMER East', 'AMER West', 'EMEA', 'APJ', 'LATAM'];
const SEGMENTS = ['Enterprise', 'Commercial', 'Growth'];
const TIERS = ['Enterprise', 'Mid-Market', 'SMB'];
const STATUSES = ['Active', 'Expansion', 'At Risk', 'Prospect', 'Churned'];
const REPS = ['Alex Rivera', 'Jordan Kim', 'Sam Patel', 'Taylor Brooks', 'Morgan Diaz', 'Casey Wong'];
const STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const PRODUCTS = ['Platform', 'Data Warehouse', 'ML/AI', 'Governance', 'Streaming'];
const COMPANY_A = ['Nimbus', 'Vertex', 'Apex', 'Orbit', 'Summit', 'Pioneer', 'Catalyst', 'Beacon', 'Meridian', 'Quantum', 'Atlas', 'Cobalt', 'Zenith', 'Horizon', 'Northwind'];
const COMPANY_B = ['Systems', 'Labs', 'Holdings', 'Group', 'Dynamics', 'Networks', 'Partners', 'Industries', 'Financial', 'Health'];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildMockAccounts(): Account[] {
  const rnd = seededRandom(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const accounts: Account[] = [];
  for (let i = 1; i <= 30; i++) {
    const name = `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
    const status = pick(STATUSES);
    accounts.push({
      id: i,
      name,
      industry: pick(INDUSTRIES),
      region: pick(REGIONS),
      segment: pick(SEGMENTS),
      owner_rep: pick(REPS),
      tier: pick(TIERS),
      status,
      created_date: `202${2 + (i % 4)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      health_score: Math.floor(rnd() * 100),
    });
  }
  return accounts;
}

function buildMockAccountDetail(base: Account): Account {
  const rnd = seededRandom(base.id * 7);
  const renewals: Renewal[] = [
    {
      renewal_type: 'Annual Subscription',
      contract_value_usd: Math.floor((rnd() * 400 + 50)) * 1000,
      renewal_date: `2025-${String((base.id % 12) + 1).padStart(2, '0')}-15`,
      likelihood: Math.floor(rnd() * 40 + 60),
    },
  ];
  const alerts: RiskAlert[] =
    base.status === 'At Risk' || (base.health_score ?? 100) < 45
      ? [{
          alert_type: 'Usage Decline',
          severity: (base.health_score ?? 100) < 30 ? 'high' : 'medium',
          message: 'Product usage dropped 32% over the last 30 days. Recommend an executive check-in before renewal.',
          created_at: '2025-01-12 09:41',
        }]
      : [];
  return { ...base, renewals, alerts };
}

function buildMockOpportunities(accounts: Account[]): Opportunity[] {
  const rnd = seededRandom(99);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const opps: Opportunity[] = [];
  for (let i = 1; i <= 100; i++) {
    const acct = accounts[Math.floor(rnd() * accounts.length)];
    const stage = pick(STAGES);
    const amount = Math.floor((rnd() * 480 + 20)) * 1000;
    const probMap: Record<string, number> = {
      'Prospecting': 10, 'Qualification': 25, 'Proposal': 50,
      'Negotiation': 75, 'Closed Won': 100, 'Closed Lost': 0,
    };
    const probability = probMap[stage];
    opps.push({
      id: i,
      account_id: acct.id,
      account_name: acct.name,
      segment: acct.segment,
      close_date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      opp_number: 1000 + i,
      amount_usd: amount,
      stage,
      probability,
      product_line: pick(PRODUCTS),
      weighted_amount: Math.round(amount * probability / 100),
    });
  }
  return opps.sort((a, b) => b.close_date.localeCompare(a.close_date));
}

const CHURN_DRIVERS = [
  'Usage decline (30d)', 'Support escalations', 'Exec sponsor departed',
  'Low feature adoption', 'Contract renewal overdue', 'Champion left account',
  'Billing disputes', 'Competitor evaluation',
];
const CHURN_ACTIONS = [
  'Schedule executive business review', 'Assign customer success manager',
  'Offer adoption workshop', 'Escalate to renewals team',
  'Proactive discount / incentive', 'Re-engage economic buyer',
];

function buildMockChurn(accounts: Account[]): ChurnPrediction[] {
  const rnd = seededRandom(2024);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  return accounts.map(a => {
    const score = Math.round(rnd() * 100) / 100;
    const band = score >= 0.66 ? 'High' : score >= 0.33 ? 'Medium' : 'Low';
    const arr = Math.floor((rnd() * 480 + 40)) * 1000;
    return {
      account_id: a.id,
      account_name: a.name,
      segment: a.segment,
      churn_risk_score: score,
      risk_band: band,
      predicted_arr_at_risk_usd: band === 'Low' ? Math.round(arr * 0.15) : arr,
      top_churn_driver: pick(CHURN_DRIVERS),
      recommended_action: pick(CHURN_ACTIONS),
      model_version: 'v2.3',
      scored_at: '2025-01-14 06:00 UTC',
    };
  }).sort((a, b) => b.churn_risk_score - a.churn_risk_score);
}

/* Fetch that falls back to mock data when the API is unreachable. */
async function apiOrMock<T>(url: string, mock: () => T): Promise<{ data: T; isMock: boolean }> {
  // Only fall back to mock data on a genuine connection failure (fetch throws —
  // e.g. local preview with no backend). A valid HTTP error like 503/404 means
  // the backend IS reachable and is intentionally reporting a feature as
  // unavailable (e.g. Opportunities right after the disaster act drops the
  // table); in that case we must NOT show mock data or flip to "not connected"
  // — the caller renders its proper Unavailable state instead.
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    return { data: mock(), isMock: true };   // real network failure → preview
  }
  if (!r.ok) {
    const err = new Error(`${r.status}`) as Error & { httpStatus?: number };
    err.httpStatus = r.status;
    throw err;                               // reachable backend said "no" → propagate
  }
  return { data: await r.json(), isMock: false };
}

/* ------------------------------------------------------------------ */
/*  Accounts Tab                                                       */
/* ------------------------------------------------------------------ */

function AccountsTab({ features, onMock }: { features: Features; onMock: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<Account | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!features.accounts_available) { setLoading(false); return; }
    setUnavailable(false);
    apiOrMock('/api/accounts', () => ({ accounts: buildMockAccounts(), features: MOCK_FEATURES }))
      .then(({ data, isMock }) => {
        setAccounts((data as any).accounts);
        if (isMock) onMock();
        setLoading(false);
      })
      .catch(e => {
        // 503 = backend up but service intentionally unavailable → graceful card.
        if ((e as { httpStatus?: number }).httpStatus === 503) setUnavailable(true);
        else setError(String(e.message));
        setLoading(false);
      });
  }, [features.accounts_available]);

  const toggleExpand = useCallback((id: number) => {
    if (expandedId === id) { setExpandedId(null); setDetailData(null); return; }
    setExpandedId(id);
    setDetailLoading(true);
    const base = accounts.find(a => a.id === id)!;
    apiOrMock(`/api/accounts/${id}`, () => ({ account: buildMockAccountDetail(base) }))
      .then(({ data }) => { setDetailData((data as any).account); setDetailLoading(false); })
      .catch(() => setDetailLoading(false));
  }, [expandedId, accounts]);

  if (!features.accounts_available || unavailable) {
    return (
      <UnavailableCard
        title="Accounts Service Temporarily Unavailable"
        message="The account book of business is currently being updated. Your data is safe and access will be restored shortly."
      />
    );
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <div style={styles.error}>Error loading accounts: {error}</div>;

  const colCount = 7 + (features.health_score_active ? 1 : 0) + (features.alerts_active ? 1 : 0);

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={styles.cardTitle}>Accounts ({accounts.length})</div>
        {features.alerts_active && (
          <span style={{ ...styles.badge, backgroundColor: COLORS.primaryBg, color: COLORS.primary }}>
            Risk Alerts Active
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Account</th>
              <th style={styles.th}>Industry</th>
              <th style={styles.th}>Region</th>
              <th style={styles.th}>Segment</th>
              <th style={styles.th}>Owner</th>
              <th style={styles.th}>Tier</th>
              <th style={styles.th}>Status</th>
              {features.health_score_active && <th style={styles.th}>Health</th>}
              {features.alerts_active && <th style={styles.th}>Alerts</th>}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => (
              <React.Fragment key={a.id}>
                <tr
                  onClick={() => toggleExpand(a.id)}
                  style={{
                    ...styles.trHover,
                    backgroundColor: expandedId === a.id ? COLORS.primaryBg : i % 2 === 0 ? COLORS.white : COLORS.gray50,
                  }}
                  onMouseEnter={e => { if (expandedId !== a.id) (e.currentTarget as HTMLElement).style.backgroundColor = COLORS.gray100; }}
                  onMouseLeave={e => { if (expandedId !== a.id) (e.currentTarget as HTMLElement).style.backgroundColor = i % 2 === 0 ? COLORS.white : COLORS.gray50; }}
                >
                  <td style={{ ...styles.td, fontWeight: 600, color: COLORS.gray800 }}>{a.name}</td>
                  <td style={styles.td}>{a.industry}</td>
                  <td style={styles.td}>{a.region}</td>
                  <td style={styles.td}>{a.segment}</td>
                  <td style={styles.td}>{a.owner_rep}</td>
                  <td style={styles.td}><TierBadge tier={a.tier} /></td>
                  <td style={styles.td}><StatusBadge status={a.status} /></td>
                  {features.health_score_active && (
                    <td style={styles.td}>
                      {a.health_score != null ? <HealthPill score={a.health_score} /> : <span style={{ color: COLORS.gray400 }}>--</span>}
                    </td>
                  )}
                  {features.alerts_active && (
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, backgroundColor: COLORS.warningBg, color: COLORS.warning }}>View</span>
                    </td>
                  )}
                </tr>
                {expandedId === a.id && (
                  <tr>
                    <td colSpan={colCount} style={{ padding: 0 }}>
                      <div style={styles.detailPanel}>
                        {detailLoading ? (
                          <div style={{ textAlign: 'center', padding: 16, color: COLORS.gray400 }}>Loading details...</div>
                        ) : detailData ? (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 12, color: COLORS.gray500, fontWeight: 500 }}>Account</div>
                                <div style={{ fontSize: 15, fontWeight: 600 }}>{detailData.name}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: COLORS.gray500, fontWeight: 500 }}>Owner Rep</div>
                                <div style={{ fontSize: 15 }}>{detailData.owner_rep}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: COLORS.gray500, fontWeight: 500 }}>Customer Since</div>
                                <div style={{ fontSize: 15 }}>{detailData.created_date}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: COLORS.gray500, fontWeight: 500 }}>Segment / Tier</div>
                                <div style={{ fontSize: 15 }}>{detailData.segment} / {detailData.tier}</div>
                              </div>
                            </div>

                            {features.renewals_active && detailData.renewals && detailData.renewals.length > 0 && (
                              <div style={{ ...styles.detailSection, marginTop: 20 }}>
                                <div style={styles.detailSectionTitle}>Upcoming Renewals</div>
                                <table style={{ ...styles.table, fontSize: 13 }}>
                                  <thead>
                                    <tr>
                                      <th style={{ ...styles.th, fontSize: 11, padding: '8px 12px' }}>Type</th>
                                      <th style={{ ...styles.th, fontSize: 11, padding: '8px 12px' }}>Contract Value</th>
                                      <th style={{ ...styles.th, fontSize: 11, padding: '8px 12px' }}>Renewal Date</th>
                                      <th style={{ ...styles.th, fontSize: 11, padding: '8px 12px' }}>Likelihood</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailData.renewals.map((r, idx) => (
                                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? COLORS.white : COLORS.gray50 }}>
                                        <td style={{ ...styles.td, padding: '8px 12px' }}>{r.renewal_type}</td>
                                        <td style={{ ...styles.td, padding: '8px 12px', fontWeight: 600 }}>{fmtUSD(r.contract_value_usd)}</td>
                                        <td style={{ ...styles.td, padding: '8px 12px' }}>{r.renewal_date}</td>
                                        <td style={{ ...styles.td, padding: '8px 12px', fontWeight: 600, color: r.likelihood >= 75 ? COLORS.success : r.likelihood >= 50 ? COLORS.warning : COLORS.danger }}>{fmtPct(r.likelihood)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {features.alerts_active && detailData.alerts && detailData.alerts.length > 0 && (
                              <div style={{ ...styles.detailSection, marginTop: 16 }}>
                                <div style={styles.detailSectionTitle}>Risk Alerts</div>
                                {detailData.alerts.map((a2, idx) => (
                                  <div key={idx} style={{
                                    padding: '10px 14px', marginBottom: 8, borderRadius: 8,
                                    backgroundColor: a2.severity === 'high' ? COLORS.dangerBg : a2.severity === 'medium' ? COLORS.warningBg : COLORS.gray100,
                                    border: `1px solid ${a2.severity === 'high' ? '#FECACA' : a2.severity === 'medium' ? '#FDE68A' : COLORS.gray200}`,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontWeight: 600, fontSize: 13 }}>{a2.alert_type}</span>
                                      <SeverityBadge severity={a2.severity} />
                                    </div>
                                    <div style={{ fontSize: 13, color: COLORS.gray700 }}>{a2.message}</div>
                                    <div style={{ fontSize: 11, color: COLORS.gray400, marginTop: 4 }}>{a2.created_at}</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {features.renewals_active && (!detailData.renewals || detailData.renewals.length === 0) && (
                              <div style={{ marginTop: 16, color: COLORS.gray400, fontSize: 13 }}>No renewals on record for this account.</div>
                            )}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: COLORS.gray400 }}>No accounts found.</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Opportunities Tab                                                  */
/* ------------------------------------------------------------------ */

/* Product lines & stage→probability must mirror the backend (opportunities.py). */
const PRODUCT_LINES = ['Platform', 'Data Warehouse', 'ML/AI', 'Governance', 'Streaming'];
const STAGE_PROBABILITY: Record<string, number> = {
  Prospecting: 10, Qualification: 25, Proposal: 50, Negotiation: 75, 'Closed Won': 100, 'Closed Lost': 0,
};

/* Modal to create a new opportunity — the app's write-back path (feeds Lakebase
   CDF). Account is a dropdown of EXISTING accounts only (no fake customers);
   probability is derived from the chosen stage, matching the backend. */
function AddOpportunityModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (created: Opportunity) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [productLine, setProductLine] = useState(PRODUCT_LINES[0]);
  const [stage, setStage] = useState('Prospecting');
  const [amount, setAmount] = useState('');
  // Default close date: +45 days, matching the seed cadence.
  const [closeDate, setCloseDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 45);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  // Load the existing accounts for the dropdown.
  useEffect(() => {
    apiOrMock('/api/accounts', () => ({ accounts: buildMockAccounts(), features: MOCK_FEATURES }))
      .then(res => {
        const list = (res.data as any).accounts as Account[];
        setAccounts(list);
        if (list.length) setAccountId(list[0].id);
      })
      .catch(() => setErr('Could not load accounts.'));
  }, []);

  const submit = () => {
    setErr('');
    if (accountId === '') { setErr('Pick an account.'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr('Enter an amount greater than 0.'); return; }
    setSubmitting(true);
    fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: accountId, product_line: productLine, stage,
        amount_usd: amt, close_date: closeDate,
      }),
    })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.detail || `Request failed (${r.status})`);
        onAdded(body.opportunity as Opportunity);
      })
      .catch(e => { setErr(String(e.message)); setSubmitting(false); });
  };

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 8, fontSize: 14,
    border: `1px solid ${COLORS.gray300}`, backgroundColor: COLORS.white, color: COLORS.gray800,
    boxSizing: 'border-box',
  };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: COLORS.gray500, marginBottom: 5, display: 'block' };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(14,27,32,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        backgroundColor: COLORS.white, borderRadius: 14, width: 460, maxWidth: '92vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${COLORS.gray200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: COLORS.gray800 }}>New Opportunity</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: COLORS.gray500, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={label}>Account</label>
            <select style={field} value={accountId} onChange={e => setAccountId(Number(e.target.value))}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.segment}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Product Line</label>
              <select style={field} value={productLine} onChange={e => setProductLine(e.target.value)}>
                {PRODUCT_LINES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Stage</label>
              <select style={field} value={stage} onChange={e => setStage(e.target.value)}>
                {Object.keys(STAGE_PROBABILITY).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Amount (USD)</label>
              <input style={field} type="number" min={1} placeholder="e.g. 120000"
                value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Close Date</label>
              <input style={field} type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} />
            </div>
          </div>

          <div style={{ fontSize: 12, color: COLORS.gray500 }}>
            Probability auto-set from stage: <strong style={{ color: COLORS.gray700 }}>{STAGE_PROBABILITY[stage]}%</strong>
          </div>

          {err && <div style={{ fontSize: 13, color: COLORS.danger }}>{err}</div>}
        </div>

        <div style={{ padding: '14px 22px', borderTop: `1px solid ${COLORS.gray200}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{
            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${COLORS.gray300}`, backgroundColor: COLORS.white, color: COLORS.gray700,
          }}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
            border: 'none', backgroundColor: COLORS.accent, color: COLORS.white, opacity: submitting ? 0.6 : 1,
          }}>{submitting ? 'Adding…' : 'Add Opportunity'}</button>
        </div>
      </div>
    </div>
  );
}

function OpportunitiesTab({ features, onMock }: { features: Features; onMock: () => void }) {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [stats, setStats] = useState<OppStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Set when the backend returns 503 (pipeline intentionally unavailable, e.g.
  // right after the disaster act) before the 30s feature poll catches up.
  const [unavailable, setUnavailable] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newOppId, setNewOppId] = useState<number | null>(null);
  const newRowRef = useRef<HTMLTableRowElement | null>(null);

  const mockOpps = () => buildMockOpportunities(buildMockAccounts());
  const mockStats = (list: Opportunity[]): { stats: OppStats } => {
    const total = list.reduce((s, o) => s + o.amount_usd, 0);
    const weighted = list.reduce((s, o) => s + o.weighted_amount, 0);
    return { stats: {
      total_opps: list.length,
      total_pipeline_usd: total,
      weighted_pipeline_usd: weighted,
      avg_deal_size_usd: list.length ? Math.round(total / list.length) : 0,
    }};
  };

  // Fetch opportunities + KPIs together (used on load and after an insert so the
  // stat cards recompute live from the DB — the source of truth).
  const refresh = useCallback(() => {
    const mo = mockOpps();
    return Promise.all([
      apiOrMock('/api/opportunities', () => ({ opportunities: mo, features: MOCK_FEATURES })),
      apiOrMock('/api/opportunities/stats', () => ({ ...mockStats(mo), features: MOCK_FEATURES })),
    ]).then(([oppRes, statsRes]) => {
      setOpps((oppRes.data as any).opportunities);
      setStats((statsRes.data as any).stats);
      if (oppRes.isMock || statsRes.isMock) onMock();
    });
  }, [onMock]);

  useEffect(() => {
    if (!features.opportunities_available) { setLoading(false); return; }
    setUnavailable(false);
    refresh()
      .then(() => setLoading(false))
      .catch(e => {
        // A 503 means the pipeline is intentionally down (e.g. disaster act) —
        // show the graceful Unavailable card, not a raw error, and don't nag.
        if ((e as { httpStatus?: number }).httpStatus === 503) setUnavailable(true);
        else setError(String(e.message));
        setLoading(false);
      });
  }, [features.opportunities_available, refresh]);

  // When a new opportunity is added, scroll it into view (the table sorts by
  // close date, so it may not land at the top) and flash it briefly.
  useEffect(() => {
    if (newOppId == null) return;
    newRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setNewOppId(null), 2500);
    return () => clearTimeout(t);
  }, [newOppId, opps]);

  const handleAdded = (created: Opportunity) => {
    setShowAdd(false);
    // Optimistically prepend, then re-fetch so the KPIs + ordering are exact.
    setOpps(prev => [created, ...prev.filter(o => o.id !== created.id)]);
    setNewOppId(created.id);
    refresh().catch(() => { /* keep optimistic row on refresh failure */ });
  };

  if (!features.opportunities_available || unavailable) {
    return (
      <UnavailableCard
        title="Pipeline Temporarily Unavailable"
        message="The opportunity pipeline is undergoing scheduled maintenance. Deal records will be restored shortly."
      />
    );
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <div style={styles.error}>Error loading opportunities: {error}</div>;

  return (
    <>
      {stats && (
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{stats.total_opps}</div>
            <div style={styles.statLabel}>Open Opportunities</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: COLORS.accent }}>
            <div style={{ ...styles.statValue, color: COLORS.accent }}>{fmtUSD(stats.total_pipeline_usd)}</div>
            <div style={styles.statLabel}>Total Pipeline</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: COLORS.success }}>
            <div style={{ ...styles.statValue, color: COLORS.success }}>{fmtUSD(stats.weighted_pipeline_usd)}</div>
            <div style={styles.statLabel}>Weighted Pipeline</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: COLORS.warning }}>
            <div style={{ ...styles.statValue, color: COLORS.warning }}>{fmtUSD(stats.avg_deal_size_usd)}</div>
            <div style={styles.statLabel}>Avg Deal Size</div>
          </div>
        </div>
      )}

      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ ...styles.cardTitle, marginBottom: 0 }}>Opportunity Pipeline</div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              backgroundColor: COLORS.accent, color: COLORS.white,
            }}
          >
            + New Opportunity
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Account</th>
                <th style={styles.th}>Product Line</th>
                <th style={styles.th}>Close Date</th>
                <th style={styles.th}>Opp #</th>
                <th style={styles.th}>Amount</th>
                <th style={styles.th}>Stage</th>
                <th style={styles.th}>Probability</th>
                <th style={styles.th}>Weighted</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o, i) => {
                const isNew = o.id === newOppId;
                return (
                <tr
                  key={o.id}
                  ref={isNew ? newRowRef : undefined}
                  style={{
                    backgroundColor: isNew ? COLORS.successBg : (i % 2 === 0 ? COLORS.white : COLORS.gray50),
                    transition: 'background-color 1.2s ease',
                  }}
                >
                  <td style={{ ...styles.td, fontWeight: 600 }}>
                    {o.account_name}
                    {isNew && (
                      <span style={{
                        marginLeft: 8, fontSize: 10, fontWeight: 700, color: COLORS.success,
                        backgroundColor: COLORS.white, border: `1px solid ${COLORS.success}`,
                        borderRadius: 10, padding: '1px 7px', verticalAlign: 'middle',
                      }}>NEW</span>
                    )}
                  </td>
                  <td style={styles.td}>{o.product_line}</td>
                  <td style={styles.td}>{o.close_date}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>#{o.opp_number}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmtUSD(o.amount_usd)}</td>
                  <td style={styles.td}><StageBadge stage={o.stage} /></td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmtPct(o.probability)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: COLORS.primary }}>{fmtUSD(o.weighted_amount)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {opps.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: COLORS.gray400 }}>No opportunities in pipeline.</div>
        )}
      </div>

      {showAdd && (
        <AddOpportunityModal
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Retention Risk Tab (synced-from-lakehouse churn predictions)       */
/* ------------------------------------------------------------------ */

/* Status colors for risk bands -- always paired with a text label. */
const BAND_COLOR: Record<string, { fill: string; text: string; bg: string }> = {
  High: { fill: '#98102A', text: '#98102A', bg: '#F8DEDF' },
  Medium: { fill: '#B87503', text: '#B87503', bg: '#FDF0D5' },
  Low: { fill: '#00875C', text: '#00875C', bg: '#DBF3E8' },
};

function RiskBandBadge({ band }: { band: string }) {
  const c = BAND_COLOR[band] || { text: COLORS.gray500, bg: COLORS.gray100 };
  return <span style={{ ...styles.badge, backgroundColor: c.bg, color: c.text }}>{band}</span>;
}

/* Simple horizontal bar: label · track · direct value label (no chart lib). */
function HBar({ label, value, max, fill, valueLabel }: {
  label: string; value: number; max: number; fill: string; valueLabel: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <span style={{ fontSize: 13, color: COLORS.gray700, fontWeight: 500 }}>{label}</span>
      <span style={{ position: 'relative', height: 20, backgroundColor: COLORS.gray100, borderRadius: 4, overflow: 'hidden' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: fill, borderRadius: 4 }} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray800, textAlign: 'right' }}>{valueLabel}</span>
    </div>
  );
}

function RetentionRiskTab({ features, onMock }: { features: Features; onMock: () => void }) {
  const [churn, setChurn] = useState<ChurnPrediction[]>([]);
  const [stats, setStats] = useState<ChurnStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Accounts shown in the "unknown" (pre-sync) state — same customers, but with
  // their churn insight grayed out until the data science model syncs in.
  const [unknownAccounts, setUnknownAccounts] = useState<Account[]>([]);

  // In the pre-sync state, list the accounts with blank/grayed churn columns so
  // the audience sees "we have these customers, but no insight yet".
  useEffect(() => {
    if (features.churn_active) return;
    apiOrMock('/api/accounts', () => ({ accounts: buildMockAccounts(), features: MOCK_FEATURES }))
      .then(({ data }) => setUnknownAccounts((data as any).accounts))
      .catch(() => { /* accounts not ready yet — grayed table just shows empty */ });
  }, [features.churn_active]);

  useEffect(() => {
    if (!features.churn_active) { setLoading(false); return; }
    const mockRows = buildMockChurn(buildMockAccounts());
    const mockStats = (): { stats: ChurnStats } => {
      const atRisk = mockRows.reduce((s, c) => s + c.predicted_arr_at_risk_usd, 0);
      const high = mockRows.filter(c => c.risk_band === 'High').length;
      const avg = mockRows.reduce((s, c) => s + c.churn_risk_score, 0) / mockRows.length;
      return { stats: {
        total_arr_at_risk_usd: atRisk,
        high_risk_accounts: high,
        avg_churn_score: Math.round(avg * 100) / 100,
        model_version: 'v2.3',
        scored_at: '2025-01-14 06:00 UTC',
      }};
    };
    Promise.all([
      apiOrMock('/api/churn', () => ({ churn: mockRows, features: MOCK_FEATURES })),
      apiOrMock('/api/churn/stats', () => ({ ...mockStats(), features: MOCK_FEATURES })),
    ])
      .then(([rowsRes, statsRes]) => {
        setChurn((rowsRes.data as any).churn);
        setStats((statsRes.data as any).stats);
        if (rowsRes.isMock || statsRes.isMock) onMock();
        setLoading(false);
      })
      .catch(e => {
        // 503 here just means churn isn't synced yet — fall through to the
        // "Coming Soon" state rather than showing a raw error or mock data.
        if ((e as { httpStatus?: number }).httpStatus !== 503) setError(String(e.message));
        setLoading(false);
      });
  }, [features.churn_active]);

  if (!features.churn_active) {
    // "Unknown" state — the customers are here, but their churn insight is not
    // yet known. Same layout as the scored view, with every insight field
    // grayed to "—". When the DS model syncs, these rows populate.
    const dash = <span style={{ color: COLORS.gray300, fontWeight: 700 }}>—</span>;
    return (
      <>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          padding: '10px 16px', borderRadius: 10, backgroundColor: COLORS.warningBg,
          border: `1px solid ${COLORS.warning}`, fontSize: 13, color: COLORS.gray700,
        }}>
          <span style={{ ...styles.statusDot, backgroundColor: COLORS.warning, marginRight: 0, animation: 'pulse 1.6s ease-in-out infinite' }} />
          <span><strong>No churn insight yet.</strong> Awaiting the data science team&apos;s model to sync in from the lakehouse.</span>
          <span style={{ marginLeft: 'auto', color: COLORS.gray400 }}><code style={{ color: COLORS.primary }}>data_science_ml.churn_predictions</code></span>
        </div>

        {/* Grayed KPI tiles — structure present, values unknown. */}
        <div style={styles.statsGrid}>
          {['Total ARR at Risk', 'High-Risk Accounts', 'Avg Churn Score', 'Accounts Scored'].map(label => (
            <div key={label} style={{ ...styles.statCard, opacity: 0.55 }}>
              <div style={{ ...styles.statValue, color: COLORS.gray300 }}>—</div>
              <div style={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>

        {/* Grayed detail table — same customers, insight columns blank. */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Account Churn Predictions</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Account</th>
                  <th style={styles.th}>Segment</th>
                  <th style={styles.th}>Risk Score</th>
                  <th style={styles.th}>Band</th>
                  <th style={styles.th}>ARR at Risk</th>
                  <th style={styles.th}>Top Driver</th>
                  <th style={styles.th}>Recommended Action</th>
                </tr>
              </thead>
              <tbody>
                {unknownAccounts.map((a, i) => (
                  <tr key={a.id} style={{ backgroundColor: i % 2 === 0 ? COLORS.white : COLORS.gray50 }}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{a.name}</td>
                    <td style={styles.td}>{a.segment}</td>
                    <td style={styles.td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 44, height: 6, borderRadius: 3, backgroundColor: COLORS.gray200, display: 'inline-block' }} />
                        {dash}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, backgroundColor: COLORS.gray100, color: COLORS.gray400 }}>Unknown</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{dash}</td>
                    <td style={styles.td}>{dash}</td>
                    <td style={styles.td}>{dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unknownAccounts.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: COLORS.gray400 }}>
              Populate the app (Setup) to load customers, then sync the churn model to light up this page.
            </div>
          )}
        </div>
      </>
    );
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <div style={styles.error}>Error loading retention risk: {error}</div>;

  // Aggregations for the visualizations
  const bandCounts = { High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  const arrBySegment: Record<string, number> = {};
  churn.forEach(c => {
    bandCounts[c.risk_band] = (bandCounts[c.risk_band] || 0) + 1;
    arrBySegment[c.segment] = (arrBySegment[c.segment] || 0) + c.predicted_arr_at_risk_usd;
  });
  const maxBand = Math.max(1, ...Object.values(bandCounts));
  const segEntries = Object.entries(arrBySegment).sort((a, b) => b[1] - a[1]);
  const maxSeg = Math.max(1, ...segEntries.map(e => e[1]));

  return (
    <div style={{ animation: 'churnPopulate 0.5s ease-out' }}>
      {/* Synced-source provenance banner */}
      {stats && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          padding: '10px 16px', borderRadius: 10, backgroundColor: COLORS.primaryBg,
          border: `1px solid ${COLORS.gray200}`, fontSize: 13, color: COLORS.gray700,
        }}>
          <span style={{ ...styles.badge, backgroundColor: COLORS.primary, color: COLORS.white }}>Synced from Lakehouse</span>
          <span>ML churn model <strong>{stats.model_version}</strong> &middot; last scored {stats.scored_at}</span>
          <span style={{ marginLeft: 'auto', color: COLORS.gray400 }}>read-only synced table</span>
        </div>
      )}

      {/* KPI tiles */}
      {stats && (
        <div style={styles.statsGrid}>
          <div style={{ ...styles.statCard, borderLeftColor: COLORS.danger }}>
            <div style={{ ...styles.statValue, color: COLORS.danger }}>{fmtUSD(stats.total_arr_at_risk_usd)}</div>
            <div style={styles.statLabel}>Total ARR at Risk</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: COLORS.danger }}>
            <div style={{ ...styles.statValue, color: COLORS.danger }}>{stats.high_risk_accounts}</div>
            <div style={styles.statLabel}>High-Risk Accounts</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: COLORS.warning }}>
            <div style={{ ...styles.statValue, color: COLORS.warning }}>{stats.avg_churn_score.toFixed(2)}</div>
            <div style={styles.statLabel}>Avg Churn Score</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{churn.length}</div>
            <div style={styles.statLabel}>Accounts Scored</div>
          </div>
        </div>
      )}

      {/* Visualizations */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 20 }}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Accounts by Risk Band</div>
          {(['High', 'Medium', 'Low'] as const).map(band => (
            <HBar
              key={band}
              label={band}
              value={bandCounts[band] || 0}
              max={maxBand}
              fill={BAND_COLOR[band].fill}
              valueLabel={`${bandCounts[band] || 0} accts`}
            />
          ))}
        </div>
        <div style={styles.card}>
          <div style={styles.cardTitle}>ARR at Risk by Segment</div>
          {segEntries.map(([seg, val]) => (
            <HBar key={seg} label={seg} value={val} max={maxSeg} fill={COLORS.accent} valueLabel={fmtUSD(val)} />
          ))}
        </div>
      </div>

      {/* Detail table */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Account Churn Predictions</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Account</th>
                <th style={styles.th}>Segment</th>
                <th style={styles.th}>Risk Score</th>
                <th style={styles.th}>Band</th>
                <th style={styles.th}>ARR at Risk</th>
                <th style={styles.th}>Top Driver</th>
                <th style={styles.th}>Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {churn.map((c, i) => (
                <tr key={c.account_id} style={{ backgroundColor: i % 2 === 0 ? COLORS.white : COLORS.gray50 }}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{c.account_name}</td>
                  <td style={styles.td}>{c.segment}</td>
                  <td style={styles.td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 44, height: 6, borderRadius: 3, backgroundColor: COLORS.gray200, display: 'inline-block', position: 'relative', overflow: 'hidden' }}>
                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${c.churn_risk_score * 100}%`, backgroundColor: BAND_COLOR[c.risk_band].fill }} />
                      </span>
                      <span style={{ fontWeight: 700, color: BAND_COLOR[c.risk_band].text, fontSize: 13 }}>{c.churn_risk_score.toFixed(2)}</span>
                    </span>
                  </td>
                  <td style={styles.td}><RiskBandBadge band={c.risk_band} /></td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmtUSD(c.predicted_arr_at_risk_usd)}</td>
                  <td style={styles.td}>{c.top_churn_driver}</td>
                  <td style={{ ...styles.td, color: COLORS.gray500 }}>{c.recommended_action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {churn.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: COLORS.gray400 }}>No churn predictions synced yet.</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Demo Control Tab (presenter orchestration)                         */
/* ------------------------------------------------------------------ */

/* Lakebase deep-link config. Fetched at runtime from /api/demo/config (which
   computes the URLs from the SDK — no hardcoded workspace host or uids). These
   fallbacks are used only in local preview when the backend is unreachable. */
interface DemoConfig {
  workspace_url: string;
  lakebase_tables_url: string;   // Catalog UI: the sales tables
  lakebase_project_url: string;  // Lakebase project (monitoring etc.)
}
const FALLBACK_CONFIG: DemoConfig = {
  workspace_url: 'https://fevm-for-startups-demos.cloud.databricks.com',
  lakebase_tables_url: 'https://fevm-for-startups-demos.cloud.databricks.com',
  lakebase_project_url: 'https://fevm-for-startups-demos.cloud.databricks.com',
};

/* Deep-link targets stored in the act data; resolved to real URLs at render
   time from the fetched config, so nothing is hardcoded. */
type LinkTarget = 'tables' | 'project' | 'workspace';
function linkFor(target: LinkTarget, cfg: DemoConfig): string {
  if (target === 'tables') return cfg.lakebase_tables_url;
  if (target === 'project') return cfg.lakebase_project_url;
  return cfg.workspace_url;
}

/* A single button that a presenter can click to perform one demo step. */
type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface DemoAction {
  id: string;
  label: string;
  runningLabel: string;
  doneLabel: string;
  /* Log lines this step streams out, mimicking the notebook output. */
  log: string[];
  /* Feature flags this step flips on the app (drives the other tabs). */
  effects?: Partial<Features>;
  /* Simulated duration (ms) for the preview. */
  durationMs?: number;
  /* Requires these action ids to have completed first. */
  requires?: string[];
  /* Marks a destructive/negative step (e.g. the DROP TABLE disaster). */
  danger?: boolean;
  /* When set, this step opens a Lakebase deep-link (resolved from config)
     rather than running logic. */
  hrefTarget?: LinkTarget;
  /* A backend endpoint to POST to. When set, the real server response drives
     the log; when unset (or unreachable) the stubbed `log` is streamed. */
  endpoint?: string;
  /* After this step completes, show a non-blocking callout nudging the
     presenter to their next physical action (e.g. switch to the Lakebase UI). */
  reminder?: { text: string; linkLabel?: string; linkTarget?: LinkTarget };
  /* When set, clicking this step opens a modal "code runner" that shows the
     real SQL executing, statement by statement, synced with the backend call. */
  codeTitle?: string;
  codeStatements?: string[];
  /* Visual mood for the code runner. 'disaster' styles it red with an SOS. */
  codeMood?: 'normal' | 'disaster';
}

type ActIconName = 'branch' | 'rewind' | 'syncIn' | 'syncOut' | 'surge';

interface DemoAct {
  num: number;
  /* Feature glyph shown instead of a sequence number — signals the acts are a
     modular menu (use any part), not an ordered checklist. */
  icon?: ActIconName;
  title: string;
  feature: string;
  say: string;          // presenter talk-track (the "SAY" line)
  actions: DemoAction[];
  /* Optional deep-link shown as a "watch it live" chip. */
  watchTarget?: LinkTarget;
  watchLabel?: string;
  /* When true, this act renders the interactive load-test dashboard. */
  loadTest?: boolean;
  /* Setup steps (create tables + populate data) are app/Postgres bootstrapping,
     not a Lakebase feature — they render as a neutral "Setup" block above the
     numbered acts and auto-collapse once complete. */
  setup?: boolean;
}

const DEMO_ACTS: DemoAct[] = [
  {
    num: 0,
    setup: true,
    title: 'Prepare the app',
    feature: 'Create tables · Populate data',
    say: '“First we stand up the app: create the tables — empty — then populate realistic data so the portal comes to life. Then we’ll explore what makes Lakebase different.”',
    actions: [
      {
        id: 'act1_create',
        label: '1. Create tables',
        runningLabel: 'Creating tables…',
        doneLabel: 'Tables created ✓',
        durationMs: 1800,
        endpoint: '/api/demo/act1/create-tables',
        log: [
          'Creating schema & tables…',
          'Tables ready: accounts, opportunities, sales_activities',
          '  accounts: 0 rows',
          '  opportunities: 0 rows',
          '  sales_activities: 0 rows',
          'Tables are live in Lakebase — check the Catalog UI.',
        ],
        effects: { accounts_available: true, opportunities_available: true, activities_available: true },
        reminder: {
          text: 'Now switch to Lakebase and show the 3 empty tables in the Catalog UI.',
          linkLabel: 'Open Lakebase tables',
          linkTarget: 'tables',
        },
      },
      {
        id: 'act1_seed',
        label: '2. Populate data',
        runningLabel: 'Populating…',
        doneLabel: 'Populated ✓',
        durationMs: 2200,
        requires: ['act1_create'],
        endpoint: '/api/demo/act1/seed',
        log: [
          'Populating realistic B2B data…',
          '  accounts: 30 rows',
          '  opportunities: 50 rows',
          '  sales_activities: 81 rows',
          'App cache refreshed. Accounts & Opportunities show live data.',
        ],
        reminder: {
          text: 'Show the populated Accounts & Opportunities tabs — then refresh the Lakebase tables view to see the same tables now full.',
        },
      },
    ],
  },
  {
    num: 1,
    icon: 'branch',
    title: 'Branching & Schema Evolution',
    feature: 'Zero-copy branching',
    say: '“Instead of developing on production or spinning up a slow replica, Lakebase branching creates a zero-copy clone in seconds. Watch the creation time.”',
    actions: [
      {
        id: 'act2_branch',
        label: 'Create dev-health branch',
        runningLabel: 'Creating branch…',
        doneLabel: 'Branch created ✓',
        durationMs: 2600,
        requires: ['act1_seed'],
        endpoint: '/api/demo/act2/create-branch',
        log: [
          "Creating 'dev-health' branch (zero-copy clone)…",
          'Branch created in 2.3s.',
          'Branch endpoint ready · 3 tables (same as production).',
        ],
      },
      {
        id: 'act2_develop',
        label: 'Add health score, renewals & risk alerts',
        runningLabel: 'Developing on branch…',
        doneLabel: 'Features built on branch ✓',
        durationMs: 2000,
        requires: ['act2_branch'],
        endpoint: '/api/demo/act2/develop',
        codeTitle: 'Running on branch: dev-health',
        codeStatements: [
          'ALTER TABLE sales.accounts\n  ADD COLUMN health_score INT;',
          'UPDATE sales.accounts\n  SET health_score = (RANDOM() * 100)::INT;',
          `CREATE TABLE sales.renewals (
  id                 SERIAL PRIMARY KEY,
  account_id         INT NOT NULL REFERENCES sales.accounts(id),
  renewal_type       VARCHAR(30) NOT NULL,
  contract_value_usd NUMERIC(12,2) NOT NULL,
  renewal_date       DATE NOT NULL,
  likelihood         INT NOT NULL
);`,
          `INSERT INTO sales.renewals
  (account_id, renewal_type, contract_value_usd, renewal_date, likelihood)
SELECT id, 'Annual Subscription',
       ROUND((RANDOM()*400+50)::NUMERIC, 0) * 1000,
       created_date + INTERVAL '1 year',
       (RANDOM()*40+60)::INT
FROM sales.accounts;`,
          `CREATE TABLE sales.risk_alerts (
  id         SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES sales.accounts(id),
  alert_type VARCHAR(30) NOT NULL,
  severity   VARCHAR(10) NOT NULL DEFAULT 'medium',
  message    TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);`,
          `INSERT INTO sales.risk_alerts (account_id, alert_type, severity, message)
VALUES
  (4,  'Usage Decline',       'high',   'Product usage dropped sharply over 30 days'),
  (7,  'Exec Sponsor Change', 'high',   'Economic buyer left the account'),
  (12, 'Support Escalation',  'medium', 'Multiple P1 tickets opened this month'),
  (14, 'Adoption Risk',       'medium', 'Only a quarter of licensed seats active'),
  (20, 'Competitive Threat',  'low',    'Mentioned evaluating a competitor');`,
        ],
        log: [
          '+ health_score column on accounts',
          '+ renewals table (30 rows)',
          '+ risk_alerts table (5 rows)',
          '=== Branch vs Production (isolated) ===',
          '  branch:     5 tables + health_score',
          '  production: 3 tables (unchanged)',
        ],
      },
      {
        id: 'act2_promote',
        label: 'Promote to production',
        runningLabel: 'Promoting…',
        doneLabel: 'Promoted ✓',
        durationMs: 2400,
        requires: ['act2_develop'],
        endpoint: '/api/demo/act2/promote',
        log: [
          'Replaying schema changes on production…',
          'Promoted to production! (5 tables)',
          "Branch 'dev-health' deleted.",
          'App cache refreshed — Health, Renewals & Risk Alerts are live.',
        ],
        effects: { health_score_active: true, renewals_active: true, alerts_active: true },
        reminder: {
          text: 'Show the Accounts tab — a Health column appears, and expanding a row reveals renewals & risk alerts (zero redeploys). Then check the Lakebase UI: the dev-health branch is gone — it was cleaned up automatically after promotion.',
        },
      },
    ],
  },
  {
    num: 2,
    icon: 'rewind',
    title: 'Disaster & PITR Recovery',
    feature: 'Point-in-Time Recovery',
    say: '“Someone accidentally drops the opportunities table. In a traditional setup you’d restore last night’s backup and lose a day of deals. With Lakebase PITR, we lose nothing.”',
    actions: [
      {
        id: 'act3_disaster',
        label: '1. Simulate disaster — DROP opportunities',
        runningLabel: 'Recording safe point, then dropping…',
        doneLabel: 'Pipeline lost ✗',
        durationMs: 4200,
        requires: ['act1_seed'],
        danger: true,
        endpoint: '/api/demo/act3/disaster',
        codeTitle: 'S.O.S. — production incident',
        codeMood: 'disaster',
        codeStatements: [
          '-- first, note where we are (recovery point) …',
          '-- an ops engineer meant to drop a temp table…',
          'DROP TABLE sales.opportunities CASCADE;',
          '-- 💀  the entire pipeline is gone',
          '-- 🆘  S.O.S.  the whole sales org just lost its deals',
        ],
        log: [
          'Recovery point recorded — 50 deals safe.',
          'DISASTER: DROP TABLE sales.opportunities CASCADE',
          'The entire pipeline is gone.',
          'App Opportunities tab → "Pipeline Temporarily Unavailable".',
        ],
        effects: { opportunities_available: false },
        reminder: {
          text: 'Switch to the Opportunities tab — it now shows "Pipeline Temporarily Unavailable". Accounts still works: the app degrades gracefully.',
        },
      },
      {
        id: 'act3_pitr',
        label: '2. Create Point-in-Time recovery branch',
        runningLabel: 'Rewinding time…',
        doneLabel: 'Data is safe ✓',
        durationMs: 3200,
        requires: ['act3_disaster'],
        endpoint: '/api/demo/act3/pitr',
        log: [
          'Rewinding to the pre-disaster moment on an isolated branch…',
          'Recovery branch created from the pre-disaster moment.',
          'Opportunities on the recovery branch: 50 — the data is safe!',
        ],
        reminder: {
          text: 'The 50 deals are intact on the recovery branch — nothing was lost. Now restore them to production.',
        },
      },
      {
        id: 'act3_restore',
        label: '3. Restore to production',
        runningLabel: 'Restoring…',
        doneLabel: 'Recovered ✓',
        durationMs: 2600,
        requires: ['act3_pitr'],
        endpoint: '/api/demo/act3/restore',
        log: [
          'Copying recovered rows back to production…',
          'Restored 50 opportunities to production!',
          "Recovery branch 'pitr-recovery' deleted.",
          'Full recovery, zero data loss. Opportunities page is back.',
        ],
        effects: { opportunities_available: true },
        reminder: {
          text: 'Reload the Opportunities tab — the full pipeline is back, exactly as before. Point-in-time recovery, zero data loss.',
        },
      },
    ],
  },
  {
    num: 3,
    icon: 'syncIn',
    title: 'Synced Tables — Lakehouse to Lakebase',
    feature: 'Lakehouse → Lakebase sync',
    say: '“The ML team trained a churn model. Its output is a gold table in the lakehouse. We publish it, sync it into Lakebase — no ETL glue, no redeploy — and the Retention Risk page lights up. Then we re-score and watch it flow through.”',
    actions: [
      {
        id: 'act4_publish',
        label: '1. Publish ML churn table (gold Delta)',
        runningLabel: 'Publishing…',
        doneLabel: 'Gold table published ✓',
        durationMs: 3000,
        requires: ['act1_seed'],
        endpoint: '/api/demo/act4/publish',
        log: [
          "Building the ML team's gold table via the SQL warehouse…",
          'Scored 30 accounts: 12 High, 8 Medium, 10 Low.',
          'Published: for_startups_demos_catalog.data_science_ml.account_churn_predictions',
        ],
        reminder: {
          text: 'This gold table lives in the lakehouse (Unity Catalog). Next we sync it into Lakebase so the app can read it.',
        },
      },
      {
        id: 'act4_sync',
        label: '2. Sync to Lakebase → light up Retention Risk',
        runningLabel: 'Creating synced table…',
        doneLabel: 'Retention Risk live ✓',
        durationMs: 3000,
        requires: ['act4_publish'],
        endpoint: '/api/demo/act4/sync',
        log: [
          'Creating the Lakebase synced table from the gold table…',
          'Sync requested. The first sync runs automatically (30-90s).',
          'churn_predictions synced: 30 rows. Retention Risk is live.',
        ],
        effects: { churn_active: true },
        reminder: {
          text: 'Open the Retention Risk tab — it was grayed out ("no insight yet"), and now the same customers light up with churn scores, risk bands, and ARR at risk. No app redeploy. Optional: open the sync pipeline in the Lakebase UI to show it running.',
        },
      },
    ],
  },
  {
    // CDF is the mirror of Synced Tables: app → lakehouse (every insert/update/
    // delete on a Lakebase Postgres table is captured to Delta in Unity Catalog).
    // Feature ref: https://docs.databricks.com/aws/en/oltp/projects/lakebase-cdf
    // Step 1 is wired to a real backend endpoint; step 2 is a manual reminder
    // (the presenter adds an opportunity, then checks the lakehouse tables).
    num: 4,
    icon: 'syncOut',
    title: 'Change Data Feed — Lakebase to Lakehouse',
    feature: 'Lakebase CDF',
    say: '“Synced tables brought lakehouse data into the app. Change Data Feed does the reverse: every insert, update, and delete a rep makes in the app is captured from the write-ahead log and lands as a Delta table in Unity Catalog — no external CDC infrastructure. That’s the operational database feeding the analytics estate.”',
    actions: [
      {
        id: 'act_cdf_enable',
        label: '1. Enable Change Data Feed on the schema',
        runningLabel: 'Enabling CDF…',
        doneLabel: 'CDF enabled ✓',
        durationMs: 2400,
        requires: ['act1_seed'],
        endpoint: '/api/demo/act4/cdf-enable',
        log: [
          'Setting REPLICA IDENTITY FULL on the sales tables…',
          'Enabling Change Data Feed on schema sales…',
          'Every table now writes its change history to Delta (lb_<table>_history).',
          'Changes batch to Unity Catalog every ~15s from the WAL.',
        ],
        reminder: {
          text: 'CDF is enabled at the schema level — every table now streams its inserts/updates/deletes to Delta tables in Unity Catalog. Next: add an opportunity in the app.',
        },
      },
      {
        id: 'act_cdf_change',
        label: '2. Add a manual opportunity',
        runningLabel: '',
        doneLabel: 'Done — check the lakehouse',
        durationMs: 1200,
        requires: ['act_cdf_enable'],
        log: [
          'Open the Opportunities tab and add a new opportunity.',
          'That INSERT commits to sales.opportunities in Lakebase.',
          'CDF captures it from the WAL → lands in the lakehouse in ~15s.',
        ],
        reminder: {
          text: 'Now open the Lakehouse tables in Unity Catalog (for_startups_demos_catalog.data_science_ml) and check lb_opportunities_history — the opportunity you just added shows up as a change row (_pg_change_type = insert). CDF flushes every ~15s, so give it a moment. Bidirectional loop: lakehouse→app (synced tables) and app→lakehouse (CDF).',
        },
      },
    ],
  },
  {
    num: 5,
    icon: 'surge',
    title: 'End-of-Quarter Load Test & Autoscaling',
    feature: 'Observability · Autoscaling',
    say: '“It’s the last day of the quarter. First 300 reps pile into the portal — then a second wave doubles it to 600 concurrent connections hammering the database. Open the Lakebase Monitoring graph, launch the surge, and watch compute scale up to absorb it with no config change and no downtime — then scale back to zero when the rush is over.”',
    loadTest: true,
    // No step buttons: the LoadTestPanel renders its own Monitoring callout +
    // surge controls (the real Monitoring graph is the star of this act).
    actions: [],
  },
];

const demoStyles: Record<string, React.CSSProperties> = {
  actGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 16,
  },
  actCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    borderTop: `3px solid ${COLORS.accent}`,
  },
  actNum: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  // Round badge holding the per-act feature glyph (replaces the number badge).
  actIconBadge: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: COLORS.accent,
    color: COLORS.white,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Setup card: neutral/muted styling so it reads as "prep", not a headline act.
  // Setup card sits on the dark console — a subtle translucent panel so it reads
  // as secondary "prep" vs. the crisp white feature cards below.
  setupCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.12)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
  },
  setupNum: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: 'rgba(255,255,255,0.9)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  // Divider that opens the numbered Lakebase acts.
  storyDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '2px 0',
  },
  storyDividerLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: COLORS.accent,
    whiteSpace: 'nowrap',
  },
  actFeature: {
    fontSize: 11,
    fontWeight: 600,
    color: COLORS.accent,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  actSay: {
    fontSize: 13,
    color: COLORS.gray500,
    fontStyle: 'italic',
    lineHeight: 1.5,
    margin: '10px 0 16px',
    borderLeft: `3px solid ${COLORS.gray200}`,
    paddingLeft: 12,
  },
  actBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    transition: 'all 0.15s ease',
    marginBottom: 8,
  },
  watchChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    fontSize: 12,
    fontWeight: 600,
    color: COLORS.primary,
    textDecoration: 'none',
    padding: '6px 10px',
    borderRadius: 16,
    backgroundColor: COLORS.primaryBg,
    border: `1px dashed ${COLORS.gray300}`,
    alignSelf: 'flex-start',
  },
  reminder: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
    padding: '10px 12px',
    borderRadius: 8,
    backgroundColor: COLORS.warningBg,
    border: `1px solid ${COLORS.warning}`,
    fontSize: 13,
    color: COLORS.gray800,
    lineHeight: 1.4,
  },
  reminderLink: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    textDecoration: 'none',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
  },
  logPanel: {
    backgroundColor: COLORS.primaryDark,
    color: '#C9E7D8',
    borderRadius: 10,
    padding: '14px 18px',
    fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    fontSize: 12.5,
    lineHeight: 1.7,
    height: 260,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
  },
};

/* Big primary button with per-step status. */
function ActionButton({
  action, status, disabled, onRun, config,
}: {
  action: DemoAction; status: StepStatus; disabled: boolean; onRun: () => void; config: DemoConfig;
}) {
  const isLink = !!action.hrefTarget;
  const running = status === 'running';
  const done = status === 'done';

  let bg = COLORS.primary;
  let color = COLORS.white;
  if (disabled) { bg = COLORS.gray100; color = COLORS.gray400; }
  else if (done) { bg = COLORS.successBg; color = COLORS.success; }
  else if (action.danger) { bg = COLORS.danger; color = COLORS.white; }

  const label = running ? action.runningLabel
    : done ? action.doneLabel
    : action.label;

  return (
    <button
      style={{ ...demoStyles.actBtn, backgroundColor: bg, color, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1 }}
      disabled={disabled || running}
      onClick={() => {
        if (action.hrefTarget) { window.open(linkFor(action.hrefTarget, config), '_blank'); }
        onRun();
      }}
      title={disabled ? 'Complete the previous step first' : action.label}
    >
      <span>{label}</span>
      <span style={{ fontSize: 13 }}>
        {running ? '⏳' : done ? '✓' : isLink ? '↗' : '▶'}
      </span>
    </button>
  );
}

/* Modal "code runner": shows the real SQL executing statement-by-statement.
   `running` is the index of the currently-executing statement; when `done`,
   all statements are marked complete. `mood='disaster'` styles it red with an
   SOS flourish for the Act 3 DROP. */
function CodeRunnerModal({
  title, statements, running, done, mood = 'normal', onClose,
}: {
  title: string; statements: string[]; running: number; done: boolean;
  mood?: 'normal' | 'disaster'; onClose: () => void;
}) {
  const disaster = mood === 'disaster';
  const bg = disaster ? '#2A0E12' : COLORS.primaryDark;      // deep maroon vs navy
  const accent = disaster ? '#FF5F56' : COLORS.accent;
  const border = disaster ? '#98102A' : COLORS.primaryLight;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        backgroundColor: 'rgba(14,27,32,0.72)', backdropFilter: 'blur(2px)',
      }}
      onClick={() => { if (done) onClose(); }}
    >
      <div
        style={{
          width: 'min(760px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          backgroundColor: bg, borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)', border: `1px solid ${border}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title bar (terminal chrome) */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
          borderBottom: `1px solid rgba(255,255,255,0.1)`, color: COLORS.white,
        }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F56' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FFBD2E' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#27C93F' }} />
          <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace" }}>
            {disaster ? '🆘 ' : ''}{title}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8 }}>
            {done ? (disaster ? 'incident' : 'complete') : `executing ${Math.min(running + 1, statements.length)}/${statements.length}`}
          </span>
        </div>

        {/* Statements */}
        <div style={{
          padding: 18, overflowY: 'auto',
          fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace", fontSize: 13, lineHeight: 1.55,
        }}>
          {statements.map((stmt, i) => {
            const state = done || i < running ? 'done' : i === running ? 'running' : 'pending';
            const doneColor = disaster ? '#F3B0B0' : '#C9E7D8';
            const color = state === 'done' ? doneColor : state === 'running' ? '#FFFFFF' : '#7A5A5E';
            return (
              <div key={i} style={{
                display: 'flex', gap: 10, marginBottom: 14,
                opacity: state === 'pending' ? 0.5 : 1, transition: 'opacity 0.3s ease',
              }}>
                <span style={{ flexShrink: 0, width: 16, color, paddingTop: 1 }}>
                  {state === 'done' ? (disaster ? '✗' : '✓') : state === 'running' ? '▸' : '·'}
                </span>
                <pre style={{
                  margin: 0, whiteSpace: 'pre-wrap', color,
                  borderLeft: state === 'running' ? `2px solid ${accent}` : '2px solid transparent',
                  paddingLeft: 10,
                }}>{stmt}</pre>
              </div>
            );
          })}

          {/* Big sad face when the disaster completes */}
          {disaster && done && (
            <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
              <div style={{ fontSize: 52, lineHeight: 1 }}>😢</div>
              <div style={{ marginTop: 8, color: '#FF8A80', fontWeight: 700, letterSpacing: '0.12em' }}>
                — S.O.S. —
              </div>
              <div style={{ marginTop: 4, color: '#F3B0B0', fontSize: 12 }}>
                The pipeline is gone. Time for point-in-time recovery.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px', borderTop: `1px solid rgba(255,255,255,0.1)`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12, color: done ? (disaster ? '#FF8A80' : COLORS.success) : COLORS.warning, fontWeight: 600 }}>
            {done
              ? (disaster ? '● Disaster complete — the pipeline was dropped' : '● All statements executed on the branch')
              : '● Running…'}
          </span>
          <button
            onClick={onClose}
            disabled={!done}
            style={{
              marginLeft: 'auto', padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: 'none', cursor: done ? 'pointer' : 'not-allowed',
              backgroundColor: done ? accent : COLORS.primaryLight, color: COLORS.white,
              opacity: done ? 1 : 0.6,
            }}
          >
            {done ? (disaster ? 'Oh no…' : 'Done') : 'Running…'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Interactive load-test dashboard for Act 5. Starts a real background load
   test on the backend and polls /act5/progress ~1s for live metrics. */
interface LoadProgress {
  running: boolean;
  phase: string;
  active_connections: number;
  peak_connections: number;
  total_queries: number;
  errors: number;
  elapsed: number;
  qps: number;
  vcpus: number | null;
  target_workers: number;
  timeline: { t: number; active: number; qps: number; vcpus: number | null; step?: boolean }[];
  stepped?: boolean;
  step_at?: number;
}

function LoadTestPanel({ onLog, resetSignal, config }: { onLog: (line: string) => void; resetSignal: number; config: DemoConfig }) {
  const [p, setP] = useState<LoadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const pollRef = React.useRef<number | null>(null);
  const previewRef = React.useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (previewRef.current) { clearInterval(previewRef.current); previewRef.current = null; }
  };
  useEffect(() => () => stopPolling(), []);

  // Clear the dashboard (stop any run + wipe metrics). Used by the close button
  // and triggered whenever the global "Reset demo" runs (resetSignal changes).
  const clearDashboard = useCallback(() => {
    stopPolling();
    fetch('/api/demo/act5/stop', { method: 'POST' }).catch(() => {});
    setP(null); setBusy(false); setPreview(false);
  }, []);

  // React to the global demo reset.
  useEffect(() => {
    if (resetSignal > 0) clearDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  const poll = useCallback(() => {
    fetch('/api/demo/act5/progress')
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d: LoadProgress) => {
        setP(d);
        if (!d.running && d.phase === 'done') {
          stopPolling(); setBusy(false);
          onLog(`Load test complete · peak ${d.peak_connections} connections · ${d.total_queries.toLocaleString()} queries · ${d.errors} errors`);
        }
      })
      .catch(() => {/* transient */});
  }, [onLog]);

  // Local preview simulation when the backend is unreachable. Two-wave step at 30s.
  const runPreview = useCallback(() => {
    setPreview(true); setBusy(true);
    const t0 = Date.now();
    const STEP = 30;
    const tl: LoadProgress['timeline'] = [];
    previewRef.current = window.setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      const stepped = el >= STEP;
      // Wave 1 ramps to ~250; wave 2 steps up toward 500 after STEP.
      const active = stepped
        ? Math.min(500, 250 + Math.round((el - STEP) * 40))
        : Math.min(250, Math.round(el * 18));
      const vcpus = el < 10 ? 1 : !stepped ? 3 : el < STEP + 15 ? 6 : 9;
      const qps = active * (2 + Math.random());
      tl.push({ t: +el.toFixed(1), active, qps, vcpus, step: stepped });
      const snap: LoadProgress = {
        running: el < 70, phase: el >= 70 ? 'done' : stepped ? 'surge' : 'wave1',
        active_connections: active, peak_connections: 500,
        total_queries: Math.round(tl.reduce((s, x) => s + x.qps, 0)),
        errors: 0, elapsed: +el.toFixed(1), qps: +qps.toFixed(0), vcpus,
        target_workers: 500, timeline: tl.slice(-40), stepped, step_at: STEP,
      };
      setP(snap);
      if (el >= 70) { stopPolling(); setBusy(false); onLog('Load test complete (preview).'); }
    }, 1000);
  }, [onLog]);

  const start = () => {
    if (busy) return;
    setBusy(true);
    onLog('\n$ End-of-quarter load test');
    fetch('/api/demo/act5/start?num_workers=600&duration_s=150&ramp_s=15&step_at=30', { method: 'POST' })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => {
        (d.log || []).forEach((l: string) => onLog(`  ${l}`));
        stopPolling();
        pollRef.current = window.setInterval(poll, 1200);
        poll();
      })
      .catch(() => { onLog('  (preview — backend not connected, simulating)'); runPreview(); });
  };

  const stop = () => {
    fetch('/api/demo/act5/stop', { method: 'POST' }).catch(() => {});
    stopPolling(); setBusy(false); setPreview(false);
    onLog('  Load test stopped — compute scales back down when idle.');
  };

  const tile = (label: string, value: string, color: string) => (
    <div style={{ flex: 1, backgroundColor: COLORS.white, borderRadius: 10, padding: '12px 14px', border: `1px solid ${COLORS.gray200}`, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{label}</div>
    </div>
  );

  const monitoringUrl = linkFor('project', config);

  return (
    <div style={{ marginTop: 8 }}>
      {/* The real Lakebase Monitoring graph is the star of this act — open it
         first, then drive the surge and watch compute autoscale live there. */}
      <a href={monitoringUrl} target="_blank" rel="noreferrer" style={{
        display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
        backgroundColor: COLORS.primary, border: `1px solid ${COLORS.primaryDark}`,
        borderRadius: 10, padding: '11px 13px', marginBottom: 12,
      }}>
        <span style={{ ...demoStyles.actIconBadge, width: 28, height: 28 }}>
          <ActIcon name="surge" color={COLORS.white} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.white }}>Open Lakebase Monitoring ↗</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>See the live compute graph as the surge hits</div>
        </div>
      </a>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={start} disabled={busy}
          style={{ ...demoStyles.actBtn, marginBottom: 0, flex: 1,
            backgroundColor: busy ? COLORS.gray100 : COLORS.accent,
            color: busy ? COLORS.gray400 : COLORS.white, cursor: busy ? 'not-allowed' : 'pointer' }}>
          <span>{busy ? 'Load test running…' : '⚡ Simulate end-of-quarter surge'}</span>
          <span style={{ fontSize: 13 }}>{busy ? '⏳' : '▶'}</span>
        </button>
        {busy && (
          <button onClick={stop}
            style={{ ...demoStyles.actBtn, marginBottom: 0, width: 90, justifyContent: 'center',
              backgroundColor: COLORS.gray100, color: COLORS.gray700, cursor: 'pointer' }}>
            Stop
          </button>
        )}
      </div>

      {p && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray700 }}>
              Live load generator {p.running ? `· ${p.elapsed.toFixed(0)}s` : '· finished'}
              {p.stepped && p.running ? ' · ⚡ second wave' : ''}
            </span>
            <button
              onClick={clearDashboard}
              title={busy ? 'Stop the test and close' : 'Close'}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: COLORS.gray400, padding: '2px 6px' }}>
              {busy ? 'Stop & close ✕' : 'Close ✕'}
            </button>
          </div>
          {/* Just the genuinely-live numbers the app is generating — the shape of
             the load. The autoscaling response itself is shown in Monitoring. */}
          <div style={{ display: 'flex', gap: 8 }}>
            {tile('Active connections', String(p.active_connections), COLORS.primary)}
            {tile('Queries / sec', Math.round(p.qps).toLocaleString(), '#2272B4')}
            {tile('Errors', String(p.errors), p.errors > 0 ? COLORS.danger : COLORS.gray400)}
          </div>
          <div style={{ fontSize: 11, color: preview ? COLORS.warning : COLORS.gray500, marginTop: 8 }}>
            {preview
              ? 'Preview mode — simulated metrics (backend not connected).'
              : 'This is the load the app is driving into Lakebase → watch the Monitoring graph for the autoscaling response.'}
          </div>
        </>
      )}
    </div>
  );
}

function DemoControlTab({
  statuses, onRunAction, onReset, resetting, log, config, dismissed, onDismiss, onLog, resetSignal,
}: {
  statuses: Record<string, StepStatus>;
  onRunAction: (act: DemoAct, action: DemoAction) => void;
  onReset: () => void;
  resetting: boolean;
  log: string[];
  config: DemoConfig;
  dismissed: Record<string, boolean>;
  onDismiss: (id: string) => void;
  onLog: (line: string) => void;
  resetSignal: number;
}) {
  const isDone = (id: string) => statuses[id] === 'done';
  const canRun = (action: DemoAction) =>
    !action.requires || action.requires.every(isDone);

  // Each act card can be collapsed to just its header. Default: all expanded.
  // `undefined` = follow the default; an explicit bool = the presenter's choice.
  const [collapsedActs, setCollapsedActs] = useState<Record<number, boolean | undefined>>({});
  const toggleAct = (num: number) =>
    setCollapsedActs(c => ({ ...c, [num]: !isCollapsed(num) }));
  // Reset clears manual collapse choices so Setup re-expands on a fresh run.
  useEffect(() => { setCollapsedActs({}); }, [resetSignal]);

  const setupActs = DEMO_ACTS.filter(a => a.setup);
  const numberedActs = DEMO_ACTS.filter(a => !a.setup);
  // Setup is "done" once all its steps have run; it then auto-collapses to a
  // slim "✓ App ready" bar (unless the presenter has manually toggled it).
  const setupDone = setupActs.every(a => a.actions.every(x => isDone(x.id)));
  const isCollapsed = (num: number) => {
    const explicit = collapsedActs[num];
    if (explicit !== undefined) return explicit;
    // Setup starts expanded (auto-collapses once done); numbered acts start
    // collapsed so the panel reads as a tidy list you expand act-by-act.
    return num === 0 ? setupDone : true;   // num 0 = the Setup block
  };

  const renderActCard = (act: DemoAct) => {
    const collapsed = isCollapsed(act.num);
    const done = act.setup && setupDone;
    return (
      <div key={act.num} style={act.setup ? demoStyles.setupCard : demoStyles.actCard}>
        <button
          onClick={() => toggleAct(act.num)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left',
          }}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span style={act.setup ? demoStyles.setupNum : demoStyles.actIconBadge}>
            {act.setup
              ? (done ? '✓' : '⚙')
              : (act.icon ? <ActIcon name={act.icon} color={COLORS.white} /> : act.num)}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: act.setup ? 13 : 15, fontWeight: 700, color: act.setup ? 'rgba(255,255,255,0.9)' : COLORS.gray800 }}>
              {act.setup && done && collapsed ? 'App ready' : act.title}
            </div>
            {!(act.setup && done && collapsed) && <div style={demoStyles.actFeature}>{act.feature}</div>}
          </div>
          <span style={{
            fontSize: 12, color: act.setup ? 'rgba(255,255,255,0.55)' : COLORS.gray400, flexShrink: 0,
            transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s ease',
          }}>
            ▼
          </span>
        </button>
        {!collapsed && (
        <div style={{ marginTop: 12 }}>
          {act.actions.map((action, idx) => {
            // A reminder shows once its step is done, unless the presenter
            // dismissed it or a *later* step in this act has since started
            // (i.e. it's been superseded by the next action).
            const laterStarted = act.actions
              .slice(idx + 1)
              .some(a => statuses[a.id] === 'running' || statuses[a.id] === 'done');
            const showReminder =
              action.reminder &&
              statuses[action.id] === 'done' &&
              !dismissed[action.id] &&
              !laterStarted;
            return (
              <React.Fragment key={action.id}>
                <ActionButton
                  action={action}
                  status={statuses[action.id] || 'idle'}
                  disabled={!canRun(action)}
                  onRun={() => onRunAction(act, action)}
                  config={config}
                />
                {showReminder && action.reminder && (
                  <div style={demoStyles.reminder}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontSize: 16, lineHeight: 1.3 }}>👉</span>
                      <span style={{ flex: 1 }}>{action.reminder.text}</span>
                      <button
                        onClick={() => onDismiss(action.id)}
                        title="Dismiss"
                        style={{
                          flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                          fontSize: 16, lineHeight: 1, color: COLORS.gray500, padding: '0 2px',
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {action.reminder.linkTarget && (
                      <a href={linkFor(action.reminder.linkTarget, config)} target="_blank" rel="noreferrer" style={demoStyles.reminderLink}>
                        {action.reminder.linkLabel} ↗
                      </a>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {act.watchTarget && (
            <a href={linkFor(act.watchTarget, config)} target="_blank" rel="noreferrer" style={demoStyles.watchChip}>
              🔗 {act.watchLabel}
            </a>
          )}
          {act.loadTest && <LoadTestPanel onLog={onLog} resetSignal={resetSignal} config={config} />}
        </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <button
          onClick={onReset}
          disabled={resetting}
          style={{
            padding: '8px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            cursor: resetting ? 'not-allowed' : 'pointer', border: '1px solid rgba(255,255,255,0.25)',
            backgroundColor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', opacity: resetting ? 0.6 : 1,
          }}
          title="Drop the sales schema and reset the demo to a clean slate"
        >
          {resetting ? 'Resetting…' : '↺ Reset demo'}
        </button>
        <a href={config.lakebase_project_url} target="_blank" rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
            color: 'rgba(255,255,255,0.85)', textDecoration: 'none', padding: '8px 12px', borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.25)',
          }}>
          Open Lakebase UI ↗
        </a>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Setup — app/Postgres bootstrapping, not a Lakebase feature. */}
        <div style={demoStyles.actGrid}>
          {setupActs.map(renderActCard)}
        </div>

        {/* Divider into the Lakebase story. */}
        <div style={demoStyles.storyDivider}>
          <span style={demoStyles.storyDividerLabel}>Lakebase Features</span>
          <span style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' }} />
        </div>

        <div style={demoStyles.actGrid}>
          {numberedActs.map(renderActCard)}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */

export default function App() {
  const [tab, setTab] = useState<Tab>('accounts');
  // Demo Control now lives in a fixed right-side panel (the "remote control").
  // The presenter can collapse it to give the app a full-screen view.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [features, setFeatures] = useState<Features>({
    accounts_available: false,
    opportunities_available: false,
    activities_available: false,
    renewals_active: false,
    alerts_active: false,
    health_score_active: false,
    churn_active: false,
  });
  const [featuresLoaded, setFeaturesLoaded] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  // Demo Control tab state: per-step status and the streaming activity log.
  // stepStatus is persisted to localStorage so a mid-demo browser refresh keeps
  // step gating intact (otherwise later acts would re-disable after a reload,
  // even though the DB work is already done). 'running' is coerced to 'idle' on
  // load so an interrupted step isn't stuck spinning.
  const STEP_KEY = 'demoStepStatus';
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>(() => {
    try {
      const raw = localStorage.getItem(STEP_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, StepStatus>;
      Object.keys(parsed).forEach(k => { if (parsed[k] === 'running') parsed[k] = 'idle'; });
      return parsed;
    } catch { return {}; }
  });
  const [demoLog, setDemoLog] = useState<string[]>([]);
  const [resetting, setResetting] = useState(false);
  // Bumped on every demo reset; the Act 5 load dashboard watches it to clear.
  const [resetSignal, setResetSignal] = useState(0);
  // Code-runner modal: shows real SQL executing statement-by-statement.
  const [codeModal, setCodeModal] = useState<
    { title: string; statements: string[]; running: number; done: boolean; mood: 'normal' | 'disaster' } | null
  >(null);
  // Lakebase deep-link config, computed by the backend (no hardcoded URLs).
  const [demoConfig, setDemoConfig] = useState<DemoConfig>(FALLBACK_CONFIG);
  // Reminder callouts the presenter has manually dismissed (cleared on reset).
  const [dismissedReminders, setDismissedReminders] = useState<Record<string, boolean>>({});

  // Persist step progress across browser refreshes.
  useEffect(() => {
    try { localStorage.setItem(STEP_KEY, JSON.stringify(stepStatus)); } catch { /* ignore */ }
  }, [stepStatus]);

  // Fetch the Lakebase deep-link config once on load.
  useEffect(() => {
    fetch('/api/demo/config')
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((c: DemoConfig) => setDemoConfig(c))
      .catch(() => { /* keep FALLBACK_CONFIG in local preview */ });
  }, []);
  // In preview mode the demo buttons drive the feature flags directly, so the
  // 30s poll below must not overwrite them. Once any step has run, we hold the
  // locally-driven feature state.
  const [demoDriven, setDemoDriven] = useState(false);

  // Poll /api/features every 30 seconds; fall back to mock features in local dev.
  useEffect(() => {
    const fetchFeatures = () => {
      fetch('/api/features')
        .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
        .then(d => { if (!demoDriven) setFeatures(d); setFeaturesLoaded(true); })
        .catch(() => {
          // Local preview: start with everything OFF so the presenter builds it
          // up act-by-act from the Demo Control tab, mirroring the notebook.
          if (!demoDriven) {
            setFeatures({
              accounts_available: false,
              opportunities_available: false,
              activities_available: false,
              renewals_active: false,
              alerts_active: false,
              health_score_active: false,
              churn_active: false,
            });
          }
          setDemoMode(true);
          setFeaturesLoaded(true);
        });
    };
    fetchFeatures();
    const interval = setInterval(fetchFeatures, 30000);
    return () => clearInterval(interval);
  }, [demoDriven]);

  // Stream stubbed log lines over the action's simulated duration, then apply
  // its feature effects. Used for not-yet-wired acts and as the offline preview
  // fallback for wired ones.
  const runSimulated = useCallback((action: DemoAction) => {
    const lines = action.log;
    const total = action.durationMs ?? 2000;
    const perLine = Math.max(150, total / Math.max(1, lines.length));
    lines.forEach((line, i) => {
      setTimeout(() => setDemoLog(l => [...l, `  ${line}`]), perLine * (i + 1));
    });
    setTimeout(() => {
      setStepStatus(s => ({ ...s, [action.id]: 'done' }));
      if (action.effects) setFeatures(f => ({ ...f, ...action.effects }));
      setCodeModal(m => (m ? { ...m, running: m.statements.length, done: true } : m));
    }, total);
  }, []);

  // Run one demo step: stream its log lines, then apply its feature effects.
  const runAction = useCallback((_act: DemoAct, action: DemoAction) => {
    setDemoDriven(true);

    // Pure link steps just open a tab and mark themselves done.
    if (action.hrefTarget && action.log.length === 0) {
      setStepStatus(s => ({ ...s, [action.id]: 'done' }));
      setDemoLog(l => [...l, `↗ Opened ${action.label.replace(' ↗', '')}`]);
      return;
    }

    setStepStatus(s => ({ ...s, [action.id]: 'running' }));
    setDemoLog(l => [...l, `\n$ ${action.label}`]);

    // Optional code-runner modal: open it and advance through the SQL
    // statements on a timer while the backend call runs.
    if (action.codeStatements && action.codeStatements.length) {
      const stmts = action.codeStatements;
      setCodeModal({ title: action.codeTitle || 'Running SQL', statements: stmts, running: 0, done: false, mood: action.codeMood || 'normal' });
      const per = Math.max(500, (action.durationMs ?? 2400) / stmts.length);
      stmts.forEach((_, i) => {
        setTimeout(() => setCodeModal(m => (m ? { ...m, running: i } : m)), per * i);
      });
    }

    // Wired steps POST to the backend and stream the server's real log lines.
    if (action.endpoint) {
      fetch(action.endpoint, { method: 'POST' })
        .then(async r => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((body?.detail?.error) || `${r.status}`);
          const lines: string[] = body.log || [];
          lines.forEach(line => setDemoLog(l => [...l, `  ${line}`]));
          // Long-running steps (e.g. branch endpoint provisioning) return
          // ok:false to mean "not done yet — click again". Reset to idle so the
          // button stays clickable, and don't apply effects.
          if (body.ok === false) {
            setStepStatus(s => ({ ...s, [action.id]: 'idle' }));
            setCodeModal(null);
            return;
          }
          setStepStatus(s => ({ ...s, [action.id]: 'done' }));
          if (action.effects) setFeatures(f => ({ ...f, ...action.effects }));
          // Mark all statements complete in the modal.
          setCodeModal(m => (m ? { ...m, running: m.statements.length, done: true } : m));
        })
        .catch(() => {
          // Backend unreachable (local preview): fall back to the stubbed log.
          setDemoLog(l => [...l, '  (preview — backend not connected, simulating)']);
          runSimulated(action);
        });
      return;
    }

    // Unwired steps: simulated stream only.
    runSimulated(action);
  }, [runSimulated]);

  // Reset the whole demo: drop the schema on the backend, then clear all
  // frontend state (step statuses, log, feature flags) back to square one.
  const OFF_FEATURES: Features = {
    accounts_available: false, opportunities_available: false, activities_available: false,
    renewals_active: false, alerts_active: false, health_score_active: false, churn_active: false,
  };
  const resetDemo = useCallback(() => {
    if (resetting) return;
    if (!window.confirm('Reset the demo? This drops the sales schema (all tables & data) so you can start over from Act 1.')) return;
    setResetting(true);
    setDemoDriven(true);
    setDemoLog(l => [...l, '\n$ Reset demo']);
    fetch('/api/demo/reset', { method: 'POST' })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.detail?.error || `${r.status}`);
        (body.log || []).forEach((line: string) => setDemoLog(l => [...l, `  ${line}`]));
      })
      .catch(() => setDemoLog(l => [...l, '  (preview — backend not connected, cleared local state)']))
      .finally(() => {
        setStepStatus({});
        setDismissedReminders({});
        setFeatures(OFF_FEATURES);
        setResetSignal(s => s + 1);   // tell the Act 5 dashboard to clear
        setTab('accounts');
        setResetting(false);
      });
  }, [resetting]);

  const featureLabels: { key: keyof Features; label: string }[] = [
    { key: 'accounts_available', label: 'Accounts' },
    { key: 'opportunities_available', label: 'Opportunities' },
    { key: 'renewals_active', label: 'Renewals' },
    { key: 'alerts_active', label: 'Risk Alerts' },
    { key: 'health_score_active', label: 'Health Score' },
    { key: 'churn_active', label: 'Churn Sync' },
  ];

  return (
    <div style={styles.app}>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { margin: 0; }
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        table tr:hover { filter: brightness(0.98); }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes churnPopulate { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={styles.body}>
        {/* Left column: the app itself (header, nav, content, footer) — kept
            fully separate from the Demo Control console on the right. */}
        <div style={styles.appColumn}>
          <header style={styles.header}>
            <div style={styles.headerTitle}>
              <PipelineLogo />
              <span>Sales Pipeline Portal</span>
              <span style={styles.headerSubtitle}>Accounts &amp; Pipeline | Powered by Lakebase</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {featuresLoaded ? 'Connected' : 'Connecting...'}
            </div>
          </header>

          {demoMode && (
            <div style={styles.demoBanner}>
              <span>Preview mode — showing sample data (backend/Lakebase not connected). Drive the demo from the Demo Control panel.</span>
            </div>
          )}

          <nav style={styles.nav}>
            {([
              { key: 'accounts' as Tab, label: 'Accounts', available: features.accounts_available },
              { key: 'opportunities' as Tab, label: 'Opportunities', available: features.opportunities_available },
              { key: 'churn' as Tab, label: 'Retention Risk', available: features.churn_active },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  ...styles.navTab,
                  ...(tab === t.key ? styles.navTabActive : {}),
                  ...(!t.available && tab !== t.key ? { opacity: 0.6 } : {}),
                }}
              >
                {t.label}
                {!t.available && (
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    backgroundColor: COLORS.warning, marginLeft: 8, verticalAlign: 'middle',
                  }} />
                )}
              </button>
            ))}
          </nav>

          <main style={styles.main}>
            {!featuresLoaded ? (
              <LoadingSpinner />
            ) : (
              <>
                {tab === 'accounts' && <AccountsTab features={features} onMock={() => setDemoMode(true)} />}
                {tab === 'opportunities' && <OpportunitiesTab features={features} onMock={() => setDemoMode(true)} />}
                {tab === 'churn' && <RetentionRiskTab features={features} onMock={() => setDemoMode(true)} />}
              </>
            )}
          </main>

          <footer style={styles.statusBar}>
            <span style={{ fontWeight: 600, color: COLORS.gray700 }}>Service Status:</span>
            {featureLabels.map(f => (
              <span key={f.key} style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ ...styles.statusDot, backgroundColor: features[f.key] ? COLORS.success : COLORS.danger }} />
                {f.label}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', color: COLORS.gray400 }}>Auto-refresh: 30s</span>
          </footer>
        </div>

        {/* Right column: the Demo Control console — full height, its own surface. */}
        {panelCollapsed ? (
          <button
            onClick={() => setPanelCollapsed(false)}
            style={styles.panelReopen}
            title="Show Demo Control"
          >
            ◀ Demo Control
          </button>
        ) : (
          <aside style={styles.panel}>
            <div style={styles.panelHeaderBar}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.92)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: COLORS.success, boxShadow: `0 0 6px ${COLORS.success}` }} />
                Demo Control
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.45)', textTransform: 'none' }}>presenter</span>
              </span>
              <button
                onClick={() => setPanelCollapsed(true)}
                style={styles.panelCollapseBtn}
                title="Hide the panel for a full-screen app view"
              >
                Hide ▶
              </button>
            </div>
            <DemoControlTab statuses={stepStatus} onRunAction={runAction} onReset={resetDemo} resetting={resetting} log={demoLog} config={demoConfig} dismissed={dismissedReminders} onDismiss={(id) => setDismissedReminders(d => ({ ...d, [id]: true }))} onLog={(line) => { setDemoDriven(true); setDemoLog(l => [...l, line]); }} resetSignal={resetSignal} />
          </aside>
        )}
      </div>

      {codeModal && (
        <CodeRunnerModal
          title={codeModal.title}
          statements={codeModal.statements}
          running={codeModal.running}
          done={codeModal.done}
          mood={codeModal.mood}
          onClose={() => setCodeModal(null)}
        />
      )}
    </div>
  );
}
