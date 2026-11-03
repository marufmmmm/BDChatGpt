import { useEffect, useState } from 'react';
import {
  ArrowDownToLine, Clock3, FileText, FolderOpen, ImageIcon,
  MoreHorizontal, Settings, Trash2, Zap,
} from 'lucide-react';
import { seedAssets, type Asset, type CreditTransaction } from '@/lib/types';
import { fetchCreditTransactions, fetchProfileCredits } from '@/lib/ai-api';

export function UsagePage() {
  const [assets, setAssets] = useState<Asset[]>(seedAssets);
  const [credits, setCredits] = useState({ free: 0, paid: 0, used: 0 });
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);

  useEffect(() => {
    fetchProfileCredits().then(setCredits);
    fetchCreditTransactions(20).then(setTransactions);
  }, []);

  const totalRemaining = credits.free + credits.paid;

  return (
    <div className="animate-in">
      <PageTitle title="Usage & storage" desc="Keep track of your credits, files, and generated images." />
      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <MetricCard label="Available credits" value={String(totalRemaining)} detail="remaining" icon={Zap} tone="amber" progress={totalRemaining > 0 ? Math.min(100, (totalRemaining / 100) * 100) : 0} />
        <MetricCard label="Credits used" value={String(credits.used)} detail="lifetime" icon={Clock3} tone="pink" progress={credits.used > 0 ? Math.min(100, (credits.used / (credits.used + totalRemaining)) * 100) : 0} />
        <MetricCard label="Storage used" value="45 MB" detail="of 100 MB" icon={FolderOpen} tone="emerald" progress={45} />
      </div>

      {/* Credit history */}
      <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200/80 bg-white card-shadow">
        <div className="border-b border-slate-100 p-6">
          <h2 className="heading text-lg font-extrabold">Credit history</h2>
          <p className="mt-1 text-sm text-slate-500">Recent credit charges and top-ups</p>
        </div>
        {transactions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No transactions yet. Start chatting to see your usage here.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center gap-4 p-4">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tx.mode === 'topup' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
                  <Zap size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800">
                    {tx.mode === 'topup' ? 'Credit top-up' : `${tx.model ?? 'Unknown model'} · ${tx.mode}`}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {tx.provider && `${tx.provider} · `}
                    {tx.total_tokens != null && tx.total_tokens > 0 ? `${tx.total_tokens} tokens · ` : ''}
                    {new Date(tx.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold ${tx.mode === 'topup' ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {tx.mode === 'topup' ? '+' : '-'}{tx.credits_charged}
                  </div>
                  <div className="text-[10px] text-slate-400">credits</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tx.status === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                  {tx.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-3xl border border-amber-100 bg-amber-50 p-5">
        <div className="flex gap-3">
          <div className="mt-0.5 text-amber-600"><Clock3 size={20} /></div>
          <div>
            <div className="font-bold text-amber-900">Your files are on a 30-day clock</div>
            <p className="mt-1 text-sm leading-6 text-amber-800/80">Download anything you want to keep. Files and images are automatically deleted after 30 days, while your chat text stays safe.</p>
          </div>
        </div>
      </div>
      <AssetTable assets={assets} onDelete={id => setAssets(a => a.filter(x => x.id !== id))} />
      <div className="mt-6 rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="heading text-lg font-extrabold">Automatic cleanup</h2>
            <p className="mt-1 text-sm text-slate-500">We run cleanup daily at 00:00 UTC. You'll get a reminder one day before expiry.</p>
          </div>
          <button className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
            <Settings size={16} /> Manage reminders
          </button>
        </div>
      </div>
    </div>
  );
}

export function PageTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-8">
      <h1 className="heading text-3xl font-extrabold">{title}</h1>
      <p className="mt-2 text-slate-500">{desc}</p>
    </div>
  );
}

export function MetricCard({ label, value, detail, icon: Icon, tone, progress }: {
  label: string; value: string; detail: string; icon: typeof FolderOpen; tone: string; progress: number;
}) {
  const colors: Record<string, string> = { emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', pink: 'bg-pink-50 text-pink-600' };
  const bars: Record<string, string> = { emerald: 'bg-emerald-400', amber: 'bg-amber-400', pink: 'bg-pink-400' };
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 card-shadow">
      <div className="mb-6 flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[tone]}`}><Icon size={18} /></div>
        <MoreHorizontal size={18} className="text-slate-300" />
      </div>
      <div className="text-sm font-semibold text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="heading text-2xl font-extrabold">{value}</span>
        <span className="text-xs text-slate-400">{detail}</span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bars[tone]}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export function AssetTable({ assets, onDelete }: { assets: Asset[]; onDelete: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white card-shadow">
      <div className="border-b border-slate-100 p-6">
        <h2 className="heading text-lg font-extrabold">Your stored items</h2>
        <p className="mt-1 text-sm text-slate-500">Uploaded files and generated images</p>
      </div>
      <div className="divide-y divide-slate-100">
        {assets.map(asset => (
          <div key={asset.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${asset.kind === 'image' ? 'bg-pink-50 text-pink-500' : 'bg-indigo-50 text-indigo-500'}`}>
              {asset.kind === 'image' ? <ImageIcon size={18} /> : <FileText size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-800">{asset.name}</div>
              <div className="mt-1 text-xs text-slate-400">{asset.size} · Added {asset.uploaded}</div>
            </div>
            <div className={`text-xs font-bold ${asset.days <= 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {asset.days} days left
              <span className="mt-1 block font-medium text-slate-400">Expires {asset.expires}</span>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-indigo-600"><ArrowDownToLine size={16} /></button>
              <button onClick={() => onDelete(asset.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
