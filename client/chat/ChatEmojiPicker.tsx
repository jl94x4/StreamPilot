import React, { useEffect, useState } from 'react';
import { Smile } from 'lucide-react';
import { CHAT_EMOJI_GROUPS, CHAT_EMOJI_QUICK } from './chatEmojis';

type Props = {
    open: boolean;
    onToggle: () => void;
    onPick: (emoji: string) => void;
    onClose: () => void;
};

export const ChatEmojiPicker: React.FC<Props> = ({ open, onToggle, onPick, onClose }) => {
    const [activeGroup, setActiveGroup] = useState(0);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('[data-chat-emoji-picker]')) return;
            onClose();
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
        };
    }, [open, onClose]);

    const group = CHAT_EMOJI_GROUPS[activeGroup] || CHAT_EMOJI_GROUPS[0];

    return (
        <div className="relative shrink-0" data-chat-emoji-picker>
            <button
                type="button"
                title="Add emoji"
                aria-label="Add emoji"
                aria-expanded={open}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                    open
                        ? 'border-plex/50 bg-plex/15 text-plex'
                        : 'border-white/10 bg-black/30 text-muted hover:border-plex/40 hover:text-text'
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onToggle}
            >
                <Smile className="h-4 w-4" />
            </button>
            {open ? (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(18rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-white/10 bg-[#12141c] shadow-2xl">
                    <div className="flex gap-1 overflow-x-auto border-b border-white/10 p-2">
                        {CHAT_EMOJI_QUICK.map((emoji) => (
                            <button
                                key={`quick-${emoji}`}
                                type="button"
                                className="rounded-lg px-2 py-1 text-lg hover:bg-white/10"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => onPick(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-1.5">
                        {CHAT_EMOJI_GROUPS.map((item, index) => (
                            <button
                                key={item.label}
                                type="button"
                                className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                                    index === activeGroup
                                        ? 'bg-plex/15 text-plex'
                                        : 'text-muted hover:bg-white/5 hover:text-text'
                                }`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => setActiveGroup(index)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto p-2">
                        {group.emojis.map((emoji) => (
                            <button
                                key={`${group.label}-${emoji}`}
                                type="button"
                                className="rounded-lg py-1.5 text-lg hover:bg-white/10"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => onPick(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};
