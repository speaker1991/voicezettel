"use client";

export default function OfflinePage() {
    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-4 text-center">
            <div className="mb-6 text-6xl">📡</div>
            <h1 className="mb-2 text-2xl font-bold text-zinc-100">
                Нет подключения
            </h1>
            <p className="mb-6 max-w-sm text-sm text-zinc-400">
                VoiceZettel требует интернет для работы с AI.
                Последние сообщения доступны в кэше.
            </p>
            <button
                className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500"
                onClick={() => window.location.reload()}
            >
                Попробовать снова
            </button>
        </div>
    );
}
