import { useEffect, useState } from 'react';
import {
  ArrowDownToLine, Clock3, ImageIcon, MoreHorizontal, ShieldCheck,
  Sparkles, Trash2, X, Zap,
} from 'lucide-react';
import { imagePacks, seedAssets, type Asset, type AIModel } from '@/lib/types';
import { fetchModels, fetchProfileCredits, purchaseCredits, sendChatRequest } from '@/lib/ai-api';

export function ImagesPage() {
  const [prompt, setPrompt] = useState('');
  const [assets, setAssets] = useState<Asset[]>(seedAssets.filter(a => a.kind === 'image'));
  const [imageCredits, setImageCredits] = useState(100);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [lastCredits, setLastCredits] = useState<number | null>(null);
  const [creditError, setCreditError] = useState('');
  const [imageModels, setImageModels] = useState<AIModel[]>([]);

  useEffect(() => {
    fetchModels().then(all => {
      setImageModels(all.filter(m => m.supports_image));
    });
    fetchProfileCredits().then(c => setImageCredits(c.free + c.paid));
  }, []);

  const generate = async () => {
    if (!prompt.trim() || generating || imageModels.length === 0) return;

    const isComplex = prompt.length > 80 || /cinematic|detailed|artistic|photorealistic|4k|8k|ultra|masterpiece|intricate|professional/i.test(prompt);
    const model = isComplex
      ? imageModels.find(m => m.tier === 'image_premium' || m.tier === 'image_ultra_hd') ?? imageModels[0]
      : imageModels.find(m => m.tier === 'image_standard') ?? imageModels[0];

    if (imageCredits < model.minimum_credits) {
      setCreditError(`You need ${model.minimum_credits} credits for ${model.display_name}, but you have ${imageCredits}. Buy more credits to continue.`);
      setShowBuyModal(true);
      return;
    }
    setCreditError('');
    setGenerating(true);
    setLastModel(model.display_name);

    const { data, error } = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      mode: 'manual',
      selectedModel: model.id,
    });

    if (error) {
      setCreditError(error);
      setGenerating(false);
      if (error.includes('Insufficient credits')) setShowBuyModal(true);
      return;
    }

    if (data) {
      setImageCredits(data.credits.remaining);
      setLastCredits(data.credits.charged);
      const now = new Date();
      const expiry = new Date(now.getTime() + 30 * 86400000);
      setAssets([{
        id: String(Date.now()),
        kind: 'image',
        name: prompt.slice(0, 26),
        size: (model.tier === 'image_premium' || model.tier === 'image_ultra_hd') ? '3.8 MB' : '2.1 MB',
        uploaded: 'Sep 14, 2026',
        expires: expiry.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
        days: 30,
        prompt,
        model: model.display_name,
        url: data.imageUrl ?? undefined,
      }, ...assets]);
      setPrompt('');
    }
    setGenerating(false);
  };

  return (
    <div className="animate-in">
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-pink-600">
            <Sparkles size={15} />Smart image studio
          </div>
          <h1 className="heading text-3xl font-extrabold">Generate images</h1>
          <p className="mt-2 text-slate-500">Our system picks the best model for your prompt to save you money.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <Zap size={15} className="text-amber-500" />
            <span className="font-bold text-slate-800">{imageCredits}</span>
            <span className="text-slate-400">credits</span>
          </div>
          <button onClick={() => setShowBuyModal(true)} className="flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-pink-700">
            <Zap size={16} /> Buy credits
          </button>
        </div>
      </div>

      {/* Model info bar */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {imageModels.map(model => (
          <div key={model.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
              <ImageIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-slate-800">{model.display_name}</div>
              <p className="mt-0.5 text-xs leading-5 text-slate-400">{model.minimum_credits} credits per image</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="flex items-center gap-1 text-xs font-bold text-slate-600">
                <Zap size={11} className="text-amber-500" />
                {model.minimum_credits}
              </div>
              <div className="text-[10px] text-slate-400">per image</div>
            </div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs shadow-sm">
          <span className="font-bold text-slate-700">Rate:</span>
          <span className="text-slate-500">৳1 = 1 credit</span>
        </div>
      </div>

      {creditError && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{creditError}</div>
      )}

      {/* Prompt area */}
      <div className="mb-9 rounded-3xl bg-gradient-to-br from-[#111827] via-[#1f2545] to-indigo-800 p-5 text-white shadow-xl sm:p-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><ImageIcon size={20} /></div>
            <div>
              <div className="font-bold">Describe your image</div>
              <div className="text-xs text-slate-300">We automatically pick the best model for your prompt to save you money.</div>
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl bg-white p-2 sm:flex-row">
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generate()}
              placeholder="A cinematic rickshaw ride through Old Dhaka at golden hour..."
              className="min-w-0 flex-1 px-3 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              onClick={generate}
              disabled={generating}
              className="flex items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-pink-700 disabled:opacity-60"
            >
              {generating ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Generating...</>
              ) : (
                <><Sparkles size={16} /> Generate</>
              )}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <ShieldCheck size={14} />
            <span>Generated images are stored securely for 30 days, then automatically removed.</span>
            {lastModel && !generating && (
              <span className="ml-auto rounded-full bg-white/10 px-2.5 py-1 font-bold text-indigo-200">
                Last used: {lastModel}{lastCredits != null && ` · ${lastCredits} credits`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="heading text-xl font-extrabold">Your image gallery</h2>
          <p className="mt-1 text-sm text-slate-500">Download anything you want to keep before it expires.</p>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {assets.map(asset => (
          <ImageCard key={asset.id} asset={asset} imageModels={imageModels} onDelete={() => setAssets(a => a.filter(x => x.id !== asset.id))} />
        ))}
      </div>

      {/* Buy modal */}
      {showBuyModal && (
        <BuyImageCreditsModal
          current={imageCredits}
          onClose={() => setShowBuyModal(false)}
          onBuy={async (amount) => { const res = await purchaseCredits(amount); if (res.success) { setImageCredits(res.newBalance); setCreditError(''); } else { setCreditError(res.error ?? 'Purchase failed'); } setShowBuyModal(false); }}
        />
      )}
    </div>
  );
}

function ImageCard({ asset, imageModels, onDelete }: { asset: Asset; imageModels: AIModel[]; onDelete: () => void }) {
  const soon = asset.days <= 5;
  const model = imageModels.find(m => m.display_name === asset.model) ?? imageModels[0];
  const credits = model?.minimum_credits ?? 5;
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white card-shadow">
      <div className="relative flex aspect-[1.35] items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-900 to-pink-700">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,.3),transparent_24%),radial-gradient(circle_at_30%_70%,rgba(236,72,153,.5),transparent_30%)]" />
        <div className="relative text-center text-white">
          <Sparkles className="mx-auto mb-3 text-amber-300" size={25} />
          <div className="max-w-[170px] text-sm font-semibold leading-6">{asset.prompt}</div>
        </div>
        <span className="absolute left-3 top-3 flex items-center gap-1 rounded-lg bg-pink-600/80 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
          <Zap size={9} /> {credits}
        </span>
        <span className="absolute right-3 top-3 rounded-lg bg-black/20 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">
          {asset.model ?? 'Image'}
        </span>
        <button className="absolute bottom-3 right-3 rounded-lg bg-black/20 p-2 text-white backdrop-blur hover:bg-black/40">
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-800">{asset.name}</div>
            <div className="mt-1 text-xs text-slate-400">Generated {asset.uploaded} · {asset.size}</div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${soon ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {soon ? 'Expiring soon' : 'Active'}
          </span>
        </div>
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Clock3 size={14} className={soon ? 'text-amber-500' : 'text-emerald-500'} />
          {asset.days} days remaining · Expires {asset.expires}
        </div>
        <div className="flex gap-2">
          <button className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
            <ArrowDownToLine size={14} /> Download
          </button>
          <button onClick={onDelete} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-100 hover:bg-red-50 hover:text-red-500">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function BuyImageCreditsModal({ current, onClose, onBuy }: { current: number; onClose: () => void; onBuy: (amount: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-in">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 text-pink-600"><ImageIcon size={20} /></div>
            <div>
              <h2 className="heading text-lg font-extrabold">Buy credits</h2>
              <p className="text-sm text-slate-500">Current balance: {current} credits · ৳1 = 1 credit</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {imagePacks.map(pack => (
            <button key={pack.amount} onClick={() => setSelected(pack.amount)} className={`relative rounded-2xl border-2 p-4 text-left transition ${selected === pack.amount ? 'border-pink-500 bg-pink-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="heading text-xl font-extrabold text-slate-900">{pack.label}</div>
              <div className="mt-1 text-xs text-slate-400">৳1 = 1 credit</div>
              <div className="mt-3"><span className="heading text-2xl font-extrabold text-pink-600">৳{pack.price.toLocaleString()}</span></div>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Credits work for both chat and image generation. Credits never expire.
        </div>
        <button disabled={!selected} onClick={() => selected && onBuy(selected)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#111827] py-3.5 text-sm font-bold text-white transition hover:bg-pink-600 disabled:opacity-50">
          {selected ? `Pay ৳${imagePacks.find(p => p.amount === selected)?.price.toLocaleString()}` : 'Select a pack'}
        </button>
      </div>
    </div>
  );
}
