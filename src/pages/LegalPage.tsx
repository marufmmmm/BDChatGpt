import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot } from 'lucide-react';

export function LegalPage({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#f7f8fc] p-6 sm:p-10">
      <div className="mx-auto max-w-3xl">
        <button onClick={() => navigate(-1)} className="mb-8 flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-10 card-shadow">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white"><Bot size={20} /></div>
            <span className="heading text-lg font-extrabold">BDChat</span>
          </div>
          <h1 className="heading text-3xl font-extrabold">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">Last updated September 10, 2026</p>
          <div className="prose prose-slate mt-10 max-w-none text-sm leading-7">
            <h2 className="heading text-xl font-extrabold">4. Data retention policy</h2>
            <h3 className="mt-6 font-bold">4.1 Uploaded files</h3>
            <p>All uploaded files are stored for a maximum of 30 days from the upload date. After 30 days, files are automatically deleted from our servers. Users may manually delete files at any time. Deleted files cannot be recovered.</p>
            <h3 className="mt-6 font-bold">4.2 Generated images</h3>
            <p>Images generated using BDChat are stored for a maximum of 30 days from the generation date. Monthly image quota is based on generation date, not storage expiration.</p>
            <h3 className="mt-6 font-bold">4.3 Chat history</h3>
            <p>Chat conversations are stored indefinitely until manually deleted. Files and images referenced in chats are removed when their 30-day retention period expires; chat text remains.</p>
            <h3 className="mt-6 font-bold">4.4 Automatic deletion</h3>
            <p>Automatic deletion occurs daily at 00:00 UTC. Users receive a notification one day before automatic deletion. BDChat is not responsible for data loss after the retention period.</p>
            <h3 className="mt-6 font-bold">4.5 Storage limits</h3>
            <p>Free accounts include 100MB of storage. Paid plans include 500MB, 1GB, or 2GB. Storage limits are per user account and shared across uploaded files and generated images.</p>
            <h2 className="heading mt-10 text-xl font-extrabold">Privacy & security</h2>
            <p>Your data is encrypted in transit and at rest. BDChat only processes files when needed to provide the requested service. Deleted data cannot be recovered by our support team.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
