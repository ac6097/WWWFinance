import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { formatEther, parseEther, type EventLog } from 'ethers';
import {
  createContext,
  listDemoAccounts,
  loadConfig,
  switchMetaMaskToLocal,
} from './chain';
import type { ChainContext, ChainEvent, Project, ProjectStatus, RuntimeConfig } from './types';

type Screen = 'lobby' | 'create' | 'detail' | 'mine' | 'created' | 'history';
type Filter = 'All' | ProjectStatus;

const statusLabel: Record<ProjectStatus, string> = {
  Funding: '筹款中', Failed: '筹款失败', Voting: '投票中', Approved: '待放款', Rejected: '退款开放', Released: '已放款',
};
const statusStyle: Record<ProjectStatus, string> = {
  Funding: 'bg-violet-50 text-violet-700', Failed: 'bg-slate-100 text-slate-600', Voting: 'bg-amber-50 text-amber-700',
  Approved: 'bg-emerald-50 text-emerald-700', Rejected: 'bg-rose-50 text-rose-700', Released: 'bg-blue-50 text-blue-700',
};
const eventLabels: Record<string, string> = {
  ProjectCreated: '创建项目', ContributionMade: '支持项目', VoteCast: '参与投票', FundsWithdrawn: '发起人提款', RefundIssued: '申请退款',
};

function shortAddress(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';
}

function eth(value: bigint, digits = 3) {
  const n = Number(formatEther(value));
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: digits })} ETH`;
}

function dateTime(seconds: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(seconds * 1000));
}

function remaining(seconds: number) {
  if (seconds <= 0) return '已结束';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `剩余 ${days} 天 ${hours} 小时`;
  if (hours) return `剩余 ${hours} 小时 ${minutes} 分钟`;
  return `剩余 ${Math.max(1, minutes)} 分钟`;
}

function errorMessage(error: unknown, iface?: ChainContext['contract']['interface']) {
  const err = error as { code?: number; message?: string; shortMessage?: string; reason?: string; data?: string; info?: { error?: { data?: string } } };
  if (err.code === 4001) return '你已在钱包中取消本次操作。';
  const data = err.data ?? err.info?.error?.data;
  if (data && iface) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        const messages: Record<string, string> = {
          InvalidProject: '项目参数无效，请检查名称、金额和持续时间。', ProjectNotFound: '项目不存在。', FundingClosed: '筹款期限已结束，不能继续投资。',
          FundingStillOpen: '筹款期限尚未结束。', FundingUnsuccessful: '项目未达到筹款目标。', FundingGoalNotMet: '项目未达到筹款目标。',
          VotingNotOpen: '当前不在投票时间内。', VotingStillOpen: '投票期尚未结束。', NotContributor: '只有实际投资过的支持者可以投票。',
          AlreadyVoted: '每个支持者只能投票一次。', VoteAlreadyFinalized: '当前项目不能退款。', ReleaseNotApproved: '赞成权重未严格超过筹款额的一半，不能提款。',
          NotCreator: '只有项目发起人可以提款。', AlreadyWithdrawn: '项目资金已经提取。', NothingToRefund: '没有可退款金额，或已经申请过退款。',
          ReentrantCall: '合约拒绝了重复的资金操作。', TransferFailed: '链上转账失败，请检查接收钱包。',
        };
        return messages[parsed.name] ?? `交易被合约拒绝：${parsed.name}`;
      }
    } catch { /* display a useful fallback below */ }
  }
  const text = `${err.reason ?? ''} ${err.shortMessage ?? ''} ${err.message ?? ''}`.toLowerCase();
  if (text.includes('insufficient funds')) return '模拟账户余额不足。';
  if (text.includes('network') || text.includes('chain')) return '网络连接失败，请确认已启动本地链。';
  return err.reason ?? err.shortMessage ?? err.message ?? '操作失败，请稍后重试。';
}

function App() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [ctx, setCtx] = useState<ChainContext | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<string[]>([]);
  const [demoAccount, setDemoAccount] = useState('');
  const [screen, setScreen] = useState<Screen>('lobby');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string; hash?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chainNow, setChainNow] = useState(Math.floor(Date.now() / 1000));
  const [search, setSearch] = useState('');

  const refresh = useCallback(async (active = ctx) => {
    if (!active) return;
    const count = Number(await active.contract.projectCount());
    const latestBlock = await active.provider.getBlock('latest');
    const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
    setChainNow(now);
    const items = await Promise.all(Array.from({ length: count }, async (_, id) => {
      const [raw, statusRaw, contributed, voted] = await Promise.all([
        active.contract.getProject(id), active.contract.getStatus(id),
        active.contract.contributions(id, active.account), active.contract.hasVoted(id, active.account),
      ]);
      const states: ProjectStatus[] = ['Funding', 'Failed', 'Voting', 'Approved', 'Rejected', 'Released'];
      return {
        id, name: raw.name as string, description: raw.description as string, creator: raw.creator as string,
        goal: raw.goal as bigint, raised: raw.raised as bigint, fundingDeadline: Number(raw.fundingDeadline),
        votingDuration: Number(raw.votingDuration), yesWeight: raw.yesWeight as bigint, noWeight: raw.noWeight as bigint,
        withdrawn: raw.withdrawn as boolean, status: states[Number(statusRaw)] ?? 'Funding',
        contributed: contributed as bigint, voted: voted as boolean,
      } satisfies Project;
    }));
    setProjects(items.reverse());
    setLoading(false);
  }, [ctx]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadConfig();
        if (cancelled) return;
        setConfig(loaded);
        const accounts = loaded.demoEnabled ? await listDemoAccounts(loaded) : [];
        if (cancelled) return;
        setDemoAccounts(accounts);
        const first = accounts[0] ?? '';
        setDemoAccount(first);
        if (first) {
          const active = await createContext(loaded, 'demo', first);
          if (cancelled) return;
          setCtx(active);
        }
      } catch (error) {
        if (!cancelled) setNotice({ type: 'error', text: errorMessage(error) });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    setLoading(true);
    refresh(ctx).catch((error) => {
      setLoading(false);
      setNotice({ type: 'error', text: errorMessage(error, ctx.contract.interface) });
    });
  }, [ctx, refresh]);

  const activeProject = useMemo(() => projects.find((project) => project.id === selectedId) ?? null, [projects, selectedId]);
  const visibleProjects = useMemo(() => projects.filter((project) => {
    const statusMatches = filter === 'All' || project.status === filter;
    const query = search.trim().toLowerCase();
    return statusMatches && (!query || project.name.toLowerCase().includes(query) || project.description.toLowerCase().includes(query));
  }), [filter, projects, search]);
  const totals = useMemo(() => ({
    projects: projects.length,
    raised: projects.reduce((sum, project) => sum + project.raised, 0n),
    active: projects.filter((project) => ['Funding', 'Voting'].includes(project.status)).length,
  }), [projects]);

  async function connectDemo(account = demoAccount) {
    if (!config) return;
    try {
      const active = await createContext(config, 'demo', account);
      setDemoAccount(active.account);
      setCtx(active);
      setNotice({ type: 'success', text: `已切换到本地模拟账号 ${shortAddress(active.account)}。` });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  async function connectMetaMask() {
    if (!config) return;
    setBusy(true);
    setNotice({ type: 'info', text: '请在 MetaMask 中确认切换到本地课程链并连接账号…' });
    try {
      await switchMetaMaskToLocal(config);
      const active = await createContext(config, 'metamask', undefined, true);
      setCtx(active);
      setNotice({ type: 'success', text: `MetaMask 已连接 ${shortAddress(active.account)}。` });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally { setBusy(false); }
  }

  async function sendAction(label: string, action: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) {
    if (!ctx) {
      setNotice({ type: 'error', text: '请先连接钱包或切换到演示账号。' });
      return;
    }
    setBusy(true);
    setNotice({ type: 'info', text: `${label}交易已提交，等待本地链确认…` });
    try {
      const tx = await action();
      await tx.wait();
      setNotice({ type: 'success', text: `${label}成功，链上交易已确认。`, hash: tx.hash });
      await refresh(ctx);
      if (screen === 'history') await loadEvents(ctx);
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error, ctx.contract.interface) });
    } finally { setBusy(false); }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ctx) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const description = String(data.get('description') ?? '').trim();
    const goal = String(data.get('goal') ?? '');
    const fundingHours = Number(data.get('fundingHours'));
    const votingHours = Number(data.get('votingHours'));
    if (!Number.isFinite(fundingHours) || !Number.isFinite(votingHours) || fundingHours <= 0 || votingHours <= 0) {
      setNotice({ type: 'error', text: '筹款和投票时长都必须大于 0。' });
      return;
    }
    await sendAction('创建项目', () => ctx.contract.createProject(
      name, description, parseEther(goal), Math.ceil(fundingHours * 3600), Math.ceil(votingHours * 3600),
    ));
    setScreen('lobby');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadEvents(active = ctx) {
    if (!active) return;
    const names = Object.keys(eventLabels);
    const grouped = await Promise.all(names.map((name) => active.contract.queryFilter(name, 0, 'latest')));
    const raw: ChainEvent[] = [];
    for (const log of grouped.flat()) {
      const eventLog = log as EventLog;
      const parsed = active.contract.interface.parseLog({ topics: eventLog.topics, data: eventLog.data });
      if (!parsed) continue;
      const args = parsed.args;
      const base: ChainEvent = {
        name: parsed.name, label: eventLabels[parsed.name] ?? parsed.name,
        projectId: Number(args.projectId), account: '', hash: eventLog.transactionHash, blockNumber: eventLog.blockNumber,
      };
      if (parsed.name === 'ProjectCreated') raw.push({ ...base, account: String(args.creator), amount: args.goal as bigint, detail: String(args.name) });
      else if (parsed.name === 'ContributionMade') raw.push({ ...base, account: String(args.contributor), amount: args.amount as bigint });
      else if (parsed.name === 'VoteCast') raw.push({ ...base, account: String(args.voter), amount: args.weight as bigint, detail: args.support ? '赞成' : '反对' });
      else if (parsed.name === 'FundsWithdrawn') raw.push({ ...base, account: String(args.creator), amount: args.amount as bigint });
      else if (parsed.name === 'RefundIssued') raw.push({ ...base, account: String(args.contributor), amount: args.amount as bigint });
    }
    const blocks = [...new Set(raw.map((item) => item.blockNumber))];
    const times = await Promise.all(blocks.map(async (blockNumber) => [blockNumber, (await active.provider.getBlock(blockNumber))?.timestamp] as const));
    const timeMap = new Map(times);
    setEvents(raw.map((item) => ({ ...item, timestamp: timeMap.get(item.blockNumber) })).sort((a, b) => b.blockNumber - a.blockNumber));
  }

  useEffect(() => {
    if (screen === 'history' && ctx) loadEvents(ctx).catch((error) => setNotice({ type: 'error', text: errorMessage(error, ctx.contract.interface) }));
  }, [screen, ctx]);

  function navigate(next: Screen) {
    setScreen(next);
    setSelectedId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openProject(id: number) {
    setSelectedId(id);
    setScreen('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!config) return (
    <div className="grid min-h-screen place-items-center bg-[#f7f8fc] px-5 text-center">
      <div className="max-w-md rounded-3xl border border-line bg-white p-8 shadow-card">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-violet-100 text-xl text-brand">◎</div>
        <h1 className="text-lg font-bold text-ink">正在连接本地课程链</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{notice?.text ?? '等待读取 Docker 部署信息…'}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-ink">
      <Header screen={screen} onNavigate={navigate} ctx={ctx} busy={busy} accounts={demoAccounts} demoAccount={demoAccount}
        onDemoChange={connectDemo} onMetaMask={connectMetaMask} config={config}
        onRefresh={() => refresh(ctx).catch((error) => setNotice({ type: 'error', text: errorMessage(error, ctx?.contract.interface) }))} />
      <main className="mx-auto w-full max-w-[1240px] px-5 pb-16 pt-7 md:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50/80 px-4 py-3 text-xs text-violet-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <strong>本地模拟环境</strong><span>Chain ID {config.chainId} · 测试 ETH · 不连接主网</span>
          <span className="ml-auto hidden text-violet-600 sm:inline">浏览器 RPC：{config.rpcUrl}</span>
        </div>
        {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

        {screen === 'lobby' && <Lobby projects={visibleProjects} total={totals} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} chainNow={chainNow}
          loading={loading} onCreate={() => navigate('create')} onOpen={openProject} />}
        {screen === 'create' && <CreateProject onSubmit={handleCreate} onCancel={() => navigate('lobby')} busy={busy} />}
        {screen === 'detail' && activeProject && <ProjectDetail project={activeProject} account={ctx?.account} busy={busy} chainNow={chainNow}
          onBack={() => navigate('lobby')} onInvest={(amount) => sendAction('支持项目', () => ctx!.contract.contribute(activeProject.id, { value: parseEther(amount) }))}
          onVote={(support) => sendAction('参与投票', () => ctx!.contract.vote(activeProject.id, support))}
          onWithdraw={() => sendAction('发起人提款', () => ctx!.contract.withdraw(activeProject.id))}
          onRefund={() => sendAction('申请退款', () => ctx!.contract.refund(activeProject.id))} />}
        {screen === 'detail' && !activeProject && <EmptyState title="找不到这个项目" onAction={() => navigate('lobby')} action="返回项目大厅" />}
        {screen === 'mine' && <PersonalProjects title="我的投资" description="你在本地课程链上的支持记录。" projects={projects.filter((project) => project.contributed > 0n)} account={ctx?.account} onOpen={openProject} empty="当前账号还没有投资项目。" chainNow={chainNow} />}
        {screen === 'created' && <PersonalProjects title="我的发起项目" description="由当前钱包地址创建的众筹项目。" projects={projects.filter((project) => project.creator.toLowerCase() === ctx?.account.toLowerCase())} account={ctx?.account} onOpen={openProject} empty="当前账号还没有发起项目。" chainNow={chainNow} />}
        {screen === 'history' && <History events={events} projects={projects} onRefresh={() => loadEvents()} />}
      </main>
      <Footer />
    </div>
  );
}

function Header({ screen, onNavigate, ctx, busy, accounts, demoAccount, onDemoChange, onMetaMask, config, onRefresh }: {
  screen: Screen; onNavigate: (screen: Screen) => void; ctx: ChainContext | null; busy: boolean; accounts: string[];
  demoAccount: string; onDemoChange: (account: string) => void; onMetaMask: () => void; config: RuntimeConfig; onRefresh: () => void;
}) {
  const links: { id: Screen; label: string }[] = [
    { id: 'lobby', label: '项目大厅' }, { id: 'mine', label: '我的投资' }, { id: 'created', label: '我的发起' }, { id: 'history', label: '链上记录' },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
        <button className="flex items-center gap-3" onClick={() => onNavigate('lobby')} aria-label="返回项目大厅">
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-brand to-[#9b75f7] text-xl font-bold text-white shadow-lg shadow-violet-200">共</span>
          <span className="text-left"><span className="block text-[15px] font-extrabold tracking-wide text-ink">共识</span><span className="block text-[10px] font-semibold tracking-[.18em] text-muted">CROWDFUNDING</span></span>
        </button>
        <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto pb-0.5 md:order-none md:w-auto">
          {links.map((link) => <button key={link.id} onClick={() => onNavigate(link.id)} className={`nav-link whitespace-nowrap ${screen === link.id || (screen === 'detail' && link.id === 'lobby') ? 'nav-link-active' : ''}`}>{link.label}</button>)}
        </nav>
        <div className="flex items-center gap-2">
          {config.demoEnabled && <select aria-label="选择本地演示账号" value={demoAccount} onChange={(event) => onDemoChange(event.target.value)} disabled={busy || !accounts.length}
            className="max-w-[150px] rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink outline-none focus:border-brand">
            {accounts.map((account, index) => <option key={account} value={account}>模拟账号 {String.fromCharCode(65 + index)} · {shortAddress(account)}</option>)}
          </select>}
          <button onClick={onMetaMask} disabled={busy} className="hidden rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-ink transition hover:border-violet-200 hover:bg-violet-50 sm:block">
            {ctx?.mode === 'metamask' ? shortAddress(ctx.account) : '连接 MetaMask'}
          </button>
          <button onClick={onRefresh} disabled={busy} className="rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-bold text-muted transition hover:border-violet-200 hover:text-brand" title="从本地 RPC 刷新链上数据" aria-label="刷新链上数据">↻</button>
          <div className="hidden items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="text-xs font-bold text-ink">{ctx?.mode === 'demo' ? '演示模式' : '已连接'}</span></div>
        </div>
      </div>
    </header>
  );
}

function Notice({ notice, onClose }: { notice: { type: 'success' | 'error' | 'info'; text: string; hash?: string }; onClose: () => void }) {
  const style = notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-blue-200 bg-blue-50 text-blue-800';
  return <div role="status" className={`mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${style}`}>
    <span className="mt-0.5 font-bold">{notice.type === 'success' ? '✓' : notice.type === 'error' ? '!' : '…'}</span>
    <div className="min-w-0 flex-1"><p>{notice.text}</p>{notice.hash && <p className="mt-1 break-all font-mono text-[11px] opacity-75">交易哈希：{notice.hash}</p>}</div>
    <button className="px-1 font-bold opacity-60 hover:opacity-100" onClick={onClose} aria-label="关闭提示">×</button>
  </div>;
}

function Lobby({ projects, total, filter, setFilter, search, setSearch, loading, onCreate, onOpen, chainNow }: {
  projects: Project[]; total: { projects: number; raised: bigint; active: number }; filter: Filter; setFilter: (filter: Filter) => void;
  search: string; setSearch: (value: string) => void; loading: boolean; onCreate: () => void; onOpen: (id: number) => void; chainNow: number;
}) {
  const filters: { id: Filter; label: string }[] = [
    { id: 'All', label: '全部项目' }, { id: 'Funding', label: '筹款中' }, { id: 'Voting', label: '投票中' },
    { id: 'Approved', label: '待放款' }, { id: 'Failed', label: '筹款失败' }, { id: 'Rejected', label: '退款开放' }, { id: 'Released', label: '已放款' },
  ];
  return <>
    <section className="hero-panel relative overflow-hidden rounded-[30px] px-6 py-8 md:px-10 md:py-10">
      <div className="relative z-10 max-w-2xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> COMMUNITY FUNDED, COMMUNITY DECIDED</div>
        <h1 className="text-[32px] font-extrabold leading-[1.18] tracking-tight text-ink md:text-[46px]">好想法，值得<br className="md:hidden" />一起成真<span className="text-brand">。</span></h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted md:text-base">支持你相信的项目。每一笔资金都由合约托管，筹款成功后还要经过支持者加权投票，才能交到发起人手中。</p>
        <div className="mt-6 flex flex-wrap gap-3"><button className="btn-primary" onClick={onCreate}>＋ 发起一个项目</button><a href="#projects" className="btn-secondary">探索项目 <span aria-hidden="true">↘</span></a></div>
        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted"><span>✓ 资金由链上合约托管</span><span>✓ 支持者决定资金释放</span><span>✓ 完全本地模拟</span></div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><span>◎</span><small>共识<br/>放款</small></div><div className="art-dot dot-one">↗</div><div className="art-dot dot-two">✓</div><div className="art-dot dot-three">Ξ</div></div>
    </section>
    <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard label="链上项目" value={String(total.projects).padStart(2, '0')} icon="▦" note="所有项目公开可查" />
      <StatCard label="累计筹集" value={eth(total.raised, 2)} icon="◉" note="仅统计当前本地链" />
      <StatCard label="进行中" value={String(total.active).padStart(2, '0')} icon="↗" note="筹款或投票阶段" />
    </section>
    <section id="projects" className="mt-10 scroll-mt-28">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="section-kicker">ON-CHAIN PROJECTS</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight">发现值得支持的项目</h2><p className="mt-1 text-sm text-muted">透明筹款，社区共同决定每一笔资金的去向。</p></div>
        <label className="relative"><span className="sr-only">搜索项目</span><span className="pointer-events-none absolute left-3 top-2.5 text-muted">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-line bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand sm:w-56" placeholder="搜索项目" /></label>
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{filters.map((item) => <button key={item.id} className={`filter-chip ${filter === item.id ? 'filter-chip-active' : ''}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div className="h-72 animate-pulse rounded-3xl bg-slate-200/60"/><div className="h-72 animate-pulse rounded-3xl bg-slate-200/60"/><div className="h-72 animate-pulse rounded-3xl bg-slate-200/60"/></div>
        : projects.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map((project, index) => <ProjectCard key={project.id} project={project} index={index} onOpen={onOpen} chainNow={chainNow} />)}</div>
          : <EmptyState title="暂时没有符合条件的项目" action="查看全部项目" onAction={() => { setFilter('All'); setSearch(''); }} />}
    </section>
  </>;
}

function StatCard({ label, value, icon, note }: { label: string; value: string; icon: string; note: string }) {
  return <div className="stat-card"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-muted">{label}</span><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-lg text-brand">{icon}</span></div><p className="mt-3 text-[25px] font-extrabold tracking-tight text-ink">{value}</p><p className="mt-1 text-xs text-muted">{note}</p></div>;
}

function ProjectCard({ project, index, onOpen, chainNow }: { project: Project; index: number; onOpen: (id: number) => void; chainNow: number }) {
  const progress = Math.min(100, Number(project.raised * 10000n / project.goal) / 100);
  const deadline = project.status === 'Voting' ? project.fundingDeadline + project.votingDuration : project.fundingDeadline;
  const left = Math.max(0, deadline - chainNow);
  const art = ['project-art-violet', 'project-art-blue', 'project-art-peach'][index % 3];
  return <article className="project-card group cursor-pointer" onClick={() => onOpen(project.id)}>
    <div className={`project-card-art ${art}`}><div className="flex items-start justify-between"><span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-bold tracking-wide text-ink/70">链上众筹 · #{String(project.id + 1).padStart(3, '0')}</span><StatusBadge status={project.status} /></div><div className="art-symbol">{index % 3 === 0 ? '✳' : index % 3 === 1 ? '⌂' : '✦'}</div></div>
    <div className="p-5"><h3 className="line-clamp-1 text-[17px] font-extrabold text-ink transition group-hover:text-brand">{project.name}</h3><p className="mt-2 line-clamp-2 min-h-10 text-[13px] leading-5 text-muted">{project.description}</p>
      <div className="mt-4 flex items-center justify-between text-[11px] text-muted"><span>发起人 <span className="ml-1 font-mono text-ink/70">{shortAddress(project.creator)}</span></span><span>{remaining(left)}</span></div>
      <div className="mt-3 flex items-end justify-between"><span className="text-sm font-extrabold text-ink">{eth(project.raised, 2)} <span className="font-normal text-muted">已筹</span></span><span className="text-xs font-bold text-brand">{progress.toFixed(1)}%</span></div>
      <div className="progress-track mt-2"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted"><span>目标 {eth(project.goal, 2)}</span><span>{project.status === 'Voting' ? `投票截止 ${dateTime(deadline)}` : `截止 ${dateTime(project.fundingDeadline)}`}</span></div>
      {project.status === 'Voting' && <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs"><span className="font-semibold text-amber-800">支持者正在投票决定放款</span><span className="font-bold text-amber-800">赞成 {eth(project.yesWeight, 2)}</span></div>}
    </div>
  </article>;
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70"/>{statusLabel[status]}</span>;
}

function CreateProject({ onSubmit, onCancel, busy }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void; busy: boolean }) {
  return <section className="mx-auto max-w-3xl">
    <button className="mb-5 text-sm font-semibold text-muted transition hover:text-brand" onClick={onCancel}>← 返回项目大厅</button>
    <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-card">
      <div className="bg-gradient-to-r from-[#f0edff] via-white to-[#eef5ff] px-6 py-7 md:px-9"><p className="section-kicker">START SOMETHING GOOD</p><h1 className="mt-1 text-2xl font-extrabold">发起一个众筹项目</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted">清楚描述你的目标和计划。筹款成功后，支持者会共同投票决定是否向你释放资金。</p></div>
      <form onSubmit={onSubmit} className="space-y-5 px-6 py-7 md:px-9" aria-label="创建众筹项目">
        <Field label="项目名称" help="最多 80 个字符"><input name="name" required maxLength={80} placeholder="例如：为社区建一个共享花园" className="form-input" /></Field>
        <Field label="项目简介" help="说明项目目标、计划和预算用途，最多 2,000 个字符"><textarea name="description" required maxLength={2000} rows={5} placeholder="介绍一下这个项目为什么值得支持……" className="form-input resize-y" /></Field>
        <div className="grid gap-5 sm:grid-cols-3"><Field label="筹款目标（ETH）"><input name="goal" required type="number" min="0.000000000000000001" step="any" placeholder="例如 5" className="form-input" /></Field><Field label="筹款时长（小时）"><input name="fundingHours" required type="number" min="0.01" step="any" defaultValue="72" className="form-input" /></Field><Field label="投票时长（小时）"><input name="votingHours" required type="number" min="0.01" step="any" defaultValue="24" className="form-input" /></Field></div>
        <div className="flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800"><span className="text-base">ⓘ</span><p>发起项目会产生链上交易。筹款达到目标后，资金将继续由合约保管，直到投票期结束且赞成票权重超过总筹款额的 50%。</p></div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5"><button type="button" className="btn-secondary" onClick={onCancel}>取消</button><button type="submit" disabled={busy} className="btn-primary">{busy ? '等待确认…' : '创建项目并上链'} <span>→</span></button></div>
      </form>
    </div>
  </section>;
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-bold text-ink">{label}</span>{children}{help && <span className="mt-1.5 block text-[11px] text-muted">{help}</span>}</label>;
}

function ProjectDetail({ project, account, busy, onBack, onInvest, onVote, onWithdraw, onRefund, chainNow }: {
  project: Project; account?: string; busy: boolean; onBack: () => void; onInvest: (amount: string) => void; chainNow: number;
  onVote: (support: boolean) => void; onWithdraw: () => void; onRefund: () => void;
}) {
  const [amount, setAmount] = useState('0.1');
  const progress = Math.min(100, Number(project.raised * 10000n / project.goal) / 100);
  const votingDeadline = project.fundingDeadline + project.votingDuration;
  const actionOpen = project.status === 'Funding' && chainNow < project.fundingDeadline;
  const voteOpen = project.status === 'Voting';
  const votesTotal = project.yesWeight + project.noWeight;
  const yesPercent = votesTotal > 0n ? Number(project.yesWeight * 10000n / votesTotal) / 100 : 0;
  const raisedPercent = project.raised > 0n ? Number(project.yesWeight * 10000n / project.raised) / 100 : 0;
  const creator = account?.toLowerCase() === project.creator.toLowerCase();
  return <section>
    <button className="mb-5 text-sm font-semibold text-muted transition hover:text-brand" onClick={onBack}>← 返回项目大厅</button>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,.8fr)]">
      <div className="space-y-5">
        <div className="detail-art"><div className="relative z-10 flex items-start justify-between"><span className="rounded-full bg-white/75 px-3 py-1.5 text-[11px] font-bold text-ink/70">项目 #{String(project.id + 1).padStart(3, '0')}</span><StatusBadge status={project.status} /></div><div className="detail-art-symbol">✳</div></div>
        <div className="rounded-3xl border border-line bg-white p-6 shadow-card md:p-8"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="section-kicker">PROJECT DETAILS</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">{project.name}</h1></div><button className="btn-secondary !px-3 !py-2 text-xs" onClick={() => navigator.clipboard?.writeText(project.creator)}>复制发起人地址</button></div>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-muted">{project.description}</p>
          <div className="mt-6 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"><InfoItem label="项目发起人" value={project.creator} mono /><InfoItem label="筹款截止" value={dateTime(project.fundingDeadline)} /><InfoItem label="投票截止" value={dateTime(votingDeadline)} /><InfoItem label="项目状态" value={statusLabel[project.status]} /></div>
        </div>
        <div className="rounded-3xl border border-line bg-white p-6 shadow-card md:p-8"><div className="flex items-end justify-between gap-3"><div><p className="section-kicker">COMMUNITY VOTE</p><h2 className="mt-1 text-xl font-extrabold">支持者放款投票</h2></div>{voteOpen && <span className="text-xs font-semibold text-muted">{remaining(Math.max(0, votingDeadline - chainNow))}</span>}</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-800">赞成权重</p><p className="mt-1 text-xl font-extrabold text-emerald-900">{eth(project.yesWeight, 3)}</p></div><div className="rounded-2xl bg-rose-50 p-4"><p className="text-xs font-semibold text-rose-800">反对权重</p><p className="mt-1 text-xl font-extrabold text-rose-900">{eth(project.noWeight, 3)}</p></div></div>
          <div className="mt-4 flex justify-between text-xs text-muted"><span>赞成占已投票权重 {yesPercent.toFixed(1)}%</span><span>放款门槛 {'> 50%'} 总筹款</span></div><div className="progress-track mt-2 h-2.5"><div className="progress-fill !bg-emerald-500" style={{ width: `${Math.min(100, raisedPercent)}%` }} /></div><p className="mt-2 text-[11px] text-muted">当前赞成权重占总筹款额 {raisedPercent.toFixed(1)}%；必须严格超过 50% 才能提款。</p>
          <div className="mt-5 rounded-2xl border border-line px-4 py-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold text-ink">你的投票状态</span><span className={project.voted ? 'font-bold text-emerald-700' : 'text-muted'}>{project.voted ? '已投票 · 每个账号仅一次' : project.contributed > 0n ? '尚未投票' : '你尚未支持此项目'}</span></div><p className="mt-1 text-[11px] text-muted">你的投资权重：{eth(project.contributed, 3)}</p></div>
          {voteOpen && project.contributed > 0n && !project.voted && <div className="mt-4 grid grid-cols-2 gap-3"><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50" onClick={() => onVote(true)}>✓ 投赞成票</button><button disabled={busy} className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50" onClick={() => onVote(false)}>✕ 投反对票</button></div>}
          {!voteOpen && ['Approved', 'Rejected', 'Released'].includes(project.status) && <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${project.status === 'Approved' || project.status === 'Released' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{project.status === 'Approved' ? '投票通过。发起人可以提取资金。' : project.status === 'Released' ? '投票通过，资金已由发起人提取。' : '投票未通过，支持者可以分别申请退款。'}</div>}
        </div>
      </div>
      <aside className="space-y-5">
        <div className="rounded-3xl border border-line bg-white p-6 shadow-card"><p className="section-kicker">FUNDING PROGRESS</p><p className="mt-2 text-3xl font-extrabold tracking-tight">{eth(project.raised, 3)}</p><p className="mt-1 text-sm text-muted">已筹集 · 目标 {eth(project.goal, 3)}</p><div className="mt-4 progress-track h-2.5"><div className="progress-fill" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex justify-between text-xs"><span className="font-bold text-brand">{progress.toFixed(1)}%</span><span className="text-muted">{remaining(Math.max(0, (voteOpen ? votingDeadline : project.fundingDeadline) - chainNow))}</span></div>
          {actionOpen && <form className="mt-5 border-t border-line pt-5" onSubmit={(event) => { event.preventDefault(); if (Number(amount) > 0) onInvest(amount); }}><label className="block text-xs font-bold text-ink">使用测试 ETH 支持项目</label><div className="mt-2 flex gap-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" step="any" min="0.000000000000000001" className="form-input !py-2.5" aria-label="投资金额 ETH"/><button className="btn-primary !px-4" disabled={busy || !amount || Number(amount) <= 0}>支持项目</button></div><p className="mt-2 text-[11px] text-muted">金额必须大于 0。你可以多次投资，权重会累计。</p></form>}
          {creator && project.status === 'Approved' && <div className="mt-5 border-t border-line pt-5"><button disabled={busy} className="btn-primary w-full justify-center" onClick={onWithdraw}>提取筹款 {eth(project.raised, 2)}</button><p className="mt-2 text-center text-[11px] text-muted">资金由合约发送至发起人钱包。</p></div>}
          {project.contributed > 0n && (project.status === 'Failed' || project.status === 'Rejected') && <div className="mt-5 border-t border-line pt-5"><button disabled={busy} className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50" onClick={onRefund}>申请退款 · {eth(project.contributed, 3)}</button><p className="mt-2 text-center text-[11px] text-muted">退款直接由合约退回当前钱包。</p></div>}
          {!actionOpen && project.status === 'Funding' && <p className="mt-5 rounded-xl bg-slate-50 px-3 py-3 text-xs leading-5 text-muted">筹款期限已到，项目状态会在链上确认后更新。</p>}
          {project.status === 'Voting' && <p className="mt-5 rounded-xl bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">投资达到目标。投票结束后，合约将按赞成权重自动决定提款或退款资格。</p>}
        </div>
        <div className="rounded-3xl border border-line bg-white p-6 shadow-card"><p className="section-kicker">PROJECT SNAPSHOT</p><div className="mt-4 space-y-4"><InfoItem label="已筹 / 目标" value={`${progress.toFixed(1)}%`} /><InfoItem label="赞成 / 总筹款" value={`${raisedPercent.toFixed(1)}%`} /><InfoItem label="我的累计支持" value={eth(project.contributed, 4)} /><InfoItem label="我的投票" value={project.voted ? '已完成' : '未投票'} /></div></div>
      </aside>
    </div>
  </section>;
}

function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><p className="text-[11px] font-semibold text-muted">{label}</p><p className={`mt-1 break-all text-xs font-bold text-ink ${mono ? 'font-mono' : ''}`}>{value}</p></div>;
}

function PersonalProjects({ title, description, projects, account, onOpen, empty, chainNow }: {
  title: string; description: string; projects: Project[]; account?: string; onOpen: (id: number) => void; empty: string; chainNow: number;
}) {
  return <section><div className="mb-6"><p className="section-kicker">YOUR ACTIVITY</p><h1 className="mt-1 text-2xl font-extrabold">{title}</h1><p className="mt-1 text-sm text-muted">{description}</p>{account && <p className="mt-2 font-mono text-xs text-muted">{account}</p>}</div>
    {projects.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map((project, index) => <ProjectCard key={project.id} project={project} index={index} onOpen={onOpen} chainNow={chainNow} />)}</div> : <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-lg text-muted">⌂</div><p className="mt-4 font-bold text-ink">{empty}</p><p className="mt-1 text-sm text-muted">切换其他本地账号，或从项目大厅开始体验。</p></div>}
  </section>;
}

function History({ events, projects, onRefresh }: { events: ChainEvent[]; projects: Project[]; onRefresh: () => void }) {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return <section><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="section-kicker">VERIFIED ON LOCAL CHAIN</p><h1 className="mt-1 text-2xl font-extrabold">链上交易记录</h1><p className="mt-1 text-sm text-muted">记录来自本地 RPC 的合约事件，不生成模拟交易。</p></div><button className="btn-secondary" onClick={onRefresh}>↻ 刷新记录</button></div>
    <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card"><div className="hidden grid-cols-[130px_minmax(140px,1fr)_minmax(125px,.7fr)_145px_90px] gap-3 border-b border-line bg-slate-50 px-5 py-3 text-[11px] font-bold text-muted md:grid"><span>事件</span><span>关联项目</span><span>钱包地址</span><span>金额 / 内容</span><span>区块</span></div>
      {events.length ? events.map((event) => <div key={`${event.hash}-${event.name}`} className="grid gap-2 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[130px_minmax(140px,1fr)_minmax(125px,.7fr)_145px_90px] md:items-center md:gap-3">
        <div className="flex items-center justify-between md:block"><span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-brand">{event.label}</span><span className="text-xs text-muted md:hidden">区块 {event.blockNumber}</span></div>
        <div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{names.get(event.projectId) ?? `项目 #${event.projectId + 1}`}</p><p className="mt-0.5 text-[10px] text-muted">{event.detail ?? `项目 #${event.projectId + 1}`}</p></div>
        <div className="font-mono text-xs text-muted" title={event.account}>{shortAddress(event.account)}</div>
        <div className="text-xs font-bold text-ink">{event.amount !== undefined ? eth(event.amount, 5) : '—'}{event.detail === '赞成' || event.detail === '反对' ? ` · ${event.detail}` : ''}<p className="mt-1 truncate font-mono text-[10px] font-normal text-muted" title={event.hash}>{shortAddress(event.hash)}</p></div>
        <div className="hidden text-xs text-muted md:block"><p>{event.blockNumber}</p><p className="mt-1 text-[10px]">{event.timestamp ? dateTime(event.timestamp) : ''}</p></div>
      </div>) : <div className="px-6 py-16 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-lg text-muted">↗</div><p className="mt-4 font-bold text-ink">还没有链上操作</p><p className="mt-1 text-sm text-muted">创建项目、投资或投票后，相关合约事件会显示在这里。</p></div>}
    </div>
  </section>;
}

function EmptyState({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><p className="font-bold text-ink">{title}</p><button className="btn-secondary mt-4" onClick={onAction}>{action}</button></div>;
}

function Footer() {
  return <footer className="border-t border-line bg-white"><div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-2 px-5 py-5 text-[11px] text-muted md:px-8"><span>共识 · 去中心化众筹演示 DApp</span><span>课程实验环境 · Chain ID 31337 · 不连接主网</span></div></footer>;
}

export default App;
