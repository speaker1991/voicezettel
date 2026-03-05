"use client";

import {
    useState,
    useCallback,
    useRef,
    useEffect,
    type FormEvent,
} from "react";
import { SendHorizontal, Plus, Image, FileText, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTextChat } from "@/hooks/useTextChat";
import { warmUpAudio } from "@/lib/sounds";

interface AttachedFile {
    file: File;
    type: "photo" | "document" | "audio";
    preview?: string;
}

function AudioWaveIcon({ className }: { className?: string }) {
    return (
        <svg
            width="14"
            height="10"
            viewBox="0 0 14 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M2.08161 2.71886V6.99316C2.08161 7.37197 1.38774 7.37197 1.38774 6.99316V2.71886C1.38774 2.34014 2.08161 2.34014 2.08161 2.71886ZM3.46935 1.53234V8.17977C3.46935 8.5585 2.77548 8.5585 2.77548 8.17977V1.53234C2.77548 1.15361 3.46935 1.15361 3.46935 1.53234ZM4.85709 3.86836V5.84374C4.85709 6.22247 4.16322 6.22247 4.16322 5.84374V3.86828C4.16322 3.48955 4.85709 3.48964 4.85709 3.86836ZM6.24483 2.64326V7.06894C6.24483 7.44758 5.55096 7.44758 5.55096 7.06894V2.64326C5.55096 2.26453 6.24483 2.26453 6.24483 2.64326ZM7.63257 0.284045V9.42806C7.63257 9.80679 6.93879 9.80679 6.93879 9.42806V0.284045C6.93879 -0.0946816 7.63257 -0.0946816 7.63257 0.284045ZM9.02031 1.53303V8.17908C9.02031 8.5578 8.32644 8.5578 8.32644 8.17908V1.53303C8.32644 1.1543 9.02031 1.1543 9.02031 1.53303ZM10.4081 3.60011V6.112C10.4081 6.49073 9.71418 6.49073 9.71418 6.112V3.60011C9.71418 3.22138 10.4081 3.22138 10.4081 3.60011ZM11.7959 2.71912V6.99299C11.7959 7.37171 11.102 7.37171 11.102 6.99299V2.71912C11.102 2.3404 11.7959 2.3404 11.7959 2.71912ZM13.1836 3.59941V6.11269C13.1836 6.49142 12.4897 6.49142 12.4897 6.11269V3.59941C12.4897 3.22069 13.1836 3.22069 13.1836 3.59941ZM0.69387 3.59941V6.11269C0.69387 6.49142 0 6.49142 0 6.11269V3.59941C0 3.22069 0.693784 3.22069 0.693784 3.59941H0.69387Z"
                fill="currentColor"
            />
        </svg>
    );
}

const ATTACHMENT_OPTIONS = [
    {
        type: "photo" as const,
        label: "Фото",
        icon: Image,
        accept: "image/*",
        color: "text-emerald-400",
    },
    {
        type: "document" as const,
        label: "Документ",
        icon: FileText,
        accept: ".pdf,.doc,.docx,.txt,.xlsx,.csv,.pptx",
        color: "text-blue-400",
    },
    {
        type: "audio" as const,
        label: "Аудио",
        icon: AudioWaveIcon,
        accept: "audio/*",
        color: "text-white",
    },
];

export function InputBar() {
    const [text, setText] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const [attachments, setAttachments] = useState<AttachedFile[]>([]);
    const { sendMessage } = useTextChat();
    const menuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingTypeRef = useRef<"photo" | "document" | "audio">("photo");

    // Close menu on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [menuOpen]);

    const handleSend = useCallback(() => {
        const trimmed = text.trim();
        if (!trimmed && attachments.length === 0) return;
        warmUpAudio();
        // For now send text only — file upload API can be added later
        if (trimmed) {
            const attachmentInfo =
                attachments.length > 0
                    ? `\n\n[Прикреплено: ${attachments.map((a) => a.file.name).join(", ")}]`
                    : "";
            sendMessage(trimmed + attachmentInfo);
        }
        setText("");
        setAttachments([]);
    }, [text, attachments, sendMessage]);

    const handleSubmit = useCallback(
        (e: FormEvent) => {
            e.preventDefault();
            handleSend();
        },
        [handleSend],
    );

    const handleOptionClick = useCallback(
        (type: "photo" | "document" | "audio", accept: string) => {
            pendingTypeRef.current = type;
            if (fileInputRef.current) {
                fileInputRef.current.accept = accept;
                fileInputRef.current.click();
            }
            setMenuOpen(false);
        },
        [],
    );

    const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            const file = files[0];
            const newAttachment: AttachedFile = {
                file,
                type: pendingTypeRef.current,
            };

            // Generate preview for images
            if (
                pendingTypeRef.current === "photo" &&
                file.type.startsWith("image/")
            ) {
                newAttachment.preview = URL.createObjectURL(file);
            }

            setAttachments((prev) => [...prev, newAttachment]);

            // Reset input
            e.target.value = "";
        },
        [],
    );

    const removeAttachment = useCallback((index: number) => {
        setAttachments((prev) => {
            const removed = prev[index];
            if (removed.preview) URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== index);
        });
    }, []);

    return (
        <form
            onSubmit={handleSubmit}
            className="pwa-input-bar shrink-0 border-t border-white/5 py-3"
        >
            {/* Attachment previews */}
            <AnimatePresence>
                {attachments.length > 0 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mb-2 flex flex-wrap gap-2 overflow-hidden"
                    >
                        {attachments.map((att, i) => (
                            <motion.div
                                key={`${att.file.name}-${i}`}
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.8, opacity: 0 }}
                                className="relative flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5"
                            >
                                {att.preview ? (
                                    <img
                                        src={att.preview}
                                        alt={att.file.name}
                                        className="size-6 rounded object-cover"
                                    />
                                ) : att.type === "document" ? (
                                    <FileText className="size-4 text-blue-400" />
                                ) : (
                                    <AudioWaveIcon className="size-4 text-amber-400" />
                                )}
                                <span className="max-w-[100px] truncate text-xs text-zinc-300">
                                    {att.file.name}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => removeAttachment(i)}
                                    className="ml-0.5 rounded-full p-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                                >
                                    <X className="size-3" />
                                </button>
                            </motion.div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex w-full items-center gap-2">
                {/* Text input */}
                <Input
                    placeholder="Task…"
                    className="flex-1 border-white/10 bg-white/5 placeholder:text-zinc-600 focus-visible:border-violet-500/50 focus-visible:ring-violet-500/20"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />

                {/* Plus button with popup */}
                <div className="relative" ref={menuRef}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={`shrink-0 transition-all ${menuOpen
                            ? "rotate-45 text-violet-400"
                            : "text-zinc-400 hover:text-violet-400"
                            }`}
                        aria-label="Attach file"
                        onClick={() => setMenuOpen((p) => !p)}
                    >
                        <Plus className="size-4" />
                    </Button>

                    {/* Popup menu */}
                    <AnimatePresence>
                        {menuOpen && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                transition={{ duration: 0.15 }}
                                style={{
                                    position: "absolute",
                                    bottom: "calc(100% + 8px)",
                                    left: undefined,
                                    right: 0,
                                    zIndex: 50,
                                }}
                                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                            >
                                {ATTACHMENT_OPTIONS.map((opt, i) => (
                                    <motion.button
                                        key={opt.type}
                                        type="button"
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{
                                            delay: i * 0.05,
                                        }}
                                        onClick={() =>
                                            handleOptionClick(
                                                opt.type,
                                                opt.accept,
                                            )
                                        }
                                        className="flex w-full items-center whitespace-nowrap px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5"
                                        style={{ gap: "5px" }}
                                    >
                                        <opt.icon
                                            className={`size-4 ${opt.color}`}
                                        />
                                        {opt.label}
                                    </motion.button>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Hidden file input */}
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                />

                {/* Send button */}
                <Button
                    type="submit"
                    size="icon-sm"
                    className="shrink-0 bg-violet-600 text-white hover:bg-violet-500"
                    aria-label="Send message"
                    disabled={!text.trim() && attachments.length === 0}
                >
                    <SendHorizontal className="size-4" />
                </Button>
            </div>
        </form>
    );
}
