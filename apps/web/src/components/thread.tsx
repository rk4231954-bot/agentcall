// A strand of the disk's light that runs down the page and connects each
// section back to the black hole. It draws itself in when it scrolls into view.
export function Thread({ label, title, body }: { label: string; title?: string; body?: string }) {
  return (
    <div data-reveal className="thread flex flex-col items-center px-6 text-center">
      <span aria-hidden className="thread-line" />
      <span aria-hidden className="thread-orb" />
      <p className="thread-text mt-6 font-mono text-[11px] uppercase tracking-[0.25em] text-gold/80">{label}</p>
      {title && (
        <h2 className="thread-text mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl">
          {title}
        </h2>
      )}
      {body && <p className="thread-text mt-4 max-w-xl text-pretty text-neutral-400 md:text-lg">{body}</p>}
    </div>
  );
}
