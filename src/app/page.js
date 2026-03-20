// src/app/page.js
import { getSession } from "@/lib/session";
import AthleteHome    from "./AthleteHome";

export const runtime = "nodejs";

export default async function LandingPage() {
  const session = await getSession();

  if (session) {
    return <AthleteHome />;
  }

  return (
    <main style={styles.main}>
      
        href="https://www.treine.com.gt"
        target="_blank"
        rel="noopener noreferrer"
        style={styles.signatureWrapper}
      >
        <img
          src="/treinecomgt.svg"
          alt="treine.com.gt"
          style={styles.signature}
        />
      </a>
    </main>
  );
}

const styles = {
  main: {
    minHeight:       "100vh",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
    backgroundColor: "#ffffff",
    position:        "relative",
  },
  signatureWrapper: {
    position: "absolute",
    bottom:   "24px",
    right:    "24px",
    width:    "180px",
    opacity:  0.8,
  },
  signature: {
    width:   "100%",
    height:  "auto",
    display: "block",
  },
};
