import React from "react";
import mark from "../../../assets/hyzz-mark.svg";
export default function Brand({ onClick }) {
  const content = (
    <>
      <img src={mark} alt="" width="42" height="42" />
      <span>
        hyzz<i>.</i>
      </span>
    </>
  );
  return onClick ? (
    <button
      className="hyzz-brand brand-home"
      aria-label="Hyzz overview"
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className="hyzz-brand" aria-label="Hyzz">
      {content}
    </div>
  );
}
export function NavIcon({ name }) {
  const paths = {
    Overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    Bookings: "M8 3h8M9 2h6v4H9zM6 4H4v18h16V4h-2M8 11h8M8 15h5",
    Customers:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M16 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.9",
    Drivers:
      "M5 17H3v-6l3-7h12l3 7v6h-2M3 11h18M5 17h14M6 17v3M18 17v3M6 14h1M17 14h1",
    Employees: "M3 7h18v14H3zM8 7V3h8v4M3 12h18M10 12v3h4v-3",
    Finance: "M5 4h14M5 8h14M9 4a5 5 0 0 1 0 10H5l10 8",
    Support:
      "M3 13v-1a9 9 0 0 1 18 0v1M3 12h4v7H3zM17 12h4v7h-4zM17 19c0 3-3 3-5 3",
    Settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
    Audit: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5",
    Reports: "M3 3v18h18M7 17v-5M12 17V7M17 17v-8",
    Content:
      "M3 4h7a3 3 0 0 1 2 2 3 3 0 0 1 2-2h7v16h-7a3 3 0 0 0-2 2 3 3 0 0 0-2-2H3zM12 6v16",
    Enquiries: "M3 4h18v13H8l-5 4zM7 8h10M7 12h7",
    Promotions: "M3 5h8l10 10-7 7L3 11zM7 8h.01",
    "App updates": "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
  };
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] || paths.Overview} />
    </svg>
  );
}
