import { useCallback, useState } from "react";
import type { Lang } from "../types";

const KEY = "hitl_lang";

export interface UseLangResult {
  lang: Lang;
  toggle: () => void;
}

export function useLang(fallback: Lang = "en"): UseLangResult {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(KEY) as Lang | null) || fallback,
  );

  const toggle = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === "en" ? "vi" : "en";
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);

  return { lang, toggle };
}
