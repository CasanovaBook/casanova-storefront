import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

/** Link that understands internal routes, #anchors and external URLs. */
export function SmartLink({ to, children, className, style, onClick }: { to: string; children: ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void }) {
  if (/^https?:\/\//i.test(to) || to.startsWith("mailto:") || to.startsWith("tel:")) {
    const external = /^https?:\/\//i.test(to);
    return (
      <a href={to} className={className} style={style} onClick={onClick} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
        {external && <span className="sr-only"> (נפתח בלשונית חדשה)</span>}
      </a>
    );
  }
  if (to.startsWith("#")) {
    return (
      <a href={to} className={className} style={style} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className} style={style} onClick={onClick}>
      {children}
    </Link>
  );
}

/**
 * Short marked-up text: newline = line break, *word* = accent (<em>).
 * Wrap it in an element with a class such as "[&_em]:text-[#d9bc7b]" to colour the accent.
 */
export function Rich({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {line.split("*").map((part, pi) => (pi % 2 === 1 ? <em key={pi}>{part}</em> : <Fragment key={pi}>{part}</Fragment>))}
        </Fragment>
      ))}
    </>
  );
}

export interface Tokens {
  phone?: string | null;
  email?: string | null;
}

/** Replaces {{tokens}}. A line whose token has no value (e.g. no phone set yet) is dropped instead of showing a blank. */
export function fillTokens(text: string, t: Tokens): string {
  const map: Record<string, string> = {
    phone: t.phone ?? "",
    email: t.email ?? "בעמוד תמיכה",
  };
  return text
    .split("\n")
    .filter((line) => {
      const m = line.match(/\{\{(\w+)\}\}/g);
      if (!m) return true;
      return !m.some((tok) => {
        const k = tok.slice(2, -2);
        return k === "phone" && !map[k];
      });
    })
    .join("\n")
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => map[k] ?? "");
}

// ── Markdown (small, safe: everything is rendered as React nodes, never as HTML) ──

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else {
      const [, label, url] = tok.match(/\[([^\]]+)\]\(([^)\s]+)\)/) ?? [];
      const safe = /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url ?? "") ? url : "#";
      out.push(
        <SmartLink key={`${keyBase}-${i++}`} to={safe} className="underline underline-offset-4 hover:opacity-80">
          {label}
        </SmartLink>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders long text: paragraphs (blank line), "## heading", "### subheading", "- bullet", "1. numbered",
 * "> quote", "![alt](url)" images, **bold** and [links](/path).
 */
export function Md({ text, className = "" }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={`space-y-4 ${className}`}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (!lines.length) return null;
        const k = `b${bi}`;
        if (lines.every((l) => /^-\s+/.test(l))) {
          return (
            <ul key={k} className="list-disc space-y-1 pr-6">
              {lines.map((l, i) => <li key={i}>{inline(l.replace(/^-\s+/, ""), `${k}-${i}`)}</li>)}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\.\s+/.test(l))) {
          return (
            <ol key={k} className="list-decimal space-y-1 pr-6">
              {lines.map((l, i) => <li key={i}>{inline(l.replace(/^\d+\.\s+/, ""), `${k}-${i}`)}</li>)}
            </ol>
          );
        }
        if (lines[0].startsWith("### ")) return <h3 key={k} className="font-display text-2xl">{lines[0].slice(4)}</h3>;
        if (lines[0].startsWith("## ")) return <h2 key={k} className="font-display text-3xl">{lines[0].slice(3)}</h2>;
        if (lines[0].startsWith("> ")) return <blockquote key={k} className="border-r-4 border-current/40 pr-4 italic">{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "), k)}</blockquote>;
        const image = lines[0].match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (image && /^(https?:\/\/|\/|data:image\/)/i.test(image[2])) {
          return <img key={k} src={image[2]} alt={image[1]} loading="lazy" className="w-full object-cover" />;
        }
        return (
          <p key={k}>
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {/^-\s+/.test(l) ? <>{"• "}{inline(l.replace(/^-\s+/, ""), `${k}-${i}`)}</> : inline(l, `${k}-${i}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
