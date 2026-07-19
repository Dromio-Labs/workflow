import type {ReactNode} from "react";
import "@dromio/chat-shell-ui/styles.css";

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
