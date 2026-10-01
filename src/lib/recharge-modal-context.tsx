"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type RechargeTab = "pay" | "code";

type Ctx = {
  open: boolean;
  tab: RechargeTab;
  selectedPackId: string | null;
  openRecharge: (tab?: RechargeTab, packId?: string) => void;
  closeRecharge: () => void;
  setTab: (tab: RechargeTab) => void;
};

const RechargeModalContext = createContext<Ctx | null>(null);

export function RechargeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RechargeTab>("pay");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const openRecharge = useCallback((t: RechargeTab = "pay", packId?: string) => {
    setTab(t);
    setSelectedPackId(packId ?? null);
    setOpen(true);
  }, []);
  const closeRecharge = useCallback(() => setOpen(false), []);

  const value = useMemo<Ctx>(
    () => ({ open, tab, selectedPackId, openRecharge, closeRecharge, setTab }),
    [open, tab, selectedPackId, openRecharge, closeRecharge]
  );

  return (
    <RechargeModalContext.Provider value={value}>
      {children}
    </RechargeModalContext.Provider>
  );
}

/** Safe-to-call:在 Provider 外用返回 no-op。 */
export function useRecharge(): Ctx {
  const c = useContext(RechargeModalContext);
  if (!c) {
    return {
      open: false,
      tab: "pay",
      selectedPackId: null,
      openRecharge: () => {},
      closeRecharge: () => {},
      setTab: () => {},
    };
  }
  return c;
}
