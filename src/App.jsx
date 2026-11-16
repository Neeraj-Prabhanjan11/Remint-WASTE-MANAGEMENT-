import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, ArrowRight, BarChart3, Building2, CalendarDays,
  Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, Coins, Download, Edit3,
  Eye, EyeOff, Factory, FileText, Filter, GlassWater, Home, Leaf, LockKeyhole,
  LogOut, Mail, MapPin, Menu, Moon, PackageCheck, PackageOpen, Pencil, Plus,
  Recycle, Search, Settings2, ShieldCheck, Smartphone, Sparkles, Sprout, Sun,
  Trash2, Truck, UserRound, Users, Wallet, Weight, X, Zap,
} from 'lucide-react';

const CATEGORIES = ['Plastic', 'Paper', 'Metal', 'Glass', 'Organic', 'E-waste', 'Mixed'];
const SOURCES = ['Household', 'Apartment', 'College Campus', 'Municipality'];
const STATUSES = ['Pending', 'Scheduled', 'Assigned', 'In Progress', 'Completed', 'Cancelled'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || '';
const PAGES_BACKEND_MISSING = import.meta.env.PROD && import.meta.env.BASE_URL !== '/' && !API_BASE_URL;
const appPath = (path = '') => `${import.meta.env.BASE_URL}${path}`;
const authModeFromPath = () => window.location.pathname === appPath('signup') || window.location.pathname === '/signup' ? 'signup' : 'login';
const navItems = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'value-chain', label: 'Value Chain', icon: ArrowLeftRight },
  { id: 'sort', label: 'Sort & Log', icon: Recycle },
  { id: 'pickups', label: 'Pickups', icon: Truck },
  { id: 'impact', label: 'Impact', icon: BarChart3 },
];

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`;
const localInputDate = (date = new Date()) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};
const dayStamp = (date = new Date()) => localInputDate(date).slice(0, 10);
const formatDate = (value, options = { dateStyle: 'medium' }) => value
  ? new Intl.DateTimeFormat('en-IN', options).format(new Date(value))
  : '—';
const categoryColor = (category) => ({
  Plastic: 'blue', Paper: 'green', Metal: 'slate', Glass: 'cyan',
  Organic: 'lime', 'E-waste': 'violet', Mixed: 'amber',
}[category] || 'slate');

async function request(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: API_BASE_URL ? 'include' : 'same-origin',
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function blankLog() {
  return {
    category: 'Plastic', quantityKg: '', source: 'Household', sortingMethod: '',
    description: '', loggedAt: localInputDate(), recoveredKg: '', compostKg: '',
    resourceValueInr: '', scrapDealerIncomeInr: '',
  };
}

function blankPickup() {
  return {
    location: '', category: 'Mixed', source: 'Household', estimatedQuantityKg: '',
    pickupAt: localInputDate(new Date(Date.now() + 86400000)), collector: '', status: 'Pending',
  };
}

function IconButton({ label, className = '', children, onClick, ...props }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} {...props}>{children}</button>;
}

function PageTitle({ eyebrow, title, description, action }) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, note, tone = 'green' }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={19} strokeWidth={1.8} /></div>
      <div className="stat-copy">
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
        {note && <span className="stat-note">{note}</span>}
      </div>
    </article>
  );
}

function EmptyState({ icon: Icon = PackageOpen, title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={23} /></span>
      <strong>{title}</strong>
      <p>{children}</p>
      {action}
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status?.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>;
}

function App() {
  const [page, setPage] = useState('value-chain');
  const [theme, setTheme] = useState(() => localStorage.getItem('remint-theme') || 'light');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState(authModeFromPath);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [pickups, setPickups] = useState([]);
  const [overview, setOverview] = useState(null);
  const [impact, setImpact] = useState(null);
  const [reportPeriod, setReportPeriod] = useState('weekly');
  const [range, setRange] = useState(() => defaultRange('weekly'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextLogs, nextPickups, nextOverview] = await Promise.all([
      request('/api/logs'),
      request('/api/pickups'),
      request('/api/overview'),
    ]);
    setLogs(nextLogs);
    setPickups(nextPickups);
    setOverview(nextOverview);
  }, []);

  const refreshImpact = useCallback(async () => {
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      period: reportPeriod,
      offset: String(new Date().getTimezoneOffset()),
    });
    setImpact(await request(`/api/impact?${params}`));
  }, [range, reportPeriod]);

  const handleApiError = (cause) => {
    if (cause.status === 401) {
      setUser(null);
      setLogs([]);
      setPickups([]);
      setOverview(null);
      setImpact(null);
      setAuthMode('login');
      setError('');
      window.history.replaceState({}, '', appPath('login'));
      return;
    }
    setError(cause.message);
  };

  useEffect(() => {
    if (PAGES_BACKEND_MISSING) {
      setAuthLoading(false);
      return undefined;
    }
    let active = true;
    request('/api/auth/me')
      .then((result) => { if (active) setUser(result.user); })
      .catch((cause) => { if (active && cause.status !== 401) setError(cause.message); })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const syncRoute = () => setAuthMode(authModeFromPath());
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    setLoading(true);
    refresh()
      .then(() => { if (active) setError(''); })
      .catch((cause) => { if (active) handleApiError(cause); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, user]);

  useEffect(() => {
    if (!user) return;
    refreshImpact().catch(handleApiError);
  }, [refreshImpact, logs, user]);

  useEffect(() => {
    localStorage.setItem('remint-theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const runMutation = async (operation, successMessage) => {
    setBusy(true);
    try {
      await operation();
      await Promise.all([refresh(), refreshImpact()]);
      setError('');
      setToast(successMessage);
      return true;
    } catch (cause) {
      setToast('');
      handleApiError(cause);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const navigate = (nextPage) => {
    setPage(nextPage);
    setMenuOpen(false);
    setError('');
  };

  const navigateAuth = (mode) => {
    const nextPath = appPath(mode);
    window.history.pushState({}, '', nextPath);
    setAuthMode(mode);
    setError('');
  };

  const onAuthenticated = (account) => {
    window.history.replaceState({}, '', appPath());
    setUser(account);
    setPage('value-chain');
    setError('');
  };

  const signOut = async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setOverview(null);
      setLogs([]);
      setPickups([]);
      navigateAuth('login');
    } catch (cause) {
      setError(cause.message);
    }
  };

  const pendingCount = pickups.filter((pickup) => pickup.status === 'Pending').length;
  const pageInfo = useMemo(() => navItems.find((item) => item.id === page), [page]);

  if (PAGES_BACKEND_MISSING) {
    return (
      <div className="auth-loading pages-backend-notice">
        <div className="brand-mark"><Recycle size={23} /></div>
        <section className="auth-card">
          <div className="auth-card-kicker">GITHUB PAGES FRONTEND</div>
          <h2>Connect the live workspace</h2>
          <p className="auth-card-description">This public page is ready, but GitHub Pages cannot run Remint’s API or database. Deploy the API with persistent storage, then set the repository Actions variable <strong>REMINT_API_URL</strong> to its HTTPS URL and redeploy.</p>
        </section>
      </div>
    );
  }

  if (authLoading) {
    return <div className={`auth-loading theme-${theme}`}><span className="brand-mark"><Recycle size={23} /></span><span className="spinner" /><p>Opening your recovery workspace…</p></div>;
  }

  if (!user) {
    return <AuthPage mode={authMode} theme={theme} error={error} onError={setError} onModeChange={navigateAuth} onThemeChange={() => setTheme(theme === 'light' ? 'dark' : 'light')} onAuthenticated={onAuthenticated} />;
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Recycle size={23} strokeWidth={2.2} /></div>
          <div className="brand-name">remint<span>.</span><small>WASTE, REIMAGINED</small></div>
          <IconButton className="mobile-close" label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></IconButton>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} onClick={() => navigate(id)} className={`nav-link ${page === id ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.85} />
              <span>{label}</span>
              {id === 'pickups' && pendingCount > 0 && <span className="nav-count" title={`${pendingCount} pending pickups`}>{pendingCount}</span>}
              {page === id && <ChevronRight className="nav-caret" size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="live-dot" />
            <span>LOCAL RECOVERY NETWORK</span>
          </div>
          <div className="profile-card">
            <div className="profile-avatar">{user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy"><strong>{user.name}</strong><span>{user.organization || 'Tamil Nadu workspace'}</span></div>
            <IconButton label="Sign out" onClick={signOut}><LogOut size={15} /></IconButton>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <IconButton className="menu-toggle" label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={19} /></IconButton>
            <div className="breadcrumbs"><span>Remint</span><ChevronRight size={14} /><strong>{pageInfo?.label || 'Workspace'}</strong></div>
          </div>
          <div className="topbar-actions">
            <span className="today-label"><span className="live-dot" /> LIVE WORKSPACE</span>
            <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
            </button>
          </div>
        </header>

        <main className="page-content">
          {error && <div className="notice notice-error" role="alert"><CircleAlert size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
          {loading && !overview ? (
            <div className="loading-view"><span className="spinner" /><p>Warming up your recovery workspace…</p></div>
          ) : !overview ? (
            <div className="connection-card">
              <CircleAlert size={24} />
              <h2>Couldn’t reach the Remint API</h2>
              <p>The free API may be waking after inactivity. Try again in a moment. Free-tier data is temporary and can be cleared when the service restarts.</p>
              <button type="button" className="button button-primary" onClick={() => { setLoading(true); refresh().catch(handleApiError).finally(() => setLoading(false)); }}>Try again</button>
            </div>
          ) : (
            <>
              {page === 'overview' && <OverviewPage user={user} overview={overview} logs={logs} pickups={pickups} onNavigate={navigate} />}
              {page === 'value-chain' && <ValueChainPage overview={overview} logs={logs} pickups={pickups} onNavigate={navigate} />}
              {page === 'sort' && <SortPage logs={logs} busy={busy} onMutation={runMutation} />}
              {page === 'pickups' && <PickupsPage pickups={pickups} busy={busy} onMutation={runMutation} />}
              {page === 'impact' && <ImpactPage impact={impact} range={range} period={reportPeriod} busy={busy} onRange={setRange} onPeriod={(period) => { setReportPeriod(period); setRange(defaultRange(period)); }} onMutation={runMutation} onError={handleApiError} />}
            </>
          )}
        </main>
      </div>
      {menuOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  );
}

function defaultRange(period) {
  const days = period === 'yearly' ? 365 : period === 'monthly' ? 30 : 6;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { from: dayStamp(start), to: dayStamp(end) };
}

function AuthPage({ mode, theme, error, onError, onModeChange, onThemeChange, onAuthenticated }) {
  const [values, setValues] = useState({ name: '', email: '', password: '', organization: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const signup = mode === 'signup';

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError('');
    onError('');
    try {
      const result = await request(`/api/auth/${signup ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      onAuthenticated(result.user);
    } catch (cause) {
      setFormError(cause.message);
    } finally {
      setSubmitting(false);
    }
  };

  const change = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <div className={`auth-shell auth-${theme}`}>
      <section className="auth-story">
        <div className="auth-story-glow" />
        <header className="auth-topline">
          <div className="auth-brand"><span className="brand-mark"><Recycle size={23} strokeWidth={2.2} /></span><span>remint<span>.</span></span></div>
          <button type="button" className="auth-theme-toggle" onClick={onThemeChange} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}<span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
          </button>
        </header>
        <div className="auth-story-content">
          <div className="auth-kicker"><span className="live-dot" /> A PEOPLE-POWERED RECOVERY LOOP</div>
          <h1>Turn today’s waste<br />into <em>tomorrow’s worth.</em></h1>
          <p>One shared space for the people who sort, collect, recover, and make local value go further.</p>
          <div className="auth-flow" aria-label="Waste recovery steps">
            <div className="auth-flow-item"><span><Home size={18} /></span><small>COMMUNITY</small></div><i><ArrowRight size={16} /></i>
            <div className="auth-flow-item"><span><Truck size={18} /></span><small>COLLECTION</small></div><i><ArrowRight size={16} /></i>
            <div className="auth-flow-item"><span><Recycle size={19} /></span><small>RECOVERY</small></div><i><ArrowRight size={16} /></i>
            <div className="auth-flow-item"><span><Sprout size={18} /></span><small>LOCAL VALUE</small></div>
          </div>
          <div className="auth-promises">
            <div><span><BarChart3 size={16} /></span><p><strong>See the whole loop</strong><small>Track sorted materials, pickups, and recovery in one place.</small></p></div>
            <div><span><ShieldCheck size={16} /></span><p><strong>Your community, your records</strong><small>Each account has a private workspace backed by its own data.</small></p></div>
          </div>
        </div>
        <footer className="auth-story-footer"><span>© {new Date().getFullYear()} REMINT</span><span>LOCAL WORK. LOCAL VALUE.</span></footer>
      </section>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-mark"><Sparkles size={17} /></div>
          <div className="auth-card-kicker">{signup ? 'GROW THE RECOVERY NETWORK' : 'YOUR RECOVERY WORKSPACE'}</div>
          <h2>{signup ? 'Join the loop.' : 'Welcome back.'}</h2>
          <p className="auth-card-description">{signup ? 'Create your account and start building local value together.' : 'Sign in to pick up where your community left off.'}</p>
          {!signup && <div className="auth-note" role="note">Remint’s database was upgraded. Accounts created before the upgrade were not transferred, so please <button type="button" onClick={() => onModeChange('signup')}>create a new account</button>.</div>}
          {(formError || error) && <div className="auth-error" role="alert"><CircleAlert size={16} /><span>{formError || error}</span></div>}
          <form className="auth-form" onSubmit={submit}>
            {signup && <label>Full name<div className="auth-input-wrap"><UserRound size={16} /><input autoComplete="name" name="name" type="text" required maxLength="100" value={values.name} onChange={(event) => change('name', event.target.value)} placeholder="Your name" /></div></label>}
            <label>Email address<div className="auth-input-wrap"><Mail size={16} /><input autoComplete="email" name="email" type="email" required maxLength="254" value={values.email} onChange={(event) => change('email', event.target.value)} placeholder="you@example.com" /></div></label>
            {signup && <label>Organization <span className="auth-optional">(optional)</span><div className="auth-input-wrap"><Building2 size={16} /><input autoComplete="organization" name="organization" type="text" maxLength="120" value={values.organization} onChange={(event) => change('organization', event.target.value)} placeholder="Household, college, or organization" /></div></label>}
            <label>Password<div className="auth-input-wrap"><LockKeyhole size={16} /><input autoComplete={signup ? 'new-password' : 'current-password'} name="password" type={showPassword ? 'text' : 'password'} required minLength="12" maxLength="128" value={values.password} onChange={(event) => change('password', event.target.value)} placeholder={signup ? 'At least 12 characters' : 'Enter your password'} /><button type="button" className="password-visibility" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{signup && <small className="auth-field-hint">Use at least 12 characters for a stronger account.</small>}</label>
            <button type="submit" className="button button-primary auth-submit" disabled={submitting}>{submitting ? <span className="button-spinner" /> : <>{signup ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></>}</button>
          </form>
          <div className="auth-switch">{signup ? 'Already part of the network?' : 'New to Remint?'} <button type="button" onClick={() => { setFormError(''); onError(''); onModeChange(signup ? 'login' : 'signup'); }}>{signup ? 'Sign in' : 'Create an account'}</button></div>
          <div className="auth-security"><ShieldCheck size={14} /><span>Passwords are securely hashed. Your workspace is private to your account.</span></div>
        </div>
        <div className="auth-mobile-footer">LOCAL WORK. LOCAL VALUE.</div>
      </main>
    </div>
  );
}

function OverviewPage({ user, overview, logs, pickups, onNavigate }) {
  const recentLogs = logs.slice(0, 5);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name.trim().split(/\s+/)[0] || 'there';
  return (
    <div className="overview-page">
      <PageTitle eyebrow="YOUR COMMUNITY, IN PROGRESS" title={`${greeting}, ${firstName} ✦`} description="Here’s your recovery snapshot. Every number comes from the waste and pickup records you’ve entered." action={<button className="button button-primary" type="button" onClick={() => onNavigate('sort')}><Plus size={17} /> Log waste</button>} />
      <div className="stat-grid stat-grid-four">
        <StatCard icon={Weight} label="Waste logged" value={kg(overview.totalWasteKg)} note={`${overview.logCount} recorded entries`} />
        <StatCard icon={Recycle} label="Landfill diverted" value={kg(overview.landfillDiversionKg)} note="Recovered + composted" tone="blue" />
        <StatCard icon={Truck} label="Pending pickups" value={overview.pendingPickups} note={`${overview.scheduledPickups} already scheduled`} tone="amber" />
        <StatCard icon={Leaf} label="Pickups completed" value={overview.completedPickups} note="Weighed into the recovery flow" tone="lime" />
      </div>
      <div className="overview-grid">
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>Latest waste logs</h2><p>Real records from your local network</p></div><button className="text-button" type="button" onClick={() => onNavigate('sort')}>View all <ArrowRight size={15} /></button></div>
          {recentLogs.length ? <LogTable logs={recentLogs} compact /> : <EmptyState icon={Recycle} title="Your recovery story starts here">Log a sorted material to see its journey reflected across the workspace.<button className="button button-secondary" type="button" onClick={() => onNavigate('sort')}>Add first log</button></EmptyState>}
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><h2>Keep it moving</h2><p>Small steps, shared value</p></div><span className="soft-icon"><Zap size={18} /></span></div>
          <button className="quick-action" type="button" onClick={() => onNavigate('sort')}><span className="quick-icon green"><Recycle size={18} /></span><span><strong>Log sorted waste</strong><small>Record quantity and recovery</small></span><ChevronRight size={17} /></button>
          <button className="quick-action" type="button" onClick={() => onNavigate('pickups')}><span className="quick-icon blue"><Truck size={18} /></span><span><strong>Plan a pickup</strong><small>Connect a location to a collector</small></span><ChevronRight size={17} /></button>
          <button className="quick-action" type="button" onClick={() => onNavigate('impact')}><span className="quick-icon lime"><BarChart3 size={18} /></span><span><strong>See your impact</strong><small>Explore verified community data</small></span><ChevronRight size={17} /></button>
          <div className="quote-card"><Sprout size={19} /><p>“Waste becomes a resource when we make recovery a community habit.”</p><span>THE REMINT LOOP</span></div>
        </section>
      </div>
    </div>
  );
}

function ValueChainPage({ overview, logs, pickups, onNavigate }) {
  const materialTotal = overview.totalWasteKg || 0;
  const recoveredTotal = overview.landfillDiversionKg || 0;
  return (
    <>
      <section className="value-hero">
        <div className="value-hero-copy">
          <div className="eyebrow"><span className="live-dot" /> A PEOPLE-POWERED RECOVERY LOOP</div>
          <h1>Waste has a way<br />back to <em>value.</em></h1>
          <p>Every household, campus, collector, and scrap dealer has a part to play. See how local action keeps useful things in circulation.</p>
          <div className="hero-actions"><button type="button" className="button button-primary" onClick={() => onNavigate('sort')}><Plus size={17} /> Start with a waste log</button><button type="button" className="button button-quiet" onClick={() => onNavigate('pickups')}>Plan a pickup <ArrowRight size={16} /></button></div>
        </div>
        <div className="hero-art" aria-label="Illustration of community waste recovery">
          <div className="art-sun" />
          <div className="art-loop"><span className="loop-arrow loop-one"><ArrowRight size={21} /></span><span className="loop-arrow loop-two"><ArrowRight size={21} /></span><span className="loop-arrow loop-three"><ArrowRight size={21} /></span></div>
          <div className="art-center"><Recycle size={42} strokeWidth={1.6} /><span>LOCAL<br />VALUE</span></div>
          <div className="art-node node-house"><span><Home size={21} /></span><small>HOME</small></div>
          <div className="art-node node-collector"><span><Truck size={21} /></span><small>COLLECT</small></div>
          <div className="art-node node-plant"><span><Sprout size={21} /></span><small>RECOVER</small></div>
          <div className="art-node node-person"><span><Users size={20} /></span><small>PEOPLE</small></div>
          <div className="art-cloud cloud-one" /><div className="art-cloud cloud-two" />
        </div>
      </section>
      <div className="chain-intro">
        <div><div className="eyebrow">FROM WASTE TO RESOURCE</div><h2>A loop worth completing.</h2><p>Follow each step from the moment we sort to the value shared back with the people who make recovery work.</p></div>
        <div className="chain-kpis"><div><strong>{kg(materialTotal)}</strong><span>WEIGHED SO FAR</span></div><div><strong>{kg(recoveredTotal)}</strong><span>DIVERTED BY SORTING</span></div></div>
      </div>
      <section className="chain-track-wrap" aria-label="Smart waste management value chain">
        <div className="chain-labels"><span>WASTE</span><span>RESOURCE</span></div>
        <div className="chain-track">
          <ChainStage number="01" title="Waste starts with us" icon={Home} tone="green">
            <div className="source-list"><span><Home size={15} /> <b>Home</b><small>Households & apartments</small></span><span><Building2 size={15} /> <b>Campus</b><small>Colleges & institutes</small></span><span><MapPin size={15} /> <b>Ward</b><small>Municipalities</small></span></div>
            <div className="pill-row"><span className="tiny-pill green">Recyclables</span><span className="tiny-pill lime">Organics</span></div>
            <div className="stage-foot"><Users size={14} /> People power the loop</div>
          </ChainStage>
          <ChainStage number="02" title="Collection" icon={Truck} tone="blue">
            <div className="mini-illustration truck-illustration"><Truck size={44} strokeWidth={1.45} /><span className="truck-box" /></div>
            <strong className="stage-big">{pickups.length} <small>pickups</small></strong>
            <div className="stage-foot"><Clock3 size={14} /> {pickups.filter((pickup) => pickup.status === 'Pending').length} waiting to be picked up</div>
          </ChainStage>
          <ChainStage number="03" title="See it. Sort it. Track it." icon={Smartphone} tone="violet">
            <div className="screen-pair">
              <div className="mini-screen"><div className="screen-notch" /><ScanIllustration /><small>Scan a material</small><span className="screen-tag">READY TO SCAN</span></div>
              <div className="mini-screen dashboard-screen"><div className="screen-topline"><span /><span /></div><div className="screen-map"><span /><span /><span /></div><div className="screen-bars"><i /><i /><i /><i /><i /></div><small>Live route + recovery</small></div>
            </div>
            <div className="category-dots">{CATEGORIES.map((category) => <span className={`dot-tag ${categoryColor(category)}`} key={category}>{category}</span>)}</div>
            <div className="stage-foot"><Smartphone size={14} /> Household + operator view</div>
          </ChainStage>
          <ChainStage number="04" title="Material recovery" icon={Factory} tone="cyan">
            <div className="mini-illustration recovery-illustration"><Factory size={43} strokeWidth={1.45} /><span className="recovery-spark spark-a">✦</span><span className="recovery-spark spark-b">✳</span></div>
            <strong className="stage-big">{kg(overview.landfillDiversionKg)} <small>recovered</small></strong>
            <div className="stage-foot"><PackageCheck size={14} /> Sorted, weighed, put to use</div>
          </ChainStage>
          <ChainStage number="05" title="Nothing wasted. Value shared." icon={Sprout} tone="lime">
            <div className="outcome-list"><span><i><PackageOpen size={16} /></i><b>Reused materials<small>Paper · plastic · glass · metal</small></b></span><span><i><Sprout size={16} /></i><b>Nutrient-rich compost<small>Food scraps → healthier soil</small></b></span><span><i><UserRound size={15} /><Coins size={13} /></i><b>Scrap dealer income<small>Fair value · dignity · work</small></b></span></div>
            <div className="stage-foot"><HeartIcon /> Value shared with recovery workers</div>
          </ChainStage>
          <ChainStage number="06" title="Income generation" icon={Wallet} tone="amber">
            <div className="income-feature"><span><Coins size={22} /></span><strong>{money(overview.scrapDealerIncomeInr)}</strong><small>dealer income recorded</small></div>
            <div className="stage-callout">LOCAL WORK<br /><b>LOCAL VALUE</b></div>
            <div className="stage-foot"><Users size={14} /> Scrap dealers earn fairly</div>
          </ChainStage>
        </div>
      </section>
      <div className="chain-bottom-row">
        <div className="chain-promise"><div className="promise-icon"><Sprout size={20} /></div><div><strong>Better systems. Shared value.</strong><p>When recovery is tracked and transparent, the people who do the work can share in what it creates.</p></div></div>
        <button className="text-button" type="button" onClick={() => onNavigate('impact')}>Explore community impact <ArrowRight size={15} /></button>
      </div>
      <div className="chain-footnote"><CircleAlert size={14} /> Values above reflect records added to this workspace. No demo figures are included.</div>
      <span className="sr-only">{logs.length} waste records</span>
    </>
  );
}

function ChainStage({ number, title, icon: Icon, tone, children }) {
  return (
    <article className={`chain-stage stage-${tone}`}>
      <div className="stage-topline"><span className={`stage-icon ${tone}`}><Icon size={20} strokeWidth={1.8} /></span><span className="stage-number">{number}</span></div>
      <h3>{title}</h3>
      <div className="stage-content">{children}</div>
      <span className="stage-arrow" aria-hidden="true"><ArrowRight size={15} /></span>
    </article>
  );
}

function HeartIcon() {
  return <span className="heart-mark" aria-hidden="true">♥</span>;
}

function ScanIllustration() {
  return <div className="scan-item"><div className="scan-corners" /><Recycle size={20} /><span>♧</span></div>;
}

function SortPage({ logs, busy, onMutation }) {
  const [form, setForm] = useState(blankLog);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const visibleLogs = useMemo(() => logs.filter((log) => {
    const text = `${log.category} ${log.source} ${log.description} ${log.sorting_method}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (!categoryFilter || log.category === categoryFilter);
  }), [logs, search, categoryFilter]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => { setForm(blankLog()); setEditingId(null); };
  const submit = async (event) => {
    event.preventDefault();
    const path = editingId ? `/api/logs/${editingId}` : '/api/logs';
    const saved = await onMutation(() => request(path, { method: editingId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) }), editingId ? 'Waste log updated.' : 'Waste logged. Your Value Chain and Impact are up to date.');
    if (saved) reset();
  };
  const edit = (log) => {
    setEditingId(log.id);
    setForm({
      category: log.category, quantityKg: log.quantity_kg, source: log.source,
      sortingMethod: log.sorting_method, description: log.description || '',
      loggedAt: localInputDate(new Date(log.logged_at)), recoveredKg: log.recovered_kg,
      compostKg: log.compost_kg, resourceValueInr: log.resource_value_inr,
      scrapDealerIncomeInr: log.scrap_dealer_income_inr,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const remove = async (log) => {
    if (!window.confirm(`Delete the ${log.category.toLowerCase()} record of ${kg(log.quantity_kg)}?`)) return;
    await onMutation(() => request(`/api/logs/${log.id}`, { method: 'DELETE' }), 'Waste record deleted.');
  };
  const statWaste = logs.reduce((sum, log) => sum + log.quantity_kg, 0);
  const statDiverted = logs.reduce((sum, log) => sum + log.recovered_kg + log.compost_kg, 0);

  return (
    <>
      <PageTitle eyebrow="SORT & LOG" title="Give every item a next life." description="Log what your community sorts. Your records power the overview, recovery loop, and impact report." action={<span className="page-mark"><Recycle size={19} /></span>} />
      <div className="stat-grid stat-grid-three compact-stats">
        <StatCard icon={FileText} label="Waste records" value={logs.length} note="Stored in this workspace" />
        <StatCard icon={Weight} label="Total logged" value={kg(statWaste)} note="Across all categories" tone="blue" />
        <StatCard icon={Recycle} label="Reported as recovered" value={kg(statDiverted)} note="Based on entered recovery + compost" tone="lime" />
      </div>
      <div className="sort-layout">
        <section className="panel log-form-panel">
          <div className="panel-heading"><div><h2>{editingId ? 'Edit waste record' : 'Add a waste record'}</h2><p>Record the material and how it was sorted</p></div><span className="soft-icon green"><Recycle size={18} /></span></div>
          <form onSubmit={submit} className="data-form">
            <fieldset className="category-picker"><legend>Waste category <span>*</span></legend>
              <div className="category-card-grid">{CATEGORIES.map((category, index) => {
                const icons = [PackageOpen, FileText, Factory, GlassWater, Sprout, Zap, Recycle];
                const Icon = icons[index];
                return <button key={category} type="button" onClick={() => update('category', category)} className={`category-card ${categoryColor(category)} ${form.category === category ? 'selected' : ''}`} aria-pressed={form.category === category}><Icon size={17} /><span>{category}</span>{form.category === category && <Check size={13} className="category-check" />}</button>;
              })}</div>
            </fieldset>
            <div className="form-grid">
              <label>Quantity <span>*</span><div className="input-with-suffix"><input required type="number" min="0.01" step="0.01" value={form.quantityKg} onChange={(event) => update('quantityKg', event.target.value)} placeholder="e.g. 2.5" /><i>kg</i></div></label>
              <label>Source <span>*</span><select required value={form.source} onChange={(event) => update('source', event.target.value)}>{SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
              <label>Sorting method <span>*</span><input required value={form.sortingMethod} onChange={(event) => update('sortingMethod', event.target.value)} placeholder="e.g. Washed and baled" /></label>
              <label>Date & time <span>*</span><input required type="datetime-local" value={form.loggedAt} onChange={(event) => update('loggedAt', event.target.value)} /></label>
            </div>
            <label>Description <textarea rows="2" maxLength="1000" value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Optional notes about this batch…" /></label>
            <details className="recovery-details" open={Boolean(form.recoveredKg || form.compostKg || form.resourceValueInr || form.scrapDealerIncomeInr)}>
              <summary><span><Settings2 size={16} /> Recovery & value details</span><small>Optional · drives the Impact dashboard</small></summary>
              <div className="form-grid recovery-grid">
                <label>Recovered material <div className="input-with-suffix"><input type="number" min="0" step="0.01" value={form.recoveredKg} onChange={(event) => update('recoveredKg', event.target.value)} placeholder="0" /><i>kg</i></div></label>
                <label>Composted <div className="input-with-suffix"><input type="number" min="0" step="0.01" value={form.compostKg} onChange={(event) => update('compostKg', event.target.value)} placeholder="0" /><i>kg</i></div></label>
                <label>Resource value <div className="input-with-suffix"><input type="number" min="0" step="1" value={form.resourceValueInr} onChange={(event) => update('resourceValueInr', event.target.value)} placeholder="0" /><i>₹</i></div></label>
                <label>Scrap dealer income <div className="input-with-suffix"><input type="number" min="0" step="1" value={form.scrapDealerIncomeInr} onChange={(event) => update('scrapDealerIncomeInr', event.target.value)} placeholder="0" /><i>₹</i></div></label>
              </div>
              <p className="form-hint"><CircleAlert size={13} /> Enter weighed/verified quantities only. Environmental results use these records, never estimates.</p>
            </details>
            <div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? <span className="button-spinner" /> : <Check size={16} />}{editingId ? 'Save changes' : 'Save waste log'}</button>{editingId && <button type="button" className="button button-secondary" onClick={reset}>Cancel edit</button>}</div>
          </form>
        </section>
        <section className="panel records-panel">
          <div className="panel-heading"><div><h2>Community records</h2><p>{visibleLogs.length} {visibleLogs.length === 1 ? 'entry' : 'entries'} in your current view</p></div><span className="record-count">{logs.length}</span></div>
          <div className="table-tools"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs…" aria-label="Search logs" /></label><label className="filter-field"><Filter size={15} /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category"><option value="">All categories</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label></div>
          {visibleLogs.length ? <LogTable logs={visibleLogs} onEdit={edit} onDelete={remove} /> : <EmptyState icon={Search} title={logs.length ? 'No matching records' : 'No waste logged yet'}>{logs.length ? 'Try another search or category.' : 'Your first recorded batch will appear here and update every connected dashboard.'}</EmptyState>}
        </section>
      </div>
    </>
  );
}

function LogTable({ logs, onEdit, onDelete, compact = false }) {
  return (
    <div className={`table-wrap ${compact ? 'compact-table' : ''}`}>
      <table><thead><tr><th>Material</th><th>Source</th><th>Quantity</th><th>Sorted on</th>{!compact && <th>Recovery</th>}{!compact && <th aria-label="Actions" />}</tr></thead>
        <tbody>{logs.map((log) => <tr key={log.id}>
          <td><span className={`category-label ${categoryColor(log.category)}`}><i />{log.category}</span><small className="table-subtext">{log.sorting_method}</small></td>
          <td>{log.source}</td><td className="numeric-cell">{kg(log.quantity_kg)}</td><td>{formatDate(log.logged_at, compact ? { dateStyle: 'medium' } : { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          {!compact && <td>{kg(log.recovered_kg + log.compost_kg)}</td>}
          {!compact && <td><div className="row-actions">{onEdit && <IconButton label="Edit record" onClick={() => onEdit(log)}><Pencil size={15} /></IconButton>}{onDelete && !log.pickup_id && <IconButton label="Delete record" className="danger-action" onClick={() => onDelete(log)}><Trash2 size={15} /></IconButton>}</div></td>}
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function PickupsPage({ pickups, busy, onMutation }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [modal, setModal] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(blankPickup);
  const [actualQuantity, setActualQuantity] = useState('');
  const [nextStatus, setNextStatus] = useState('Pending');
  const visible = useMemo(() => pickups.filter((pickup) => {
    const haystack = `${pickup.location} ${pickup.category} ${pickup.collector}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (!statusFilter || pickup.status === statusFilter) && (!dateFilter || dayStamp(new Date(pickup.pickup_at)) === dateFilter);
  }), [pickups, search, statusFilter, dateFilter]);
  const todayCount = pickups.filter((pickup) => dayStamp(new Date(pickup.pickup_at)) === dayStamp()).length;
  const stats = [
    { label: 'Total pickups', value: pickups.length, icon: Truck, tone: 'blue' },
    { label: 'Pending', value: pickups.filter((pickup) => pickup.status === 'Pending').length, icon: Clock3, tone: 'amber' },
    { label: 'Scheduled', value: pickups.filter((pickup) => pickup.status === 'Scheduled').length, icon: CalendarDays, tone: 'violet' },
    { label: 'Completed', value: pickups.filter((pickup) => pickup.status === 'Completed').length, icon: CheckCircle2, tone: 'green' },
    { label: "Today's pickups", value: todayCount, icon: MapPin, tone: 'lime' },
  ];
  const openNew = () => { setSelected(null); setForm(blankPickup()); setModal('form'); };
  const openEdit = (pickup) => {
    setSelected(pickup);
    setForm({
      location: pickup.location, category: pickup.category, source: pickup.source || 'Household',
      estimatedQuantityKg: pickup.estimated_quantity_kg, pickupAt: localInputDate(new Date(pickup.pickup_at)),
      collector: pickup.collector || '', status: pickup.status,
    });
    setModal('form');
  };
  const openDetails = (pickup) => { setSelected(pickup); setActualQuantity(''); setNextStatus(pickup.status); setModal('details'); };
  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submitPickup = async (event) => {
    event.preventDefault();
    const path = selected ? `/api/pickups/${selected.id}` : '/api/pickups';
    const saved = await onMutation(() => request(path, { method: selected ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) }), selected ? 'Pickup updated.' : 'Pickup scheduled.');
    if (saved) setModal('');
  };
  const saveStatus = async (event) => {
    event.preventDefault();
    if (!selected) return;
    const submitted = new FormData(event.currentTarget);
    const status = submitted.get('status');
    const body = {
      location: selected.location,
      category: selected.category,
      source: selected.source || 'Household',
      estimatedQuantityKg: selected.estimated_quantity_kg,
      pickupAt: selected.pickup_at,
      collector: submitted.get('collector'),
      status,
      ...(status === 'Completed' ? { actualQuantityKg: submitted.get('actualQuantity') } : {}),
    };
    const saved = await onMutation(() => request(`/api/pickups/${selected.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), status === 'Completed' ? 'Pickup completed and added to Sort & Log.' : `Pickup marked ${status.toLowerCase()}.`);
    if (saved) setModal('');
  };
  const removePickup = async () => {
    if (!selected || !window.confirm('Delete this pickup? Any completed weight record will remain in the waste log as history.')) return;
    const saved = await onMutation(() => request(`/api/pickups/${selected.id}`, { method: 'DELETE' }), 'Pickup deleted.');
    if (saved) setModal('');
  };

  return (
    <>
      <PageTitle eyebrow="COLLECTION NETWORK" title="Pickups, made predictable." description="Bring communities and collectors together. Completed pickups automatically enter Sort & Log for recovery tracking." action={<button type="button" className="button button-primary" onClick={openNew}><Plus size={17} /> Schedule pickup</button>} />
      <div className="stat-grid stat-grid-five pickup-stats">{stats.map(({ label, value, icon, tone }) => <StatCard key={label} icon={icon} label={label} value={value} tone={tone} />)}</div>
      <section className="panel pickup-panel">
        <div className="panel-heading"><div><h2>Pickup schedule</h2><p>Assign a collector and keep every collection moving</p></div><span className="record-count">{visible.length}</span></div>
        <div className="table-tools pickup-tools">
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search location or collector…" aria-label="Search pickups" /></label>
          <label className="filter-field"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="date-filter"><CalendarDays size={15} /><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter pickups by date" /></label>
          {(search || statusFilter || dateFilter) && <button className="text-button clear-filter" type="button" onClick={() => { setSearch(''); setStatusFilter(''); setDateFilter(''); }}>Clear filters</button>}
        </div>
        {visible.length ? <div className="table-wrap"><table className="pickup-table"><thead><tr><th>Location</th><th>Material</th><th>Quantity</th><th>Pickup date</th><th>Collector</th><th>Status</th><th /></tr></thead><tbody>
          {visible.map((pickup) => <tr key={pickup.id} onClick={() => openDetails(pickup)} className="clickable-row">
            <td><strong className="location-name">{pickup.location}</strong><small className="table-subtext">{pickup.source || 'Community source'}</small></td>
            <td><span className={`category-label ${categoryColor(pickup.category)}`}><i />{pickup.category}</span></td>
            <td className="numeric-cell">{kg(pickup.actual_quantity_kg ?? pickup.estimated_quantity_kg)}<small className="table-subtext">{pickup.actual_quantity_kg ? 'weighed' : 'estimated'}</small></td>
            <td>{formatDate(pickup.pickup_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
            <td>{pickup.collector || <span className="unassigned">Unassigned</span>}</td>
            <td><StatusBadge status={pickup.status} /></td>
            <td><IconButton label="View pickup details" onClick={(event) => { event.stopPropagation(); openDetails(pickup); }}><ChevronRight size={16} /></IconButton></td>
          </tr>)}
        </tbody></table></div> : <EmptyState icon={Truck} title={pickups.length ? 'No pickups match' : 'No pickups scheduled yet'}>{pickups.length ? 'Try adjusting the search or filters.' : 'Create the first collection so sorted materials can make their way to recovery.'}<button type="button" className="button button-secondary" onClick={openNew}><Plus size={15} /> Schedule pickup</button></EmptyState>}
      </section>
      <p className="table-footnote"><CircleAlert size={14} /> Quantities marked estimated are planning values. Completion requires an actual weighed amount, which is saved as a waste log.</p>
      {modal === 'form' && <Modal onClose={() => setModal('')} title={selected ? 'Edit pickup' : 'Schedule a pickup'} description="Plan a collection for a local recovery partner.">
        <form className="data-form modal-form" onSubmit={submitPickup}>
          <label>Pickup location <span>*</span><input required maxLength="180" value={form.location} onChange={(event) => updateForm('location', event.target.value)} placeholder="Street, neighborhood, or landmark" /></label>
          <div className="form-grid">
            <label>Waste category <span>*</span><select value={form.category} onChange={(event) => updateForm('category', event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Source <span>*</span><select value={form.source} onChange={(event) => updateForm('source', event.target.value)}>{SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
            <label>Estimated quantity <span>*</span><div className="input-with-suffix"><input type="number" required min="0.01" step="0.01" value={form.estimatedQuantityKg} onChange={(event) => updateForm('estimatedQuantityKg', event.target.value)} placeholder="0" /><i>kg</i></div></label>
            <label>Date & time <span>*</span><input type="datetime-local" required value={form.pickupAt} onChange={(event) => updateForm('pickupAt', event.target.value)} /></label>
          </div>
          <label>Collector / operator<input value={form.collector} onChange={(event) => updateForm('collector', event.target.value)} maxLength="120" placeholder="Assign now or later" /></label>
          {selected && selected.status !== 'Completed' && <label>Pickup status<select value={form.status} onChange={(event) => updateForm('status', event.target.value)}>{STATUSES.filter((status) => status !== 'Completed').map((status) => <option key={status}>{status}</option>)}</select></label>}
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? <span className="button-spinner" /> : <Check size={16} />}{selected ? 'Save pickup' : 'Create pickup'}</button><button className="button button-secondary" type="button" onClick={() => setModal('')}>Cancel</button></div>
        </form>
      </Modal>}
      {modal === 'details' && selected && <Modal onClose={() => setModal('')} title="Pickup details" description={`Collection #${selected.id} · ${selected.location}`}>
        <div className="pickup-detail-top"><span className={`detail-category ${categoryColor(selected.category)}`}><Truck size={19} /></span><div><strong>{selected.category} collection</strong><p>{formatDate(selected.pickup_at, { dateStyle: 'full', timeStyle: 'short' })}</p></div><StatusBadge status={selected.status} /></div>
        <div className="detail-grid"><div><span>PLANNED WEIGHT</span><strong>{kg(selected.estimated_quantity_kg)}</strong></div><div><span>ACTUAL WEIGHT</span><strong>{selected.actual_quantity_kg ? kg(selected.actual_quantity_kg) : 'Not weighed'}</strong></div><div><span>SOURCE</span><strong>{selected.source || '—'}</strong></div><div><span>COLLECTOR</span><strong>{selected.collector || 'Unassigned'}</strong></div></div>
        {selected.status === 'Completed' && <div className="notice notice-success"><CheckCircle2 size={17} /><span>Actual weight has been added to <b>Sort & Log</b> for the recovery team.</span></div>}
        {selected.status !== 'Completed' && <form className="data-form status-form" onSubmit={saveStatus}>
          <div className="detail-form-heading"><h3>Update collection</h3><span>Completion triggers a new waste log</span></div>
          <label>Collector / operator<input name="collector" maxLength="120" defaultValue={selected.collector || ''} placeholder="Name of collector" /></label>
          <label>Status<select name="status" value={nextStatus} onChange={(event) => { setNextStatus(event.target.value); if (event.target.value === 'Completed') setActualQuantity(''); }} required>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Actual weighed quantity <span>{nextStatus === 'Completed' ? '*' : 'required to complete'}</span><div className="input-with-suffix"><input name="actualQuantity" type="number" min="0.01" step="0.01" required={nextStatus === 'Completed'} value={actualQuantity} onChange={(event) => setActualQuantity(event.target.value)} /><i>kg</i></div></label>
          <p className="form-hint"><CircleAlert size={13} /> Only an actual, weighed quantity is used to create the linked log record.</p>
          <div className="form-actions"><button type="submit" className="button button-primary" disabled={busy}>{busy ? <span className="button-spinner" /> : <Check size={16} />}Save status</button><button type="button" className="button button-secondary" onClick={() => openEdit(selected)}><Edit3 size={15} /> Edit details</button><button type="button" className="button button-quiet danger-text" onClick={removePickup}><Trash2 size={15} /> Delete</button></div>
        </form>}
        {selected.status === 'Completed' && <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setModal('')}>Done</button><button type="button" className="button button-quiet danger-text" onClick={removePickup}><Trash2 size={15} /> Delete pickup</button></div>}
      </Modal>}
    </>
  );
}

function Modal({ title, description, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></div>{children}</section></div>;
}

function ImpactPage({ impact, range, period, busy, onRange, onPeriod, onMutation, onError }) {
  const [factorsOpen, setFactorsOpen] = useState(false);
  const [factorValues, setFactorValues] = useState(null);
  useEffect(() => {
    if (!impact) return;
    setFactorValues({
      co2PerRecoveredKg: impact.factors.co2_per_recovered_kg,
      co2PerCompostKg: impact.factors.co2_per_compost_kg,
    });
  }, [impact?.factors?.co2_per_recovered_kg, impact?.factors?.co2_per_compost_kg]);
  const setPeriod = (value) => onPeriod(value);
  const exportCsv = async () => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, period, offset: String(new Date().getTimezoneOffset()) });
      const response = await fetch(`${API_BASE_URL}/api/impact/export.csv?${params}`, {
        credentials: API_BASE_URL ? 'include' : 'same-origin',
      });
      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.error || 'Could not export this report.');
      }
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `remint-impact-${range.from}-to-${range.to}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      throw error;
    }
  };
  const saveFactors = async (event) => {
    event.preventDefault();
    const saved = await onMutation(() => request('/api/impact/factors', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(factorValues) }), 'Estimate factors saved.');
    if (saved) setFactorsOpen(false);
  };
  const maxCategory = Math.max(1, ...(impact?.categories || []).map((item) => item.quantityKg));
  const maxTrend = Math.max(1, ...(impact?.trends || []).map((item) => item.divertedKg));
  return (
    <>
      <PageTitle eyebrow="COMMUNITY IMPACT" title="The good adds up." description="A transparent view of recorded recovery, estimated emissions avoided, and value shared with local workers." action={<button className="button button-secondary export-button" type="button" onClick={() => exportCsv().catch((cause) => onError(cause.message))}><Download size={16} /> Export CSV</button>} />
      <section className="panel report-filter-panel">
        <div className="period-tabs" role="group" aria-label="Impact report period">{['weekly', 'monthly', 'yearly'].map((value) => <button key={value} type="button" onClick={() => setPeriod(value)} className={period === value ? 'selected' : ''}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
        <div className="date-range-controls"><label>From <input type="date" value={range.from} max={range.to} onChange={(event) => onRange((current) => ({ ...current, from: event.target.value }))} /></label><span>to</span><label>Through <input type="date" value={range.to} min={range.from} onChange={(event) => onRange((current) => ({ ...current, to: event.target.value }))} /></label><button type="button" className="button button-quiet" onClick={() => { const next = defaultRange(period); onRange(next); }}>Reset</button></div>
      </section>
      {!impact ? <div className="panel report-loading"><span className="spinner" /> Loading impact report…</div> : <>
        <div className="impact-stat-grid">
          <StatCard icon={Recycle} label="Landfill diversion" value={kg(impact.landfillDiversionKg)} note="Weighed recovery + compost" tone="green" />
          <StatCard icon={Leaf} label="CO₂ avoided" value={kg(impact.co2AvoidedKg)} note="Estimate using configured factors" tone="blue" />
          <StatCard icon={PackageCheck} label="Materials recovered" value={kg(impact.materialsRecoveredKg)} note="Recorded recovered quantity" tone="violet" />
          <StatCard icon={Sprout} label="Compost produced" value={kg(impact.compostKg)} note="Recorded compost quantity" tone="lime" />
          <StatCard icon={BarChart3} label="Recovery rate" value={`${impact.recyclingRate.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`} note={`${kg(impact.landfillDiversionKg)} of ${kg(impact.totalWasteKg)} logged`} tone="cyan" />
          <StatCard icon={Coins} label="Resource value" value={money(impact.resourceValueInr)} note="Value entered on waste logs" tone="amber" />
          <StatCard icon={Wallet} label="Scrap dealer income" value={money(impact.scrapDealerIncomeInr)} note="Income explicitly recorded" tone="green" />
        </div>
        <div className="impact-grid">
          <section className="panel chart-panel">
            <div className="panel-heading"><div><h2>Recovery over time</h2><p>Recorded diversion during this reporting period</p></div><span className="chart-legend"><i /> Diverted kg</span></div>
            {impact.trends.length ? <div className="trend-chart" role="img" aria-label="Recorded waste diversion over time">
              {impact.trends.slice(-14).map((point) => <div className="trend-column" key={point.period} title={`${point.period}: ${kg(point.divertedKg)}`}><div className="trend-bar-wrap"><span className="trend-bar" style={{ height: `${Math.max(point.divertedKg ? 8 : 2, (point.divertedKg / maxTrend) * 100)}%` }} /></div><small>{point.period.slice(5)}</small></div>)}
            </div> : <EmptyState icon={BarChart3} title="No recovery in this period">Add a log with recovered or composted quantities to build your trend.</EmptyState>}
          </section>
          <section className="panel category-panel">
            <div className="panel-heading"><div><h2>Category contribution</h2><p>Logged material by category</p></div><span className="soft-icon blue"><PackageOpen size={17} /></span></div>
            {impact.categories.length ? <div className="category-bars">{impact.categories.slice().sort((a, b) => b.quantityKg - a.quantityKg).map((item) => <div className="category-bar-row" key={item.category}><div className="category-bar-label"><span>{item.category}</span><b>{kg(item.quantityKg)}</b></div><div className="category-bar-track"><span className={`category-bar-fill ${categoryColor(item.category)}`} style={{ width: `${Math.max(3, (item.quantityKg / maxCategory) * 100)}%` }} /></div><small>{kg(item.recoveredKg + item.compostKg)} recovered</small></div>)}</div> : <EmptyState icon={Recycle} title="No categories yet">Log sorted material to see what your community recovers.</EmptyState>}
          </section>
        </div>
        <section className="panel factor-panel">
          <div className="factor-intro"><span className="soft-icon amber"><Zap size={17} /></span><div><h2>About the CO₂ estimate</h2><p>CO₂ avoided is modeled from weighed recovery using these configurable factors. It is an estimate, not a measured emissions audit.</p></div></div>
          <div className="factor-controls"><div className="factor-values"><span>Recovered material <b>{impact.factors.co2_per_recovered_kg} kg CO₂ / kg</b></span><span>Compost <b>{impact.factors.co2_per_compost_kg} kg CO₂ / kg</b></span></div><button type="button" className="button button-secondary" onClick={() => { setFactorValues({ co2PerRecoveredKg: impact.factors.co2_per_recovered_kg, co2PerCompostKg: impact.factors.co2_per_compost_kg }); setFactorsOpen((open) => !open); }}><Settings2 size={15} /> {factorsOpen ? 'Close settings' : 'Configure factors'}</button></div>
          {factorsOpen && factorValues && <form className="factor-form" onSubmit={saveFactors}><label>Recovered material <div className="input-with-suffix"><input type="number" min="0" max="20" step="0.01" required value={factorValues.co2PerRecoveredKg} onChange={(event) => setFactorValues((current) => ({ ...current, co2PerRecoveredKg: event.target.value }))} /><i>kg CO₂ / kg</i></div></label><label>Compost <div className="input-with-suffix"><input type="number" min="0" max="20" step="0.01" required value={factorValues.co2PerCompostKg} onChange={(event) => setFactorValues((current) => ({ ...current, co2PerCompostKg: event.target.value }))} /><i>kg CO₂ / kg</i></div></label><button type="submit" className="button button-primary" disabled={busy}><Check size={15} /> Save factors</button></form>}
          <p className="factor-disclaimer"><CircleAlert size={13} /> Default factors are illustrative estimates (1.5 kg/kg recovered; 0.3 kg/kg compost). Tune them to a documented local methodology before reporting.</p>
        </section>
      </>}
    </>
  );
}

export default App;
