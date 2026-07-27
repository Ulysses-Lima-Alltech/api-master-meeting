import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "./AnalyticsScript";

export const metadata: Metadata = {
  title: "Master Meeting",
  description:
    "Terminal AI-first para trabalhadores do conhecimento — Claude Code × Outlook no backend de bot de reuniões e agente autônomo do Master Meeting.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* apply the saved theme before first paint so day mode doesn't flash dark on reload */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('vexa.terminal.theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}` }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
