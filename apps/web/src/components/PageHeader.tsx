import type { ReactNode } from "react";

/** The masthead on the battlefield art. The title's full stop is added here, never typed. */
export function PageHeader({
  kicker,
  title,
  sub,
  event = false,
  children,
}: {
  kicker: string;
  title: string;
  sub?: string;
  /** For a title that comes from Discord and can be any length. */
  event?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="rc-masthead">
      <img src="/brand/hero-battlefield.jpg" alt="" />
      <div className="rc-container rc-masthead__body">
        <p className="section-index">{kicker}</p>
        <h1 className={event ? "page-title page-title--event" : "page-title"}>
          {title}
          <span className="dot">.</span>
        </h1>
        {sub && <p className="rc-masthead__sub">{sub}</p>}
        {children && <p className="rc-masthead__lead">{children}</p>}
      </div>
    </section>
  );
}

/** The band under the header, as label and value pairs. It holds only true, current facts. */
export function Ticker({ items }: { items: [label: string, value: string][] }) {
  return (
    <div className="rc-ticker">
      {items.map(([label, value]) => (
        <span className="rc-ticker__item" key={label}>
          <span className="rc-ticker__sep">/</span>
          <span
            className="ticker-marker"
            style={{ "--ticker-accent": "var(--primary)" } as object}
          />
          <b>{label}</b>
          <i>·</i>
          <span>{value}</span>
        </span>
      ))}
    </div>
  );
}
