"use client";

import { useEffect, useState } from "react";

export interface TabDef {
  key: string;
  label: string;
  count?: number;
}

/**
 * Tournament tabs that switch instantly: every panel is rendered on the
 * server in the same request and kept in the page, so moving between them
 * needs no round trip (and the bracket keeps its state). The address bar
 * follows along, so a tab can still be linked to or reloaded.
 */
export function Tabs({ tabs, initial, panels }: { tabs: TabDef[]; initial: string; panels: Record<string, React.ReactNode> }) {
  const [active, setActive] = useState(initial);
  // A link to another tab (from a notice or the winner popup) changes the initial tab.
  useEffect(() => setActive(initial), [initial]);

  const pick = (key: string) => {
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    url.searchParams.delete("msg");
    url.searchParams.delete("err");
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <>
      <nav className="tabs" role="tablist" aria-label="Sections">
        {tabs.map((t) => (
          <a
            key={t.key}
            id={`tab-${t.key}`}
            role="tab"
            href={`?tab=${t.key}`}
            className="tab"
            aria-selected={t.key === active}
            aria-controls={`panel-${t.key}`}
            style={{ textDecoration: "none" }}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              pick(t.key);
            }}
          >
            {t.label}
            {t.count ? <span className="count">{t.count}</span> : null}
          </a>
        ))}
      </nav>
      {tabs.map((t) => (
        <section key={t.key} id={`panel-${t.key}`} role="tabpanel" aria-labelledby={`tab-${t.key}`} hidden={t.key !== active}>
          {panels[t.key]}
        </section>
      ))}
    </>
  );
}
