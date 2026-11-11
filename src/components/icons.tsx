/** Ícones de traço fino usados no site e no painel. */
export type IconName = "home" | "swap" | "tag" | "gauge" | "calendar" | "bars" | "gear" | "wallet" | "up" | "down" | "piggy" | "fork" | "car" | "bag" | "fuel" | "cart" | "pill" | "cash" | "list" | "card" | "user" | "chat" | "star" | "logout" | "plus" | "msg" | "shield" | "users" | "pulse";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const p: Record<IconName, React.ReactNode> = {
    home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" />,
    swap: <path d="M7 7h12l-3-3M17 17H5l3 3" />,
    tag: <path d="M3.5 12.5 11.5 4.5H19.5V12.5L11.5 20.5ZM15.5 8.5h.01" />,
    gauge: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 12 15 8" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5.5" width="16" height="14" rx="3" />
        <path d="M8 3.5v4M16 3.5v4M4 10h16" />
      </>
    ),
    bars: <path d="M6 19v-6M12 19V6M18 19v-9" />,
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" />
      </>
    ),
    wallet: (
      <>
        <rect x="3.5" y="6" width="17" height="13" rx="3" />
        <path d="M16 12.5h.01M3.5 9.5h17" />
      </>
    ),
    up: <path d="M12 19V5M6 11l6-6 6 6" />,
    down: <path d="M12 5v14M6 13l6 6 6-6" />,
    piggy: (
      <>
        <rect x="4" y="7" width="16" height="11" rx="5.5" />
        <path d="M9 7V5.5M15 12.5h.01" />
      </>
    ),
    fork: <path d="M8 3v8a2 2 0 0 0 2 2v8M6 3v5M10 3v5M16 21V3c-2 1-3 4-3 7h3" />,
    car: (
      <>
        <path d="M5 16V12l2-5h10l2 5v4M5 16h14M5 16v2M19 16v2M3.5 11h2M18.5 11h2" />
        <path d="M8 13.5h.01M16 13.5h.01" />
      </>
    ),
    bag: <path d="M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8" />,
    fuel: <path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M14 9h2l2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3M7 8h5" />,
    cart: <path d="M3.5 4.5h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.3h7.6a1.5 1.5 0 0 0 1.5-1.1L20 8H6.3M9.5 20h.01M17 20h.01" />,
    pill: <path d="m10.5 20.5-7-7a4.9 4.9 0 0 1 7-7l7 7a4.9 4.9 0 0 1-7 7ZM7 10l7 7" />,
    list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    card: (
      <>
        <rect x="3" y="5.5" width="18" height="13" rx="3" />
        <path d="M3 10h18M7 15h3" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    chat: <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z" />,
    star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
    logout: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />,
    plus: <path d="M12 5v14M5 12h14" />,
    msg: <path d="M4 5.5h16v10H9l-5 4z" />,
    shield: <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6z" />,
    users: (
      <>
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3 19.5a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 6M18 19.5a6 6 0 0 0-2.5-4.9" />
      </>
    ),
    pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
    cash: (
      <>
        <rect x="3" y="6.5" width="18" height="11" rx="3" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
}

