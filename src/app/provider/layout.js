/* /provider/layout.js */
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import styles from "./provider.module.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Provider Dashboard",
  description: "Gerenciamento central da Strava Event Engine",
};

export default function ProviderLayout({ children }) {
  return (
    <div className={`${geistSans.variable} ${geistMono.variable} ${styles.providerRoot}`}>
      <header className={styles.header}>
        <h1>Provider Dashboard</h1>
      </header>

      {/* Container flex para sidebar + main */}
      <div className={styles.contentWrapper}>
        <aside className={styles.sidebar}>
          <nav>
            <ul>
              <li>Eventos</li>
              <li>Atletas</li>
              <li>Configurações</li>
            </ul>
          </nav>
        </aside>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
