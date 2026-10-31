import { useEffect, useState } from 'react';
import { Download, FileArchive, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function DownloadPage() {
  const { user } = useAuth();
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/bdchat-wordpress-plugin.zip', { method: 'HEAD' })
      .then((r) => setExists(r.ok))
      .catch(() => setExists(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 card-shadow sm:p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <FileArchive size={24} />
          </div>
          <div>
            <h1 className="heading text-2xl font-bold text-slate-900">Download WordPress Plugin</h1>
            <p className="text-sm text-slate-500">BDChat AI Workspace — version 1.0.0</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Installation steps</h2>
            <ol className="mt-3 space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <span className="font-bold text-slate-400">1.</span>
                <span>Click the download button below to save the ZIP file.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-slate-400">2.</span>
                <span>In WordPress, go to <strong>Plugins → Add New → Upload Plugin</strong>.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-slate-400">3.</span>
                <span>Choose the ZIP file and click <strong>Install Now</strong>, then activate.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-slate-400">4.</span>
                <span>Edit any page and add the shortcode <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-mono">[bdchat]</code>.</span>
              </li>
            </ol>
          </div>

          <div className="rounded-2xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-800">What's inside</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> PHP plugin wrapper with shortcode</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Bundled React app (chat, images, usage, admin)</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Supabase authentication and database integration</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Vite manifest for asset loading</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> readme.txt with install instructions</li>
            </ul>
          </div>

          {exists === null ? (
            <div className="flex items-center justify-center py-6 text-slate-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : exists ? (
            <a
              href="/bdchat-wordpress-plugin.zip"
              download="bdchat-wordpress-plugin.zip"
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-900 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-slate-800 active:scale-[0.98]"
            >
              <Download size={22} />
              Download Plugin (ZIP)
            </a>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              <AlertCircle size={20} className="shrink-0" />
              <span>The plugin file is not available yet. Please rebuild and try again.</span>
            </div>
          )}

          <p className="text-center text-xs text-slate-400">
            File size: ~119 KB · Includes PHP, JavaScript, CSS, and manifest
          </p>
        </div>
      </div>
    </div>
  );
}
