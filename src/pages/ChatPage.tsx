import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Bot, Check, ChevronDown, Paperclip, Send, Sparkles, UserRound, X, Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { type AIModel } from '@/lib/types';
import { fetchModels, fetchProfileCredits, purchaseCredits, sendChatRequest, type ChatResponse } from '@/lib/ai-api';

export function ChatPage() {
  const { id } = useParams();
  const [message, setMessage] = useState('');
  const [selectedMode, setSelectedMode] = useState<'auto' | 'manual'>('auto');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [models, setModels] = useState<AIModel[]>([]);
  const [chatCredits, setChatCredits] = useState(100);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; model?: string; credits?: number }[]>([
    { role: 'assistant', content: 'Hello আহমেদ. I\'m ready when you are. What would you like to work on today?' },
  ]);
  const [file, setFile] = useState<string | null>(null);
  const [creditError, setCreditError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels().then(setModels);
    fetchProfileCredits().then(c => setChatCredits(c.free + c.paid));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(`bdchat-messages-${id}`);
    if (stored) {
      try { setMessages(JSON.parse(stored)); } catch { /* keep default */ }
    }
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Group models by provider_label for the selector
  const groupedModels = models.reduce<Record<string, AIModel[]>>((acc, m) => {
    const key = m.provider_label ?? 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const currentModel = models.find(m => m.id === selectedModelId);
  const displayLabel = selectedMode === 'auto'
    ? 'Smart AI'
    : currentModel?.display_name ?? 'Smart AI';

  const send = async () => {
    if (!message.trim() || generating) return;
    setCreditError('');
    setGenerating(true);

    const chatMessages = [
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: message.trim() },
    ];

    const { data, error } = await sendChatRequest({
      messages: chatMessages,
      mode: selectedMode,
      selectedModel: selectedMode === 'manual' ? (selectedModelId ?? undefined) : undefined,
    });

    if (error) {
      setCreditError(error);
      setGenerating(false);
      if (error.includes('Insufficient credits')) setShowBuyCredits(true);
      return;
    }

    if (data) {
      setLastResponse(data);
      setChatCredits(data.credits.remaining);
      const text = message.trim();
      setMessages(m => {
        const next = [
          ...m,
          { role: 'user' as const, content: text, model: data.model, credits: data.credits.charged },
          { role: 'assistant' as const, content: data.content, model: data.model, credits: data.credits.charged },
        ];
        localStorage.setItem(`bdchat-messages-${id}`, JSON.stringify(next));
        return next;
      });
      setMessage('');
    }
    setGenerating(false);
  };

  return (
    <div className="animate-in mx-auto flex h-[calc(100vh-160px)] max-w-5xl flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="heading text-2xl font-extrabold">Chat with AI</h1>
          <p className="mt-1 text-sm text-slate-500">Just ask — Smart AI picks the best model for you.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Credit balance */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <Zap size={15} className="text-amber-500" />
            <span className="text-sm font-bold text-slate-700">{chatCredits}</span>
            <span className="text-xs text-slate-400">credits</span>
            <button onClick={() => setShowBuyCredits(true)} className="ml-1 text-xs font-bold text-indigo-600 hover:text-indigo-700">Buy more</button>
          </div>

          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm font-bold text-slate-700 shadow-sm transition hover:border-indigo-300"
            >
              {selectedMode === 'auto' && <Sparkles size={15} className="text-indigo-500" />}
              {displayLabel}
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-slate-400" />
            </button>

            {showModelPicker && (
              <>
                <button className="fixed inset-0 z-10" onClick={() => setShowModelPicker(false)} />
                <div className="absolute right-0 top-12 z-20 w-72 rounded-2xl border border-slate-200 bg-white py-2 shadow-2xl">
                  {/* Auto option */}
                  <button
                    onClick={() => { setSelectedMode('auto'); setSelectedModelId(null); setShowModelPicker(false); }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${selectedMode === 'auto' ? 'bg-indigo-50' : ''}`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500 text-white">
                      <Sparkles size={15} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-slate-800">Smart AI</div>
                      <div className="text-[11px] text-slate-400">Best model picked automatically</div>
                    </div>
                    {selectedMode === 'auto' && <Check size={16} className="text-indigo-600" />}
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  {/* Grouped models by provider */}
                  {Object.entries(groupedModels).map(([providerLabel, providerModels]) => {
                    if (!providerModels || providerModels.length === 0) return null;
                    return (
                      <div key={providerLabel}>
                        <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {providerLabel}
                        </div>
                        {providerModels.map(m => {
                          const isSelected = selectedMode === 'manual' && selectedModelId === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => { setSelectedMode('manual'); setSelectedModelId(m.id); setShowModelPicker(false); }}
                              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 ${isSelected ? 'bg-indigo-50' : ''}`}
                            >
                              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-600">
                                {m.display_name.slice(0, 2)}
                              </div>
                              <div className="flex-1">
                                <div className="text-sm font-semibold text-slate-800">{m.display_name}</div>
                                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                  <Zap size={9} className="text-amber-500" />
                                  {m.minimum_credits}+ credits/msg
                                </div>
                              </div>
                              {isSelected && <Check size={15} className="text-indigo-600" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Last response info bar */}
      {lastResponse && !generating && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs shadow-sm">
          <span className="font-bold text-slate-700">Used:</span>
          <span className="flex items-center gap-1 text-amber-600">
            <Zap size={11} /> {lastResponse.credits.charged} credits
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600">{lastResponse.model}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">{lastResponse.usage.totalTokens} tokens</span>
        </div>
      )}

      {creditError && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{creditError}</div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-7 overflow-y-auto scrollbar rounded-3xl border border-slate-200/80 bg-white p-5 card-shadow sm:p-8">
        {messages.map((item, i) => (
          <div key={i} className={`flex gap-3 ${item.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.role === 'assistant' ? 'bg-gradient-to-br from-indigo-500 to-pink-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {item.role === 'assistant' ? <Bot size={17} /> : <UserRound size={17} />}
            </div>
            <div className="max-w-[78%]">
              <div className={`rounded-2xl px-4 py-3 text-sm leading-7 ${item.role === 'assistant' ? 'rounded-tl-sm bg-slate-50 text-slate-700' : 'rounded-tr-sm bg-[#111827] text-white'}`}>
                {item.content}
              </div>
              {item.model && item.role === 'assistant' && (
                <div className="mt-1 flex items-center gap-2 px-1 text-[10px] text-slate-400">
                  <span>{item.model}</span>
                  {item.credits && <><span>·</span><span className="flex items-center gap-0.5"><Zap size={8} className="text-amber-500" />{item.credits} credits</span></>}
                </div>
              )}
            </div>
          </div>
        ))}
        {generating && (
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white">
              <Bot size={17} />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
            </div>
          </div>
        )}
        {file && (
          <div className="ml-12 flex max-w-fit items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
            <Paperclip size={14} />{file}
            <button onClick={() => setFile(null)}><X size={14} /></button>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-4">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-50">
          <label className="mb-0.5 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-indigo-600">
            <Paperclip size={19} />
            <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0]?.name ?? null)} />
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message BDChat..."
            rows={1}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button onClick={send} disabled={generating} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-60">
            <Send size={17} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-slate-400">
          <span>Press Enter to send · Shift + Enter for a new line</span>
          <span className="flex items-center gap-1">
            <Sparkles size={11} className="text-indigo-400" />
            {selectedMode === 'auto' ? 'Smart AI — best model selected automatically' : `Using ${currentModel?.display_name ?? 'selected model'}`}
          </span>
        </div>
      </div>

      {showBuyCredits && (
        <BuyCreditsInline credits={chatCredits} onClose={() => setShowBuyCredits(false)} onBuy={async (amount) => { const res = await purchaseCredits(amount); if (res.success) { setChatCredits(res.newBalance); setCreditError(''); } else { setCreditError(res.error ?? 'Purchase failed'); } setShowBuyCredits(false); }} />
      )}
    </div>
  );
}

function BuyCreditsInline({ credits, onClose, onBuy }: { credits: number; onClose: () => void; onBuy: (amount: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-in">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Zap size={20} /></div>
            <div>
              <h2 className="heading text-lg font-extrabold">Buy credits</h2>
              <p className="text-sm text-slate-500">Current balance: {credits} credits · ৳1 = 1 credit</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {chatPacks.map(pack => (
            <button key={pack.amount} onClick={() => setSelected(pack.amount)} className={`relative rounded-2xl border-2 p-4 text-left transition ${selected === pack.amount ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="heading text-xl font-extrabold text-slate-900">{pack.label}</div>
              <div className="mt-1 text-xs text-slate-400">৳1 = 1 credit</div>
              <div className="mt-3"><span className="heading text-2xl font-extrabold text-indigo-600">৳{pack.price.toLocaleString()}</span></div>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Credits are used for both chat and image generation. Each model has a different credit cost. Credits never expire.
        </div>
        <button disabled={!selected} onClick={() => selected && onBuy(selected)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#111827] py-3.5 text-sm font-bold text-white transition hover:bg-indigo-600 disabled:opacity-50">
          {selected ? `Pay ৳${chatPacks.find(p => p.amount === selected)?.price.toLocaleString()}` : 'Select a pack'}
        </button>
      </div>
    </div>
  );
}
