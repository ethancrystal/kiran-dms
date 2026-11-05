import type { Metadata } from "next";

// The token is in the address: no page this link leads to may pass it on as a referrer, and no
// search engine may keep it (D-39).
export const metadata: Metadata = {
  title: "Kiran invitation",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
