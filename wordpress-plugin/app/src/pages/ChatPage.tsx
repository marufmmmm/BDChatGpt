import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, Check, ChevronDown, Clock, Copy, Globe, Image as ImageIcon, Layers, Link2, Mic, MicOff, Paperclip, Sparkles, ThumbsDown, ThumbsUp, UserCheck, Workflow, Wrench, X, Zap } from 'lucide-react';
import { type AIModel, chatPacks } from '@/lib/types';
import { wpRequest } from '@/lib/wp';
import { Markdown } from '@/components/Markdown';
import { exportExcel, exportPdf, exportWord } from '@/lib/export';
import { parseFileBlocks } from '@/lib/files';
import { FileCard } from '@/components/FileCard';
import { fetchEnvironments, fetchModels, fetchProfileCredits, generateImage, purchaseCredits, streamChat, type ChatEnvironment, type ChatResponse } from '@/lib/ai-api';

const URL_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

/** Turn web addresses in plain text into clickable links. Other text is shown as is. */
function linkify(text: string) {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) {
      return <Fragment key={i}>{part}</Fragment>;
    }
    const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    const url = trailing ? part.slice(0, -trailing.length) : part;
    const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
    return (
      <Fragment key={i}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-[#c96442] underline underline-offset-2 hover:text-[#a8502f]"
        >
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

type ChatMessage = { role: 'user' | 'assistant'; content: string; model?: string; credits?: number; messageId?: number; feedback?: 1 | -1 | 0; imageUrl?: string; debug?: { search: boolean; citations: number; model: string; switch?: string; hint?: string; needs?: string; flags?: string } | null };

/** Tool switches shown in the Tools menu. */
type ToolState = { webSearch: boolean; datetime: boolean; webFetch: boolean; imageGen: boolean; advisor: boolean; fusion: boolean; subagent: boolean };
const DEFAULT_TOOLS: ToolState = { webSearch: true, datetime: false, webFetch: true, imageGen: false, advisor: false, fusion: false, subagent: false };

/** Minimal shape of the browser speech recognition API (Chrome, Edge, Android Chrome). */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechCtor = new () => SpeechRecognitionLike;

type SavedModel = { mode: 'auto' | 'manual'; modelId: string | null; env: string };

/** The model the user picked last time, from this browser. Falls back to Smart AI if nothing valid is saved. */
function loadSavedModel(): SavedModel {
  const fallback: SavedModel = { mode: 'auto', modelId: null, env: 'smart' };
  try {
    const raw = localStorage.getItem('bdchat-model');
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<SavedModel>;
    return {
      mode: v.mode === 'manual' ? 'manual' : 'auto',
      modelId: typeof v.modelId === 'string' ? v.modelId : null,
      env: typeof v.env === 'string' ? v.env : 'smart',
    };
  } catch {
    return fallback;
  }
}

export function ChatPage() {
  const [savedModel] = useState(loadSavedModel);
  const { id } = useParams();
  const navigate = useNavigate();
  // A short numeric id in the URL is a saved server chat; anything else is a new chat kept in this browser.
  const serverThreadId = id && /^\d{1,9}$/.test(id) ? Number(id) : undefined;
  const [threadId, setThreadId] = useState<number | undefined>(serverThreadId);
  useEffect(() => { setThreadId(serverThreadId); }, [id]);
  const [message, setMessage] = useState('');
  const [selectedMode, setSelectedMode] = useState<'auto' | 'manual'>(savedModel.mode);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(savedModel.modelId);
  const [environments, setEnvironments] = useState<ChatEnvironment[]>([{ key: 'smart', name: 'Smart AI' }]);
  const [selectedEnv, setSelectedEnv] = useState<string>(savedModel.env);
  const [replyLanguage, setReplyLanguage] = useState<'auto' | 'bangla' | 'english'>('auto');
  const [models, setModels] = useState<AIModel[]>([]);
  const [chatCredits, setChatCredits] = useState(100);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [creditError, setCreditError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [tools, setTools] = useState<ToolState>(() => {
    try {
      const saved = localStorage.getItem('bdchat-tools-v2');
      if (saved) return { ...DEFAULT_TOOLS, ...JSON.parse(saved) };
    } catch { /* use defaults */ }
    return DEFAULT_TOOLS;
  });
  const [showTools, setShowTools] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [streamStatus, setStreamStatus] = useState('');
  const [streamingNow, setStreamingNow] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels().then(setModels);
    fetchEnvironments().then(setEnvironments);
    fetchProfileCredits().then(c => setChatCredits(c.free + c.paid));
  }, []);

  useEffect(() => {
    if (serverThreadId) {
      // Saved chat: load it from the server so it shows the same on every device.
      wpRequest<{ role: 'user' | 'assistant'; content: string; model?: string | null; credits?: number | null; imageUrl?: string | null }[]>(`threads/${serverThreadId}`)
        .then(rows => setMessages(rows.map(r => ({ role: r.role, content: r.content, model: r.model ?? undefined, credits: r.credits ?? undefined, imageUrl: r.imageUrl ?? undefined }))))
        .catch(() => setMessages([]));
      return;
    }
    // A new chat (no saved thread yet) always starts empty. Never reuse another chat's messages.
    setMessages([]);
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, generating]);

  useEffect(() => {
    try { localStorage.setItem('bdchat-tools-v2', JSON.stringify(tools)); } catch { /* storage blocked */ }
  }, [tools]);

  // Remember the chosen model for the next message and the next visit.
  useEffect(() => {
    try {
      localStorage.setItem('bdchat-model', JSON.stringify({ mode: selectedMode, modelId: selectedModelId, env: selectedEnv }));
    } catch { /* storage blocked */ }
  }, [selectedMode, selectedModelId, selectedEnv]);

  // If the saved model is no longer active, go back to Smart AI so messages still send.
  useEffect(() => {
    if (models.length && selectedMode === 'manual' && selectedModelId && !models.some(m => m.id === selectedModelId)) {
      setSelectedMode('auto');
      setSelectedModelId(null);
    }
  }, [models, selectedMode, selectedModelId]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  // While a reply is being made, show how long it has taken.
  useEffect(() => {
    if (!generating) {
      setWaitSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setWaitSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  // Group models by provider_label for the selector
  const groupedModels = models.reduce<Record<string, AIModel[]>>((acc, m) => {
    const key = m.provider_label ?? 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const currentModel = models.find(m => m.id === selectedModelId);
  const currentEnvName = environments.find(e => e.key === selectedEnv)?.name ?? 'Smart AI';
  const displayLabel = selectedMode === 'auto'
    ? currentEnvName
    : currentModel?.display_name ?? 'Smart AI';

  /** Voice typing: the spoken words go into the box, and the user still reads and sends them. */
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setCreditError('Voice typing needs Chrome, Edge or Android Chrome.');
      return;
    }
    const rec = new Ctor();
    rec.lang = replyLanguage === 'english' ? 'en-US' : 'bn-BD';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const spoken = Array.from(e.results, r => r[0].transcript).join(' ').trim();
      if (spoken) setMessage(m => (m ? `${m} ${spoken}` : spoken));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const send = async () => {
    const text = message.trim();
    if (!text || generating) return;
    recognitionRef.current?.stop();
    setCreditError('');
    setGenerating(true);
    setStreamStatus('');
    setStreamingNow(false);

    const previous = messages;
    // Show the user's message at once; the reply appears below it when ready.
    setMessages([...previous, { role: 'user', content: text }]);
    setMessage('');

    let reply: { data?: ChatResponse; error?: string };
    if (tools.imageGen) {
      // Image Generation: the message is the image prompt, sent to the first active image model.
      const imageModel = models.find(m => m.supports_image);
      reply = imageModel
        ? await generateImage(text, imageModel.id)
        : { error: 'No image model is active yet.' };
    } else {
      let streamed = '';
      reply = await streamChat({
        messages: [
          ...previous.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: text },
        ],
        mode: selectedMode,
        environment: selectedEnv,
        language: replyLanguage,
        selectedModel: selectedMode === 'manual' ? (selectedModelId ?? undefined) : undefined,
        threadId,
        tools: { webSearch: tools.webSearch, datetime: tools.datetime, webFetch: tools.webFetch, advisor: false, fusion: false, subagent: false },
      }, {
        onStatus: (t) => setStreamStatus(t),
        onDelta: (piece) => {
          streamed += piece;
          setStreamingNow(true);
          setMessages(m => {
            const last = m[m.length - 1];
            if (last && last.role === 'assistant') return [...m.slice(0, -1), { ...last, content: streamed }];
            return [...m, { role: 'assistant', content: streamed }];
          });
        },
      });
    }
    const { data, error } = reply;

    if (error || !data) {
      // Give the message back so nothing is lost.
      setMessages(previous);
      setMessage(text);
      setCreditError(error ?? 'Could not get a reply. Please try again.');
      if (error?.includes('Insufficient credits')) setShowBuyCredits(true);
      setGenerating(false);
      return;
    }

    setChatCredits(data.credits.remaining);
    if (data.threadId && data.threadId !== threadId) {
      // The reply created the saved chat: continue in it from now on, and show it in the sidebar.
      setThreadId(data.threadId);
      navigate(`/chat/${data.threadId}`, { replace: true });
    }
    window.dispatchEvent(new Event('bdchat-threads-changed'));
    setMessages(() => {
      const next: ChatMessage[] = [
        ...previous,
        { role: 'user', content: text },
        { role: 'assistant', content: data.content, model: data.model, credits: data.credits.charged, messageId: data.messageId, feedback: 0, imageUrl: data.imageUrl ?? undefined, debug: data.debug ?? null },
      ];
      localStorage.setItem(`bdchat-messages-${id}`, JSON.stringify(next));
      return next;
    });
    setGenerating(false);
  };

  /** Thumbs up/down: tap the same one again to clear it. Saved on the server for this reply. */
  const rate = (index: number, value: 1 | -1) => {
    const item = messages[index];
    if (!item) return;
    const next: 1 | -1 | 0 = item.feedback === value ? 0 : value;
    setMessages(m => {
      const updated = m.map((x, n) => (n === index ? { ...x, feedback: next } : x));
      localStorage.setItem(`bdchat-messages-${id}`, JSON.stringify(updated));
      return updated;
    });
    if (item.messageId) {
      wpRequest('feedback', { method: 'POST', body: { messageId: item.messageId, value: next } }).catch(() => { /* keep the local state */ });
    }
  };

  const copyText = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      /* clipboard blocked by the browser */
    }
  };

  const isEmpty = messages.length === 0 && !generating;

  return (
    <div className="animate-in mx-auto flex h-[calc(100dvh-120px)] max-w-3xl flex-col bg-[#faf9f5] px-3 pt-2 text-[#1f1e1d] sm:h-[calc(100vh-160px)] sm:rounded-3xl sm:px-6 sm:pt-3">
      {/* Top bar: model picker, credits, language */}
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="relative">
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[#1f1e1d] transition hover:bg-[#f0eee6]"
          >
            {selectedMode === 'auto' && <Sparkles size={15} className="text-[#c96442]" />}
            {displayLabel}
            <ChevronDown size={15} className="text-[#6b6a64]" />
          </button>

          {showModelPicker && (
            <>
              <button className="fixed inset-0 z-10 cursor-default" onClick={() => setShowModelPicker(false)} aria-label="Close" />
              <div className="absolute left-0 top-11 z-20 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-[#e8e6dc] bg-white py-2 shadow-xl">
                {environments.map(env => {
                  const active = selectedMode === 'auto' && selectedEnv === env.key;
                  return (
                    <button
                      key={env.key}
                      onClick={() => { setSelectedMode('auto'); setSelectedEnv(env.key); setSelectedModelId(null); setShowModelPicker(false); }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#faf9f5] ${active ? 'bg-[#f0eee6]' : ''}`}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#c96442] text-white">
                        <Sparkles size={15} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-[#1f1e1d]">{env.name}</div>
                        <div className="text-[11px] text-[#6b6a64]">
                          {env.key === 'smart' ? 'Best model picked automatically from all' : 'Best model picked automatically from this provider'}
                        </div>
                      </div>
                      {active && <Check size={16} className="text-[#c96442]" />}
                    </button>
                  );
                })}

                <div className="my-1 border-t border-[#f0eee6]" />

                {Object.entries(groupedModels).map(([providerLabel, providerModels]) => {
                  if (!providerModels || providerModels.length === 0) return null;
                  return (
                    <div key={providerLabel}>
                      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9c9a92]">
                        {providerLabel}
                      </div>
                      {providerModels.map(m => {
                        const isSelected = selectedMode === 'manual' && selectedModelId === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => { setSelectedMode('manual'); setSelectedModelId(m.id); setShowModelPicker(false); }}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#faf9f5] ${isSelected ? 'bg-[#f0eee6]' : ''}`}
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f0eee6] text-[10px] font-bold text-[#1f1e1d]">
                              {m.display_name.slice(0, 2)}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[#1f1e1d]">{m.display_name}</div>
                              <div className="flex items-center gap-1 text-[11px] text-[#6b6a64]">
                                <Zap size={9} className="text-[#c96442]" />
                                {m.minimum_credits}+ credits/msg
                              </div>
                            </div>
                            {isSelected && <Check size={15} className="text-[#c96442]" />}
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

        <div className="flex items-center gap-3 text-xs text-[#6b6a64]">
          <span className="flex items-center gap-1">
            <Zap size={12} className="text-[#c96442]" />
            {chatCredits} credits
          </span>
          <button onClick={() => setShowBuyCredits(true)} className="font-semibold text-[#c96442] hover:text-[#a8502f]">Buy more</button>
          <select
            value={replyLanguage}
            onChange={(e) => setReplyLanguage(e.target.value as 'auto' | 'bangla' | 'english')}
            className="rounded-lg bg-transparent py-1 pl-1 pr-5 text-xs text-[#6b6a64] outline-none hover:bg-[#f0eee6]"
            aria-label="Reply language"
          >
            <option value="auto">Auto</option>
            <option value="bangla">বাংলা</option>
            <option value="english">English</option>
          </select>
        </div>
      </div>

      {creditError && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{creditError}</div>
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="scrollbar flex-1 overflow-y-auto pb-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-7 pt-6">
          {isEmpty && (
            <div className="pt-20 text-center">
              <h1 className="text-3xl font-semibold text-[#1f1e1d]">What can I help you with?</h1>
              <p className="mt-2 text-sm text-[#6b6a64]">{displayLabel} picks the best model for each message.</p>
            </div>
          )}

          {messages.map((item, i) => item.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-line rounded-2xl bg-[#f0eee6] px-4 py-2.5 text-[15px] leading-7 text-[#1f1e1d]">
                {linkify(item.content)}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col">
              {(() => {
                const parsed = parseFileBlocks(item.content);
                return (
                  <>
                    {item.imageUrl && (
                      <img src={item.imageUrl} alt="Generated image" className="mb-3 max-h-[480px] w-auto max-w-full rounded-2xl border border-[#e8e6dc]" />
                    )}
                    {parsed.text && <Markdown text={parsed.text} />}
                    {item.debug && (
                      <div className="mt-2 rounded-lg bg-[#f0eee6] px-3 py-1.5 text-[11px] text-[#6b6a64]">
                        Admin check: search {item.debug.search ? 'on' : 'off'} · switch {item.debug.switch ?? '-'} · keyword {item.debug.hint ?? '-'} · classifier {item.debug.needs ?? '-'} · flags {item.debug.flags ?? '-'} · sources {item.debug.citations} · model {item.debug.model}
                      </div>
                    )}
                    {parsed.files.map((f, n) => <FileCard key={n} file={f} />)}
                  </>
                );
              })()}
              <div className="mt-2 flex items-center gap-1 text-[#6b6a64]">
                <button title="Copy" onClick={() => copyText(item.content, i)} className="rounded-lg p-1.5 transition hover:bg-[#f0eee6]">
                  {copiedIndex === i ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button
                  title="Good response"
                  onClick={() => rate(i, 1)}
                  className={`rounded-lg p-1.5 transition hover:bg-[#f0eee6] ${item.feedback === 1 ? 'text-[#c96442]' : ''}`}
                >
                  <ThumbsUp size={15} />
                </button>
                <button
                  title="Bad response"
                  onClick={() => rate(i, -1)}
                  className={`rounded-lg p-1.5 transition hover:bg-[#f0eee6] ${item.feedback === -1 ? 'text-[#c96442]' : ''}`}
                >
                  <ThumbsDown size={15} />
                </button>
                <span className="ml-2 flex items-center gap-0.5 text-xs">
                  <button title="Save as PDF" onClick={() => exportPdf(item.content)} className="rounded-lg px-2 py-1 transition hover:bg-[#f0eee6]">PDF</button>
                  <button title="Download Word" onClick={() => exportWord(item.content)} className="rounded-lg px-2 py-1 transition hover:bg-[#f0eee6]">Word</button>
                  <button title="Download Excel" onClick={() => exportExcel(item.content)} className="rounded-lg px-2 py-1 transition hover:bg-[#f0eee6]">Excel</button>
                </span>
                {item.credits ? (
                  <span className="ml-2 flex items-center gap-1 text-xs text-[#9c9a92]">
                    <Zap size={11} />
                    {item.credits} credits
                  </span>
                ) : null}
              </div>
            </div>
          ))}

          {generating && !streamingNow && (
            <div className="flex items-center gap-3 pt-1 text-sm text-[#6b6a64]">
              <span className="flex gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#c96442]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#c96442] [animation-delay:0.2s]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#c96442] [animation-delay:0.4s]" />
              </span>
              <span>{streamStatus || (tools.webSearch ? 'Searching the web if needed' : 'Thinking')}… {waitSeconds}s</span>
            </div>
          )}

          {file && (
            <div className="flex max-w-fit items-center gap-2 rounded-xl border border-[#e8e6dc] bg-white px-3 py-2 text-xs font-medium text-[#1f1e1d]">
              <Paperclip size={14} />{file}
              <button onClick={() => setFile(null)} className="text-[#6b6a64] hover:text-[#1f1e1d]"><X size={14} /></button>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="mx-auto w-full max-w-2xl pb-3">
        <div className="relative rounded-2xl border border-[#e8e6dc] bg-white p-3 shadow-sm transition focus-within:border-[#c96442]/60">
          {showTools && (
            <>
              <button className="fixed inset-0 z-10 cursor-default" onClick={() => setShowTools(false)} aria-label="Close tools" />
              <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-[#e8e6dc] bg-white py-2 shadow-xl">
                <ToolRow
                  icon={<Globe size={16} />}
                  title="Web search"
                  detail="Searches the web automatically when a question needs current facts."
                  on={tools.webSearch}
                  onToggle={() => setTools(t => ({ ...t, webSearch: !t.webSearch }))}
                />
                <ToolRow
                  icon={<Clock size={16} />}
                  title="Date and time"
                  detail="Tell the AI today's date and time in Dhaka."
                  on={tools.datetime}
                  onToggle={() => setTools(t => ({ ...t, datetime: !t.datetime }))}
                />
                <ToolRow
                  icon={<Link2 size={16} />}
                  title="Web fetch"
                  detail="Read the pages of links you paste in your message."
                  on={tools.webFetch}
                  onToggle={() => setTools(t => ({ ...t, webFetch: !t.webFetch }))}
                />
                <ToolRow
                  icon={<ImageIcon size={16} />}
                  title="Image generation"
                  detail="Turn your message into an image instead of a text reply."
                  on={tools.imageGen}
                  onToggle={() => setTools(t => ({ ...t, imageGen: !t.imageGen }))}
                />
              </div>
            </>
          )}
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={listening ? 'Listening… speak now' : 'How can I help you today?'}
            rows={2}
            className="max-h-48 w-full resize-none bg-transparent text-[15px] leading-6 text-[#1f1e1d] outline-none placeholder:text-[#9c9a92]"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#6b6a64] transition hover:bg-[#f0eee6]" title="Attach file">
                <Paperclip size={17} />
                <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0]?.name ?? null)} />
              </label>
              <button
                onClick={() => setShowTools(!showTools)}
                title="Tools"
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition hover:bg-[#f0eee6] ${Object.values(tools).some(Boolean) ? 'text-[#c96442]' : 'text-[#6b6a64]'}`}
              >
                <Wrench size={15} />
                Tools
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleVoice}
                title={listening ? 'Stop voice typing' : 'Voice typing'}
                aria-label={listening ? 'Stop voice typing' : 'Voice typing'}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-[#f0eee6] ${listening ? 'bg-[#f0eee6] text-[#c96442]' : 'text-[#6b6a64]'}`}
              >
                {listening ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
              <button
                onClick={send}
                disabled={generating || !message.trim()}
                aria-label="Send"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#c96442] text-white transition hover:bg-[#a8502f] disabled:opacity-40"
              >
                <ArrowUp size={17} />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 space-y-0.5 text-center text-[11px] leading-4 text-[#9c9a92]">
          <p>AI can give inaccurate information. Check important facts.</p>
          <p>Smart AI picks the best model for each question. Choose a specific model only if you want to save credits.</p>
          <p>Smart AI gives shorter answers than a specific model. For a detailed answer, choose a model from the list.</p>
        </div>
      </div>

      {showBuyCredits && (
        <BuyCreditsInline
          credits={chatCredits}
          onClose={() => setShowBuyCredits(false)}
          onBuy={async (amount) => {
            const res = await purchaseCredits(amount);
            if (res.success) { setChatCredits(res.newBalance); setCreditError(''); } else { setCreditError(res.error ?? 'Purchase failed'); }
            setShowBuyCredits(false);
          }}
        />
      )}
    </div>
  );
}

function ToolRow({ icon, title, detail, on, onToggle }: { icon: ReactNode; title: string; detail: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#faf9f5]">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0eee6] text-[#1f1e1d]">{icon}</div>
      <div className="flex-1">
        <div className="text-sm font-medium text-[#1f1e1d]">{title}</div>
        <div className="text-[11px] text-[#6b6a64]">{detail}</div>
      </div>
      <span role="switch" aria-checked={on} className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-[#c96442]' : 'bg-[#d6d3c8]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function BuyCreditsInline({ credits, onClose, onBuy }: { credits: number; onClose: () => void; onBuy: (amount: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1f1e1d]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-in">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1f1e1d]">Buy credits</h2>
            <p className="text-sm text-[#6b6a64]">Current balance: {credits} credits · ৳1 = 1 credit</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#6b6a64] hover:bg-[#f0eee6]"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {chatPacks.map(pack => (
            <button
              key={pack.amount}
              onClick={() => setSelected(pack.amount)}
              className={`relative rounded-2xl border-2 p-4 text-left transition ${selected === pack.amount ? 'border-[#c96442] bg-[#faf9f5]' : 'border-[#e8e6dc] hover:border-[#c96442]/40'}`}
            >
              <div className="text-xl font-semibold text-[#1f1e1d]">{pack.label}</div>
              <div className="mt-1 text-xs text-[#6b6a64]">৳1 = 1 credit</div>
              <div className="mt-3 text-2xl font-semibold text-[#c96442]">৳{pack.price.toLocaleString()}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-[#faf9f5] p-3 text-xs text-[#6b6a64]">
          Credits are used for chat and image generation. Credits never expire.
        </div>
        <button
          disabled={!selected}
          onClick={() => selected && onBuy(selected)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#c96442] py-3.5 text-sm font-semibold text-white transition hover:bg-[#a8502f] disabled:opacity-50"
        >
          {selected ? `Pay ৳${chatPacks.find(p => p.amount === selected)?.price.toLocaleString()}` : 'Select a pack'}
        </button>
      </div>
    </div>
  );
}
