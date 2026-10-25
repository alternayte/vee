// SPDX-License-Identifier: AGPL-3.0-or-later
// The few controls the dashboard needs, in the shadcn pattern (copied in, not
// imported), styled from the tokens only.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  tone = "brass",
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "brass" | "plain" | "bad" }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "inline-flex h-8 items-center gap-1 rounded-sm px-3 text-sm font-medium transition-colors duration-(--duration-fast) disabled:opacity-50",
        tone === "brass" && "bg-brass text-on-brass hover:opacity-90",
        tone === "plain" && "border border-rule text-ink hover:bg-raised",
        tone === "bad" && "border border-bad text-bad hover:bg-raised",
        className,
      )}
    />
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cx(
        "h-8 rounded-sm border border-rule bg-panel px-2 text-sm text-ink placeholder:text-muted",
        className,
      )}
    />
  );
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cx("h-8 rounded-sm border border-rule bg-panel px-2 text-sm text-ink", className)}
    />
  );
}

export function TextArea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={cx(
        "min-h-16 w-full rounded-sm border border-rule bg-panel p-2 text-sm text-ink placeholder:text-muted",
        className,
      )}
    />
  );
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A ruled table: the ledger rows of the direction. Scrolls sideways inside itself on a phone. */
export function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-rule px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id of their own
            <tr key={i} className="border-b border-rule last:border-0 hover:bg-raised">
              {r.map((c, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells have no id of their own
                <td key={j} className="px-2 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tag({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "good" | "warn" | "bad" | "brass";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm border px-1.5 text-xs",
        tone === "muted" && "border-rule text-muted",
        tone === "good" && "border-good text-good",
        tone === "warn" && "border-warn text-warn",
        tone === "bad" && "border-bad text-bad",
        tone === "brass" && "border-brass text-brass",
      )}
    >
      {children}
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-bad">{error instanceof Error ? error.message : String(error)}</p>;
}
