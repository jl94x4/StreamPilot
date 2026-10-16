export const insertAtCursor = (
    text: string,
    insert: string,
    selectionStart: number,
    selectionEnd: number,
): { nextText: string; nextCursor: number } => {
    const start = Math.max(0, Math.min(selectionStart, text.length));
    const end = Math.max(start, Math.min(selectionEnd, text.length));
    const nextText = `${text.slice(0, start)}${insert}${text.slice(end)}`;
    const nextCursor = start + insert.length;
    return { nextText, nextCursor };
};
