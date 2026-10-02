/** Class names, leaving out the falsy ones. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
