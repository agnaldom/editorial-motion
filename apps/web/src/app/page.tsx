'use client';

import {useEffect, useState} from 'react';
import {fetchJob, isActive, stageIndex, stageLabels, type JobResponse} from '@/lib/job';

const acceptedTypes = ['image/png', 'image/jpeg', 'image/webp'];

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('8');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);

  useEffect(() => {
    if (!job || !isActive(job.status)) return;
    const timer = setInterval(() => {
      fetchJob(job.jobId).then(setJob).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);

  const pickFile = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!acceptedTypes.includes(candidate.type)) {
      setError('Only PNG, JPEG, and WebP images are supported');
      return;
    }
    setError(null);
    setFile(candidate);
  };

  const onSubmit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('prompt', prompt);
      body.append('durationSeconds', durationSeconds);
      const response = await fetch('/api/v1/renders', {method: 'POST', body});
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = (data as {message?: string})?.message ?? `Request failed (${response.status})`;
        throw new Error(message);
      }
      setJob(await fetchJob((data as {jobId: string}).jobId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to start render');
    } finally {
      setBusy(false);
    }
  };

  const currentIndex = job ? stageIndex(job.stage) : -1;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Editorial Motion</h1>

      <section className="flex flex-col gap-5 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <label htmlFor="image" className="text-sm font-medium">Upload image</label>
          <label
            htmlFor="image"
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              pickFile(event.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-8 text-sm text-zinc-500 transition-colors ${
              dragOver ? 'border-zinc-900 bg-zinc-100' : 'border-zinc-300 hover:border-zinc-400'
            }`}
          >
            {file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : 'Drop PNG / JPG / WebP'}
          </label>
          <input id="image" type="file" accept={acceptedTypes.join(',')} className="sr-only" onChange={(event) => pickFile(event.target.files?.[0])} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="prompt" className="text-sm font-medium">Motion prompt</label>
          <textarea
            id="prompt"
            rows={3}
            maxLength={4000}
            placeholder="Static camera. Drop the three country..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="rounded-lg border p-3 text-sm focus:border-zinc-900 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-4 text-sm">
          <label htmlFor="duration" className="font-medium">Duration:</label>
          <input
            id="duration"
            type="number"
            min={8}
            max={20}
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(event.target.value)}
            className="w-16 rounded-lg border p-2"
          />
          <span className="text-zinc-500">seconds</span>
        </div>
        <p className="text-sm text-zinc-500">Output: 2560 × 1440 • 30fps • MP4</p>

        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !file || !prompt.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {busy ? 'Starting…' : 'Generate animation'}
        </button>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </section>

      {job && (
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <ol className="flex flex-col gap-2 text-sm">
            {stageLabels.map((stage, index) => {
              if (index < currentIndex || job.status === 'completed') {
                return <li key={stage.stage} className="flex items-center gap-2"><span aria-hidden>✓</span>{stage.label}</li>;
              }
              if (index === currentIndex) {
                // ponytail: progresso do job é por estágio (0–100 grosseiro); upgrade: progresso fino do Remotion via stream
                const detail = stage.stage === 'rendering' ? ` ${Math.min(99, job.progress)}%` : '…';
                return <li key={stage.stage} className="flex items-center gap-2 font-medium"><span className="animate-pulse" aria-hidden>●</span>{stage.label}{detail}</li>;
              }
              return <li key={stage.stage} className="flex items-center gap-2 text-zinc-400"><span aria-hidden>○</span>{stage.label}</li>;
            })}
          </ol>
          {job.status === 'failed' && <p role="alert" className="mt-3 text-sm text-red-600">{job.error ?? 'Render failed'}</p>}
        </section>
      )}

      {job?.output && (
        <section className="flex flex-col gap-3 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium">{job.output.fileName}</h2>
          <video controls preload="metadata" src={job.output.url} className="w-full rounded-lg border bg-black" />
          <div className="flex gap-3">
            <a href={job.output.url} download={job.output.fileName} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">Download</a>
            <span className="self-center text-sm text-zinc-500">{job.output.width} × {job.output.height} • {job.output.fps}fps • {job.output.durationSeconds}s</span>
          </div>
        </section>
      )}
    </main>
  );
}
