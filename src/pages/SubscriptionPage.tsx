import { useState } from 'react';
import { Check, CreditCard, ShieldCheck, Sparkles, Zap, ImageIcon, X } from 'lucide-react';
import { planDetails, imagePacks, chatPacks, type Plan } from '@/lib/types';
import { purchaseCredits } from '@/lib/ai-api';

export function SubscriptionPage() {
  const [selected, setSelected] = useState<Plan>('Free');
  const [tab, setTab] = useState<'plans' | 'image-credits' | 'chat-credits'>('plans');
  const [purchasing, setPurchasing] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const buyCredits = async (amount: number) => {
    setPurchasing(true);
    setErrorMsg('');
    setSuccessMsg('');
    const res = await purchaseCredits(amount);
    setPurchasing(false);
    if (res.success) {
      setSuccessMsg(`${amount} credits added. New balance: ${res.newBalance} credits.`);
    } else {
      setErrorMsg(res.error ?? 'Purchase failed. Please try again.');
    }
  };

  return (
    <div className="animate-in">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600">
          <Sparkles size={13} />Simple, transparent pricing
        </div>
        <h1 className="heading text-3xl font-extrabold sm:text-4xl">Choose your plan</h1>
        <p className="mt-3 text-slate-500">More models, more space, and more room to make your best work.</p>
      </div>

      {successMsg && (
        <div className="mx-auto mb-6 flex max-w-2xl items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
          <Check size={18} className="text-emerald-500" />
          {successMsg}
          <button onClick={() => setSuccessMsg('')} className="ml-auto"><X size={16} /></button>
        </div>
      )}
      {errorMsg && (
        <div className="mx-auto mb-6 flex max-w-2xl items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <X size={18} className="text-red-500" />
          {errorMsg}
          <button onClick={() => setErrorMsg('')} className="ml-auto"><X size={16} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="mx-auto mb-8 flex max-w-md justify-center gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <TabButton active={tab === 'plans'} onClick={() => setTab('plans')} icon={CreditCard} label="Plans" />
        <TabButton active={tab === 'image-credits'} onClick={() => setTab('image-credits')} icon={ImageIcon} label="Image credits" />
        <TabButton active={tab === 'chat-credits'} onClick={() => setTab('chat-credits')} icon={Zap} label="Chat credits" />
      </div>

      {tab === 'plans' && (
        <>
          <div className="grid gap-4 lg:grid-cols-4">
            {(Object.keys(planDetails) as Plan[]).map(plan => {
              const details = planDetails[plan];
              const active = selected === plan;
              return (
                <div key={plan} onClick={() => setSelected(plan)} className={`relative cursor-pointer rounded-3xl border bg-white p-5 transition hover:-translate-y-1 ${active ? 'border-indigo-500 ring-4 ring-indigo-50' : 'border-slate-200/80'}`}>
                  {plan === 'Pro' && <div className="absolute -top-3 left-5 rounded-full bg-pink-600 px-3 py-1 text-[10px] font-bold text-white">Most popular</div>}
                  <div className="mb-8 flex items-start justify-between">
                    <div>
                      <h2 className="heading text-lg font-extrabold">{plan}</h2>
                      <div className="mt-2">
                        <span className="heading text-2xl font-extrabold">{details.price}</span>
                        <span className="text-xs text-slate-400">/month</span>
                      </div>
                    </div>
                    {active && <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white"><Check size={14} /></div>}
                  </div>
                  <div className="space-y-3 text-sm">
                    <Feature text={`${details.storage} total storage`} />
                    <Feature text={`${details.maxFile} max file size`} />
                    <Feature text={`${details.images} images per month`} />
                    <Feature text="30-day file retention" />
                    <Feature text="Chat history kept indefinitely" />
                  </div>
                  <button className={`mt-8 w-full rounded-xl py-3 text-sm font-bold ${active ? 'bg-[#111827] text-white' : 'border border-slate-200 text-slate-700'}`}>
                    {plan === 'Free' ? 'Current plan' : 'Choose ' + plan}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mx-auto mt-10 flex max-w-3xl items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-500" />
            <p><strong className="text-slate-800">A note about your data:</strong> Every plan includes the same 30-day storage policy. Chat text stays available until you delete it, but uploaded files and generated images are automatically removed after 30 days.</p>
          </div>
        </>
      )}

      {tab === 'image-credits' && (
        <div>
          <div className="mb-6 text-center">
            <h2 className="heading text-xl font-extrabold">Image credit packs</h2>
            <p className="mt-1 text-sm text-slate-500">৳1 = 1 credit. Credits never expire. Use for any AI model.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {imagePacks.map(pack => (
              <div key={pack.id} className="rounded-3xl border border-slate-200/80 bg-white p-5 text-center card-shadow transition hover:-translate-y-1">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-50 text-pink-600 mx-auto"><ImageIcon size={22} /></div>
                <div className="heading text-2xl font-extrabold">{pack.label}</div>
                <div className="mt-1 text-xs text-slate-400">Use for any AI model</div>
                <div className="mt-4"><span className="heading text-3xl font-extrabold text-pink-600">৳{pack.price.toLocaleString()}</span></div>
                <button onClick={() => buyCredits(pack.amount)} disabled={purchasing} className="mt-5 w-full rounded-xl bg-[#111827] py-3 text-sm font-bold text-white transition hover:bg-pink-600 disabled:opacity-60">
                  {purchasing ? 'Processing...' : 'Buy now'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'chat-credits' && (
        <div>
          <div className="mb-6 text-center">
            <h2 className="heading text-xl font-extrabold">Chat credit packs</h2>
            <p className="mt-1 text-sm text-slate-500">৳1 = 1 credit. Each model uses a different number of credits per message. Credits never expire.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {chatPacks.map(pack => (
              <div key={pack.id} className="rounded-3xl border border-slate-200/80 bg-white p-5 text-center card-shadow transition hover:-translate-y-1">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mx-auto"><Zap size={22} /></div>
                <div className="heading text-2xl font-extrabold">{pack.label}</div>
                <div className="mt-1 text-xs text-slate-400">Use for any AI model</div>
                <div className="mt-4"><span className="heading text-3xl font-extrabold text-indigo-600">৳{pack.price.toLocaleString()}</span></div>
                <button onClick={() => buyCredits(pack.amount)} disabled={purchasing} className="mt-5 w-full rounded-xl bg-[#111827] py-3 text-sm font-bold text-white transition hover:bg-indigo-600 disabled:opacity-60">
                  {purchasing ? 'Processing...' : 'Buy now'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof CreditCard; label: string }) {
  return (
    <button onClick={onClick} className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${active ? 'bg-[#111827] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
      <Icon size={16} />{label}
    </button>
  );
}

function Feature({ text }: { text: string }) {
  return <div className="flex items-center gap-2 text-slate-600"><Check size={15} className="text-emerald-500" />{text}</div>;
}
