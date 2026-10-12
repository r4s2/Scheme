"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { GameId } from "@/engine";
import { findPlayers, type PlayerHit } from "@/app/players/actions";
import type { EligibilityRules } from "@/server/registration";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";

/**
 * A handle box that searches Scheme players as you type. Pick a result with
 * the mouse or the arrow keys and Enter. With a game it shows each player's
 * rank; with an event's rules it shows who can't enter and why.
 *
 * Controlled with `value`/`onChange`, or uncontrolled with `name` for plain forms.
 */
export function PlayerPicker({
  value: controlled,
  onChange,
  onPick,
  name,
  game,
  rules,
  exclude = [],
  placeholder = "Search players",
  ariaLabel,
  required,
  style,
}: {
  value?: string;
  onChange?: (handle: string) => void;
  /** Called with the full result when one is picked. */
  onPick?: (hit: PlayerHit) => void;
  name?: string;
  game?: GameId;
  rules?: EligibilityRules;
  /** Handles already listed nearby: shown, but can't be picked twice. */
  exclude?: string[];
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
  style?: React.CSSProperties;
}) {
  const [own, setOwn] = useState("");
  const value = controlled ?? own;
  const setValue = (v: string) => (onChange ? onChange(v) : setOwn(v));
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const seq = useRef(0);
  const id = useId();
  const listId = `${id}-list`;
  const taken = new Set(exclude.map((h) => h.toLowerCase()));
  const rulesKey = JSON.stringify(rules ?? null);

  // Search a moment after typing stops; ignore answers to older queries.
  const [query, setQuery] = useState<string | null>(null);
  useEffect(() => {
    if (query === null) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await findPlayers(q, game, rules);
        if (n === seq.current) {
          setHits(found);
          setActive(found.findIndex((h) => !taken.has(h.handle.toLowerCase())));
        }
      } catch {
        if (n === seq.current) setHits([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taken is derived from exclude; re-searching when it changes isn't needed.
  }, [query, game, rulesKey]);

  // The list floats over everything (tables clip overflow), placed under the box.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = list.current;
      const box = input.current?.getBoundingClientRect();
      if (!el || !box) return;
      const below = innerHeight - box.bottom;
      const width = Math.max(box.width, 280);
      el.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
      el.style.width = `${width}px`;
      if (below < 220 && box.top > below) {
        el.style.top = "";
        el.style.bottom = `${innerHeight - box.top + 4}px`;
      } else {
        el.style.bottom = "";
        el.style.top = `${box.bottom + 4}px`;
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, hits]);

  const pick = (h: PlayerHit) => {
    if (taken.has(h.handle.toLowerCase())) return;
    setValue(h.handle);
    onPick?.(h);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!hits.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      let i = active;
      for (let k = 0; k < hits.length; k++) {
        i = (i + step + hits.length) % hits.length;
        if (!taken.has(hits[i].handle.toLowerCase())) break;
      }
      setActive(i);
    } else if (e.key === "Enter" && open && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const show = open && value.trim().length > 0;
  return (
    <span className="picker" style={style}>
      <input
        ref={input}
        name={name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value.replace(/\s+/g, ""));
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (value && hits.length) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label={ariaLabel}
        required={required}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && active >= 0 ? `${id}-${active}` : undefined}
      />
      {show && (
        <ul ref={list} id={listId} role="listbox" className="picker-list" aria-label="Matching players" aria-busy={loading}>
          {hits.length === 0 ? (
            <li className="picker-empty">{loading ? "Searching…" : `No Scheme player matches “${value.trim()}”.`}</li>
          ) : (
            hits.map((h, i) => {
              const dupe = taken.has(h.handle.toLowerCase());
              return (
                <li
                  key={h.handle}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={dupe || undefined}
                  className={`picker-opt${i === active ? " active" : ""}${dupe ? " dim" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => !dupe && setActive(i)}
                  onClick={() => pick(h)}
                >
                  <span className="picker-top">
                    <b>{h.handle}</b>
                    {h.rank && (
                      <span className="mono tiny">
                        {h.rank}{" "}
                        <span className={`vmark ${h.verified === "self" ? "self" : ""}`} title={h.verified === "self" ? "Self-reported rank" : "Verified rank"}>
                          {h.verified === "self" ? <WarnIcon /> : <CheckIcon />}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="tiny muted">
                    {dupe
                      ? "Already on this roster"
                      : [h.roles.length ? h.roles.join(", ") : game && !h.rank ? "No account for this game" : "", h.lookingForTeam ? "Looking for a team" : ""].filter(Boolean).join(" · ") || " "}
                  </span>
                  {!dupe && h.blocker && <span className="tiny picker-bad">{h.blocker}</span>}
                  {!dupe && !h.blocker && h.note && <span className="tiny picker-warn">{h.note}</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </span>
  );
}
